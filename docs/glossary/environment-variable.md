# 환경변수 (Environment Variable)

> 코드 밖에서 주입하는 설정값. 환경(개발/운영)을 코드 변경 없이 갈아끼우고, 비밀값을 소스에서 분리하는 1차 방어선.

## 1. 한 줄 정의

환경변수는 **프로그램이 실행되는 OS/프로세스 환경으로부터 읽어오는 키-값 설정**으로, 같은 코드를 환경마다 다르게 동작시키고 비밀값을 소스코드 밖에 두기 위한 표준 메커니즘이다.

## 2. 단어 뜻 (약자·어원)

- **Environment(환경)**: 프로세스를 둘러싼 실행 컨텍스트. 유닉스 셸이 자식 프로세스에 물려주는 `KEY=VALUE` 목록(environment block)에서 유래.
- **Variable(변수)**: 코드에 고정(하드코딩)하지 않고 바깥에서 바꿀 수 있는 값.
- 합쳐서 **"환경마다 달라질 수 있는, 바깥에서 주입되는 변수"**. 흔히 **env var**로 줄여 부른다.
- 관련 용어 구분:

| 용어 | 뜻 |
| --- | --- |
| 환경변수 | OS/프로세스가 들고 있는 런타임 키-값 |
| `.env` 파일 | 환경변수를 한 곳에 적어두는 텍스트 파일(개발 편의용) |
| 빌드타임 변수 | 빌드 시점에 코드에 박혀버리는 값 (예: Vite `VITE_*`) |
| 런타임 변수 | 실행 시점에 읽는 값 (예: Spring `${ENV:기본값}`) |
| 시크릿(secret) | 환경변수 중 노출되면 안 되는 부분집합 (비번/키/토큰) |

## 3. 왜 필요한가 (없으면 무슨 문제)

환경변수를 안 쓰고 값을 코드에 박으면:

- **환경 분리 불가**: 개발 DB와 운영 DB 주소를 코드에 박으면, 운영 배포할 때마다 코드를 고쳐야 한다. 빌드 산출물이 환경에 종속된다.
- **시크릿 유출**: DB 비밀번호·API 키·JWT 시크릿을 소스에 적으면 git 히스토리에 영구 박제된다. 공개 repo면 곧바로 사고다.
- **재현성·이식성 저하**: 같은 빌드가 환경마다 다르게 동작해야 하는데(12-Factor App의 "Config" 원칙), 코드를 갈아끼워야 하면 "한 번 빌드, 여러 곳 배포"가 깨진다.

핵심은 **"코드는 모든 환경에서 동일, 설정만 환경이 주입"**이다. 자세한 배경은 [환경변수와 시크릿 관리](/infra/env-and-secrets) 참고.

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

### 백엔드 — `application.yaml`의 `${ENV:기본값}` 패턴

`backend/src/main/resources/application.yaml`은 모든 민감/환경 의존 값을 **`${ENV_VAR:기본값}`** 형태로 둔다. 환경변수가 있으면 그 값을, 없으면 콜론 뒤 기본값을 쓴다.

```yaml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:...}:${DB_PORT:3306}/${DB_NAME:...}
    username: ${DB_USERNAME:...}
    password: ${DB_PASSWORD:...}

careertuner:
  jwt:
    secret: ${JWT_SECRET:dev-only-...-change-in-production}
    access-token-validity-seconds: ${JWT_ACCESS_TTL:1800}     # 30분
    refresh-token-validity-seconds: ${JWT_REFRESH_TTL:1209600} # 14일
  openai:
    api-key: ${OPENAI_API_KEY:}    # 미발급 시 빈 값 → mock/폴백
    model: ${OPENAI_MODEL:gpt-5}
```

- DB 접속(`DB_HOST/PORT/NAME/USERNAME/PASSWORD`), 메일(`MAIL_*`), JWT(`JWT_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`), AI 키(`OPENAI_API_KEY` 등)가 모두 이 패턴.
- 이 값들은 `@ConfigurationProperties`로 묶은 `CareerTunerProperties`에 타입 안전하게 바인딩된다. 바인딩 방식은 [Configuration Properties](/backend/configuration-properties)에서 다룬다.
- **C 영역 관점**: 분석 AI 공급자도 `${CAREERTUNER_ANALYSIS_AI_PROVIDER:openai}`처럼 환경변수로 토글한다. API 키 미발급 상태에서는 `OPENAI_API_KEY`를 빈 값으로 둬 mock/폴백 경로로 동작시킨다.

:::warning 기본값에 진짜 시크릿을 넣지 말 것
`${JWT_SECRET:dev-only-...}`의 기본값은 **개발 전용 더미**여야 한다. 운영 시크릿을 기본값으로 박으면 소스에 시크릿을 커밋하는 것과 같다. 운영에서는 반드시 환경변수로 진짜 값을 주입하고, 기본값은 "운영에서 바꾸라"는 신호로만 둔다.
:::

### 프런트엔드 — `VITE_*` 클라이언트 변수 (빌드타임)

Vite는 `VITE_` 접두사가 붙은 변수만 클라이언트 번들에 노출한다. `frontend/src/app/lib/api.ts`:

```ts
const BASE = (import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "")) || "/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
```

- `VITE_API_BASE_URL` 미설정 시 상대경로 `"/api"`(Vite 프록시가 `:8080`으로 전달). Capacitor 앱은 절대 URL이 필요하다.
- `VITE_USE_MOCK`, `VITE_VAPID_PUBLIC_KEY`, `VITE_TOSS_CLIENT_KEY` 등도 `import.meta.env`로 읽는다.
- 예시 파일은 커밋하되 실제 값 파일은 미커밋: `frontend/.env.example`(커밋), `frontend/.env.mock`(`VITE_USE_MOCK=true`), 실제 `.env`는 gitignore.

:::warning VITE_* 는 비밀이 아니다
`VITE_*` 값은 **빌드 시점에 JS 번들에 평문으로 박힌다.** 브라우저로 내려가므로 누구나 볼 수 있다. 그래서 `VITE_TOSS_CLIENT_KEY`(클라이언트 키), `VITE_VAPID_PUBLIC_KEY`(공개키)처럼 **공개돼도 되는 값만** 넣는다. 시크릿(서버 시크릿, 결제 시크릿 키)은 절대 `VITE_*`에 두지 않는다.
:::

### 배포 — 데모 빌드의 시크릿 스캔 (실제 가드)

`.github/workflows/deploy-demo.yml`은 공개 데모 repo(CareerTunerDemo)로 보내기 전, 빌드 산출물(`frontend/dist`)을 grep으로 스캔해 시크릿 패턴이 있으면 배포를 중단한다.

```bash
- name: Check dist for obvious secrets
  run: |
    if grep -RInE "DB_PASSWORD|JWT_SECRET|OPENAI_API_KEY|client_secret|jdbc:mysql|sk-[A-Za-z0-9]+|[0-9]{1,3}(\.[0-9]{1,3}){3}" frontend/dist; then
      echo "Potential secret found in dist. Stop deployment."
      exit 1
    fi
```

- 데모는 `VITE_DEMO_MODE=true VITE_USE_MOCK=true`로 빌드해 백엔드 없이 동작 → 애초에 시크릿이 번들에 들어갈 일을 줄인다.
- 스캔은 **사람의 실수를 잡는 안전망**: 누군가 실수로 시크릿을 `VITE_*`에 넣어 번들에 박혔다면 여기서 파이프라인이 깨진다.

## 5. 핵심 동작 원리 (표·작은 코드)

주입 우선순위와 시점이 스택마다 다르다.

| 구분 | 읽는 시점 | 우선순위 | 노출 범위 |
| --- | --- | --- | --- |
| Spring `${ENV:기본값}` | **런타임** | 환경변수 > 기본값 | 서버 내부(안전) |
| Vite `import.meta.env.VITE_*` | **빌드타임** | `.env.<mode>` > `.env` > OS env | 클라이언트 번들(공개) |

Spring의 해석 순서(우선순위 높은 것이 이김):

```text
명령행 인자 > OS 환경변수 / 시스템 프로퍼티 > application.yaml의 ${...:기본값}
```

Vite의 모드별 파일 로딩 — `vite build --mode mock`이면 `.env.mock`이 `.env`보다 우선:

```text
.env.mock  >  .env  >  process.env(VITE_* 만)
```

흐름 한 줄 요약:

```text
[OS/CI 환경변수] --주입--> [Spring ${ENV} / Vite import.meta.env] --바인딩--> [CareerTunerProperties / 번들 상수]
```

## 6. 면접 답변 3단계

- **초간단**: "환경변수는 코드 밖에서 주입하는 설정값입니다. 개발/운영을 코드 수정 없이 분리하고, 비밀번호 같은 시크릿을 소스에서 빼내려고 씁니다."
- **기본**: "CareerTuner 백엔드는 `application.yaml`에서 `${DB_PASSWORD:기본값}` 같은 `${ENV:기본값}` 패턴으로 DB·JWT·AI 키를 받습니다. 환경변수가 있으면 그 값을, 없으면 개발용 기본값을 씁니다. 프런트는 `VITE_API_BASE_URL`, `VITE_USE_MOCK` 같은 `VITE_*` 변수를 빌드 시점에 읽고요. 실제 `.env`는 gitignore로 커밋하지 않고, 예시 파일만 커밋합니다."
- **꼬리질문 대비**: "`VITE_*`는 빌드타임에 번들에 평문으로 박혀 브라우저에 노출되므로 공개 가능한 값만 넣습니다. 배포 워크플로(deploy-demo)는 데모 repo로 내보내기 전에 빌드 산출물을 grep으로 스캔해서 `DB_PASSWORD`·`JWT_SECRET`·DB IP 같은 패턴이 보이면 배포를 실패시켜, 실수로 박힌 시크릿을 잡습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. `${ENV:기본값}`에서 기본값에 운영 시크릿을 넣으면 안 되는 이유는?
기본값은 소스에 그대로 커밋되기 때문입니다. 운영 시크릿을 기본값으로 박으면 git 히스토리에 영구히 남아 사실상 하드코딩과 같습니다. 그래서 기본값은 `dev-only-...-change-in-production` 같은 더미만 두고, 운영 값은 반드시 환경변수로 주입합니다. CareerTuner의 `JWT_SECRET` 기본값이 그 예입니다.
:::

:::details Q2. 프런트의 `VITE_*` 변수를 시크릿 보관에 쓰면 안 되는 이유는?
`VITE_*`는 빌드 시점에 JS 번들에 평문 문자열로 인라인됩니다. 번들은 브라우저로 내려가니 개발자도구로 누구나 볼 수 있습니다. 그래서 토스 클라이언트 키나 VAPID 공개키처럼 공개돼도 되는 값만 넣고, 진짜 시크릿은 서버 환경변수로만 둡니다. 서버 시크릿이 필요한 작업은 백엔드 API를 거치게 합니다.
:::

:::details Q3. 빌드타임 변수와 런타임 변수의 차이가 운영에 주는 영향은?
런타임 변수(Spring `${ENV}`)는 같은 jar를 환경변수만 바꿔 여러 환경에 배포할 수 있습니다. 반면 빌드타임 변수(`VITE_*`)는 값이 번들에 박히므로, 값을 바꾸려면 다시 빌드해야 합니다. 그래서 프런트는 가능하면 `VITE_API_BASE_URL`을 비워 상대경로 `/api`로 두고, 동일 출처/프록시로 환경 차이를 흡수해 재빌드를 줄입니다.
:::

:::details Q4. `.env` 파일은 어떻게 관리하나요? 커밋 정책은?
실제 값이 든 `.env`는 gitignore로 절대 커밋하지 않고, 키 목록과 설명만 담은 `.env.example`을 커밋해 "어떤 변수가 필요한지"를 공유합니다. CareerTuner는 `frontend/.env.example`(커밋), `frontend/.env.mock`(mock 토글, 커밋), 실제 `.env`(미커밋) 구조입니다. 운영 값은 파일 대신 CI/배포 플랫폼의 시크릿 저장소로 주입합니다.
:::

:::details Q5. 실수로 시크릿이 들어가는 걸 어떻게 막나요?
다층 방어입니다. (1) 정책: 시크릿은 `VITE_*` 금지, `.env` 미커밋. (2) 빌드 분리: 데모는 `VITE_USE_MOCK=true`로 빌드해 시크릿이 들어갈 코드 경로를 차단. (3) 자동 가드: deploy-demo 워크플로가 공개 배포 직전 `frontend/dist`를 grep으로 스캔해 `DB_PASSWORD`·`JWT_SECRET`·DB IP 패턴이 있으면 `exit 1`로 배포를 막습니다. 사람의 실수를 CI가 잡는 구조입니다.
:::

## 8. 직접 말해보기

다음을 막힘 없이 입으로 설명할 수 있는지 점검하라.

- [ ] 환경변수를 왜 쓰는지 두 가지(환경 분리 / 시크릿 분리)를 한 문장씩.
- [ ] CareerTuner 백엔드의 `${ENV:기본값}` 패턴을 실제 변수(`DB_PASSWORD`, `JWT_SECRET`) 예시로.
- [ ] `VITE_*`가 왜 비밀 보관에 부적합한지 (빌드타임 인라인 → 브라우저 노출).
- [ ] 빌드타임 변수 vs 런타임 변수의 차이와 운영 영향.
- [ ] deploy-demo의 시크릿 스캔이 무엇을 막는지, 어떻게 동작하는지.

## 퀴즈

<QuizBox question="CareerTuner 백엔드 application.yaml의 ${DB_PASSWORD:기본값} 표기에서 콜론 뒤 값의 역할은?" :choices="['환경변수가 없을 때 쓰는 기본값', '암호화된 비밀번호', '환경변수 이름의 별칭', '운영 전용 강제값']" :answer="0" explanation="${ENV:기본값} 패턴에서 콜론 뒤는 환경변수가 주입되지 않았을 때 쓰는 fallback 기본값이다. 운영에서는 환경변수로 진짜 값을 주입하고, 기본값은 개발용 더미로만 둔다." />

<QuizBox question="프런트엔드 VITE_* 환경변수에 대해 옳은 설명은?" :choices="['서버에서만 읽혀 브라우저에 노출되지 않는다', '빌드 시점에 번들에 평문으로 박혀 공개된다', '런타임에 동적으로 바뀐다', '자동으로 암호화되어 안전하다']" :answer="1" explanation="VITE_ 접두사 변수는 빌드타임에 import.meta.env로 번들에 인라인되어 브라우저로 내려간다. 누구나 볼 수 있으므로 공개 가능한 값(클라이언트 키, 공개키)만 넣어야 한다." />

<QuizBox question="CareerTuner의 deploy-demo 워크플로가 공개 데모 배포 직전에 frontend/dist를 grep으로 스캔하는 이유를 설명하라." explanation="실수로 시크릿(DB 비밀번호, JWT 시크릿, OpenAI 키, DB IP 등)이 빌드 산출물에 박혀 공개 repo로 나가는 것을 막기 위한 자동 안전망이다. 패턴이 발견되면 exit 1로 배포를 중단시켜, 사람의 실수를 CI 단계에서 차단한다. 정책(미커밋·VITE_ 금지)과 빌드 분리(mock 빌드)에 더한 마지막 방어선이다." />
