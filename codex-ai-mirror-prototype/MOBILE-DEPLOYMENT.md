# Mobile Camera & HTTPS Deployment

## 휴대폰에서 여는 주소

```text
https://tech-worm053.github.io/techworm365/
```

휴대폰의 Chrome 또는 Safari에서 위 HTTPS 주소를 열고 `카메라 켜기`를 누른 뒤 카메라 권한을 허용합니다. 첫 실행에는 로컬 비전 모델과 WASM을 받기 때문에 네트워크 상태에 따라 몇 초 더 걸릴 수 있습니다.

## 구현된 모바일 동작

- `getUserMedia()` 기반 연속 카메라 스트림
- `playsinline`으로 iPhone 전체화면 영상 전환 방지
- 전면 카메라는 영상·인물 마스크·얼굴 좌표를 함께 좌우 반전
- 후면 카메라는 반전 없이 표시
- 카메라 전환 시 이전 트랙을 중지한 뒤 새 트랙 연결
- 화면을 닫거나 처음으로 돌아가면 카메라 트랙 중지
- 긴 변 1280px 이하의 내부 Canvas와 분리된 추론 주기로 모바일 부하 제한

사진 촬영 또는 파일 업로드 대체 경로는 없습니다. 카메라가 없는 환경에서는 `카메라 없이 데모`로 화면 구성만 확인할 수 있습니다.

## 열리지 않을 때

### iPhone Safari

1. 주소가 `https://`인지 확인합니다.
2. 주소창 왼쪽의 페이지 메뉴 → 웹사이트 설정 → 카메라 → 허용을 선택합니다.
3. 다른 카메라 앱이나 영상 통화 앱을 닫고 페이지를 새로고침합니다.

### Android Chrome

1. 주소창 자물쇠/사이트 정보 → 권한 → 카메라 → 허용을 선택합니다.
2. Chrome의 Android 앱 권한에도 카메라가 허용되어 있는지 확인합니다.
3. 카메라가 검게 나오면 다른 카메라 앱을 닫고 `다시 연결`을 누릅니다.

### 모델 준비 화면이 오래 유지될 때

- Wi-Fi나 데이터 연결을 확인하고 한 번 새로고침합니다.
- 브라우저의 절전 모드를 해제합니다.
- 메모리가 적은 기기는 자동으로 `PERSON MASK / ECO` 또는 `FACE TRACK / LITE`로 내려갑니다.

## PC 로컬 실행

```powershell
cmd /c npm run start
```

PC에서는 `http://127.0.0.1:5174`를 사용합니다. 같은 와이파이의 `http://192.168...` 주소는 휴대폰 카메라의 보안 컨텍스트가 아니므로 라이브 확인용으로 사용하지 않습니다.

## GitHub Pages 배포

저장소의 `.github/workflows/codex-mirror-pages.yml`은 `codex-ai-mirror-prototype/`만 Pages 아티팩트로 배포합니다. 저장소의 `Settings → Pages → Source`가 `GitHub Actions`로 설정된 상태에서 `main`에 push하면 다시 배포됩니다.

배포 전 검사:

```powershell
cmd /c npm run check
cmd /c npm test
```

## 네트워크와 개인정보

- GitHub Pages는 일반적인 페이지 요청 로그를 보유할 수 있습니다.
- 브라우저는 같은 출처에서 앱 코드, MediaPipe WASM·모델, 제품 이미지를 내려받습니다.
- 카메라 프레임, 인물 마스크, 얼굴 랜드마크, 추천 계산값은 업로드하지 않습니다.
- CSP는 스크립트·모델 연결을 같은 출처로 제한합니다.
