// 정적 서버 — AI Mirror v2 확인용
//
//   node serve.mjs            → http://localhost:5180 (PC 확인)
//   node serve.mjs --lan      → 같은 와이파이의 휴대폰에서 접속 (HTTP: 실시간 카메라 제한)
//   node serve.mjs --lan (+ key.pem/cert.pem 존재 시) → HTTPS로 열림 → 휴대폰 실시간 카메라 가능
//
// HTTPS 인증서 만들기 (Git Bash에서, 이 폴더 기준):
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "//CN=localhost"
// 휴대폰 브라우저의 "안전하지 않음" 경고는 자체 서명 인증서라 뜨는 것으로, '계속'을 누르면 됩니다.

import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 5180;
const LAN = process.argv.includes("--lan");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
};

async function handler(req, res) {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    console.log(new Date().toISOString().slice(11, 19), req.method, urlPath);
    let filePath = normalize(join(ROOT, urlPath === "/" ? "index.html" : urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not Found");
  }
}

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) {
        return ni.address;
      }
    }
  }
  return null;
}

const useHttps = existsSync(join(ROOT, "key.pem")) && existsSync(join(ROOT, "cert.pem"));
const server = useHttps
  ? https.createServer(
      {
        key: await readFile(join(ROOT, "key.pem")),
        cert: await readFile(join(ROOT, "cert.pem")),
      },
      handler
    )
  : http.createServer(handler);

const host = LAN ? "0.0.0.0" : "127.0.0.1";
const proto = useHttps ? "https" : "http";

server.listen(PORT, host, () => {
  console.log(`AI Mirror v2`);
  console.log(`  PC:    ${proto}://localhost:${PORT}`);
  if (LAN) {
    const ip = lanAddress();
    if (ip) {
      console.log(`  Phone: ${proto}://${ip}:${PORT}  (같은 와이파이)`);
      if (!useHttps) {
        console.log(`  참고: HTTP에서는 휴대폰 실시간 카메라가 열리지 않습니다.`);
        console.log(`        key.pem/cert.pem을 만들면 자동으로 HTTPS로 전환됩니다. (파일 상단 주석 참고)`);
      }
    } else {
      console.log(`  사설 IP를 찾지 못해 localhost 전용으로 실행합니다.`);
    }
  }
});
