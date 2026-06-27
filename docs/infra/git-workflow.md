# Git 협업 전략

> CareerTuner는 6명이 기능별로 수직 분담하고, 각자 개인 브랜치에서 작업한 뒤 보호 브랜치 `dev`로 PR을 올려 리뷰·머지하는 방식으로 협업합니다. `dev`에 직접 push는 금지합니다.

## 1. 한 줄 정의

여러 명이 같은 코드베이스를 망치지 않고 동시에 개발하기 위해, **브랜치를 어떻게 나누고 / 커밋을 어떻게 쓰고 / 어떤 절차로 합칠지**를 팀이 합의해 정한 규칙의 집합입니다.

## 2. 단어 뜻 (용어 풀이)

| 용어 | 뜻 |
| --- | --- |
| **Branch(브랜치)** | 커밋 히스토리의 분기. 작업을 격리하는 작업 공간 |
| **Protected branch(보호 브랜치)** | 직접 push가 막힌 브랜치. PR을 거쳐야만 변경 가능 (`dev`/`main`/`master`/`live`) |
| **PR(Pull Request)** | "내 브랜치를 너희 브랜치에 합쳐줘"라는 병합 요청 + 리뷰 단위 |
| **Merge(머지)** | 두 브랜치의 변경을 하나로 합치는 것 |
| **Conflict(충돌)** | 같은 파일의 같은 줄을 양쪽이 다르게 고쳐 Git이 자동 병합 못 하는 상태 |
| **Submodule(서브모듈)** | 한 repo 안에 다른 repo를 "포인터(특정 커밋 SHA)"로 끼워 넣는 것 |
| **Trailer(트레일러)** | 커밋 메시지 맨 아래 `Key: Value` 형태 메타데이터 (예: `Co-Authored-By`) |

`feat` = feature(기능), `fix` = bugfix(버그 수정), `docs` = documentation, `chore` = 잡일(빌드/설정), `refactor` = 동작 변경 없는 구조 개선.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

규칙 없이 6명이 `dev`에 직접 push하면:

- **덮어쓰기·유실** — 같은 파일을 동시에 밀어 넣다 서로 작업을 날립니다.
- **리뷰 부재** — 검토 없이 들어간 코드가 빌드를 깨고, 누가 무엇을 왜 바꿨는지 추적 불가.
- **히스토리 오염** — `수정`, `ㅁㄴㅇ`, `최종_진짜최종` 같은 커밋이 쌓여 나중에 변경 추적·롤백이 불가능.
- **CI 우회** — typecheck·테스트를 통과하지 않은 코드가 공유 브랜치로 직행.

CareerTuner는 이걸 막으려고 **개인 브랜치 → PR → 보호 브랜치** 흐름과 **커밋 컨벤션**을 강제합니다.

:::warning 공개 repo라서 더 중요한 규칙
CareerTuner의 커밋 메시지와 PR 본문에는 **AI 도구 흔적(`Co-Authored-By`, "Generated with ...", 이모지 서명 등)을 절대 넣지 않습니다.** 이건 각 도구 기본 동작보다 우선하는 팀 규칙입니다. 또한 비밀번호·API 키·실제 IP는 커밋에 절대 포함하지 않으며, `deploy-demo` 워크플로가 빌드 결과를 시크릿 패턴으로 스캔합니다.
:::

## 4. CareerTuner에서 어디에 썼나 (인프라 영역)

규칙의 단일 출처는 루트 **`AGENTS.md`** 의 "커밋/PR 규칙 / git push 절차 / 작업 범위 규칙" 섹션이며, `CLAUDE.md`는 이를 불러오는 shim입니다.

| 항목 | 실제 적용 위치 / 근거 |
| --- | --- |
| 브랜치 전략 | 개인 브랜치(예: `feature/area-c`, `feature/area-d`) → `dev` PR. 실제 머지 커밋: `Merge pull request #42 from <계정>/feature/area-c` |
| 보호 브랜치 | `dev` / `main` / `master` / `live` 직접 push 금지 (`AGENTS.md` push 절차 1단계) |
| 커밋 컨벤션 | prefix 영어(`feat:`/`fix:`/`docs:`/`chore:`/`refactor:`) + 본문 한국어. 실제 예: `fix: schema.sql notice 테이블 주석 오타 수정` |
| 수직 분담 | A~F 6명, 본인=영역 C. 담당표 `docs/TEAM_WORK_DISTRIBUTION.md`, 빠른 참조 `docs/FEATURE_OWNERSHIP.md` |
| 공통 영역 Owner | `common/`, `ai/common`, `routes.ts`, `schema.sql`, `build.gradle` 등은 팀장 승인 필요 |
| 서브모듈 | `docs/storyboard/` → `CareerTunerDocs` (`.gitmodules`, branch `main`). C 작업은 `docs/storyboard/C/` |
| CI 게이트 | `.github/workflows/` 5종 — `frontend-ci`(typecheck+build), `service-pipeline-ci`(backend test + worker unittest + docker smoke), `deploy-demo`, `android-release`, `ios-build` |

:::tip 영역 C 입장에서
저는 `feature/area-c` 브랜치에서 적합도 분석(`fitanalysis/ai`), 취업경향 분석(`analysis/ai`), 대시보드 요약(`dashboard/ai`) 같은 **C 담당 폴더만** 건드리고, `routes.ts`·`schema.sql` 같은 공통 파일은 변경 전 팀 합의를 먼저 받습니다.
:::

## 5. 핵심 동작 원리 (작업 1사이클)

```bash
# 1) dev 최신화 후 개인 브랜치에서 출발 (서브모듈 포인터까지 따라옴)
git checkout dev && git pull
git checkout feature/area-c

# 2) 작업 → 커밋 (prefix 영어 + 본문 한국어)
git add backend/.../fitanalysis
git commit -m "feat: 적합도 분석 부족역량 추천 로직 보강"

# 3) push 절차: 현재 브랜치 확인 → fetch → origin/dev 겹침 점검
git fetch origin
git push origin feature/area-c

# 4) PR: 개인 브랜치 -> dev. 리뷰 통과 + CI 통과 후 머지
```

**`AGENTS.md`의 push 절차(요약):**

1. 현재 브랜치 확인 — 보호 브랜치면 push 중단하고 사용자에게 알림
2. `git fetch origin`
3. `origin/dev`에 새 커밋이 있으면 내가 고친 파일과 겹치는지 분석해 보고 → "그대로 push / merge 후 push" 선택
4. 커밋 메시지에 AI 도구 표기 없는지 확인
5. `git push origin <현재브랜치>`

**충돌 처리** — `dev`가 앞서갔을 때:

```bash
git fetch origin
git merge origin/dev          # 충돌 발생 시
# <<<<<<< / ======= / >>>>>>> 마커 구간을 직접 정리
git add <해결한 파일>
git commit                    # 머지 커밋 완료
```

:::details 서브모듈은 "내용"이 아니라 "포인터"를 커밋한다
`docs/storyboard/`는 별도 repo(CareerTunerDocs)입니다. 수정은 **그 폴더 안에서** commit·push하고, 새 버전을 메인에 고정하려면 루트에서 `git add docs/storyboard && git commit`으로 가리키는 커밋 SHA만 갱신해 PR합니다. 메인을 그냥 클론하면 이 폴더는 빈 포인터라 본체 용량에 영향이 없고, 필요할 때만 `git submodule update --init docs/storyboard`로 받습니다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장)**: "개인 브랜치에서 작업하고 `dev`로 PR을 올려 리뷰·CI를 거친 뒤 머지하는, 보호 브랜치 기반 협업 전략을 썼습니다."
- **기본**: "6명이 기능별로 수직 분담해서 각자 개인 브랜치를 쓰고, `dev`·`main` 등은 보호 브랜치라 직접 push를 막았습니다. 커밋은 `feat`/`fix`/`docs` 같은 영어 prefix에 한국어 본문 컨벤션을 지켰고, PR마다 GitHub Actions로 typecheck·테스트·docker smoke를 돌려 깨진 코드가 공유 브랜치에 못 들어가게 했습니다."
- **꼬리질문 대응**: "공통 파일(`routes.ts`, `schema.sql`, `build.gradle`)은 팀장 Owner라 변경 전 합의를 받았고, 산출물 문서는 별도 repo를 git 서브모듈로 끼워 본체 용량과 분리했습니다. push 전엔 `fetch`로 `dev`와 겹치는 파일을 먼저 점검해 충돌을 예방했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q. Git Flow나 GitHub Flow랑 뭐가 다른가요?**
정식 Git Flow(develop/release/hotfix 다단계)보다 단순한, GitHub Flow에 가까운 **단일 통합 브랜치(`dev`) + 개인 피처 브랜치** 모델입니다. 6명 규모 단기 프로젝트엔 release 브랜치까지 둘 필요가 없어서, 보호 브랜치 하나에 PR로 모으는 흐름이 오버헤드가 가장 적었습니다.

**Q. Merge와 Rebase 중 뭘 쓰나요? 충돌은 어떻게 푸나요?**
공유 브랜치(`dev`)에 들어갈 땐 PR 머지를 쓰고, 충돌이 나면 `dev`를 내 브랜치로 merge해서 마커(`<<<<<<<`/`=======`/`>>>>>>>`) 구간을 직접 정리한 뒤 다시 push합니다. 이미 push해 남이 받아간 커밋은 rebase로 히스토리를 바꾸지 않습니다.

**Q. 커밋 컨벤션을 강제하면 뭐가 좋나요?**
prefix만 보고 변경 성격(기능/버그/문서)을 즉시 분류할 수 있어 리뷰·릴리스 노트·`git log` 추적이 빨라집니다. 본문 한국어 규칙은 팀 전원이 맥락을 정확히 읽게 하려는 의도입니다.

**Q. 공통 파일 충돌은 어떻게 줄였나요?**
수직 분담으로 각자 자기 폴더만 만지게 하고, `common/`·라우팅·DB 스키마 같은 교차 파일은 Owner(팀장) 승인을 필수로 두어 동시 수정 자체를 줄였습니다. `docs/TEAM_WORK_DISTRIBUTION.md`가 소유권의 단일 출처입니다.

**Q. PR이 머지되기 전 어떤 검증을 통과하나요?**
GitHub Actions 5종이 게이트입니다. 프런트는 `tsc --noEmit` typecheck + 빌드, 백엔드는 `./gradlew test` + Python 워커 unittest + docker smoke가 돌고, 공개 데모 배포 파이프라인은 빌드 결과를 **시크릿 패턴으로 스캔**해 키 유출을 막습니다.

## 8. 직접 말해보기

1. "왜 `dev`에 직접 push를 막고 굳이 PR을 거치게 했는지, 그게 6명 협업에서 어떤 사고를 예방하는지" 30초로 설명해 보세요.
2. "산출물 문서를 본체 repo에 넣지 않고 git 서브모듈로 분리한 이유"를 클론 용량·소유권 관점에서 말해 보세요.

## 퀴즈

<QuizBox question="CareerTuner에서 코드를 dev 브랜치에 반영하는 올바른 절차는?" :choices="['dev에 직접 commit 후 push', '개인 브랜치에서 작업 후 dev로 PR을 올려 리뷰·CI 통과 후 머지', 'main에 push하면 자동으로 dev에 동기화', '각자 fork한 repo에서 메일로 패치 전달']" :answer="1" explanation="dev/main/master/live는 보호 브랜치라 직접 push가 금지됩니다. 개인 브랜치에서 작업하고 dev로 PR을 올려 리뷰와 GitHub Actions CI를 통과한 뒤 머지하는 것이 규칙입니다." />

<QuizBox question="CareerTuner 커밋 컨벤션으로 올바른 것은?" :choices="['prefix와 본문 모두 한국어', 'prefix는 영어(feat/fix/docs 등), 본문은 한국어, AI 도구 표기 금지', 'Co-Authored-By 트레일러로 작성 도구를 명시', 'prefix 없이 자유 형식']" :answer="1" explanation="prefix는 feat/fix/docs/chore/refactor 영어를 유지하고 본문은 한국어로 씁니다. 공개 repo라서 커밋·PR에 AI 도구 흔적(Co-Authored-By, Generated with 등)을 절대 넣지 않습니다." />

<QuizBox question="docs/storyboard 서브모듈에서 새 산출물 버전을 메인 repo에 고정하려면 어떻게 하나요? 동작 원리와 함께 설명하세요." explanation="docs/storyboard는 별도 repo(CareerTunerDocs)를 특정 커밋 SHA로 가리키는 포인터입니다. 따라서 산출물 수정은 그 폴더 안에서 commit·push해 서브모듈 repo를 갱신하고, 메인 repo에는 루트에서 git add docs/storyboard && git commit으로 가리키는 커밋 SHA만 바꿔 PR합니다. 메인을 클론하면 폴더는 빈 포인터 상태라 본체 용량에 영향이 없고, 필요할 때만 git submodule update --init으로 내용을 받습니다." />
