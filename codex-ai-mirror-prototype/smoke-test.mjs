import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const testPort = 5175;
const origin = `http://127.0.0.1:${testPort}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(testPort) },
  stdio: ["ignore", "pipe", "pipe"],
});

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("테스트 서버 시작 시간 초과")), 7000);
    const onData = (chunk) => {
      if (!chunk.toString().includes(origin)) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`테스트 서버 조기 종료: ${code}`));
    });
  });
}

const requiredAssets = [
  ["vendor/mediapipe/vision_bundle.mjs", 100_000],
  ["vendor/mediapipe/wasm/vision_wasm_internal.js", 250_000],
  ["vendor/mediapipe/wasm/vision_wasm_internal.wasm", 8_000_000],
  ["vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js", 250_000],
  ["vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm", 8_000_000],
  ["vendor/mediapipe/wasm/vision_wasm_module_internal.js", 250_000],
  ["vendor/mediapipe/wasm/vision_wasm_module_internal.wasm", 8_000_000],
  ["models/face_landmarker.task", 3_000_000],
  ["models/selfie_segmenter.tflite", 200_000],
  ["assets/products/papas-01.png", 500_000],
  ["assets/products/liliit-01.png", 500_000],
  ["assets/products/malta-01.png", 500_000],
];

try {
  await waitForServer(server);

  const [pageResponse, cssResponse, scriptResponse, wasmResponse, modelResponse, imageResponse, missingResponse] = await Promise.all([
    fetch(`${origin}/`),
    fetch(`${origin}/styles.css`),
    fetch(`${origin}/app.js`),
    fetch(`${origin}/vendor/mediapipe/wasm/vision_wasm_internal.wasm`),
    fetch(`${origin}/models/face_landmarker.task`),
    fetch(`${origin}/assets/products/papas-01.png`),
    fetch(`${origin}/does-not-exist`),
  ]);

  assert.equal(pageResponse.status, 200, "첫 화면은 200이어야 합니다.");
  assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html/, "HTML MIME이 필요합니다.");
  const headerCsp = pageResponse.headers.get("content-security-policy") ?? "";
  assert.match(headerCsp, /connect-src 'self'/, "로컬 모델 로드를 위한 same-origin 연결만 허용해야 합니다.");
  assert.match(headerCsp, /script-src 'self' 'wasm-unsafe-eval'/, "MediaPipe WASM 실행 정책이 필요합니다.");
  assert.match(headerCsp, /media-src 'self' blob:/, "카메라 MediaStream 정책이 필요합니다.");
  assert.match(pageResponse.headers.get("permissions-policy") ?? "", /camera=\(self\)/, "카메라 권한 정책이 필요합니다.");

  assert.equal(cssResponse.status, 200, "CSS를 불러올 수 있어야 합니다.");
  assert.match(cssResponse.headers.get("content-type") ?? "", /^text\/css/, "CSS MIME이 필요합니다.");
  assert.equal(scriptResponse.status, 200, "JavaScript를 불러올 수 있어야 합니다.");
  assert.match(scriptResponse.headers.get("content-type") ?? "", /^text\/javascript/, "JavaScript MIME이 필요합니다.");
  assert.equal(wasmResponse.status, 200, "MediaPipe WASM을 불러올 수 있어야 합니다.");
  assert.equal(wasmResponse.headers.get("content-type"), "application/wasm", "WASM MIME이 정확해야 합니다.");
  assert.ok((await wasmResponse.arrayBuffer()).byteLength > 8_000_000, "WASM 파일이 완전해야 합니다.");
  assert.equal(modelResponse.status, 200, "얼굴 추적 모델을 불러올 수 있어야 합니다.");
  assert.ok((await modelResponse.arrayBuffer()).byteLength > 3_000_000, "얼굴 추적 모델이 완전해야 합니다.");
  assert.equal(imageResponse.status, 200, "제품 이미지를 불러올 수 있어야 합니다.");
  assert.match(imageResponse.headers.get("content-type") ?? "", /^image\/png/, "제품 이미지 MIME이 필요합니다.");
  assert.ok((await imageResponse.arrayBuffer()).byteLength > 500_000, "제품 이미지가 완전해야 합니다.");
  assert.equal(missingResponse.status, 404, "없는 경로는 404여야 합니다.");

  const html = await pageResponse.text();
  const css = await cssResponse.text();
  const appSource = await readFile(new URL("./app.js", import.meta.url), "utf8");
  const visionSource = await readFile(new URL("./vision-engine.js", import.meta.url), "utf8");
  const catalogSource = await readFile(new URL("./catalog-data.js", import.meta.url), "utf8");

  assert.match(html, /id="screen-intro"/, "시작 화면이 필요합니다.");
  assert.match(html, /id="screen-live"/, "단일 라이브 미러 화면이 필요합니다.");
  assert.match(html, /id="camera-video"[^>]*autoplay[^>]*muted[^>]*playsinline/, "모바일 라이브 카메라 요소가 필요합니다.");
  assert.match(html, /id="scene-canvas"/, "실시간 합성 Canvas가 필요합니다.");
  assert.match(html, /id="product-list"/, "추천 TOP 3 목록이 필요합니다.");
  assert.match(html, /data-action="switch-camera"/, "전면·후면 카메라 전환이 필요합니다.");
  assert.match(html, /connect-src 'self'/, "정적 Pages에서도 로컬 모델만 불러와야 합니다.");
  assert.match(html, /'wasm-unsafe-eval'/, "정적 Pages의 WASM CSP가 필요합니다.");
  assert.doesNotMatch(html, /<input[^>]+type="file"/i, "사진 촬영·업로드 입력이 없어야 합니다.");
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, "외부 스크립트를 사용하지 않아야 합니다.");
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:\/\//i, "외부 스타일을 사용하지 않아야 합니다.");
  assert.doesNotMatch(css, /https?:\/\//i, "스타일에서 외부 자산을 사용하지 않아야 합니다.");

  assert.match(visionSource, /FaceLandmarker/, "실제 얼굴 랜드마크 모델을 사용해야 합니다.");
  assert.match(visionSource, /ImageSegmenter/, "실제 인물 분리 모델을 사용해야 합니다.");
  assert.match(visionSource, /detectForVideo/, "얼굴 추적은 연속 영상 모드여야 합니다.");
  assert.match(visionSource, /segmentForVideo/, "배경 분리는 연속 영상 모드여야 합니다.");
  assert.match(visionSource, /new URL\("\.\/models\//, "Pages 서브경로를 보존하는 모델 URL이 필요합니다.");
  assert.match(appSource, /requestAnimationFrame\(renderLoop\)/, "실시간 렌더 루프가 필요합니다.");
  assert.doesNotMatch(appSource, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/, "앱 코드가 프레임 전송을 시작하지 않아야 합니다.");
  assert.doesNotMatch(appSource, /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, "브라우저 저장소에 카메라 데이터를 기록하지 않아야 합니다.");
  assert.equal((catalogSource.match(/name: "/g) ?? []).length, 3, "프로토타입 추천 후보는 정확히 3개여야 합니다.");

  for (const [relativePath, minimumSize] of requiredAssets) {
    const details = await stat(new URL(`./${relativePath}`, import.meta.url));
    assert.ok(details.isFile(), `${relativePath} 파일이 필요합니다.`);
    assert.ok(details.size > minimumSize, `${relativePath} 파일 크기가 너무 작습니다.`);
  }

  console.log("✓ 라이브 카메라 단일 화면과 전·후면 전환");
  console.log("✓ FaceLandmarker + SelfieSegmenter 로컬 모델 자산");
  console.log("✓ WASM·모델·제품 이미지 응답 및 MIME");
  console.log("✓ EX2 선글라스 이미지·이름 TOP 3");
  console.log("✓ 사진 업로드·외부 프레임 전송·브라우저 저장 없음");
  console.log("Smoke test passed.");
} finally {
  server.kill();
}
