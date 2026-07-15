import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5186);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".wasm":"application/wasm", ".task":"application/octet-stream" };
const headers = {
  "Cache-Control":"no-store",
  "Content-Security-Policy":"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'",
  "Permissions-Policy":"camera=(self), microphone=()",
  "X-Content-Type-Options":"nosniff"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const relative = normalize(decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1))).replace(/^(\.\.[\\/])+/, "");
    const path = join(root, relative);
    if (!path.startsWith(root)) throw new Error("forbidden");
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not file");
    res.writeHead(200, { ...headers, "Content-Type": types[extname(path)] || "application/octet-stream", "Content-Length": info.size });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { ...headers, "Content-Type":"text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, host, () => console.log(`Fold to Face: http://${host}:${port}`));
