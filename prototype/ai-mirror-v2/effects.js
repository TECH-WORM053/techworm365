// 배경 이펙트 엔진
// 비디오 위에 겹친 캔버스에 그립니다.
// - 무드 팔레트로 화면 가장자리를 물들이는 컬러 워시 (얼굴 주변은 비워둠)
// - 얼굴 움직임에 반대로 흐르는 파티클 (시차 효과)
// - 분석이 갱신되면 팔레트가 2초에 걸쳐 부드럽게 전환

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return {
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t),
  };
}

function rgba(c, a) {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a})`;
}

const DEFAULT_PALETTE = { base: "#0a0a0c", glow: "#3a3a44", accent: "#8a8a96" };

export class Effects {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.current = this._parse(DEFAULT_PALETTE);
    this.target = this._parse(DEFAULT_PALETTE);
    this.transition = 1; // 0→1 전환 진행도
    this.face = { x: 0.5, y: 0.5, w: 0.3, present: false };
    this.smoothFace = { x: 0.5, y: 0.5, w: 0.3 };

    for (let i = 0; i < 70; i++) {
      this.particles.push({
        x: Math.random(),
        y: Math.random(),
        size: 1 + Math.random() * 3,
        speed: 0.0002 + Math.random() * 0.0006,
        drift: (Math.random() - 0.5) * 0.0004,
        depth: 0.3 + Math.random() * 0.7, // 깊을수록 시차가 큼
        alpha: 0.15 + Math.random() * 0.5,
      });
    }
  }

  _parse(p) {
    return { base: hexToRgb(p.base), glow: hexToRgb(p.glow), accent: hexToRgb(p.accent) };
  }

  setPalette(palette) {
    this.current = this._blended();
    this.target = this._parse(palette);
    this.transition = 0;
  }

  _blended() {
    const t = Math.min(1, this.transition);
    return {
      base: lerpColor(this.current.base, this.target.base, t),
      glow: lerpColor(this.current.glow, this.target.glow, t),
      accent: lerpColor(this.current.accent, this.target.accent, t),
    };
  }

  setFace(face) {
    this.face = face;
  }

  render(dt) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (this.transition < 1) this.transition = Math.min(1, this.transition + dt / 2000);
    const pal = this._blended();

    // 얼굴 위치 스무딩
    const f = this.smoothFace;
    const k = Math.min(1, dt / 200);
    f.x = lerp(f.x, this.face.x, k);
    f.y = lerp(f.y, this.face.y, k);
    f.w = lerp(f.w, this.face.w, k);

    // 1) 가장자리 컬러 워시 — 얼굴 주변은 투명하게 남김
    const cx = f.x * W, cy = f.y * H;
    const clearR = Math.max(W, H) * (this.face.present ? f.w * 1.6 : 0.2);
    const grad = ctx.createRadialGradient(cx, cy, clearR, cx, cy, Math.max(W, H) * 0.95);
    grad.addColorStop(0, rgba(pal.base, 0));
    grad.addColorStop(0.55, rgba(pal.base, 0.45));
    grad.addColorStop(1, rgba(pal.base, 0.85));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 2) 얼굴 주변 글로우 링
    if (this.face.present) {
      const ringR = f.w * W * 1.15;
      const ring = ctx.createRadialGradient(cx, cy, ringR * 0.85, cx, cy, ringR * 1.35);
      ring.addColorStop(0, rgba(pal.glow, 0));
      ring.addColorStop(0.5, rgba(pal.glow, 0.22));
      ring.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = ring;
      ctx.fillRect(0, 0, W, H);
    }

    // 3) 파티클 — 얼굴이 움직인 방향의 반대로 흐름 (시차)
    const px = (0.5 - f.x), py = (0.5 - f.y);
    for (const p of this.particles) {
      p.y -= p.speed * dt;
      p.x += p.drift * dt;
      if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      if (p.x < -0.05) p.x = 1.05;
      if (p.x > 1.05) p.x = -0.05;

      const drawX = (p.x + px * p.depth * 0.15) * W;
      const drawY = (p.y + py * p.depth * 0.15) * H;
      ctx.fillStyle = rgba(pal.accent, p.alpha * (this.face.present ? 1 : 0.4));
      ctx.beginPath();
      ctx.arc(drawX, drawY, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
