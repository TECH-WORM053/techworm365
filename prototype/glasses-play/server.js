// Glasses Play — 정적 파일 서버 (API 없음, 비용 0원)
// 웹캠(getUserMedia)은 localhost에서만 허용되므로 이 서버로 페이지를 엽니다.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3838;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.join(__dirname, "public", path.normalize(relative));
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  GLASSES PLAY — 모션트래킹 선글라스 장난감");
  console.log(`  → 브라우저에서 열기: http://localhost:${PORT}`);
  console.log("  (API 호출 없음 — 전부 브라우저 안에서 작동)");
  console.log("");
});
