# Mobile Camera & HTTPS Deployment

## 구현된 모바일 경로

### 1. HTTPS 실시간 미러

휴대폰에서 HTTPS 주소로 접속하면 `getUserMedia()`를 사용해 실시간 전면·후면 카메라를 엽니다.

- 화면의 `전면/후면 전환` 버튼으로 카메라 방향 변경
- 전면 미리보기와 촬영 결과만 거울처럼 좌우 반전
- 후면 카메라는 반전하지 않음
- 카메라 스트림은 촬영, 화면 이탈, 탭 숨김, 초기화 시 중지

### 2. 휴대폰 기본 카메라로 한 장 촬영

실시간 카메라가 막혀도 다음 입력을 사용할 수 있습니다.

- 전면 촬영: `capture="user"`
- 후면 촬영: `capture="environment"`
- 지원하지 않는 브라우저에서는 일반 사진 선택 창으로 대체

선택한 파일은 Blob URL로 현재 브라우저 메모리에서 디코딩합니다. 파일명, EXIF, MIME, 원본 크기를 로그에 남기지 않으며 Blob URL은 Canvas 복사 직후 폐기합니다.

## PC와 같은 와이파이에서 임시 확인

```powershell
node server.mjs --lan
```

서버 출력의 `Phone one-shot mode` 주소를 휴대폰에서 엽니다. 예:

```text
http://192.168.0.10:5174
```

이 HTTP 주소에서는 브라우저 보안 정책상 실시간 영상이 열리지 않습니다. 대신 `전면 카메라 촬영` 또는 `후면 카메라 촬영` 버튼으로 한 장 촬영을 확인할 수 있습니다. Windows 방화벽이 연결을 막으면 로컬 네트워크 접근 허용이 별도로 필요할 수 있습니다.

`--lan`은 `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x` 사설 주소가 발견될 때만 서버를 해당 주소에 엽니다. 사설 주소가 없으면 안전을 위해 localhost 전용 상태를 유지합니다.

## GitHub Pages HTTPS 배포

저장소 루트의 `.github/workflows/codex-mirror-pages.yml`은 이 폴더만 GitHub Pages 아티팩트로 올립니다.

공식 문서 기준 사용 버전:

- `actions/checkout@v6`
- `actions/configure-pages@v5`
- `actions/upload-pages-artifact@v4`
- `actions/deploy-pages@v4`

배포 전 GitHub 저장소의 `Settings → Pages → Build and deployment → Source`를 **GitHub Actions**로 설정해야 합니다. 이후 워크플로와 이 폴더를 `main`에 push하면 HTTPS 주소가 생성됩니다.

예상 기본 주소:

```text
https://tech-worm053.github.io/techworm365/
```

실제 주소는 GitHub Actions의 `Deploy to GitHub Pages` 작업 결과에 표시됩니다.

## 개인정보 경계

- 호스팅 서비스는 일반적인 페이지 요청 로그(IP, User-Agent 등)를 보유할 수 있습니다.
- 프로토타입 JavaScript는 사진, Canvas 픽셀, 카메라 스트림을 호스팅 서버로 보내지 않습니다.
- 정적 배포에서도 HTML의 CSP가 외부 연결을 제한합니다.
- PNG 또는 JSON은 사용자가 저장/공유 버튼을 눌렀을 때만 현재 기기에서 내보냅니다.
