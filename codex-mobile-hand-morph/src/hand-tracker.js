import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = -1;
    this.ready = false;
    this.signal = {
      active: false,
      leftActive: false,
      rightActive: false,
      x: .5,
      y: .5,
      pinch: 0,
      pinching: false,
      released: false,
      scale: 1,
      hands: 0,
    };
  }

  async initialize() {
    const base = import.meta.env.BASE_URL;
    const wasmRoot = new URL(`${base}mediapipe/wasm/`, location.href).href.replace(/\/$/, "");
    const model = new URL(`${base}models/hand_landmarker.task`, location.href).href;
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);
    const options = {
      baseOptions: { modelAssetPath: model, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: .45,
      minHandPresenceConfidence: .45,
      minTrackingConfidence: .45,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      this.landmarker = await HandLandmarker.createFromOptions(vision, options);
    }
    this.ready = true;
  }

  process(now, swapHandedness = false) {
    if (!this.ready || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return this.signal;
    this.lastVideoTime = this.video.currentTime;
    const timestamp = Math.max(now, this.lastTimestamp + .01);
    this.lastTimestamp = timestamp;
    const result = this.landmarker.detectForVideo(this.video, timestamp);
    const hands = result.landmarks ?? [];
    if (!hands.length) {
      this.signal.active = false;
      this.signal.leftActive = false;
      this.signal.rightActive = false;
      this.signal.released = false;
      this.signal.hands = 0;
      this.signal.pinch = mix(this.signal.pinch, 0, .18);
      this.signal.pinching = false;
      return this.signal;
    }

    const entries = hands.map((landmarks, index) => {
      let label = result.handednesses?.[index]?.[0]?.categoryName?.toLowerCase() ?? "";
      if (swapHandedness) label = label === "left" ? "right" : label === "right" ? "left" : label;
      return { landmarks, label };
    });
    let left = entries.find((entry) => entry.label === "left");
    let right = entries.find((entry) => entry.label === "right");
    if (entries.length === 2 && (!left || !right)) {
      const sorted = [...entries].sort((a, b) => b.landmarks[0].x - a.landmarks[0].x);
      left ??= sorted[0];
      right ??= sorted[1];
    }

    const leftPoints = left?.landmarks;
    const rightPoints = right?.landmarks;
    const leftPalm = leftPoints ? Math.max(.025, distance(leftPoints[0], leftPoints[9])) : 1;
    const leftSpread = leftPoints ? distance(leftPoints[4], leftPoints[8]) / leftPalm : 0;
    const leftReady = Boolean(leftPoints && leftSpread > .78);

    let x = this.signal.x;
    let y = this.signal.y;
    let scale = this.signal.scale;
    if (leftReady) {
      x = (leftPoints[4].x + leftPoints[8].x) * .5;
      y = (leftPoints[4].y + leftPoints[8].y) * .5;
      scale = clamp(leftSpread / 1.28, .62, 1.42);
    }

    let pinchTarget = 0;
    if (rightPoints) {
      const rightPalm = Math.max(.025, distance(rightPoints[0], rightPoints[9]));
      const rightDistance = distance(rightPoints[4], rightPoints[8]) / rightPalm;
      pinchTarget = clamp((.62 - rightDistance) / .34);
    }

    const previousPinching = this.signal.pinching;
    this.signal.active = leftReady;
    this.signal.leftActive = leftReady;
    this.signal.rightActive = Boolean(rightPoints);
    this.signal.hands = hands.length;
    this.signal.x = mix(this.signal.x, x, .28);
    this.signal.y = mix(this.signal.y, y, .28);
    this.signal.scale = mix(this.signal.scale, scale, .2);
    this.signal.pinch = mix(this.signal.pinch, pinchTarget, .34);
    if (!rightPoints) {
      this.signal.pinching = false;
    } else if (previousPinching) {
      this.signal.pinching = this.signal.pinch > .34;
    } else {
      this.signal.pinching = this.signal.pinch > .58;
    }
    this.signal.released = Boolean(rightPoints && previousPinching && !this.signal.pinching);
    return this.signal;
  }
}
