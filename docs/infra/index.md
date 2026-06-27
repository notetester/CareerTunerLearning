# 인프라/협업 개요

> "빌드는 Gradle(백)·Vite(프론트), 검증은 GitHub Actions 5종, 배포는 Docker Compose, 협업은 개인 브랜치에서 dev로 PR입니다."

이 페이지는 CareerTuner 인프라 영역의 **지도**다. 빌드 도구, CI/CD 파이프라인, 배포 형태, Git 협업 규칙, 환경/시크릿 관리, 테스트 전략이 어디서 어떻게 맞물리는지 한 장으로 잡고, 각 주제의 상세 페이지로 내려가는 학습 순서를 제시한다.

---

## 영역 소개 — CareerTuner 인프라 한눈에

CareerTuner는 4개의 런타임 컴포넌트로 돌아간다. 인프라는 이 조각들을 **빌드 → 검증 → 배포 → 협업**의 한 흐름으로 묶는 일이다.

| 컴포넌트 | 기술 | 포트 | 빌드 도구 |
| --- | --- | --- | --- |
| backend | Spring Boot 4 + Java 21 + MyBatis | 8080 | Gradle (`bootJar`) |
| frontend | React 18 + Vite 6 + TS + Tailwind v4 | 5173 | Vite (`vite build`) |
| job-posting-worker | Python Flask 공고추출 | 8091 | pip + Docker |
| qdrant | RAG 벡터 DB | 6333/6334 | 공식 이미지 |

핵심 설계 결정 한 줄 요약:

- **MySQL은 컨테이너에 넣지 않는다.** 팀 공용 원격 인스턴스를 재사용한다 (`docker-compose.yml` 주석에 명시).
- **이미지 빌드 때 테스트를 돌리지 않는다.** `bootJar -x test` — 테스트는 CI에서 따로 한다.
- **시크릿은 평문 커밋 금지.** 전부 환경변수 기본값 패턴(`ENV:기본값`)으로 주입.

---

## 왜 인프라를 따로 공부하나 (없으면 무슨 문제)

| 인프라가 없으면 | 실제로 생기는 사고 |
| --- | --- |
| CI가 없으면 | 타입 깨진 코드가 dev에 들어가 데모 배포가 멈춤 (실제로 `frontend-ci.yml` 주석에 "F 알림 타입 깨짐 사고 재발 방지"라고 기록됨) |
| Docker Compose가 없으면 | 4개 컴포넌트 + 포트 + 의존 순서를 손으로 맞춰야 함 |
| 환경변수 패턴이 없으면 | DB 비밀번호·API 키가 코드에 박혀 공개 repo로 유출 |
| Git 보호 브랜치가 없으면 | 6명이 dev에 직접 push해서 서로 덮어씀 |
| 시크릿 스캔이 없으면 | 데모 빌드 결과물에 키가 섞여 GitHub Pages로 공개됨 |

면접에서 "협업을 어떻게 했나"는 거의 반드시 나온다. 인프라 영역은 그 답의 근거다.

---

## 권장 학습 순서

> 이 영역의 상세 페이지를 아래 순서로 읽으면 빌드부터 배포까지 흐름이 자연스럽게 이어진다.

1. **[빌드 시스템](/infra/gradle)** — Gradle `bootJar`, Vite `build`/`build:mock`, `typecheck` 스크립트. 무엇이 산출물인지부터.
2. **[CI/CD (GitHub Actions)](/infra/github-actions)** — 5종 워크플로가 각각 무엇을 게이트하는지.
3. **[Docker 배포](/infra/docker-compose)** — 멀티스테이지 Dockerfile, Compose 4서비스, healthcheck·의존 순서.
4. **[환경변수와 시크릿](/infra/env-and-secrets)** — `ENV:기본값` 패턴, `VITE_*` 클라이언트 변수, 데모 시크릿 스캔.
5. **[Git 협업 전략](/infra/git-workflow)** — 개인 브랜치 → dev PR, 커밋 prefix, 서브모듈.
6. **[테스트 전략](/infra/testing)** — JUnit 5, contract 테스트, Python unittest의 역할 분담.

연관 개념: [DTO](/glossary/dto) · [ApiResponse 엔벨로프](/glossary/api-response-envelope) · [JWT 보안](/backend/jwt-security)

:::tip 한 번에 다 외우려 하지 말 것
면접에서는 "흐름"을 묻지 "워크플로 파일 이름"을 묻지 않는다. **빌드→검증→배포→협업** 4단어 골격을 먼저 잡고, 각 단계에서 우리가 내린 결정 1~2개만 정확히 말할 수 있으면 충분하다.
:::

---

## 인프라 전체 흐름 (한 장)

코드 한 줄이 사용자에게 닿기까지:

```text
개인 브랜치 작업
   │ git push (보호 브랜치 dev/main/master/live 직접 push 금지)
   ▼
Pull Request → dev
   │  ── PR에서 자동 실행 ──
   ├─ frontend-ci          : tsc --noEmit + vite build
   └─ service-pipeline-ci  : ./gradlew test + Python unittest + docker compose config + 워커 스모크
   │
   ▼ (리뷰 후 머지)
dev push
   ├─ deploy-demo          : mock 빌드 → 시크릿 스캔 → 공개 데모 repo 푸시 → GitHub Pages
   ├─ android-release      : APK 빌드
   └─ ios-build            : 시뮬레이터 빌드
   │
   ▼ (서버 배포)
docker compose up -d --build
   backend(8080) + qdrant(6333) + job-posting-worker(8091)
   (MySQL은 외부 원격 인스턴스 재사용)
```

---

## 빌드·CI/CD·배포 빠른 참조표

### 빌드 명령

| 대상 | 명령 | 산출물 |
| --- | --- | --- |
| 백엔드 | `./gradlew bootJar -x test` | 실행 가능한 `*-SNAPSHOT.jar` |
| 백엔드 실행 | `./gradlew bootRun` | 로컬 :8080 |
| 프론트 | `npm run build` (`vite build`) | `dist/` 정적 번들 |
| 프론트 mock | `npm run build:mock` | 백엔드 없이 도는 데모 번들 |
| 타입체크 | `npm run typecheck` (`tsc --noEmit`) | 타입 오류만 검사, 출력물 없음 |
| 모바일 | `npm run mobile:sync` → `mobile:apk` | Capacitor android APK |

### GitHub Actions 5종 (+ 4090 트리거)

| 워크플로 | 언제 | 무엇을 게이트 |
| --- | --- | --- |
| `frontend-ci` | PR/푸시(frontend 변경) | `typecheck` + `build` |
| `service-pipeline-ci` | PR/푸시(backend·worker 변경) | `gradlew test` + Python `unittest` + `docker compose config` + 워커 docker 스모크 |
| `deploy-demo` | **dev push만** | mock 빌드 → **시크릿 스캔** → 공개 데모 repo 푸시 → Pages |
| `android-release` | (수동/태그) | 안드로이드 APK |
| `ios-build` | (수동/태그) | iOS 시뮬레이터 빌드 |

:::details deploy-demo의 시크릿 스캔이 핵심인 이유
`deploy-demo.yml`은 빌드 결과(`frontend/dist`)를 공개 repo에 푸시하기 **직전에** `grep`으로 위험 패턴을 훑는다 — JDBC URL, `DB_PASSWORD`, `JWT_SECRET`, `OPENAI_API_KEY`, `client_secret`, 숫자 IP 패턴 등. 하나라도 걸리면 `exit 1`로 배포를 멈춘다. "공개 데모를 어떻게 안전하게 내보냈나"라는 질문의 정답이 여기 있다.
:::

### 배포 (Docker Compose)

| 서비스 | 이미지 | 비고 |
| --- | --- | --- |
| backend | 멀티스테이지(JDK21 build → JRE21 run) | non-root `appuser`, `media_uploads` 볼륨 |
| job-posting-worker | Python 이미지 | `healthcheck` 통과해야 backend 시작 |
| qdrant | `qdrant/qdrant:latest` | `qdrant_storage` 볼륨 |
| MySQL | — | **컨테이너 없음**, 외부 인스턴스 재사용 |

---

## 단골 면접 질문 5개 (이 영역에서 반드시 나옴)

1. **"CI/CD 파이프라인을 설명해 주세요."**
   → "PR이 올라오면 frontend는 타입체크+빌드, backend는 테스트+워커 스모크가 자동으로 돕니다. dev에 머지되면 데모 배포 워크플로가 mock 빌드를 만들고, 공개 repo로 보내기 전에 시크릿을 스캔합니다."

2. **"왜 MySQL을 Docker Compose에 넣지 않았나요?"**
   → "팀 공용 원격 인스턴스를 6명이 함께 쓰기 때문입니다. 컨테이너 MySQL은 데이터가 격리돼 협업과 어긋나서, 외부 인스턴스를 환경변수로 주입하는 쪽을 택했습니다."

3. **"시크릿을 어떻게 관리했나요?"**
   → "코드에 평문 금지 원칙으로, application.yaml은 `환경변수:기본값` 패턴을 쓰고 실값은 `.env`/CI 시크릿으로 주입합니다. 클라이언트에 노출돼도 되는 값만 `VITE_` 접두어로 분리하고, 데모 배포 전에는 빌드 산출물을 시크릿 스캔으로 한 번 더 거릅니다."

4. **"브랜치 전략과 협업 규칙은요?"**
   → "개인 브랜치에서 작업하고 dev로 PR을 보냅니다. dev/main/master/live는 보호 브랜치라 직접 push를 막았고, 커밋 메시지는 `feat:/fix:/docs:` 같은 영어 prefix + 한국어 본문으로 통일했습니다."

5. **"Docker 이미지를 어떻게 최적화했나요?"**
   → "멀티스테이지로 JDK 빌드 스테이지와 JRE 런타임 스테이지를 분리해 런타임 이미지에서 빌드 도구를 뺐습니다. 빌드 스크립트를 소스보다 먼저 COPY해 의존성 레이어를 캐시하고, 런타임은 non-root 사용자로 실행합니다."

---

## 직접 말해보기

:::warning 입으로 소리 내어 답해볼 것 (각 60초)
1. CareerTuner의 코드 한 줄이 push되고 나서 데모 사이트에 반영되기까지의 흐름을, 거치는 워크플로 이름과 함께 순서대로 말해보라.
2. "공개 repo인데 비밀번호 유출 안 됐나요?"라는 압박 질문에, 환경변수 패턴 + 데모 시크릿 스캔 두 단계 방어를 들어 30초 안에 반박해보라.
:::

---

## 퀴즈

<QuizBox question="CareerTuner의 Docker Compose에 포함되지 않는 컴포넌트는?" :choices="['backend', 'qdrant', 'job-posting-worker', 'MySQL']" :answer="3" explanation="MySQL은 팀 공용 원격 인스턴스를 재사용하므로 docker-compose.yml에 서비스로 넣지 않고 환경변수(DB_HOST 등)로 접속 정보만 주입한다." />

<QuizBox question="deploy-demo 워크플로가 공개 repo에 빌드 결과를 푸시하기 직전에 수행하는, 보안상 가장 중요한 단계는?" :choices="['단위 테스트 실행', '빌드 산출물 시크릿 패턴 스캔', '도커 이미지 빌드', 'Gradle bootJar']" :answer="1" explanation="deploy-demo.yml은 frontend/dist를 공개 repo로 보내기 전에 grep으로 DB_PASSWORD·JWT_SECRET·OPENAI_API_KEY·JDBC URL·숫자 IP 등 위험 패턴을 검사하고, 발견 시 exit 1로 배포를 중단한다." />

<QuizBox question="백엔드 Dockerfile이 멀티스테이지(JDK build → JRE run)로 나뉜 이유를 한 문단으로 설명하라." explanation="빌드에는 JDK와 Gradle이 필요하지만 실행에는 JRE만 있으면 된다. 빌드 스테이지에서 bootJar를 만들고 런타임 스테이지에는 그 산출물 jar만 복사하면, 최종 이미지에서 빌드 도구·소스·캐시가 빠져 이미지 크기가 줄고 공격 표면이 작아진다. 추가로 빌드 스크립트를 소스보다 먼저 COPY해 의존성 레이어를 캐시하고, 런타임은 non-root appuser로 실행해 보안을 강화한다." />
