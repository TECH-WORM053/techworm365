import { HandTracker } from "./hand-tracker.js";
import { PointCloudScene } from "./point-cloud.js";

const $ = (selector) => document.querySelector(selector);
const video = $("#camera");
const stage = $("#stage");
const intro = $("#intro");
const controls = $("#controls");
const reticle = $("#reticle");
const status = $("#status");
const statusDot = $("#status-dot");
const gesture = $("#gesture");
const shape = $("#shape");
const errorBox = $("#error");
const errorCopy = $("#error-copy");

const cloud = new PointCloudScene($("#scene"));
const tracker = new HandTracker(video);
let stream = null;
let facingMode = "user";
let running = false;

async function start() {
  errorBox.hidden = true;
  status.textContent = "LOADING MODEL";
  try {
    await cloud.initialize();
    await tracker.initialize();
    await startCamera();
    intro.hidden = true;
    controls.hidden = false;
    status.textContent = "LIVE";
    statusDot.classList.add("is-live");
    running = true;
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    errorCopy.textContent = !window.isSecureContext
      ? "휴대폰 카메라는 HTTPS 주소에서만 허용됩니다. 배포 주소로 열어주세요."
      : `${error?.message ?? error}`;
    errorBox.hidden = false;
    status.textContent = "ERROR";
  }
}

async function startCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  stage.classList.toggle("is-rear", facingMode === "environment");
}

function frame(now) {
  if (!running) return;
  const signal = tracker.process(now);
  signal.screenX = facingMode === "user" ? 1 - signal.x : signal.x;
  cloud.update(signal, now);
  gesture.textContent = !signal.leftActive
    ? "SPREAD LEFT"
    : !signal.rightActive
      ? "SHOW RIGHT"
      : signal.pinching
        ? "RIGHT PINCH"
        : "RIGHT OPEN";
  shape.textContent = cloud.shapeIndex ? "TORUS" : "SPHERE";
  reticle.hidden = !signal.active;
  if (signal.active) {
    reticle.style.left = `${signal.screenX * 100}%`;
    reticle.style.top = `${signal.y * 100}%`;
    reticle.classList.toggle("is-pinching", signal.pinching);
  }
  requestAnimationFrame(frame);
}

$("#start").addEventListener("click", start, { once: true });
$("#retry").addEventListener("click", () => location.reload());
$("#flip").addEventListener("click", async () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  try { await startCamera(); } catch (error) { console.error(error); }
});
window.addEventListener("resize", () => cloud.resize());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stream?.getTracks().forEach((track) => track.stop());
});
