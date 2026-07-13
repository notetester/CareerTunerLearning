# 첨삭 데이터 모델

> `correction_request`는 원문, 개선 결과, 실행 컨텍스트, 사용량 로그와 멱등 키를 한 행에 연결한다. 새 첨삭은 새 행으로 남기고 사용자 삭제는 소프트 삭제한다.

## 정본 DDL

| 컬럼 | 역할 |
| --- | --- |
| `id` | 결과 식별자 |
| `user_id` | 소유 사용자 |
| `request_key` | 네트워크 재시도 멱등 키 |
| `application_case_id` | 선택적 지원 건 |
| `correction_type` | `SELF_INTRO`, `INTERVIEW_ANSWER`, `RESUME`, `PORTFOLIO` |
| `source_type` | 직접 입력 또는 연결 source 구분 |
| `source_ref_id` | 면접 답변 같은 원본 식별자 |
| `original_text` | 사용자가 준 원문 |
| `improved_text` | 검증된 개선문 |
| `result_json` | 요약·문제·변경 이유·제안 |
| `source_snapshot` | 조립 컨텍스트·요청/실제 모델 추적 |
| `status` | 저장 결과 상태 |
| `ai_usage_log_id` | 모델 실행 사용량 로그 |
| `admin_memo` | 운영 메모 |
| `deleted_at` | 소프트 삭제 시각 |
| `created_at` | 생성 시각 |

## 제약의 의미

### 사용자 + 요청 키 유니크

`uk_correction_request_user_key(user_id, request_key)`는 같은 사용자의 동일 실행이 두 행으로 저장되는 것을 막는다. 서로 다른 사용자가 같은 문자열 키를 만들어도 충돌하지 않는다.

서비스는 먼저 기존 행을 조회하고, 동시에 두 요청이 통과해 INSERT에서 경쟁하면 유니크 위반 후 이미 저장된 승자 행을 다시 읽어 replay한다.

### 지원 건 FK는 SET NULL

지원 건이 삭제돼도 첨삭 원문과 결과 자체는 유지한다. `application_case_id` 연결만 끊기므로 사용자는 자신의 과거 작업을 볼 수 있고 운영 감사도 남는다.

### 사용량 로그 FK는 SET NULL

로그 수명주기가 달라도 사용자 결과를 함께 물리 삭제하지 않는다. 정상 생성에서는 `ai_usage_log_id`로 provider·token·과금 근거를 추적한다.

## `result_json`을 둔 이유

검색과 소유권에 필요한 핵심 필드는 컬럼으로 두고, 함께 반환되는 배열 구조는 JSON에 보관한다.

```json
{
  "summary": "...",
  "issues": ["..."],
  "changeReasons": ["..."],
  "suggestions": ["..."]
}
```

`improved_text`는 목록·관리자 화면에서 자주 필요하므로 별도 컬럼이다. JSON은 확장성이 좋지만 임의 필드에 대한 강한 DB 제약은 약하므로 저장 전 Java payload 검증을 거친다.

## `source_snapshot`

지원 건과 프로필은 이후 바뀔 수 있다. snapshot은 특정 실행 당시 어떤 맥락을 모델에 조립했는지, 사용자가 어떤 모델 tier를 요청했고 실제 어느 모델이 응답했는지 추적하는 근거다.

원본 도메인의 버전 테이블과 source snapshot은 목적이 다르다. 원본 버전은 변경 이력을, snapshot은 해당 실행 입력을 보존한다.

## 결과 생명주기

```text
생성
  -> SUCCESS 행 INSERT
  -> 조회 목록/상세
  -> 재첨삭은 새 requestKey와 새 행
  -> DELETE API는 deleted_at 설정
  -> 일반 조회는 deleted_at IS NULL만 반환
```

실패한 모델 호출은 `correction_request`에 가짜 실패 결과를 만들지 않고 FAILED `ai_usage_log`에 남는다.

## 트랜잭션 경계

유효 payload가 나온 뒤 다음을 한 트랜잭션에서 처리한다.

1. SUCCESS 사용량 로그
2. 첨삭 결과 행
3. 사용권 또는 크레딧 차감 장부

차감이 완료되지 않으면 결과 성공을 확정하지 않는다. 반대로 provider 호출 자체가 실패하면 실패 로그는 독립 기록되고 결과·차감은 없다.

## 프런트와 API

| 기능 | 구현 |
| --- | --- |
| POST 생성 | 구현 |
| GET 목록·상세 | 구현 |
| DELETE 소프트 삭제 | 구현 |
| Correction.tsx 결과·이력 | 구현 |
| requestKey replay | 구현 |
| 실제 과금 연결 | 구현 |

## 면접 답변

> "첨삭 결과는 `correction_request`에 원문과 개선문을 별도 저장합니다. 사용자+request_key 유니크로 네트워크 재시도를 멱등하게 만들고, source_snapshot으로 당시 컨텍스트와 모델을 추적합니다. 새 첨삭은 append-only 새 행이며 삭제는 deleted_at 소프트 삭제입니다. 유효 결과, SUCCESS 사용량 로그와 차감을 한 트랜잭션으로 묶어 결과는 있는데 과금만 실패한 상태를 막았습니다."

<QuizBox question="request_key 유니크가 user_id와 함께 묶인 이유는?" :choices="['모든 사용자가 같은 키를 공유해서', '사용자별 동일 실행만 중복 방지하고 다른 사용자의 우연한 같은 키는 허용하기 위해', '정렬을 빠르게 하려고', '소프트 삭제를 위해']" :answer="1" explanation="멱등 범위는 사용자 요청이며 복합 유니크가 그 경계를 표현한다." />

<QuizBox question="첨삭 DELETE의 현재 동작은?" :choices="['행을 물리 삭제', 'deleted_at을 설정하고 일반 조회에서 제외', '원문만 삭제', '프런트에서 숨기기만 함']" :answer="1" explanation="CorrectionMapper.softDelete가 소유자와 활성 행 조건으로 deleted_at을 설정한다." />
