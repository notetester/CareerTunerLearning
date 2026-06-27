# 고객문의 AI 답변 초안 [#34]

> 상담원이 "초안 생성"을 누르면, 문의 스레드를 LLM에 넘겨 정중한 답변 초안을 즉석 생성해 답변 입력창에 채워준다. 초안은 DB에 저장하지 않으며, 상담원이 검토·수정 후 발송한다. AI는 답변을 자동 발송하지 않는다.

## 1. 한 줄 정의와 이 페이지가 답하는 면접 질문

고객센터 1:1 문의(티켓)에 대해, 운영자가 버튼을 눌렀을 때 **상담원 검토용 답변 초안**을 LLM으로 생성하는 기능이다. 핵심은 "AI가 고객에게 직접 답하지 않는다"는 것 — 생성물은 어디까지나 상담원 입력창을 채우는 보조 텍스트이고, 실제 발송은 사람이 누른 `reply()`가 한다.

이 페이지가 답하는 면접 질문:

- "AI가 고객 응대까지 자동화하나요? 잘못된 답이 나가면 어떻게 막죠?"
- "왜 답변 초안만 비동기가 아니라 동기 호출인가요?"
- "환불·결제·개인정보처럼 민감한 문의는 AI 초안에서 어떻게 다루나요?"
- "초안을 DB에 저장하나요? 안 한다면 왜죠?"

:::tip 이름 주의
설계 문서에는 이 기능이 `SupportAiService`로 표기되어 있지만, 실제 코드의 진입점은 `AdminTicketServiceImpl.generateDraft()`이고 LLM 호출은 `admin/ticket/ai/TicketDraftAiClient`가 담당한다. 면접에서는 "문서상 명칭과 구현 클래스가 다르다"는 점을 정확히 구분하면 코드를 직접 읽었다는 신호가 된다.
:::

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

이 영역의 최우선 원칙은 **"AI는 운영자 보조이지, 자동 처분이 아니다"**이다. 신고 분류(#33)가 운영자 확정을 거치듯, 문의 응대도 같은 철학을 따른다. 그래서 #34는 의도적으로 "초안과 발송을 분리"하도록 만들어졌다.

| 결정 | 이유 | 트레이드오프 |
| --- | --- | --- |
| **동기 호출** (비동기 리스너 아님) | 상담원이 "초안 생성"을 누른 그 순간 화면에 결과가 떠야 한다. 검열(#33)처럼 백그라운드로 미루면 UX가 끊긴다 | LLM이 느리면 상담원이 최대 60초 기다림 → `readTimeout=60s`로 검열(30s)보다 길게 잡음 |
| **DB 미영속** (초안 컬럼 없음) | 초안은 "확정 답변"이 아니라 매번 버려도 되는 임시물. 저장하면 "AI가 쓴 글"과 "사람이 쓴 글"의 경계가 흐려진다 | 같은 티켓에 초안을 또 만들면 매번 LLM 재호출(캐시 없음) |
| **내부 메모 제외** | `is_internal=true` 메시지(상담원끼리 보는 메모)가 고객 답변 초안에 섞이면 정보 유출 | 내부 메모의 맥락은 초안에 반영 안 됨(의도된 안전 비용) |
| **프롬프트로 단정 금지 강제** | 결제 성공 여부·환불 처리 같은 미확인 사실을 AI가 단정하면 오정보 발송 위험 | 초안이 다소 보수적·일반적으로 나옴(상담원이 구체화) |
| **실패 시 명확한 에러** | Ollama 장애 시 빈 초안이 조용히 뜨면 상담원이 신뢰. `BusinessException(AI_UNAVAILABLE)`로 BAD_GATEWAY 반환 | AI 없이도 상담원이 직접 답하면 되므로 본 업무는 안 막힘 |

핵심 트레이드오프 한 줄: **속도와 안전을 맞바꾸는 게 아니라, "AI를 발송 경로에서 빼는" 구조적 분리로 둘 다 확보**했다. 초안은 빠르게(동기) 주되, 책임은 사람에게 남긴다.

## 3. 어떤 기술로 구현했나 (실제 클래스·테이블 근거)

세 계층으로 나뉜다.

| 계층 | 클래스/파일 | 역할 |
| --- | --- | --- |
| Controller | `AdminTicketController` | `POST /api/admin/tickets/{id}/draft` 진입점. 관리자 인증 후 서비스 위임 |
| Service | `AdminTicketServiceImpl.generateDraft()` | 티켓 상세 조회 → **내부 메모 제외**한 컨텍스트 조립 → AI 클라이언트 호출 |
| AI Client | `admin/ticket/ai/TicketDraftAiClient` | Ollama `/api/chat` 동기 호출, gemma4, `temperature=0.4`, `num_ctx=4096` |
| 프롬프트 | `prompts/ticket-draft-system.txt` | 존댓말·단정 금지·본문만 출력 지시. 로드 실패 시 하드코딩 fallback |
| DTO | `AdminTicketDraftResponse(String draft)` | 초안 텍스트만 담는 record |

데이터 측 근거:

- `support_ticket` (status: RECEIVED / IN_PROGRESS / ANSWERED / CLOSED) — **초안 컬럼이 없다**. 초안은 여기에 저장되지 않는다.
- `support_ticket_message` (sender_type USER/ADMIN, **is_internal**) — 컨텍스트 조립 시 `is_internal=true` 행을 건너뛴다.
- LLM 백엔드: 로컬 Ollama(`OllamaProperties.baseUrl` 기본값 `http://localhost:11434`, 원격 4090 GPU 서버로 설정 교체 가능), 모델 gemma4.

:::warning 같은 LLM, 다른 클라이언트
검열용 `OllamaClient`와 달리, `TicketDraftAiClient`는 **재시도 로직이 없다**(구조화 출력도 안 씀). 상담원이 즉시 다시 누르면 되므로 자동 재시도를 빼서 단순하게 유지한 것이다. 또한 이 호출은 `ai_usage_log`에 기록되지 않는다 — F 영역 AI는 자체 결과/로그 테이블로 감사를 관리한다.
:::

## 4. 동작 원리 (흐름·표·작은 코드)

### 4-1. 한 번의 초안 생성 흐름

1. 상담원이 관리자 문의 화면에서 "초안 생성" 클릭 → `POST /api/admin/tickets/{id}/draft`
2. `requireAdmin()`으로 권한 확인
3. `getTicketDetail(id)`로 티켓 + 전체 메시지 스레드 조회
4. 컨텍스트 조립: `is_internal` 메시지 제외, 나머지를 `[상담사]/[고객]` 라벨로 직렬화
5. `TicketDraftAiClient.generateDraft(context)` 동기 호출 → gemma4가 답변 본문 생성
6. `AdminTicketDraftResponse(draft)`로 **반환만** (DB 저장 없음)
7. 프론트가 받은 초안을 답변 입력창(`replyText`)에 그대로 채움 → 상담원이 검토·수정
8. 상담원이 별도로 `POST /{id}/reply` → `support_ticket_message`에 ADMIN 메시지 insert + `status=ANSWERED` + 작성자에게 `TICKET_ANSWERED` 알림

### 4-2. 컨텍스트 조립 (내부 메모 차단이 핵심)

```java
// AdminTicketServiceImpl.generateDraft() — 요지 축약
StringBuilder ctx = new StringBuilder();
ctx.append("문의 분류: ").append(detail.getCategory()).append('\n');
ctx.append("문의 제목: ").append(detail.getSubject()).append('\n');
ctx.append("대화 내역:\n");
for (var msg : detail.getMsgs()) {
    if (msg.isInternal()) continue;            // 내부 메모는 컨텍스트에서 제외
    String who = "admin".equals(msg.getWho()) ? "상담사" : "고객";
    ctx.append("- [").append(who).append("] ").append(msg.getText()).append('\n');
}
String draft = draftAiClient.generateDraft(ctx.toString()); // 동기 호출
```

### 4-3. LLM 호출 파라미터와 실패 처리

```java
// TicketDraftAiClient — connectTimeout 10s, readTimeout 60s
Map.of("model", "gemma4", "stream", false,
       "options", Map.of("temperature", 0.4, "num_ctx", 4096), ...);
// 실패 시:
catch (RestClientException | ClassCastException e) {
    throw new BusinessException(ErrorCode.AI_UNAVAILABLE); // HTTP 502
}
```

`temperature=0.4`는 검열(0)보다 약간 높다 — 답변 초안은 결정적 분류가 아니라 자연스러운 문장이 목표라서, 약간의 다양성을 허용하되 환각은 프롬프트로 억제한다.

### 4-4. 환불·정책·개인정보 같은 민감 문의 처리

이 부분이 집중 포인트다. 코드가 막는 게 아니라 **프롬프트가 행동을 제약**한다(`ticket-draft-system.txt`):

- "확인되지 않은 사실(결제 성공 여부, 환불 처리 등)을 단정하지 마라. 확인이 필요한 부분은 `확인 후 안내드리겠습니다`처럼 표현하라."
- "고객 개인정보나 내부 정책을 추측해서 만들어내지 마라."
- "이 초안은 상담사가 검토·수정 후 발송하는 보조 자료다."

즉 환불/결제 문의가 들어와도 AI는 "환불 처리됐습니다" 같은 확정을 못 쓰고 "확인 후 안내" 톤으로 빠진다. 최종 정책 판단은 결제 영역(E)과 상담원의 몫이며, AI 초안은 그 위에서 **표현 보조** 역할만 한다. 프론트도 이를 시각적으로 못박는다 — 초안 카드에 "AI 생성 · 그대로 전송 금지" 라벨이 붙는다.

### 4-5. 확장된 같은 패턴 — FAQ 초안

답 못한 질문을 FAQ로 승격할 때 쓰는 `admin/chatbot/ai/FaqDraftAiClient`가 동일 패턴을 복제했다(동기·gemma4·`temp 0.4`·`num_ctx 4096`·`AI_UNAVAILABLE` 폴백). 프롬프트만 `faq-draft-system.txt`로 다르다. "초안 생성 패턴"이 티켓→FAQ로 재사용된 사례다.

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 설명 |
| --- | --- | --- |
| 동기 초안 생성·반환 | 구현됨 | 컨트롤러·서비스·AI 클라이언트·프롬프트 전부 존재, 프론트 연동 완료 |
| 내부 메모 제외 | 구현됨 | `is_internal` 행 skip |
| 초안 DB 미영속 | 구현됨(설계 의도) | `support_ticket`에 초안 컬럼 없음, 매번 즉석 생성 |
| 단정 금지·존댓말 | 구현됨 | 프롬프트로 강제 + fallback 프롬프트 |
| 초안↔답변 분리 | 구현됨 | 초안은 `generateDraft`, 발송은 `reply`로 별도 |
| `TICKET_ANSWERED` 알림 | 구현됨 | 답변 등록 시 작성자에게 발송 |
| `TICKET_DRAFT_READY` 알림 | ⚠️ 프론트 타입만 | 알림 taxonomy에 type은 정의돼 있으나, **동기 호출이라 백엔드 `generateDraft()`는 이 알림을 발행하지 않는다**(즉시 화면 반환이므로 비동기 통지 불필요) |
| "AI 회원 요약" 카드 | ⚠️ mock | 관리자 화면의 회원 요약은 백엔드 API 미구현, 화면용 mock 텍스트 |
| LLM 폴백(Haiku 등) | ⚠️ 없음(예정) | Ollama 장애 시 폴백 없이 `AI_UNAVAILABLE`. OpenAI/Haiku 1차 폴백은 할 일 |

:::details 왜 TICKET_DRAFT_READY는 안 쓰이나
이 알림 type은 "초안이 비동기로 준비되면 관리자에게 알린다"는 설계를 전제한다. 하지만 실제 구현은 동기 호출로 바뀌어 상담원이 누른 즉시 응답이 화면에 뜬다. 그래서 "준비 완료 알림"이 필요 없어졌고, type 선언만 프론트 taxonomy에 남았다. 면접에서는 "설계 흔적과 최종 구현의 차이"를 보여주는 좋은 예시다.
:::

## 6. 면접 답변 3단계

**1단계 (한 문장 정의):** "고객 1:1 문의에 대해, 상담원이 버튼을 누르면 LLM이 답변 초안을 동기로 생성해 입력창에 채워주는 보조 기능입니다. AI가 직접 발송하진 않습니다."

**2단계 (설계 의도):** "이 영역 원칙이 'AI는 운영자 보조, 자동 처분 아님'이라, 초안과 발송을 구조적으로 분리했습니다. 초안은 DB에 저장하지 않고 매번 즉석 생성해 반환만 하고, 실제 답변은 사람이 누른 `reply()`가 별도로 등록합니다. 환불·개인정보 같은 민감 사실은 프롬프트로 단정을 금지해 '확인 후 안내' 톤으로 유도합니다."

**3단계 (기술 디테일):** "`AdminTicketServiceImpl.generateDraft()`가 티켓 스레드를 조회해 내부 메모(`is_internal`)를 제외하고 `[상담사]/[고객]` 컨텍스트로 만든 뒤, `TicketDraftAiClient`가 로컬 Ollama의 gemma4를 `temperature 0.4`로 동기 호출합니다. 검열처럼 백그라운드로 미루지 않은 건 상담원이 즉시 결과를 봐야 하기 때문이고, 그래서 readTimeout을 60초로 길게 잡았습니다. Ollama 장애 시엔 `AI_UNAVAILABLE`(502)로 명확히 실패시키고, AI 없이도 상담원이 직접 답하면 되므로 본 업무는 안 막힙니다."

## 7. 꼬리질문 + 모범답안

**Q1. 왜 검열(#33)은 비동기인데 초안(#34)은 동기인가요?**
A. 트리거 주체가 다르다. 검열은 사용자가 글을 올린 직후 백그라운드에서 일어나야 하고, 30초 LLM이 사용자 응답을 막으면 안 되니 `AFTER_COMMIT` 비동기 + 전용 풀을 쓴다. 반면 초안은 상담원이 명시적으로 "초안 생성"을 누른 동작이라, 그 화면에서 즉시 결과를 보여줘야 한다. 비동기로 만들면 "언제 뜨지?"라는 UX 공백이 생긴다. 그래서 동기 호출에 readTimeout만 60초로 넉넉히 잡았다.

**Q2. 초안을 DB에 저장하지 않으면 같은 티켓에서 또 누르면 매번 LLM을 다시 호출하잖아요. 낭비 아닌가요?**
A. 의도된 비용이다. 초안은 "확정물"이 아니라 매번 버려도 되는 임시 보조물이라, 저장하면 오히려 "AI가 쓴 텍스트"가 영속 데이터로 남아 책임 경계가 흐려진다. 문의당 초안 생성 빈도도 낮아(보통 1~2회) 캐싱 이득이 작다. 진짜 영속 대상은 상담원이 확정한 `reply` 메시지뿐이다.

**Q3. 내부 메모를 컨텍스트에서 빼는 이유와, 빼면 생기는 손해는?**
A. `is_internal=true`는 상담원끼리만 보는 메모라 고객 답변에 섞이면 정보 유출이다. 그래서 컨텍스트 조립 루프에서 `continue`로 건너뛴다. 손해는 내부 메모에 담긴 판단(예: "이 고객 환불 승인됨")이 초안에 반영 안 된다는 것인데, 이건 안전을 위한 의도된 비용이다. 상담원이 초안을 받아 그 맥락을 직접 채운다.

**Q4. 환불됐다고 고객이 우기는데 AI가 "환불 처리됐습니다"라고 초안을 쓰면 어떻게 막죠?**
A. 코드가 아니라 프롬프트로 막는다. `ticket-draft-system.txt`가 "결제 성공 여부·환불 처리 등 확인되지 않은 사실을 단정하지 마라, 확인이 필요하면 '확인 후 안내드리겠습니다'로 써라"라고 명시한다. 그래서 초안은 확정 대신 보수적 톤으로 나오고, 최종 사실 확인과 정책 판단은 결제 영역(E)·상담원이 한다. 그리고 어차피 사람이 검토 후 발송하므로 잘못된 단정이 그대로 나가지 않는다.

**Q5. Ollama가 죽으면 상담 업무가 멈추나요?**
A. 아니다. 초안 생성만 실패하고 `BusinessException(AI_UNAVAILABLE)`(502)로 끊긴다. 프론트는 "지금은 AI 초안 생성이 어려워요. 평소처럼 직접 답변해 주세요" 안내를 띄운다. 초안은 보조 기능이라, 상담원이 손으로 답변을 작성하는 본 흐름은 영향받지 않는다.

**Q6. `SupportAiService`라고 들었는데 코드엔 그런 클래스가 없던데요?**
A. 설계 문서상 명칭이고, 실제 구현은 진입점 `AdminTicketServiceImpl.generateDraft()` + LLM 클라이언트 `TicketDraftAiClient`로 나뉘어 있다. 위치도 `support/ai`가 아니라 `admin/ticket/ai`인데, 초안 생성이 운영자(관리자) 화면 기능이라 admin 도메인에 배치한 것이다. 같은 패턴을 FAQ 초안(`admin/chatbot/ai/FaqDraftAiClient`)이 재사용한다.

## 8. 직접 말해보기

다음을 막힘없이 설명할 수 있으면 이 주제는 통과다.

- "초안 생성"부터 고객에게 답변이 가기까지의 전체 흐름을 단계로 나열하고, **어디서 사람이 개입하는지** 짚기
- 동기 vs 비동기 선택의 근거를 검열(#33)과 대비해 설명하기
- 내부 메모 제외와 단정 금지가 각각 **무엇을 막는 안전장치인지** 한 문장씩
- 초안이 DB에 저장되지 않는 이유와, 그게 "운영자 확정 원칙"과 어떻게 연결되는지
- `TICKET_DRAFT_READY` 알림 type이 선언만 있고 안 쓰이는 이유

## 퀴즈

<QuizBox question="#34 고객문의 답변 초안이 비동기 리스너가 아니라 동기 호출로 구현된 가장 큰 이유는?" :choices="['LLM 호출이 항상 1초 미만이라서', '상담원이 버튼을 누른 즉시 화면에 결과를 보여줘야 해서', 'DB 트랜잭션을 길게 잡아야 해서', '검열보다 우선순위가 낮아서']" :answer="1" explanation="상담원이 명시적으로 초안 생성을 누른 동작이라 그 화면에서 즉시 결과가 떠야 한다. 그래서 동기 호출에 readTimeout만 60초로 넉넉히 잡았다. 검열(#33)은 사용자 글 작성 직후 백그라운드라 비동기다." />

<QuizBox question="고객문의 답변 초안 컨텍스트를 조립할 때 제외되는 메시지는?" :choices="['고객이 보낸 메시지', '상담사가 보낸 답변', 'is_internal=true 인 내부 메모', 'ANSWERED 상태 이전 메시지']" :answer="2" explanation="is_internal=true 메시지는 상담원끼리만 보는 내부 메모라 고객 답변 초안에 섞이면 정보 유출이다. generateDraft()의 루프가 이를 continue로 건너뛴다." />

<QuizBox question="생성된 답변 초안의 저장 방식으로 옳은 것은?" :choices="['support_ticket의 draft 컬럼에 저장된다', 'DB에 저장하지 않고 반환만 하며 매번 즉석 생성한다', 'support_ticket_message에 is_internal=true로 저장된다', 'ai_usage_log에 기록된다']" :answer="1" explanation="초안은 확정물이 아닌 임시 보조물이라 DB에 영속하지 않는다. support_ticket에는 초안 컬럼이 없고, 실제 영속 대상은 상담원이 확정한 reply 메시지뿐이다. F 영역 AI는 ai_usage_log에 기록하지 않는다." />
