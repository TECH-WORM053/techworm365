// 분석기 — "AI 해석" 자리를 담당하는 교체 가능한 모듈
//
// 지금은 localAnalyzer(기기 안 근사 계산)만 사용합니다.
// 나중에 Claude API를 붙일 때는 같은 형태의 결과
//   { faceShape, mood, style, confidence }
// 를 돌려주는 claudeAnalyzer를 만들어 app.js에서 바꿔 끼우면 됩니다.
// (서버로 프레임을 보내는 코드는 그때 추가 — 지금 버전은 어떤 데이터도 전송하지 않음)

// MediaPipe FaceLandmarker 랜드마크 인덱스 (468점 기준 근사)
const IDX = {
  foreheadTop: 10,
  chin: 152,
  cheekL: 234,
  cheekR: 454,
  jawL: 172,
  jawR: 397,
  foreheadL: 103,
  foreheadR: 332,
};

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 얼굴형 근사 판정 — 비율 기반이므로 참고용
export function estimateFaceShape(landmarks) {
  const width = dist(landmarks[IDX.cheekL], landmarks[IDX.cheekR]);
  const height = dist(landmarks[IDX.foreheadTop], landmarks[IDX.chin]);
  const jaw = dist(landmarks[IDX.jawL], landmarks[IDX.jawR]);
  const forehead = dist(landmarks[IDX.foreheadL], landmarks[IDX.foreheadR]);
  if (width === 0) return "계란형";

  const ratio = height / width;
  const jawRatio = jaw / width;

  if (ratio > 1.42) return "긴형";
  if (ratio < 1.15) return jawRatio > 0.92 ? "각진형" : "둥근형";
  if (forehead > jaw * 1.1) return "하트형";
  if (jawRatio > 0.95) return "각진형";
  return "계란형";
}

// 블렌드셰이프(표정 수치) → 무드 근사
export function estimateMood(blendshapes) {
  const get = (name) => {
    const c = blendshapes.find((b) => b.categoryName === name);
    return c ? c.score : 0;
  };
  const smile = (get("mouthSmileLeft") + get("mouthSmileRight")) / 2;
  const browDown = (get("browDownLeft") + get("browDownRight")) / 2;
  const browUp = get("browInnerUp");
  const eyeWide = (get("eyeWideLeft") + get("eyeWideRight")) / 2;

  if (smile > 0.35) return "밝은";
  if (eyeWide > 0.35 || get("jawOpen") > 0.4) return "호기심";
  if (browDown > 0.3) return "집중된";
  if (browUp > 0.45) return "생각에 잠긴";
  return "차분한";
}

// 얼굴 아래(상의 부근) 픽셀 색 → 스타일 근사
export function estimateStyle(video, faceBox) {
  const canvas = estimateStyle._canvas || (estimateStyle._canvas = document.createElement("canvas"));
  const w = 48, h = 24;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // 얼굴 박스 바로 아래 영역을 축소 샘플링
  const sx = Math.max(0, faceBox.x * video.videoWidth - faceBox.w * video.videoWidth * 0.5);
  const sy = Math.min(video.videoHeight - 1, (faceBox.y + faceBox.h) * video.videoHeight);
  const sw = Math.min(video.videoWidth - sx, faceBox.w * video.videoWidth * 2);
  const sh = Math.min(video.videoHeight - sy, video.videoHeight * 0.25);
  if (sw <= 0 || sh <= 0) return "모던·시크";

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let rSum = 0, gSum = 0, bSum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
  }
  const r = rSum / n, g = gSum / n, b = bSum / n;
  const brightness = (r + g + b) / 3 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  if (saturation > 0.45 && brightness > 0.25) return "비비드";
  if (brightness < 0.3) return "모던·시크";
  return "미니멀·소프트";
}

// app.js가 3초마다 호출하는 진입점
// input: { landmarks, blendshapes, video, faceBox }
export function localAnalyzer(input) {
  const faceShape = estimateFaceShape(input.landmarks);
  const mood = estimateMood(input.blendshapes);
  const style = estimateStyle(input.video, input.faceBox);
  return { faceShape, mood, style, source: "on-device (근사)" };
}
