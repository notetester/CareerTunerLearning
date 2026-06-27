# 신고/부적절 게시글 AI 분류 [#33]

> 욕설·광고·개인정보·허위를 AI가 감지·분류하되, 최종 처분은 운영자가 확정한다. "자동 제재가 아니라 운영자 판단 보조"가 이 기능의 헌법이다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

영역 F의 AI 기능 #33은 커뮤니티 글/댓글의 유해성을 LLM으로 판정하고, 그 결과를 **운영자가 신고를 처리할 때 참고하는 분류·우선순위 정보**로 제공한다. 핵심은 같은 판정 두뇌(`judge()`)를 쓰되, 어디에 쓰느냐에 따라 **자동 차단**과 **운영자 참고**라는 두 갈래로 부수효과를 다르게 가져간다는 점이다.

이 페이지로 다음 질문에 답할 수 있어야 한다.

- "AI가 부적절 글을 자동으로 지웠나요?" → 아니다. 자동 검열은 *조건부 숨김(soft-hide)*까지만, 신고 분류는 *참고 결과 저장*만 한다.
- "검열(MODERATION)과 신고 분류(REPORT)는 어떻게 다른가요?" → 두뇌는 같고 task_type과 부수효과가 다르다.
- "AI가 틀리면 어떻게 되나요?" → 운영자가 `takeAction()` / `reclassify()`로 확정·번복한다. DELETED만 불가역이다.

:::tip 한 문장 요약
**"AI는 분류·우선순위를 제안하고, 사람이 처분한다."** 자동 숨김조차 되돌릴 수 있는 soft-hide이고, 신고 처리의 최종 결정권은 항상 운영자에게 있다.
:::

## 2. 왜 이렇게 설계했나 (의도와 트레이드오프)

영역 F의 최우선 설계 원칙은 "AI는 운영자 보조, 자동 처분 아님"이다. 신고/부적절 분류는 운영자 판단을 돕는 **제안**이며 자동 제재로 끝내지 않는다. 이 원칙이 코드에 어떻게 박혔는지가 면접의 핵심이다.

| 결정 | 왜 | 트레이드오프 |
| --- | --- | --- |
| 검열은 *조건부* 숨김, 신고는 *저장만* | 신고는 사용자 주관이 섞여 자동 처분 위험이 큼 → 운영자 확정 필수 | 신고 글은 운영자가 볼 때까지 그대로 노출됨(의도된 보수성) |
| 같은 `judge()`를 task_type으로 분기 | 판정 로직 중복 제거, 한쪽 개선이 양쪽에 반영 | 부수효과 분기를 호출부에서 신경 써야 함 |
| 숨김은 `status` flip (soft-hide), DELETE 아님 | 오탐 복원 가능해야 함 (`restoreCommentIfHidden`) | 원문은 DB에 남아 저장공간·집계 로직 추가 필요 |
| `DELETED`만 불가역 종착 상태 | 감사 일관성·멱등성 — 한 번 지운 글의 상태를 더 흔들지 않음 | 운영자가 실수로 DELETE하면 되돌릴 수 없음(가드로 명시) |
| 자동 제재 임계와 숨김 임계를 분리 | 단위가 다름: 숨김은 *신뢰도*(0~1), 제재는 *누적 횟수* | 두 임계를 따로 운영·튜닝해야 함 |
| 자동 제재는 best-effort (예외 삼킴) | 제재 실패가 검열 결과를 깨면 안 됨 | 제재가 조용히 누락될 수 있음(로그로만 추적) |

핵심 트레이드오프는 "오탐(false positive)을 사용자가 영구히 떠안지 않게 한다"는 쪽으로 일관되게 기울어 있다. 자동 숨김도 복원 가능하고, DELETE만 운영자 손을 거친 불가역 처분이다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

판정 두뇌는 `community/moderation/service/PostModerationService`에 있다. 이 클래스 하나가 검열·신고분류·태깅·면접추출을 모두 담당하되, 메서드가 갈라진다.

| 메서드 | task_type | 부수효과 | 누가 호출 |
| --- | --- | --- | --- |
| `judge(title, content)` | (없음, 순수 판정) | DB 접근 없음, LLM 호출만 | 아래 세 메서드 + 테스트 |
| `moderate(postId)` | `MODERATION` | 조건부 숨김 + 알림 + 자동 제재 | 글 생성 이벤트(비동기) |
| `moderateComment(commentId)` | `MODERATION` | 댓글 soft-hide + count 조정 | 댓글 생성 이벤트(비동기) |
| `classify(postId)` | `REPORT` | **결과 저장만, 자동 조치 없음** | 신고 접수 이벤트 / 운영자 재검토 |

판정 스키마는 `MODERATION_SCHEMA`로, LLM이 반드시 이 모양의 JSON만 뱉도록 강제한다(structured output, `format=schema`).

```json
{ "toxic": true, "category": "abuse", "confidence": 0.95 }
```

`category`는 enum이다 — `normal` / `abuse`(욕설·인신공격·혐오·성희롱) / `spam`(도배·반복) / `ad`(상업 광고·도박·대출·불법거래 유인). 프롬프트(`prompts/moderation-system.txt`)의 핵심 규칙은 **"대상이 있느냐"**로 욕설을 가른다.

- "와 존나 어렵네 이 코테" → 대상 없는 강조 → `normal`
- "야 이 미친놈아 글 내려" → 특정인 향한 욕설 → `abuse`

이 한 줄이 취업 커뮤니티 특유의 "감탄사 비속어"를 오탐하지 않게 막는 장치다. 또 스터디 모집·강의 후기 같은 정보성 글을 `ad`로 잘못 잡지 않도록 "영리 목적 반복 홍보만 ad"라고 못 박는다.

엄격도는 런타임에 바뀐다. `buildSystemPrompt()`가 기본 프롬프트 뒤에 `prompts/strictness/{STRICT,NORMAL,LENIENT}.txt`를 동적으로 붙여 조립한다. 엄격도·임계값은 `ai_moderation_setting` 단일 행(SETTING_ID=1)에서 오고, `ModerationSettingService`가 volatile 필드로 캐싱한다.

**소유 테이블**

| 테이블 | 역할 |
| --- | --- |
| `post_report` / `comment_report` | 신고 원장 — `ai_label`, `ai_confidence`, `admin_id`, `resolved_at`, `status`(PENDING/CONFIRMED/DISMISSED) |
| `post_ai_result` | AI 판정 결과 — **UNIQUE(post_id, task_type)**, `attempt_count`, 상태(PENDING/COMPLETED/FAILED). **감사 전용** |
| `comment_ai_result` | 댓글 검열 결과 — **조회 경로와 절대 조인 안 함**(감사·배치 전용) |
| `ai_moderation_setting` | 단일 행 설정 — `strictness`, `hide_threshold`(0.50~0.95, 기본 0.80), `sanction_threshold`(기본 3), `block_days`(기본 7) |

:::warning 결과 테이블은 노출 경로와 분리된다
`post_ai_result` / `comment_ai_result`는 운영자 콘솔과 backfill만 읽는다. 사용자가 글을 조회하는 SQL은 이 테이블과 조인하지 않는다 — AI 판정이 일반 사용자에게 새어 나가지 않게 하는 경계다.
:::

## 4. 동작 원리 (두 경로 흐름)

### 경로 A — 생성 시점 자동 검열 (즉시 차단까지)

글/댓글이 만들어지면 트랜잭션 커밋 후 비동기로 검열이 돈다. LLM 호출(최대 30초)을 트랜잭션과 사용자 응답에서 떼어내기 위한 구조다.

```text
createPost (트랜잭션)
   └─ commit ──▶ PostModerationRequiredEvent
                   @TransactionalEventListener(AFTER_COMMIT) + @Async("moderationExecutor")
                       └─ moderate(postId)
                            1. upsertPending(MODERATION)
                            2. 글 조회 (DELETED면 skip)
                            3. 설정 스냅샷 (strictness, hideThreshold)
                            4. judge() → LLM 판정
                            5. complete(): 결과 + 스냅샷 저장
                            6. toxic && confidence >= hideThreshold(0.80)
                                 └─ hideIfPublished() (PUBLISHED→HIDDEN 조건부 flip)
                                      ├─ 작성자 알림 (link=/community?view=guidelines)
                                      └─ sanctionIfNeeded() (best-effort, 예외 삼킴)
```

이 코드에서 면접관이 좋아할 디테일.

- **`@Transactional` 금지**: 30초 LLM 호출을 트랜잭션에 묶으면 DB 커넥션을 장기 점유해 풀이 고갈된다. DB write는 `complete()` 같은 매퍼 호출 단위로만 짧게 한다.
- **조건부 flip**: `hideIfPublished()`는 PUBLISHED일 때만 HIDDEN으로 바꾸고 영향 행이 1일 때만 후속 동작(알림·count 감소)을 한다. 운영자 조치와 AI 검열이 경합해도 이중 처리되지 않는다.
- **예외를 다시 던지지 않음**: 검열 실패는 `fail()`로 기록만 하고 삼킨다. 비동기 스레드라 던져봐야 받을 사람이 없고, 사용자 흐름은 이미 끝났다.

### 경로 B — 사용자 신고 → AI 분류 → 운영자 확정

신고는 더 보수적이다. **자동 숨김도 알림도 없이** 판정 결과만 저장한다.

```text
ReportServiceImpl.createReport()  ── POST 신고만 ──▶ ReportClassifyRequiredEvent
   · 본인 글 신고 차단 / 중복 신고 차단 (CONFLICT)            (댓글 신고는 이벤트 미발행)
       └─ classify(postId)
            · upsertPending(REPORT) → judge() → complete(REPORT)
            · 자동 숨김 X, 알림 X — "관리자 참고용" 결과만 저장

[운영자 콘솔]  AdminReportServiceImpl
   · getReportDetail()  : 신고 상세 + AI 소견(buildAiOpinion)
        → toxic / category / confidence / model / elapsedMs
   · takeAction()       : HIDDEN | DELETED | DISMISSED 확정
        → DELETED는 종착·불가역 (guardPostNotDeleted)
   · reclassify()       : AI 재검토 (동기 호출, Propagation.NOT_SUPPORTED)
        → 댓글 신고는 미지원
```

운영자가 보는 "AI 소견"은 `buildAiOpinion()`이 `post_ai_result`의 `resultJson`을 파싱해 만든다. 여기에 `elapsedMs`(생성~완료 시각 차)까지 넣어 판정에 얼마나 걸렸는지도 보여준다. ID 규약도 있다 — `id >= 1_000_000`이면 댓글 신고로 해석하고 `targetId = id - 1_000_000`으로 환산한다.

`reclassify()`가 `@Transactional(propagation = Propagation.NOT_SUPPORTED)`인 이유가 중요하다. 운영자가 "AI 다시 돌려보기"를 누르면 긴 LLM 호출이 동기로 일어나는데, 이걸 트랜잭션 밖으로 빼내 커넥션을 잡고 있지 않게 한다.

### 누적 자동 제재 — 신뢰도가 아니라 횟수

`UserSanctionService.sanctionIfNeeded()`는 글이 숨겨질 때마다 호출된다.

```text
countHiddenByUser(userId) >= sanctionThreshold(기본 3)
   AND user.status == ACTIVE
        └─ updateStatus(BLOCKED, blockDays=7, actor=null)   ← 시스템 변경
           insertStatusHistory(...)
           revokeAllForUser(userId)                          ← 세션 해지
           notify("ACCOUNT_BLOCKED")
```

여기서 두 가지가 포인트다. 첫째, 위반 카운트는 `community_post.status='HIDDEN'` 집계라서 users 테이블을 더럽히지 않는다. 둘째, 이미 BLOCKED/DORMANT/DELETED인 사용자는 건너뛴다 — 운영자의 수동 조치를 시스템이 덮어쓰지 않게 하는 보호다. `blockedUntil`은 KST 벽시계(`Asia/Seoul`)로 저장해 DB의 `NOW()`와 시간원을 맞춘다(JVM 타임존이 UTC여도 어긋나지 않게).

:::details 유실분 회수 — ModerationRetryScheduler
`moderationExecutor`(core/max=2, queue=100)의 큐가 포화되면 RejectedExecutionHandler가 작업을 **폐기하고 로그만 남긴다**. "글은 저장됐는데 사용자에게 500이 뜨는" 사고를 막기 위한 선택이다. 대신 폐기된 글은 검열되지 않은 채 남는다.

이걸 `ModerationRetryScheduler`(initialDelay 90초, fixedDelay 5분)가 회수한다. backfill이 쓰는 "COMPLETED 결과가 없는(NOT EXISTS) 대상" 조회를 그대로 재사용해 검열·태깅·면접추출 유실분을 유형별 최대 20건씩 다시 처리한다. `AtomicBoolean`으로 직전 실행과 겹침을 막고, 스케줄러 스레드가 `PostModerationService`를 **직접 동기 호출**해 프록시 self-invocation 문제를 피한다.
:::

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

| 항목 | 상태 | 설명 |
| --- | --- | --- |
| 게시글/댓글 자동 검열 | 구현됨 | 생성 시점 비동기, toxic+confidence≥0.80 조건부 soft-hide |
| 사용자 신고 → AI 분류 | 구현됨 | `classify()`로 판정만 저장, 자동 조치 없음 |
| 운영자 확정 콘솔 | 구현됨 | `getReportDetail`/`takeAction`/`reclassify`, DELETED 불가역 가드 |
| 런타임 엄격도(STRICT/NORMAL/LENIENT) | 구현됨 | 프롬프트 동적 조립 + 설정 캐싱 |
| 누적 자동 제재 | 구현됨 | 횟수 임계(기본 3) → BLOCKED, A 도메인 인프라 재사용 |
| 유실분 재처리 스케줄러 | 구현됨 | NOT EXISTS 회수, 5분 주기 |
| 신고 입력 UI(ReportDialog) | 구현됨 | 5사유, "기타"는 5자 필수, 익명 처리 명시 |
| **댓글 신고 → AI 분류** | **부분/미지원** | 댓글 신고는 `ReportClassifyRequiredEvent`를 발행하지 않음. 운영자 콘솔의 `reclassify()`도 댓글은 명시적으로 거부 |
| AI 우선순위 자동 정렬 | 부분 | confidence는 소견으로 노출되나, 신고 목록 자동 정렬·우선순위 큐 별도 미구현 |

:::warning 정직하게: "분류·우선순위"의 실제 경계
프롬프트는 글을 `abuse`/`spam`/`ad`/`normal`로 **분류**하고 `confidence`를 매긴다 — 운영자가 어느 신고를 먼저 볼지 판단할 *재료*는 제공한다. 다만 "신뢰도 높은 신고를 큐 맨 위로 올리는" 자동 우선순위 정렬 자체는 별도 기능으로 코드에 없다. 면접에서 "AI가 우선순위를 매긴다"고 단정하지 말고 "분류·신뢰도로 운영자의 우선순위 판단을 보조한다"로 말하는 게 정확하다. 또 **댓글 신고는 AI 분류 경로가 연결돼 있지 않다**는 점을 빠뜨리지 말 것.
:::

## 6. 면접 답변 3단계

1. **무엇** — "커뮤니티 글·댓글을 로컬 LLM(gemma4)으로 욕설/광고/스팸/정상 4분류하고 신뢰도를 매깁니다. 핵심 원칙은 자동 처분이 아니라 운영자 판단 보조라서, 신고 경로는 판정 결과를 저장만 하고 최종 처분은 운영자가 합니다."
2. **어떻게** — "판정 두뇌(`judge()`)는 하나로 두고, task_type(MODERATION/REPORT)으로 부수효과를 가릅니다. 자동 검열은 신뢰도 0.80 이상일 때 *되돌릴 수 있는* 조건부 숨김까지, 신고 분류는 `post_ai_result`에 참고용 결과만 저장합니다. LLM 호출이 30초까지 걸려서 트랜잭션·사용자 응답과 분리하려고 `AFTER_COMMIT` 비동기 + 전용 풀로 돌립니다."
3. **왜 좋은가** — "오탐이 사용자에게 영구 피해를 주지 않게 모든 자동 조치를 복원 가능하게 만들었고, DELETE만 운영자 손을 거친 불가역 처분으로 두었습니다. 큐가 막혀 폐기된 글도 NOT EXISTS 스케줄러가 회수해 검열 누락을 막습니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 검열(MODERATION)과 신고 분류(REPORT)의 차이를 코드 수준에서 설명하세요.
같은 `judge(title, content)`를 쓰지만 호출 메서드가 다릅니다. `moderate()`는 task_type을 MODERATION으로 기록하고, toxic이면서 confidence가 hide_threshold(기본 0.80) 이상이면 `hideIfPublished()`로 조건부 숨김 + 알림 + 누적 제재까지 갑니다. `classify()`는 task_type을 REPORT로 기록하고 **숨김도 알림도 없이** 결과만 저장합니다. 즉 "두뇌는 공유, 부수효과만 분기"이고, 이게 '신고는 운영자 확정' 원칙의 코드 구현입니다.
:::

::: details Q2. AI가 멀쩡한 글을 toxic으로 잘못 판정해 숨기면 어떻게 되나요?
숨김은 DELETE가 아니라 `status` PUBLISHED→HIDDEN의 soft-hide라 복원 가능합니다. 운영자가 `takeAction`의 DISMISSED나 댓글의 RESTORE로 되돌리고, 이때 `restoreCommentIfHidden()`가 경계를 통과할 때만 comment_count를 +1 해 이중 보정도 막습니다. 그리고 오탐을 줄이려고 프롬프트가 "대상이 있는 욕설만 abuse"라고 규정해 감탄사 비속어를 normal로 보냅니다. 진짜 불가역인 건 DELETED뿐이고, 이건 운영자만 누를 수 있습니다.
:::

::: details Q3. 자동 제재 임계와 숨김 임계가 따로 있는 이유는?
단위가 다르기 때문입니다. `hide_threshold`는 글 한 건의 *판정 신뢰도*(0.50~0.95, DECIMAL)이고, `sanction_threshold`는 한 사용자의 *누적 숨김 글 횟수*(기본 3)입니다. 신뢰도로 글을 숨기는 것과 횟수로 사용자를 차단하는 건 의미가 다른 결정이라 임계를 분리했습니다. 위반 카운트는 `community_post.status='HIDDEN'` 집계라 users 테이블을 건드리지 않습니다.
:::

::: details Q4. `reclassify()`에 왜 `Propagation.NOT_SUPPORTED`를 걸었나요?
운영자가 "AI 재검토"를 누르면 LLM 호출이 동기로 일어납니다. 이게 30초까지 걸릴 수 있는데, 트랜잭션 안에서 돌면 그동안 DB 커넥션을 잡고 있어 풀을 갉아먹습니다. `NOT_SUPPORTED`로 기존 트랜잭션을 정지시켜 LLM 호출 구간을 트랜잭션 밖으로 빼냈습니다. 비동기 검열에서 service에 `@Transactional`을 안 거는 것과 같은 동기입니다.
:::

::: details Q5. 자동 제재가 실패하면 검열 결과는 어떻게 되나요?
영향 없습니다. `moderate()` 안에서 `sanctionIfNeeded()` 호출을 try/catch로 감싸 예외를 삼키고 로그만 남깁니다(best-effort). 제재는 검열의 부수효과일 뿐이라, 제재가 깨졌다고 이미 끝난 검열·숨김 결과를 되돌리면 안 되기 때문입니다. 알림 발송·푸시·로그 같은 다른 부수효과도 같은 정책으로 본 흐름을 깨지 않습니다.
:::

::: details Q6. 댓글 신고도 게시글 신고와 똑같이 AI 분류가 되나요?
아니요, 여기엔 갭이 있습니다. `ReportServiceImpl`은 게시글 신고에서만 `ReportClassifyRequiredEvent`를 발행하고 댓글 신고에서는 발행하지 않습니다. 운영자 콘솔의 `reclassify()`도 댓글 신고는 명시적으로 INVALID_INPUT을 던져 거부합니다. 댓글은 *생성 시점 자동 검열*(`moderateComment`)은 받지만, *사용자 신고 기반 AI 분류*는 연결돼 있지 않습니다. 면접에선 이 구분을 정직하게 말하는 게 좋습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 1~2분으로 설명해 보자.

- 글 하나가 작성되고 나서 검열되어 숨겨지기까지, 트랜잭션·이벤트·비동기 풀·LLM 호출이 어떤 순서로 일어나는지.
- "AI는 자동 처분 안 한다"는 원칙이 `classify()` / `takeAction()` / soft-hide 세 군데에서 각각 어떻게 드러나는지.
- `hide_threshold`(신뢰도)와 `sanction_threshold`(횟수)가 왜 다른 차원인지, 각각 무엇을 결정하는지.
- 큐가 포화돼 검열이 폐기됐을 때 어떻게 회수되는지(스케줄러 + NOT EXISTS).

## 퀴즈

<QuizBox question="사용자 신고로 classify()가 실행될 때 일어나는 일은?" :choices="['toxic이면 즉시 글을 숨긴다', '판정 결과만 post_ai_result에 저장하고 자동 조치는 하지 않는다', '작성자를 곧바로 BLOCKED 처리한다', '게시글을 DELETED로 만든다']" :answer="1" explanation="classify()(task_type=REPORT)는 운영자 참고용으로 판정 결과만 저장합니다. 자동 숨김·알림·제재는 검열(moderate, MODERATION) 경로의 동작이고, 신고 분류는 운영자가 takeAction으로 확정합니다." />

<QuizBox question="hide_threshold(기본 0.80)와 sanction_threshold(기본 3)의 차이로 옳은 것은?" :choices="['둘 다 신뢰도 값이다', 'hide_threshold는 글 판정 신뢰도, sanction_threshold는 사용자 누적 숨김 횟수다', 'hide_threshold는 횟수, sanction_threshold는 신뢰도다', '둘은 동일한 값을 공유한다']" :answer="1" explanation="hide_threshold는 글 한 건의 판정 신뢰도(0.50~0.95)이고, sanction_threshold는 한 사용자의 누적 숨김 글 횟수(기본 3)입니다. 차원이 다르므로 임계를 분리해 운영합니다." />

<QuizBox question="검열(moderate)에서 AI가 글을 toxic으로 판정해 숨길 때 사용하는 방식은?" :choices="['community_post 행을 DELETE 한다', 'status를 PUBLISHED→HIDDEN으로 조건부 flip 하는 soft-hide다', 'AI가 즉시 DELETED 상태로 만든다', '글을 다른 테이블로 이동시킨다']" :answer="1" explanation="hideIfPublished()는 PUBLISHED일 때만 HIDDEN으로 바꾸는 조건부 soft-hide입니다. 오탐 복원이 가능하고, DELETED만 운영자가 누르는 불가역 종착 상태입니다." />
