# Codex Live Vision Mirror — Prototype v0.3

> Codex 전용 작업 폴더입니다. Claude Code 프로토타입과 코드·자산·실행 포트를 공유하지 않습니다.

## 한 문장 정의

사진을 찍고 기다리는 분석기가 아니라, 카메라가 켜진 동안 얼굴과 인물 영역을 계속 추적해 배경·이펙트·선글라스 추천 순위가 함께 반응하는 라이브 AI 미러입니다.

## 지금 작동하는 것

- 휴대폰 전면·후면 실시간 카메라와 거울 반전
- MediaPipe Face Landmarker의 연속 얼굴 랜드마크 추적
- MediaPipe Selfie Segmenter의 인물·배경 분리
- `GLASS BLOOM`, `CHROME TIDE`, `NEON FRACTURE` 3개 반응형 공간
- 얼굴이 안정적으로 잡힐 때 발생하는 버스트와 얼굴 위치를 따라가는 효과
- 움직임 속도와 카메라 거리 변화에 따른 공간 전환
- EX2에서 프로토타입 후보로 고른 `Papas 01`, `Liliit 01`, `Malta 01`의 라이브 순위
- 순위·제품 이미지·이름만 표시하는 추천 카드
- 카메라가 없는 환경을 위한 합성 데모 루프
- 저사양 기기에서 추론 주기를 낮추거나 얼굴 중심 LITE 모드로 전환하는 폴백

사진 촬영, 사진 업로드, 한 프레임 분석, 해석 선택, 결과 저장 단계는 메인 경험에서 제거했습니다.

## 기술 구조

```text
camera stream
  ├─ Face Landmarker → 얼굴 위치 · 크기 · 움직임
  ├─ Selfie Segmenter → 인물 마스크
  └─ Canvas → 반응형 배경 → 인물 → 얼굴 고정 이펙트
                                  └─ EX2 추천 TOP 3
```

모델과 WASM은 이 폴더의 `models/`, `vendor/`에서 같은 출처로 불러옵니다. 실행 시 OpenAI·Anthropic 같은 외부 API나 API 키를 사용하지 않습니다.

## 실행과 검사

```powershell
cmd /c npm run start
```

PC 브라우저에서 `http://127.0.0.1:5174`를 엽니다. `localhost` 카메라는 브라우저의 보안 예외로 사용할 수 있지만, 휴대폰 카메라는 HTTPS Pages 주소가 필요합니다.

```powershell
cmd /c npm run check
cmd /c npm test
```

테스트는 라이브 단일 화면, MediaPipe 모델·WASM·제품 이미지, MIME/CSP, 사진 업로드 제거, 외부 프레임 전송 코드 부재를 확인합니다.

## 개인정보 경계

- 카메라 영상과 Canvas 픽셀을 서버나 외부 API로 전송하지 않습니다.
- 카메라 프레임은 현재 탭의 메모리에서만 추론·합성합니다.
- localStorage, IndexedDB, 쿠키에 얼굴 또는 추천 신호를 기록하지 않습니다.
- 처음 화면으로 돌아가거나 페이지를 닫으면 카메라 트랙을 중지하고 Canvas를 지웁니다.
- 네트워크는 같은 출처의 정적 HTML, JavaScript, WASM, 모델, 제품 이미지를 받는 데만 사용합니다.

## 정직한 한계

- 현재 실제 인식 대상은 임의의 모든 사물이 아니라 `얼굴 + 가까운 인물 영역`입니다.
- 배경과 파티클은 생성형 이미지 API가 아니라 실시간 Canvas 그래픽입니다. 얼굴·인물 추적과 분리는 실제 온디바이스 ML 모델이 수행합니다.
- 추천 점수는 프로토타입 규칙이며 구매 적합성이나 얼굴형에 대한 객관적 판정이 아닙니다.
- 제품 이미지는 EX2 카탈로그의 형태 설명을 토대로 만든 비공식 프로토타입 시각물이며 공식 상품 사진이 아닙니다.

## 주요 파일

- `index.html` — 시작 화면과 단일 라이브 미러 UI
- `app.js` — 카메라 수명주기, 화면 상태, 추천 목록 연결
- `vision-engine.js` — Face Landmarker와 Selfie Segmenter 추론
- `live-renderer.js` — 배경 교체, 인물 합성, 버스트와 추적 효과
- `catalog-data.js` — EX2 프로토타입 후보 3개
- `recommendation-engine.js` — 흔들림을 억제한 라이브 순위 계산
- `assets/products/` — 비공식 제품 프로토타입 이미지
- `models/`, `vendor/` — 같은 출처에서 제공하는 MediaPipe 런타임·모델
- `server.mjs` — 로컬 정적 서버와 보안 헤더
- `smoke-test.mjs` — 정적 자산·보안·구조 자동 검사
- `THIRD-PARTY-NOTICES.md` — MediaPipe 런타임·모델 출처와 제품 시각물 범위

휴대폰 실행과 배포 방법은 [MOBILE-DEPLOYMENT.md](MOBILE-DEPLOYMENT.md)에 정리했습니다.
