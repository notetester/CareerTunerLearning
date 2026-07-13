# 인테이크 챗봇

> 사용자의 자연어 준비 요청에서 지원 건과 면접 모드를 수집해 AutoPrep 실행 계약으로 넘긴다. 프런트 챗봇에 연결돼 있고 확정 슬롯은 MySQL에 영속된다.

## 목표

“카카오 백엔드 면접 준비해 줘” 같은 요청은 어떤 지원 건과 모드를 쓸지 불완전할 수 있다. 인테이크는 한 번에 추측하지 않고 필요한 슬롯을 대화로 확인한다.

- `applicationCaseId`
- `mode`
- 원래 사용자 질의
- 후보 지원 건

## 슬롯 접지

LLM이 임의 case ID를 만들 수 없게 `IntakeTools`가 현재 사용자의 지원 건 목록을 조회하고, 검증을 통과한 선택만 `IntakeSlotTrace`에 기록한다. 실행은 슬롯이 충분할 때만 D/AutoPrep 계약으로 넘긴다.

## 메모리와 DB

요청 처리 중에는 빠른 조립을 위해 `IntakeSlotTrace`를 사용하고, 지원 건이 확정된 슬롯은 `chatbot_intake_slot`에 upsert한다.

| 컬럼 | 역할 |
| --- | --- |
| `conversation_id` | 대화와 1:1인 슬롯 키 |
| `user_id` | 로그인 소유자 |
| `application_case_id` | 검증된 지원 건 |
| `mode` | 면접 모드 |
| `status` | `PENDING`, `READY`, `DONE` |
| `original_query` | 첫 요청 |
| `updated_at` | 복원·운영 추적 |

서버 재시작이나 재방문 후 `PENDING` 슬롯을 DB에서 복원한다. `READY`와 `DONE`을 다시 살리지 않아 완료된 인테이크가 오래된 값으로 재진입하는 버그를 막는다.

## 상태

- `PENDING`: 추가 슬롯을 묻는 진행 상태, 복원 대상
- `READY`: 실행에 필요한 슬롯 충족, 프런트 run으로 위임
- `DONE`: 사용자 이탈 또는 종료, sticky 복원 제외

“그만”은 열린 슬롯을 DONE으로 닫는다. 대화 삭제는 상태만 바꾸는 것이 아니라 슬롯 행과 메모리 행을 함께 제거한다.

## 프런트 연결

공통 챗봇 `useChatbot`이 인테이크 응답의 `autoPrepRequest`, 후보와 다음 질문을 소비한다. 사용자는 칩으로 지원 건·모드를 확정하고, 파일을 연결해 AutoPrep run으로 넘길 수 있다.

첨부의 경우 인테이크 질의 자체와 최종 run 요청의 지원 범위가 다를 수 있으므로 file ID를 소유권 검증 후 명시적으로 handoff한다.

## 이탈과 인터럽트

인테이크 도중 일반 FAQ나 “계속할게요” 같은 발화를 잘못 슬롯으로 먹지 않도록 router와 interrupt gate를 둔다. 현재 단계 재질문은 LLM이 원 질문을 다시 해석해 자동 완료하지 않도록 결정론적으로 계산한다.

## 삭제와 고아 방지

`DELETE /api/chatbot/conversations/{conversationId}`는 소유자를 확인한 뒤 다음 순서로 처리한다.

1. `chatbot_intake_slot` 삭제와 trace drop
2. `chatbot_conversation_memory` 삭제

슬롯은 논리 참조라 memory만 삭제하면 고아 행이 남는다. 슬롯을 먼저 지우면 두 번째 단계 실패 시 대화가 남아 사용자가 재시도할 수 있다.

## 구현 상태

| 항목 | 상태 |
| --- | --- |
| 멀티턴 슬롯 수집 | 구현 |
| 소유 지원 건 검증 | 구현 |
| 프런트 챗봇 연결 | 구현 |
| AutoPrep 요청 handoff | 구현 |
| 슬롯 DB upsert·복원 | 구현 |
| PENDING/READY/DONE 게이트 | 구현 |
| 대화 삭제 동반 정리 | 구현 |

## 면접 답변

> "인테이크는 LLM이 case ID를 추측하게 하지 않고 소유 지원 건 조회 tool을 통과한 값만 슬롯으로 확정합니다. 처리 중 trace와 MySQL `chatbot_intake_slot`을 함께 사용해 PENDING 상태를 재시작 후 복원하고 READY/DONE은 되살리지 않습니다. 프런트 챗봇의 칩과 AutoPrep run에 연결돼 있으며 대화 삭제 때 슬롯을 먼저 지워 고아 데이터를 막습니다."

<QuizBox question="재시작 후 복원하는 슬롯 상태는?" :choices="['모든 상태', 'PENDING만', 'READY만', 'DONE만']" :answer="1" explanation="완료·이탈 슬롯의 stale 부활을 막기 위해 진행 중 상태만 복원한다." />

<QuizBox question="인테이크 슬롯의 현재 저장 방식은?" :choices="['JVM 메모리만', '요청 중 trace + 확정 슬롯 MySQL upsert', '브라우저 localStorage만', 'Qdrant']" :answer="1" explanation="ChatbotIntakeSlotMapper가 conversation_id 기준으로 DB에 영속하고 필요 시 복원한다." />
