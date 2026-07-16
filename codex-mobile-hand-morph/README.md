# Codex Mobile Hand Morph

TouchDesigner에서 검증한 PLY 점 구름 모핑을 휴대폰 브라우저용으로 옮긴 프로토타입입니다.

## 동작

- 휴대폰 전면/후면 카메라
- MediaPipe Hand Landmarker 2-hand tracking
- 한 손 핀치: 점 흩어짐
- 핀치 해제: sphere/torus morph
- 손 위치: 오브젝트 X/Y 이동
- 양손 간격: 오브젝트 크기
- 모든 비전 처리는 브라우저 안에서 실행

## 실행

```powershell
npm.cmd install
npm.cmd run dev
```

PC에서는 localhost로 확인할 수 있습니다. 휴대폰 카메라는 보안 정책상 HTTPS 배포 주소가 필요합니다.
