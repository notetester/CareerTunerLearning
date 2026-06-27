# CI/CD (GitHub Actions)

> CI/CD는 코드를 push/PR 하는 순간 빌드·테스트·배포를 자동으로 돌리는 파이프라인입니다. CareerTuner는 GitHub Actions로 5개 워크플로(프론트 검증, 백엔드+워커 테스트, mock 데모 배포, Android APK, iOS 빌드)를 운영하고, 그중 PR 게이트 2개가 dev에 깨진 코드가 들어오는 것을 막습니다.

## 1. 한 줄 정의

CI/CD는 **코드 변경을 자동으로 검증(CI)하고 자동으로 내보내는(CD)** 파이프라인이며, CareerTuner에서는 GitHub Actions가 `.github/workflows/*.yml` 5개로 이를 수행합니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| CI | Continuous Integration(지속적 통합). 여러 사람 코드를 자주 합치고 합칠 때마다 자동 테스트로 깨짐을 즉시 확인 |
| CD | Continuous Delivery/Deployment(지속적 전달/배포). 검증 통과분을 자동으로 산출물·배포로 연결 |
| Workflow | `.github/workflows/*.yml` 한 파일 = 하나의 자동화 단위 |
| Job | 워크플로 안의 실행 묶음. 하나의 러너(가상머신)에서 돌고, job끼리는 기본 병렬 |
| Step | job 안의 한 줄 명령. `uses`(액션 재사용) 또는 `run`(셸 실행) |
| Runner | job을 실행하는 가상머신. `ubuntu-latest`, `macos-15` 등 |
| Trigger | 워크플로를 깨우는 이벤트(`on:`). `pull_request`, `push`, `tags`, `workflow_dispatch` |
| Gate(게이트) | 통과해야만 다음으로 진행 가능한 검사. 실패하면 머지/배포가 막힘 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **깨진 코드가 dev에 합쳐진다.** 사람이 매번 typecheck/test를 손으로 돌리지 않으면 누락된다. 실제로 `frontend-ci.yml` 주석에는 *"2026-06 F 알림 타입 깨짐이 데모 배포를 막았던 사고의 재발 방지"*가 도입 배경으로 적혀 있다.
- **로컬마다 결과가 다르다.** "내 컴퓨터에선 됐는데"를 깨끗한 ubuntu 러너에서 매번 재현해 없앤다.
- **배포가 수작업이라 느리고 위험하다.** 데모 빌드, APK 빌드, 시크릿 스캔을 사람이 하면 빠뜨린다. 특히 공개 repo에 비밀값이 새는 사고를 자동 스캔으로 차단해야 한다.
- **명세·실행 환경이 코드로 남지 않는다.** YAML로 박아두면 "어떻게 빌드/배포하는가"가 그 자체로 문서가 된다.

## 4. CareerTuner에서 어디에 썼나 (실제 파일/워크플로)

위치: 루트 `/.github/workflows/`. 5개 워크플로(영역=인프라).

| 워크플로 파일 | 역할 | 주요 트리거 | 게이트인가 |
| --- | --- | --- | --- |
| `frontend-ci.yml` | 프론트 typecheck + build | `frontend/**` 관련 PR·dev/main push | 예 (PR 게이트) |
| `service-pipeline-ci.yml` | 백엔드 gradle test + Python 워커 unittest + docker smoke | `backend/**`, `ml/job-posting-worker/**` PR·push | 예 (PR 게이트) |
| `deploy-demo.yml` | mock 데모 빌드 → 시크릿 스캔 → 공개 데모 repo push (Pages) | **dev push만** (`frontend/**`) | CD |
| `android-release.yml` | mock 데모 APK 빌드 → GitHub Release 첨부 | 태그 `v*` / `demo-*` push, 수동 | 릴리스 |
| `ios-build.yml` | 무서명 시뮬레이터 빌드 컴파일 검증 | **수동 전용**(`workflow_dispatch`) | 검증 |

:::tip 게이트 vs 배포 구분
`frontend-ci.yml`·`service-pipeline-ci.yml`는 **PR에서 깨짐을 잡는 문지기**, `deploy-demo.yml`은 dev에 합쳐진 뒤 **결과를 공개 데모로 내보내는 배달부**. 평소 PR은 게이트만 돌고, 배포는 dev push 때만 돈다.
:::

## 5. 핵심 동작 원리 (워크플로별 단계)

공통 토대(5개 모두): `permissions: contents: read`(최소 권한), `concurrency`로 같은 ref의 이전 실행을 취소(`cancel-in-progress`)해 자원 낭비 방지, `actions/checkout` + `setup-node`/`setup-java`/`setup-python`로 환경 구성 후 캐시(npm/gradle/pip).

**(1) frontend-ci.yml — 프론트 PR 게이트**
```yaml
# 핵심만 축약
on:
  pull_request: { paths: ['frontend/**', '.github/workflows/frontend-ci.yml'] }
  push: { branches: [dev, main] }
jobs:
  typecheck-build:
    steps:
      - run: npm ci          # 잠금파일대로 정확히 설치
      - run: npm run typecheck   # tsc --noEmit
      - run: npm run build       # vite build
```
- **path 필터**가 영리하다. `frontend/**`뿐 아니라 프론트가 의존하는 백엔드 DTO/컨트롤러 3개 파일(`ApplicationCaseController.java`, `ApplicationCaseExtractionResponse.java`, `ReviewJobPostingExtractionRequest.java`)을 함께 watch한다. 백엔드 응답 모양이 바뀌어 프론트 타입이 깨지는 경우까지 PR 단계에서 잡으려는 의도다.

**(2) service-pipeline-ci.yml — 백엔드+워커 게이트 (3 job 병렬)**

| job | 하는 일 |
| --- | --- |
| `backend-test` | JDK 21(temurin) + `./gradlew test` (JUnit 5) |
| `worker-test` | Python 3.12 + `unittest discover` + 운영 드릴 스크립트 + 합성 43파일 안정화 드릴 + 릴리스 준비 정적 검사 |
| `worker-docker-build` | `docker compose config`로 compose 유효성 검증 + 워커 이미지 smoke test |

- compose 검증 step은 `DB_HOST`, `DB_PASSWORD`, `JWT_SECRET` 같은 값을 **CI 전용 더미값**(`ci-only-not-a-secret` 등)으로 주입해 실제 비밀 없이 통과시킨다. 실제 시크릿은 들어가지 않는다.

**(3) deploy-demo.yml — sanitized 데모 배포 (CD)**
1. private 소스 checkout → `npm ci` → `npm run typecheck` → `npm run build` (단 `VITE_DEMO_MODE=true`, `VITE_USE_MOCK=true`, `VITE_PUBLIC_BASE=/CareerTunerDemo/`로 빌드)
2. SPA fallback: `index.html`을 `404.html`로 복사(GitHub Pages 새로고침 대응)
3. **시크릿 스캔 게이트**: 빌드 결과 `frontend/dist`를 `grep`으로 훑어 `JWT_SECRET`, `OPENAI_API_KEY`, `jdbc:mysql`, 실제 DB 비번 패턴, `client_secret`, 숫자 IP 패턴 등이 보이면 `exit 1`로 **배포 중단**
4. 공개 repo `CareerTunerDemo`를 토큰(`secrets.DEMO_REPO_TOKEN`)으로 checkout → `README.md`/`docs`만 보존하고 내용 교체 → `.nojekyll` 생성 → 커밋·push (변경 없으면 skip)

:::warning 시크릿 스캔이 마지막 안전망
mock 빌드라 원칙적으로 비밀값이 없어야 하지만, 사람 실수로 dist에 값이 섞일 수 있다. 그래서 push 직전에 한 번 더 grep 스캔으로 막는다. 공개 repo로 내보내는 CD에서는 이 게이트가 핵심이다.
:::

**(4) android-release.yml — 데모 APK 릴리스**
- 트리거: `v*`/`demo-*` 태그 push 또는 수동. Node 22 + JDK 21 + Android SDK 36.
- `npm run build:mock` → `npx cap add android`(android/는 gitignore라 매 실행 재생성) → `npx cap sync` → `./gradlew assembleDebug`로 **디버그 서명 APK**(사이드로드용).
- `softprops/action-gh-release`로 APK+web zip을 GitHub Release(prerelease)에 첨부. 팀원은 빌드 없이 Releases에서 받아 BlueStacks에 드래그&드롭.

**(5) ios-build.yml — 무서명 시뮬레이터 빌드**
- `workflow_dispatch` 수동 전용. 이유: **macOS 러너는 private repo에서 분당 과금 10배**라 상시 트리거를 피함.
- `xcodebuild ... CODE_SIGNING_ALLOWED=NO`로 서명 없이 컴파일만 검증, `.app` 산출물을 artifact 업로드(시뮬레이터 전용).

## 6. 면접 답변 3단계

- **초간단(1문장):** "GitHub Actions로 PR마다 프론트 typecheck·빌드와 백엔드·워커 테스트를 자동으로 돌려 깨진 코드를 막고, dev에 합쳐지면 mock 데모를 공개 repo로 자동 배포합니다."
- **기본:** "워크플로가 5개입니다. PR 게이트 둘(frontend-ci는 typecheck+build, service-pipeline-ci는 gradle test+Python unittest+docker smoke)이 머지 전 검증을 하고, deploy-demo는 dev push 때 mock 빌드 후 dist를 시크릿 스캔한 뒤 공개 데모 repo로 push합니다. 추가로 태그 트리거 Android APK 릴리스와 수동 iOS 시뮬레이터 빌드가 있습니다."
- **꼬리질문 대응:** "path 필터로 변경 영역만 돌리고 concurrency로 같은 브랜치의 이전 실행을 취소해 비용을 줄입니다. 프론트 CI는 자기가 의존하는 백엔드 DTO 파일까지 watch해 응답 스키마 변경에 의한 타입 깨짐을 PR에서 잡습니다. 공개 배포 직전엔 dist를 grep으로 스캔해 키·시크릿이 보이면 배포를 중단합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. CI와 CD의 차이는?
CI(지속적 통합)는 변경을 합칠 때마다 자동 빌드·테스트로 검증하는 단계, CD(지속적 전달/배포)는 검증 통과분을 자동으로 산출물·배포까지 연결하는 단계입니다. CareerTuner에서 frontend-ci/service-pipeline-ci가 CI, deploy-demo가 CD입니다.
:::

:::details Q2. PR 게이트는 어떻게 머지를 막나요?
워크플로가 실패하면 해당 PR의 체크가 red로 표시됩니다. 브랜치 보호 규칙에서 해당 체크를 required로 걸어두면 통과 전까지 머지 버튼이 비활성화됩니다. CareerTuner는 dev/main 등을 보호 브랜치로 두고 PR로만 합치며, frontend-ci와 service-pipeline-ci가 그 문지기 역할을 합니다.
:::

:::details Q3. path 필터와 concurrency는 왜 쓰나요?
path 필터(`on.paths`)는 변경된 파일이 해당 영역일 때만 워크플로를 돌려 불필요한 실행과 분(minute) 소모를 줄입니다. concurrency는 같은 ref에서 새 push가 오면 진행 중이던 이전 실행을 취소(`cancel-in-progress`)해 자원을 아끼고 최신 커밋만 검증하게 합니다.
:::

:::details Q4. 공개 repo에 시크릿이 새지 않게 어떻게 보장하나요?
1차로 mock 빌드라 실제 백엔드/키를 안 씁니다. 2차로 deploy-demo가 push 직전 `frontend/dist`를 grep으로 스캔해 `JWT_SECRET`, `OPENAI_API_KEY`, jdbc 문자열, DB 비번 패턴, 숫자 IP 등이 보이면 `exit 1`로 배포를 중단합니다. 시크릿 자체는 GitHub Secrets(`DEMO_REPO_TOKEN` 등)로만 주입하고 코드에 박지 않습니다.
:::

:::details Q5. android/·ios/ 네이티브 폴더가 gitignore인데 어떻게 빌드하나요?
Capacitor가 그 폴더를 생성·동기화하기 때문에 repo에는 안 넣고, 러너에서 매 실행 `npx cap add android`(또는 ios)로 재생성한 뒤 `npx cap sync`로 웹 빌드 결과와 플러그인을 주입합니다. 그래서 산출물은 항상 깨끗한 상태에서 재현됩니다. iOS는 macOS 러너 과금이 비싸 수동 트리거로만 둡니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. "우리 CI/CD 워크플로 5개를 트리거(언제 도는지)와 게이트 여부 기준으로 30초 안에 설명해 보세요."
2. "공개 데모 배포에서 비밀값 유출을 막는 2중 방어를 deploy-demo의 실제 step 순서로 말해 보세요."

관련 문서: [Docker / 컨테이너](/infra/docker-compose) · [환경변수와 시크릿](/infra/env-and-secrets) · [Git 협업 규칙](/infra/git-workflow)

## 퀴즈

<QuizBox question="CareerTuner의 PR 단계에서 깨진 코드 머지를 막는 게이트 역할 워크플로 조합으로 가장 정확한 것은?" :choices="['deploy-demo.yml 과 ios-build.yml', 'frontend-ci.yml 과 service-pipeline-ci.yml', 'android-release.yml 과 deploy-demo.yml', 'ios-build.yml 단독']" :answer="1" explanation="frontend-ci(typecheck+build)와 service-pipeline-ci(gradle test+Python unittest+docker smoke)가 PR 게이트다. deploy-demo는 dev push CD, android-release는 태그 릴리스, ios-build는 수동 검증이다." />

<QuizBox question="deploy-demo.yml 이 공개 데모 repo로 push 하기 직전에 수행하는 안전장치는 무엇이며 왜 중요한가?" explanation="빌드 결과물인 frontend/dist 폴더를 grep -RInE 로 스캔해 JWT_SECRET, OPENAI_API_KEY, jdbc:mysql, DB 비번, client_secret, 숫자 IP 같은 시크릿 패턴이 있는지 검사하고, 하나라도 매칭되면 exit 1 로 배포를 중단한다. 공개 repo(CareerTunerDemo)로 내보내는 CD이기 때문에, mock 빌드라도 사람 실수로 섞인 비밀값이 외부에 노출되는 사고를 막는 마지막 안전망이다." />

<QuizBox question="ios-build.yml 이 push 가 아니라 workflow_dispatch(수동) 트리거로만 설정된 주된 이유는?" :choices="['iOS 빌드는 게이트가 아니라서', 'macOS 러너가 private repo에서 분당 과금이 약 10배라 비용 때문', 'Capacitor 가 iOS 를 지원하지 않아서', 'GitHub Actions 가 macOS 를 지원하지 않아서']" :answer="1" explanation="ios-build.yml 주석에 명시돼 있다. macOS 러너는 비공개 저장소에서 분당 과금이 10배라 상시 트리거를 피하고 필요할 때만 수동 실행한다." />
