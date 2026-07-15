# FOLD / FACE — Codex Prototype 001

웹캠에서 얼굴을 감지하면 절차적으로 만든 3D 선글라스가 접힌 상태에서 펼쳐지고, 얼굴로 이동해 실시간 착용되는 데스크톱 프로토타입입니다.

## 실행

```powershell
cd "C:\Users\OWNER\Desktop\claude tech00\codex-fold-to-face-prototype"
npm.cmd start
```

Chrome에서 `http://127.0.0.1:5186`을 열고 **카메라 시작**을 누른 뒤 카메라 권한을 허용합니다.

## 상태 흐름

`FOLDED → OPENING → FLYING → WORN → CLOSING`

- 얼굴이 나타나면 자동으로 펼쳐져 착용됩니다.
- 얼굴을 화면에서 빼면 선글라스가 돌아와 접힙니다.
- `다시 펼치기` 버튼으로 동작을 반복할 수 있습니다.
- MediaPipe 추론은 브라우저에서 실행되며 영상/API 데이터는 외부로 전송되지 않습니다.

## 현재 프로토타입 범위

- 프레임과 양쪽 안경다리가 분리된 Three.js 오브젝트
- 얼굴 중심, 크기, 기울기, 좌우 회전 추적
- 얼굴 3D 변환 행렬 기반 고개 회전 추적
- 안경 옆에서 엄지·검지를 붙이고 벌리는 손동작으로 안경다리 접기/펴기
- 단일 Codex 오리지널 프레임
- 다음 단계: 머리 가림(occlusion), GLB 제품 교체, 제스처 트리거, 모바일 최적화

## Silver Vine 001 오브젝트

제공된 제품 사진을 바탕으로 제작한 프로토타입용 모델입니다. 얇은 직사각 실버 프레임, 투명 렌즈, 코받침, 세 가닥의 유기적인 와이어 장식과 금속 결절을 절차적 3D 메시로 구성했습니다.

- 실행 모델 소스: `eyewear-model.js`
- GLB 결과물: `assets/models/silver-vine-glasses.glb`
- 분리 구조: `Frame`, `Lens_L`, `Lens_R`, `Temple_L`, `Temple_R`
- 양쪽 `Temple`의 원점은 힌지에 위치하므로 독립적으로 접을 수 있습니다.
- 모델 재출력: `npm.cmd run export:model`
