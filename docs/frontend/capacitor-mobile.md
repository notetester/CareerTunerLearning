# 모바일 앱: Capacitor와 release-safe 네트워크

> CareerTuner Android 앱은 React 빌드 산출물을 Capacitor 8 네이티브 프로젝트에 넣는다. release 기본은 HTTPS 전용이고, 로컬 HTTP live reload는 명시적인 debug profile에서만 제한적으로 허용한다.

## 왜 Capacitor인가

웹·PWA·Android가 같은 React 기능 코드를 공유하면서 카메라·마이크·푸시·파일·딥링크 같은 네이티브 기능을 사용할 수 있다. 비즈니스 규칙은 Spring API에 남기고 모바일은 입력 장치와 앱 생명주기를 담당한다.

```text
frontend/src React UI
  → Vite dist
  → Capacitor sync
  → android/ Gradle project
  → APK/AAB
```

## 현재 버전과 프로젝트 구조

| 항목 | 현재 값 |
| --- | --- |
| Capacitor core/Android | 8.4.1 |
| 앱 코드 | React 19.2.7 + Vite 8.1.4 |
| 네이티브 프로젝트 | `frontend/android/` 추적 |
| 앱 식별자 | `com.careertuner.app` |
| web build | `frontend/dist/` |

`capacitor.config.js`는 고정 객체가 아니라 `scripts/capacitor-config-policy.cjs`가 환경과 sync mode를 검증해 만든다. 그래서 로컬 편의 설정이 release에 섞이면 sync·빌드 단계에서 실패한다.

## release 기본 정책

release sync에서 다음을 강제한다.

- WebView origin은 HTTPS
- 평문 네트워크 차단
- mixed content 차단
- 외부 live-reload `server.url` 금지
- WebView 원격 디버깅 비활성
- main manifest와 network security config도 평문 차단

JavaScript 설정 한 곳만 믿지 않고 생성 설정, Android manifest, network security XML, Gradle release gate를 겹쳐 검사한다. 한 층이 잘못 바뀌어도 서명 전에 실패하도록 만든 것이다.

## 로컬 live reload 예외

실기기에서 개발 서버를 직접 보려면 명시적으로 debug mode를 선택해야 한다.

```powershell
$env:CAP_SYNC_MODE = "debug"
$env:CAP_SERVER_URL = "http://<private-development-host>:5173"
$env:CAP_ALLOW_CLEARTEXT = "true"
npm run native:sync -- android
```

정책 함수는 HTTP host가 localhost, 사설 LAN, link-local, Tailscale 범위인지 검사한다. 공인 HTTP host, URL 자격증명, fragment는 거부한다. debug source set만 OS 평문 통신을 열고 WebView mixed content는 계속 차단한다.

이 예외는 개발 편의이며 APK release 설정이 아니다.

## API 주소

번들 앱에서 상대 `/api`는 기기 자신의 origin을 가리킬 수 있다. 실제 backend와 연결하는 build는 도달 가능한 HTTPS API base를 `VITE_API_BASE_URL`로 주입한다. 값은 코드에 하드코딩하거나 공개 문서에 실제 운영 주소로 복사하지 않는다.

mock demo build는 backend 없이 동작한다. 단, 운영 API가 정상일 때 mock을 우선하지 않으며 장애 판정 경로에서만 독립 데모로 전환한다.

## OAuth와 verified App Link

커스텀 스킴 callback은 다른 앱이 같은 스킴을 등록할 수 있어 인증 결과 소유권이 약하다. 네이티브 소셜 로그인과 계정 연결 결과는 canonical HTTPS origin의 verified App Link로 앱에 돌아오게 한다.

필수 조건은 다음과 같다.

1. release 인증서 SHA-256 지문을 얻는다.
2. 웹 origin의 `/.well-known/assetlinks.json`에 패키지와 지문을 게시한다.
3. Android intent filter를 `autoVerify`로 선언한다.
4. 실제 release APK에서 OS verified 상태를 확인한다.

코드·APK 빌드 성공만으로 verified 완료를 주장하지 않는다. 공개 JSON, 실제 서명 인증서, 설치된 앱의 OS 상태가 모두 일치해야 한다.

### iOS 현재 경계

Apple 개발자 기능은 활성화해 테스트 중이지만 Team ID는 아직 발급하지 않았다. 따라서 `IOS_APP_LINK_TEAM_IDS`가 비어 있을 때 생성되는 AASA의 `details: []`는 실수나 장애가 아니라 iOS callback을 fail-closed 하는 안전 기본값이다. Team ID 발급 후 repository variable 등록 → 웹 재배포 → AASA `details` → 실기기 Universal Link 순으로 확인한다. 이 후속 작업은 현재 웹·Android·Desktop 시연의 차단 사항이 아닌 `DEFERRED`다.

## 권한과 기능

| 권한/기능 | 사용처 | 실패 처리 |
| --- | --- | --- |
| 카메라 | 화상 면접 | 거부 시 카메라 없는 면접 경로 유지 |
| 마이크 | 음성 답변·STT | 거부·미지원 안내, 텍스트 입력 유지 |
| 파일·미디어 | 이력서·포트폴리오·문의 첨부 | 시스템 picker와 소유권 검사 |
| 알림 | 면접·분석·플래너 알림 | 권한 없으면 앱 내부 알림 유지 |
| foreground service | 플래너 동기화 | Android lifecycle에 맞춘 상태 표시 |

하드웨어 feature는 optional로 선언해 카메라·마이크가 없는 기기에서도 설치 자체가 막히지 않게 한다.

## PWA와 Android의 차이

| PWA | Android |
| --- | --- |
| 브라우저 설치, 별도 서명 없음 | APK/AAB 서명 필요 |
| 브라우저 권한 모델 | Android runtime permission + WebView 전달 |
| URL navigation | verified App Link와 intent filter |
| 서비스워커 업데이트 | 앱 package + web asset sync |

같은 React UI를 공유해도 권한·딥링크·back button·resume 이벤트는 Android에서 별도 검증한다.

## 빌드와 검증

```bash
npm run mobile:sync
npm run mobile:apk
```

release에서는 서명 설정이 없으면 명시적으로 실패한다. 시연용 CI release 키와 최종 스토어 키를 같은 것으로 가정하지 않는다.

회귀 테스트는 다음을 포함한다.

- release 설정 생성 시 외부 `server.url`과 평문 opt-in 거부
- debug HTTP가 사설 host에서만 허용되는지
- main/release manifest와 network security XML
- APK 설치·cold launch·하단 탭·뒤로가기
- 390px 반응형과 라이트/다크
- 카메라·마이크·파일 권한 허용/거부
- verified App Link callback

## 면접에서의 짧은 답변

> “Capacitor로 React 코드를 Android와 공유하되 네트워크 정책은 mode별 생성 함수로 분리했습니다. release는 HTTPS·mixed content 차단·외부 server URL 금지를 설정과 manifest, Gradle에서 반복 검증합니다. 로컬 HTTP live reload는 debug와 사설 host opt-in을 모두 만족할 때만 허용하고, OAuth 복귀는 커스텀 스킴 대신 실제 인증서 지문이 검증된 HTTPS App Link를 사용합니다.”

## 근거 경로

- `frontend/capacitor.config.js`
- `frontend/scripts/capacitor-config-policy.cjs`
- `frontend/scripts/test-capacitor-config.mjs`
- `frontend/android/app/src/main/AndroidManifest.xml`
- `frontend/android/app/src/main/res/xml/network_security_config.xml`
- `frontend/android/app/src/debug/`
- `frontend/MOBILE_BUILD.md`
