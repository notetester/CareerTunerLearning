# 이력서 표현 AI 개선 [#26]

> 이력서 원문을 **성과 중심 문장 · 역할 명확화 · 정량 지표 보강**으로 다듬는 첨삭이다. 핵심은 "별도 모델이 아니다" — 첨삭 4종(#24~27)은 단일 `correction` 도메인을 공유하고, 이력서는 `correctionType = RESUME`이라는 분기 하나로만 구분된다. 그 위에 "없는 성과를 지어내지 않는다"는 가드레일이 얹혀 있다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

이력서 표현 개선(#26)은 **사용자가 이미 쓴 이력서 원문**(경력·프로젝트·기술스택)을 입력받아, OpenAI Responses API의 structured output으로 `improvedText`(개선문) + 변경 근거를 산출하고, 그 결과를 `correction_request` 테이블에 불변(append-only)으로 저장하는 기능이다. 백엔드 진입점은 `POST /api/corrections`에 `correctionType=RESUME`을 실어 호출하는 `CorrectionService.create(userId, request)` 하나다.

이 페이지가 면접에서 답해야 하는 질문:

- "이력서 첨삭은 자소서·포트폴리오 첨삭과 모델이 다른가요? 왜 같은 도메인으로 묶었나요?"
- "AI가 '매출 30% 상승' 같은 성과를 멋대로 지어내면요? 어떻게 막았나요?"
- "이력서 한 건을 첨삭하면 DB에 무엇이 어떻게 남나요? 원본은 덮어쓰나요?"
- "이력서 첨삭은 크레딧을 2 쓴다는데, 실제로 차감이 일어나나요?"

:::tip 한 문장 요약
`create()`는 **타입 검증 → (지원 건이 있으면) 소유권 위임 → OpenAI 구조화 호출(3회 재시도) → 사용량 로그(별도 트랜잭션) → `correction_request` INSERT**의 5단 오케스트레이션이고, 이력서는 그 흐름 위에서 `RESUME` 분기 + 프롬프트 가드레일로만 특수화된다.
:::

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 결정 1 — 첨삭 4종을 단일 도메인으로 통합 (이력서를 따로 만들지 않음)

이력서·자소서·면접답변·포트폴리오는 표면적으로 다른 작업처럼 보이지만, **입력→처리→출력→저장 흐름이 완전히 같다.** 원문 텍스트 한 덩어리를 받아 → LLM이 다듬어 → 개선문 + 변경 근거를 돌려주고 → 한 테이블에 적재한다. 그래서 모델·서비스·AI 클라이언트를 1개로 두고 `correctionType`(`SELF_INTRO` / `INTERVIEW_ANSWER` / `RESUME` / `PORTFOLIO`)으로만 분기했다(`CorrectionService.java:33-36, 107-113`).

| 분리했다면 | 통합한 결과(채택) |
| --- | --- |
| 4개 컨트롤러·서비스·클라이언트·테이블 | 1개씩 + `correctionType` 한 컬럼 |
| 4벌의 재시도·structured output·가드 코드 중복 | 한 곳만 고치면 4종 동시 개선 |
| 과금 정책도 4벌 | `benefit_code = CORRECTION` 한 풀을 4종이 공유 |

트레이드오프: 이력서 전용으로 깊게 커스터마이즈(예: 경력기술서 특화 프롬프트 분기)하려면 결국 타입별 프롬프트 갈래가 필요하다. 현재는 **공통 시스템 프롬프트 + 타입을 user 프롬프트에 문자열로 전달**하는 수준의 가벼운 분기라, 이력서만의 정량지표 강제 로직은 LLM 지시에 의존한다(아래 5절).

### 결정 2 — 원문 보존형 개선 (성과를 "지어내지 않는다")

이력서는 채용 사기 리스크가 가장 큰 문서다. "정량 지표 보강"을 시키면 LLM은 손쉽게 `매출 30% 향상`, `사용자 5만 명` 같은 **숫자를 환각으로 만들어낸다.** 이력서에 거짓 수치가 들어가면 서류 합격 후 면접·레퍼런스 단계에서 그대로 사고가 된다.

그래서 시스템 프롬프트에 가드레일을 박았다(`CorrectionPromptCatalog.java:9-12`):

```text
Improve only the user's existing material for a real job application.
Do not invent achievements, metrics, employers, projects, or experiences.
If a stronger sentence needs missing evidence, keep it as a suggestion
instead of adding false facts.
```

즉 정량 지표가 원문에 **없으면**, 본문(`improvedText`)에 숫자를 넣는 대신 `suggestions`(제안) 배열에 "이 프로젝트의 처리 건수/개선율을 숫자로 적으면 강해집니다" 식으로만 안내한다. 사용자가 진짜 수치를 확인해 직접 채워 넣게 하는 구조다. 변경 이유는 `changeReasons`로 따로 제공해 사용자가 **검증 후 선택 반영**하게 한다.

### 결정 3 — 첨삭에는 mock/룰베이스 폴백을 두지 않음

영역 C의 적합도(점수)는 LLM이 죽어도 규칙엔진 폴백으로 화면을 살린다. 하지만 이력서 첨삭은 **사실 생성 책임이 무거워서**, 룰베이스 더미 문장을 돌려주는 게 오히려 위험하다(어설픈 자동 문구가 사용자의 진짜 경력을 왜곡). 그래서 OpenAI 키가 없으면 폴백하지 않고 즉시 실패시킨다(`CorrectionAiClient.java:91-94`). 대신 `CorrectionAiClient`를 **향후 자체 LLM 폴백 디스패처가 들어갈 단일 진입점**으로만 비워 두었다.

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

| 계층 | 클래스 / 파일 | 이력서 첨삭에서의 역할 |
| --- | --- | --- |
| Controller | `CorrectionController` (`/api/corrections`) | POST 생성, GET 목록·단건(소유자 한정) |
| Service | `CorrectionService.create` | 타입 검증·소유권·로그·저장 오케스트레이션 |
| AI 클라이언트 | `CorrectionAiClient.correct` | OpenAI Responses 호출 + structured output 파싱 + 3회 재시도 |
| 프롬프트 | `CorrectionPromptCatalog` (`VERSION="e-correction-v1"`) | 환각 금지 가드레일 시스템 프롬프트 |
| 사용량 로그 | `CorrectionAiUsageLogService` | `ai_usage_log` 기록(별도 트랜잭션) |
| 소유권 위임 | `ApplicationCaseAccessService.requireOwned` | 지원 건 연결 시 소유 검증(E가 직접 판단 안 함) |
| 저장 테이블 | `correction_request` (`correction_type='RESUME'`) | 원문·개선문·`result_json`·로그 FK |
| 과금 정책 seed | `ai_feature_benefit_policy` (`CORRECTION_RESUME`) | benefit_code=`CORRECTION`, default_credit_cost=`2` |

이력서만을 위한 클래스는 **없다.** 위 표 전체가 4종 공통이고, 이력서는 `featureType = "CORRECTION_" + "RESUME"` = `CORRECTION_RESUME`라는 키(`CorrectionService.java:141-143`)로만 식별된다. 이 키가 사용량 로그와 과금 정책을 잇는다.

:::details `ai_feature_benefit_policy`의 이력서 seed 한 줄
패치 `20260618_e_ai_billing_products.sql`에 다음이 박혀 있다.

```sql
-- feature_type, benefit_code, charge_unit, included_in_ticket, default_credit_cost, ...
('CORRECTION_RESUME', 'CORRECTION', 'PER_REQUEST', 1, 2, 1)
```

`default_credit_cost = 2` → 이력서 첨삭의 기준 단가는 2크레딧. `included_in_ticket = 1` → "AI 첨삭권" 사용권으로도 차감 가능. 단 **이 정책은 seed로만 존재하고 실제 차감 호출에 배선되어 있지 않다**(5절·아래 구현 상태 참조).
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4-1. 입력 → 출력 한눈에

이력서 첨삭의 입력은 `CorrectionCreateRequest`다.

| 필드 | 이력서 첨삭에서의 의미 |
| --- | --- |
| `correctionType` | `"RESUME"` (이력서 분기 키) |
| `originalText` | 이력서 원문(경력·프로젝트·활동·기술스택). **필수, 최대 12000자** |
| `applicationCaseId` | 있으면 그 지원 건의 회사명·직무를 LLM 컨텍스트로 주입 |
| `sourceType` | 기본 `DIRECT_INPUT`(직접 입력) |
| `sourceRefId` | A의 이력서 원본 식별자(있으면) |
| `questionText` | 이력서는 보통 비움 (`@Size(max=1000)`) |

출력은 `CorrectionPayload`의 5필드 — **코드 기준**(`CorrectionAiClient.java:56-62`):

| 필드 | 내용 | 이력서에서의 쓰임 |
| --- | --- | --- |
| `improvedText` | 개선된 이력서 문장 | 성과 중심·역할 명확화로 다듬어진 본문 |
| `summary` | 한 줄 요약 | "수동적 표현을 성과 동사로 전환" 등 |
| `issues` | 발견된 문제 | "역할이 'OO 담당'으로만 적혀 책임 범위가 모호" |
| `changeReasons` | 변경 이유 | 사용자가 검증·선택 반영하기 위한 근거 |
| `suggestions` | 추가 제안 | **원문에 없는 정량지표는 여기로** (환각 방지) |

:::warning 출력 필드 계약 불일치 (면접에서 정직하게)
운영안 설계 계약은 `corrected_text / changes / risk_flags / preserved_meaning / added_facts / confidence` 6필드였지만, **실제 코드 출력은 위 5필드다.** 설계서가 매핑을 명시한다(`improvedText = corrected_text`, `changeReasons = changes`). 페이지·면접에서는 **코드 출력 5필드를 기준**으로 말하고, 6필드는 "초기 설계 목표 계약"으로만 언급하면 된다.
:::

### 4-2. structured output으로 모양을 강제

이력서 응답이 매번 같은 JSON 모양으로 나오도록, OpenAI 호출 자체에 JSON 스키마를 strict로 박는다(`CorrectionAiClient.java:147-152, 225-233`).

```text
text.format = {
  type: "json_schema",
  strict: true,
  schema: {  // correctionSchema()
    properties: { improvedText, summary, issues, changeReasons, suggestions },
    required:   [모든 5필드],          // 전부 필수
    additionalProperties: false        // 추가 키 금지
  }
}
```

`strict + 전 필드 required + additionalProperties:false` 3종 세트라, 모델이 키를 빠뜨리거나 멋대로 새 필드를 붙일 수 없다. 파싱 측에서도 `improvedText`가 공백이면 `INTERNAL_ERROR "AI correction result is empty."`로 막고, 코드펜스(```` ```json ````)가 섞여 오면 제거한다(`CorrectionAiClient.java:52-55, 166-168`).

### 4-3. 재시도 정책 (이력서 = 첨삭 공통)

이력서 첨삭은 일시적 오류에 강하게 설계됐다. `MAX_ATTEMPTS=3`, 지수 백오프 `300ms * attempt`(`CorrectionAiClient.java:31, 97-129, 271-273`).

| 상황 | 처리 |
| --- | --- |
| HTTP 408 / 409 / 429 / 5xx | 재시도(최대 3회) |
| 에러 메시지에 "timeout" / "temporarily" | 재시도 |
| 진짜 타임아웃(`HttpTimeoutException`) | **재시도 없이 즉시 실패** |
| OpenAI 키 미설정 | 즉시 `INTERNAL_ERROR`(폴백 없음) |

흥미로운 대비: 같은 영역 E의 **결제(Toss confirm)는 정반대로 재시도를 일부러 배제**한다(중복 승인 방지). 첨삭은 멱등하지 않아도 재시도가 안전(같은 입력 재호출일 뿐)하지만, 결제 승인은 재시도가 곧 이중 결제이기 때문이다. "왜 두 클라이언트의 재시도 정책이 정반대냐"는 꼬리질문에 이 멱등성 차이로 답하면 깊이가 산다.

### 4-4. 저장 — 원문은 덮어쓰지 않는다

성공 시 `correction_request`에 새 행을 INSERT한다(`CorrectionService.java:71-83`, `CorrectionMapper.xml`). 핵심 컬럼:

| 컬럼 | 값 |
| --- | --- |
| `correction_type` | `RESUME` |
| `original_text` | 이력서 원문 (MEDIUMTEXT) |
| `improved_text` | 개선문 (MEDIUMTEXT) |
| `result_json` | summary·issues·changeReasons·suggestions를 JSON으로 직렬화 |
| `status` | `SUCCESS` |
| `ai_usage_log_id` | 사용량 로그 FK (SET NULL) |

`correction_request`는 **불변 append-only**다 — 재첨삭하면 UPDATE가 아니라 **새 행**이 쌓인다. FK도 지원 건 삭제 시 `application_case_id`를 SET NULL로 끊어 본문은 보존한다. A 영역(프로필/이력서)의 원본 이력서는 **참조만** 하고 절대 덮어쓰지 않는다 — 확정 반영은 사용자 선택의 몫이다.

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

### 됨 (코드 실재)

- ✅ **이력서 첨삭 백엔드 풀체인**: `POST /api/corrections` (`correctionType=RESUME`)로 OpenAI structured output + 3회 재시도 + 환각 방지 프롬프트 + `result_json` 저장 + 사용량 로그(별도 트랜잭션). 목록·단건 조회(소유자 한정)도 실재.
- ✅ **사용량 로그**: 성공·실패 모두 `ai_usage_log`에 기록. 실패도 `@Transactional(REQUIRES_NEW)`로 독립 커밋되어 감사 흔적 보존.

### 계획 / 미연결 (근거 있는 갭 — 반드시 정직하게)

- ⚠️ **프론트가 정적 플레이스홀더**: `Correction.tsx`의 "이력서 첨삭" 탭은 `api()` 호출 0건이다. 상단에 "첨삭 API 준비 중" 배너가 떠 있고, 실행 버튼은 disabled, 입력/최근기록이 전부 컴포넌트 내부 상수다. 크레딧 단가(`credit: 2`)도 **클라 하드코딩**이라 서버 정책(`default_credit_cost=2`)과 비동기화 상태다(`Correction.tsx:24-29`). 백엔드는 실재하는데 **프론트만 미연결**.
- ⚠️ **실제 크레딧/사용권 차감이 일어나지 않음(★가장 중요)**: 차감 엔진(`CreditService.deductByAiUsageLog`, `AiChargeService.charge`)은 완성·테스트 통과지만, **운영 컨트롤러/서비스 어디에서도 호출되지 않는다**(test 코드에만 호출). 따라서 이력서를 첨삭해도 `ai_usage_log`·`correction_request`만 쌓이고 `users.credit`은 줄지 않는다. `CORRECTION_RESUME`의 `default_credit_cost=2`는 정책으로만 존재하고 차감 지점에 배선되지 않았다.
- ⚠️ **자체 LLM 폴백 미연동**: 설계는 자체 파인튜닝 모델 + 규칙엔진 + OpenAI의 다단 폴백이나, 현 코드는 **OpenAI Responses 단일 경로 + 3회 재시도**다. `CorrectionAiClient`는 폴백 디스패처가 들어갈 진입점으로만 준비됨.
- ⚠️ **이력서 전용 정량지표 강제 로직 없음**: "정량 지표 보강"은 시스템 프롬프트의 지시에 의존하며, 코드에 RESUME 전용 후처리/검증 분기는 없다.

## 6. 면접 답변 3단계

1. **무엇**: "이력서 첨삭은 사용자가 쓴 이력서 원문을 성과 중심 문장·역할 명확화·정량 지표 보강 관점에서 다듬어 주는 기능입니다. 별도 모델이 아니라 첨삭 4종 공통 도메인을 `correctionType=RESUME`으로 분기해 씁니다."
2. **어떻게**: "`CorrectionService.create`가 타입을 검증하고, 지원 건이 연결되면 공통 서비스에 소유권을 위임한 뒤, `CorrectionAiClient`로 OpenAI Responses를 호출합니다. json_schema strict로 출력 모양을 고정하고 3회 재시도를 겁니다. 결과는 `correction_request`에 append-only로 저장하고, 사용량은 별도 트랜잭션으로 항상 로깅합니다."
3. **트레이드오프/한계**: "핵심 설계는 '없는 성과를 지어내지 않는다'입니다. 정량 지표가 원문에 없으면 본문에 숫자를 넣지 않고 `suggestions`로만 안내합니다. 다만 현재 프론트는 플레이스홀더고, 크레딧 차감 엔진은 완성됐지만 실행 경로에 아직 배선되지 않은 상태입니다 — 이건 정직하게 갭으로 말하겠습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 이력서·자소서·포트폴리오 첨삭이 같은 도메인이라고요? 왜 안 쪼갰나요?
입력→처리→출력→저장 흐름이 동일하기 때문입니다. 넷 다 "원문 텍스트 → LLM 개선 → 개선문+근거 → 한 테이블 저장"이라, 모델·서비스·AI 클라이언트·테이블을 각각 1개로 두고 `correctionType` 컬럼 하나로만 분기했습니다. 덕분에 재시도·structured output·환각 가드를 한 곳만 고치면 4종이 동시에 개선되고, 과금도 `benefit_code=CORRECTION` 한 풀을 공유합니다. 비용은 이력서만의 깊은 특화가 어려운 점인데, 현재는 프롬프트 지시 수준의 분기로 충분하다고 판단했습니다.
:::

:::details Q2. "정량 지표 보강"이라면서 AI가 매출 수치를 지어내면 어떻게 막나요?
시스템 프롬프트에 "achievements, metrics, employers, projects를 invent하지 말라"는 가드레일을 박았습니다(`CorrectionPromptCatalog`). 원문에 근거가 없는 수치는 본문(`improvedText`)에 넣지 않고 `suggestions` 배열로만 "이 항목에 처리 건수/개선율을 숫자로 적으면 강해집니다"라고 안내합니다. 사용자가 진짜 수치를 확인해 직접 채우게 하는 구조입니다. 추가로 `changeReasons`를 별도 제공해 사용자가 변경을 검증하고 선택 반영하게 합니다. 원문은 절대 덮어쓰지 않습니다.
:::

:::details Q3. 이력서 첨삭은 크레딧 2를 쓴다는데, 진짜 차감되나요?
정직히 말하면 현재는 차감되지 않습니다. `ai_feature_benefit_policy`에 `CORRECTION_RESUME → default_credit_cost=2` 정책이 seed되어 있고, 크레딧/사용권 차감 엔진(`deductByAiUsageLog`, `consumeByFeature`)도 원자적·멱등하게 완성돼 테스트를 통과합니다. 그런데 이 엔진을 호출하는 지점이 운영 코드에 아직 없습니다(test에서만 호출). 그래서 이력서를 첨삭하면 사용량 로그와 결과 행만 쌓이고 `users.credit`은 그대로입니다. 엔진은 준비됐고 배선만 남은 단계입니다.
:::

:::details Q4. structured output을 안 쓰고 그냥 텍스트로 받으면 안 됐나요?
이력서 첨삭 응답은 개선문·요약·문제·변경이유·제안 5축을 화면에서 따로 렌더해야 합니다. 자유 텍스트로 받으면 매번 파싱이 흔들리고 필드가 빠집니다. 그래서 `json_schema strict` + 전 필드 required + `additionalProperties:false`로 모양을 강제했습니다. 모델이 키를 누락하거나 새 필드를 붙일 수 없고, 파싱 측도 `improvedText`가 비면 즉시 에러로 막습니다. 화면 안정성과 일관성을 코드가 아니라 스키마로 보장한 셈입니다.
:::

:::details Q5. 첨삭은 재시도 3회인데 결제는 재시도를 안 한다고요? 모순 아닌가요?
멱등성 성격이 정반대라 의도한 차이입니다. 첨삭 호출은 같은 입력을 다시 보내도 "또 한 번 다듬는 것"일 뿐 부작용이 없어, 일시적 5xx·429·타임아웃에 강하도록 3회 재시도를 겁니다. 반대로 결제 승인(`TossPaymentClient`)은 재시도가 곧 이중 결제 위험이라, 멱등성을 위해 의도적으로 1회만 호출하고 `Idempotency-Key`로 중복을 막습니다. 같은 영역 E 안에서도 작업 성격에 따라 정책을 정반대로 둔 게 설계 의도입니다.
:::

:::details Q6. 지원 건을 연결한 이력서 첨삭은 다른 사람 지원 건을 훔쳐볼 수 없나요?
`applicationCaseId`가 들어오면 E가 직접 소유권을 판단하지 않고 `applicationCaseAccessService.requireOwned(userId, id)`로 공통 서비스에 위임합니다(`CorrectionService.java:50-52`). 소유자가 아니면 거기서 막힙니다. 통과하면 그 지원 건의 회사명·직무만 LLM 컨텍스트로 주입해 "이 회사·직무에 맞춰" 다듬게 합니다. 지원 건 소유권 판단은 영역 간 공통 관심사라 E가 중복 구현하지 않고 위임하는 게 경계 원칙입니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 30초씩 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 이력서 첨삭이 자소서·포트폴리오 첨삭과 **같은 도메인**인 이유와, 그 분기점(`correctionType=RESUME`, `featureType=CORRECTION_RESUME`).
2. "정량 지표 보강"을 시키면서도 **환각을 막는** 방법 — 본문 대신 `suggestions`로 빼는 설계와 `changeReasons`의 역할.
3. `CorrectionAiClient`의 **structured output + 3회 재시도**가 무엇을 보장하는지, 그리고 결제 재시도 정책과 왜 정반대인지.
4. 첨삭을 한 번 하면 DB에 무엇이 남는지(`correction_request` append-only), 그리고 **크레딧이 실제로는 차감되지 않는** 현재 갭.

## 퀴즈

<QuizBox question="이력서 첨삭(#26)이 자소서·면접답변·포트폴리오 첨삭과 코드상 구분되는 핵심 지점은?" :choices="['이력서 전용 ResumeAiClient와 별도 테이블을 쓴다', '단일 correction 도메인에서 correctionType=RESUME 분기 하나로만 구분된다', '이력서만 OpenAI를 쓰고 나머지는 자체 LLM을 쓴다', '이력서는 application_case 없이는 호출할 수 없다']" :answer="1" explanation="첨삭 4종은 단일 correction 도메인 + 단일 AI 클라이언트를 공유하고, correctionType(SELF_INTRO/INTERVIEW_ANSWER/RESUME/PORTFOLIO)으로만 분기합니다. 이력서는 featureType=CORRECTION_RESUME 키로 식별될 뿐 전용 클래스가 없습니다." />

<QuizBox question="이력서에 없는 정량 지표(예: 매출 30% 상승)를 AI가 다룰 때 코드/프롬프트가 의도한 동작은?" :choices="['improvedText 본문에 그럴듯한 숫자를 채워 넣는다', '원문에 근거가 없으면 본문이 아니라 suggestions로만 안내한다', '숫자가 없으면 첨삭을 거부하고 에러를 던진다', 'changeReasons에 임의 추정 수치를 적는다']" :answer="1" explanation="시스템 프롬프트가 metrics/achievements를 invent하지 못하게 막습니다. 근거 없는 수치는 본문에 넣지 않고 suggestions(제안)로만 빼서, 사용자가 진짜 값을 확인해 직접 채우게 합니다. 채용 사기 리스크를 막는 원문 보존형 설계입니다." />

<QuizBox question="이력서 첨삭의 default_credit_cost=2 정책과 실제 차감의 관계를 옳게 설명한 것은?" :choices="['첨삭할 때마다 users.credit에서 2가 자동 차감된다', '정책과 차감 엔진은 완성됐지만 운영 실행 경로에 배선되지 않아 실제 차감은 일어나지 않는다', '크레딧은 프론트에서 차감하고 서버는 기록만 한다', '이력서는 무료라 크레딧 정책이 없다']" :answer="1" explanation="ai_feature_benefit_policy에 CORRECTION_RESUME→2가 seed되어 있고 차감 엔진(deductByAiUsageLog 등)도 테스트를 통과하지만, 운영 코드에서 호출되지 않습니다(test에만 존재). 그래서 첨삭 시 사용량 로그·결과 행만 쌓이고 잔액은 줄지 않는 미배선 상태입니다." />
