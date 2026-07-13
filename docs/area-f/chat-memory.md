# 챗봇 대화 메모리와 삭제

> 대화 메시지와 인테이크 슬롯은 모두 DB에서 복원할 수 있다. 사용자 삭제는 두 저장소를 함께 정리하며, 자동 TTL은 현재 두지 않았다.

## 두 데이터의 책임

| 데이터 | 저장 | 목적 |
| --- | --- | --- |
| 대화 메시지 window | `chatbot_conversation_memory` | LangChain4j 문맥과 사용자 history |
| 인테이크 확정 슬롯 | `chatbot_intake_slot` | 지원 건·모드·진행 상태 |

대화 텍스트와 실행 파라미터는 다른 신뢰 경계라 별도 테이블로 둔다.

## `MyBatisChatMemoryStore`

LangChain4j `ChatMemoryStore`를 구현해 메시지 목록을 JSON으로 upsert한다. 메모리 window가 바뀔 때 conversation ID 기준으로 갱신하고, 최근 로그인 대화 목록과 단건 history를 제공한다.

UI history에는 사용자와 assistant의 텍스트만 변환해 보낸다. 시스템 prompt, tool call과 tool result는 내부 실행 정보이므로 표시하지 않는다.

## 복원

사용자가 과거 대화를 열면 DB의 message JSON을 LangChain4j 메시지로 복원한다. 인테이크가 진행 중이면 같은 conversation ID의 `PENDING` 슬롯도 복원한다.

이 때문에 서버 재시작 뒤에도 대화와 확정된 진행 상태가 함께 이어진다.

## 삭제

사용자는 자신의 대화만 삭제할 수 있다.

```text
DELETE /api/chatbot/conversations/{id}
  -> 로그인 확인
  -> memory owner 확인
  -> intake slot 삭제
  -> memory 삭제
```

없는 ID와 타인 ID를 구분해 노출하지 않고 동일한 거절을 사용한다. 대화 밖의 지원 건·면접 리포트·자소서 산출물은 건드리지 않는다.

관리자 삭제도 별도 세부 권한과 감사 로그를 요구하며 슬롯을 함께 정리한다.

## 자동 TTL

현재 “N일 뒤 자동 삭제” 배치는 없다. 사용자가 명시적으로 삭제할 수 있고 `updated_at`이 있어 이후 보존 정책을 도입할 기반은 있지만, 자동 만료가 동작한다고 말하면 안 된다.

개인정보 보존 기간을 정하면 다음을 함께 설계해야 한다.

- 익명/로그인 대화의 다른 보존 기간
- 진행 중 PENDING 슬롯 제외 여부
- 상담·분쟁 보존 hold
- 삭제 batch의 슬롯 동반 정리
- 운영 감사와 사용자 고지

## 면접 답변

> "LangChain4j의 인메모리 window만 쓰지 않고 `MyBatisChatMemoryStore`로 대화 JSON을 MySQL에 upsert합니다. 인테이크 슬롯도 별도 `chatbot_intake_slot`에 저장해 PENDING 상태를 복원합니다. 사용자가 대화를 삭제하면 소유권을 확인하고 슬롯을 먼저 지운 뒤 memory를 삭제해 고아 데이터를 막습니다. 명시 삭제는 구현됐지만 자동 TTL 정책은 아직 없습니다."

<QuizBox question="대화 삭제 시 함께 지워야 하는 것은?" :choices="['지원 건 전체', '대화 memory와 해당 인테이크 슬롯', '모든 사용자 로그', 'FAQ 문서']" :answer="1" explanation="논리 참조 슬롯을 함께 정리해 고아 상태를 막는다." />

<QuizBox question="현재 자동 TTL 상태는?" :choices="['매일 30일 초과 삭제', '없으며 명시 삭제만 구현', '브라우저 종료 즉시 삭제', '모든 대화를 영구 보존해야 함']" :answer="1" explanation="updated_at은 있지만 자동 정리 batch는 확인되지 않는다." />
