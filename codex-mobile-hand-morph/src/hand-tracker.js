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
    this.signal = { active: false, x: .5, y: .5, pinch: 0, pinching: false, scale: 1, hands: 0 };
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

  process(now) {
    if (!this.ready || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return this.signal;
    this.lastVideoTime = this.video.currentTime;
    const timestamp = Math.max(now, this.lastTimestamp + .01);
    this.lastTimestamp = timestamp;
    const result = this.landmarker.detectForVideo(this.video, timestamp);
    const hands = result.landmarks ?? [];
    if (!hands.length) {
      this.signal.active = false;
      this.signal.hands = 0;
      this.signal.pinch = mix(this.signal.pinch, 0, .18);
      this.signal.pinching = this.signal.pinch > .5;
      return this.signal;
    }

    const primary = hands[0];
    const thumb = primary[4];
    const index = primary[8];
    const palmSize = Math.max(.025, distance(primary[0], primary[9]));
    const pinchDistance = distance(thumb, index) / palmSize;
    const pinchTarget = clamp((.62 - pinchDistance) / .34);
    let x = (thumb.x + index.x) * .5;
    let y = (thumb.y + index.y) * .5;
    let scale = 1;

    if (hands[1]) {
      const palmA = primary[9];
      const palmB = hands[1][9];
      x = (palmA.x + palmB.x) * .5;
      y = (palmA.y + palmB.y) * .5;
      scale = clamp(distance(palmA, palmB) / .42, .55, 1.65);
    }

    this.signal.active = true;
    this.signal.hands = hands.length;
    this.signal.x = mix(this.signal.x, x, .28);
    this.signal.y = mix(this.signal.y, y, .28);
    this.signal.scale = mix(this.signal.scale, scale, .2);
    this.signal.pinch = mix(this.signal.pinch, pinchTarget, .34);
    this.signal.pinching = this.signal.pinch > .55;
    return this.signal;
  }
}
