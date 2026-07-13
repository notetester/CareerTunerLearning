# 고객센터 · 공지 · 알림

> 영역 F의 "운영 커뮤니케이션" 골격 — 1:1 문의 티켓, 공지/FAQ, 알림/푸시. 핵심은 **티켓 상태 머신**, **운영자 확정(초안↔답변 분리)**, **알림 생성과 푸시 발송의 트랜잭션 분리**다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

CareerTuner의 고객센터/공지/알림은 사용자와 운영자 사이의 **양방향 커뮤니케이션 채널**이다. 게시판(영역 F의 커뮤니티)이 사용자끼리의 정보 공유라면, 이 영역은 운영자가 개입하는 1:1·일방향 채널을 책임진다.

- **문의 티켓**(`support_ticket` + `support_ticket_message`): 사용자가 1:1로 문의하고, 상담사가 스레드로 답변하는 헬프데스크.
- **공지/FAQ**(`notice`, `faq`, `faq_media`): 운영자가 발행하는 일방향 정보.
- **알림/푸시**(`notification`, `notification_preference`, `push_subscription`): 시스템이 사용자에게 보내는 in-app 알림과 Web Push.

이 페이지가 답하는 면접 질문:

1. "문의 한 건이 들어와서 답변되기까지 어떤 테이블과 상태 변화를 거치나?"
2. "AI 답변 초안은 왜 DB에 저장하지 않고 매번 즉석 생성하나?"
3. "알림을 생성하면 푸시는 어떻게 발송되나? 왜 같은 트랜잭션에서 안 보내나?"
4. "내부 메모(상담사끼리만 보는 메모)는 어떻게 분리하나?"

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

### 2-1. 운영자 확정 원칙 — "AI는 보조, 자동 처분 아님"

영역 F 전체를 관통하는 최상위 원칙이 여기서도 그대로 적용된다. 고객문의 답변은 AI가 **초안**만 만들고, 실제 발송은 상담사가 직접 등록한다. 그래서 코드에서 **초안 생성 경로와 답변 등록 경로가 완전히 분리**되어 있다.

- `generateDraft()` — AI가 스레드를 읽고 초안 문자열을 반환. **DB에 저장하지 않음.**
- `reply()` — 상담사가 검토·수정한 최종 답변을 `support_ticket_message`에 INSERT하고 상태를 `ANSWERED`로 바꾸고 알림을 보냄.

정책·환불·개인정보가 얽힌 답변을 AI가 확정 발송하면 사고가 난다. 그래서 "초안은 휘발성, 답변만 영속"으로 못박았다.

### 2-2. 알림 생성 ≠ 푸시 발송 (트랜잭션 분리)

알림 한 건을 만드는 것과, 그 알림을 사용자 기기로 푸시하는 것은 **서로 다른 신뢰성 요구**를 가진다.

| 작업 | 실패하면 | 따라서 |
| --- | --- | --- |
| `notification` INSERT (in-app) | 알림 자체가 사라짐 — 치명적 | 호출자 트랜잭션 안에서 동기 처리 |
| Web Push 발송 (외부 HTTP) | 보조 채널 누락 — 허용 가능 | 트랜잭션 **밖**에서 비동기·best-effort |

만약 결제 완료 같은 비즈니스 트랜잭션 안에서 외부 푸시 서버로 HTTP를 쏘면, 푸시 서버가 느릴 때 DB 커넥션을 붙잡고 풀이 고갈된다. 또 트랜잭션이 롤백되면 "결제는 취소됐는데 푸시는 이미 나간" 유령 푸시가 발생한다. 그래서 `AFTER_COMMIT` + `@Async` 전용 풀로 분리했다(§4-3).

### 2-3. 공지·FAQ는 단순 CRUD, 과투자 회피

공지와 FAQ는 화려한 기능이 없다. 운영자가 글을 발행하고 사용자가 읽는다. 다만 두 가지 의도된 설계가 있다.

- **고정글(`is_pinned`) 우선 정렬** — 중요 공지를 목록 상단에 박제. 인덱스 `idx_notice_list (status, is_pinned DESC, published_at DESC)`가 이 정렬을 그대로 지원한다.
- **FAQ는 챗봇과 자산을 공유** — `faq.embedding` 컬럼(bge-m3 임베딩)을 FAQ-RAG 챗봇이 재사용한다. FAQ 화면용 테이블이 챗봇 지식 베이스를 겸한다. 별도 인프라를 만들지 않은 것이 핵심 트레이드오프.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

### 3-1. 테이블 5종 + 알림 3종

| 테이블 | 역할 | 핵심 컬럼 |
| --- | --- | --- |
| `support_ticket` | 문의 1건(헤더) | `status`(RECEIVED/IN_PROGRESS/ANSWERED/CLOSED), `priority`(NORMAL/HIGH/URGENT), `category` |
| `support_ticket_message` | 문의 스레드 메시지 | `sender_type`(USER/ADMIN), `is_internal`(내부 메모 플래그), `content` |
| `notice` | 공지 | `status`, `is_pinned`, `published_at`, `view_count` |
| `faq` | FAQ | `category`, `is_published`, `sort_order`, `embedding`, `link_url`/`link_label` |
| `faq_media` | FAQ 부속 미디어 | `media_type`, `media_url`, `sort_order`(여러 장·유튜브 링크) |
| `notification` | in-app 알림 | `type`, `target_type`/`target_id`, `link`, `is_read`/`read_at`, `actor_id` |
| `notification_preference` | 사용자별 수신 설정(1행) | `push_enabled`, `categories_json`, `quiet_hours_start`/`end` |
| `push_subscription` | 기기별 푸시 구독 | (Web Push/FCM 엔드포인트) |

:::tip 티켓에 "초안" 컬럼이 없다
`support_ticket`을 보면 답변 초안을 담는 컬럼이 없다. 이것은 누락이 아니라 §2-1의 의도된 설계 — AI 초안은 매번 즉석 생성하고 절대 영속하지 않기 때문이다.
:::

### 3-2. 백엔드 클래스 구조 (4계층)

```text
support/
 ├─ controller/   TicketController · NoticeController · FaqController
 ├─ service/      TicketServiceImpl · NoticeServiceImpl · FaqServiceImpl
 ├─ mapper/       TicketMapper · TicketMessageMapper · NoticeMapper · FaqMapper
 └─ domain/       SupportTicket · TicketMessage · Notice · Faq

admin/ticket/     AdminTicketServiceImpl(reply/draft) · ai/TicketDraftAiClient
notification/
 ├─ service/      NotificationServiceImpl(notify/read)
 ├─ event/        NotificationPushEvent · NotificationPushListener(AFTER_COMMIT)
 └─ push/         PushDispatcher · NotificationCategories · PushSender 구현 4종
```

사용자 측 티켓 조회/작성은 `support` 패키지, 상담사 측 답변/초안은 `admin/ticket` 패키지로 나뉜다. 같은 `support_ticket` 테이블을 양쪽이 다른 권한·다른 매퍼로 본다.

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 문의 한 건의 생애 (티켓 상태 머신)

상태값은 `support_ticket.status` 한 컬럼으로 관리되며, 누가 액션하느냐에 따라 전이가 정해져 있다.

```text
[사용자 작성]                  createTicket()
   └─> RECEIVED  ──(상담사 처리 시작)──> IN_PROGRESS
        │                                   │
        │ (상담사 답변 reply, internal=false)│
        ▼                                   ▼
     ANSWERED  <───────────────────────────┘
        │
        ├──(사용자 추가 메시지 addUserMessage)──> RECEIVED  (재오픈·관리자 재확인)
        │
        └──(상담사 종료)──> CLOSED  (사용자 메시지로 재오픈 불가)
```

코드 근거:

- `TicketServiceImpl.createTicket()` — 티켓을 `RECEIVED`로 만들고, 첫 메시지를 `USER`/`is_internal=false`로 INSERT. **티켓 헤더 + 첫 메시지가 한 트랜잭션.**
- `TicketServiceImpl.addUserMessage()` — `CLOSED`면 `INVALID_INPUT`으로 차단("새 문의를 등록해 주세요"). `ANSWERED`/`IN_PROGRESS`였다면 `RECEIVED`로 되돌려 상담사가 다시 보게 한다.
- `AdminTicketServiceImpl.reply()` — `is_internal=false`인 답변만 상태를 `ANSWERED`로 바꾸고 알림 발송. 내부 메모는 상태도 안 바꾸고 알림도 안 보낸다.

### 4-2. AI 답변 초안 (동기·미영속)

상담사가 "초안 생성"을 누르면:

```text
generateDraft(ticketId)
  1. getTicketDetail()로 스레드 조회
  2. is_internal 메시지는 제외하고 "[상담사]/[고객]" 컨텍스트 조립
  3. TicketDraftAiClient.generateDraft(context)
        → gemma4, temperature=0.4, num_ctx=4096
        → connectTimeout 10s / readTimeout 60s (검열보다 길게)
  4. AdminTicketDraftResponse(draft) 반환  ← DB 저장 안 함
```

핵심 코드(축약):

```java
// AdminTicketServiceImpl.generateDraft — 내부 메모는 컨텍스트에서 제외
for (var msg : detail.getMsgs()) {
    if (msg.isInternal()) continue;          // 내부 메모 제외
    String speaker = "admin".equals(msg.getWho()) ? "상담사" : "고객";
    context.append("- [").append(speaker).append("] ").append(msg.getText());
}
String draft = draftAiClient.generateDraft(context.toString());
return new AdminTicketDraftResponse(draft); // 즉석 반환, 영속 X
```

왜 동기인가? 검열·태깅은 사용자가 글을 쓰면 백그라운드에서 도는 비동기지만, 초안은 **상담사가 버튼을 눌렀고 화면에서 결과를 기다린다.** 즉시 응답이 본질이라 비동기 리스너가 아니라 동기 호출이다. 실패하면 `BusinessException(AI_UNAVAILABLE)`로 명시적 에러를 띄운다(조용히 삼키지 않음 — 사용자 차단형 검열과 반대).

:::warning 초안 ≠ 답변
`generateDraft`는 아무것도 바꾸지 않는다. 상담사가 초안을 그대로 쓰든, 수정하든, 버리든 — 실제로 고객에게 전달되는 것은 상담사가 `reply()`로 등록한 내용뿐이다. 이 분리가 "AI는 운영자 보조"라는 원칙의 코드 구현이다.
:::

### 4-3. 알림 발송 — in-app 즉시 + 푸시 비동기

`NotificationService.notify()`는 두 가지를 한다.

```java
@Transactional
public void notify(Notification notification) {
    notificationMapper.insert(notification);                       // ① in-app: 동기·트랜잭션 내
    eventPublisher.publishEvent(new NotificationPushEvent(...));   // ② push: 이벤트만 발행
}
```

이벤트는 `NotificationPushListener`가 받는다:

```java
@Async("notificationExecutor")                                       // 전용 스레드 풀
@TransactionalEventListener(phase = AFTER_COMMIT, fallbackExecution = true)
public void on(NotificationPushEvent event) {
    try { pushDispatcher.dispatch(event.notification()); }
    catch (Exception ex) { log.error(...); }                         // 실패해도 in-app 무사
}
```

여기서 세 가지 안전장치가 동시에 작동한다:

| 어노테이션 | 효과 |
| --- | --- |
| `AFTER_COMMIT` | 트랜잭션이 **커밋된 뒤에만** 푸시 → 롤백된 알림은 유령 푸시 안 됨 |
| `@Async("notificationExecutor")` | 외부 HTTP가 호출자(결제 등) 트랜잭션·웹 스레드를 안 막음 |
| `fallbackExecution = true` | 트랜잭션 없이 `notify()`가 불려도 푸시 유실 안 됨 |

그리고 `PushDispatcher.dispatch()`가 실제 발송 직전 **3단 게이트**를 친다:

```text
dispatch(notification):
  1. preference.pushEnabled() == false  → skip
  2. NotificationCategories.of(type) 카테고리가 사용자 설정에서 false → skip
  3. push_subscription의 모든 기기로 send()
  (모든 예외는 삼킴 — 푸시는 보조 채널)
```

`NotificationCategories.of(type)`이 알림 타입을 6개 사용자 카테고리(`ai_analysis`/`interview`/`correction`/`community`/`billing`/`notice`)로 매핑한다. 예: `TICKET_ANSWERED`와 `NOTICE`는 `notice` 카테고리, `COMMENT`/`LIKE`는 `community`. 사용자가 `notification_preference.categories_json`에서 특정 카테고리를 끄면 그 타입 푸시만 차단된다.

### 4-4. 티켓 답변 → 알림 → 화면의 연결

상담사가 답변을 등록하면 사용자에게 `TICKET_ANSWERED` 알림이 간다.

```java
// AdminTicketServiceImpl.reply (축약)
ticketMapper.insertMessage(id, "ADMIN", authUser.id(), content, internal);
if (!internal) {
    ticketMapper.updateStatus(id, "ANSWERED");
    notificationService.notify(Notification.builder()
        .userId(ownerId).actorId(authUser.id())
        .type("TICKET_ANSWERED").targetType("SUPPORT_TICKET").targetId(id)
        .title("문의에 답변이 등록되었습니다")
        .link("/support/contact").build());
}
```

`link`는 사용자가 알림을 클릭했을 때 이동할 경로다. 백엔드가 link를 주입하고(`notification` 테이블 주석: "link는 백엔드에서 주입"), 프런트는 그대로 라우팅한다.

### 4-5. 알림 읽기 — 폴링 기반(SSE 미사용)

프런트 `NotificationBell`은 SSE/WebSocket 대신 **30초 visibility-aware 폴링**으로 안 읽은 개수를 갱신한다(`UNREAD_POLL_INTERVAL_MS = 30_000`). 탭이 숨겨지면 `visibilitychange`로 폴링을 멈추고, 복귀하면 즉시 한 번 갱신한다. 실시간 SSE 인프라를 깔지 않고 "충분히 빠른" 폴링으로 과투자를 피한 의도된 결정이다.

읽음 처리는 본인 소유 검증을 거친다 — `markAsRead()`가 `notification.userId != userId`이면 `FORBIDDEN`을 던진다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 티켓 작성·스레드·상태 머신 | 구현됨 | RECEIVED↔IN_PROGRESS↔ANSWERED, CLOSED 종착 |
| 내부 메모(`is_internal`) 분리 | 구현됨 | 사용자 조회·초안 컨텍스트 양쪽에서 필터 |
| AI 답변 초안(#34) | 구현됨 | 동기·미영속, 내부 메모 제외, 실패 시 `AI_UNAVAILABLE` |
| 답변 등록 → `TICKET_ANSWERED` 알림 | 구현됨 | |
| 공지/FAQ 조회·관리자 CRUD | 구현됨 | `is_pinned` 정렬, 조회수 증가, FAQ 미디어 |
| 알림 생성 + AFTER_COMMIT 푸시 | 구현됨 | 3단 게이트, best-effort |
| 푸시 발송기(`PushSender`) | 추상화 구현 | `DefaultPushSender`/`LoggingPushSender`/`FcmPushClient`/`VapidWebPushClient` — 실제 외부 발송 키는 환경 의존 |
| 알림 30초 폴링·읽음·카테고리별 설정 | 구현됨 | SSE 미사용은 의도된 결정 |
| 사용자 측 답변 초안 노출 | 없음(설계상) | 초안은 상담사 화면 전용 |
| 파일 첨부(문의·추가 메시지) | 구현됨 | 공통 파일 업로드 후 `attachmentFileIds`, 서버 소유권 검증·thread 렌더링 |
| `notification` 일부 타입(`POST_SUMMARY_READY` 등) | 타입만 선언 | 화면/발송 경로 일부 미연결 |

:::details DB 패치 적용 상태에 대한 정직한 단서
챗봇 관련 테이블(응답 로그·미답 질문·메모리)은 `schema.sql`이 아니라 별도 patch로 관리되며 일부는 "(미적용)"으로 표기되어 있다. 공유 운영 DB 반영 여부가 환경마다 다를 수 있으므로, "스키마는 정의됨, 적용은 환경 의존"으로 이해하는 것이 정확하다.
:::

## 6. 면접 답변 3단계

**1단계 (한 문장):**
"고객센터는 `support_ticket`/`support_ticket_message` 두 테이블로 1:1 문의 스레드를 관리하고, 상태 머신(RECEIVED→IN_PROGRESS→ANSWERED→CLOSED)으로 흐름을 통제하며, AI는 답변 초안만 동기로 만들어 상담사가 확정하는 구조입니다."

**2단계 (왜):**
"핵심 설계 원칙은 두 가지입니다. 첫째, 운영자 확정 — AI 초안은 DB에 저장조차 하지 않고 매번 즉석 생성해서, 실제 발송은 상담사가 `reply()`로 등록한 답변만 되도록 초안과 답변을 분리했습니다. 둘째, 알림 생성과 푸시 발송의 트랜잭션 분리 — in-app 알림은 호출자 트랜잭션 안에서 동기로 INSERT하지만, 외부 푸시는 `AFTER_COMMIT` + 전용 비동기 풀로 빼서 커넥션 점유와 유령 푸시를 막았습니다."

**3단계 (구현 디테일):**
"내부 메모는 `is_internal` 플래그로 사용자 조회와 초안 컨텍스트 양쪽에서 필터합니다. 푸시는 best-effort라 `PushDispatcher`가 푸시 비활성·카테고리 off·기기 없음을 3단 게이트로 거르고 모든 예외를 삼켜서, 푸시가 실패해도 in-app 알림 흐름은 안 깨집니다. 알림 읽기는 SSE 대신 30초 visibility-aware 폴링으로 과투자를 피했습니다."

## 7. 꼬리질문 + 모범답안

**Q1. AI 답변 초안을 왜 DB에 저장하지 않나요? 캐싱하면 비용도 아낄 텐데요.**
초안을 영속하면 "AI가 만든 미검토 문장"이 답변과 같은 테이블에 섞일 위험이 있고, 실수로 그게 발송되면 운영자 확정 원칙이 깨집니다. 또 스레드는 상담사가 메모를 추가하거나 고객이 답글을 달면 계속 변하므로, 캐싱된 초안은 금방 stale해집니다. 매번 최신 스레드로 즉석 생성하는 비용(gemma4 한 번 호출)이 stale 리스크보다 싸다고 판단한 트레이드오프입니다.

**Q2. 알림을 `notify()` 한 트랜잭션에서 푸시까지 보내면 안 되나요?**
두 문제가 있습니다. (1) 외부 푸시 서버 HTTP가 느리면 DB 커넥션을 그 시간만큼 붙잡아 풀이 고갈됩니다. (2) 호출 측 트랜잭션이 롤백되면 in-app 알림은 사라지는데 푸시는 이미 나가 "결제 취소됐는데 푸시는 도착" 같은 불일치가 생깁니다. 그래서 `AFTER_COMMIT`으로 커밋 후에만, `@Async`로 별도 스레드에서 푸시합니다. 트랜잭션 없이 호출되는 경로를 위해 `fallbackExecution=true`도 켜뒀습니다.

**Q3. 내부 메모는 어떻게 사용자에게 안 보이게 하나요?**
`support_ticket_message.is_internal` 플래그 하나로 처리합니다. 사용자가 스레드를 볼 때 `TicketServiceImpl.toThread()`가 `!m.isInternal()`로 필터하고, AI 초안 생성 시에도 `generateDraft()`가 내부 메모를 컨텍스트에서 제외합니다. 같은 테이블에 메시지를 두되 조회 시점에 필터하는 방식이라 별도 테이블이 필요 없습니다.

**Q4. 종료된(CLOSED) 문의에 사용자가 답글을 달면요?**
`addUserMessage()`가 `CLOSED` 상태를 명시적으로 막고 `INVALID_INPUT`("새 문의를 등록해 주세요")을 던집니다. 종료를 종착 상태로 두는 이유는, 닫힌 문의가 무한정 재오픈되면 상태 관리가 어려워지기 때문입니다. 대신 `ANSWERED`/`IN_PROGRESS` 상태에서 사용자가 추가 메시지를 보내면 `RECEIVED`로 되돌려 상담사가 다시 확인하게 합니다.

**Q5. 푸시 발송이 실패하면 사용자는 알림을 영영 못 보나요?**
아닙니다. 푸시는 **보조 채널**일 뿐이고 in-app 알림(`notification` 테이블)이 1차 채널입니다. 푸시가 실패해도 `notification` 행은 이미 커밋됐으므로, 사용자가 앱에서 알림 벨을 30초 폴링으로 확인하면 그대로 보입니다. `PushDispatcher`가 모든 예외를 삼키는 것도 "푸시 실패가 알림 자체를 망치지 않게" 하기 위함입니다.

**Q6. FAQ 테이블에 `embedding` 컬럼이 왜 있나요? FAQ는 그냥 목록 아닌가요?**
FAQ 화면용 테이블이 동시에 FAQ-RAG 챗봇의 지식 베이스를 겸하기 때문입니다. `faq.embedding`에 bge-m3 임베딩(JSON)을 저장해두면, 챗봇이 사용자 질문을 임베딩해서 발행된 FAQ들과 코사인 유사도를 비교해 답변 근거를 찾습니다. FAQ 운영과 챗봇 지식을 한 테이블로 묶어 별도 벡터 인프라를 안 만든 설계입니다. (챗봇 쪽 동작은 [LangChain4j 에이전트](/area-f/langchain4j-agent) 페이지 참조.)

## 8. 직접 말해보기

아래 질문에 소리 내어 답해보세요. 막히면 해당 섹션으로 돌아가세요.

1. 사용자가 문의를 작성한 순간부터 답변을 받기까지, **테이블·상태·알림**을 순서대로 짚으며 설명해보세요. (§4-1, §4-4)
2. "AI 초안을 캐싱하자"는 제안을 받았다고 가정하고, 왜 거절하는지 트레이드오프로 설득해보세요. (§2-1, Q1)
3. 알림 생성과 푸시 발송을 분리하는 코드를 화이트보드에 그린다면 어떤 어노테이션 3개가 핵심인지 말해보세요. (§4-3)
4. `is_internal` 플래그 하나가 두 곳(사용자 조회·초안 컨텍스트)에서 어떻게 쓰이는지 설명해보세요. (§4-2, Q3)

## 퀴즈

<QuizBox question="AI 답변 초안(generateDraft)의 결과는 어디에 저장되는가?" :choices="['support_ticket의 draft 컬럼', 'support_ticket_message에 is_internal=true로', 'DB에 저장하지 않고 화면에 즉석 반환', 'notification 테이블']" :answer="2" explanation="초안은 영속하지 않는다. support_ticket에는 초안 컬럼 자체가 없고, generateDraft는 매번 최신 스레드로 즉석 생성해 AdminTicketDraftResponse로 반환만 한다. 운영자 확정 원칙(초안↔답변 분리)의 코드 구현이다." />

<QuizBox question="알림 생성 후 푸시를 AFTER_COMMIT + @Async로 분리한 주된 이유로 가장 정확한 것은?" :choices="['푸시가 in-app 알림보다 중요해서', '외부 HTTP가 트랜잭션·커넥션을 점유하는 것과 롤백 시 유령 푸시를 막기 위해', 'SSE를 쓰기 위해', '관리자 권한 검증을 위해']" :answer="1" explanation="외부 푸시 HTTP를 비즈니스 트랜잭션 안에서 보내면 커넥션 풀이 고갈되고, 롤백 시 알림은 사라졌는데 푸시는 나가는 불일치가 생긴다. AFTER_COMMIT으로 커밋 후에만, @Async로 별도 스레드에서 발송한다." />

<QuizBox question="CLOSED 상태의 문의에 사용자가 메시지를 추가하려고 하면?" :choices="['RECEIVED로 재오픈된다', 'IN_PROGRESS로 바뀐다', 'INVALID_INPUT 예외로 차단되고 새 문의를 안내한다', '내부 메모로 저장된다']" :answer="2" explanation="addUserMessage()는 CLOSED를 종착 상태로 보고 INVALID_INPUT을 던진다. 다만 ANSWERED/IN_PROGRESS 상태에서 사용자가 메시지를 보내면 RECEIVED로 되돌려 상담사가 재확인하게 한다." />
