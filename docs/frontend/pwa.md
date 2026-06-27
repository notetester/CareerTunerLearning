# PWA와 서비스워커

> 웹앱을 설치 가능한 앱처럼 만들고, 서비스워커가 정적 자산을 캐시해 빠르게 띄우되 민감한 `/api` 응답은 절대 캐시하지 않게 한 게 핵심입니다.

## 1. 한 줄 정의

PWA(Progressive Web App)는 **웹 기술로 만든 페이지를 설치형 앱처럼 동작하게 만드는 표준 묶음**이고, 서비스워커는 그 핵심으로 **브라우저와 네트워크 사이에 끼어드는 백그라운드 스크립트**입니다. CareerTuner는 `vite-plugin-pwa`로 manifest와 서비스워커를 자동 생성합니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 | 한 줄 의미 |
| --- | --- | --- |
| PWA | Progressive Web App | 점진적으로 향상되는 웹앱(설치·오프라인·푸시까지) |
| Service Worker | (고유명) | 페이지와 별개로 도는 네트워크 프록시 워커 |
| Manifest | 명세서 | 앱 이름·아이콘·시작 화면을 적은 JSON |
| Workbox | Work + Box | 구글이 만든 서비스워커 생성/캐시 라이브러리 |
| Precache | Pre + cache | 빌드 시점에 미리 캐시에 박아두는 것 |
| Runtime caching | 실행 시점 캐시 | 요청이 들어올 때 동적으로 캐시하는 것 |

:::tip 서비스워커를 한마디로
"페이지가 보내는 모든 요청을 가로채서, 캐시에서 줄지 네트워크로 보낼지 결정하는 중간 관문"입니다. 그래서 오프라인·푸시·백그라운드 동기화가 가능해집니다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **설치형 경험**: manifest가 없으면 홈 화면에 추가해도 브라우저 주소창이 그대로 보이는 "그냥 북마크"가 됩니다. manifest의 `display: standalone`이 있어야 앱처럼 전체화면으로 뜹니다.
- **재방문 속도**: 서비스워커 precache가 없으면 JS/CSS/폰트를 매번 네트워크에서 받아 첫 화면이 느립니다. precache가 있으면 재방문 시 거의 즉시 렌더됩니다.
- **푸시 알림**: 서비스워커가 없으면 탭이 닫힌 상태에서 Web Push를 받을 수 없습니다. 백그라운드에서 깨어날 주체가 필요합니다.
- **민감 데이터 캐시 사고**: 반대로 캐시를 잘못 걸면 큰일납니다. 적합도 분석·결제·프로필 같은 `/api` 응답이 서비스워커 캐시에 남으면, 다른 사람 데이터가 보이거나 만료된 분석 결과가 표시됩니다. 그래서 **무엇을 캐시하느냐만큼 무엇을 캐시하지 않느냐가 중요**합니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역 표시: 프론트엔드 공통 설정(빌드/PWA)은 팀 공통 영역. 아래 파일들이 근거입니다.

| 위치 | 역할 |
| --- | --- |
| `frontend/vite.config.ts` | `VitePWA({...})` 플러그인 설정. manifest·workbox·registerType 전부 여기서 정의 |
| `frontend/public/push-sw.js` | Web Push 핸들러(`push`/`notificationclick`). 생성된 서비스워커에 `importScripts`로 합쳐짐 |
| `frontend/public/icons/*` | manifest 아이콘(192/512/maskable), apple-touch-icon, favicon |

빌드하면 `vite-plugin-pwa`가 `dist/manifest.webmanifest`와 서비스워커(`sw.js`)를 자동 생성합니다. CareerTuner는 별도 등록 코드(`virtual:pwa-register` import)를 쓰지 않고, `registerType: 'autoUpdate'`로 **등록·갱신을 플러그인이 알아서** 처리하게 했습니다.

:::tip Capacitor와의 관계
이 PWA 빌드는 Capacitor 안드로이드/iOS WebView에서도 같은 산출물을 씁니다. 즉 "웹 설치형 PWA"와 "스토어 네이티브 앱"이 한 벌의 빌드를 공유합니다. 자세한 모바일 래핑은 [Capacitor](/frontend/capacitor-mobile) 참고.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 설정 요약 (vite.config.ts)

```ts
VitePWA({
  registerType: 'autoUpdate',          // 새 SW 나오면 자동 적용
  includeAssets: ['icons/...png', 'icons/icon.svg'],
  manifest: {
    name: 'CareerTuner',
    display: 'standalone',             // 주소창 없는 앱 모드
    theme_color: '#030213',
    icons: [ /* 192, 512, maskable */ ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'], // precache 대상
    navigateFallback: 'index.html',     // SPA 라우팅 폴백
    navigateFallbackDenylist: [/^\/api/], // /api 는 폴백/캐시 제외 (핵심!)
    cleanupOutdatedCaches: true,
    importScripts: ['push-sw.js'],      // 푸시 핸들러 병합
  },
})
```

### 5-2. 서비스워커 생명주기

| 단계 | 일어나는 일 |
| --- | --- |
| install | 새 서비스워커가 precache 자산을 캐시에 담음 |
| activate | 이전 서비스워커를 교체, 오래된 캐시 정리(`cleanupOutdatedCaches`) |
| fetch | 페이지의 모든 요청을 가로채 캐시/네트워크 분기 |
| push | 백엔드가 보낸 Web Push 수신 → 알림 배너 표시 |

### 5-3. `registerType: 'autoUpdate'` 의미

새 배포가 올라오면 서비스워커가 백그라운드에서 새 버전을 받고, 다음 진입 때 조용히 교체합니다. "업데이트 있어요, 새로고침할까요?" 팝업을 띄우는 `prompt` 방식과 달리, 사용자 개입 없이 최신화하는 방식입니다.

### 5-4. precache vs runtime caching — CareerTuner의 선택

```text
정적 자산(JS/CSS/HTML/폰트/아이콘) → precache O  (globPatterns)
/api 응답(분석·면접·결제·프로필)     → 캐시 X      (runtimeCaching 없음 + denylist)
```

CareerTuner는 **runtimeCaching을 아예 정의하지 않았습니다.** 즉 동적 API 응답을 캐시하는 규칙이 0개입니다. 거기에 `navigateFallbackDenylist: [/^\/api/]`까지 두어, `/api`로 시작하는 경로는 SPA 폴백(index.html로 되돌리기) 대상에서도 빠지고 캐시 대상에서도 빠집니다. 결과적으로 **모든 API 호출은 항상 백엔드로 직접 나가고, 디스크에 남지 않습니다.**

:::warning 왜 /api 캐시를 막는 게 보안 이슈인가
적합도 분석(`fit_analysis`), 면접 답변, 결제 같은 응답이 캐시에 남으면 (1) 공용 기기에서 다른 사람이 캐시된 내 데이터를 볼 위험, (2) 점수·크레딧 잔액이 만료된 값으로 표시되는 정합성 문제가 생깁니다. denylist는 이를 구조적으로 차단합니다.
:::

### 5-5. 푸시 핸들러 병합 (push-sw.js)

Workbox가 만든 서비스워커에 `importScripts: ['push-sw.js']`로 Web Push 코드를 합칩니다. `push-sw.js`는 백엔드가 보낸 `{title, body, url}` JSON을 받아 알림을 띄우고(`showNotification`), 알림 클릭 시 이미 열린 탭이 있으면 포커스, 없으면 새 창을 엽니다. 발신 측은 백엔드의 Web Push/FCM 발송기입니다. 자세한 건 [Web Push 알림](/backend/push-notification) 참고.

## 6. 면접 답변 3단계

- **초간단 1문장**: "vite-plugin-pwa로 manifest와 서비스워커를 자동 생성해서 설치형 앱처럼 만들었고, 정적 자산만 precache하고 민감한 /api 응답은 캐시하지 않게 했습니다."
- **기본**: "Workbox로 JS·CSS·폰트 같은 정적 자산을 precache해서 재방문 속도를 올렸습니다. registerType은 autoUpdate라 새 배포가 자동 반영됩니다. 핵심은 runtimeCaching을 두지 않고 navigateFallbackDenylist에 /api를 넣어, 분석·결제 같은 동적 API 응답이 캐시에 남지 않게 한 점입니다. 이 빌드는 Capacitor 네이티브 앱에서도 그대로 씁니다."
- **꼬리질문 대응**: "서비스워커는 install에서 precache, activate에서 옛 캐시 정리, fetch에서 요청을 가로챕니다. 푸시는 별도로 둔 push-sw.js를 importScripts로 합쳐서 백그라운드 알림을 처리합니다. autoUpdate라 갱신 충돌은 거의 없지만, 만약 강제 새로고침 UX가 필요하면 prompt 방식으로 바꾸고 skipWaiting을 노출하면 됩니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 서비스워커는 일반 JS와 뭐가 다른가요?
DOM 접근이 안 되고 페이지와 별개 스레드에서 돕니다. HTTPS(또는 localhost)에서만 등록되고, 페이지가 닫혀도 push 같은 이벤트로 깨어날 수 있습니다. 즉 "페이지의 일부"가 아니라 "페이지를 감싸는 네트워크 프록시"입니다.
:::

:::details Q. precache와 runtime caching의 차이는?
precache는 빌드 시점에 알려진 파일 목록(globPatterns)을 install 때 미리 캐시에 박는 것이고, runtime caching은 요청이 실제로 발생할 때 정책(NetworkFirst, CacheFirst 등)에 따라 동적으로 캐시하는 것입니다. CareerTuner는 precache만 쓰고 runtime caching은 안 씁니다 — 동적 데이터를 캐시할 이유가 없고 위험만 크기 때문입니다.
:::

:::details Q. registerType autoUpdate vs prompt?
autoUpdate는 새 서비스워커를 받으면 사용자 개입 없이 다음 진입에 교체합니다. prompt는 "새 버전이 있어요" 토스트를 띄우고 사용자가 새로고침을 눌러야 적용됩니다. 입력 중 데이터 손실이 민감하면 prompt가 안전하지만, CareerTuner는 매끄러운 최신화를 우선해 autoUpdate를 택했습니다.
:::

:::details Q. navigateFallback이 뭔가요? 왜 denylist가 필요한가요?
SPA는 /dashboard 같은 경로를 새로고침해도 서버에 그 파일이 없으므로, 서비스워커가 index.html을 대신 돌려줘야 React Router가 그립니다. 그게 navigateFallback입니다. 그런데 /api 요청까지 index.html로 돌려주면 API가 깨지므로, navigateFallbackDenylist에 /api 정규식을 넣어 제외합니다.
:::

:::details Q. 캐시 무효화(오래된 캐시) 문제는 어떻게 막나요?
workbox의 cleanupOutdatedCaches: true가 새 서비스워커 activate 시 옛 precache 캐시를 자동 삭제합니다. precache 파일은 빌드마다 해시가 붙으므로 내용이 바뀌면 새 항목으로 갈리고, 안 바뀐 파일만 재사용됩니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. "CareerTuner의 PWA에서 무엇을 캐시하고 무엇을 캐시하지 않는지, 그리고 왜 그렇게 나눴는지를 30초 안에 설명해보세요." (precache 정적 자산 / runtimeCaching 없음 / denylist /api / 보안 근거)
2. "면접관이 '서비스워커가 갑자기 옛날 화면을 보여주면 어떻게 디버깅하겠냐'고 묻습니다. cleanupOutdatedCaches·autoUpdate·해시 파일명을 엮어 답해보세요."

## 퀴즈

<QuizBox question="CareerTuner의 vite-plugin-pwa 설정에서 /api 응답을 서비스워커가 캐시하지 않도록 막는 핵심 옵션은?" :choices="['globPatterns', 'navigateFallbackDenylist', 'includeAssets', 'theme_color']" :answer="1" explanation="navigateFallbackDenylist: [/^/api/] 로 /api 경로를 SPA 폴백·캐시 대상에서 제외합니다. 게다가 runtimeCaching 규칙을 아예 두지 않아 동적 API 응답이 캐시에 남지 않습니다." />

<QuizBox question="registerType: 'autoUpdate' 가 의미하는 것으로 가장 정확한 것은?" :choices="['새 버전이 있으면 사용자에게 새로고침 팝업을 띄운다', '새 서비스워커를 받으면 사용자 개입 없이 다음 진입에 교체한다', 'API 응답을 자동으로 캐시한다', '오프라인일 때만 서비스워커를 등록한다']" :answer="1" explanation="autoUpdate는 백그라운드에서 새 서비스워커를 받고 다음 진입 시 조용히 교체합니다. 팝업을 띄우는 방식은 prompt입니다." />

<QuizBox question="PWA에서 적합도 분석·결제 같은 민감한 /api 응답을 서비스워커 캐시에 남기면 어떤 위험이 있는지 설명하세요." explanation="공용 기기에서 다른 사용자가 캐시된 개인 데이터를 볼 수 있고, 점수나 크레딧 잔액 같은 값이 만료된 상태로 표시되어 정합성이 깨집니다. 그래서 CareerTuner는 runtimeCaching을 정의하지 않고 navigateFallbackDenylist에 /api를 넣어 동적 응답이 항상 백엔드로 직접 나가고 디스크에 남지 않도록 구조적으로 차단했습니다." />
