// AI Mirror v2 — 실시간 트래킹 + 주기적 해석 프로토타입
//
// 구조:
//   매 프레임(연속)  : MediaPipe 얼굴 트래킹 → 배경 이펙트가 얼굴을 따라 움직임
//   3초마다(주기적)  : analyzer가 얼굴형·무드·스타일 추정 → 팔레트·문구·추천 갱신
//
// analyzer는 지금 기기 내 근사 계산(localAnalyzer)이며,
// 이후 Claude API를 붙일 때 이 자리만 교체하면 됩니다. (analyzer.js 참고)

import {
  FaceLandmarker,
  FilesetResolver,
} from "./vendor/mediapipe/vision_bundle.mjs";

import { localAnalyzer } from "./analyzer.js";
import { recommend, pickPhrase, MOOD_PALETTES } from "./catalog.js";
import { Effects } from "./effects.js";

const ANALYZE_INTERVAL_MS = 3000;
const FACE_LOST_MS = 1500;

const $ = (id) => document.getElementById(id);

// ?debug — 로딩 단계를 서버 로그로 보냄 (문제 추적용, 평소엔 아무 동작 안 함)
const DEBUG = new URLSearchParams(location.search).has("debug");
const probe = (step) => { if (DEBUG) fetch(`/probe/${step}`).catch(() => {}); };
const video = $("video");
const fxCanvas = $("fx");

const state = {
  landmarker: null,
  stream: null,
  facingMode: "user",
  running: false,
  lastFrameTime: 0,
  lastFaceSeen: 0,
  lastAnalysis: 0,
  phraseIndex: 0,
  latest: null, // 최근 프레임의 { landmarks, blendshapes, faceBox }
  currentMood: null,
};

const effects = new Effects(fxCanvas);

// ---------- 카메라 ----------

async function openCamera() {
  stopCamera();
  const constraints = {
    audio: false,
    video: {
      facingMode: state.facingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = state.stream;
  video.classList.toggle("mirrored", state.facingMode === "user");
  await video.play();
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

// ---------- MediaPipe ----------

async function loadLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
  const options = (delegate) => ({
    baseOptions: {
      modelAssetPath: "./vendor/mediapipe/face_landmarker.task",
      delegate,
    },
    outputFaceBlendshapes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });

  // GPU 초기화가 기기에 따라 실패하거나 끝나지 않는 경우가 있어
  // 10초 안에 안 되면 CPU로 자동 전환
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("gpu-timeout")), 10000)
  );
  try {
    state.landmarker = await Promise.race([
      FaceLandmarker.createFromOptions(fileset, options("GPU")),
      timeout,
    ]);
  } catch {
    setStatus("호환 모드로 다시 준비하는 중…");
    state.landmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

function faceBoxFromLandmarks(landmarks) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

// ---------- 메인 루프 ----------

function loop(now) {
  if (!state.running) return;
  const dt = state.lastFrameTime ? now - state.lastFrameTime : 16;
  state.lastFrameTime = now;

  if (video.readyState >= 2 && state.landmarker) {
    const result = state.landmarker.detectForVideo(video, now);
    const landmarks = result.faceLandmarks && result.faceLandmarks[0];

    if (landmarks) {
      const blendshapes =
        (result.faceBlendshapes && result.faceBlendshapes[0]?.categories) || [];
      const faceBox = faceBoxFromLandmarks(landmarks);
      state.latest = { landmarks, blendshapes, faceBox };
      state.lastFaceSeen = now;

      // 전면 카메라는 화면이 좌우 반전되므로 이펙트 좌표도 뒤집는다
      const mirrored = state.facingMode === "user";
      effects.setFace({
        x: mirrored ? 1 - faceBox.x : faceBox.x,
        y: faceBox.y,
        w: faceBox.w,
        present: true,
      });

      if (now - state.lastAnalysis > ANALYZE_INTERVAL_MS) {
        state.lastAnalysis = now;
        runAnalysis();
      }
    } else if (now - state.lastFaceSeen > FACE_LOST_MS) {
      state.latest = null;
      effects.setFace({ x: 0.5, y: 0.5, w: 0.3, present: false });
      setStatus("거울 앞에 서 보세요");
    }
  }

  effects.render(dt);
  requestAnimationFrame(loop);
}

// ---------- 주기적 해석 ----------

function runAnalysis() {
  if (!state.latest) return;
  const analysis = localAnalyzer({ ...state.latest, video });

  $("hudShape").textContent = analysis.faceShape;
  $("hudMood").textContent = analysis.mood;
  $("hudStyle").textContent = analysis.style;
  setStatus("");

  if (analysis.mood !== state.currentMood) {
    state.currentMood = analysis.mood;
    effects.setPalette(MOOD_PALETTES[analysis.mood] || MOOD_PALETTES["차분한"]);
  }

  showPhrase(pickPhrase(analysis.mood, state.phraseIndex++));
  renderRecommendations(recommend(analysis));
}

function showPhrase(text) {
  const el = $("phrase");
  if (el.textContent === text) return;
  el.classList.add("fading");
  setTimeout(() => {
    el.textContent = text;
    el.classList.remove("fading", "hidden");
  }, 450);
}

// ---------- 추천 카드 ----------

const FRAME_ICONS = {
  round:
    '<svg viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#888" stroke-width="2"><circle cx="22" cy="26" r="11"/><circle cx="50" cy="26" r="11"/><path d="M33 24 q3 -3 6 0 M4 22 l7 1 M61 23 l7 -1"/></g></svg>',
  square:
    '<svg viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#888" stroke-width="2"><rect x="11" y="16" width="22" height="18" rx="3"/><rect x="39" y="16" width="22" height="18" rx="3"/><path d="M33 22 q3 -3 6 0 M4 20 l7 1 M61 21 l7 -1"/></g></svg>',
  dframe:
    '<svg viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#888" stroke-width="2"><path d="M11 18 h22 v10 a9 9 0 0 1 -9 9 h-4 a9 9 0 0 1 -9 -9 z"/><path d="M39 18 h22 v10 a9 9 0 0 1 -9 9 h-4 a9 9 0 0 1 -9 -9 z"/><path d="M33 23 q3 -3 6 0 M4 20 l7 1 M61 21 l7 -1"/></g></svg>',
  oversize:
    '<svg viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#888" stroke-width="2"><rect x="8" y="13" width="26" height="23" rx="6"/><rect x="38" y="13" width="26" height="23" rx="6"/><path d="M34 21 q2 -2 4 0 M2 19 l6 1 M64 20 l6 -1"/></g></svg>',
};

function renderRecommendations(items) {
  const list = $("recList");
  list.innerHTML = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "rec-card";

    const rank = document.createElement("div");
    rank.className = "rec-rank";
    rank.textContent = i + 1;

    // 공식 이미지가 assets/products/에 있으면 사용, 없으면 프레임 일러스트
    const img = document.createElement("img");
    img.className = "rec-img";
    img.alt = item.product.name;
    img.src = `assets/products/${item.product.id}.jpg`;
    img.onerror = () => {
      const holder = document.createElement("div");
      holder.className = "rec-img";
      holder.innerHTML = FRAME_ICONS[item.product.shape] || FRAME_ICONS.round;
      img.replaceWith(holder);
    };

    const info = document.createElement("div");
    info.className = "rec-info";
    const name = document.createElement("div");
    name.className = "rec-name";
    name.textContent = item.product.name;
    const reason = document.createElement("div");
    reason.className = "rec-reason";
    reason.textContent = item.reason;
    info.append(name, reason);

    li.append(rank, img, info);
    list.append(li);
  });
  $("recs").classList.remove("hidden");
}

// ---------- 상태·이벤트 ----------

function setStatus(text) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

function resizeCanvas() {
  fxCanvas.width = window.innerWidth;
  fxCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

$("startBtn").addEventListener("click", async () => {
  const btn = $("startBtn");
  btn.disabled = true;
  btn.textContent = "준비 중…";
  try {
    setStatus("모델을 내려받는 중… (첫 실행은 몇 초 걸립니다)");
    $("intro").querySelector(".privacy").after($("status"));
    $("status").classList.remove("hidden");
    probe("start-clicked");
    if (!state.landmarker) await loadLandmarker();
    probe("landmarker-ok");
    await openCamera();
    probe("camera-ok");

    $("intro").classList.add("hidden");
    document.body.append($("status"));
    setStatus("");
    $("hud").classList.remove("hidden");
    $("flipBtn").hidden = false;
    document.body.append($("flipBtn"));
    Object.assign($("flipBtn").style, {
      position: "absolute", top: "14px", right: "14px", zIndex: 6,
    });

    state.running = true;
    state.lastFrameTime = 0;
    requestAnimationFrame(loop);
  } catch (err) {
    probe("fail-" + encodeURIComponent(err.name + ":" + err.message).slice(0, 80));
    btn.disabled = false;
    btn.textContent = "거울 켜기";
    setStatus(
      err.name === "NotAllowedError"
        ? "카메라 권한이 필요합니다. 브라우저 설정에서 허용해 주세요."
        : `시작할 수 없습니다: ${err.message}`
    );
  }
});

$("flipBtn").addEventListener("click", async () => {
  state.facingMode = state.facingMode === "user" ? "environment" : "user";
  try {
    await openCamera();
  } catch {
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    await openCamera();
    setStatus("이 기기에서는 카메라 전환을 지원하지 않습니다");
  }
});

// ?autostart=1 — 자동 시작 (키오스크·테스트용)
if (new URLSearchParams(location.search).has("autostart")) {
  $("startBtn").click();
}

// 탭을 벗어나면 카메라 정지, 돌아오면 재개
document.addEventListener("visibilitychange", async () => {
  if (!state.running) return;
  if (document.hidden) {
    stopCamera();
  } else {
    try { await openCamera(); } catch { /* 사용자가 돌아와서 다시 시작 */ }
  }
});
