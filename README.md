# TikTok CDN Video Encryption Demo

## About
A small demo inspired by the article  
👉 [Các web phim đã giảm chi phí bằng TikTok như thế nào?](https://voz.vn/t/cac-web-phim-%C4%90a-giam-chi-phi-bang-tiktok-nhu-the-nao.913788)

This project shows how a normal video can be **converted to HLS**, **encrypted with AES-128**, then **embedded into PNG files** that can be uploaded to TikTok — using TikTok’s CDN as a fast, global content delivery layer.

How it works:
- Video is re-encoded with FFmpeg → split into `.ts` segments → `.m3u8` playlist.
- Each segment is AES-encrypted, then wrapped inside valid PNG files.
- These PNGs can be served directly (even via TikTok CDN) and decrypted in the player.
- The player reads the disguised PNGs, extracts, decrypts, and streams the video.

This is purely for **educational and research** purposes.

---

## Run
1. Copy the example config and edit values:
```bash
cp config.json.example config.json
# edit config.json
```
2. Build & run with Docker Compose:
```bash
docker compose up -d
```

Then open: [http://localhost:3000](http://localhost:3000)

Upload a video, run the conversion, inspect generated files (playlist, segments, PNGs), and try playback.

## Disclaimer
This project is for learning only.
Do not use it to bypass bandwidth or CDN limitations on third-party platforms.
