# 커뮤니티 데이터 모델

> 커뮤니티는 "게시글 1개 + 위성 테이블 여러 개"로 분해된다. 카운트는 비정규화로 캐시하고, 익명은 행에 박힌 `is_anonymous` 플래그로, 신고는 `PENDING→CONFIRMED/DISMISSED` 상태머신으로 운영자가 확정한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 F의 커뮤니티는 `community_post`를 중심으로 댓글(`community_comment`), 반응(`post_reaction`/`comment_reaction`), 신고(`post_report`/`comment_report`), 태그(`community_tag`/`community_post_tag`), 면접후기 메타(`community_interview_review`), AI 결과(`post_ai_result`)가 위성처럼 붙는 구조다.

이 페이지가 답하는 면접 질문:

- "게시판 글/댓글/좋아요/신고를 테이블로 어떻게 나눴고, 왜 그렇게 나눴나?"
- "좋아요 수 같은 카운트는 매번 `COUNT(*)`로 세나, 컬럼에 들고 있나? 동시성은?"
- "익명 게시판이라는데 작성자를 모르면 본인 글 수정·신고 중복 방지는 어떻게 하나?"
- "신고가 들어오면 글이 바로 사라지나? 운영자 확정은 데이터로 어떻게 모델링했나?"

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

핵심 설계 원칙은 영역 F 전체를 관통하는 **"AI는 운영자 보조, 자동 처분 아님"** 과 **운영 일관성 불변식**이다. 데이터 모델은 이 두 원칙을 스키마 레벨에서 강제하도록 짜였다.

| 결정 | 의도 | 트레이드오프 |
| --- | --- | --- |
| 게시글 본문과 위성 데이터(댓글/반응/신고/태그) 테이블 분리 | 각자 다른 쓰기 빈도·수명·접근 패턴. 반응 토글이 글 row를 잠그지 않음 | 조인/집계 쿼리 증가 |
| 카운트(`comment_count`/`like_count`/`bookmark_count`)를 글 row에 비정규화 | 목록 화면에서 `COUNT(*)` N+1 회피, 정렬 인덱스(`like_count DESC`) 활용 | 원본(`post_reaction`)과 카운트 동기화 책임을 코드가 짊어짐 |
| `is_anonymous` 를 **행마다** 플래그로 | 글/댓글 단위로 익명 여부 선택. `user_id`는 항상 보존(소유권·신고·집계용) | 표시 계층에서 닉네임을 가릴 책임이 서비스에 있음 |
| 면접후기를 `community_interview_review` 별도 테이블(1:1)로 | `INTERVIEW_REVIEW` 카테고리만 갖는 회사·직무·난이도·AI 추출질문 컬럼이 일반 글을 오염시키지 않음 | 면접후기 조회 시 `LEFT JOIN` 필요 |
| 신고에 `status` + `action_taken` 두 컬럼 | "처리 단계"(상태머신)와 "어떤 조치"(결과)를 분리. 운영자 감사 추적 | 컬럼 2개를 항상 함께 갱신해야 일관 |
| `DELETED`를 종착·불가역으로 | 삭제 후 복원/재처리로 인한 이중 카운트·감사 혼선 차단 | 오삭제 복구는 DB 직접 수정 필요 |

:::tip 면접 포인트
"왜 좋아요를 컬럼에 캐시하면서도 `post_reaction` 원본 테이블을 따로 두나?" → 원본은 **"누가" 눌렀나(중복·토글·본인글 차단)**, 캐시는 **"몇 개"(목록·정렬)** 를 책임진다. 둘의 일관성은 `affected-rows>0`일 때만 카운트를 ±1 하는 코드가 보증한다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

스택은 MyBatis + MySQL 8 (JPA 금지), 4계층 `controller → service → mapper → domain`. 핵심 enum과 서비스:

- 카테고리: `community/domain/PostCategory.java` — 7종(`JOB_REVIEW`/`INTERVIEW_REVIEW`/`JOB_QUESTION`/`SUCCESS_STRATEGY`/`PORTFOLIO_FEEDBACK`/`CERTIFICATE_REVIEW`/`FREE`), 각 enum이 한글 `label`("취업후기"/"면접후기"…) 보유.
- 상태: `PostStatus`(`PUBLISHED`/`HIDDEN`/`DELETED`/`PENDING`), `CommentStatus`(`PUBLISHED`/`HIDDEN`/`DELETED`).
- 반응: `ReactionType`(`LIKE`/`BOOKMARK`), 토글 로직 `community/service/ReactionServiceImpl.java`.
- 신고: 접수 `community/service/ReportServiceImpl.java`, 운영자 확정 `admin/community/service/AdminReportServiceImpl.java`, 사유 enum `ReportReason`(`SPAM`/`ABUSE`/`FALSE_INFO`/`PRIVACY`/`OTHER`).

DDL은 `backend/src/main/resources/db/schema.sql`(`community_post`은 :1104 등)에 있고, 일부 컬럼은 패치로만 추가됐다(아래 §5).

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 테이블 관계 한눈에

```text
users ──1:N── community_post ──1:N── community_comment (parent_id: 자기참조 트리)
                  │                        │
                  ├─1:N─ post_reaction     ├─1:N─ comment_reaction   (UNIQUE 토글)
                  ├─1:N─ post_report       ├─1:N─ comment_report     (신고 상태머신)
                  ├─1:N─ community_post_tag ─N:1─ community_tag       (is_ai 구분)
                  ├─1:1─ community_interview_review                   (면접후기 메타)
                  └─1:N─ post_ai_result    (UNIQUE(post_id, task_type), 감사 전용)
```

모든 위성 테이블의 FK는 글/댓글이 사라지면 `ON DELETE CASCADE`로 함께 정리된다. 단 **신고·운영자 컬럼은 `ON DELETE SET NULL`** — `post_report.reporter_id`와 `admin_id`는 유저가 탈퇴해도 신고 기록 자체는 남기되 누구인지만 끊는다(감사 추적 보존).

### 4-2. 게시글 핵심 컬럼

| 컬럼 | 의미 | 비고 |
| --- | --- | --- |
| `category` | 7종 enum 문자열 | 인덱스 `(category, status, created_at DESC)` |
| `status` | PUBLISHED/HIDDEN/DELETED/PENDING | soft-delete·검열 숨김 |
| `is_anonymous` | 익명 플래그, **기본 1** | `user_id`는 항상 채워짐 |
| `tags_json` | 태그 캐시 | 원본은 `community_post_tag` |
| `comment_count`/`like_count`/`bookmark_count` | 비정규화 카운트 | 원본 토글 시 코드가 ±1 |
| `interview_type`/`difficulty` | 면접후기 보조 | 상세 메타는 1:1 테이블 |

### 4-3. 익명(anonymity) 모델

익명 게시판이지만 `user_id`는 **절대 비우지 않는다.** `is_anonymous`는 "표시할 때 닉네임을 가릴지"만 결정하는 **표현 계층 플래그**다. 덕분에 익명이어도:

- 본인 글 판정: `community/domain/CommunityPost`의 `user_id`로 소유자만 수정/삭제(`PostDetailView`가 소유자에게만 버튼 노출).
- 신고 가드: `ReportServiceImpl.reportPost()`가 `post.getUserId().equals(userId)`로 **본인 글 신고 차단**, `findPostReport(userId, postId)`로 **중복 신고 차단**.
- 본인 글 좋아요 차단: `ReactionServiceImpl`가 `userId.equals(post.getUserId())`면 self-like 거부(북마크는 허용).

즉 "익명"은 화면에서의 가림이고, DB는 늘 실제 작성자를 안다. 신고 자체도 사용자에게 **"신고는 익명으로 처리됩니다"** 라고 고지하지만(`ReportDialog.tsx`), 내부적으로 `reporter_id`는 기록되어 중복·허위신고를 막는다.

### 4-4. 반응(좋아요/북마크) — UNIQUE 토글 + 카운트 대칭

`post_reaction`은 `UNIQUE(user_id, post_id, reaction_type)`로 "한 사람이 같은 반응을 두 번" 자체를 DB가 막는다. 토글은 존재 여부로 분기:

```java
// ReactionServiceImpl.togglePostReaction (요약)
if (existing != null) {                 // 이미 눌렀음 → 취소
    deletePostReaction(...);
    decrementLikeCount / decrementBookmarkCount;
    return false;
}
try { insertPostReaction(...); }
catch (DuplicateKeyException e) {        // 동시 토글 충돌
    return true;                         // 카운트 재증가 없이 흡수
}
increment...Count;                       // 신규일 때만 +1
```

핵심은 **동시 토글 경합 방어**다. 두 트랜잭션이 동시에 insert를 시도하면 하나는 `DuplicateKeyException`을 받는데, 이때 카운트를 **다시 올리지 않고** 그냥 흡수한다. UNIQUE 제약이 "한 번만 카운트"를 보증하는 안전망이다. 댓글은 `LIKE`만 허용(`BOOKMARK`는 거부).

### 4-5. 신고 상태머신 (★ 이 페이지의 하이라이트)

신고는 두 컬럼으로 모델링된다: `status`(처리 단계) + `action_taken`(확정 조치). 사용자가 신고하면 `PENDING`으로 들어오고, **AI는 자동으로 글을 내리지 않는다.** 게시글 신고는 `ReportClassifyRequiredEvent`를 발행해 AI가 `post_ai_result(task_type=REPORT)`에 **"관리자 참고용" 소견만** 저장하고 끝난다(자동 숨김·알림 없음). 실제 처분은 운영자가 `AdminReportServiceImpl.takeAction()`으로 확정한다.

```text
            ┌─────────────────────────── PENDING (접수, AI 소견만 첨부) ───┐
            │                                                              │
   takeAction(DISMISSED)                                         takeAction(HIDDEN | DELETED)
            │                                                              │
            ▼                                                              ▼
  status=DISMISSED                                            status=CONFIRMED
  action_taken=NONE                                  action_taken=HIDDEN | DELETED
  (글 상태 변화 없음)                                    글 status도 HIDDEN/DELETED로 flip
                                                                           │
                                                              DELETED = 종착·불가역
                                                       (guardPostNotDeleted가 역행 차단)
```

| 운영자 액션 | 신고 `status` | 신고 `action_taken` | 글 처리 | 가드 |
| --- | --- | --- | --- | --- |
| `HIDDEN` | CONFIRMED | HIDDEN | 글 `status=HIDDEN` | `guardPostNotDeleted` |
| `DELETED` | CONFIRMED | DELETED | 글 `status=DELETED` | 종착·불가역, 재처리 거부 |
| `DISMISSED` | DISMISSED | NONE | 글 변화 없음 (오탐 기각) | — |
| `RESTORE`(댓글) | DISMISSED | NONE | 댓글 HIDDEN→PUBLISHED + count+1 | 댓글 신고만 |

확정 시 추가로 갱신되는 신고 컬럼: `admin_id`(처리자), `resolved_at`(처리 시각), 그리고 AI 소견은 `ai_label`/`ai_confidence`로 들고 있다. **`DELETED`는 불가역** — `guardPostNotDeleted()`가 사전 status 조회로 `DELETED→HIDDEN` 역행이나 이미 삭제된 글의 재처리를 `CONFLICT`로 거부하고, mapper의 `status <> 'DELETED'` 조건이 동시성 경합을 2차 방어한다.

ID 규약 한 가지: `AdminReportServiceImpl`는 **`id >= 1_000_000`이면 댓글 신고**로 해석한다(게시글/댓글 신고를 한 엔드포인트에서 다루는 오프셋 트릭). 댓글 신고는 AI 재분류(`reclassify`)를 지원하지 않는다.

### 4-6. 댓글 트리 + tombstone

`community_comment.parent_id`가 자기 자신을 참조하는 트리. 삭제해도 자식 댓글의 맥락을 위해 행을 물리 삭제하지 않고 `status=DELETED`로 두는 **tombstone(묘비)** 방식(프론트 `CommentItem`이 placeholder로 렌더). `comment_count`는 PUBLISHED 경계를 통과할 때(`affected-rows>0`)만 ±1 해서 검열·운영자 조치가 동시에 일어나도 이중 감소가 없다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 메모 |
| --- | --- | --- |
| post/comment/reaction/report 본체 테이블 + FK | ✅ 구현됨 | schema.sql + 패치 |
| 카테고리 7종 enum + 라벨 | ✅ 구현됨 | `PostCategory` |
| 익명 플래그 + 본인글/중복신고 가드 | ✅ 구현됨 | `is_anonymous`, `ReportServiceImpl` |
| 반응 UNIQUE 토글 + 카운트 대칭 | ✅ 구현됨 | `ReactionServiceImpl` |
| 신고 상태머신(PENDING→CONFIRMED/DISMISSED) + DELETED 불가역 | ✅ 구현됨 | `AdminReportServiceImpl.takeAction` |
| 댓글 신고 접수 | ✅ 구현됨 | 단 **AI 분류 이벤트는 게시글 신고만 발행** |
| `community_interview_review.ai_summary_json` | ⚠️ 미사용(선언만) | #29 전용 요약 파이프라인 미구현(컬럼·enum만) |
| `bookmark_count` 등 일부 컬럼 | ⚠️ 패치로만 존재 | `20260612_f_community_post_columns.sql`, **공유 DB "(미적용)" 표기** |
| `community_post_embedding` | ◐ 별도 테이블 | #32 의미검색용, schema.sql 미반영(패치) |

:::warning 정직 구분
스키마는 **schema.sql과 패치(patches/)가 따로 관리**된다. `status`/`tags_json`/카운트 3종 등은 패치로 추가됐고 모든 F 패치 헤더에 "(미적용) 운영 공유 DB 적용 후 날짜 기록"으로 적혀 있어 **공유 DB 반영은 불확실**하다. 면접에서 "스키마가 완성됐냐" 물으면 "로컬/개인 DB는 패치 적용, 공유 DB는 합의 후 적용 대기"가 정확한 답이다.
:::

## 6. 면접 답변 3단계

1. **한 문장:** "커뮤니티는 `community_post`를 중심으로 댓글·반응·신고·태그·면접후기 메타가 1:N/1:1 위성 테이블로 붙는 구조이고, 카운트는 비정규화 캐시, 익명은 행 플래그, 신고는 운영자 확정 상태머신으로 모델링했습니다."
2. **왜:** "반응 토글이 글 row를 잠그지 않게 테이블을 쪼갰고, 목록 성능을 위해 카운트를 캐시하되 원본 테이블의 UNIQUE 제약으로 이중 카운트를 막았습니다. AI는 신고를 자동 처분하지 않고 소견만 남기고 운영자가 확정합니다."
3. **결과/불변식:** "`DELETED`는 불가역 종착 상태로 가드해 역행·이중 카운트를 차단하고, 익명이어도 `user_id`는 보존해 소유권·중복신고 방지가 동작합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 익명 게시판인데 본인 글 수정이나 중복 신고 방지는 어떻게?
`is_anonymous`는 표시 계층 플래그일 뿐이고 `user_id`는 항상 채워집니다. 수정/삭제는 `post.user_id == 현재유저`로 소유자만 허용하고, 신고는 `ReportServiceImpl`이 본인 글이면 거부, `findPostReport(userId, postId)`가 있으면 중복으로 거부합니다. `post_report`엔 `UNIQUE(reporter_id, post_id)`도 걸려 DB 차원에서도 중복을 막습니다.
:::

:::details Q2. 좋아요 수를 컬럼에 캐시하면 원본과 어긋날 위험이 있지 않나?
그래서 두 가지로 막습니다. 첫째, `post_reaction`에 `UNIQUE(user_id, post_id, reaction_type)`를 걸어 "한 번만 카운트"를 보증합니다. 둘째, 토글 코드가 insert 성공(또는 delete) 시에만 카운트를 ±1 하고, 동시 토글로 `DuplicateKeyException`이 나면 카운트를 재증가하지 않고 흡수합니다. 댓글 카운트도 PUBLISHED 경계를 넘을 때(affected-rows>0)만 조정해 검열·운영자 조치 경합에서 이중 감소가 없습니다.
:::

:::details Q3. 신고가 들어오면 글이 바로 내려가나?
아니요. 사용자 신고는 `PENDING`으로 접수되고 AI는 `post_ai_result(task_type=REPORT)`에 참고 소견만 저장합니다(자동 숨김 없음). 이건 생성 시점 **자동 검열**(toxic+confidence≥0.80이면 즉시 soft-hide)과는 다른 경로입니다. 신고로 인한 실제 숨김/삭제는 운영자가 `takeAction()`으로 `CONFIRMED + HIDDEN/DELETED`를 확정해야 일어납니다. "AI는 보조, 처분은 운영자" 원칙의 코드 구현입니다.
:::

:::details Q4. status와 action_taken을 왜 둘 다 두나? 하나면 안 되나?
`status`는 신고의 **처리 단계**(PENDING/CONFIRMED/DISMISSED), `action_taken`은 **어떤 조치를 했나**(HIDDEN/DELETED/NONE)를 나타냅니다. 분리하면 "확정했지만 숨김인지 삭제인지", "기각이라 조치 없음"을 감사 로그로 명확히 남길 수 있습니다. 거기에 `admin_id`·`resolved_at`까지 기록해 누가 언제 무엇을 했는지 추적됩니다.
:::

:::details Q5. DELETED를 불가역으로 만든 이유는?
복원/재처리를 허용하면 글 상태가 왔다 갔다 하면서 카운트·신고 감사 일관성이 깨지기 쉽습니다. 그래서 `guardPostNotDeleted()`가 `DELETED→HIDDEN` 역행과 삭제된 글의 재처리를 `CONFLICT`로 거부하고, mapper의 `status <> 'DELETED'` 조건이 동시성 경합까지 2차 방어합니다. 운영 불변식으로 못 박은 것입니다.
:::

:::details Q6. 면접후기는 왜 별도 테이블인가?
`INTERVIEW_REVIEW` 카테고리만 회사명·직무·난이도·면접일·결과·AI 추출질문 같은 메타가 필요합니다. 이걸 `community_post`에 다 넣으면 자유게시판 글까지 NULL 컬럼을 잔뜩 갖게 됩니다. 그래서 `community_interview_review`를 글과 1:1(`post_id` PK = FK)로 분리해, 면접후기일 때만 LEFT JOIN으로 메타를 붙입니다. AI 추출질문은 여기 저장되면서 동시에 영역 D의 `interview_knowledge` RAG로도 적재됩니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있는지 점검:

- `community_post` 위성 테이블 6종을 나열하고 각 1:N/1:1 관계와 `ON DELETE` 정책(CASCADE vs SET NULL)을 구분해 말하기.
- 익명인데도 `user_id`를 비우지 않는 이유 3가지(소유권·중복신고·집계).
- 좋아요 토글에서 `DuplicateKeyException`을 흡수하는 이유와 UNIQUE 제약의 역할.
- 신고 상태머신을 `PENDING → CONFIRMED/DISMISSED`와 `action_taken`으로 그리고, `DELETED` 불가역 가드 설명하기.
- "자동 검열 즉시 숨김"과 "신고 → 운영자 확정"의 차이를 한 문장으로.

관련 페이지: [AI 신고·부적절 분류](/area-f/ai-report-classify), [AI 태그 추천](/area-f/ai-tag-recommend), [영역 F 개요](/area-f/).

## 퀴즈

<QuizBox question="커뮤니티에서 사용자가 게시글을 신고하면 곧바로 일어나는 일은?" :choices="['글이 즉시 HIDDEN으로 숨겨진다', 'status=PENDING으로 접수되고 AI는 참고 소견만 저장하며 처분은 운영자가 확정한다', 'AI confidence가 0.8 이상이면 자동 삭제된다', '작성자에게 즉시 경고 알림이 발송된다']" :answer="1" explanation="사용자 신고는 PENDING으로 접수되고 AI는 post_ai_result(task_type=REPORT)에 관리자 참고용 소견만 남깁니다. 실제 숨김/삭제는 운영자가 takeAction으로 CONFIRMED를 확정해야 일어납니다. confidence 0.8 자동 숨김은 신고가 아니라 '생성 시점 자동 검열'의 동작입니다." />

<QuizBox question="익명 게시판인데도 community_post에 user_id를 항상 채워두는 이유로 가장 거리가 먼 것은?" :choices="['본인 글 수정/삭제 소유권 판정', '중복 신고와 본인 글 신고 차단', '화면에 실제 작성자 닉네임을 노출하기 위해', '본인 글 좋아요(self-like) 차단']" :answer="2" explanation="is_anonymous는 표시 계층에서 닉네임을 가리는 플래그입니다. user_id는 소유권·중복신고 방지·self-like 차단 등 내부 판정을 위해 보존하는 것이지, 익명 글의 작성자를 화면에 노출하기 위한 것이 아닙니다." />

<QuizBox question="post_reaction 테이블의 UNIQUE(user_id, post_id, reaction_type) 제약이 카운트 캐시에 기여하는 핵심 효과는?" :choices="['좋아요 수를 매번 COUNT(*)로 다시 세게 한다', '동시 토글 충돌 시에도 한 사용자의 같은 반응이 한 번만 카운트되도록 보증한다', '북마크를 댓글에도 허용한다', 'DELETED 글의 반응을 자동 복구한다']" :answer="1" explanation="UNIQUE 제약 덕분에 동시 토글로 두 트랜잭션이 insert를 시도해도 하나는 DuplicateKeyException을 받아 카운트를 재증가하지 않고 흡수합니다. 결과적으로 like_count 같은 비정규화 캐시가 원본과 어긋나지 않습니다." />
