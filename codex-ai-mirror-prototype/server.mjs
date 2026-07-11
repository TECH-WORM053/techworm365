import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "5174", 10);
const lanRequested = process.argv.includes("--lan");
const ipv4Addresses = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address && !address.internal && (address.family === "IPv4" || address.family === 4))
  .map((address) => address.address);
const privateLanAddresses = ipv4Addresses.filter(isPrivateIpv4);
const host = process.env.HOST ?? (lanRequested && privateLanAddresses[0] ? privateLanAddresses[0] : "127.0.0.1");

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requestedFile = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const safeRelativePath = normalize(requestedFile).replace(/^(\.\.(\\|\/|$))+/, "");
    let filePath = join(root, safeRelativePath);

    if (!filePath.startsWith(root)) {
      response.writeHead(403, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    let fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      filePath = join(filePath, "index.html");
      fileStats = await stat(filePath);
    }

    if (!fileStats.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      ...securityHeaders,
      "Content-Length": fileStats.size,
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Codex Mirror Boundary Lab: http://127.0.0.1:${port}`);
  if (host !== "127.0.0.1") console.log(`Phone one-shot mode: http://${host}:${port}`);
  if (lanRequested && privateLanAddresses.length === 0) {
    console.log("No private Wi-Fi address found; LAN exposure was not enabled.");
  }
  console.log("Live phone camera requires the HTTPS Pages deployment.");
  console.log("Press Ctrl+C to stop.");
});
