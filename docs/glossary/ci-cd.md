# CI / CD

> "코드를 push하면 GitHub Actions가 자동으로 타입검사·테스트·빌드를 돌리고(CI), 통과한 것만 데모 환경에 배포(CD)합니다. 사람이 깜빡할 일을 파이프라인 게이트가 막아줍니다."

## 1. 한 줄 정의

- **CI(지속적 통합)**: 코드를 자주 합치면서, 합칠 때마다 자동으로 빌드·테스트·검증을 돌려 깨진 코드를 조기에 잡는 것.
- **CD(지속적 배포/전달)**: 검증을 통과한 코드를 자동으로 빌드·패키징해서 배포 가능한 상태로(또는 실제 배포까지) 흘려보내는 것.

CareerTuner에서는 `.github/workflows/` 아래 GitHub Actions 워크플로 6개가 이 역할을 나눠 맡는다.

## 2. 단어 뜻 (약자/어원 풀이)

| 약자 | 풀이 | 핵심 |
| --- | --- | --- |
| CI | Continuous **I**ntegration | 자주 합치고, 합칠 때마다 자동 검증 |
| CD | Continuous **D**elivery / **D**eployment | Delivery=배포 직전까지 자동, Deployment=실제 배포까지 자동 |
| Pipeline | 일련의 자동화 단계(체크아웃 → 설치 → 검증 → 배포) | 한 단계라도 실패하면 멈춤 |
| Gate(게이트) | 통과해야 다음으로 넘어가는 검문소 | "타입 깨지면 배포 못 함" |
| Runner | 워크플로를 실제로 실행하는 머신(`ubuntu-latest` 등) | GitHub가 빌려주는 일회용 VM |
| Job / Step | Job=병렬로 도는 작업 단위, Step=Job 안의 순차 명령 | 한 워크플로에 여러 Job, Job마다 여러 Step |

:::tip Delivery vs Deployment
둘 다 CD지만 마지막 한 끗이 다르다. **Delivery**는 "언제든 배포 가능한 산출물"까지 자동, 실제 출시는 사람이 버튼. **Deployment**는 그 출시까지 자동. CareerTuner의 `deploy-demo`는 dev에 push만 하면 데모 사이트가 갱신되므로 Deployment에 가깝다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **"내 컴퓨터에선 됐는데"의 종말**: 깨끗한 러너에서 매번 처음부터 빌드하므로 로컬 캐시·환경 의존 버그가 드러난다.
- **조기 차단**: 타입 에러나 깨진 테스트가 dev 브랜치에 합쳐지기 전에 PR 단계에서 막힌다.
- **실제 사고 기반 방어**: `frontend-ci.yml` 주석에 기록돼 있듯, 2026-06 알림 타입 깨짐이 데모 배포를 막은 사고가 있었다. 그래서 평소 PR에서 `npm run typecheck`를 게이트로 둬 재발을 막는다.
- **보안 게이트**: 데모는 공개 repo로 나가므로, 배포 직전 비밀 패턴을 스캔해 시크릿 유출을 차단한다.
- **반복 노동 제거**: APK 빌드, mock 데모 배포 같은 잡일을 사람 손에서 떼어 자동화한다.

## 4. CareerTuner에서 어디에 썼나 (실제 워크플로 파일)

전부 `.github/workflows/` 아래에 있다. (영역 표시: CI/CD 인프라는 공통/팀장 영역, 본인=영역 C는 이 파이프라인 위에서 백엔드 테스트가 도는 소비자다.)

| 파일 | 종류 | 트리거 | 하는 일 |
| --- | --- | --- | --- |
| `frontend-ci.yml` | CI | `frontend/**` 관련 PR·push(dev/main) | Node 22, `npm ci` → `npm run typecheck` → `npm run build` |
| `service-pipeline-ci.yml` | CI | `backend/**`·worker·compose 변경 PR·push | JDK21 `./gradlew test` + Python `unittest`·운영 드릴 + docker compose 검증·스모크 (Job 3개) |
| `deploy-demo.yml` | CD | `dev` push(frontend 변경 시) | mock 빌드 → 시크릿 스캔 → 공개 데모 repo로 push(GitHub Pages) |
| `android-release.yml` | CD | 태그 push(`v*`/`demo-*`)·수동 | Capacitor mock APK + 웹 zip 빌드 → GitHub Release 첨부 |
| `ios-build.yml` | CI(검증) | 수동(`workflow_dispatch`)만 | 무서명 시뮬레이터 빌드로 iOS 컴파일만 확인 |
| `4090-job-trigger.yml` | 운영(PoC) | 수동(`workflow_dispatch`)만 | 자체 LLM 작업(영역 C) 외부 GPU 박스 트리거 — secret 가드 + forced-command SSH |

:::details 영역 C 관점 — 내 코드가 게이트를 지나는 경로
적합도 분석(`FitAnalysisAiService`), 취업경향(`CareerAnalysisRunService`), 대시보드 인사이트(`DashboardInsightAiCommand`) 등 영역 C의 백엔드 코드를 고치면 `backend/**` 경로에 걸려 `service-pipeline-ci.yml`의 `./gradlew test`가 돈다. 즉 `OpenAiFitAnalysisAiServiceTest` 같은 JUnit 테스트가 PR에서 자동 실행되어, 깨진 채로 dev에 합쳐지는 걸 막는다. 또 자체 LLM 평가 작업은 `4090-job-trigger.yml`로 외부 GPU를 수동 트리거하는데, 이건 자동 CI가 아니라 운영용 PoC다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

**워크플로 한 개의 뼈대** — `on`(언제) → `jobs`(무엇을) → `steps`(순서대로).

```yaml
on:                          # 트리거: 언제 돌릴지
  pull_request: { paths: ['frontend/**'] }
  push: { branches: [dev, main] }
concurrency:                 # 같은 브랜치 중복 실행 취소(낭비 방지)
  group: frontend-ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  typecheck-build:
    runs-on: ubuntu-latest   # 일회용 깨끗한 러너
    steps:
      - uses: actions/checkout@v6      # 1) 코드 체크아웃
      - uses: actions/setup-node@v6    # 2) 런타임 준비(+캐시)
      - run: npm ci                    # 3) 의존성 고정 설치
      - run: npm run typecheck         # 4) 게이트: tsc --noEmit
      - run: npm run build             # 5) 게이트: 빌드 성공해야 통과
```

**게이트가 작동하는 핵심**: 어떤 step이든 0이 아닌 종료코드(실패)를 반환하면 그 즉시 job이 빨간 X로 멈춘다. PR 화면에서 빨간 체크는 머지를 시각적으로 차단한다.

**한 워크플로 안의 여러 Job(병렬 게이트)**: `service-pipeline-ci.yml`은 Job을 셋으로 쪼갠다 — `backend-test`(JDK21 `./gradlew test`), `worker-test`(Python `unittest` + 운영 드릴 + 합성 안정화 픽스처 + 릴리스 준비 정적 점검), `worker-docker-build`(`docker compose config` 검증 + 워커 이미지 스모크). 세 Job은 병렬로 돌고 하나라도 실패하면 전체가 실패다.

**선택적 실행(paths 필터)**: 프런트만 고쳤는데 백엔드 테스트까지 도는 낭비를 막으려고, 워크플로마다 `paths`로 관심 경로를 좁힌다. 단, `frontend-ci.yml`은 프런트 타입이 의존하는 일부 백엔드 컨트롤러·DTO 파일(예: `ApplicationCaseController.java`, `ApplicationCaseExtractionResponse.java`)도 트리거에 포함해, 백엔드 계약 변경으로 프런트 타입이 깨지는 경우를 잡는다.

**배포 직전 시크릿 게이트** (`deploy-demo.yml`) — 공개 repo로 나가기 전 마지막 검문:

```bash
# dist 폴더에서 비밀 패턴이 발견되면 exit 1 → 배포 중단
if grep -RInE "DB_PASSWORD|JWT_SECRET|OPENAI_API_KEY|jdbc:mysql|client_secret|<숫자IP패턴>" frontend/dist; then
  echo "Potential secret found. Stop deployment."
  exit 1
fi
```

이 빌드는 `VITE_USE_MOCK=true`, `VITE_DEMO_MODE=true`로 mock 데이터만 담아 만들어지고, SPA용 `404.html` 폴백을 추가한 뒤 공개 데모 repo(`CareerTunerDemo`)로 push되어 GitHub Pages로 서빙된다. 데모 repo의 `README.md`·`docs/`는 보존하고 나머지를 덮어쓴다.

**시크릿은 워크플로 안에 값이 없다**: DB/JWT 등은 전부 `${​{ secrets.XXX }}` 또는 CI 전용 더미값으로만 참조한다. 예를 들어 `4090-job-trigger.yml`은 첫 step에서 필수 secret(SSH 키·호스트 등)이 비어 있으면 즉시 `exit 1`로 가드하고, GPU 박스에는 정규식으로 검증한 `jobId`만 forced-command SSH로 전달해 임의 셸 명령 주입을 막는다.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "코드를 올리면 GitHub Actions가 자동으로 타입검사·테스트·빌드를 돌리고, 통과한 것만 데모로 배포되게 해놨습니다."
- **기본**: "워크플로를 6개 운영합니다. 프런트는 PR마다 typecheck+build, 백엔드/워커는 Job을 셋으로 나눠 gradle test·python unittest·docker 스모크를 병렬로 돌립니다. dev에 push되면 mock 데모를 빌드해 공개 repo로 자동 배포하고, 그 직전에 시크릿 스캔 게이트를 둬서 비밀값 유출을 막습니다. 태그를 달면 데모 APK도 자동으로 빌드돼 Release에 붙습니다."
- **꼬리질문 대응**: "게이트 발상은 실제 사고에서 나왔습니다. 알림 타입이 깨진 채로 데모 배포가 막힌 적이 있어, 평소 PR에서 typecheck를 강제하도록 frontend-ci를 추가했습니다. 또 paths 필터로 관련 변경에만 워크플로가 돌게 해 러너 비용을 아끼고, concurrency로 같은 브랜치 중복 실행을 취소합니다. macOS 러너는 과금이 커서 iOS 빌드는 수동으로만 둡니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. CI와 CD의 차이가 뭔가요?
CI는 "자주 합치고 합칠 때마다 자동 검증"으로 깨진 코드를 조기에 잡는 것이고, CD는 "검증 통과한 산출물을 자동으로 배포 가능 상태(또는 실제 배포)까지 흘려보내는 것"입니다. CareerTuner에선 `service-pipeline-ci`가 CI, `deploy-demo`가 CD에 해당합니다.
:::

:::details Q. 테스트가 실패하면 배포가 어떻게 막히나요?
step이 0이 아닌 종료코드를 내면 job이 즉시 실패로 멈춥니다. PR에선 빨간 체크로 머지를 막고, `deploy-demo`는 dev push 때만 도는데 그 안에서도 typecheck → build → 시크릿 스캔이 순차 게이트라 하나라도 실패하면 그 뒤 push 단계까지 가지 못합니다.
:::

:::details Q. 모든 PR에서 모든 워크플로가 다 도나요?
아니요. `paths` 필터로 관심 경로만 트리거합니다. 프런트만 고치면 frontend-ci만, 백엔드/워커를 고치면 service-pipeline-ci만 돕니다. 다만 프런트 타입이 의존하는 일부 백엔드 컨트롤러·DTO 변경은 frontend-ci 트리거에도 넣어, 계약 깨짐을 양쪽에서 잡습니다.
:::

:::details Q. 공개 데모로 나가는데 시크릿이 새지 않나요?
빌드를 mock 모드(`VITE_USE_MOCK=true`)로 만들어 실데이터·실키가 번들에 들어가지 않게 하고, 배포 직전 `grep`으로 DB_PASSWORD·JWT_SECRET·OPENAI_API_KEY·jdbc 문자열·숫자 IP 같은 패턴을 스캔해 하나라도 걸리면 exit 1로 배포를 중단합니다. 또 클라이언트 노출 변수는 `VITE_` 접두사 규칙으로만 다루고, 워크플로 안에는 실제 비밀값을 두지 않고 `${​{ secrets.* }}`로만 참조합니다.
:::

:::details Q. macOS 러너(ios-build)·외부 GPU(4090)는 왜 수동 실행만 하나요?
비공개 저장소에서 macOS 러너는 분당 과금이 Linux의 약 10배라, 자동 트리거 대신 `workflow_dispatch`(수동 버튼)로만 둬서 비용을 통제합니다(목적도 무서명 시뮬레이터 빌드로 "컴파일이 되는가"만 확인). `4090-job-trigger`도 외부 GPU 자원을 임의로 깨우지 않도록 수동 전용이고, 필수 secret가 없으면 첫 step에서 막힙니다.
:::

:::details Q. 한 워크플로에 Job을 여러 개 두는 이유는?
독립적인 검증을 병렬로 돌려 전체 시간을 줄이고, 어느 영역이 깨졌는지 한눈에 보기 위해서입니다. `service-pipeline-ci`는 backend-test·worker-test·worker-docker-build로 나뉘어 있어, 예컨대 도커 스모크만 실패하면 그 Job만 빨갛게 떠 원인 추적이 빠릅니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. CareerTuner의 CI/CD 파이프라인을 면접관 앞에서 30초로 설명해 보라 — 워크플로 개수, 무엇을 검증하는지, 배포가 어떻게 일어나는지 순서대로.
2. "왜 PR마다 typecheck를 강제하나요?"라는 꼬리질문에, 실제 사고 사례와 게이트 개념을 엮어 1분 안에 답해 보라.

관련 페이지: [DTO](/glossary/dto) · [JWT 보안](/backend/jwt-security) · [ApiResponse 엔벨로프](/glossary/api-response-envelope)

## 퀴즈

<QuizBox question="CareerTuner의 deploy-demo 워크플로에서, 빌드한 dist를 공개 repo로 push하기 직전에 반드시 통과해야 하는 게이트는?" :choices="['단위 테스트 커버리지 측정', 'grep으로 비밀 패턴(시크릿) 스캔', '코드 포매팅 검사', '디자인 QA 승인']" :answer="1" explanation="deploy-demo.yml은 dist 폴더에서 DB_PASSWORD·JWT_SECRET·OPENAI_API_KEY·jdbc·숫자 IP 등의 패턴을 grep으로 스캔하고, 하나라도 발견되면 exit 1로 배포를 중단한다. 공개 repo 유출 방지용 보안 게이트다." />

<QuizBox question="CI와 CD의 차이를 한 문장으로 설명해 보라." explanation="CI(지속적 통합)는 코드를 자주 합치면서 합칠 때마다 자동으로 빌드·테스트·검증을 돌려 깨진 코드를 조기에 잡는 것이고, CD(지속적 배포)는 그렇게 검증을 통과한 산출물을 자동으로 빌드·패키징해 배포 가능 상태(또는 실제 배포)까지 흘려보내는 것이다. CareerTuner에선 service-pipeline-ci가 CI, deploy-demo가 CD에 해당한다." />

<QuizBox question="프런트엔드만 수정한 PR인데도 frontend-ci가 일부 백엔드 파일 변경에도 트리거되도록 설정한 이유는?" :choices="['백엔드 테스트를 프런트에서 대신 돌리려고', '프런트 타입이 의존하는 백엔드 컨트롤러·DTO 계약이 깨지면 프런트 타입도 깨지므로', '러너 비용을 늘리려고', 'CD를 트리거하려고']" :answer="1" explanation="frontend-ci.yml은 ApplicationCaseController.java 등 프런트 타입이 의존하는 백엔드 컨트롤러·DTO도 paths에 포함한다. 백엔드 계약이 바뀌어 프런트 타입이 깨지는 경우를 PR 단계에서 잡기 위함이다." />
