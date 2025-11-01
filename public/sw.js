self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.host === "p16-ad-sg.tiktokcdn.com") {
    console.log("[SW] Intercept TikTok segment:", url.href);
    event.respondWith(handleSegmentSafe(event.request));
  } else {
    return;
  }
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function handleSegmentSafe(req) {
  try {
    console.log("[SW] handleSegmentSafe");
    return await handleSegment(req);
  } catch (e) {
    console.error("[SW] handleSegmentSafe error:", e);
    return fetch(req, { credentials: "omit" });
  }
}

async function handleSegment(req) {
  console.log("[SW] handleSegment", req);
  const r = await fetch(req, { credentials: "omit" });
  if (!r.ok) {
    console.warn("[SW] Fetch failed:", r.status, req.url);
    return r;
  }

  const encBuf = new Uint8Array(await r.arrayBuffer());
  console.log("[SW] Encoded PNG size:", encBuf.length, req.url);

  const tsU8 = await extractITXtAll(encBuf, "payload-");
  console.log("[SW] Extracted TS size:", tsU8.length, req.url);

  console.log("[SW] OK → return TS for", req.url);
  return new Response(tsU8, {
    status: 200,
    headers: {
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-store",
    },
  });
}

/* ========= Helpers ========= */
// Inflate zlib/deflate
async function inflateZlib(u8) {
  try {
    return await inflateWith(u8, "deflate");
  } catch (e1) {
    console.warn("[SW] deflate failed → try deflate-raw", e1);
    return await inflateWith(u8, "deflate-raw");
  }
}
async function inflateWith(u8, algo) {
  const ds = new DecompressionStream(algo);
  const blob = new Blob([u8]);
  const out = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

// Utils
function eq8(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function readAscii(u8, start, end) {
  return new TextDecoder("latin1").decode(u8.subarray(start, end));
}
function findZero(u8, from, end) {
  for (let i = from; i < end; i++) if (u8[i] === 0) return i;
  return -1;
}
function atobToU8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function extractITXtAll(pngU8, prefix = "payload-") {
  const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  if (pngU8.length < 8 || !eq8(pngU8.subarray(0, 8), PNG_SIG))
    throw new Error("PNG signature invalid");

  const dv = new DataView(pngU8.buffer, pngU8.byteOffset, pngU8.byteLength);
  let off = 8;
  const parts = [];

  while (off + 12 <= pngU8.length) {
    const len = dv.getUint32(off, false);
    const type = readAscii(pngU8, off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    const crcEnd = dataEnd + 4;
    if (crcEnd > pngU8.length) break;

    if (type === "iTXt") {
      let p = dataStart;
      const end = dataEnd;

      const kwEnd = findZero(pngU8, p, end);
      const keyword = readAscii(pngU8, p, kwEnd);
      p = kwEnd + 1;

      const compFlag = pngU8[p++];
      const compMethod = pngU8[p++];
      const langEnd = findZero(pngU8, p, end);
      p = langEnd + 1;
      const transEnd = findZero(pngU8, p, end);
      p = transEnd + 1;
      const textData = pngU8.subarray(p, end);

      if (keyword.startsWith(prefix)) {
        const idx = parseInt(keyword.slice(prefix.length), 10);
        let utf8Bytes;
        if (compFlag === 1) {
          utf8Bytes = await inflateZlib(textData);
        } else {
          utf8Bytes = textData;
        }
        parts.push({ idx, utf8Bytes });
      }
    }
    off = crcEnd;
  }

  if (parts.length === 0)
    throw new Error(`Not found iTXt with prefix "${prefix}"`);
  parts.sort((a, b) => a.idx - b.idx);

  const decoder = new TextDecoder("utf-8");
  const b64 = parts.map((p) => decoder.decode(p.utf8Bytes)).join("");
  const b64Clean = b64.replace(/\s+/g, "");
  return atobToU8(b64Clean);
}
