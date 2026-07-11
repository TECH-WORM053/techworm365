import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    const timeout = setTimeout(() => reject(new Error("테스트 서버 시작 시간 초과")), 5000);
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

try {
  await waitForServer(server);

  const [pageResponse, cssResponse, scriptResponse, missingResponse] = await Promise.all([
    fetch(`${origin}/`),
    fetch(`${origin}/styles.css`),
    fetch(`${origin}/app.js`),
    fetch(`${origin}/does-not-exist`),
  ]);

  assert.equal(pageResponse.status, 200, "첫 화면은 200이어야 합니다.");
  assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html/, "HTML MIME이 필요합니다.");
  assert.match(pageResponse.headers.get("content-security-policy") ?? "", /camera|default-src|'self'/, "보안 정책이 필요합니다.");
  assert.equal(cssResponse.status, 200, "CSS를 불러올 수 있어야 합니다.");
  assert.match(cssResponse.headers.get("content-type") ?? "", /^text\/css/, "CSS MIME이 필요합니다.");
  assert.equal(scriptResponse.status, 200, "JavaScript를 불러올 수 있어야 합니다.");
  assert.match(scriptResponse.headers.get("content-type") ?? "", /^text\/javascript/, "JavaScript MIME이 필요합니다.");
  assert.equal(missingResponse.status, 404, "없는 경로는 404여야 합니다.");

  const html = await pageResponse.text();
  const appSource = await readFile(new URL("./app.js", import.meta.url), "utf8");
  const expectedScreens = ["intro", "consent", "capture", "interpret", "transform", "result"];

  for (const screen of expectedScreens) {
    assert.match(html, new RegExp(`data-screen=["']${screen}["']`), `${screen} 화면이 필요합니다.`);
  }

  assert.match(html, /id="consent-checkbox"/, "명시적 동의 입력이 필요합니다.");
  assert.match(html, /id="camera-video"/, "카메라 요소가 필요합니다.");
  assert.match(html, /data-action="switch-camera"/, "전면·후면 카메라 전환이 필요합니다.");
  assert.match(html, /id="phone-user-input"[\s\S]*capture="user"/, "휴대폰 전면 촬영 입력이 필요합니다.");
  assert.match(html, /id="phone-environment-input"[\s\S]*capture="environment"/, "휴대폰 후면 촬영 입력이 필요합니다.");
  assert.match(html, /id="distance-slider"/, "낯섦 조절 입력이 필요합니다.");
  assert.match(html, /connect-src 'none'/, "정적 배포에서도 외부 연결을 차단해야 합니다.");
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, "외부 스크립트를 사용하지 않아야 합니다.");
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:\/\//i, "외부 스타일을 사용하지 않아야 합니다.");
  assert.doesNotMatch(appSource, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/, "앱에서 외부 전송을 시작하지 않아야 합니다.");
  assert.doesNotMatch(appSource, /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, "브라우저 저장소를 사용하지 않아야 합니다.");

  console.log("✓ 서버와 정적 자산 응답");
  console.log("✓ 6단계 화면 구조");
  console.log("✓ 동의·카메라·낯섦 컨트롤");
  console.log("✓ 휴대폰 전면·후면 촬영 경로");
  console.log("✓ 외부 전송 및 브라우저 저장소 코드 없음");
  console.log("Smoke test passed.");
} finally {
  server.kill();
}
