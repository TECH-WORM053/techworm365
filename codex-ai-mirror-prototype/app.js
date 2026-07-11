const STEP_BY_SCREEN = {
  intro: "STEP 00 / 04",
  consent: "STEP 00 / 04",
  capture: "STEP 01 / 04",
  interpret: "STEP 02 / 04",
  transform: "STEP 03 / 04",
  result: "STEP 04 / 04",
};

const MATERIALS = {
  chrome: {
    label: "LIQUID CHROME",
    ko: "액체 크롬",
    colors: ["#e6e8df", "#60645e", "#101110", "#c7ff42"],
  },
  glass: {
    label: "LIGHT GLASS",
    ko: "빛의 유리",
    colors: ["#e7efff", "#6f8bc8", "#131a2b", "#b8d5ff"],
  },
  signal: {
    label: "GREEN SIGNAL",
    ko: "초록 신호",
    colors: ["#d9ffe2", "#51c878", "#081b10", "#c7ff42"],
  },
};

const SCOPES = {
  silhouette: "추상 실루엣",
  mood: "선택한 무드",
  space: "인물 + 공간",
};

class MirrorBoundaryLab {
  constructor() {
    this.dom = {
      screens: [...document.querySelectorAll("[data-screen]")],
      consent: document.querySelector("#consent-checkbox"),
      consentMessage: document.querySelector("#consent-message"),
      cameraVideo: document.querySelector("#camera-video"),
      captureCanvas: document.querySelector("#capture-canvas"),
      captureButton: document.querySelector("#capture-button"),
      cameraSwitch: document.querySelector("#camera-switch"),
      cameraFacingLabel: document.querySelector("#camera-facing-label"),
      cameraState: document.querySelector("#camera-state"),
      cameraStateText: document.querySelector("#camera-state-text"),
      cameraMessage: document.querySelector("#camera-message"),
      connectionNote: document.querySelector("#connection-note"),
      demoPortrait: document.querySelector("#demo-portrait"),
      phoneInputs: [...document.querySelectorAll("[data-photo-facing]")],
      previewCanvas: document.querySelector("#preview-canvas"),
      signalList: document.querySelector("#signal-list"),
      interpretationGrid: document.querySelector("#interpretation-grid"),
      sceneCanvas: document.querySelector("#scene-canvas"),
      resultCanvas: document.querySelector("#result-canvas"),
      materialLabel: document.querySelector("#scene-material-label"),
      distanceLabel: document.querySelector("#scene-distance-label"),
      distanceSlider: document.querySelector("#distance-slider"),
      distanceOutput: document.querySelector("#distance-output"),
      liveLine: document.querySelector("#live-line"),
      scopeNote: document.querySelector("#scope-note"),
      resultLine: document.querySelector("#result-line"),
      sessionSummary: document.querySelector("#session-summary"),
      footerStep: document.querySelector("#footer-step"),
      toast: document.querySelector("#toast"),
    };

    this.stream = null;
    this.animationFrame = null;
    this.lastSceneFrame = 0;
    this.toastTimer = null;
    this.demoTimer = null;
    this.cameraRequestId = 0;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.state = this.freshState();

    this.bindEvents();
    this.buildRatings();
  }

  freshState() {
    return {
      version: "codex-boundary-lab-0.2.0",
      screen: "intro",
      startedAt: null,
      consentedAt: null,
      capturedAt: null,
      completedAt: null,
      captureMode: null,
      facingMode: "user",
      actualFacingMode: "user",
      analysis: null,
      interpretations: [],
      selectedInterpretation: null,
      scope: "silhouette",
      material: "chrome",
      distance: 42,
      resultSavedAt: null,
      feedback: {
        personal: null,
        comfort: null,
      },
    };
  }

  bindEvents() {
    document.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) return;

      event.preventDefault();
      this.handleAction(actionTarget.dataset.action, actionTarget);
    });

    document.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;

      if (input.matches("[data-photo-facing]")) {
        this.handlePhotoInput(input);
        return;
      }

      if (input.name === "scope") {
        this.state.scope = input.value;
        this.updateBoundaryView();
      }

      if (input.name === "material") {
        this.state.material = input.value;
        this.updateBoundaryView();
      }
    });

    this.dom.distanceSlider.addEventListener("input", () => {
      this.state.distance = Number(this.dom.distanceSlider.value);
      this.updateBoundaryView();
    });

    window.addEventListener("beforeunload", () => this.stopCamera());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      this.cameraRequestId += 1;
      this.clearDemoTimer();
      if (!this.stream) return;
      this.stopCamera();
      this.dom.captureButton.disabled = true;
      this.dom.cameraMessage.textContent = "탭이 숨겨져 카메라를 중지했습니다. 돌아온 뒤 다시 연결해주세요.";
      this.setCameraState("CAMERA PAUSED", true);
    });
  }

  handleAction(action, target) {
    const actions = {
      start: () => {
        this.state.startedAt = new Date().toISOString();
        this.navigate("consent");
      },
      "back-intro": () => this.navigate("intro"),
      "enter-camera": () => this.enterCamera(),
      capture: () => this.captureFrame(),
      "demo-frame": () => this.useDemoFrame(),
      "restart-camera": () => this.startCamera(),
      "switch-camera": () => this.switchCamera(),
      "choose-interpretation": () => this.chooseInterpretation(target.dataset.interpretation),
      finish: () => this.finishExperience(),
      "save-image": () => this.saveImage(),
      "export-log": () => this.exportLog(),
      reset: () => this.reset(),
    };

    actions[action]?.();
  }

  navigate(screenName) {
    this.dom.screens.forEach((screen) => {
      const isCurrent = screen.dataset.screen === screenName;
      screen.hidden = !isCurrent;
      screen.classList.remove("is-active");
      screen.setAttribute("aria-hidden", String(!isCurrent));
    });

    const current = this.dom.screens.find((screen) => screen.dataset.screen === screenName);
    if (!current) return;

    current.hidden = false;
    requestAnimationFrame(() => current.classList.add("is-active"));
    this.state.screen = screenName;
    this.dom.footerStep.textContent = STEP_BY_SCREEN[screenName];
    window.scrollTo({ top: 0, behavior: "auto" });

    const heading = current.querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      window.setTimeout(() => heading.focus({ preventScroll: true }), 80);
    }

    if (screenName !== "transform") this.stopSceneAnimation();
  }

  async enterCamera() {
    if (!this.dom.consent.checked) {
      this.dom.consentMessage.textContent = "계속하려면 세션 내 카메라 사용에 먼저 동의해주세요.";
      this.dom.consent.focus();
      return;
    }

    this.dom.consentMessage.textContent = "";
    this.state.consentedAt = new Date().toISOString();
    this.navigate("capture");
    await this.startCamera();
  }

  async startCamera() {
    const requestId = ++this.cameraRequestId;
    this.clearDemoTimer();
    this.stopCamera();
    this.state.captureMode = null;
    this.state.actualFacingMode = this.state.facingMode;
    this.updateFacingLabel();
    this.dom.demoPortrait.hidden = true;
    this.dom.cameraVideo.hidden = false;
    this.dom.cameraVideo.classList.toggle("is-user-facing", this.state.facingMode === "user");
    this.dom.captureButton.disabled = true;
    this.dom.cameraSwitch.disabled = true;
    this.dom.cameraMessage.textContent = "";
    this.updateConnectionNote();
    this.setCameraState("카메라 연결 중", false);

    if (!window.isSecureContext) {
      this.cameraFailed("실시간 카메라는 HTTPS에서만 열립니다. 아래 ‘휴대폰 카메라 촬영’은 현재 연결에서도 사용할 수 있어요.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraFailed("이 브라우저는 실시간 카메라를 지원하지 않아요. 아래 휴대폰 촬영 또는 샘플 모드를 이용해주세요.");
      return;
    }

    try {
      const candidateStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.state.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 1600 },
        },
        audio: false,
      });

      if (
        requestId !== this.cameraRequestId ||
        this.state.screen !== "capture" ||
        this.state.captureMode === "synthetic-sample" ||
        document.hidden
      ) {
        candidateStream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = candidateStream;
      this.dom.cameraVideo.srcObject = candidateStream;
      await this.dom.cameraVideo.play();

      if (requestId !== this.cameraRequestId || this.state.screen !== "capture" || document.hidden) {
        this.stopCamera();
        return;
      }

      const track = candidateStream.getVideoTracks()[0];
      this.state.actualFacingMode = track?.getSettings?.().facingMode || this.state.facingMode;
      this.dom.cameraVideo.classList.toggle("is-user-facing", this.state.actualFacingMode === "user");
      this.updateFacingLabel();
      await this.updateCameraSwitchAvailability();
      this.dom.captureButton.disabled = false;
      this.setCameraState(
        this.state.actualFacingMode === "environment" ? "REAR CAMERA / LIVE" : "FRONT CAMERA / LIVE",
        false,
      );
    } catch (error) {
      if (requestId !== this.cameraRequestId || this.state.screen !== "capture") return;
      const cameraErrors = {
        NotAllowedError: "카메라 권한이 허용되지 않았어요. 권한을 바꾸거나 휴대폰 촬영 모드로 계속할 수 있습니다.",
        NotFoundError: "이 방향의 카메라를 찾지 못했어요. 다른 방향으로 전환하거나 휴대폰 촬영 모드를 이용해주세요.",
        NotReadableError: "다른 앱이 카메라를 사용 중인 것 같아요. 앱을 닫고 다시 연결해주세요.",
        OverconstrainedError: "요청한 카메라 조건을 사용할 수 없어 기본 촬영 모드로 전환해주세요.",
      };
      this.cameraFailed(cameraErrors[error?.name] ?? "카메라를 시작할 수 없어요. 휴대폰 촬영 또는 샘플 모드로 계속할 수 있습니다.");
    }
  }

  cameraFailed(message) {
    this.dom.captureButton.disabled = true;
    this.dom.cameraMessage.textContent = message;
    this.setCameraState("CAMERA OFF", true);
  }

  setCameraState(text, isError) {
    this.dom.cameraStateText.textContent = text;
    this.dom.cameraState.classList.toggle("is-error", isError);
  }

  updateConnectionNote() {
    this.dom.connectionNote.textContent = window.isSecureContext
      ? "보안 연결 확인됨 · 실시간 카메라 사용 가능"
      : "현재 HTTP 연결 · 실시간 영상 대신 아래 한 장 촬영 사용 가능";
  }

  updateFacingLabel() {
    const isRear = this.state.actualFacingMode === "environment";
    this.dom.cameraFacingLabel.textContent = isRear ? "후면" : "전면";
    this.dom.cameraSwitch.setAttribute("aria-label", `${isRear ? "후면" : "전면"} 카메라에서 ${isRear ? "전면" : "후면"} 카메라로 전환`);
  }

  async updateCameraSwitchAvailability() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === "videoinput");
      this.dom.cameraSwitch.disabled = videoInputs.length < 2;
    } catch {
      this.dom.cameraSwitch.disabled = false;
    }
  }

  switchCamera() {
    this.state.facingMode = this.state.actualFacingMode === "environment" ? "user" : "environment";
    this.state.actualFacingMode = this.state.facingMode;
    this.updateFacingLabel();
    this.startCamera();
  }

  captureFrame() {
    const video = this.dom.cameraVideo;
    if (!video.videoWidth || !video.videoHeight) {
      this.dom.cameraMessage.textContent = "카메라 화면이 준비될 때까지 잠시만 기다려주세요.";
      return;
    }

    const canvas = this.dom.captureCanvas;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const shouldMirror = this.state.actualFacingMode === "user";
    if (shouldMirror) {
      context.save();
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
      this.drawCover(context, video, canvas.width, canvas.height);
      context.restore();
    } else {
      this.drawCover(context, video, canvas.width, canvas.height);
    }

    this.state.captureMode = `live-camera-${this.state.actualFacingMode}`;
    this.processFrame();
  }

  async handlePhotoInput(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (file.type && !file.type.startsWith("image/")) {
      this.dom.cameraMessage.textContent = "이미지 파일만 사용할 수 있어요.";
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      this.dom.cameraMessage.textContent = "사진 용량이 너무 커요. 25MB 이하 사진을 선택해주세요.";
      return;
    }

    const requestId = ++this.cameraRequestId;
    this.clearDemoTimer();
    this.stopCamera();
    const facing = input.dataset.photoFacing === "environment" ? "environment" : "user";
    this.state.facingMode = facing;
    this.state.actualFacingMode = facing;
    this.updateFacingLabel();
    this.setCameraState("LOCAL PHOTO / DECODING", false);
    this.dom.cameraMessage.textContent = "사진을 이 브라우저 메모리에서 불러오는 중입니다.";

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await this.loadLocalImage(objectUrl);
      if (requestId !== this.cameraRequestId || this.state.screen !== "capture") return;

      const canvas = this.dom.captureCanvas;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.clearRect(0, 0, canvas.width, canvas.height);
      this.drawCover(context, image, canvas.width, canvas.height);
      this.state.captureMode = `device-photo-${facing}`;
      this.dom.cameraMessage.textContent = "";
      this.setCameraState(facing === "environment" ? "REAR PHOTO / LOCAL" : "FRONT PHOTO / LOCAL", false);
      this.processFrame();
    } catch {
      if (requestId !== this.cameraRequestId || this.state.screen !== "capture") return;
      this.cameraFailed("사진을 읽지 못했어요. JPG, PNG 또는 HEIC 변환 사진으로 다시 시도해주세요.");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  loadLocalImage(objectUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image decode failed"));
      image.src = objectUrl;
    });
  }

  useDemoFrame() {
    this.cameraRequestId += 1;
    this.clearDemoTimer();
    this.stopCamera();
    this.dom.cameraVideo.hidden = true;
    this.dom.demoPortrait.hidden = false;
    this.setCameraState("SYNTHETIC SAMPLE", false);
    this.drawDemoFrame(this.dom.captureCanvas);
    this.state.captureMode = "synthetic-sample";

    this.demoTimer = window.setTimeout(() => {
      this.demoTimer = null;
      if (this.state.screen !== "capture" || this.state.captureMode !== "synthetic-sample") return;
      this.processFrame();
    }, 260);
  }

  drawDemoFrame(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const { width, height } = canvas;
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#111411");
    background.addColorStop(0.48, "#4d554a");
    background.addColorStop(1, "#050605");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.save();
    context.globalAlpha = 0.4;
    for (let x = 52; x < width; x += 86) {
      const light = context.createLinearGradient(x, 0, x + 12, 0);
      light.addColorStop(0, "rgba(220,255,225,0)");
      light.addColorStop(0.5, "rgba(220,255,225,0.65)");
      light.addColorStop(1, "rgba(220,255,225,0)");
      context.fillStyle = light;
      context.fillRect(x, 0, 14, height);
    }
    context.restore();

    const body = context.createRadialGradient(width * 0.5, height * 0.42, 10, width * 0.5, height * 0.45, height * 0.44);
    body.addColorStop(0, "#62665e");
    body.addColorStop(0.42, "#252824");
    body.addColorStop(1, "#090a09");
    context.fillStyle = body;
    context.beginPath();
    context.ellipse(width * 0.5, height * 0.78, width * 0.32, height * 0.42, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#9c9e95";
    context.beginPath();
    context.ellipse(width * 0.5, height * 0.36, width * 0.17, height * 0.23, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#090909";
    context.beginPath();
    if (typeof context.roundRect === "function") {
      context.roundRect(width * 0.3, height * 0.31, width * 0.4, height * 0.085, 22);
    } else {
      context.rect(width * 0.3, height * 0.31, width * 0.4, height * 0.085);
    }
    context.fill();
    context.fillRect(width * 0.46, height * 0.345, width * 0.08, 8);

    const veil = context.createRadialGradient(width * 0.5, height * 0.45, height * 0.08, width * 0.5, height * 0.45, height * 0.65);
    veil.addColorStop(0, "rgba(0,0,0,0)");
    veil.addColorStop(1, "rgba(0,0,0,0.72)");
    context.fillStyle = veil;
    context.fillRect(0, 0, width, height);
  }

  processFrame() {
    this.state.capturedAt = new Date().toISOString();
    this.state.analysis = this.analyzeFrame(this.dom.captureCanvas);
    this.state.interpretations = this.buildInterpretations(this.state.analysis);
    this.drawPreview();
    this.renderSignals();
    this.renderInterpretations();
    this.stopCamera();
    this.navigate("interpret");
  }

  analyzeFrame(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const step = 12;
    const luminances = [];
    let warmth = 0;
    let saturation = 0;
    let detail = 0;
    let previousLuminance = null;
    let samples = 0;

    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const index = (y * canvas.width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);

        luminances.push(luminance);
        warmth += red - blue;
        saturation += max === 0 ? 0 : (max - min) / max;
        if (previousLuminance !== null) detail += Math.abs(luminance - previousLuminance);
        previousLuminance = luminance;
        samples += 1;
      }
    }

    const average = luminances.reduce((sum, value) => sum + value, 0) / luminances.length;
    const variance = luminances.reduce((sum, value) => sum + (value - average) ** 2, 0) / luminances.length;
    const contrast = Math.sqrt(variance);

    return {
      brightness: Math.round((average / 255) * 100),
      contrast: Math.round(Math.min(100, (contrast / 96) * 100)),
      warmth: Math.round(Math.max(-100, Math.min(100, (warmth / samples / 48) * 100))),
      saturation: Math.round((saturation / samples) * 100),
      detail: Math.round(Math.min(100, (detail / Math.max(1, samples - 1) / 52) * 100)),
    };
  }

  buildInterpretations(signal) {
    const light = signal.brightness < 34 ? "낮게 접힌 빛" : signal.brightness > 67 ? "열린 흰빛" : "중간의 회색빛";
    const edge = signal.contrast < 33 ? "흐르는 경계" : signal.contrast > 66 ? "날카로운 경계" : "고른 경계";
    const temperature = signal.warmth < -12 ? "차가운 표면" : signal.warmth > 12 ? "따뜻한 잔광" : "무채색 표면";
    const motion = signal.detail < 30 ? "고요하게 멈춘" : signal.detail > 63 ? "잘게 진동하는" : "천천히 움직이는";

    return [
      {
        id: "signal",
        index: "A",
        mode: "SIGNAL-LED",
        title: `${edge}, ${temperature}`,
        line: `${light} 안에서 ${motion} 윤곽이 금속의 표면으로 번집니다.`,
        note: "측정된 밝기·대비·색온도의 방향을 가장 가깝게 따른 번역",
      },
      {
        id: "drift",
        index: "B",
        mode: "POETIC DRIFT",
        title: "빛의 비, 멈춘 유리",
        line: `당신이 고른 순간 위로 빛의 기둥이 내리고, ${temperature}은 유리 도시가 됩니다.`,
        note: "실험 01에서 반복된 거울·유리·빛의 모티프로 확장한 번역",
      },
      {
        id: "counterpoint",
        index: "C",
        mode: "COUNTERPOINT",
        title: "반대편의 검은 태양",
        line: `${edge}의 반대편에서 검은 태양이 떠오르고, 익숙한 프레임은 낯선 신호로 남습니다.`,
        note: "이미지 신호를 그대로 따르지 않고 반대 감각을 제안하는 번역",
      },
    ];
  }

  drawPreview() {
    const context = this.dom.previewCanvas.getContext("2d");
    context.clearRect(0, 0, this.dom.previewCanvas.width, this.dom.previewCanvas.height);
    context.drawImage(
      this.dom.captureCanvas,
      0,
      0,
      this.dom.previewCanvas.width,
      this.dom.previewCanvas.height,
    );
  }

  renderSignals() {
    const signal = this.state.analysis;
    const labels = [
      signal.brightness < 34 ? "낮은 명도" : signal.brightness > 67 ? "높은 명도" : "중간 명도",
      signal.contrast < 33 ? "부드러운 대비" : signal.contrast > 66 ? "강한 대비" : "중간 대비",
      signal.warmth < -12 ? "차가운 색온도" : signal.warmth > 12 ? "따뜻한 색온도" : "중성 색온도",
      signal.detail < 30 ? "고요한 표면" : signal.detail > 63 ? "조밀한 표면" : "움직이는 표면",
    ];

    this.dom.signalList.replaceChildren(
      ...labels.map((label) => {
        const item = document.createElement("li");
        item.textContent = label;
        return item;
      }),
    );
  }

  renderInterpretations() {
    this.dom.interpretationGrid.innerHTML = this.state.interpretations
      .map(
        (interpretation) => `
          <button
            class="interpretation-card"
            type="button"
            data-action="choose-interpretation"
            data-interpretation="${interpretation.id}"
          >
            <span class="interpretation-card__topline">
              <span>${interpretation.index} / ${interpretation.mode}</span>
              <span>SELECT ↗</span>
            </span>
            <h3>${interpretation.title}</h3>
            <p>“${interpretation.line}”</p>
            <p>${interpretation.note}</p>
          </button>
        `,
      )
      .join("");
  }

  chooseInterpretation(id) {
    const chosen = this.state.interpretations.find((item) => item.id === id);
    if (!chosen) return;

    this.state.selectedInterpretation = chosen;
    this.navigate("transform");
    this.updateBoundaryView();
    this.startSceneAnimation();
  }

  updateBoundaryView() {
    const material = MATERIALS[this.state.material];
    this.dom.distanceSlider.value = String(this.state.distance);
    this.dom.distanceOutput.value = String(this.state.distance);
    this.dom.distanceOutput.textContent = String(this.state.distance);
    this.dom.materialLabel.textContent = material.label;
    this.dom.distanceLabel.textContent = `DISTANCE ${String(this.state.distance).padStart(2, "0")}`;
    this.dom.liveLine.textContent = `“${this.composeLine()}”`;
    this.dom.scopeNote.textContent =
      this.state.scope === "space"
        ? "원본 프레임 픽셀을 장면에 사용합니다. 장면 저장 시 현재 결과에 포함됩니다."
        : "원본 프레임 픽셀을 결과 장면에 사용하지 않습니다.";

    if (this.state.screen === "transform" && !this.animationFrame) {
      this.drawScene(this.dom.sceneCanvas, performance.now());
    }
  }

  composeLine() {
    const base = this.state.selectedInterpretation?.line ?? "선택한 프레임이 낯선 표면으로 번집니다.";
    const material = MATERIALS[this.state.material].ko;
    const distance = this.state.distance;

    if (distance < 28) return `${base} ${material}은 아직 당신의 윤곽 가까이에 머뭅니다.`;
    if (distance < 68) return `${base} 익숙한 표면과 ${material}의 낯선 감각이 겹칩니다.`;
    return `${base} 윤곽은 멀어지고, 선택한 ${material}의 감각만 남습니다.`;
  }

  startSceneAnimation() {
    this.stopSceneAnimation();
    if (this.reducedMotion) {
      this.drawScene(this.dom.sceneCanvas, 0);
      return;
    }
    const loop = (time) => {
      if (this.state.screen !== "transform") return;
      if (time - this.lastSceneFrame > 32) {
        this.drawScene(this.dom.sceneCanvas, time);
        this.lastSceneFrame = time;
      }
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  stopSceneAnimation() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  drawScene(canvas, time = 0, includeCaption = false) {
    const context = canvas.getContext("2d");
    const { width, height } = canvas;
    const distance = this.state.distance / 100;
    const material = MATERIALS[this.state.material];
    const phase = time * 0.00035;

    context.save();
    context.clearRect(0, 0, width, height);

    const background = context.createRadialGradient(width * 0.38, height * 0.22, 0, width * 0.5, height * 0.55, height * 0.78);
    background.addColorStop(0, material.colors[1]);
    background.addColorStop(0.36, material.colors[2]);
    background.addColorStop(1, "#020202");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    this.drawSourceLayer(context, width, height, distance);

    if (this.state.material === "chrome") this.drawChrome(context, width, height, distance, phase);
    if (this.state.material === "glass") this.drawGlass(context, width, height, distance, phase);
    if (this.state.material === "signal") this.drawSignal(context, width, height, distance, phase);

    this.drawVignette(context, width, height, distance);
    this.drawGrain(context, width, height, phase, includeCaption ? 170 : 90);

    if (includeCaption) this.drawExportCaption(context, width, height);
    context.restore();
  }

  drawSourceLayer(context, width, height, distance) {
    const source = this.dom.captureCanvas;

    if (this.state.scope === "silhouette") {
      this.drawAbstractSilhouette(context, width, height, distance);
      return;
    }

    if (this.state.scope === "mood") {
      this.drawMoodField(context, width, height, distance);
      return;
    }

    context.save();
    context.globalAlpha = Math.max(0.24, 0.86 - distance * 0.34);
    context.filter = `grayscale(${18 + distance * 68}%) contrast(${1.05 + distance * 0.62}) saturate(${0.88 - distance * 0.5}) blur(${distance * 2.4}px)`;

    if (distance > 0.35) {
      const slice = width / 3;
      for (let index = 0; index < 3; index += 1) {
        context.save();
        if (index % 2 === 1) {
          context.translate((index * 2 + 1) * slice, 0);
          context.scale(-1, 1);
          this.drawCover(context, source, slice, height, index * slice, 0);
        } else {
          this.drawCover(context, source, slice, height, index * slice, 0);
        }
        context.restore();
      }
    } else {
      this.drawCover(context, source, width, height);
    }

    context.filter = "none";
    context.restore();
  }

  drawAbstractSilhouette(context, width, height, distance) {
    const material = MATERIALS[this.state.material];
    const signal = this.state.analysis ?? { brightness: 50, contrast: 50, warmth: 0 };
    const centerX = width * (0.5 + signal.warmth * 0.00035);
    const headWidth = width * (0.14 + signal.contrast * 0.00028);
    const headHeight = height * 0.16;
    const headY = height * 0.31;

    context.save();
    context.globalAlpha = 0.9 - distance * 0.34;
    context.shadowColor = material.colors[3];
    context.shadowBlur = 18 + distance * 54;

    const body = context.createLinearGradient(centerX - headWidth, headY, centerX + headWidth, height * 0.92);
    body.addColorStop(0, material.colors[0]);
    body.addColorStop(0.22, material.colors[1]);
    body.addColorStop(0.58, material.colors[2]);
    body.addColorStop(1, "#020202");
    context.fillStyle = body;

    context.beginPath();
    context.ellipse(centerX, headY, headWidth, headHeight, distance * 0.08, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.moveTo(centerX - width * 0.075, height * 0.44);
    context.bezierCurveTo(
      centerX - width * (0.24 + distance * 0.06),
      height * 0.5,
      centerX - width * 0.31,
      height * 0.76,
      centerX - width * 0.34,
      height,
    );
    context.lineTo(centerX + width * 0.34, height);
    context.bezierCurveTo(
      centerX + width * 0.31,
      height * 0.76,
      centerX + width * (0.24 + distance * 0.06),
      height * 0.5,
      centerX + width * 0.075,
      height * 0.44,
    );
    context.closePath();
    context.fill();

    context.shadowBlur = 0;
    context.globalCompositeOperation = "multiply";
    context.fillStyle = `rgba(0,0,0,${0.54 + distance * 0.3})`;
    context.fillRect(centerX - headWidth * 1.18, headY - headHeight * 0.16, headWidth * 2.36, headHeight * 0.34);
    context.restore();
  }

  drawMoodField(context, width, height, distance) {
    const material = MATERIALS[this.state.material];
    const signal = this.state.analysis ?? { brightness: 50, detail: 50, warmth: 0 };
    const focusX = width * (0.5 + signal.warmth * 0.002);
    const focusY = height * (0.36 + (50 - signal.brightness) * 0.002);

    context.save();
    context.globalCompositeOperation = "screen";
    const field = context.createRadialGradient(focusX, focusY, 0, focusX, focusY, height * (0.38 + distance * 0.18));
    field.addColorStop(0, material.colors[0]);
    field.addColorStop(0.2, material.colors[1]);
    field.addColorStop(0.64, `${material.colors[2]}99`);
    field.addColorStop(1, "rgba(0,0,0,0)");
    context.globalAlpha = 0.32 + distance * 0.34;
    context.fillStyle = field;
    context.fillRect(0, 0, width, height);

    const lineCount = 4 + Math.round(signal.detail / 12);
    context.strokeStyle = material.colors[3];
    context.lineWidth = 1 + distance * 1.8;
    context.globalAlpha = 0.16 + distance * 0.36;
    for (let line = 0; line < lineCount; line += 1) {
      const y = ((line + 1) / (lineCount + 1)) * height;
      context.beginPath();
      for (let x = -20; x <= width + 20; x += 24) {
        const wave = Math.sin(x * 0.012 + line * 0.9) * width * (0.012 + distance * 0.05);
        if (x === -20) context.moveTo(x, y + wave);
        else context.lineTo(x, y + wave);
      }
      context.stroke();
    }
    context.restore();
  }

  drawChrome(context, width, height, distance, phase) {
    context.save();
    context.globalCompositeOperation = "screen";
    const count = 5 + Math.round(distance * 7);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + phase * (index % 2 ? 1 : -1);
      const orbit = width * (0.16 + (index % 4) * 0.075);
      const x = width * 0.5 + Math.cos(angle) * orbit;
      const y = height * 0.48 + Math.sin(angle * 1.3) * orbit * 1.25;
      const radius = width * (0.055 + distance * 0.055 + (index % 3) * 0.012);
      const drop = context.createRadialGradient(x - radius * 0.35, y - radius * 0.4, 1, x, y, radius);
      drop.addColorStop(0, "rgba(255,255,255,0.92)");
      drop.addColorStop(0.22, "rgba(125,132,124,0.74)");
      drop.addColorStop(0.58, "rgba(8,9,8,0.62)");
      drop.addColorStop(0.82, "rgba(199,255,66,0.28)");
      drop.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = drop;
      context.beginPath();
      context.ellipse(x, y, radius * (1 + distance * 0.75), radius, angle * 0.2, 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = 0.3 + distance * 0.45;
    context.strokeStyle = "rgba(232,237,229,0.78)";
    context.lineWidth = 1.2 + distance * 2;
    for (let line = 0; line < 4; line += 1) {
      context.beginPath();
      for (let y = -40; y <= height + 40; y += 28) {
        const x = width * (0.18 + line * 0.22) + Math.sin(y * 0.009 + phase * 4 + line) * width * (0.02 + distance * 0.06);
        if (y === -40) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();
  }

  drawGlass(context, width, height, distance, phase) {
    context.save();
    context.globalCompositeOperation = "screen";
    const shards = 7 + Math.round(distance * 8);
    for (let index = 0; index < shards; index += 1) {
      const seed = this.seed(index * 17.4 + 2.1);
      const x = this.seed(index * 29.2) * width;
      const y = this.seed(index * 7.7 + 4) * height;
      const size = width * (0.08 + seed * 0.16 + distance * 0.06);
      const drift = Math.sin(phase * 3 + index) * 18;
      const glass = context.createLinearGradient(x, y, x + size, y + size);
      glass.addColorStop(0, "rgba(231,239,255,0.58)");
      glass.addColorStop(0.5, "rgba(78,103,163,0.12)");
      glass.addColorStop(1, "rgba(152,189,255,0.42)");
      context.fillStyle = glass;
      context.strokeStyle = "rgba(224,235,255,0.62)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + drift, y - size * 0.65);
      context.lineTo(x + size * 0.6 + drift, y + size * 0.25);
      context.lineTo(x - size * 0.15 + drift, y + size);
      context.closePath();
      context.fill();
      context.stroke();
    }

    context.globalAlpha = 0.2 + distance * 0.5;
    for (let line = 0; line < 12; line += 1) {
      const x = (line / 11) * width;
      const beam = context.createLinearGradient(x, 0, x + 24, 0);
      beam.addColorStop(0, "rgba(210,225,255,0)");
      beam.addColorStop(0.5, "rgba(210,225,255,0.45)");
      beam.addColorStop(1, "rgba(210,225,255,0)");
      context.fillStyle = beam;
      context.fillRect(x + Math.sin(phase * 2 + line) * 8, 0, 24, height);
    }
    context.restore();
  }

  drawSignal(context, width, height, distance, phase) {
    context.save();
    context.globalCompositeOperation = "screen";
    context.strokeStyle = `rgba(109,255,159,${0.18 + distance * 0.38})`;
    context.lineWidth = 1;

    const rows = 9 + Math.round(distance * 11);
    for (let row = 0; row < rows; row += 1) {
      const y = ((row + 0.5) / rows) * height;
      context.beginPath();
      for (let x = 0; x <= width; x += 18) {
        const wave = Math.sin(x * 0.012 + row * 0.8 + phase * 6) * (7 + distance * 31);
        if (x === 0) context.moveTo(x, y + wave);
        else context.lineTo(x, y + wave);
      }
      context.stroke();
    }

    const points = 28 + Math.round(distance * 58);
    for (let index = 0; index < points; index += 1) {
      const x = this.seed(index * 4.17) * width;
      const baseY = this.seed(index * 8.9 + 1.4) * height;
      const y = (baseY + phase * 130 * (1 + (index % 3))) % height;
      const radius = 0.7 + this.seed(index * 2.3) * (2.2 + distance * 3);
      context.fillStyle = index % 5 === 0 ? "rgba(199,255,66,0.85)" : "rgba(109,255,159,0.56)";
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawVignette(context, width, height, distance) {
    const vignette = context.createRadialGradient(width * 0.5, height * 0.44, height * 0.14, width * 0.5, height * 0.5, height * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.68, `rgba(0,0,0,${0.12 + distance * 0.12})`);
    vignette.addColorStop(1, "rgba(0,0,0,0.84)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
  }

  drawGrain(context, width, height, phase, count) {
    context.save();
    context.globalCompositeOperation = "screen";
    for (let index = 0; index < count; index += 1) {
      const x = this.seed(index * 3.11 + Math.floor(phase * 2)) * width;
      const y = this.seed(index * 7.83 + 9.1) * height;
      const alpha = 0.02 + this.seed(index * 5.2) * 0.08;
      context.fillStyle = `rgba(255,255,255,${alpha})`;
      context.fillRect(x, y, 1.2, 1.2);
    }
    context.restore();
  }

  drawExportCaption(context, width, height) {
    context.save();
    context.fillStyle = "rgba(0,0,0,0.54)";
    context.fillRect(0, height - 178, width, 178);
    context.strokeStyle = "rgba(242,240,233,0.24)";
    context.beginPath();
    context.moveTo(54, height - 178);
    context.lineTo(width - 54, height - 178);
    context.stroke();

    context.fillStyle = "#c7ff42";
    context.font = "18px Arial, sans-serif";
    context.fillText("CODEX / MIRROR BOUNDARY LAB", 54, height - 132);
    context.fillStyle = "#f2f0e9";
    context.font = "26px Arial, sans-serif";
    this.wrapText(context, this.composeLine(), 54, height - 88, width - 108, 34, 2);
    context.restore();
  }

  finishExperience() {
    this.stopSceneAnimation();
    this.state.completedAt = new Date().toISOString();
    this.drawScene(this.dom.resultCanvas, 2800, true);
    this.dom.resultLine.textContent = `“${this.composeLine()}”`;
    this.renderSummary();
    this.navigate("result");
  }

  renderSummary() {
    const duration = this.sessionDurationSeconds();
    this.dom.sessionSummary.innerHTML = `
      <div class="summary-item"><span>READ RANGE</span><strong>${SCOPES[this.state.scope]}</strong></div>
      <div class="summary-item"><span>MATERIAL</span><strong>${MATERIALS[this.state.material].ko}</strong></div>
      <div class="summary-item"><span>DISTANCE / TIME</span><strong>${this.state.distance} / ${duration}초</strong></div>
    `;
  }

  buildRatings() {
    document.querySelectorAll("[data-rating]").forEach((container) => {
      const name = container.dataset.rating;
      for (let value = 1; value <= 5; value += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = String(value);
        button.setAttribute("aria-label", `${value}점`);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          this.state.feedback[name] = value;
          [...container.children].forEach((item, index) => {
            item.classList.toggle("is-selected", index + 1 === value);
            item.setAttribute("aria-pressed", String(index + 1 === value));
          });
          this.showToast("평가가 현재 세션 기록에 반영됐습니다.");
        });
        container.append(button);
      }
    });
  }

  async saveImage() {
    const blob = await new Promise((resolve) => this.dom.resultCanvas.toBlob(resolve, "image/png"));
    if (!blob) {
      this.showToast("장면 이미지를 만들지 못했어요. 다시 시도해주세요.");
      return;
    }

    const filename = `codex-mirror-boundary-${Date.now()}.png`;
    let file = null;
    try {
      file = new File([blob], filename, { type: "image/png" });
    } catch {
      // Older browsers can still use the download fallback below.
    }
    let canShareFile = false;
    try {
      canShareFile = Boolean(file && navigator.share && navigator.canShare?.({ files: [file] }));
    } catch {
      canShareFile = false;
    }

    if (canShareFile) {
      try {
        await navigator.share({
          title: "Mirror Boundary Lab",
          text: "내가 선택한 해석의 경계",
          files: [file],
        });
        this.state.resultSavedAt = new Date().toISOString();
        this.showToast("휴대폰 공유·저장 시트로 장면을 전달했습니다.");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    this.downloadBlob(blob, filename);
    this.state.resultSavedAt = new Date().toISOString();
    this.showToast("장면을 이 기기에 저장했습니다.");
  }

  exportLog() {
    const exportData = {
      prototype: this.state.version,
      hypothesis: "사용자가 AI 해석의 범위와 낯섦을 통제하면 판단받는 불편함 없이 개인화된 경험을 만들 수 있는가?",
      startedAt: this.state.startedAt,
      completedAt: this.state.completedAt,
      durationSeconds: this.sessionDurationSeconds(),
      captureMode: this.state.captureMode,
      serverUpload: false,
      automaticImageStorage: false,
      userExportedResult: Boolean(this.state.resultSavedAt),
      visibleSignals: this.state.analysis,
      choice: {
        interpretation: this.state.selectedInterpretation
          ? {
              id: this.state.selectedInterpretation.id,
              title: this.state.selectedInterpretation.title,
            }
          : null,
        scope: this.state.scope,
        material: this.state.material,
        distance: this.state.distance,
      },
      feedback: this.state.feedback,
      note: "원본 프레임과 이미지 픽셀은 이 파일에 포함되지 않습니다. visibleSignals는 원본에서 계산한 파생 수치입니다.",
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json;charset=utf-8" });
    this.downloadBlob(blob, `codex-boundary-log-${Date.now()}.json`);
    this.showToast("이미지를 제외한 실험 기록을 저장했습니다.");
  }

  reset() {
    this.cameraRequestId += 1;
    this.clearDemoTimer();
    this.stopCamera();
    this.stopSceneAnimation();
    this.clearCanvas(this.dom.captureCanvas);
    this.clearCanvas(this.dom.previewCanvas);
    this.clearCanvas(this.dom.sceneCanvas);
    this.clearCanvas(this.dom.resultCanvas);
    this.dom.cameraVideo.srcObject = null;
    this.dom.cameraVideo.hidden = false;
    this.dom.cameraVideo.classList.add("is-user-facing");
    this.dom.demoPortrait.hidden = true;
    this.dom.phoneInputs.forEach((input) => {
      input.value = "";
    });
    this.dom.consent.checked = false;
    this.dom.consentMessage.textContent = "";
    this.dom.cameraMessage.textContent = "";
    this.dom.captureButton.disabled = true;
    this.dom.distanceSlider.value = "42";
    document.querySelector('input[name="scope"][value="silhouette"]').checked = true;
    document.querySelector('input[name="material"][value="chrome"]').checked = true;
    document.querySelectorAll(".rating button").forEach((button) => {
      button.classList.remove("is-selected");
      button.setAttribute("aria-pressed", "false");
    });
    this.state = this.freshState();
    this.updateFacingLabel();
    this.updateConnectionNote();
    this.navigate("intro");
    this.showToast("현재 프레임과 세션 값을 지웠습니다.");
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.dom.cameraVideo.srcObject = null;
    this.dom.cameraSwitch.disabled = true;
  }

  clearDemoTimer() {
    if (!this.demoTimer) return;
    window.clearTimeout(this.demoTimer);
    this.demoTimer = null;
  }

  clearCanvas(canvas) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  drawCover(context, source, targetWidth, targetHeight, targetX = 0, targetY = 0) {
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const cropWidth = targetWidth / scale;
    const cropHeight = targetHeight / scale;
    const sourceX = (sourceWidth - cropWidth) / 2;
    const sourceY = (sourceHeight - cropHeight) / 2;
    context.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, targetX, targetY, targetWidth, targetHeight);
  }

  wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(" ");
    let line = "";
    let lineIndex = 0;

    for (let index = 0; index < words.length; index += 1) {
      const testLine = `${line}${words[index]} `;
      if (context.measureText(testLine).width > maxWidth && line) {
        context.fillText(line.trim(), x, y + lineIndex * lineHeight);
        line = `${words[index]} `;
        lineIndex += 1;
        if (lineIndex >= maxLines - 1) break;
      } else {
        line = testLine;
      }
    }
    if (lineIndex < maxLines) context.fillText(line.trim(), x, y + lineIndex * lineHeight);
  }

  seed(value) {
    const x = Math.sin(value * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  sessionDurationSeconds() {
    if (!this.state.startedAt) return 0;
    const end = this.state.completedAt ? new Date(this.state.completedAt).getTime() : Date.now();
    return Math.max(1, Math.round((end - new Date(this.state.startedAt).getTime()) / 1000));
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  showToast(message) {
    window.clearTimeout(this.toastTimer);
    this.dom.toast.textContent = message;
    this.dom.toast.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => this.dom.toast.classList.remove("is-visible"), 2800);
  }
}

new MirrorBoundaryLab();
