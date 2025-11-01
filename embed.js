import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { basenameNoExt, listFiles } from "./util.js";
import { uploadToTiktok } from "./uploader.js";
import appConfig from "./config.js";

function crc32(bytes) {
  let c = ~0 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function buildChunk(type, data) {
  const len = u32be(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcIn = Buffer.concat([typeBuf, data]);
  const crc = u32be(crc32(crcIn));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeTransparent1x1Png() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // w
  ihdr.writeUInt32BE(1, 4); // h
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  const IHDR = buildChunk("IHDR", ihdr);
  const scanline = Buffer.from([0, 0, 0, 0, 0]); // filter=0 + RGBA(0,0,0,0)
  const IDAT = buildChunk("IDAT", zlib.deflateSync(scanline));
  const IEND = buildChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([PNG_SIG, IHDR, IDAT, IEND]);
}

function buildITXtChunk(keyword, textUtf8, compress = true) {
  const kw = Buffer.from(keyword, "latin1");
  const zero = Buffer.from([0]);
  const compFlag = Buffer.from([compress ? 1 : 0]);
  const compMethod = Buffer.from([0]);
  const lang = zero;
  const translated = zero;
  const text = compress
    ? zlib.deflateSync(Buffer.from(textUtf8, "utf8"))
    : Buffer.from(textUtf8, "utf8");
  const data = Buffer.concat([
    kw,
    zero,
    compFlag,
    compMethod,
    lang,
    translated,
    text,
  ]);
  return buildChunk("iTXt", data);
}

function insertBeforeIEND(pngBuf, chunks) {
  if (!pngBuf.slice(0, 8).equals(PNG_SIG)) throw new Error("PNG signature sai");
  let off = 8,
    iend = -1;
  while (off + 12 <= pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.slice(off + 4, off + 8).toString("ascii");
    const tot = 12 + len;
    if (off + tot > pngBuf.length) throw new Error("PNG hỏng");
    if (type === "IEND") {
      iend = off;
      break;
    }
    off += tot;
  }
  if (iend < 0) throw new Error("Không tìm thấy IEND");
  return Buffer.concat([pngBuf.slice(0, iend), ...chunks, pngBuf.slice(iend)]);
}

export function extractITXtAll(pngBuf, prefix = "payload-") {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const zlib = require("zlib");

  if (!pngBuf.slice(0, 8).equals(PNG_SIG)) throw new Error("PNG signature sai");

  let off = 8;
  const parts = [];

  while (off + 12 <= pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.slice(off + 4, off + 8).toString("ascii");
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    const crcEnd = dataEnd + 4;
    if (crcEnd > pngBuf.length) throw new Error("PNG hỏng");

    if (type === "iTXt") {
      // Parse iTXt: keyword\0 compFlag(1B) compMethod(1B) lang\0 translated\0 text
      let p = dataStart;
      const end = dataEnd;

      const findZero = (i) => {
        const j = pngBuf.indexOf(0, i);
        if (j < 0 || j >= end) throw new Error("iTXt parse error");
        return j;
      };

      const kwEnd = findZero(p);
      const keyword = pngBuf.slice(p, kwEnd).toString("latin1");
      p = kwEnd + 1;

      const compFlag = pngBuf[p++];
      const compMethod = pngBuf[p++]; // 0=zlib
      const langEnd = findZero(p);
      p = langEnd + 1; // languageTag (skip)
      const transEnd = findZero(p);
      p = transEnd + 1; // translatedKeyword (skip)
      const textData = pngBuf.slice(p, end);

      if (keyword.startsWith(prefix)) {
        // Get index from suffix, eg "payload-0007" -> 7
        const idxStr = keyword.slice(prefix.length);
        const idx = Number.parseInt(idxStr, 10);
        if (!Number.isFinite(idx)) {
          throw new Error(`Parse failed: ${keyword}`);
        }
        const utf8 = compFlag === 1 ? zlib.inflateSync(textData) : textData;
        parts.push({ idx, utf8 });
      }
    }

    off = crcEnd;
  }

  if (parts.length === 0) {
    throw new Error(`Not found iTXt with perfix "${prefix}"`);
  }

  // sort by idx
  parts.sort((a, b) => a.idx - b.idx);
  const b64 = parts.map((p) => p.utf8.toString("utf8")).join("");
  return Buffer.from(b64, "base64");
}

function makeIdenticalPng(seed = "default-seed") {
  const width = 64,
    height = 64,
    cell = 4;
  const cols = width / cell; // 16
  const rows = height / cell; // 16

  // ------------ PRNG from seed ------------
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  let state = hash32(String(seed));
  function rnd() {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state >>>= 0;
    state ^= state << 5;
    state >>>= 0;
    return state >>> 0;
  }
  const randByte = () => rnd() & 0xff;

  // ------------ Pick foreground (light) ------------
  const r = 64 + (randByte() & 0x7f);
  const g = 64 + (randByte() & 0x7f);
  const b = 64 + (randByte() & 0x7f);
  const fg = [r, g, b, 255];
  const bg = [0, 0, 0, 0]; // transparent

  // ------------ Generate pattern 16×16  ------------
  // Only left side
  const pattern = Array.from({ length: rows }, () => Array(cols).fill(false));
  const half = Math.ceil(cols / 2); // 8
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < half; x++) {
      const on = (rnd() & 1) === 1;
      pattern[y][x] = on;
      pattern[y][cols - 1 - x] = on; // mirror
    }
  }

  // ------------ Fill raw scanlines RGBA ------------
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter=0
    const gy = Math.floor(y / cell);
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / cell);
      const useFg = pattern[gy][gx];
      const c = useFg ? fg : bg;
      raw[off++] = c[0]; // R
      raw[off++] = c[1]; // G
      raw[off++] = c[2]; // B
      raw[off++] = c[3]; // A
    }
  }

  // ------------ PNG chunks ------------
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const IHDR = buildChunk("IHDR", ihdr);

  const IDAT = buildChunk("IDAT", zlib.deflateSync(raw));
  const IEND = buildChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([PNG_SIG, IHDR, IDAT, IEND]);
}

export default function embedPayload(inputPath) {
  const payload = fs.readFileSync(inputPath);
  const b64 = payload.toString("base64");
  const MAX_TEXT = 32 * 1024;
  const chunks = [];
  for (let i = 0, part = 0; i < b64.length; i += MAX_TEXT, part++) {
    const piece = b64.slice(i, i + MAX_TEXT);
    // keyword “payload-0001”, “payload-0002”… to keep the order
    const keyword = `payload-${String(part + 1).padStart(4, "0")}`;
    chunks.push(buildITXtChunk(keyword, piece, true));
  }

  const seed = crypto.randomBytes(8).toString("hex");
  const base = makeIdenticalPng(seed);

  return insertBeforeIEND(base, chunks);
}

export async function convertTs(dir, name = "_") {
  const files = await listFiles(dir, "ts");
  const pngs = [];
  for (const file of files) {
    const buf = embedPayload(file.absPath);
    const outpath = path.join(dir, name + file.name + ".png");
    fs.writeFileSync(outpath, buf);
    fsp.unlink(file.absPath).catch(() => {});
    pngs.push({
      filePath: outpath,
      segment: file.name + ".ts",
    });
  }

  return pngs;
}

export function replaceM3u8(dir, data) {
  const m3u8 = path.join(dir, "master.m3u8");
  const content = fs.readFileSync(m3u8, "utf8");
  const newContent = content.replace(
    data.segment,
    appConfig.tiktok.orgin_link + data.imgURL
  );
  fs.writeFileSync(m3u8, newContent, "utf8");
}

export async function sendToTiktok(dir) {
  const name = basenameNoExt(dir);
  console.log("converting to png...");
  const pngs = await convertTs(dir, name);
  const outData = [];

  for (const png of pngs) {
    console.log("sending", png.filePath);
    const imgURL = await uploadToTiktok(png.filePath);
    const data = {
      png: png.filePath,
      imgURL: imgURL,
      segment: png.segment,
    };
    outData.push(data);
    replaceM3u8(dir, data);
    fsp.unlink(png.filePath).catch(() => {});
  }

  const outPath = path.join(dir, "uploaded.json");
  fs.writeFileSync(outPath, JSON.stringify(outData), "utf8");
}
