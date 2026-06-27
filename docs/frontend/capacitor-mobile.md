# 모바일 앱 (Capacitor)

> 같은 React 웹 코드를 안드로이드/iOS 네이티브 앱으로 감싸 출시하는 도구가 Capacitor다. 핵심은 "웹 코드 1벌 -> 네이티브 WebView 안에서 실행 + 네이티브 기능 브리지".

## 1. 한 줄 정의

Capacitor는 이미 만든 웹 앱(HTML/JS/CSS)을 **네이티브 WebView로 감싸서** Android/iOS 앱으로 패키징하고, JS에서 카메라·푸시 같은 네이티브 기능을 호출하게 해주는 크로스플랫폼 런타임이다. CareerTuner는 React/Vite로 만든 SPA를 그대로 앱으로 내보내는 데 이걸 쓴다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| Capacitor | 고유명사(Ionic 팀 제작). "축전기"가 아니라 제품명. Cordova의 후계 |
| WebView | OS가 제공하는 내장 브라우저 엔진. 앱 안에 박힌 크롬/사파리라고 보면 됨 |
| Bridge(브리지) | WebView의 JS와 네이티브(Java/Kotlin/Swift) 사이를 잇는 통신 계층 |
| `webDir` | WebView가 로드할 정적 산출물 폴더. CareerTuner는 Vite 빌드 결과 `dist` |
| Scheme | URL의 앞부분. `http://`, `https://`, `capacitor://` 등 앱 origin을 결정 |
| `cleartext` | 암호화 안 된 평문 HTTP 통신 허용 여부 |

:::tip
Capacitor는 React Native와 다르다. RN은 JS를 네이티브 UI로 "변환"하지만, Capacitor는 웹 화면을 WebView로 "그대로" 띄운다. 그래서 웹 코드 재사용률이 거의 100%다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **앱스토어 배포가 필요하다.** PWA만으로는 Google Play / App Store 정식 등록이 어렵다. Capacitor는 진짜 `.apk`/`.ipa`를 만든다.
- **코드 중복을 피한다.** 없으면 React 웹 + 별도 네이티브 앱을 두 번 만들어야 한다. Capacitor는 한 코드베이스로 웹·앱을 동시에 낸다.
- **네이티브 기능 접근.** 브라우저 샌드박스에서 못 하는 푸시 알림·파일·생체인증을 브리지로 호출한다.
- **분기 지점이 생긴다.** 웹과 앱은 홈 진입점·네비게이션이 달라야 하는데, 런타임에 "지금 네이티브냐"를 알아야 분기가 가능하다 -> 그래서 `isNativeApp()` 같은 어댑터가 필요하다.

## 4. CareerTuner에서 어디에 썼나 (영역: 프론트엔드)

| 항목 | 파일/설정 | 역할 |
| --- | --- | --- |
| 플랫폼 감지 어댑터 | `frontend/src/platform/capacitor.ts` | `isNativeApp` / `platformName` / `isAppContext` / `homePath` 등 분기 함수 모음 |
| 패키징 설정 | `frontend/capacitor.config.ts` | `appId` `com.careertuner.app`, `webDir: 'dist'`, `androidScheme: 'http'`, `cleartext: true` |
| 빌드 스크립트 | `package.json` | `mobile:sync`(=`cap sync android`), `mobile:apk` |
| 네이티브 프로젝트 | `frontend/android/`, `frontend/ios/` | Capacitor가 생성하는 안드로이드/iOS 셸 |

:::tip 영역 표시
이 페이지의 모든 코드는 **영역 C(본인)가 아니라 프론트엔드 모바일 영역**의 산출물이다. 면접에서 "내가 짠 코드냐"를 물으면 정직하게 "팀 프론트 영역에서 다룬 모바일 패키징"이라고 구분해 말하라.
:::

### 4-1. 플랫폼 분기 어댑터의 핵심

`capacitor.ts`는 네이티브 플러그인을 **하드 import 하지 않는다.** 대신 런타임에 안전하게 접근한다. 그래서 플러그인이 없는 순수 웹/PWA 환경에서도 깨지지 않는다.

```ts
// 네이티브 여부 (실패하면 무조건 false = 웹)
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// 플랫폼 이름: web | ios | android
export function platformName(): "web" | "ios" | "android" {
  try {
    const p = Capacitor.getPlatform();
    return p === "ios" || p === "android" ? p : "web";
  } catch {
    return "web";
  }
}
```

여기에 더해 CareerTuner만의 영리한 분기가 둘 있다.

- `isAppContext()`: 네이티브 앱이거나, **웹 브라우저에서 `?home`/`?ob` 쿼리로 앱을 미리보기** 하는 세션이면 "앱 컨텍스트"로 본다. 덕분에 PC 브라우저에서도 앱 레이아웃(로고·네비 분기)을 검증할 수 있다.
- `homePath()`: 앱이면 검색창 메인(`/?home`), 웹이면 대시보드 홈(`/home`)을 돌려준다. 로고·"홈으로" 버튼이 전부 이걸 써서 자동 분기한다.

### 4-2. 설정 파일의 결정들

```ts
const config: CapacitorConfig = {
  appId: 'com.careertuner.app',
  appName: 'CareerTuner',
  webDir: 'dist',
  server: {
    androidScheme: 'http',   // 앱 origin 도 http
    cleartext: true,         // 평문 http 백엔드 호출 허용
    ...(devServerUrl ? { url: devServerUrl } : {}),
  },
  android: { allowMixedContent: true },
};
```

`androidScheme: 'http'` + `cleartext: true`가 이 프로젝트의 핵심 결정이다. 백엔드가 HTTPS 인증서 없는 평문 HTTP(예: 사내망/터널 `<서버주소>:8080`)로 떠 있어서, **앱 origin도 http로 맞춰 same-scheme**으로 호출하고, AndroidManifest의 `usesCleartextTraffic`을 켠 것이다. 환경변수 `CAP_SERVER_URL`이 있으면 폰 WebView가 PC dev 서버를 직접 로드(라이브 리로드)하고, 없으면 번들된 `dist`를 로드(프로덕션 APK)한다.

:::warning
`cleartext: true`는 보안상 안전한 기본값이 아니다. 평문 HTTP는 도청·변조에 노출된다. 면접에서 "왜 켰나"를 물으면 "개발/내부망 백엔드가 아직 HTTPS 미적용이라 의도적으로 켠 것이고, 운영에서는 HTTPS + `cleartext: false`로 가야 한다"고 답하라. 실제 IP/도메인은 절대 말하지 말 것.
:::

## 5. 핵심 동작 원리 (단계)

빌드 -> 동기화 -> 네이티브 빌드의 3단계다.

```bash
# 1) 웹 빌드: Vite 가 dist/ 에 정적 산출물 생성
npm run build

# 2) 동기화: dist 를 네이티브 프로젝트로 복사 + 플러그인 등록
npx cap sync android        # = npm run mobile:sync

# 3) 네이티브 빌드: Gradle 로 APK 생성
./gradlew assembleDebug     # frontend/android 안에서
```

| 단계 | 입력 | 출력 | 누가 함 |
| --- | --- | --- | --- |
| build | React/TS 소스 | `dist/` (HTML/JS/CSS) | Vite |
| `cap sync` | `dist/` + `capacitor.config.ts` | `android/` 자산 갱신 + 플러그인 등록 | Capacitor CLI |
| `assembleDebug` | 네이티브 프로젝트 | `.apk` | Gradle |

런타임 흐름:

1. 앱 실행 -> OS가 네이티브 셸을 띄움
2. 셸이 WebView 생성 -> `webDir`(번들) 또는 `server.url`(dev) 로드
3. React 앱 부팅 -> `isNativeApp()`이 `true` -> 앱용 홈/네비로 분기 렌더링
4. API 호출은 `cleartext`/`androidScheme` 설정대로 백엔드에 도달
5. 네이티브 기능 필요 시 `nativePlugin('Push')` 식으로 브리지 호출

## 6. 면접 답변 3단계

- **초간단(1문장):** "Capacitor로 React 웹 코드를 네이티브 WebView로 감싸 안드로이드 앱으로 패키징했고, `isNativeApp()`으로 웹/앱 화면을 런타임 분기합니다."
- **기본:** "Vite 빌드(`dist`)를 `cap sync`로 네이티브 프로젝트에 복사하고 Gradle로 APK를 뽑습니다. `capacitor.ts`에 플랫폼 감지 어댑터를 모아 두고, 앱이면 검색 메인·웹이면 대시보드로 홈을 분기합니다. 네이티브 플러그인은 하드 import 대신 런타임 접근이라 웹/PWA에서도 안 깨집니다."
- **꼬리질문 대응:** "백엔드가 HTTPS 미적용 평문 HTTP라 `androidScheme: 'http'` + `cleartext: true`로 same-scheme 호출을 맞췄습니다. 이건 개발/내부망용 의도적 설정이고, 운영에서는 HTTPS로 전환해 cleartext를 꺼야 한다는 걸 인지하고 있습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Capacitor와 React Native 차이는?
RN은 JS 컴포넌트를 실제 네이티브 UI 위젯으로 변환해 렌더한다. Capacitor는 웹 화면을 WebView에 그대로 띄운다. RN은 네이티브 성능·룩이 좋지만 별도 UI 코드가 필요하고, Capacitor는 웹 코드 재사용률이 높고 학습비용이 낮다. CareerTuner는 이미 완성된 React 웹이 있어 재사용 극대화를 위해 Capacitor를 택했다.
:::

:::details Capacitor와 Cordova/PWA 차이는?
Cordova는 Capacitor의 전신으로, Capacitor가 더 현대적인 플러그인 모델과 네이티브 프로젝트 직접 편집을 지원한다. PWA는 브라우저 안에서 도는 설치형 웹이라 앱스토어 정식 배포와 일부 네이티브 API에 한계가 있다. CareerTuner는 PWA(`vite-plugin-pwa`)와 Capacitor를 둘 다 두고, 설치형 여부는 `isStandalone()`으로 함께 판단한다.
:::

:::details `cleartext: true`는 왜 켰고 위험하지 않나?
백엔드가 HTTPS 인증서 없는 평문 HTTP로 떠 있어서, 앱이 그 API에 닿으려면 평문 통신을 허용해야 했다. 평문은 중간자 공격에 노출되므로 안전한 기본값이 아니다. 개발/내부망 한정 의도적 설정이며, 운영 전환 시 백엔드 HTTPS화 + `cleartext: false`가 필수다.
:::

:::details 앱인지 웹인지 코드에서 어떻게 구분하나?
`Capacitor.isNativePlatform()`을 감싼 `isNativeApp()`을 쓴다. try/catch로 실패 시 false라서 순수 웹에서도 안전하다. 추가로 `isAppContext()`는 `?home` 쿼리 미리보기 세션도 앱 컨텍스트로 쳐서, PC 브라우저에서 앱 레이아웃을 검증할 수 있게 한다.
:::

:::details `cap sync`는 정확히 뭘 하나?
두 가지다. (1) `webDir`(=`dist`)의 웹 산출물을 네이티브 프로젝트로 복사하고, (2) 설치된 Capacitor 플러그인을 네이티브 측에 등록한다. 그래서 웹을 새로 빌드할 때마다 `sync`를 다시 돌려야 앱에 반영된다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "React 웹 한 벌을 어떻게 안드로이드 앱으로 냈는지"를 build -> `cap sync` -> `assembleDebug` 3단계로 30초 안에 설명해보라.
2. "왜 `androidScheme`를 http로 두고 cleartext를 켰나?"라는 압박 질문에, 보안 트레이드오프와 운영 전환 계획까지 한 호흡에 답해보라. (실제 IP/도메인은 말하지 않기)

관련 페이지: [PWA](/frontend/pwa) · [API 레이어](/frontend/api-layer-jwt-refresh) · [라우팅](/frontend/react-router)

## 퀴즈

<QuizBox question="Capacitor가 React Native와 가장 다른 점은?" :choices="['JS를 네이티브 UI 위젯으로 변환한다','웹 화면을 네이티브 WebView로 그대로 띄운다','서버 사이드 렌더링만 지원한다','iOS 전용이다']" :answer="1" explanation="Capacitor는 웹 산출물(dist)을 WebView로 그대로 로드한다. JS를 네이티브 위젯으로 변환하는 것은 React Native다." />

<QuizBox question="capacitor.config.ts에서 androidScheme를 http로 두고 cleartext를 true로 켠 이유는?" explanation="백엔드가 HTTPS 인증서 없는 평문 HTTP로 떠 있어서, 앱 origin도 http로 맞춰 same-scheme으로 호출하고 AndroidManifest의 usesCleartextTraffic을 켜 평문 통신을 허용한 것이다. 평문은 도청·변조에 취약하므로 안전한 기본값이 아니며, 개발/내부망 한정 의도적 설정이고 운영에서는 백엔드 HTTPS화 후 cleartext를 false로 꺼야 한다." />

<QuizBox question="frontend/src/platform/capacitor.ts의 isNativeApp()이 try/catch로 감싸 실패 시 false를 반환하는 이유는?" :choices="['성능 최적화를 위해','Capacitor 미설치 웹/PWA 환경에서도 안전하게 동작하게 하려고','타입 에러를 숨기려고','테스트를 건너뛰려고']" :answer="1" explanation="네이티브 플러그인을 하드 import 하지 않고 런타임에 안전 접근하므로, 플러그인이 없는 순수 웹/PWA에서도 예외 없이 false(=웹)로 동작한다." />
