import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
} from "./vendor/mediapipe/vision_bundle.mjs";

const WASM_ROOT = new URL("./vendor/mediapipe/wasm", import.meta.url).href.replace(/\/$/, "");
const FACE_MODEL = new URL("./models/face_landmarker.task", import.meta.url).href;
const SEGMENT_MODEL = new URL("./models/selfie_segmenter.tflite", import.meta.url).href;

const FACE_INDICES = Object.freeze({
  left: 234,
  right: 454,
  top: 10,
  bottom: 152,
  jawLeft: 172,
  jawRight: 397,
  leftEye: 33,
  rightEye: 263,
});

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (from, to, amount) => from + (to - from) * amount;

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

async function createWithDelegate(TaskClass, fileset, options) {
  try {
    return await TaskClass.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "GPU" },
    });
  } catch (gpuError) {
    console.warn("MediaPipe GPU delegate unavailable; using CPU.", gpuError);
    return TaskClass.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
}

export class VisionEngine {
  constructor(video) {
    this.video = video;
    this.faceLandmarker = null;
    this.imageSegmenter = null;
    this.maskCanvas = document.createElement("canvas");
    this.maskContext = this.maskCanvas.getContext("2d", { alpha: true, willReadFrequently: false });
    this.maskImageData = null;
    this.hasPersonMask = false;
    this.ready = false;
    this.mode = "LOADING";
    this.initPromise = null;
    this.lastVideoTime = -1;
    this.lastFaceRunAt = -Infinity;
    this.lastSegmentRunAt = -Infinity;
    this.lastFaceTimestamp = -1;
    this.lastSegmentTimestamp = -1;
    this.lastSeenAt = -Infinity;
    this.previousRaw = null;
    this.stableFrames = 0;
    this.trackingSequence = 0;
    this.nextTask = "face";
    this.segmentationErrors = 0;
    this.inferenceSamples = [];

    const memory = Number(globalThis.navigator?.deviceMemory ?? 8);
    const cores = Number(globalThis.navigator?.hardwareConcurrency ?? 8);
    this.lowPowerDevice = memory <= 3 || cores <= 4;
    this.faceInterval = this.lowPowerDevice ? 96 : 72;
    this.segmentInterval = this.lowPowerDevice ? 230 : 145;

    this.signal = {
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
      lastSeenAt: -Infinity,
    };
  }

  async initialize(onProgress = () => {}) {
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.#initializeTasks(onProgress);
    return this.initPromise;
  }

  async #initializeTasks(onProgress) {
    onProgress("runtime");
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);

    onProgress("face");
    this.faceLandmarker = await createWithDelegate(FaceLandmarker, fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    onProgress("segment");
    try {
      this.imageSegmenter = await createWithDelegate(ImageSegmenter, fileset, {
        baseOptions: { modelAssetPath: SEGMENT_MODEL },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      this.mode = this.lowPowerDevice ? "PERSON MASK / ECO" : "PERSON MASK / FULL";
    } catch (error) {
      console.warn("Person segmentation unavailable; continuing in portrait portal mode.", error);
      this.imageSegmenter = null;
      this.mode = "FACE TRACK / LITE";
    }

    this.ready = true;
    onProgress("ready");
    return { mode: this.mode, segmentation: Boolean(this.imageSegmenter) };
  }

  process(now = performance.now()) {
    if (!this.ready || !this.video || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return this.#updateLossState(now);
    }

    if (!this.video.videoWidth || !this.video.videoHeight || this.video.currentTime === this.lastVideoTime) {
      return this.#updateLossState(now);
    }
    this.lastVideoTime = this.video.currentTime;

    const faceDue = now - this.lastFaceRunAt >= this.faceInterval;
    const segmentDue = Boolean(this.imageSegmenter) && now - this.lastSegmentRunAt >= this.segmentInterval;

    if (segmentDue && (this.nextTask === "segment" || !faceDue)) {
      this.#runSegmentation(now);
      this.nextTask = "face";
    } else if (faceDue) {
      this.#runFaceTracking(now);
      this.nextTask = "segment";
    }

    return this.#updateLossState(now);
  }

  #runFaceTracking(now) {
    this.lastFaceRunAt = now;
    this.lastFaceTimestamp = Math.max(now, this.lastFaceTimestamp + 0.01);
    const startedAt = performance.now();

    try {
      const result = this.faceLandmarker.detectForVideo(this.video, this.lastFaceTimestamp);
      const landmarks = result.faceLandmarks?.[0];
      if (!landmarks?.length) {
        this.stableFrames = 0;
        return;
      }

      const left = landmarks[FACE_INDICES.left];
      const right = landmarks[FACE_INDICES.right];
      const top = landmarks[FACE_INDICES.top];
      const bottom = landmarks[FACE_INDICES.bottom];
      const jawLeft = landmarks[FACE_INDICES.jawLeft];
      const jawRight = landmarks[FACE_INDICES.jawRight];
      const leftEye = landmarks[FACE_INDICES.leftEye];
      const rightEye = landmarks[FACE_INDICES.rightEye];
      if (!left || !right || !top || !bottom || !jawLeft || !jawRight || !leftEye || !rightEye) return;

      const rawWidth = Math.max(0.001, Math.abs(right.x - left.x));
      const rawHeight = Math.max(0.001, Math.abs(bottom.y - top.y));
      const rawX = (left.x + right.x) * 0.5;
      const rawY = (top.y + bottom.y) * 0.5;
      const rawJawWidth = Math.abs(jawRight.x - jawLeft.x);
      const nowSignal = {
        x: clamp(rawX),
        y: clamp(rawY),
        width: clamp(rawWidth, 0.05, 0.82),
        height: clamp(rawHeight, 0.08, 0.92),
      };

      let velocity = 0;
      if (this.previousRaw) {
        const elapsedSeconds = Math.max(0.016, (now - this.previousRaw.time) / 1000);
        const travel = Math.hypot(nowSignal.x - this.previousRaw.x, nowSignal.y - this.previousRaw.y);
        const scaleChange = Math.abs(nowSignal.width - this.previousRaw.width);
        velocity = clamp((travel * 1.35 + scaleChange * 0.85) / elapsedSeconds, 0, 1);
      }
      this.previousRaw = { ...nowSignal, time: now };

      const wasVisible = this.signal.visible;
      this.stableFrames += 1;
      this.lastSeenAt = now;
      this.signal.x = mix(this.signal.x, nowSignal.x, 0.42);
      this.signal.y = mix(this.signal.y, nowSignal.y, 0.42);
      this.signal.width = mix(this.signal.width, nowSignal.width, 0.38);
      this.signal.height = mix(this.signal.height, nowSignal.height, 0.38);
      this.signal.faceAspect = mix(this.signal.faceAspect, clamp(rawWidth / rawHeight, 0.46, 1.08), 0.3);
      this.signal.jawRatio = mix(this.signal.jawRatio, clamp(rawJawWidth / rawWidth, 0.44, 1), 0.3);
      this.signal.proximity = mix(this.signal.proximity, clamp((rawWidth - 0.16) / 0.42), 0.34);
      this.signal.velocity = mix(this.signal.velocity, velocity, 0.44);
      this.signal.tilt = mix(this.signal.tilt, clamp((rightEye.y - leftEye.y) / rawWidth, -0.35, 0.35), 0.32);
      this.signal.visible = wasVisible || this.stableFrames >= 2;
      this.signal.lastSeenAt = now;

      if (!wasVisible && this.signal.visible) {
        this.trackingSequence += 1;
        this.signal.trackingSequence = this.trackingSequence;
      }
    } catch (error) {
      console.warn("Face tracking frame skipped.", error);
    } finally {
      this.#recordInferenceDuration(performance.now() - startedAt);
    }
  }

  #runSegmentation(now) {
    this.lastSegmentRunAt = now;
    this.lastSegmentTimestamp = Math.max(now, this.lastSegmentTimestamp + 0.01);
    const startedAt = performance.now();

    try {
      this.imageSegmenter.segmentForVideo(this.video, this.lastSegmentTimestamp, (result) => {
        const mask = result.confidenceMasks?.[0];
        if (!mask) return;

        const width = mask.width;
        const height = mask.height;
        const confidence = mask.getAsFloat32Array();
        if (!width || !height || confidence.length < width * height) return;

        if (this.maskCanvas.width !== width || this.maskCanvas.height !== height || !this.maskImageData) {
          this.maskCanvas.width = width;
          this.maskCanvas.height = height;
          this.maskImageData = this.maskContext.createImageData(width, height);
        }

        const pixels = this.maskImageData.data;
        for (let index = 0, pixel = 0; index < width * height; index += 1, pixel += 4) {
          const alpha = Math.round(smoothstep(0.32, 0.72, confidence[index]) * 255);
          pixels[pixel] = 255;
          pixels[pixel + 1] = 255;
          pixels[pixel + 2] = 255;
          pixels[pixel + 3] = alpha;
        }
        this.maskContext.putImageData(this.maskImageData, 0, 0);
        this.hasPersonMask = true;
      });
      this.segmentationErrors = 0;
    } catch (error) {
      this.segmentationErrors += 1;
      console.warn("Segmentation frame skipped.", error);
      if (this.segmentationErrors >= 3) {
        this.imageSegmenter?.close();
        this.imageSegmenter = null;
        this.hasPersonMask = false;
        this.mode = "FACE TRACK / LITE";
      }
    } finally {
      this.#recordInferenceDuration(performance.now() - startedAt);
    }
  }

  #recordInferenceDuration(duration) {
    this.inferenceSamples.push(duration);
    if (this.inferenceSamples.length > 20) this.inferenceSamples.shift();
    if (this.inferenceSamples.length < 10 || !this.imageSegmenter) return;

    const average = this.inferenceSamples.reduce((sum, sample) => sum + sample, 0) / this.inferenceSamples.length;
    if (average > 48) {
      this.faceInterval = Math.max(this.faceInterval, 100);
      this.segmentInterval = Math.max(this.segmentInterval, 250);
      if (this.mode.includes("FULL")) this.mode = "PERSON MASK / ECO";
    }
  }

  #updateLossState(now) {
    if (this.signal.visible && now - this.lastSeenAt > 560) {
      this.signal.visible = false;
      this.signal.velocity = 0;
      this.stableFrames = 0;
      this.previousRaw = null;
    } else if (this.signal.visible) {
      this.signal.velocity *= 0.94;
    }
    return this.signal;
  }

  resetFrameClock() {
    this.lastVideoTime = -1;
    this.lastFaceRunAt = -Infinity;
    this.lastSegmentRunAt = -Infinity;
    this.stableFrames = 0;
    this.previousRaw = null;
    this.signal.visible = false;
    this.signal.velocity = 0;
    this.hasPersonMask = false;
  }

  dispose() {
    this.faceLandmarker?.close();
    this.imageSegmenter?.close();
    this.faceLandmarker = null;
    this.imageSegmenter = null;
    this.ready = false;
    this.initPromise = null;
    this.hasPersonMask = false;
  }
}
