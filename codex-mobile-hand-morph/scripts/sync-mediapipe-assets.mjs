import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageWasm = fileURLToPath(new URL("../node_modules/@mediapipe/tasks-vision/wasm/", import.meta.url));
const publicWasm = fileURLToPath(new URL("../public/mediapipe/wasm/", import.meta.url));

await mkdir(publicWasm, { recursive: true });
await cp(packageWasm, publicWasm, { recursive: true, force: true });
