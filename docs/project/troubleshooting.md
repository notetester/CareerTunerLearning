# 어려웠던 문제와 해결

> "기능을 만든 것보다, 실패 케이스를 막은 게 더 어려웠습니다. 모바일 평문 HTTP, API 키 부재, SSRF, 인프라 미설정, 토큰 동시 리프레시 — 다섯 가지를 원인부터 추적해 해결했습니다."

면접에서 "프로젝트하면서 어려웠던 점"은 거의 항상 나온다. 이 페이지는 CareerTuner에서 실제로 부딪힌 트러블슈팅 5건을 **문제 -> 원인 -> 해결 -> 배운 점** 형식으로 정리한다. 각 항목은 30초 안에 말할 수 있어야 한다.

## 1. 한 줄 정의

"코드를 짜는 것"과 "코드가 현실의 제약(네트워크, 키 부재, 악의적 입력, 인프라 공백, 동시성)에서 깨지지 않게 하는 것"은 다른 문제다. 이 다섯 사례는 후자에 대한 기록이다.

| # | 문제 | 영역 | 핵심 해결 |
| --- | --- | --- | --- |
| 1 | 모바일 앱이 평문 HTTP 백엔드를 못 부름 | 모바일/인프라 | `androidScheme: 'http'` + `cleartext: true` |
| 2 | AI API 키 미발급 -> 개발 멈춤 | C/프론트 | `VITE_USE_MOCK` 토글 + 서버측 Mock 폴백 |
| 3 | 공고 URL 추출의 SSRF 위험 | B/공통 | 내부 IP/리다이렉트 검증, DNS 핀 |
| 4 | AI/푸시 인프라 미설정 시 흐름 끊김 | C/공통 | graceful fallback + 로깅 |
| 5 | 401 동시 발생 -> 중복 리프레시 | 프론트 | single-flight 단일 프라미스 |

## 2. 단어 뜻 (핵심 용어)

- **cleartext (평문)**: TLS로 암호화되지 않은 HTTP 트래픽. 안드로이드는 기본적으로 이걸 차단한다.
- **SSRF (Server-Side Request Forgery)**: 서버가 외부 입력으로 받은 URL을 그대로 요청하게 만들어, 공격자가 서버 내부망(클라우드 메타데이터, 사내 IP)을 대신 찔러보는 공격.
- **graceful fallback (우아한 폴백)**: 의존 컴포넌트가 없거나 죽었을 때 앱 전체를 죽이지 않고 대체 동작으로 넘어가는 것.
- **single-flight (단일 플라이트)**: 동일한 작업이 동시에 여러 번 요청돼도 실제로는 한 번만 실행하고 나머지는 그 결과를 공유하는 패턴.
- **DNS rebinding**: 검증 시점과 실제 연결 시점 사이에 DNS 응답을 바꿔치기해 검증을 우회하는 공격.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

이 다섯 가지를 처리하지 않으면 각각 이렇게 깨진다.

- **모바일 평문 HTTP 미처리**: 웹에선 되는데 APK에서만 "네트워크 오류" — 데모 시연 직전에 터지는 최악의 버그.
- **키 부재 대비 없음**: 키 한 장 못 받았다고 팀 전체 개발이 멈춤. 일정이 외부 변수에 인질로 잡힘.
- **SSRF 미차단**: 사용자가 `http://169.254.169.254/...` 같은 URL을 넣으면 서버가 클라우드 자격증명을 긁어올 수 있음. 공개 repo + 실서비스면 치명적.
- **인프라 폴백 없음**: VAPID 키, FCM, Ollama가 안 떠 있으면 그 기능을 부르는 화면 전체가 500.
- **중복 리프레시**: 페이지 로드 시 API 5개가 동시에 401 -> refresh 5번 -> refresh 토큰 회전(rotation) 시 서로의 토큰을 무효화 -> 강제 로그아웃.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일)

### (1) 모바일 평문 HTTP — `frontend/capacitor.config.ts`

```ts
server: {
  androidScheme: 'http', // 앱 origin도 http -> 외부 http API와 same-scheme
  cleartext: true,       // AndroidManifest usesCleartextTraffic=true
  ...(devServerUrl ? { url: devServerUrl } : {}),
}
```

### (2) Mock 토글 — `frontend/src/app/lib/api.ts` + 서버측 `FallbackFitAnalysisAiService`

```ts
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
// USE_MOCK이면 fetch 대신 mock 레지스트리로 응답
```

### (3) SSRF 차단 — `jobposting/service/JobPostingTextExtractor.java`

`validateSafeHttpUrlForFetch` / `validateSafeHost` / `isUnsafeAddress` / `validateRedirectUrl`.

### (4) graceful fallback — `notification/push/LoggingPushSender.java`, `fitanalysis/ai/FallbackFitAnalysisAiService.java`

### (5) single-flight 리프레시 — `frontend/src/app/lib/api.ts`의 `tryRefresh()` + `refreshPromise`

:::tip 영역 표시
(1)(5)는 프론트 공통, (3)은 B 도메인의 공통 보안 코드, (2)(4)는 **내 영역 C**(적합도/대시보드/취업경향 AI)에서 직접 구현한 폴백이다. (4)의 푸시 발송기는 알림 도메인 공통.
:::

## 5. 핵심 동작 원리 (문제별 원인 -> 해결)

### 문제 1 — 모바일 앱이 평문 HTTP 백엔드를 호출 못 함

- **증상**: 웹/dev에선 정상인데 안드로이드 APK에서만 API가 전부 실패.
- **원인**: Capacitor 앱의 WebView origin은 기본 `https://localhost`(또는 `capacitor://`)인데, 백엔드(Tailscale 평문 `http://<서버주소>:8080`)는 http라 ① mixed-content 차단 ② 안드로이드 기본 `usesCleartextTraffic=false`로 평문 트래픽 차단, 두 겹으로 막혔다.
- **해결**: `androidScheme: 'http'`로 앱 origin도 http로 맞춰 same-scheme로 만들고, `cleartext: true`로 평문 트래픽을 허용. **조건부가 아니라 항상 켜는 게 핵심** — 그래야 dev뿐 아니라 실데이터 번들 빌드에도 설정이 들어간다.
- **배운 점**: WebView 기반 하이브리드 앱은 "브라우저에서 됐으니 앱에서도 되겠지"가 안 통한다. origin scheme과 OS 네트워크 정책을 따로 확인해야 한다.

### 문제 2 — AI API 키가 아직 발급 안 됨

- **증상**: OpenAI 키가 팀에 안 들어와 적합도 분석 화면을 만들 수도, 테스트할 수도 없음.
- **원인**: 기능이 외부 키에 강결합 -> 키 = 개발 전제 조건이 됨.
- **해결**: 두 층의 Mock.
  - **프론트**: `VITE_USE_MOCK=true`면 `api()`가 네트워크 대신 mock 레지스트리로 응답 -> 백엔드 없이도 UI 완성. 데모 APK/GitHub Pages 배포도 이걸로 자체완결.
  - **서버**: `FallbackFitAnalysisAiService`(@Primary)가 `OSS(자체모델) -> OpenAI -> 내부 Mock` 순으로 폴백. 키가 없으면 `OpenAiFitAnalysisAiService` 내부에서 Mock 결과를 반환하므로 화면이 안 깨진다.
- **배운 점**: 외부 의존성은 인터페이스 뒤에 두고 폴백을 만들어야 일정이 외부 변수에 끌려가지 않는다. Mock은 "임시방편"이 아니라 데모/테스트의 1급 경로다.

### 문제 3 — 공고 URL 추출의 SSRF 위험

사용자가 채용공고 URL을 붙여넣으면 서버가 그 URL을 직접 fetch해 본문을 추출한다. 이걸 무방비로 두면 SSRF가 된다. 방어를 다단계로 걸었다.

| 방어 | 코드 | 막는 것 |
| --- | --- | --- |
| scheme 화이트리스트 | http/https만 허용 | `file://`, `gopher://` 등 |
| localhost 이름 차단 | `isLocalhostName` | `localhost`, `*.localhost` |
| 주소 분류 검사 | `isUnsafeAddress` | loopback, site-local(사내망), link-local, multicast |
| 클라우드 메타데이터 차단 | `isMetadataAddress` | 169.254.x 메타데이터 IP |
| CGNAT/IPv6 ULA 차단 | `isCarrierGradeNat...`, `isIpv6UniqueLocal...` | 100.64/10, fc00::/7 |
| 리다이렉트 재검증 | `validateRedirectUrl` | 외부->내부로 튕기는 우회 |
| DNS 핀 | 검증한 `InetAddress`로 직접 연결 | DNS rebinding |

- **원인**: "URL을 받아 서버가 요청한다"는 기능 자체가 SSRF 표면. IP 한 줄 검사로는 부족(리다이렉트, DNS rebinding, IPv6 우회가 있음).
- **해결**: 호스트를 **한 번 resolve해 안전성 검증 -> 그 검증된 주소로 소켓을 직접 열어** 연결(검증 후 재-resolve 안 함). 리다이렉트도 매번 같은 검증을 다시 통과해야 함. 테스트(`JobPostingTextExtractorTest`)로 차단 케이스를 명세화했다.
- **배운 점**: 외부 입력으로 서버가 네트워크 요청을 하는 모든 지점은 잠재적 SSRF. "검증 시점 != 사용 시점"(TOCTOU)을 의식해 검증한 값을 그대로 써야 한다.

### 문제 4 — AI/푸시 인프라가 아직 없음

- **증상**: VAPID 키/FCM/Ollama가 안 떠 있는 개발 환경에서 푸시·AI 호출이 예외로 죽음.
- **원인**: 기능 코드가 인프라가 "항상 있다"고 가정.
- **해결**: 기본 빈을 폴백 구현으로 두고, 실제 구현이 생기면 `@Primary`로 교체하는 패턴.
  - `LoggingPushSender`: 발송 인프라 없으면 실제 전송 대신 **의도를 로그로** 남김(토큰은 마스킹). 실제 발송기(Web Push/FCM)가 생기면 그 빈에 `@Primary`.
  - AI도 같은 사상: provider 미설정/실패 시 Mock으로 떨어져 화면 흐름이 안 끊김.
- **배운 점**: "인프라가 없으면 죽는다"가 아니라 "없으면 로그 남기고 진행한다"로 설계하면, 미완성 환경에서도 전체 플로우를 끝까지 돌려볼 수 있다.

### 문제 5 — JWT 동시요청 중복 리프레시

- **증상**: 페이지 진입 시 access 토큰이 만료돼 여러 API가 동시에 401 -> 각자 `/auth/refresh` 호출 -> refresh 토큰 회전 환경에서 서로의 새 토큰을 무효화 -> 랜덤 로그아웃.
- **원인**: 401 핸들링이 요청별로 독립 실행돼 refresh가 N번 일어남(race condition).
- **해결**: 모듈 스코프 `refreshPromise` 하나를 공유.

```ts
let refreshPromise: Promise<boolean> | null = null;
function tryRefresh() {
  if (refreshPromise) return refreshPromise; // 진행 중이면 그 프라미스 재사용
  refreshPromise = (async () => {
    try { /* /auth/refresh 1회 */ }
    finally { refreshPromise = null; } // 끝나면 비워 다음 만료에 대비
  })();
  return refreshPromise;
}
```

첫 401이 refresh를 시작하고, 그 사이 들어온 다른 401들은 **같은 프라미스를 await**한다. refresh 성공 후 각 요청은 새 토큰으로 원요청을 1회 재시도.

- **배운 점**: 클라이언트 사이드 동시성도 race condition을 만든다. "공유 자원을 갱신하는 비동기 작업"은 single-flight로 직렬화해야 한다.

## 6. 면접 답변 3단계

- **초간단 (1문장)**: "기능 구현보다 실패 케이스 방어가 더 어려웠고, 모바일 평문 HTTP, SSRF, 토큰 동시 리프레시 같은 문제를 원인부터 추적해 해결했습니다."
- **기본**: 위 다섯 중 하나(예: SSRF)를 골라 *증상 -> 원인 -> 다단계 방어 -> 테스트로 명세화* 순서로 1분.
- **꼬리질문 대응**: "왜 IP 검사 한 줄로 안 되냐"면 -> 리다이렉트 우회, DNS rebinding, IPv6/CGNAT 우회를 들고, "그래서 검증한 주소로 직접 소켓을 연다"로 마무리. 깊이를 보여주는 지점.

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. cleartext를 항상 켜면 보안상 안 좋지 않나요?
맞다. 평문 HTTP는 권장 사항이 아니고, 운영에선 HTTPS 백엔드가 정답이다. 이건 사내망(Tailscale) 평문 백엔드를 시연·개발용으로 호출하기 위한 **의도적 트레이드오프**다. 호스팅 데모는 `androidScheme:'https'` + 정적 데모(Mock) 경로를 별도로 두어, 외부 노출 빌드에는 평문 의존이 없도록 분리했다.
:::

:::details Q2. SSRF에서 site-local만 막으면 충분한가요?
아니다. 그래서 loopback, link-local, multicast, **클라우드 메타데이터(169.254.x)**, CGNAT(100.64/10), IPv6 ULA까지 분류 검사로 막았다. 더 중요한 건 ① 리다이렉트를 따라갈 때마다 같은 검증을 재실행하고 ② 검증한 주소로 직접 연결해 DNS rebinding을 차단한 것. 단일 IP 검사가 아니라 "검증-사용 일관성"이 핵심이다.
:::

:::details Q3. Mock 토글이 실제 코드와 괴리되면 위험하지 않나요?
그래서 Mock은 실제 API와 같은 `ApiResponse` 엔벨로프 형태로 응답하게 맞췄고, 프론트는 동일한 `api()` 함수를 통과한다. 또 타입 계약 테스트(`types.contract.test.ts`)로 응답 타입이 어긋나면 빌드가 깨지게 했다. Mock은 UI/데모 경로이고, 비즈니스 검증(점수 확정 등)은 서버 규칙으로 따로 둬서 Mock에 로직을 숨기지 않았다.
:::

:::details Q4. single-flight 대신 그냥 락을 걸면 안 되나요?
JS는 단일 스레드라 OS 락 개념이 없다. 비동기 작업의 "진행 중 상태"를 표현하는 가장 자연스러운 수단이 **공유 Promise**다. 진행 중이면 같은 Promise를 반환하고, `finally`에서 비워 다음 만료에 다시 동작하게 한다. 이게 사실상의 비동기 뮤텍스다.
:::

:::details Q5. 폴백이 너무 많으면 "조용히 실패"라 디버깅이 어렵지 않나요?
그래서 폴백마다 `@Slf4j`로 `log.warn`/`log.info`를 남겨 **무엇이 어떤 이유로 폴백됐는지** 흔적을 남긴다(예: "OSS 자체모델 실패 -> OpenAI/Mock 폴백"). 사용량/실패는 `ai_usage_log`에도 기록한다. 폴백은 "조용히 무시"가 아니라 "흐름은 살리되 기록은 남긴다"로 설계했다.
:::

## 8. 직접 말해보기

1. "프로젝트에서 가장 까다로웠던 문제 하나"를 골라 *증상 -> 원인 -> 해결 -> 배운 점* 4단계로 90초 안에 설명해 보라. (추천: SSRF 또는 single-flight)
2. 면접관이 "그거 그냥 IP 한 줄 검사하면 되는 거 아니에요?"라고 반박했다고 가정하고, 리다이렉트/DNS rebinding/IPv6 우회를 들어 2분간 방어해 보라.

## 퀴즈

<QuizBox question="Capacitor 안드로이드 앱이 평문 http 백엔드를 호출하려면 capacitor.config.ts에서 무엇을 해야 하는가?" :choices="['androidScheme를 https로 두고 cleartext를 false로 둔다', 'androidScheme를 http로 맞추고 cleartext를 true로 항상 켠다', 'CORS 허용 오리진만 추가하면 된다', 'WebView 캐시를 비활성화한다']" :answer="1" explanation="앱 origin scheme을 http로 맞춰 same-scheme로 만들고(androidScheme:http), 안드로이드 기본 차단을 풀기 위해 usesCleartextTraffic에 해당하는 cleartext:true를 항상 켠다. 조건부로 켜면 번들 빌드에 빠질 수 있어 항상 켜는 게 핵심이다." />

<QuizBox question="공고 URL 추출에서 IP 한 줄 검사만으로 SSRF를 못 막는 이유 두 가지를 설명하라." explanation="첫째, 30x 리다이렉트로 외부 URL이 내부 주소로 튕길 수 있어 리다이렉트마다 같은 검증을 재실행해야 한다(validateRedirectUrl). 둘째, 검증 시점과 연결 시점 사이에 DNS 응답이 바뀌는 DNS rebinding이 가능해, 검증한 InetAddress로 직접 소켓을 열어야 한다. 추가로 169.254 메타데이터, CGNAT(100.64/10), IPv6 ULA 등 site-local 외 사설 대역도 분류 검사로 함께 막아야 한다." />

<QuizBox question="여러 API가 동시에 401을 받아 refresh가 중복 실행되는 문제를 막는 프론트엔드 패턴은?" :choices="['요청마다 즉시 새 refresh 호출', '모듈 스코프 공유 Promise(single-flight)로 진행 중이면 같은 프라미스를 재사용', '401이면 무조건 로그아웃', 'setTimeout으로 요청을 분산']" :answer="1" explanation="tryRefresh가 refreshPromise를 공유해, 진행 중이면 같은 프라미스를 반환하고 동시 401들은 그것을 await한다. finally에서 비워 다음 만료에 대비한다. 사실상의 비동기 뮤텍스(single-flight)다." />
