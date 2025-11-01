import express from "express";
import multer from "multer";
import { randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import mime from "mime";
import { sendToTiktok } from "./embed.js";

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const OUT_DIR = path.join(ROOT, "outputs");
const TMP_DIR = path.join(ROOT, "tmp");
// window
// const FF_PATH = path.join(process.cwd(), "bin", "ffmpeg.exe");
// docker
const FF_PATH = "/usr/bin/ffmpeg";

for (const p of [OUT_DIR, TMP_DIR]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

app.use(express.static(PUBLIC_DIR));

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 * 4 }, // 4GB
});

function spawnFFmpeg(args, opts = {}) {
  console.log("Run:", FF_PATH, args.join(" "));

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FF_PATH)) {
      return reject(new Error(`FFmpeg not found at ${FF_PATH}`));
    }

    const ps = spawn(FF_PATH, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], // stdout: progress, stderr: logs
      ...opts,
    });

    let stderr = "";
    let lastProgressTs = Date.now();

    ps.stdout.on("data", (buf) => {
      // Progress format key=value, eg: frame=..., out_time_ms=..., progress=continue
      const s = buf.toString();
      // console.log(s);
      if (s.includes("progress=")) lastProgressTs = Date.now();
    });

    ps.stderr.on("data", (d) => {
      const s = d.toString();
      process.stdout.write(s); // xem realtime
      stderr += s;
    });

    // Watchdog: kill process if no progress in N mins
    const WATCHDOG_MS = 5 * 60 * 1000;
    const timer = setInterval(() => {
      if (Date.now() - lastProgressTs > WATCHDOG_MS) {
        ps.kill("SIGKILL");
      }
    }, 10000);

    ps.on("error", (err) => {
      clearInterval(timer);
      reject(err);
    });

    ps.on("close", (code) => {
      clearInterval(timer);
      if (code === 0) resolve(null);
      else reject(new Error(`ffmpeg exited ${code}\n${stderr}`));
    });
  });
}

// GET /key/:jobId?k=BASE64TOKEN
app.get("/key/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDir = path.join("outputs", jobId);
    const enckey = fs.readFileSync(path.join(jobDir, "enc.key"));

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.send(enckey);
  } catch (e) {
    res.status(500).end("Key server error");
  }
});

app.get("/hls/:jobId/:file", async (req, res) => {
  try {
    const { jobId, file } = req.params;
    const p = path.join(OUT_DIR, jobId, file);
    if (!fs.existsSync(p)) return res.status(404).end("Not found");

    const mimeType = mime.getType(p) || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    if (p.endsWith(".ts")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    res.status(500).end("Serve error");
  }
});

// Upload & convert
app.post("/upload", upload.single("video"), async (req, res) => {
  const inputFile = req.file;
  const seg = Math.max(2, Math.min(10, Number(req.body.seg || 4)));

  if (!inputFile) return res.status(400).send("No file uploaded");

  const jobId = uuidv4();
  const jobDir = path.join(OUT_DIR, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  const key = randomBytes(16);
  const token = randomBytes(16);
  const keyPath = path.join(jobDir, "enc.key");
  await fsp.writeFile(keyPath, key);

  // Create key info file
  const keyUri = `/key/${jobId}?k=${token.toString("base64")}`;
  const keyInfoPath = path.join(jobDir, "enc.keyinfo");
  await fsp.writeFile(keyInfoPath, `${keyUri}\n${keyPath}\n`);

  const outM3u8 = path.join(jobDir, "master.m3u8");
  const segmentPattern = path.join(jobDir, "seg_%05d.ts");

  const args = [
    "-y",
    "-i",
    inputFile.path,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "main",
    "-crf",
    "21",
    "-g",
    String(seg * 6), // keyframe interval
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-hls_time",
    String(seg),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    segmentPattern,
    "-hls_key_info_file",
    keyInfoPath,
    "-hls_flags",
    "independent_segments",
    outM3u8,
  ];

  try {
    await spawnFFmpeg(args);
    await sendToTiktok(jobDir);

    fsp.unlink(inputFile.path).catch(() => {});

    const playlistUrl = `/player.html?key=${jobId}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`
        <h3>Completed!</h3>
        <p>Player: <a href="${playlistUrl}" target="_blank">${playlistUrl}</a></p>
        <iframe src="/player.html?key=${jobId}" />
    `);
  } catch (err) {
    console.error(err);
    fsp.unlink(inputFile.path).catch(() => {});
    res.status(500).send("FFmpeg error:\n" + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/ to upload`);
});
