const MOODS = Object.freeze({
  glass: Object.freeze({ name: "GLASS BLOOM", accent: "#cde8ff" }),
  chrome: Object.freeze({ name: "CHROME TIDE", accent: "#eff4ee" }),
  fracture: Object.freeze({ name: "NEON FRACTURE", accent: "#c9ff35" }),
});

const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOut = (value) => 1 - Math.pow(1 - clamp(value), 3);

function seeded(index, salt = 0) {
  const value = Math.sin(index * 91.17 + salt * 47.31) * 43758.5453;
  return value - Math.floor(value);
}

function getSourceSize(source) {
  return {
    width: source?.videoWidth || source?.naturalWidth || source?.width || 1,
    height: source?.videoHeight || source?.naturalHeight || source?.height || 1,
  };
}

function coverCrop(sourceWidth, sourceHeight, destinationWidth, destinationHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const destinationRatio = destinationWidth / destinationHeight;
  if (sourceRatio > destinationRatio) {
    const cropWidth = sourceHeight * destinationRatio;
    return { x: (sourceWidth - cropWidth) * 0.5 / sourceWidth, y: 0, width: cropWidth / sourceWidth, height: 1 };
  }
  const cropHeight = sourceWidth / destinationRatio;
  return { x: 0, y: (sourceHeight - cropHeight) * 0.5 / sourceHeight, width: 1, height: cropHeight / sourceHeight };
}

function drawWithCrop(context, source, crop, width, height, mirrored = false) {
  const size = getSourceSize(source);
  context.save();
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    source,
    crop.x * size.width,
    crop.y * size.height,
    crop.width * size.width,
    crop.height * size.height,
    0,
    0,
    width,
    height,
  );
  context.restore();
}

export class LiveRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.subjectCanvas = document.createElement("canvas");
    this.subjectContext = this.subjectCanvas.getContext("2d", { alpha: true });
    this.width = 1;
    this.height = 1;
    this.currentMood = "glass";
    this.moodChangedAt = 0;
    this.moodLockUntil = 0;
    this.lastTrackingSequence = 0;
    this.bursts = [];
    this.frame = 0;
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  resize() {
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const longestSideScale = 1280 / Math.max(cssWidth, cssHeight);
    const scale = Math.max(0.5, Math.min(pixelRatio, longestSideScale));
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.subjectCanvas.width = width;
    this.subjectCanvas.height = height;
  }

  render(now, options) {
    this.resize();
    const signal = options.signal;
    let normalizedX = signal.x;
    let normalizedY = signal.y;
    let normalizedWidth = signal.width;
    let normalizedHeight = signal.height;

    if (!options.demo && options.video?.videoWidth && options.video?.videoHeight) {
      const crop = coverCrop(options.video.videoWidth, options.video.videoHeight, this.width, this.height);
      normalizedX = (signal.x - crop.x) / crop.width;
      normalizedY = (signal.y - crop.y) / crop.height;
      normalizedWidth = signal.width / crop.width;
      normalizedHeight = signal.height / crop.height;
    }

    normalizedX = clamp(normalizedX, -0.25, 1.25);
    normalizedY = clamp(normalizedY, -0.25, 1.25);
    const mirroredX = options.mirrored ? 1 - normalizedX : normalizedX;
    const anchor = {
      x: mirroredX * this.width,
      y: normalizedY * this.height,
      width: normalizedWidth * this.width,
      height: normalizedHeight * this.height,
    };

    this.#updateMood(now, signal, anchor);
    this.#drawBackground(now, anchor, signal);

    if (options.demo) {
      this.#drawDemoSubject(now, anchor);
    } else if (options.video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.#drawCameraSubject(options.video, options.maskCanvas, options.hasMask, options.mirrored, signal, anchor);
    }

    this.#drawTrackedAura(now, anchor, signal);
    this.#drawBursts(now);
    this.frame += 1;

    return { key: this.currentMood, ...MOODS[this.currentMood] };
  }

  #updateMood(now, signal, anchor) {
    if (signal.visible && signal.trackingSequence !== this.lastTrackingSequence) {
      this.lastTrackingSequence = signal.trackingSequence;
      this.#spawnBurst(now, anchor, this.currentMood, 1.15);
    }

    if (!signal.visible || now < this.moodLockUntil) return;
    let nextMood = "glass";
    if (signal.velocity > 0.46) nextMood = "fracture";
    else if (signal.proximity > 0.62 || signal.velocity > 0.16) nextMood = "chrome";

    if (nextMood === this.currentMood) return;
    this.currentMood = nextMood;
    this.moodChangedAt = now;
    this.moodLockUntil = now + (nextMood === "fracture" ? 1450 : 1900);
    this.#spawnBurst(now, anchor, nextMood, 0.9);
  }

  #drawBackground(now, anchor, signal) {
    const context = this.context;
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.filter = "none";

    if (this.currentMood === "fracture") this.#drawFractureSpace(context, now, anchor, signal);
    else if (this.currentMood === "chrome") this.#drawChromeSpace(context, now, anchor, signal);
    else this.#drawGlassSpace(context, now, anchor, signal);

    context.restore();
  }

  #drawGlassSpace(context, now, anchor, signal) {
    const gradient = context.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, "#071016");
    gradient.addColorStop(0.48, "#17262b");
    gradient.addColorStop(1, "#070a0b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    const bloom = context.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, Math.max(this.width, this.height) * 0.68);
    bloom.addColorStop(0, "rgba(218, 240, 255, 0.28)");
    bloom.addColorStop(0.28, "rgba(117, 178, 196, 0.12)");
    bloom.addColorStop(1, "rgba(3, 7, 8, 0)");
    context.fillStyle = bloom;
    context.fillRect(0, 0, this.width, this.height);

    context.lineWidth = Math.max(1, this.width * 0.0012);
    for (let index = 0; index < 18; index += 1) {
      const phase = now * (0.00004 + seeded(index, 1) * 0.00008) + seeded(index, 2) * TAU;
      const radius = this.width * (0.025 + seeded(index, 3) * 0.11);
      const orbitX = anchor.x + Math.cos(phase) * this.width * (0.12 + seeded(index, 4) * 0.48);
      const orbitY = anchor.y + Math.sin(phase * 0.82) * this.height * (0.12 + seeded(index, 5) * 0.45);
      context.save();
      context.translate(orbitX, orbitY);
      context.rotate(phase * 0.7);
      context.beginPath();
      context.moveTo(-radius, 0);
      context.quadraticCurveTo(0, -radius * (1.4 + seeded(index, 6)), radius, 0);
      context.quadraticCurveTo(0, radius * (1.15 + seeded(index, 7)), -radius, 0);
      context.fillStyle = `rgba(205, 232, 255, ${0.012 + seeded(index, 8) * 0.045})`;
      context.strokeStyle = `rgba(221, 241, 255, ${0.08 + seeded(index, 9) * 0.16})`;
      context.fill();
      context.stroke();
      context.restore();
    }

    if (!signal.visible) this.#drawIdleSweep(context, now, "rgba(205, 232, 255, 0.12)");
  }

  #drawChromeSpace(context, now, anchor, signal) {
    const gradient = context.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, "#060807");
    gradient.addColorStop(0.24, "#4d5651");
    gradient.addColorStop(0.43, "#111513");
    gradient.addColorStop(0.68, "#758079");
    gradient.addColorStop(1, "#080a09");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    const movement = signal.velocity * this.width * 0.05;
    for (let index = -3; index < 12; index += 1) {
      const baseY = (index / 10) * this.height + Math.sin(now * 0.0009 + index * 0.8) * this.height * 0.045;
      context.beginPath();
      context.moveTo(-this.width * 0.1, baseY);
      for (let step = 0; step <= 8; step += 1) {
        const x = (step / 8) * this.width * 1.2 - this.width * 0.1;
        const y = baseY + Math.sin(step * 0.9 + index + now * 0.0013) * (this.height * 0.025 + movement);
        context.lineTo(x, y);
      }
      context.lineTo(this.width * 1.1, baseY + this.height * 0.06);
      context.lineTo(-this.width * 0.1, baseY + this.height * 0.06);
      context.closePath();
      const band = context.createLinearGradient(0, baseY, 0, baseY + this.height * 0.07);
      band.addColorStop(0, `rgba(245, 249, 246, ${0.018 + (index % 3) * 0.012})`);
      band.addColorStop(0.55, "rgba(8, 11, 9, 0.09)");
      band.addColorStop(1, "rgba(235, 242, 237, 0.035)");
      context.fillStyle = band;
      context.fill();
    }

    const halo = context.createRadialGradient(anchor.x, anchor.y, anchor.width * 0.1, anchor.x, anchor.y, Math.max(anchor.width * 2.2, this.width * 0.28));
    halo.addColorStop(0, "rgba(255,255,255,0.22)");
    halo.addColorStop(0.36, "rgba(215,226,218,0.08)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, this.width, this.height);
  }

  #drawFractureSpace(context, now, anchor, signal) {
    context.fillStyle = "#030503";
    context.fillRect(0, 0, this.width, this.height);

    const glow = context.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, Math.max(this.width, this.height) * 0.64);
    glow.addColorStop(0, "rgba(201, 255, 53, 0.18)");
    glow.addColorStop(0.32, "rgba(76, 111, 18, 0.07)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, this.width, this.height);

    const energy = 0.6 + signal.velocity * 1.5;
    for (let index = 0; index < 30; index += 1) {
      const phase = now * (0.00008 + seeded(index, 4) * 0.00018);
      const x = ((seeded(index, 1) + phase) % 1.2 - 0.1) * this.width;
      const y = (seeded(index, 2) * 1.2 - 0.1) * this.height;
      const size = this.width * (0.018 + seeded(index, 3) * 0.095) * energy;
      context.save();
      context.translate(x, y);
      context.rotate(seeded(index, 5) * TAU + phase * 3);
      context.beginPath();
      context.moveTo(-size * 0.15, -size);
      context.lineTo(size * (0.25 + seeded(index, 6)), size * 0.8);
      context.lineTo(-size * (0.2 + seeded(index, 7)), size * 0.38);
      context.closePath();
      context.fillStyle = index % 5 === 0 ? "rgba(201, 255, 53, 0.2)" : "rgba(201, 255, 53, 0.035)";
      context.strokeStyle = `rgba(201, 255, 53, ${0.12 + seeded(index, 8) * 0.28})`;
      context.lineWidth = Math.max(1, this.width * 0.001);
      context.fill();
      context.stroke();
      context.restore();
    }

    context.strokeStyle = "rgba(201, 255, 53, 0.16)";
    context.lineWidth = 1;
    const spacing = Math.max(46, this.width * 0.065);
    for (let x = -this.height; x < this.width + this.height; x += spacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x - this.height * 0.55, this.height);
      context.stroke();
    }
  }

  #drawIdleSweep(context, now, color) {
    const y = ((now * 0.00016) % 1.25 - 0.12) * this.height;
    const gradient = context.createLinearGradient(0, y - 80, 0, y + 80);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, color);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, y - 80, this.width, 160);
  }

  #drawCameraSubject(video, maskCanvas, hasMask, mirrored, signal, anchor) {
    const context = this.subjectContext;
    const size = getSourceSize(video);
    const crop = coverCrop(size.width, size.height, this.width, this.height);
    context.clearRect(0, 0, this.width, this.height);
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = signal.visible ? 1 : 0.68;
    context.filter = this.currentMood === "fracture"
      ? "saturate(0.72) contrast(1.18)"
      : this.currentMood === "chrome"
        ? "saturate(0.68) contrast(1.12)"
        : "saturate(0.76) contrast(1.04) hue-rotate(4deg)";
    drawWithCrop(context, video, crop, this.width, this.height, mirrored);
    context.restore();

    if (signal.visible && hasMask && maskCanvas?.width && maskCanvas?.height) {
      context.save();
      context.globalCompositeOperation = "destination-in";
      context.filter = `blur(${Math.max(1.5, this.width * 0.0022)}px)`;
      drawWithCrop(context, maskCanvas, crop, this.width, this.height, mirrored);
      context.restore();
    } else if (signal.visible) {
      context.save();
      context.globalCompositeOperation = "destination-in";
      const gradient = context.createRadialGradient(
        anchor.x,
        anchor.y + anchor.height * 0.24,
        anchor.width * 0.25,
        anchor.x,
        anchor.y + anchor.height * 0.58,
        Math.max(anchor.width * 1.65, anchor.height * 1.55),
      );
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.64, "rgba(255,255,255,0.98)");
      gradient.addColorStop(0.88, "rgba(255,255,255,0.22)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, this.width, this.height);
      context.restore();
    }

    this.context.save();
    this.context.globalCompositeOperation = "source-over";
    this.context.drawImage(this.subjectCanvas, 0, 0);
    this.context.restore();
  }

  #drawDemoSubject(now, anchor) {
    const context = this.context;
    context.save();
    const bodyGradient = context.createLinearGradient(anchor.x, anchor.y - anchor.height, anchor.x, this.height);
    if (this.currentMood === "fracture") {
      bodyGradient.addColorStop(0, "#b7e42e");
      bodyGradient.addColorStop(0.18, "#1f2a17");
      bodyGradient.addColorStop(1, "#080b08");
    } else if (this.currentMood === "chrome") {
      bodyGradient.addColorStop(0, "#e8efea");
      bodyGradient.addColorStop(0.22, "#5b6760");
      bodyGradient.addColorStop(0.48, "#0c100e");
      bodyGradient.addColorStop(0.72, "#89958d");
      bodyGradient.addColorStop(1, "#0a0c0b");
    } else {
      bodyGradient.addColorStop(0, "#c8e1e9");
      bodyGradient.addColorStop(0.26, "#48616a");
      bodyGradient.addColorStop(1, "#0a1113");
    }
    context.fillStyle = bodyGradient;
    context.beginPath();
    context.ellipse(anchor.x, anchor.y - anchor.height * 0.03, anchor.width * 0.5, anchor.height * 0.55, 0, 0, TAU);
    context.fill();
    context.beginPath();
    context.moveTo(anchor.x - anchor.width * 1.18, this.height);
    context.quadraticCurveTo(anchor.x - anchor.width * 0.86, anchor.y + anchor.height * 0.48, anchor.x, anchor.y + anchor.height * 0.42);
    context.quadraticCurveTo(anchor.x + anchor.width * 0.86, anchor.y + anchor.height * 0.48, anchor.x + anchor.width * 1.18, this.height);
    context.closePath();
    context.fill();

    context.globalCompositeOperation = "screen";
    context.strokeStyle = this.currentMood === "fracture" ? "rgba(201,255,53,0.5)" : "rgba(232,244,239,0.28)";
    context.lineWidth = Math.max(1, this.width * 0.0014);
    for (let index = 0; index < 6; index += 1) {
      const offset = Math.sin(now * 0.001 + index) * anchor.width * 0.03;
      context.beginPath();
      context.ellipse(anchor.x + offset, anchor.y, anchor.width * (0.3 + index * 0.035), anchor.height * (0.34 + index * 0.028), index * 0.04, 0, TAU);
      context.stroke();
    }
    context.restore();
  }

  #drawTrackedAura(now, anchor, signal) {
    if (!signal.visible) return;
    const context = this.context;
    const accent = MOODS[this.currentMood].accent;
    const pulse = 1 + Math.sin(now * 0.0032) * 0.035 + signal.velocity * 0.08;

    context.save();
    context.globalCompositeOperation = this.currentMood === "fracture" ? "screen" : "lighter";
    context.translate(anchor.x, anchor.y);
    context.rotate(signal.tilt * 1.2);
    context.scale(pulse, pulse);
    context.strokeStyle = `${accent}88`;
    context.lineWidth = Math.max(1, this.width * 0.0017);
    context.setLineDash([this.width * 0.018, this.width * 0.012]);
    context.lineDashOffset = -now * 0.014;
    context.beginPath();
    context.ellipse(0, 0, anchor.width * 0.68, anchor.height * 0.68, 0, 0, TAU);
    context.stroke();
    context.setLineDash([]);

    for (let index = 0; index < 9; index += 1) {
      const angle = now * (0.00025 + index * 0.000012) + (index / 9) * TAU;
      const radiusX = anchor.width * (0.76 + (index % 3) * 0.12);
      const radiusY = anchor.height * (0.74 + (index % 2) * 0.12);
      const x = Math.cos(angle) * radiusX;
      const y = Math.sin(angle) * radiusY;
      context.fillStyle = index % 3 === 0 ? accent : "rgba(241,246,239,0.74)";
      context.beginPath();
      context.arc(x, y, Math.max(1.5, this.width * (0.0018 + signal.velocity * 0.002)), 0, TAU);
      context.fill();
    }
    context.restore();
  }

  #spawnBurst(now, anchor, mood, strength) {
    this.bursts.push({
      start: now,
      x: anchor.x,
      y: anchor.y,
      radius: Math.max(anchor.width, this.width * 0.14),
      mood,
      strength,
      seed: Math.random() * 1000,
    });
    if (this.bursts.length > 5) this.bursts.shift();
  }

  #drawBursts(now) {
    const context = this.context;
    const active = [];
    for (const burst of this.bursts) {
      const progress = (now - burst.start) / 1050;
      if (progress >= 1) continue;
      active.push(burst);
      const eased = easeOut(progress);
      const alpha = (1 - progress) * burst.strength;
      const accent = MOODS[burst.mood].accent;

      context.save();
      context.globalCompositeOperation = "lighter";
      context.strokeStyle = accent;
      context.lineWidth = Math.max(1, this.width * 0.0025 * (1 - progress));
      context.globalAlpha = alpha * 0.72;
      context.beginPath();
      context.arc(burst.x, burst.y, burst.radius * (0.55 + eased * 2.5), 0, TAU);
      context.stroke();
      context.beginPath();
      context.arc(burst.x, burst.y, burst.radius * (0.3 + eased * 1.72), 0, TAU);
      context.stroke();

      const particleCount = burst.mood === "fracture" ? 28 : 18;
      for (let index = 0; index < particleCount; index += 1) {
        const angle = seeded(index, burst.seed) * TAU;
        const distance = burst.radius * eased * (1.1 + seeded(index, burst.seed + 1) * 3.4);
        const x = burst.x + Math.cos(angle) * distance;
        const y = burst.y + Math.sin(angle) * distance;
        const size = this.width * (0.002 + seeded(index, burst.seed + 2) * 0.009) * (1 - progress * 0.6);
        context.save();
        context.translate(x, y);
        context.rotate(angle + progress * 3);
        context.fillStyle = accent;
        context.globalAlpha = alpha * (0.25 + seeded(index, burst.seed + 3) * 0.65);
        if (burst.mood === "fracture") {
          context.beginPath();
          context.moveTo(-size, -size * 2.3);
          context.lineTo(size, size * 1.8);
          context.lineTo(-size * 0.45, size * 0.8);
          context.closePath();
          context.fill();
        } else {
          context.beginPath();
          context.arc(0, 0, size, 0, TAU);
          context.fill();
        }
        context.restore();
      }
      context.restore();
    }
    this.bursts = active;
  }

  reset() {
    this.currentMood = "glass";
    this.moodChangedAt = 0;
    this.moodLockUntil = 0;
    this.lastTrackingSequence = 0;
    this.bursts = [];
    this.context.clearRect(0, 0, this.width, this.height);
    this.subjectContext.clearRect(0, 0, this.width, this.height);
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.reset();
  }
}

export { MOODS };
