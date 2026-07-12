// AI Mirror 프로토타입 v0.2 — 화면 동작
// 흐름: 동의 → 카메라 → (자동) 얼굴 감지 + 잠시 정지 → 촬영 → 해석 →
//       배경이 무드에 맞게 변환 + 왼쪽 위에 추천 아이템 목록 표시
//
// 시각 인식(얼굴 감지, 사람/배경 분리)은 구글의 무료 라이브러리 MediaPipe를
// 브라우저 안에서 실행합니다. 이 부분은 인터넷 연결이 필요합니다.
// 로드에 실패하면 수동 [읽기] 버튼 모드로 자동 전환됩니다.

const $ = (id) => document.getElementById(id);

const consentScreen = $("consent");
const mirrorScreen = $("mirror");
const video = $("video");
const stage = $("stage");
const modeBadge = $("mode-badge");
const hintEl = $("hint");
const ringEl = $("ring");
const ringFill = ringEl.querySelector(".ring-fill");
const readingEl = $("reading");
const resultEl = $("result");
const recoEl = $("reco");
const recoList = $("reco-list");
const mirrorError = $("mirror-error");
const btnStart = $("btn-start");
const btnRead = $("btn-read");
const btnAgain = $("btn-again");

// ─── 조절할 수 있는 값들 ────────────────────────────────
const HOLD_MS = 2000;          // 이 시간 동안 정지해 있으면 촬영
const MOVE_TOLERANCE = 0.07;   // 얼굴 중심이 이만큼(화면 대비 비율) 움직이면 정지 취소
const ABSENT_RESET_MS = 7000;  // 결과 화면에서 사람이 사라진 뒤 처음으로 돌아가는 시간
const MAX_EDGE = 800;          // 전송 사진의 긴 변 최대 픽셀
const STAGE_MAX_W = 960;       // 캔버스 내부 해상도 (성능용)
const SEG_W = 640;             // 사람/배경 분리 처리 해상도
const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const SEG_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
// ────────────────────────────────────────────────────────

// 무드별 대체 배경 (assets/backgrounds/{tone}.jpg 가 없을 때 그라데이션으로 대신)
const TONE_COLORS = {
  warm: ["#3a2114", "#8a5a2e", "#1a0d05"],
  cool: ["#0d1a2e", "#3a5a8a", "#050a14"],
  calm: ["#12201c", "#4a6a5e", "#060d0b"],
  vivid: ["#2e0d20", "#8a2e5a", "#140510"],
  mono: ["#1a1a1a", "#4a4a4a", "#0a0a0a"],
};

// 실제로 넣어둔 배경 파일과 무드 톤의 연결.
// 파일이 지정되지 않은 톤은 그라데이션으로 대체됩니다.
const BG_FILES = {
  mono: "배경1.png",   // 어두운 거울 복도 + 흰 네온
  vivid: "배경1.png",
  cool: "배경2.png",   // 차가운 파란 금속 터널
  calm: "배경2.png",
  // warm: (아직 없음 → 그라데이션)
};

// 상태: waiting(사람 기다림) → hold(정지 판정 중) → reading(해석 중) → result(결과)
let state = "consent";
let manualMode = false; // MediaPipe 로드 실패 시 true

let faceDetector = null;
let segmenter = null;
let catalogById = {};

let holdStart = 0;
let holdAnchor = null; // 정지 판정 기준이 되는 얼굴 중심 좌표
let lastFaceSeen = 0;
let resultTone = "mono";
let resultStart = 0;
let flashAlpha = 0;

const ctx = stage.getContext("2d");
const personCanvas = document.createElement("canvas");
const personCtx = personCanvas.getContext("2d", { willReadFrequently: false });
const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d");
let personReady = false;

const bgImages = {}; // tone → Image | null(없음 확인됨)
const bgGradients = {}; // tone → 미리 그린 그라데이션 캔버스

let particles = [];   // 떠다니는 빛 입자
let dotSprite = null; // 입자용 부드러운 점 스프라이트 (한 번만 그림)

// ══ 1. 동의 후 시작 ══════════════════════════════════════
btnStart.addEventListener("click", async () => {
  $("camera-error").classList.add("hidden");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise((r) => (video.onloadedmetadata = r));
    await video.play(); // 자동재생이 막히는 경우가 있어 명시적으로 재생
    setupStage();

    consentScreen.classList.remove("active");
    mirrorScreen.classList.add("active");

    loadCatalog();
    requestAnimationFrame(renderLoop);

    hintEl.textContent = "거울을 깨우는 중…";
    const visionOk = await loadVision();
    if (visionOk) {
      manualMode = false;
      hintEl.textContent = "거울 앞에 잠시 멈춰 서 주세요";
      setInterval(detectTick, 160);
    } else {
      manualMode = true;
      hintEl.textContent = "버튼을 누르면 읽습니다";
      btnRead.classList.remove("hidden");
    }
    state = "waiting";
  } catch (err) {
    const msg = $("camera-error");
    msg.textContent =
      err.name === "NotAllowedError"
        ? "카메라 권한이 거부되었습니다. 브라우저 주소창의 카메라 설정에서 허용해 주세요."
        : "카메라를 켤 수 없습니다: " + err.message;
    msg.classList.remove("hidden");
  }
});

btnRead.addEventListener("click", () => {
  if (state === "waiting") triggerCapture();
});

btnAgain.addEventListener("click", resetToWaiting);

// ══ 2. 시각 인식 준비 ════════════════════════════════════
async function loadVision() {
  try {
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);

    faceDetector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
    });
    segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    return true;
  } catch (err) {
    console.warn("[vision] MediaPipe 로드 실패 → 수동 모드로 전환:", err);
    return false;
  }
}

// ══ 3. 자동 인식 (얼굴 감지 + 정지 판정) ══════════════════
function detectTick() {
  if (!faceDetector || video.videoWidth === 0) return;
  if (state !== "waiting" && state !== "hold" && state !== "result") return;

  let detections = [];
  try {
    detections = faceDetector.detectForVideo(video, performance.now()).detections;
  } catch {
    return;
  }
  const face = detections[0];
  const now = performance.now();

  if (face) lastFaceSeen = now;

  if (state === "result") {
    // 사람이 자리를 뜨면 잠시 후 처음으로
    if (now - lastFaceSeen > ABSENT_RESET_MS) resetToWaiting();
    return;
  }

  if (!face) {
    if (state === "hold") cancelHold();
    return;
  }

  const box = face.boundingBox;
  const cx = (box.originX + box.width / 2) / video.videoWidth;
  const cy = (box.originY + box.height / 2) / video.videoHeight;

  if (state === "waiting") {
    state = "hold";
    holdStart = now;
    holdAnchor = { cx, cy };
    hintEl.textContent = "그대로 잠시만요";
    ringEl.classList.remove("hidden");
    return;
  }

  // hold: 움직였으면 다시 시작, 버텼으면 촬영
  const moved = Math.hypot(cx - holdAnchor.cx, cy - holdAnchor.cy) > MOVE_TOLERANCE;
  if (moved) {
    holdStart = now;
    holdAnchor = { cx, cy };
  }
  const progress = Math.min((now - holdStart) / HOLD_MS, 1);
  ringFill.style.setProperty("--p", Math.round(progress * 100));
  if (progress >= 1) triggerCapture();
}

function cancelHold() {
  state = "waiting";
  ringEl.classList.add("hidden");
  ringFill.style.setProperty("--p", 0);
  hintEl.textContent = manualMode ? "버튼을 누르면 읽습니다" : "거울 앞에 잠시 멈춰 서 주세요";
}

// ══ 4. 촬영 → 해석 요청 ══════════════════════════════════
async function triggerCapture() {
  if (state === "reading" || state === "result") return;
  state = "reading";

  ringEl.classList.add("hidden");
  ringFill.style.setProperty("--p", 0);
  hintEl.classList.add("hidden");
  btnRead.classList.add("hidden");
  hide(resultEl, mirrorError, recoEl);

  flashAlpha = 1; // 렌더 루프에서 서서히 사라지는 플래시
  const photo = capturePhoto();
  show(readingEl);
  const t0 = performance.now();

  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(photo),
    });
    const data = await res.json();
    const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);
    hide(readingEl);

    if (data.error) {
      mirrorError.textContent = data.error;
      show(mirrorError, btnAgain);
      state = "waiting";
      hintEl.classList.remove("hidden");
    } else {
      showResult(data, elapsedSec);
    }
  } catch {
    hide(readingEl);
    mirrorError.textContent = "서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.";
    show(mirrorError, btnAgain);
    state = "waiting";
    hintEl.classList.remove("hidden");
  }
}

function capturePhoto() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  const c = document.createElement("canvas");
  c.width = Math.round(vw * scale);
  c.height = Math.round(vh * scale);
  const cctx = c.getContext("2d");
  cctx.translate(c.width, 0);
  cctx.scale(-1, 1); // 화면과 똑같이 좌우 반전된 모습으로 캡처
  cctx.drawImage(video, 0, 0, c.width, c.height);
  return { image: c.toDataURL("image/jpeg", 0.85).split(",")[1], media_type: "image/jpeg" };
}

// ══ 5. 결과 표시 (배경 변환 + 추천 목록) ══════════════════
function showResult(data, elapsedSec) {
  const r = data.result;
  resultTone = r.mood_tone || "mono";
  resultStart = performance.now();
  lastFaceSeen = performance.now();
  loadBackground(resultTone);
  initParticles();

  $("result-mood").textContent = r.mood_word;
  $("result-sentence").textContent = r.sentence;
  $("result-anchor").textContent = r.anchor;
  $("result-meta").textContent = `해석까지 ${elapsedSec}초`;

  renderRecommendations(r.recommendations || []);

  if (data.mode === "demo") {
    modeBadge.textContent = "DEMO MODE — 실제 AI 해석이 아닌 예시입니다";
    show(modeBadge);
  } else {
    hide(modeBadge);
  }

  // 실험 기록용: 브라우저 콘솔(F12)에서 확인 가능
  console.log("[실험 기록]", {
    시각: new Date().toISOString(),
    모드: data.mode,
    전체_소요_초: Number(elapsedSec),
    API_소요_초: data.api_ms ? +(data.api_ms / 1000).toFixed(1) : null,
    결과: r,
  });

  state = "result";
  show(resultEl, recoEl, btnAgain);
}

function renderRecommendations(ids) {
  recoList.innerHTML = "";
  ids.slice(0, 3).forEach((id) => {
    const p = catalogById[id];
    if (!p) return;
    const li = document.createElement("li");
    li.className = "reco-item";

    const img = document.createElement("img");
    img.className = "reco-thumb";
    img.alt = p.name;
    img.src = p.image;
    img.onerror = () => {
      // 제품 이미지가 아직 없으면 모노그램으로 대체
      const fb = document.createElement("div");
      fb.className = "reco-thumb-fallback";
      fb.textContent = p.name.charAt(0);
      img.replaceWith(fb);
    };

    const info = document.createElement("div");
    info.className = "reco-info";
    const name = document.createElement("p");
    name.className = "reco-name";
    name.textContent = p.name;
    const frame = document.createElement("p");
    frame.className = "reco-frame";
    frame.textContent = p.frame;
    info.append(name, frame);

    li.append(img, info);
    recoList.append(li);
  });
}

function resetToWaiting() {
  state = "waiting";
  hide(resultEl, recoEl, mirrorError, btnAgain, modeBadge);
  hintEl.classList.remove("hidden");
  hintEl.textContent = manualMode ? "버튼을 누르면 읽습니다" : "거울 앞에 잠시 멈춰 서 주세요";
  if (manualMode) btnRead.classList.remove("hidden");
  personReady = false;
}

// ══ 6. 그리기 (매 프레임) ════════════════════════════════
function setupStage() {
  const scale = Math.min(1, STAGE_MAX_W / video.videoWidth);
  stage.width = Math.round(video.videoWidth * scale);
  stage.height = Math.round(video.videoHeight * scale);
  personCanvas.width = SEG_W;
  personCanvas.height = Math.round(SEG_W * (video.videoHeight / video.videoWidth));
  maskCanvas.width = personCanvas.width;
  maskCanvas.height = personCanvas.height;
}

let segBusy = false;
let frameCount = 0;

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (video.videoWidth === 0) return;
  frameCount += 1;

  if (state === "result" && segmenter) {
    if (!segBusy && frameCount % 2 === 0) updatePersonLayer();
    drawTransformed();
  } else {
    drawMirror();
  }

  // 촬영 플래시
  if (flashAlpha > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
    ctx.fillRect(0, 0, stage.width, stage.height);
    flashAlpha *= 0.85;
  }
}

function drawMirror() {
  ctx.save();
  ctx.translate(stage.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, stage.width, stage.height);
  ctx.restore();

  if (state === "reading") {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, stage.width, stage.height);
  }
}

function drawTransformed() {
  const t = (performance.now() - resultStart) / 1000; // 결과 표시 후 경과 초

  // ① 배경 — 숨쉬듯 천천히 확대·축소 + 미세한 흔들림 ("살아있는" 느낌의 핵심)
  const breathe = 1.06 + Math.sin(t * 0.30) * 0.04;   // 1.02 ~ 1.10 배율
  const swayX = Math.sin(t * 0.18) * stage.width * 0.008;
  const swayY = Math.cos(t * 0.23) * stage.height * 0.006;
  const bg = bgImages[resultTone];

  ctx.save();
  ctx.translate(stage.width / 2 + swayX, stage.height / 2 + swayY);
  ctx.scale(breathe, breathe);
  ctx.translate(-stage.width / 2, -stage.height / 2);
  if (bg) drawCover(bg, bg.naturalWidth, bg.naturalHeight);
  else ctx.drawImage(getGradient(resultTone), 0, 0, stage.width, stage.height);
  ctx.restore();

  // ② 소실점 부근에서 빛이 천천히 번지고 잦아드는 맥동
  const pulse = 0.14 + (Math.sin(t * 0.7) * 0.5 + 0.5) * 0.18;
  const bloom = ctx.createRadialGradient(
    stage.width / 2, stage.height * 0.46, 0,
    stage.width / 2, stage.height * 0.46, stage.height * 0.6,
  );
  bloom.addColorStop(0, `rgba(255,255,255,${pulse})`);
  bloom.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, stage.width, stage.height);
  ctx.globalCompositeOperation = "source-over";

  // ③ 사람 (분리된 레이어, 거울 반전) — 실시간이라 그 자체로 살아 있음
  if (personReady) {
    ctx.save();
    ctx.translate(stage.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(personCanvas, 0, 0, stage.width, stage.height);
    ctx.restore();
  } else {
    // 분리가 아직 안 됐으면 영상 전체를 반투명하게라도 유지
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(stage.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, stage.width, stage.height);
    ctx.restore();
  }

  // ④ 무드 색보정 — 인물과 배경을 하나의 톤으로 묶어줌
  const grade = (TONE_COLORS[resultTone] || TONE_COLORS.mono)[1];
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, stage.width, stage.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // ⑤ 가장자리 비네트
  const vg = ctx.createRadialGradient(
    stage.width / 2, stage.height / 2, stage.height * 0.35,
    stage.width / 2, stage.height / 2, stage.height * 0.85,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, stage.width, stage.height);

  // ⑥ 공중에 떠다니는 빛 입자
  drawParticles(t);
}

function drawCover(img, iw, ih) {
  // 흔들림·확대 때 가장자리가 드러나지 않도록 3% 여유를 두고 채움
  const scale = Math.max(stage.width / iw, stage.height / ih) * 1.03;
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(img, (stage.width - w) / 2, (stage.height - h) / 2, w, h);
}

// ── 빛 입자 ──────────────────────────────────────────────
function makeDotSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, "rgba(255,255,255,0.95)");
  rg.addColorStop(0.4, "rgba(255,255,255,0.35)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 32, 32);
  return c;
}

function initParticles() {
  particles = [];
  for (let i = 0; i < 46; i++) {
    const z = 0.3 + Math.random() * 0.7; // 깊이감: 클수록 앞(크고 밝고 빠름)
    particles.push({
      x: Math.random(),
      baseY: Math.random(),
      z,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.2 + Math.random() * 0.4,
      speed: 0.0004 + z * 0.0009,
    });
  }
}

function drawParticles(t) {
  if (!dotSprite) dotSprite = makeDotSprite();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    p.baseY -= p.speed;
    if (p.baseY < -0.06) {
      p.baseY = 1.06;
      p.x = Math.random();
    }
    const x = (p.x + Math.sin(t * p.swaySpeed + p.sway) * 0.02 * p.z) * stage.width;
    const y = p.baseY * stage.height;
    const size = 3 + p.z * 11;
    ctx.globalAlpha = 0.06 + p.z * 0.22;
    ctx.drawImage(dotSprite, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function updatePersonLayer() {
  segBusy = true;
  personCtx.globalCompositeOperation = "source-over";
  personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
  try {
    segmenter.segmentForVideo(personCanvas, performance.now(), (result) => {
      const masks = result.confidenceMasks;
      const mask = masks[masks.length - 1]; // 마지막 마스크 = 사람 확률
      const data = mask.getAsFloat32Array();
      const img = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
      for (let i = 0; i < data.length; i++) {
        img.data[i * 4 + 3] = data[i] * 255; // 확률을 투명도로
      }
      maskCtx.putImageData(img, 0, 0);
      personCtx.globalCompositeOperation = "destination-in";
      personCtx.drawImage(maskCanvas, 0, 0);
      personCtx.globalCompositeOperation = "source-over";
      personReady = true;
      segBusy = false;
    });
  } catch {
    segBusy = false;
  }
}

// ══ 7. 배경 이미지 / 그라데이션 준비 ══════════════════════
function loadBackground(tone) {
  if (tone in bgImages) return; // 이미 시도함 (성공이든 실패든)
  const file = BG_FILES[tone];
  if (!file) {
    bgImages[tone] = null; // 파일 지정 없음 → 그라데이션 사용
    return;
  }
  const img = new Image();
  img.onload = () => (bgImages[tone] = img);
  img.onerror = () => (bgImages[tone] = null);
  img.src = `assets/backgrounds/${encodeURIComponent(file)}`;
}

function getGradient(tone) {
  if (bgGradients[tone]) return bgGradients[tone];
  const [mid, hi, lo] = TONE_COLORS[tone] || TONE_COLORS.mono;
  const c = document.createElement("canvas");
  c.width = stage.width;
  c.height = stage.height;
  const g = c.getContext("2d");
  const lin = g.createLinearGradient(0, 0, 0, c.height);
  lin.addColorStop(0, lo);
  lin.addColorStop(0.55, mid);
  lin.addColorStop(1, lo);
  g.fillStyle = lin;
  g.fillRect(0, 0, c.width, c.height);
  const glow = g.createRadialGradient(
    c.width / 2, c.height * 0.42, 10,
    c.width / 2, c.height * 0.42, c.height * 0.7,
  );
  glow.addColorStop(0, hi + "55");
  glow.addColorStop(1, "transparent");
  g.fillStyle = glow;
  g.fillRect(0, 0, c.width, c.height);
  bgGradients[tone] = c;
  return c;
}

// ══ 8. 기타 ══════════════════════════════════════════════
async function loadCatalog() {
  try {
    const res = await fetch("catalog.json");
    const data = await res.json();
    data.products.forEach((p) => (catalogById[p.id] = p));
  } catch {
    console.warn("[catalog] catalog.json을 불러오지 못했습니다.");
  }
}

function show(...els) { els.forEach((el) => el.classList.remove("hidden")); }
function hide(...els) { els.forEach((el) => el.classList.add("hidden")); }

// 테스트/디버그용 훅 (콘솔에서 __mirror.capture() 등으로 호출 가능)
window.__mirror = {
  capture: triggerCapture,
  reset: resetToWaiting,
  state: () => state,
  // 테스트용: 사람이 계속 서 있는 것처럼 자리 비움 복귀를 막음
  keepAlive: () => setInterval(() => (lastFaceSeen = performance.now()), 1000),
};
