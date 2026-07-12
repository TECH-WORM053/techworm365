// Glasses Play — 모션트래킹 선글라스 장난감
//
// 제스처 매핑 (사용자 설계):
//   🙌 두 손을 모으고/벌리고  → 코 브릿지가 접힘/펴짐
//   ✌️ 한 손 검지·약지 오므리고/펴고 → 다리(템플)가 접힘/펴짐
//   🤏 엄지+검지로 집어서 얼굴로 가져가면 → 착용 (다시 집으면 벗기)
//
// 손 추적(MediaPipe Hand Landmarker)과 얼굴 추적(Face Landmarker)은
// 전부 브라우저 안에서 실행됩니다. 영상은 밖으로 나가지 않습니다.

const $ = (id) => document.getElementById(id);

const introScreen = $("intro");
const playScreen = $("play");
const video = $("video");
const stage = $("stage");
const statusEl = $("status");
const btnStart = $("btn-start");
const btnReset = $("btn-reset");

const ctx = stage.getContext("2d");

// ─── 조절할 수 있는 값들 ────────────────────────────────
const STAGE_MAX_W = 1280;
// 집기(엄지↔검지) 판정 — 오발동을 막기 위해 3단계로 나눔
const PINCH_ON = 0.26;         // 이보다 가까워야 '집기 시작' (강하게 붙여야 함)
const PINCH_OFF = 0.45;        // 잡은 뒤엔 이보다 벌어져야 '놓기' (히스테리시스)
const NOT_PINCHING = 0.35;     // 이보다 벌어져 있어야 브릿지/다리 제스처로 인정
const GRAB_TICKS = 3;          // 연속 이만큼 감지돼야 잡기/놓기 확정 (~0.2초)
const BRIDGE_NEAR = 0.14;      // 두 손 거리(화면 비율) — 이보다 가까우면 완전 접힘
const BRIDGE_FAR = 0.44;       //                        — 이보다 멀면 완전 펴짐
const TEMPLE_CLOSED = 0.35;    // 검지-약지 거리/손 크기 — 이보다 작으면 다리 접힘
const TEMPLE_OPEN = 1.05;      //                        — 이보다 크면 다리 펴짐
const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

// 선글라스 치수 (유닛 좌표 — scale을 곱해 화면에 그림)
const GAP = 14;       // 브릿지 절반 폭
const HALF_W = 110;   // 렌즈+림 절반 폭
const LENS_H = 74;    // 렌즈 높이
const TEMPLE_L = 128; // 다리 길이
const FULL_W = 2 * (GAP + HALF_W); // 전체 폭 = 248
// ────────────────────────────────────────────────────────

let handLandmarker = null;
let faceLandmarker = null;

// 선글라스 상태
const glasses = {
  x: 0, y: 0, scale: 1, rot: 0,
  bridge: 0, temple: 0,            // 0 = 펴짐, 1 = 접힘 (현재 표시값)
  targetBridge: 0, targetTemple: 0, // 제스처가 정하는 목표값
  worn: false, grabbed: false,
  homeX: 0, homeY: 0, homeScale: 1,
};

let lastStatus = "";
let faceInfo = null; // { anchorX, anchorY, width, rot } — 최근 얼굴 정보

// 인식은 무거우므로 주기를 나눔 (렌더링은 매 프레임, 인식은 아래 간격)
const HAND_INTERVAL_MS = 66;   // 손: 초당 ~15회
const FACE_INTERVAL_MS = 50;   // 얼굴: 초당 ~20회 (착용 시 잘 따라오도록)
let lastHandTime = 0;
let lastFaceTime = 0;
let cachedHands = [];
let grabTicks = 0;    // 집기 연속 감지 카운터
let releaseTicks = 0; // 놓기 연속 감지 카운터

// ══ 1. 시작 ══════════════════════════════════════════════
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

    const scale = Math.min(1, STAGE_MAX_W / video.videoWidth);
    stage.width = Math.round(video.videoWidth * scale);
    stage.height = Math.round(video.videoHeight * scale);

    // 선글라스 시작 위치: 화면 가운데 위쪽에 떠 있음
    glasses.homeX = stage.width / 2;
    glasses.homeY = stage.height * 0.32;
    glasses.homeScale = (stage.width * 0.28) / FULL_W;
    resetGlasses();

    introScreen.classList.remove("active");
    playScreen.classList.add("active");
    requestAnimationFrame(loop);

    setStatus("손 인식을 준비하는 중…");
    const ok = await loadVision();
    setStatus(ok ? "손을 화면에 보여주세요" : "손 인식 로드 실패 — 인터넷 연결을 확인해 주세요");
  } catch (err) {
    const msg = $("camera-error");
    msg.textContent =
      err.name === "NotAllowedError"
        ? "카메라 권한이 거부되었습니다. 브라우저 주소창의 카메라 설정에서 허용해 주세요."
        : "카메라를 켤 수 없습니다: " + err.message;
    msg.classList.remove("hidden");
  }
});

btnReset.addEventListener("click", resetGlasses);

function resetGlasses() {
  glasses.x = glasses.homeX;
  glasses.y = glasses.homeY;
  glasses.scale = glasses.homeScale;
  glasses.rot = 0;
  glasses.worn = false;
  glasses.grabbed = false;
}

async function loadVision() {
  try {
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
    faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    return true;
  } catch (err) {
    console.warn("[vision] 로드 실패:", err);
    return false;
  }
}

// ══ 2. 메인 루프 ═════════════════════════════════════════
function loop() {
  requestAnimationFrame(loop);
  if (video.videoWidth === 0) return;

  const now = performance.now();
  if (now - lastHandTime >= HAND_INTERVAL_MS) {
    lastHandTime = now;
    cachedHands = trackHands();
    applyGestures(cachedHands);
  }
  if (now - lastFaceTime >= FACE_INTERVAL_MS) {
    lastFaceTime = now;
    trackFace();
  }
  updateGlasses();

  drawFrame(cachedHands);
}

// 좌우 반전(거울) 좌표 변환: MediaPipe 정규 좌표 → 화면 픽셀
function toScreen(lm) {
  return { x: (1 - lm.x) * stage.width, y: lm.y * stage.height };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ══ 3. 손 추적 + 해석 ════════════════════════════════════
function trackHands() {
  if (!handLandmarker) return [];
  let result;
  try {
    result = handLandmarker.detectForVideo(video, performance.now());
  } catch {
    return [];
  }
  let hands = result.landmarks.map((lm) => {
    const pts = lm.map(toScreen);
    const size = dist(pts[0], pts[9]) || 1; // 손목→중지 뿌리 = 손 크기 기준
    return {
      pts,
      size,
      center: pts[9],
      pinchRatio: dist(pts[4], pts[8]) / size, // 엄지 끝 ↔ 검지 끝 (작을수록 집는 중)
      pinchPoint: { x: (pts[4].x + pts[8].x) / 2, y: (pts[4].y + pts[8].y) / 2 },
      spread: dist(pts[8], pts[16]) / size, // 검지 끝 ↔ 약지 끝 (다리 조절용)
    };
  });

  // 같은 손이 두 개로 겹쳐 인식되는 오류 제거 (한 손인데 브릿지가 접히는 버그 원인)
  if (hands.length === 2) {
    const d = dist(hands[0].center, hands[1].center);
    const ref = Math.max(hands[0].size, hands[1].size) * 1.3;
    if (d < ref) {
      hands = [hands[0].size >= hands[1].size ? hands[0] : hands[1]];
    }
  }
  return hands;
}

function trackFace() {
  faceInfo = null;
  if (!faceLandmarker) return;
  let result;
  try {
    result = faceLandmarker.detectForVideo(video, performance.now());
  } catch {
    return;
  }
  const lm = result.faceLandmarks && result.faceLandmarks[0];
  if (!lm) return;
  const eyeL = toScreen(lm[33]);   // 눈 바깥쪽 두 점
  const eyeR = toScreen(lm[263]);
  const width = dist(eyeL, eyeR);
  faceInfo = {
    // 두 눈의 중간 지점 기준 — 고개를 돌려도 비교적 잘 따라옴
    anchorX: (eyeL.x + eyeR.x) / 2,
    anchorY: (eyeL.y + eyeR.y) / 2 + width * 0.10,
    width,
    rot: Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x),
  };
}

// ══ 4. 제스처 → 선글라스 조작 ════════════════════════════
function applyGestures(hands) {
  // ① 잡고 있는 중: 집은 손을 따라 이동 (놓기는 히스테리시스 + 연속 감지로 판정)
  if (glasses.grabbed) {
    const holder = hands
      .filter((h) => h.pinchRatio < PINCH_OFF)
      .sort((a, b) => dist(a.pinchPoint, glasses) - dist(b.pinchPoint, glasses))[0];
    if (holder) {
      releaseTicks = 0;
      glasses.x += (holder.pinchPoint.x - glasses.x) * 0.55;
      glasses.y += (holder.pinchPoint.y - glasses.y) * 0.55;
      setStatus(nearFace() ? "여기서 놓으면 착용! 🤏→😎" : "선글라스를 잡았어요 — 얼굴로 가져가 보세요");
    } else if (++releaseTicks >= GRAB_TICKS) {
      releaseTicks = 0;
      glasses.grabbed = false;
      if (nearFace()) {
        glasses.worn = true;
        setStatus("착용 완료 😎 — 다시 집으면 벗을 수 있어요");
      } else {
        setStatus("내려놓았어요 — 🙌 브릿지 · ✌️ 다리 · 🤏 잡기");
      }
    }
    return;
  }

  // ② 새로 집기 (착용 중이면 벗겨서 잡기)
  //    엄지+검지를 '확실히' 붙인 채 선글라스 위에서 잠깐 유지해야 잡힘 (오발동 방지)
  const grabRadius = (GAP + HALF_W) * glasses.scale + 20;
  const grabber = hands.find(
    (h) => h.pinchRatio < PINCH_ON && dist(h.pinchPoint, glasses) < grabRadius,
  );
  if (grabber) {
    if (++grabTicks >= GRAB_TICKS) {
      grabTicks = 0;
      glasses.grabbed = true;
      glasses.worn = false;
    } else {
      setStatus("집는 중… 🤏");
    }
    return;
  }
  grabTicks = 0;

  // 브릿지/다리 제스처는 엄지·검지가 충분히 벌어져 있을 때만 (집기와 충돌 방지)
  const openHands = hands.filter((h) => h.pinchRatio > NOT_PINCHING);

  // ③ 두 손: 브릿지 접기/펴기
  if (hands.length === 2 && openHands.length === 2) {
    const d = dist(hands[0].center, hands[1].center) / stage.width;
    const t = (d - BRIDGE_NEAR) / (BRIDGE_FAR - BRIDGE_NEAR);
    glasses.targetBridge = 1 - Math.min(1, Math.max(0, t));
    if (!glasses.worn) setStatus("🙌 두 손 간격 → 브릿지 " + foldLabel(glasses.targetBridge));
    return;
  }

  // ④ 한 손: 다리 접기/펴기 (검지·약지 간격)
  if (hands.length === 1 && openHands.length === 1) {
    const t = (hands[0].spread - TEMPLE_CLOSED) / (TEMPLE_OPEN - TEMPLE_CLOSED);
    glasses.targetTemple = 1 - Math.min(1, Math.max(0, t));
    if (!glasses.worn) setStatus("✌️ 검지·약지 간격 → 다리 " + foldLabel(glasses.targetTemple));
    return;
  }

  if (hands.length === 0 && handLandmarker) {
    setStatus(glasses.worn ? "착용 중 😎" : "손을 화면에 보여주세요 (손바닥이 카메라를 향하게)");
  }
}

function foldLabel(v) {
  return v > 0.75 ? "접힘" : v < 0.25 ? "펴짐" : "…";
}

function nearFace() {
  if (!faceInfo) return false;
  return (
    Math.hypot(glasses.x - faceInfo.anchorX, glasses.y - faceInfo.anchorY) <
    faceInfo.width * 0.8
  );
}

// ══ 5. 선글라스 상태 갱신 ════════════════════════════════
function updateGlasses() {
  // 착용 중: 얼굴에 붙어서 따라다님 + 자동으로 활짝 펴짐
  if (glasses.worn && faceInfo) {
    glasses.x += (faceInfo.anchorX - glasses.x) * 0.65;
    glasses.y += (faceInfo.anchorY - glasses.y) * 0.65;
    glasses.rot += (faceInfo.rot - glasses.rot) * 0.5;
    const wearScale = (faceInfo.width * 1.5) / FULL_W;
    glasses.scale += (wearScale - glasses.scale) * 0.45;
    glasses.targetBridge = 0;
    glasses.targetTemple = 0;
  } else if (!glasses.grabbed) {
    // 떠 있는 중: 살짝 숨쉬는 부유
    const t = performance.now() / 1000;
    glasses.y += Math.sin(t * 1.1) * 0.25;
    glasses.rot += (Math.sin(t * 0.6) * 0.03 - glasses.rot) * 0.05;
  }

  // 접힘 각도는 부드럽게 목표를 따라감
  glasses.bridge += (glasses.targetBridge - glasses.bridge) * 0.18;
  glasses.temple += (glasses.targetTemple - glasses.temple) * 0.18;
}

// ══ 6. 그리기 ════════════════════════════════════════════
function drawFrame(hands) {
  // 거울 영상
  ctx.save();
  ctx.translate(stage.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, stage.width, stage.height);
  ctx.restore();

  // 손 랜드마크 (은은한 점)
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (const h of hands) {
    for (const p of h.pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (h.pinchRatio < PINCH_ON) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.pinchPoint.x, h.pinchPoint.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 착용 안내: 잡은 채 얼굴 근처면 목표 지점 표시
  if (glasses.grabbed && faceInfo && nearFace()) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(faceInfo.anchorX, faceInfo.anchorY, faceInfo.width * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawGlasses();
}

function drawGlasses() {
  const g = glasses;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.rot);
  ctx.scale(g.scale, g.scale);

  // 떠 있을 때 아래 그림자
  if (!g.worn) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, LENS_H * 1.5, FULL_W * 0.38, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const cosB = Math.max(0.10, Math.cos(g.bridge * Math.PI * 0.46)); // 브릿지 접힘 → 폭 압축

  drawTemple(g, +1, cosB);
  drawTemple(g, -1, cosB);
  drawHalf(g, +1, cosB);
  drawHalf(g, -1, cosB);

  // 브릿지 (가운데 경첩)
  ctx.fillStyle = "#0c0c0c";
  roundRect(-GAP, -LENS_H * 0.30, GAP * 2, 13, 5);
  ctx.fill();

  ctx.restore();
}

// 앞면 절반 (렌즈 + 림). side: +1 오른쪽, -1 왼쪽
function drawHalf(g, side, cosB) {
  ctx.save();
  ctx.translate(side * GAP, 0);      // 안쪽 모서리(브릿지 경첩) 기준
  ctx.scale(side * cosB, 1);         // 좌우 미러 + 접힘 압축 (+x로 그림)

  // 렌즈
  const grad = ctx.createLinearGradient(0, -LENS_H / 2, HALF_W, LENS_H / 2);
  grad.addColorStop(0, "rgba(30,30,38,0.92)");
  grad.addColorStop(0.5, "rgba(15,15,20,0.88)");
  grad.addColorStop(1, "rgba(55,55,68,0.85)");
  roundRect(0, -LENS_H / 2, HALF_W, LENS_H, 30);
  ctx.fillStyle = grad;
  ctx.fill();

  // 림 (프레임)
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#0c0c0c";
  ctx.stroke();

  // 렌즈 하이라이트 (비스듬한 빛 줄)
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(HALF_W * 0.18, -LENS_H / 2);
  ctx.lineTo(HALF_W * 0.42, -LENS_H / 2);
  ctx.lineTo(HALF_W * 0.14, LENS_H / 2);
  ctx.lineTo(-HALF_W * 0.1, LENS_H / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// 다리 (템플). temple 0 = 바깥으로 펴짐(원근 단축), 1 = 안쪽으로 접혀 앞면 위에 눕는다
function drawTemple(g, side, cosB) {
  const hingeX = GAP + HALF_W * cosB; // 접힘에 따라 경첩 위치도 이동
  const hingeY = -LENS_H * 0.20;

  ctx.save();
  ctx.translate(side * hingeX, hingeY);
  ctx.scale(side, 1);                          // +x = 바깥쪽
  ctx.rotate(-g.temple * Math.PI);             // 위로 스윙하며 안쪽으로 접힘
  const len = TEMPLE_L * (0.34 + 0.66 * g.temple); // 펴질수록 원근 단축

  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#0c0c0c";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.85, 0);
  // 끝의 귀 걸이 곡선
  ctx.quadraticCurveTo(len * 1.0, 0, len * 0.98, 14);
  ctx.stroke();

  // 경첩 나사 포인트
  ctx.fillStyle = "#2a2a2a";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setStatus(text) {
  if (text === lastStatus) return;
  lastStatus = text;
  statusEl.textContent = text;
}

// 테스트/디버그용 훅 (콘솔에서 __play.set({bridge:1}) 등으로 조작 가능)
window.__play = {
  g: glasses,
  set: (props) => Object.assign(glasses, props),
  reset: resetGlasses,
};
