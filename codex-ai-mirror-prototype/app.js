import { LiveRenderer } from "./live-renderer.js";
import { RecommendationEngine } from "./recommendation-engine.js";
import { VisionEngine } from "./vision-engine.js";

const elements = {
  intro: document.querySelector("#screen-intro"),
  live: document.querySelector("#screen-live"),
  startButton: document.querySelector("#start-button"),
  video: document.querySelector("#camera-video"),
  canvas: document.querySelector("#scene-canvas"),
  switchCameraButton: document.querySelector("#switch-camera-button"),
  cameraFacingLabel: document.querySelector("#camera-facing-label"),
  liveBadge: document.querySelector(".live-badge"),
  liveBadgeText: document.querySelector("#live-badge-text"),
  engineMode: document.querySelector("#engine-mode"),
  moodLabel: document.querySelector("#mood-label"),
  trackingPrompt: document.querySelector("#tracking-prompt"),
  trackingTitle: document.querySelector("#tracking-title"),
  trackingCopy: document.querySelector("#tracking-copy"),
  trackingState: document.querySelector("#tracking-state"),
  cameraError: document.querySelector("#camera-error"),
  cameraErrorTitle: document.querySelector("#camera-error-title"),
  cameraErrorCopy: document.querySelector("#camera-error-copy"),
  productList: document.querySelector("#product-list"),
  footerStatus: document.querySelector("#footer-status"),
  toast: document.querySelector("#toast"),
};

const renderer = new LiveRenderer(elements.canvas);
const recommendationEngine = new RecommendationEngine();

const emptySignal = {
  visible: false,
  x: 0.5,
  y: 0.43,
  width: 0.34,
  height: 0.46,
  faceAspect: 0.74,
  jawRatio: 0.76,
  proximity: 0.42,
  velocity: 0,
  tilt: 0,
  trackingSequence: 0,
};

let visionEngine = null;
let visionInitialization = null;
let mediaStream = null;
let pendingStream = null;
let cameraRequestId = 0;
let facingMode = "user";
let mirrored = true;
let demoMode = false;
let animationFrameId = 0;
let lastRenderedRanking = "";
let lastTrackingSequence = 0;
let toastTimer = 0;

function showScreen(name) {
  const live = name === "live";
  elements.intro.hidden = live;
  elements.live.hidden = !live;
  elements.intro.classList.toggle("is-active", !live);
  elements.live.classList.toggle("is-active", live);
  requestAnimationFrame(() => {
    renderer.resize();
    document.querySelector("#main")?.focus({ preventScroll: true });
  });
}

function setPrompt(title, copy, hidden = false) {
  elements.trackingTitle.textContent = title;
  elements.trackingCopy.textContent = copy;
  elements.trackingPrompt.classList.toggle("is-hidden", hidden);
}

function setLiveBadge(label, active) {
  elements.liveBadgeText.textContent = label;
  elements.liveBadge.classList.toggle("is-live", active);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function renderProducts(products, animate = false) {
  const rankingKey = products.map((product) => product.id).join("|");
  if (rankingKey === lastRenderedRanking) return;
  lastRenderedRanking = rankingKey;
  elements.productList.hidden = false;
  elements.productList.setAttribute("aria-busy", "false");

  const fragment = document.createDocumentFragment();
  products.slice(0, 3).forEach((product, index) => {
    const item = document.createElement("li");
    item.className = `product-card${index === 0 ? " is-first" : ""}${animate ? " is-updating" : ""}`;

    const rank = document.createElement("span");
    rank.className = "product-card__rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    const imageWrap = document.createElement("div");
    imageWrap.className = "product-card__image-wrap";
    const image = document.createElement("img");
    image.src = product.image;
    image.alt = `${product.name} 선글라스 프로토타입 이미지`;
    image.width = 512;
    image.height = 512;
    image.decoding = "async";
    imageWrap.append(image);

    const name = document.createElement("strong");
    name.textContent = product.name;

    item.append(rank, imageWrap, name);
    fragment.append(item);
    if (animate) requestAnimationFrame(() => item.classList.remove("is-updating"));
  });

  elements.productList.replaceChildren(fragment);
}

function hideRecommendations() {
  lastRenderedRanking = "";
  elements.productList.hidden = true;
  elements.productList.setAttribute("aria-busy", "true");
  elements.productList.replaceChildren();
}

function describeCameraError(error) {
  if (!window.isSecureContext) {
    return {
      title: "HTTPS 연결이 필요합니다",
      copy: "휴대폰 카메라는 HTTPS 주소에서만 열립니다. 배포된 GitHub Pages 주소로 접속해 주세요.",
    };
  }
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "카메라 권한이 꺼져 있습니다",
        copy: "주소창의 사이트 설정에서 카메라를 허용한 뒤 다시 연결해 주세요.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "사용할 카메라를 찾지 못했습니다",
        copy: "다른 카메라 앱을 닫거나 카메라가 있는 휴대폰에서 열어 주세요.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "카메라가 다른 앱에서 사용 중입니다",
        copy: "다른 카메라 앱을 닫고 잠시 후 다시 연결해 주세요.",
      };
    default:
      return {
        title: "카메라를 열 수 없습니다",
        copy: "브라우저의 카메라 권한과 HTTPS 연결을 확인한 뒤 다시 시도해 주세요.",
      };
  }
}

function showCameraError(error, override) {
  const message = override ?? describeCameraError(error);
  elements.cameraErrorTitle.textContent = message.title;
  elements.cameraErrorCopy.textContent = message.copy;
  elements.cameraError.hidden = false;
  elements.trackingPrompt.classList.add("is-hidden");
  setLiveBadge("CAMERA OFF", false);
  elements.trackingState.textContent = "CAMERA CONNECTION FAILED";
  elements.footerStatus.textContent = "LIVE / CHECK CAMERA";
}

function hideCameraError() {
  elements.cameraError.hidden = true;
}

function stopCurrentStream() {
  const streams = new Set([mediaStream, pendingStream].filter(Boolean));
  for (const stream of streams) {
    stream.getTracks().forEach((track) => track.stop());
  }
  mediaStream = null;
  pendingStream = null;
  elements.video.pause();
  elements.video.srcObject = null;
}

async function waitForVideoMetadata(video, requestId, stream) {
  if (
    requestId === cameraRequestId &&
    video.srcObject === stream &&
    video.readyState >= HTMLMediaElement.HAVE_METADATA &&
    video.videoWidth > 0
  ) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    let abortCheck = 0;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearInterval(abortCheck);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onLoaded = () => {
      if (requestId !== cameraRequestId || video.srcObject !== stream) {
        settle(reject, new DOMException("Superseded camera request", "AbortError"));
        return;
      }
      settle(resolve);
    };
    const onError = () => {
      settle(reject, video.error ?? new DOMException("Camera video failed", "NotReadableError"));
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    timeout = window.setTimeout(
      () => settle(reject, new DOMException("Camera metadata timed out", "NotReadableError")),
      9000,
    );
    abortCheck = window.setInterval(() => {
      if (requestId !== cameraRequestId || video.srcObject !== stream) {
        settle(reject, new DOMException("Superseded camera request", "AbortError"));
      }
    }, 100);
  });
}

async function acquireCamera(facing) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera API unavailable", "NotSupportedError");
  }

  const preferred = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 960, max: 1440 },
      frameRate: { ideal: 30, max: 30 },
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (error) {
    if (error?.name !== "OverconstrainedError") throw error;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing } } });
  }
}

async function connectCamera(requestId, requestedFacing) {
  const stream = await acquireCamera(requestedFacing);
  if (requestId !== cameraRequestId) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException("Superseded camera request", "AbortError");
  }

  pendingStream = stream;
  try {
    elements.video.srcObject = stream;
    await waitForVideoMetadata(elements.video, requestId, stream);
    await elements.video.play();

    if (requestId !== cameraRequestId || elements.video.srcObject !== stream) {
      throw new DOMException("Superseded camera request", "AbortError");
    }

    pendingStream = null;
    mediaStream = stream;
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (pendingStream === stream) pendingStream = null;
    if (mediaStream === stream) mediaStream = null;
    if (elements.video.srcObject === stream) {
      elements.video.pause();
      elements.video.srcObject = null;
    }
    throw error;
  }

  const actualFacing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  facingMode = actualFacing === "user" || actualFacing === "environment" ? actualFacing : requestedFacing;
  mirrored = facingMode !== "environment";
  elements.cameraFacingLabel.textContent = mirrored ? "FRONT CAMERA" : "BACK CAMERA";
  elements.switchCameraButton.disabled = false;
  visionEngine?.resetFrameClock();
  hideCameraError();
  setLiveBadge("CAMERA LIVE", true);
  elements.footerStatus.textContent = "LIVE / ON-DEVICE";
}

function updateModelProgress(stage) {
  if (elements.live.hidden || !elements.cameraError.hidden || demoMode) return;
  if (stage === "runtime") {
    setPrompt("비전 엔진을 불러오는 중", "처음 한 번만 모델을 준비합니다");
    elements.engineMode.textContent = "WASM RUNTIME";
  } else if (stage === "face") {
    setPrompt("얼굴 추적 모델을 준비하는 중", "카메라 영상은 기기 밖으로 나가지 않습니다");
    elements.engineMode.textContent = "FACE LANDMARKER";
  } else if (stage === "segment") {
    setPrompt("인물과 배경을 나누는 중", "실시간 배경 교체를 준비합니다");
    elements.engineMode.textContent = "PERSON SEGMENTER";
  }
}

async function ensureVisionEngine() {
  if (!visionEngine) visionEngine = new VisionEngine(elements.video);
  if (!visionInitialization) {
    visionInitialization = visionEngine.initialize(updateModelProgress).catch((error) => {
      visionEngine?.dispose();
      visionEngine = null;
      visionInitialization = null;
      throw error;
    });
  }
  return visionInitialization;
}

function startRenderLoop() {
  if (animationFrameId) return;
  animationFrameId = requestAnimationFrame(renderLoop);
}

function stopRenderLoop() {
  cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;
}

function createDemoSignal(now) {
  const wave = now * 0.001;
  const burst = Math.pow(Math.max(0, Math.sin(wave * 0.61)), 9);
  const proximity = 0.5 + Math.sin(wave * 0.23) * 0.22;
  return {
    visible: true,
    x: 0.5 + Math.sin(wave * 0.32) * 0.12,
    y: 0.43 + Math.sin(wave * 0.21) * 0.025,
    width: 0.31 + proximity * 0.09,
    height: 0.43 + proximity * 0.08,
    faceAspect: 0.74 + Math.sin(wave * 0.11) * 0.08,
    jawRatio: 0.76 + Math.cos(wave * 0.14) * 0.07,
    proximity,
    velocity: 0.08 + burst * 0.72,
    tilt: Math.sin(wave * 0.27) * 0.08,
    trackingSequence: 1,
  };
}

function updateTrackingUI(signal, engineReady) {
  if (!elements.cameraError.hidden) return;
  if (demoMode) {
    setPrompt("", "", true);
    setLiveBadge("DEMO LOOP", true);
    elements.engineMode.textContent = "SYNTHETIC SIGNAL";
    elements.trackingState.textContent = "DEMO PERSON LOCK";
    return;
  }

  if (!engineReady) return;
  elements.engineMode.textContent = visionEngine.mode;
  if (signal.visible) {
    setPrompt("", "", true);
    elements.trackingState.textContent = "PERSON / FACE LOCK";
  } else {
    setPrompt("얼굴과 인물을 찾는 중", "카메라를 향해 천천히 움직여 보세요");
    elements.trackingState.textContent = "WAITING FOR PERSON";
  }
}

function renderLoop(now) {
  animationFrameId = 0;
  if (elements.live.hidden) return;
  if (document.hidden) {
    startRenderLoop();
    return;
  }

  const signal = demoMode ? createDemoSignal(now) : (visionEngine?.ready ? visionEngine.process(now) : emptySignal);
  const mood = renderer.render(now, {
    signal,
    video: elements.video,
    maskCanvas: visionEngine?.maskCanvas,
    hasMask: Boolean(visionEngine?.hasPersonMask),
    mirrored,
    demo: demoMode,
  });

  elements.moodLabel.textContent = mood.name;
  updateTrackingUI(signal, Boolean(visionEngine?.ready));

  if (signal.visible) {
    const forceRanking = signal.trackingSequence !== lastTrackingSequence;
    lastTrackingSequence = signal.trackingSequence;
    const ranking = recommendationEngine.rank(signal, mood.key, now, forceRanking);
    renderProducts(ranking, true);
  }

  startRenderLoop();
}

async function startLiveCamera() {
  const requestId = ++cameraRequestId;
  demoMode = false;
  showScreen("live");
  hideCameraError();
  stopCurrentStream();
  renderer.reset();
  recommendationEngine.reset();
  hideRecommendations();
  lastTrackingSequence = 0;
  elements.switchCameraButton.disabled = true;
  elements.startButton.disabled = true;
  setPrompt("카메라 권한을 기다리는 중", "허용하면 바로 라이브 미러가 시작됩니다");
  setLiveBadge("CONNECTING", false);
  startRenderLoop();

  const cameraPromise = connectCamera(requestId, facingMode).catch((error) => {
    throw { source: "camera", error };
  });
  const modelPromise = ensureVisionEngine().catch((error) => {
    throw { source: "vision", error };
  });

  try {
    const [, engine] = await Promise.all([cameraPromise, modelPromise]);
    if (requestId !== cameraRequestId || demoMode) return;
    elements.engineMode.textContent = engine.mode;
    setPrompt("얼굴과 인물을 찾는 중", "카메라를 향해 천천히 움직여 보세요");
  } catch (failure) {
    const error = failure?.error ?? failure;
    if (requestId !== cameraRequestId || demoMode || error?.name === "AbortError") return;
    console.error(error);
    if (failure?.source === "camera") {
      showCameraError(error);
    } else {
      ++cameraRequestId;
      stopCurrentStream();
      elements.switchCameraButton.disabled = true;
      showCameraError(error, {
        title: "AI 비전 모델을 시작하지 못했습니다",
        copy: "네트워크를 확인해 새로고침하거나 데모 모드로 화면 구성을 먼저 확인해 주세요.",
      });
    }
  } finally {
    elements.startButton.disabled = false;
  }
}

function startDemo() {
  ++cameraRequestId;
  stopCurrentStream();
  demoMode = true;
  mirrored = false;
  showScreen("live");
  hideCameraError();
  renderer.reset();
  recommendationEngine.reset();
  hideRecommendations();
  lastTrackingSequence = 0;
  elements.switchCameraButton.disabled = true;
  elements.cameraFacingLabel.textContent = "NO CAMERA";
  elements.footerStatus.textContent = "LIVE / DEMO MODE";
  setPrompt("", "", true);
  setLiveBadge("DEMO LOOP", true);
  startRenderLoop();
}

async function retryCamera() {
  const requestId = ++cameraRequestId;
  demoMode = false;
  hideCameraError();
  stopCurrentStream();
  elements.switchCameraButton.disabled = true;
  recommendationEngine.reset();
  hideRecommendations();
  lastTrackingSequence = 0;
  setPrompt("카메라를 다시 연결하는 중", "권한을 확인해 주세요");
  setLiveBadge("CONNECTING", false);
  try {
    await connectCamera(requestId, facingMode);
    const engine = await ensureVisionEngine();
    if (requestId !== cameraRequestId) return;
    elements.engineMode.textContent = engine.mode;
  } catch (error) {
    if (requestId !== cameraRequestId || demoMode || error?.name === "AbortError") return;
    if (mediaStream) {
      ++cameraRequestId;
      stopCurrentStream();
      showCameraError(error, {
        title: "AI 비전 모델을 시작하지 못했습니다",
        copy: "네트워크를 확인해 새로고침하거나 데모 모드로 화면 구성을 먼저 확인해 주세요.",
      });
    } else {
      showCameraError(error);
    }
  }
}

async function switchCamera() {
  if (demoMode || !mediaStream) return;
  const requestId = ++cameraRequestId;
  const nextFacing = facingMode === "user" ? "environment" : "user";
  elements.switchCameraButton.disabled = true;
  recommendationEngine.reset();
  hideRecommendations();
  lastTrackingSequence = 0;
  stopCurrentStream();
  setPrompt("카메라를 전환하는 중", nextFacing === "user" ? "전면 카메라 연결" : "후면 카메라 연결");
  setLiveBadge("SWITCHING", false);
  try {
    await connectCamera(requestId, nextFacing);
  } catch (error) {
    if (requestId === cameraRequestId && !demoMode && error?.name !== "AbortError") showCameraError(error);
  }
}

function returnHome() {
  ++cameraRequestId;
  demoMode = false;
  stopCurrentStream();
  stopRenderLoop();
  visionEngine?.resetFrameClock();
  renderer.reset();
  recommendationEngine.reset();
  hideRecommendations();
  lastTrackingSequence = 0;
  facingMode = "user";
  mirrored = true;
  elements.cameraFacingLabel.textContent = "FRONT CAMERA";
  elements.startButton.disabled = false;
  elements.footerStatus.textContent = "READY / CAMERA OFF";
  setLiveBadge("INITIALIZING", false);
  hideCameraError();
  showScreen("intro");
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const action = trigger.dataset.action;
  if (action === "start-live") void startLiveCamera();
  else if (action === "start-demo") startDemo();
  else if (action === "retry-camera") void retryCamera();
  else if (action === "switch-camera") void switchCamera();
  else if (action === "stop-live" || action === "home") returnHome();
});

window.addEventListener("resize", () => renderer.resize(), { passive: true });
window.addEventListener("pagehide", () => {
  returnHome();
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) returnHome();
});

if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  showToast("휴대폰 카메라는 HTTPS 주소에서만 사용할 수 있어요.");
}

hideRecommendations();
