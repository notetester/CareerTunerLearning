# F 관리자 화면 & 운영

> 영역 F의 모든 AI는 "자동 처분"이 아니라 "운영자 보조"다. 관리자 화면은 그 원칙이 코드로 강제되는 지점 — AI는 제안·초안·메트릭만 만들고, 확정 행위(숨김/삭제/답변 발송/FAQ 등록)는 항상 사람이 한 번 더 누른다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 F의 **관리자(admin) 백오피스**는 커뮤니티 신고·검열, 공지/FAQ CRUD, 1:1 문의 응대, 챗봇 운영 콘솔, 알림 모니터링을 한곳에 모은 운영 도구다. 사용자 화면이 "콘텐츠를 만드는 곳"이라면, 관리자 화면은 "AI가 만든 제안을 사람이 확정하는 곳"이다.

이 페이지가 답하는 면접 질문:

- "AI 검열·신고 분류를 만들었다는데, 운영자는 결국 무엇을 하나요?"
- "AI가 자동으로 글을 지우면 위험하지 않나요? 어떻게 막았나요?"
- "챗봇이 답 못한 질문은 어떻게 다시 FAQ로 흡수되나요?"
- "관리자 화면의 임계값 슬라이더는 실제 챗봇 동작을 바꾸나요?"

핵심 한 줄: **"AI는 판정(judge)까지, 사람은 확정(takeAction)까지."** 두 경계가 별도 클래스·별도 API·별도 task_type으로 분리돼 있다.

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 자동 처분 금지라는 출발 원칙

`docs/TEAM_WORK_DISTRIBUTION.md`의 F 섹션은 "AI는 운영자 보조이지 자동 처분이 아니다"를 최우선 설계 원칙으로 못박는다. 이걸 말이 아니라 코드로 강제하려고 관리자 흐름을 둘로 쪼갰다.

| 단계 | 주체 | 산출물 | 부수효과 |
| --- | --- | --- | --- |
| 판정(judge/classify) | AI(gemma4) | toxic·category·confidence | **없음**(신고 분류는 DB 기록만) |
| 확정(takeAction) | 운영자 | HIDDEN/DELETED/DISMISSED | 실제 상태 전이 + 카운트 조정 |

신고 분류(`classify()`)는 결과를 `post_ai_result(task_type=REPORT)`에 "관리자 참고용"으로만 저장하고 **자동 숨김도 알림도 하지 않는다.** 운영자가 신고 상세에서 AI 소견을 보고 직접 조치 버튼을 누를 때만 글이 바뀐다.

### 2-2. 트레이드오프: 생성시점 자동검열은 예외

다만 "글 작성 즉시 AI 자동검열"(`moderate()`)은 toxic이고 confidence가 hideThreshold(기본 0.80) 이상이면 글을 즉시 HIDDEN으로 내린다. 신고 분류와 다르게 자동 조치를 허용한 이유는: 노골적 욕설/스팸이 노출되는 그 시간을 줄이는 게 우선이고, **HIDDEN은 가역(restore 가능)**이기 때문이다. 반면 DELETED는 불가역이라 절대 자동화하지 않는다. 즉 "되돌릴 수 있는 보호 조치만 자동, 되돌릴 수 없는 처분은 사람"이라는 위험 비대칭에 따라 자동화 수준을 갈랐다.

### 2-3. 운영 콘솔을 별도로 만든 이유

챗봇은 "FAQ로 답을 줬느냐"가 품질의 전부다. 그래서 답 못한 질문을 모아 군집화하고, 그 군집을 FAQ 초안 → FAQ 등록으로 흡수하는 **폐루프(closed loop)**를 관리자 콘솔로 만들었다. 메트릭(자동해결률·전환율)은 이 루프가 잘 돌고 있는지 보는 계기판이다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

모든 관리자 API는 `@RequestMapping("/api/admin/**")` 경로 규칙으로 `SecurityConfig`에서 자동 관리자 전용이 되고, 서비스 진입부에서 `AdminAccess.requireAdmin(authUser)` 또는 `authUser.role()=="ADMIN"` 체크를 한 번 더 한다. 응답은 전부 `ApiResponse<T>` envelope.

| 운영 영역 | 컨트롤러 | 기준 경로 | 핵심 테이블 |
| --- | --- | --- | --- |
| 신고 처리 | `AdminReportController` | `/api/admin/community/reports` | `post_report`, `comment_report` |
| 자동검열 운영 | `AdminModerationController` | `/api/admin/ai/moderation` | `post_ai_result`, `comment_ai_result`, `ai_moderation_setting` |
| 태그 backfill | `AdminTaggingController` | `/api/admin/ai/tagging` | `community_post_tag` |
| 면접질문 추출 backfill | `AdminInterviewExtractController` | `/api/admin/ai/interview-extract` | `interview_knowledge`(D) |
| 가이드라인 | `AdminGuidelineController` | `/api/admin/guidelines` | `community_guideline` |
| 공지 | `AdminNoticeController` | `/api/admin/notices` | `notice` |
| FAQ | `AdminFaqController` | `/api/admin/faq` | `faq` |
| 1:1 문의 | `AdminTicketController` | `/api/admin/tickets` | `support_ticket`, `support_ticket_message` |
| 챗봇 미답·전환 | `AdminUnansweredController` | `/api/admin/chatbot/unanswered` | `chatbot_unanswered_question` |
| 챗봇 메트릭 | `AdminChatbotMetricsController` | `/api/admin/chatbot/metrics` | `chatbot_response_log` |
| 챗봇 임계 미리보기 | `AdminChatbotThresholdController` | `/api/admin/chatbot/threshold` | `chatbot_response_log` |
| 챗봇 참조 로그 | `AdminChatbotReferenceController` | `/api/admin/chatbot/references` | `chatbot_response_log` |
| 알림 모니터 | `AdminNotificationController` | `/api/admin/notifications` | `notification` |

프론트는 `frontend/src/admin/features/` 아래 기능별로 나뉜다: `community/`(AdminReports, AdminGuidelines), `moderation/`(ModerationSettingsPanel), `ai-support/`(AdminAiSupport — 미답/메트릭/임계/참조 통합), `faqs/`, `notices/`, `notifications/`.

:::tip 프롬프트 운영은 "파일 기반, 화면 비편집"
검열/태깅/추출/티켓초안/FAQ초안/챗봇 시스템 프롬프트는 전부 `backend/src/main/resources/prompts/*.txt` 파일이다(`moderation-system.txt`, `tagging-system.txt`, `interview-extract-system.txt`, `ticket-draft-system.txt`, `faq-draft-system.txt`, `community-chat-system.txt`, `intake-chat-system.txt` + `strictness/{STRICT,NORMAL,LENIENT}.txt`). `/api/admin/prompts` 컨트롤러는 **job/company/profile/interview**(A~E 영역) 프롬프트만 노출하고, F의 프롬프트는 화면에서 편집하지 않는다. F가 화면으로 "튜닝"하는 건 프롬프트 텍스트가 아니라 **검열 엄격도(strictness)와 임계값** — 즉 `STRICT/NORMAL/LENIENT` 텍스트를 동적으로 갈아끼우는 스위치다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 신고 → AI 소견 → 운영자 확정 (가장 중요한 흐름)

`AdminReportServiceImpl`이 신고 운영의 심장이다.

```text
사용자 신고  → (게시글 신고만) ReportClassifyRequiredEvent → classify(postId)
            → post_ai_result(REPORT) 저장 [자동조치 없음]
운영자 목록   GET  /reports?status=...           findAll()
운영자 상세   GET  /reports/{id}                  getReportDetail() → buildAiOpinion()
운영자 조치   POST /reports/{id}/action           takeAction()  [상태 전이 + 카운트]
AI 재검토    POST /reports/{id}/reclassify        moderationService.classify() 동기 호출
```

여기서 놓치면 안 되는 디테일이 세 가지다.

**(1) 게시글/댓글 신고를 ID 규약으로 다중화한다.** 신고 상세·조치 API는 게시글과 댓글을 한 엔드포인트로 받되, `id >= 1_000_000`이면 댓글 신고로 보고 `id - 1_000_000`을 실제 댓글 ID로 푼다. 댓글 신고는 AI 소견을 붙이지 않고(`buildAiOpinion`은 게시글만), `reclassify`도 거부한다("댓글 신고는 AI 재검토를 지원하지 않습니다").

**(2) DELETED는 종착 상태(불가역).** `takeAction`의 HIDDEN/DELETED 분기 앞에서 `guardPostNotDeleted()`가 이미 DELETED인 글의 상태 변경을 거부한다. 사전 조회로 막고, 매퍼 SQL의 `status <> 'DELETED'` 가드가 경합을 2차 방어한다. 즉 "DELETED→HIDDEN 역행"과 "DELETED 재처리"를 둘 다 차단해 감사 일관성을 지킨다.

```java
// 정책: DELETED는 종착(불가역) — 사전 조회로 거부, 매퍼 가드로 2차 방어
private void guardPostNotDeleted(Long postId) {
    CommunityPost post = postMapper.findById(postId);
    if (post == null) throw new BusinessException(NOT_FOUND, ...);
    if ("DELETED".equals(post.getStatus()))
        throw new BusinessException(CONFLICT, "이미 삭제된 게시글은 상태를 변경할 수 없습니다.");
}
```

**(3) 댓글 조치 시 comment_count 이중감소 방지.** `hideCommentWithCount`/`deleteCommentWithCount`/`restoreCommentWithCount`는 "PUBLISHED 경계를 실제로 통과했을 때(affected-rows > 0)"만 카운트를 ±1 한다. AI 자동검열이 이미 같은 댓글을 숨겼다면 affected가 0이라 카운트를 또 깎지 않는다. 비정규화 카운트의 정합성을 경합 상황에서도 지키는 패턴이다.

**(4) 재검토는 일부러 동기 호출.** `reclassify()`는 `@Transactional(propagation = NOT_SUPPORTED)`로 트랜잭션을 분리한 뒤 `moderationService.classify(postId)`를 **동기**로 부른다. 생성시점 검열은 비동기(AFTER_COMMIT)이지만, 운영자가 "재검토" 버튼을 누른 상황은 결과를 즉시 봐야 하므로 그 자리에서 LLM을 호출하고 갱신된 소견을 바로 반환한다. (티켓 초안의 동기 호출과 같은 "사람이 눌렀으니 즉답" 철학.)

### 4-2. 자동검열 운영 패널 (`AdminModerationController`)

`/api/admin/ai/moderation` 한 컨트롤러가 게시글·댓글 검열 운영을 모두 담는다.

| 기능 | 메서드 | 특징 |
| --- | --- | --- |
| 배치 검열 | `POST /moderation/backfill?dryRun&force` | SQL 직삽 등으로 생성 이벤트가 누락된 글 사후 일괄 검열. dryRun은 대상 건수만 |
| 진행 상태 | `GET /moderation/backfill/status` | 배치 진행률 폴링 |
| 단건 재검열 | `POST /moderation/{postId}/run?force` | 동기 실행 |
| 검열 테스트 | `POST /moderation-test` | **DB 기록 없이 judge()만** 호출, 모델 감 잡기용 |
| 결과 목록/상세 | `GET /moderation`, `/moderation/{postId}` | status·toxic 필터 |
| 복원/삭제 | `POST /{postId}/restore`, `/delete` | HIDDEN↔PUBLISHED, HIDDEN→DELETED |
| 댓글 검열 | `/moderation/comments/**` | 게시글 엔드포인트 복제, `"comments"` 리터럴이 `{postId}`보다 우선 매칭 |
| 설정 조회/변경 | `GET`/`PATCH /moderation/settings` | strictness·hideThreshold·sanctionThreshold·blockDays |

설정 변경 PATCH는 입력을 강하게 검증한다: `strictness ∈ {STRICT,NORMAL,LENIENT}`, `hideThreshold ∈ [0.50, 0.95]`, `sanctionThreshold ∈ [1, 100]`, `blockDays ∈ [1, 3650]`. 부분 변경(보낸 필드만)이라, 현재 설정을 읽고 들어온 값만 덮어쓴 뒤 `settingService.update(...)`로 DB+캐시를 동시 갱신한다. 이 설정 행은 `ai_moderation_setting`의 단일 행(SETTING_ID=1)이다.

:::warning 임계값 슬라이더는 "미리보기"이지 적용이 아니다
`AdminChatbotThresholdController.preview()`는 **읽기 전용**이다. 슬라이더 값으로 `chatbot_response_log`에서 "이 임계 미만이었던 턴 수(공백 후보)"를 세고 0.05 폭 히스토그램을 그려주지만, **실 챗봇 컷오프는 한 글자도 바꾸지 않는다.** 잘못된 값(NaN)은 거부, 범위 밖 값은 `[0.0, 1.0]`으로 보정한다. 반면 `ai_moderation_setting`의 `hideThreshold` PATCH는 실제 검열 동작을 바꾼다. "어느 임계가 실제로 적용되느냐"를 면접에서 헷갈리지 말 것: **검열 hideThreshold = 실제 적용, 챗봇 threshold preview = 시뮬레이션만.**
:::

### 4-3. 챗봇 미답 → FAQ 폐루프 (`AdminUnansweredService`)

이 흐름이 챗봇 운영의 핵심 가치다.

```text
사용자 질문이 FAQ로 매칭 실패
  → chatbot_unanswered_question 에 (질문, 정규화키, top유사도, 임베딩, bestFaqId) 적재
운영자 목록   GET  /unanswered?status=NEW   → QuestionClusterer 의미 군집화 → 빈도 desc 정렬
운영자 드릴   GET  /unanswered/{id}/conversation  발생 대화 맥락 복원
초안 생성    POST /unanswered/{id}/draft   FaqDraftAiClient(gemma4) [저장 안 함, 반환만]
운영자 검토·수정
FAQ 등록     POST /unanswered/{id}/convert  createFaq 재사용 + 군집 전체 CONVERTED 표시
```

군집화가 이 패널의 두뇌다. `getUnanswered`는 원시 미답 행을 `QuestionClusterer.cluster()`로 의미 묶음으로 합치고, 각 군집을 "대표질문 + 빈도 + 최고유사도 + 변형 목록"으로 집계한 뒤 빈도순으로 정렬한다. 그래서 "같은 의미를 다른 표현으로 100번 물은 질문"이 100줄이 아니라 한 줄로 뜨고, 운영자는 가장 자주 막힌 곳부터 FAQ를 채운다.

초안 생성(`generateDraft`)은 대표질문 + 같은 의미의 변형들 + 참고 FAQ(`chatbotService.searchFaqContext`, 톤 정렬용)를 컨텍스트로 묶어 `FaqDraftAiClient`에 넘긴다. 임베딩이 장애여도 참고 FAQ만 빈 문자열이 되고 초안 생성은 진행된다(graceful degradation). 초안은 **저장하지 않고 반환만** — 운영자가 다듬어서 `convert`로 등록할 때 비로소 `faq` 행이 생긴다. 이때 **새 INSERT를 중복 구현하지 않고** `AdminFaqService.createFaq`를 재사용한다.

상태 전이도 군집 단위다. `updateStatus`(REVIEWED/DISMISSED)와 `convert`(CONVERTED)는 대표 ID가 속한 군집의 모든 멤버 ID를 한꺼번에 옮긴다. PATCH로 옮길 수 있는 상태는 `REVIEWED/DISMISSED`만이고 `CONVERTED`는 등록 흐름 전용이다.

발생 대화 드릴(`getConversation`)은 LangChain4j 메모리(`chatbot_conversation_memory.messages_json`)를 `ChatMessageDeserializer`로 방어적으로 파싱해 user/bot 턴만 추린다. JSON이 깨졌거나 대화가 없으면 빈 리스트를 반환해 화면이 깨지지 않게 한다(best-effort 맥락 보조).

### 4-4. 챗봇 메트릭 카드 (`AdminChatbotMetricsService`)

`chatbot_response_log`를 기간 집계해 4개 카드를 만든다.

| 카드 | 값 | 분모/근거 |
| --- | --- | --- |
| 자동 해결률 | `answered / total` | response_log |
| FAQ 참조 응답 수 | `answered`(건수) | response_log |
| FAQ 공백 | NEW 군집 수 | unanswered + QuestionClusterer |
| 상담사 전환율 | `handoffs / total` | response_log |

핵심 정직성: **기간 내 턴이 0이면 해당 카드를 통째로 null로 반환한다.** 프론트는 이걸 "수집 중" / "—"로 표시한다. 0건을 0%로 그려서 "성능이 좋다"는 착시를 주는 대신 "데이터 없음"을 정직히 노출한다. 스파크라인은 데이터 있는 날만 오는 일자 집계를 전 기간으로 펴고 빈 날을 0으로 채워 연속 막대를 만든다(헤드라인은 비율, 시계열은 건수라는 점도 의도적 구분).

### 4-5. 공지/FAQ/가이드라인 CRUD와 검색 인덱스 정합

`AdminNotice`/`AdminFaq`/`AdminGuideline` 컨트롤러는 표준 CRUD다. 한 가지 운영상 함정만 알면 된다.

:::details FAQ를 등록한다고 즉시 챗봇이 답하지는 않는다
`AdminFaqServiceImpl.createFaq`는 `faq` 행만 INSERT하고 **`faq.embedding`은 채우지 않는다.** 챗봇 FAQ 검색은 임베딩이 있는 발행 FAQ만 후보로 본다(`findPublishedWithEmbedding`). 새 FAQ의 임베딩은 `ChatbotService.embedAll(forceAll)`(관리자 트리거 `POST /chatbot/embed`)로 별도 적재한다 — 미임베딩만 채우거나 전체 재임베딩. 즉 "FAQ 작성 → 임베딩 배치 → 그제서야 챗봇이 매칭"이 정확한 순서다. 이 분리는 임베딩(Ollama bge-m3) 호출을 CRUD 트랜잭션에 묶지 않으려는 의도다(LLM 호출 분리 원칙).
:::

가이드라인은 버전·발행 모델이다. `POST /{id}/publish`로 특정 버전을 발행본으로 올리고, 사용자 가이드라인 화면은 이 발행본을 읽는다(없으면 하드코딩 fallback). 알림 모니터(`AdminNotificationController`)는 최근 발송 알림 목록을 보는 **읽기 전용** 모니터다(관리자가 임의로 알림을 쏘는 발송 콘솔이 아니라, 시스템이 만든 알림을 관찰하는 용도).

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 신고 목록/상세/조치/재검토 | 됨 | 게시글 자동, 댓글은 재검토 미지원 |
| 자동검열 운영(목록/복원/삭제/설정/backfill/test) | 됨 | 게시글·댓글 모두 |
| 검열 엄격도·임계값 PATCH | 됨 | `ai_moderation_setting` 단일 행 |
| 챗봇 미답 군집화·초안·전환(폐루프) | 됨 | convert가 createFaq 재사용 |
| 챗봇 메트릭/참조/임계 미리보기 | 됨 | 임계 미리보기는 읽기 전용 |
| 공지/FAQ/가이드라인 CRUD | 됨 | FAQ 임베딩은 별도 배치 |
| 알림 모니터 | 됨(읽기 전용) | 관리자 발송 콘솔은 아님 |
| 태그/면접추출 backfill | 됨 | `/api/admin/ai/tagging`, `/interview-extract` |
| F 프롬프트 화면 편집 | 계획/없음 | F 프롬프트는 파일 기반, 화면 비편집 |
| 일부 운영 메트릭 카드 데이터 | 데이터 의존 | 턴 0이면 null("수집 중") |

:::warning DB patch 적용 불확실성
`chatbot_*` 테이블, `comment_ai_result`, `sanction_threshold`/`block_days` 컬럼 등은 `schema.sql`이 아니라 별도 patch 파일로 관리되고, 모든 F patch 헤더에 "(미적용)"으로 표기돼 있다. 공유 DB 반영 여부가 확실치 않다는 뜻이라, "운영 콘솔이 항상 가득 찬 데이터를 보여준다"고 단정하면 안 된다.
:::

## 6. 면접 답변 3단계

1. **한 문장 정의:** "F 관리자 화면은 AI가 만든 검열·신고·답변 제안을 운영자가 확정하는 백오피스이고, AI 판정과 사람 확정이 별도 클래스·별도 task_type으로 분리돼 있습니다."
2. **근거 한 겹:** "예를 들어 신고는 `classify()`가 AI 소견만 `post_ai_result(REPORT)`에 저장하고 자동 조치를 안 합니다. 운영자가 `takeAction()`을 눌러야 HIDDEN/DELETED가 되고, DELETED는 `guardPostNotDeleted`로 불가역이 보장됩니다."
3. **트레이드오프·확장:** "되돌릴 수 있는 보호(HIDDEN)만 자동검열이 즉시 하고, 되돌릴 수 없는 처분과 답변 발송·FAQ 등록은 항상 사람이 합니다. 챗봇은 미답 질문을 군집화→초안→FAQ로 흡수하는 폐루프로 품질을 올립니다."

## 7. 꼬리질문 + 모범답안

**Q1. AI가 자동으로 글을 지우면 안 되나요? 왜 굳이 사람을 끼웠나요?**
처분의 위험 비대칭 때문입니다. HIDDEN은 `restore`로 되돌릴 수 있어 오탐 비용이 작아 자동검열이 즉시 합니다. 하지만 DELETED는 불가역이라 오탐 시 복구가 불가능합니다. 그래서 DELETED와 사용자 신고에 대한 처분, 답변 발송은 운영자 확정으로 묶었습니다. `guardPostNotDeleted`가 코드 레벨에서 DELETED 역행과 재처리를 막아 이 원칙을 강제합니다.

**Q2. 신고 분류 결과는 어디에 저장되고, 자동으로 무슨 일이 일어나나요?**
`classify(postId)`가 AI 판정을 `post_ai_result`의 `task_type=REPORT` 행에 저장합니다. 이 시점에 자동 숨김도, 작성자 알림도 없습니다. 운영자가 신고 상세를 열면 `buildAiOpinion`이 그 행에서 toxic/category/confidence/소요시간을 꺼내 "AI 소견"으로 보여주고, 운영자가 조치 버튼을 눌러야 실제 상태가 바뀝니다. 같은 `judge()` 두뇌를 쓰지만 생성시점 검열(MODERATION)과 신고(REPORT)는 task_type으로 구분해 부수효과만 다르게 했습니다.

**Q3. 관리자 화면의 임계값 슬라이더는 실제 챗봇을 바꾸나요?**
아니요. `AdminChatbotThresholdController.preview`는 읽기 전용으로, `chatbot_response_log`에서 "그 임계 미만이었던 턴 수"와 히스토그램만 계산해 보여줍니다. 운영자가 임계를 어디에 두면 공백이 얼마나 줄지 시뮬레이션하는 용도입니다. 실제로 동작을 바꾸는 건 검열 쪽 `ai_moderation_setting.hideThreshold`의 PATCH입니다. 둘을 섞으면 안 됩니다.

**Q4. 챗봇이 답 못한 질문은 어떻게 다시 FAQ가 되나요?**
미답 질문은 `chatbot_unanswered_question`에 적재되고, 운영 패널이 `QuestionClusterer`로 의미 군집화해 빈도순으로 보여줍니다. 운영자가 군집을 골라 초안 생성을 누르면 `FaqDraftAiClient`(gemma4)가 대표질문+변형들+참고 FAQ를 보고 초안을 만들어 반환만 합니다(저장 안 함). 운영자가 다듬어 `convert`하면 `createFaq`를 재사용해 FAQ를 등록하고 군집 전체를 CONVERTED로 표시합니다. 새 FAQ는 이후 `embedAll` 배치로 임베딩돼야 챗봇이 검색합니다.

**Q5. 게시글 신고와 댓글 신고를 어떻게 한 API로 다루나요?**
ID 규약입니다. `id >= 1_000_000`이면 댓글 신고로 보고 `id - 1_000_000`을 댓글 ID로 환원합니다. 댓글 신고는 AI 소견을 붙이지 않고 재검토(`reclassify`)도 거부합니다. 댓글 조치 시에는 `hideCommentWithCount` 등에서 "PUBLISHED 경계를 실제로 넘었을 때만" comment_count를 조정해, AI 자동검열과 운영자 조치가 겹쳐도 카운트가 이중 감소하지 않게 막습니다.

**Q6. FAQ를 등록했는데 챗봇이 바로 답하지 못하는 이유는?**
`createFaq`는 `faq` 행만 INSERT하고 임베딩(`faq.embedding`)은 채우지 않기 때문입니다. 챗봇은 임베딩이 있는 발행 FAQ만 코사인 후보로 봅니다. 새 FAQ는 `ChatbotService.embedAll`(관리자 임베딩 트리거)로 bge-m3 임베딩을 별도 적재해야 검색 대상이 됩니다. 임베딩(Ollama 호출)을 CRUD 트랜잭션에 묶지 않으려는 분리 설계의 결과입니다.

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 페이지를 이해한 것이다.

- "판정과 확정을 분리했다"를 신고 흐름의 클래스·API·테이블로 구체적으로 말하기.
- HIDDEN은 자동, DELETED는 사람인 이유를 "위험 비대칭"으로 설명하기.
- 검열 `hideThreshold`(실제 적용)와 챗봇 threshold preview(시뮬레이션)의 차이.
- 챗봇 미답 → 군집화 → 초안 → convert → embedAll로 이어지는 FAQ 폐루프 전체 경로.
- FAQ를 등록해도 챗봇이 바로 못 답하는 이유(임베딩 배치 분리).

연관 학습: [공통 구조화 출력](/ai/openai-structured-output), [임베딩과 코사인 검색](/ai/embedding), [LLM 폴백 전략](/ai/fallback), [JWT 보안](/backend/jwt-security).

## 퀴즈

<QuizBox question="게시글 신고 분류(classify)가 AI 판정을 마친 직후 자동으로 일어나는 일은?" :choices="['글을 즉시 HIDDEN으로 내린다', 'post_ai_result(REPORT)에 소견만 저장하고 자동 조치는 하지 않는다', '작성자에게 경고 알림을 보낸다', '사용자를 즉시 BLOCKED 처리한다']" :answer="1" explanation="신고 분류는 운영자 참고용 소견만 저장하고 자동 숨김/알림/제재를 하지 않습니다. 실제 조치는 운영자가 takeAction을 눌러야 일어납니다. 즉시 HIDDEN은 '생성시점 자동검열(moderate)'의 동작이지 신고 분류가 아닙니다." />

<QuizBox question="관리자 챗봇 운영 콘솔의 '임계값 미리보기(threshold preview)'에 대한 설명으로 옳은 것은?" :choices="['슬라이더 값을 저장하면 실 챗봇 컷오프가 즉시 바뀐다', '읽기 전용으로, 그 임계 미만이었던 턴 수와 히스토그램만 계산해 보여준다', 'ai_moderation_setting의 hideThreshold를 갱신한다', '챗봇 답변 프롬프트를 다시 컴파일한다']" :answer="1" explanation="preview는 chatbot_response_log를 읽어 시뮬레이션만 합니다. 실 챗봇 컷오프를 바꾸지 않습니다. 실제 동작을 바꾸는 건 검열 쪽 ai_moderation_setting.hideThreshold PATCH로, 둘은 다른 임계입니다." />

<QuizBox question="DELETED 상태에 대한 운영 불변식으로 코드가 강제하는 것은?" :choices="['DELETED 글도 운영자가 다시 PUBLISHED로 복원할 수 있다', 'DELETED는 종착(불가역) 상태라 DELETED→HIDDEN 역행과 재처리를 guardPostNotDeleted가 막는다', 'DELETED는 7일 뒤 자동 복구된다', 'DELETED는 AI가 자동으로 부여할 수 있다']" :answer="1" explanation="guardPostNotDeleted가 사전 조회로 DELETED 글의 상태 변경을 거부하고, 매퍼 SQL의 status<>'DELETED' 가드가 경합을 2차 방어합니다. DELETED는 운영자만, 그리고 불가역으로 설계됐습니다." />
