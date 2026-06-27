# 환경변수와 시크릿 관리

> 코드는 그대로 두고 환경변수만 바꿔 개발/운영을 전환한다. 시크릿은 절대 커밋하지 않고, 배포 직전 자동 스캔으로 유출을 막는다.

## 1. 한 줄 정의

**환경변수(Environment Variable)** 는 코드 밖에서 주입하는 설정값이고, **시크릿(Secret)** 은 그중 노출되면 안 되는 값(DB 비밀번호, API 키, JWT 시크릿)이다. CareerTuner는 `${ENV:기본값}` 패턴으로 둘을 하나의 메커니즘으로 다루고, `.env` 미커밋 + CI 시크릿 스캔으로 유출을 차단한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| ENV (Environment) | 프로세스가 실행되는 "환경"이 들고 있는 키-값. OS/컨테이너/CI가 주입한다. |
| Secret | 비밀값. 환경변수의 부분집합 — 모든 시크릿은 환경변수지만, 모든 환경변수가 시크릿은 아니다. |
| `VITE_` 접두사 | Vite 빌드 도구가 **클라이언트 번들에 노출을 허락하는** 환경변수의 약속된 접두사. 접두사가 없으면 브라우저 코드에서 안 보인다. |
| 12-Factor App | "설정을 코드에서 분리해 환경에 둔다"는 앱 설계 원칙. 이 페이지 전체가 그 III장(Config) 구현이다. |
| `.env` | 로컬에서 환경변수를 모아두는 파일. **커밋하지 않는 게 원칙.** |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

설정을 코드에 하드코딩하면 세 가지가 동시에 터진다.

1. **시크릿 유출** — DB 비밀번호·API 키가 git 히스토리에 박혀 공개 repo에 그대로 노출된다. 한 번 커밋되면 force-push로도 완전히 못 지운다.
2. **환경 분리 불가** — 개발 DB와 운영 DB를 같은 코드로 가리킬 수 없다. 빌드를 환경마다 따로 만들어야 한다.
3. **교체 비용** — 키가 유출돼 갈아끼워야 할 때 코드를 고치고 다시 빌드/배포해야 한다.

환경변수로 빼면 **빌드는 한 번, 동작은 환경마다 다르게** 가 된다. 운영에서는 `DB_PASSWORD=... JWT_SECRET=... java -jar app.jar` 처럼 같은 이름의 변수만 주면 코드 한 줄 안 바꾸고 교체된다.

:::warning 공개 repo의 현실
CareerTuner 데모는 GitHub Pages로 공개된다. 즉 **빌드 산출물이 누구나 볼 수 있는 곳에 올라간다.** "어차피 내부용"이라는 가정이 통하지 않으므로, 시크릿 처리를 코드 규칙이 아니라 자동 게이트로 강제한다(7항 deploy-demo 스캔).
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

| 위치 | 영역 | 역할 |
| --- | --- | --- |
| `backend/src/main/resources/application.yaml` | 인프라(공통) | 모든 백엔드 설정을 `${ENV:기본값}` 형태로 선언. DB·JWT·OAuth·메일·OpenAI·Anthropic·Ollama·RAG 전부. |
| `common/config/CareerTunerProperties.java` | 인프라(공통) | `@ConfigurationProperties(prefix = "careertuner")` 로 `careertuner.*` 설정을 타입 안전한 자바 객체(App/Jwt/Mail/Oauth)로 바인딩. |
| `frontend/.env.example` | 인프라(공통) | **커밋되는** 예시 파일. 어떤 `VITE_*` 변수가 있는지 문서 역할. 실제 값은 `.env`(미커밋)나 배포 환경변수로 주입. |
| `frontend/.env.mock` | 인프라(공통) | `vite --mode mock` 시 로드. `VITE_USE_MOCK=true` 만 담아 백엔드 없이 데모 동작. |
| `frontend/src/app/lib/api.ts` | 인프라(공통) | `import.meta.env.VITE_API_BASE_URL` / `VITE_USE_MOCK` 를 읽어 API 베이스 URL과 mock 토글 결정. |
| `.gitignore` (루트) | 인프라(공통) | `.env` / `.env.*` 무시하되 `!.env.example`, `!.env.mock` 만 예외 허용. |
| `.github/workflows/deploy-demo.yml` | 인프라(공통) | 데모 배포 전 `frontend/dist` 를 시크릿 패턴으로 스캔, 걸리면 `exit 1` 로 배포 차단. |

:::tip 영역 표시
환경변수/시크릿 정책은 **공통 영역**이라 Owner가 팀장이다. `application.yaml`, `.gitignore`, 워크플로 변경은 팀 합의가 필요하다. 영역 C(필자)가 추가한 설정 키도 같은 `${ENV:기본값}` 규칙을 그대로 따른다(예: `CAREERTUNER_ANALYSIS_AI_PROVIDER`, `CAREERTUNER_ANALYSIS_AI_OSS_BASE_URL`).
:::

## 5. 핵심 동작 원리 (표/코드/단계)

### 5.1 백엔드: `${ENV:기본값}` 패턴

Spring의 property placeholder가 실행 시점에 값을 결정한다. **환경변수가 있으면 그것을, 없으면 콜론 뒤 기본값을** 쓴다.

```yaml
careertuner:
  jwt:
    # 운영에서는 반드시 JWT_SECRET 환경변수로 교체
    secret: ${JWT_SECRET:dev-only-please-change-in-production}
    access-token-validity-seconds: ${JWT_ACCESS_TTL:1800}   # 30분
  openai:
    api-key: ${OPENAI_API_KEY:}    # 기본값 빈 문자열 = 미설정
```

해석 우선순위(앞이 강함): **OS/컨테이너 환경변수 → JVM `-D` 시스템 프로퍼티 → yaml 기본값.**

기본값 설계에는 두 가지 의도가 있다.

- **개발용 즉시 동작값을 채워둔 키** — `JWT_SECRET`, VAPID 키처럼 비공개 repo에서 클론 후 바로 실행되게.
- **빈 문자열로 둔 키** — `OPENAI_API_KEY`, SMTP 계정처럼 없으면 기능을 끄거나 폴백으로 빠지게(키 없으면 메일은 dev-mode 로그, 네이티브 푸시는 로깅 폴백).

### 5.2 프런트: `VITE_` 접두사 게이트

Vite는 `import.meta.env` 에 **`VITE_` 로 시작하는 변수만** 노출한다.

```ts
// api.ts — 클라이언트 번들에 들어가는 코드
const BASE = (import.meta.env.VITE_API_BASE_URL as string)?.replace(/\/+$/, "") || "/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
```

이건 안전장치다. 빌드 머신에 `DB_PASSWORD` 가 환경변수로 있어도 `VITE_` 접두사가 없으면 번들에 안 들어간다. 뒤집으면, **`VITE_*` 에 넣은 값은 빌드 산출물에 평문으로 박힌다** — 그래서 `VITE_VAPID_PUBLIC_KEY`(공개키, 비밀 아님)는 OK, 시크릿은 절대 `VITE_*` 로 두면 안 된다.

### 5.3 `.env` 미커밋 규칙

```text
# .gitignore (루트)
.env
.env.*
!.env.example     # 예시는 커밋(문서 역할)
!.env.mock        # mock 토글은 커밋(데모 빌드용)
```

`.env.example` 은 "어떤 변수가 필요한가"를 알려주는 **값 없는 명세**로 커밋하고, 진짜 값이 든 `.env` 는 막는다. 신규 팀원은 `.env.example` 을 복사해 `.env` 를 만든다.

### 5.4 환경별 동작 한눈에

| 환경 | DB | 시크릿 출처 | mock |
| --- | --- | --- | --- |
| 로컬 개발 | yaml 기본값(개발 DB) 또는 localhost 블록 | yaml 기본값 | off |
| mock 데모/APK | 없음 | 불필요 | `VITE_USE_MOCK=true` |
| 공개 데모(Pages) | 없음(mock) | 빌드 시 스캔 통과만 허용 | on |
| 운영 | `DB_*` 환경변수 | OS/시크릿 매니저 환경변수 | off |

## 6. 면접 답변 3단계

- **초간단(1문장):** "설정을 `${ENV:기본값}` 패턴으로 코드에서 분리해, 빌드는 한 번 하고 환경변수만 바꿔 개발/운영을 전환합니다."
- **기본:** "백엔드는 `application.yaml` 에 모든 민감값을 `${ENV:기본값}` 으로 두고 `@ConfigurationProperties` 로 바인딩합니다. 개발은 커밋된 기본값으로 바로 돌고, 운영은 같은 이름 환경변수만 주면 교체됩니다. 프런트는 Vite 규칙상 `VITE_` 접두사 변수만 번들에 노출되니 공개키만 그쪽에 두고, `.env` 는 gitignore로 막습니다."
- **꼬리질문 대응:** "공개 repo라 사람 규칙만으론 부족해서, 데모 배포 워크플로(deploy-demo)에 빌드 산출물을 DB 비번·JWT 시크릿·API 키·client_secret·DB IP 패턴으로 grep 스캔하는 게이트를 넣었습니다. 하나라도 걸리면 `exit 1` 로 배포를 막아 유출을 자동 차단합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 기본값을 코드(yaml)에 박아두면 그것도 유출 아닌가?
경우를 나눠야 한다. **공개키(VAPID public key), placeholder, dev 전용 더미 시크릿**은 박아도 무해하다 — 비공개 repo에서 즉시 실행되게 하는 개발 편의값이다. 반면 **실제 운영 시크릿은 절대 기본값에 넣지 않고 빈 문자열로 두거나 `CHANGEME` placeholder** 로 둔다(OAuth client-secret이 그렇다). 운영값은 오직 환경변수로만 주입된다. 핵심은 "기본값 = 운영값"이 되지 않게 하는 것.
:::

:::details Q2. `.env.example` 은 왜 커밋하나? 그것도 .env인데?
값이 아니라 **키 이름과 형식만** 담은 명세이기 때문이다. 신규 팀원이 어떤 변수를 채워야 하는지 알 수 있는 살아있는 문서다. `.gitignore` 에서 `.env.*` 는 막되 `!.env.example` 로 예외 허용한다. 실제 비밀이 든 `.env` 만 막는 것.
:::

:::details Q3. 프런트엔드 환경변수는 안전한가?
아니다. `VITE_*` 변수는 **빌드 시점에 정적으로 치환돼 JS 번들에 평문으로 박힌다.** 브라우저에서 누구나 볼 수 있다. 그래서 프런트엔드에는 절대 시크릿을 두지 않고, 공개돼도 되는 값(API 베이스 URL, VAPID 공개키, mock 토글)만 둔다. 진짜 인증은 서버 측 JWT/세션으로 처리한다.
:::

:::details Q4. 운영에서 시크릿을 환경변수로 두면 그건 안전한가? 더 나은 방법은?
환경변수는 코드 분리에는 충분하지만 만능은 아니다 — 프로세스 덤프나 로그에 새어나갈 수 있다. 더 견고한 운영은 **시크릿 매니저(AWS Secrets Manager, Vault 등)** 에서 런타임에 주입하고, 키 로테이션·접근감사를 붙이는 것. CareerTuner는 현 단계에서 환경변수 주입까지 구현했고, 매니저 연동은 그 위에 같은 변수 이름으로 얹으면 되는 구조다(설계상 확장 포인트).
:::

:::details Q5. CI에서 시크릿 스캔은 정확히 어떻게 동작하나?
deploy-demo 워크플로가 빌드 후 `frontend/dist` 전체를 `grep -RInE` 로 스캔한다. 패턴에 DB 사용자/비번 문자열, `jdbc:mysql`, `JWT_SECRET`, `OPENAI_API_KEY`, `client_secret`, DB 서버 IP 대역 같은 게 들어간다. 하나라도 매칭되면 "Potential secret found" 출력 후 `exit 1` 로 잡(job)을 실패시켜 공개 repo 푸시 자체를 막는다. 사람이 실수로 시크릿을 번들에 흘려도 배포 게이트에서 걸리는, **유출 방지의 마지막 그물**이다.
:::

## 8. 직접 말해보기

1. "CareerTuner에서 개발 DB와 운영 DB를 코드 변경 없이 어떻게 갈아끼우나요?"를 30초 안에 `${ENV:기본값}` 패턴 → 환경변수 우선순위 → 운영 주입 순으로 설명해보라.
2. "프런트엔드 번들은 공개되는데 어떻게 시크릿을 지키나요?"를 `VITE_` 접두사 게이트 → 공개값만 노출 → `.env` 미커밋 → CI 스캔 게이트의 4중 방어로 한 호흡에 말해보라.

관련 페이지: [JWT 보안](/backend/jwt-security) · [DTO](/glossary/dto) · [ApiResponse 엔벨로프](/glossary/api-response-envelope)

## 퀴즈

<QuizBox question="application.yaml의 ${JWT_SECRET:dev-only-...} 에서 운영 서버에 JWT_SECRET 환경변수가 설정돼 있을 때 실제로 쓰이는 값은?" :choices="['콜론 뒤의 dev-only 기본값', '환경변수 JWT_SECRET의 값', '둘을 이어붙인 값', '항상 빈 문자열']" :answer="1" explanation="환경변수가 존재하면 그 값이 콜론 뒤 기본값을 덮어쓴다. 우선순위는 환경변수 > yaml 기본값이다. 그래서 운영에서는 환경변수만 주면 코드 변경 없이 시크릿이 교체된다." />

<QuizBox question="프런트엔드에서 변수 이름을 VITE_로 시작하게 만드는 이유와 그 결과로 옳은 것은?" :choices="['서버에서만 읽히게 하려고', 'Vite가 클라이언트 번들에 노출을 허용하므로 평문으로 박힌다 — 공개값만 둬야 한다', '값이 자동 암호화된다', 'git에서 자동 무시된다']" :answer="1" explanation="Vite는 VITE_ 접두사 변수만 import.meta.env로 노출하며, 이 값은 빌드 시 번들에 평문으로 들어간다. 따라서 VITE_*에는 공개키·API URL·mock 토글 같은 비밀 아닌 값만 둬야 한다." />

<QuizBox question="deploy-demo 워크플로의 시크릿 스캔 단계가 빌드 산출물(dist)에서 DB 비번 패턴을 발견하면 어떻게 되며, 이 장치의 목적을 한 문단으로 설명하라." explanation="grep이 패턴에 매칭되면 경고를 출력하고 exit 1로 잡을 실패시켜 공개 데모 repo로의 푸시를 막는다. 목적은 사람의 실수로 시크릿이 번들에 섞여도 공개 배포 직전에 자동으로 차단하는 마지막 방어선을 두는 것이다. 공개 repo라 코드 리뷰 같은 사람 규칙만으로는 누락 위험이 있어, 배포 파이프라인에 강제 게이트를 박아 유출을 기계적으로 막는다." />
