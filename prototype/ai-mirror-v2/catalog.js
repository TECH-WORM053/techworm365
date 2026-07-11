// 제품 카탈로그 + 추천 규칙
// 출처: experiments/exp02-제품추천/제품카탈로그.md (실험용 정리본)
// 이미지: assets/products/<id>.jpg 가 있으면 사용, 없으면 일러스트로 대체

export const PRODUCTS = [
  {
    id: "papas-01",
    name: "Papas 01",
    frame: "가는 아세테이트 D-프레임 · 메탈 컷아웃 템플",
    shape: "dframe",
    moods: ["실험적", "개성", "도회적"],
    faceShapes: ["둥근형", "계란형", "각진형", "긴형", "하트형"],
    note: "대부분 얼굴형에 무난, 개성 강조",
  },
  {
    id: "her-01",
    name: "Her 01",
    frame: "각진 스퀘어 · 블랙 아세테이트",
    shape: "square",
    moods: ["클래식", "데일리", "정제"],
    faceShapes: ["둥근형"],
    note: "둥근 얼굴에 각을 더해줌",
  },
  {
    id: "lang-01",
    name: "Lang 01",
    frame: "라운드 플랫바 · 원형 스터드 디테일",
    shape: "round",
    moods: ["부드러움", "미니멀", "유니크"],
    faceShapes: ["둥근형", "하트형"],
    note: "작고 둥근 얼굴",
  },
  {
    id: "liliit-01",
    name: "Liliit 01",
    frame: "오버사이즈 스퀘어 · 라운딩 프론트 · 사이드 메탈",
    shape: "oversize",
    moods: ["존재감", "시크", "와이드"],
    faceShapes: ["계란형", "하트형"],
    note: "작은 얼굴이 무드 있게 소화",
  },
  {
    id: "pino-01",
    name: "Pino 01",
    frame: "구조적인 스퀘어 실루엣 · 사이드 메탈 아이콘",
    shape: "square",
    moods: ["트렌디", "균형"],
    faceShapes: ["긴형", "각진형"],
    note: "길거나 각진 얼굴 커버",
  },
  {
    id: "jade-01",
    name: "Jade 01",
    frame: "렌즈가 작은 라운드",
    shape: "round",
    moods: ["담백", "절제", "조용함", "미니멀"],
    faceShapes: ["계란형", "하트형"],
    note: "작은 얼굴, 미니멀 선호",
  },
  {
    id: "malta-01",
    name: "Malta 01",
    frame: "볼륨감 있는 라운드 실루엣",
    shape: "round",
    moods: ["럭셔리", "무게감"],
    faceShapes: ["각진형", "둥근형"],
    note: "넓은 얼굴에 곡선감",
  },
];

// 분석기가 내놓는 무드·스타일 단어 → 카탈로그 무드 단어 연결
const MOOD_LINKS = {
  "밝은":        ["트렌디", "개성", "유니크"],
  "차분한":      ["담백", "절제", "조용함", "정제", "클래식"],
  "집중된":      ["시크", "구조", "존재감", "정제"],
  "생각에 잠긴": ["미니멀", "절제", "조용함"],
  "호기심":      ["실험적", "유니크", "개성"],
};

const STYLE_LINKS = {
  "모던·시크":     ["시크", "정제", "무게감", "클래식", "존재감"],
  "비비드":        ["개성", "실험적", "트렌디", "유니크"],
  "미니멀·소프트": ["미니멀", "담백", "부드러움", "절제"],
};

// 분석 결과(analysis: {faceShape, mood, style}) → 점수순 상위 3개
export function recommend(analysis) {
  const moodWords = new Set([
    ...(MOOD_LINKS[analysis.mood] || []),
    ...(STYLE_LINKS[analysis.style] || []),
  ]);

  const scored = PRODUCTS.map((p) => {
    let score = 0;
    const reasons = [];

    if (p.faceShapes.includes(analysis.faceShape)) {
      score += 3;
      reasons.push(`${analysis.faceShape}에 어울리는 프레임`);
    } else if (p.faceShapes.length >= 5) {
      score += 1; // 대부분 얼굴형 커버
    }

    const moodHits = p.moods.filter((m) => moodWords.has(m));
    score += moodHits.length * 1.5;
    if (moodHits.length > 0) {
      reasons.push(`지금 무드(${analysis.mood}·${analysis.style})와 ${moodHits[0]} 결이 맞음`);
    }

    if (reasons.length === 0) reasons.push(p.note);
    return { product: p, score, reason: reasons.join(" · ") };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

// 무드별 표시 문구 (분석이 갱신될 때 하나씩 순환)
const PHRASES = {
  "밝은": [
    "표정의 온도가 먼저 읽혔습니다.",
    "빛이 얼굴의 곡선을 따라 움직입니다.",
  ],
  "차분한": [
    "고요한 얼굴에는 절제된 선이 어울립니다.",
    "잔잔함이 프레임의 무게를 정합니다.",
  ],
  "집중된": [
    "시선의 방향이 스타일을 결정합니다.",
    "단단한 표정에는 구조적인 실루엣을.",
  ],
  "생각에 잠긴": [
    "생각의 깊이만큼 미니멀하게.",
    "말없는 얼굴이 가장 많은 것을 고릅니다.",
  ],
  "호기심": [
    "낯선 프레임이 어울리는 순간입니다.",
    "익숙하지 않은 모양을 시도해도 좋은 얼굴.",
  ],
};

export function pickPhrase(mood, index) {
  const list = PHRASES[mood] || PHRASES["차분한"];
  return list[index % list.length];
}

// 무드별 배경 팔레트 (effects.js가 사용)
export const MOOD_PALETTES = {
  "밝은":        { base: "#1a1408", glow: "#e8b84b", accent: "#f4e3b2" },
  "차분한":      { base: "#0c1214", glow: "#4b8a8a", accent: "#bcd8d8" },
  "집중된":      { base: "#120c14", glow: "#7a4be8", accent: "#cdb2f4" },
  "생각에 잠긴": { base: "#0d0f1a", glow: "#4b6ae8", accent: "#b2c3f4" },
  "호기심":      { base: "#140c0c", glow: "#e84b6a", accent: "#f4b2c0" },
};
