// AI Mirror 프로토타입 — 화면 동작
// 흐름: 동의 → 카메라 켜기 → [읽기] → 3·2·1 촬영 → 서버로 전송 → 해석 문장 표시

const $ = (id) => document.getElementById(id);

const consentScreen = $("consent");
const mirrorScreen = $("mirror");
const video = $("video");
const canvas = $("capture-canvas");
const tint = $("tint");
const modeBadge = $("mode-badge");
const countdownEl = $("countdown");
const readingEl = $("reading");
const resultEl = $("result");
const mirrorError = $("mirror-error");
const btnStart = $("btn-start");
const btnRead = $("btn-read");
const btnAgain = $("btn-again");

const MAX_EDGE = 800; // 전송 사진의 긴 변 최대 픽셀 (작게 보내야 빠르고 저렴)

// ── 1. 동의 후 카메라 시작 ──────────────────────────────
btnStart.addEventListener("click", async () => {
  $("camera-error").classList.add("hidden");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    consentScreen.classList.remove("active");
    mirrorScreen.classList.add("active");
  } catch (err) {
    const msg = $("camera-error");
    msg.textContent =
      err.name === "NotAllowedError"
        ? "카메라 권한이 거부되었습니다. 브라우저 주소창의 카메라 설정에서 허용해 주세요."
        : "카메라를 켤 수 없습니다: " + err.message;
    msg.classList.remove("hidden");
  }
});

// ── 2. 읽기 버튼 → 카운트다운 → 촬영 → 해석 요청 ──────────
btnRead.addEventListener("click", async () => {
  btnRead.disabled = true;
  hide(resultEl, mirrorError, btnAgain);
  tint.classList.remove("on");

  await countdown(3);

  video.classList.add("flash");
  setTimeout(() => video.classList.remove("flash"), 400);
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
      show(mirrorError);
    } else {
      showResult(data, elapsedSec);
    }
  } catch {
    hide(readingEl);
    mirrorError.textContent = "서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.";
    show(mirrorError);
  }

  btnRead.disabled = false;
  show(btnAgain);
  hide(btnRead);
});

btnAgain.addEventListener("click", () => {
  hide(resultEl, mirrorError, btnAgain);
  tint.classList.remove("on");
  show(btnRead);
});

// ── 도우미 함수들 ────────────────────────────────────────
function countdown(from) {
  return new Promise((resolve) => {
    show(countdownEl);
    let n = from;
    countdownEl.textContent = n;
    const timer = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(timer);
        hide(countdownEl);
        resolve();
      } else {
        countdownEl.textContent = n;
      }
    }, 800);
  });
}

function capturePhoto() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);

  const ctx = canvas.getContext("2d");
  // 화면과 똑같이 좌우 반전된 모습으로 캡처
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return {
    image: dataUrl.split(",")[1], // base64 부분만
    media_type: "image/jpeg",
  };
}

function showResult(data, elapsedSec) {
  const r = data.result;

  $("result-mood").textContent = r.mood_word;
  $("result-sentence").textContent = r.sentence;
  $("result-anchor").textContent = r.anchor;
  $("result-meta").textContent = `해석까지 ${elapsedSec}초`;

  tint.className = "tint on " + (r.mood_tone || "mono");

  if (data.mode === "demo") {
    modeBadge.textContent = "DEMO MODE — 실제 AI 해석이 아닌 예시 문장입니다";
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

  show(resultEl);
}

function show(...els) { els.forEach((el) => el.classList.remove("hidden")); }
function hide(...els) { els.forEach((el) => el.classList.add("hidden")); }
