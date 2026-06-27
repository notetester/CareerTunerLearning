# 크레딧 · AI 사용량 전사 흐름

> 6개 영역(A~F)의 모든 AI 호출은 결국 한 줄로 모인다 — `ai_usage_log` 한 행. 그 행을 단일 근거로 크레딧이 차감되고, E 영역의 사용량 대시보드가 전사를 집계하며, 요금제(`plan`)가 무료/유료 한도를 가른다. "비용을 보이게 하고, 성공한 호출에만 돈을 매기고, 명시적 재생성만 청구한다"가 한 문장 요약이다.

이 페이지는 **흐름(flow)** 문서다. 크레딧/사용량의 영역 내부 구현(장부 설계, 결제, 게이팅 화면)은 [영역 E 크레딧 시스템](/area-e/credit-system)·[사용량 대시보드](/area-e/usage-dashboard)·[요금제 게이팅](/area-e/plan-gating)에 상세히 있다. 여기서는 **"A~F가 어떻게 한 과금 척추(spine)로 연결되는가"** 만 다룬다.

## 1. 이 흐름이 답하는 면접 질문

- "AI 기능이 6개 영역에 흩어져 있는데, 사용량과 과금을 어떻게 한곳에서 통제합니까?"
- "크레딧은 정확히 언제 빠집니까? 호출이 실패하면, 또는 같은 요청이 두 번 오면 어떻게 됩니까?"
- "무료 사용자와 유료 사용자의 차이를 코드 어디서 가릅니까?"
- "적합도(C)처럼 결과를 캐시하는 기능은, 화면을 다시 봐도 매번 돈이 빠집니까?"
- "사용량 표시와 실제 차감이 어긋나지 않는다는 보장은 어디서 옵니까?"

:::tip 이 흐름의 핵심 한 문장
**모든 영역이 같은 `ai_usage_log` 행을 보고, 그 행을 근거로만 `credit_transaction`에 차감을 남긴다.** 표시·과금·감사가 같은 진실 원천(source of truth)을 공유하므로 구조적으로 어긋날 수 없다.
:::

## 2. 전체 그림 (표 · 아스키 흐름도)

각 영역은 자기 AI를 호출하지만, 사용량 기록 규약과 과금 척추는 공통이다. E가 **과금/사용량의 책임 영역**이고, `ai_usage_log` 스키마 자체는 공통 영역(팀장 소유)이다.

| 단계 | 무엇 | 어느 영역 | 대표 클래스/테이블 |
| --- | --- | --- | --- |
| ① 호출 | 영역별 AI 서비스가 LLM 호출 | A~F 각자 | `fitAnalysisAiService`, `interviewService`, `correctionService` 등 |
| ② 기록 | 성공/실패를 한 줄 적재(별도 트랜잭션) | 각 영역 기록기 | `ai_usage_log` (공통 스키마) |
| ③ 정책 | 사용권(ticket) 우선 → 크레딧 폴백 결정 | E(과금) | `AiChargeServiceImpl`, `ai_feature_benefit_policy` |
| ④ 차감 | 성공 로그 근거 멱등·원자 차감 | E(크레딧) | `CreditServiceImpl`, `credit_transaction` |
| ⑤ 집계 | 기능별 월 사용량 가시화 | E(대시보드) | `BillingMapper.monthlyUsage`, `UsageRow` |
| ⑥ 게이팅 | 요금제별 한도/포함 여부 | E(요금제) | `subscription_plan`, `subscription_benefit_policy` |

```text
A 프로필   B 공고/기업   C 적합도   D 면접   E 첨삭   F 커뮤니티
  AI #1-5    AI #6-11    #12-18   #19-23  #24-28   #29-34
   │           │           │        │       │        │
   └─────┬─────┴─────┬─────┴────┬───┴───┬───┴────┬───┘
         ▼           ▼          ▼       ▼        ▼
   ┌──────────────────────────────────────────────────┐
   │  ai_usage_log  (호출 1건 = 1행, status/model/token) │  ← 공통 스키마(팀장)
   └──────────────────────────────────────────────────┘
         │  status=SUCCESS 인 행만
         ▼
   ┌─────────────────────────────┐     ┌─────────────────────────┐
   │ AiChargeService             │     │ 요금제 게이팅            │
   │  ① 사용권(ticket) 소진       │◀────│ subscription_plan +     │
   │  ② 없으면 크레딧 폴백        │     │ benefit_policy(한도)    │
   └─────────────┬───────────────┘     └─────────────────────────┘
                 ▼
   ┌─────────────────────────────┐
   │ CreditService.deduct        │  WHERE credit >= X  (원자)
   │  → credit_transaction(AI_USAGE, -amount)  UNIQUE(log_id,type) (멱등)
   └─────────────┬───────────────┘
                 ▼
   ┌─────────────────────────────┐
   │ E 사용량 대시보드 (집계)     │  GROUP BY feature_type
   │ Billing usage 탭 / 관리자    │
   └─────────────────────────────┘
```

핵심은 **세로축이 단 하나**라는 점이다. 여섯 영역이 가로로 늘어서 있어도, 사용량과 돈은 가운데 한 줄(`ai_usage_log`)로 수렴한 뒤 E의 과금 척추를 탄다.

## 3. 단계별 상세 (무엇을 받아 무엇을 넘기나)

### ① 호출 — 영역별 AI가 각자 LLM을 부른다

각 영역은 자기 도메인 서비스에서 LLM을 호출한다. 사용량/과금 관점에서 중요한 건 호출 그 자체가 아니라 **호출이 끝나고 무엇을 기록하느냐**다. 호출의 폴백 체인(자체 OSS → Claude Haiku → OpenAI → Mock)은 [AI 공급자·폴백 전략](/flow/ai-providers-fallback)에서 다루고, 여기서는 그 결과(성공/실패·토큰·모델)만 받는다.

### ② 기록 — 성공도 실패도 한 줄, 단 별도 트랜잭션

각 영역에는 전용 기록기가 있다(`InterviewAiUsageLogService`, `CorrectionAiUsageLogService`, 적합도는 `FitAnalysisServiceImpl.insertAiUsageLog` 등). **공통 단일 서비스가 아니라 영역별 기록기이고, 공유되는 것은 `ai_usage_log` 스키마뿐**이다. 두 가지 설계가 일관된다.

- **별도 트랜잭션(`REQUIRES_NEW`)**: AI 호출이 실패해 본 작업이 롤백돼도, "이 호출이 발생했다"는 사실은 독립적으로 커밋된다. 그래서 대시보드는 성공뿐 아니라 실패율까지 본다.
- **최종 성공 모델만 기록**: 폴백이 두 번 일어나도 `model` 컬럼엔 실제로 응답한 모델 하나만 남고, 폴백 횟수는 애플리케이션 로그 warn에만 남긴다.

`ai_usage_log` 의 과금 관련 컬럼(`schema.sql:801`):

| 컬럼 | 의미 |
| --- | --- |
| `feature_type` | 어느 AI 기능인지(`FIT_ANALYSIS`, `INTERVIEW_QUESTION_GEN`, `CORRECTION_SELF_INTRO` 등) |
| `status` | `SUCCESS` / `FAILED` / `FALLBACK` (기본 `SUCCESS`) — **차감 게이트의 기준** |
| `model` | 실제 응답한 모델 |
| `input_tokens` / `output_tokens` / `token_usage` | 토큰 척도(원가) |
| `credit_used` | 환산 크레딧(정가). 토큰을 `max(1, ceil(tok/1000))` 로 올림하거나 기능별 seed 값 사용 |

### ③ 정책 — 사용권 우선, 없으면 크레딧 폴백

`AiChargeServiceImpl.charge()`(E)가 "이 호출에 어떤 지불 수단을 쓸지"를 결정한다. 순서가 코드에 그대로 박혀 있다.

```text
1. ai_feature_benefit_policy(feature_type) 조회
   - 정책 없음 / 사용권 미포함  →  바로 크레딧 차감 시도
2. 사용권 포함이면 consumeByFeature() 로 ticket 소진 시도
   - 소진 성공     → AiChargeResult.ticket(남은수량)
   - 이미 소비됨   → skipped(ALREADY_CHARGED)   ← 멱등
3. 사용권 부족/소진 + overagePolicy ∈ {CREDIT, FALLBACK_CREDIT}
   → 크레딧으로 폴백
4. 폴백 불가  →  INSUFFICIENT_CREDIT (402)
```

이 분리가 핵심이다. **"어떤 수단으로 낼지"(정책)는 E의 `AiChargeService`가, "실제로 얼마를 뺄지"(차감)는 E의 `CreditService`가** 단일 책임으로 나눠 갖는다. 영역 A~F는 둘 다 모르고 그냥 자기 AI만 호출한다.

### ④ 차감 — 성공 로그만, 원자적이고 멱등하게

`CreditServiceImpl.deductByAiUsageLog()`(`CreditServiceImpl.java:38-90`)의 가드가 전사 과금 안전 불변식이다.

| 단계 | 분기 | 결과 |
| --- | --- | --- |
| 1 | 로그 없음 | `NOT_FOUND` 예외 |
| 2 | `status != SUCCESS` | skip(`NOT_SUCCESS`) — **실패 호출은 무료** |
| 3 | 이미 차감됨 | skip(`ALREADY_DEDUCTED`) — **멱등** |
| 4 | `creditUsed ≤ 0` | skip(`NO_CREDIT_USED`) |
| 5 | 잔액 부족 | `INSUFFICIENT_CREDIT` 예외(402) |
| 6 | 정상 | 조건부 UPDATE 차감 + `credit_transaction` 원장 INSERT |

5단계의 조건부 UPDATE 한 문장이 락 없이 음수 잔액과 동시성을 동시에 막는다.

```sql
UPDATE users SET credit = credit - #{creditUsed}
 WHERE id = #{userId} AND credit >= #{creditUsed}
```

영향 행이 0이면 잔액 부족이고, 그때 `INSUFFICIENT_CREDIT`을 던진다. 멱등은 두 겹이다 — 애플리케이션이 `existsTransactionByAiUsageLogIdAndType`로 선검사하고, DB가 `credit_transaction`의 `UNIQUE(ai_usage_log_id, type)`로 최후를 막는다. 부호 규약은 **충전(`CHARGE`)·환불(`REFUND`) 양수, AI 사용(`AI_USAGE`) 음수**다. 장부 설계 상세는 [크레딧 시스템](/area-e/credit-system) 참고.

### ⑤ 집계 — 한 테이블을 GROUP BY 하면 전사 사용량

영역이 6개여도 사용량 집계 코드는 한 벌이다. `BillingMapper.monthlyUsage`가 `WHERE user_id, created_at >= 달1일`로 자르고 `GROUP BY feature_type`으로 호출 횟수·크레딧 합을 낸다. 새 AI 기능은 `feature_type` 문자열만 추가하면 자동으로 대시보드에 잡힌다. 화면 본체는 결제 화면의 usage 탭이다 → [사용량 대시보드](/area-e/usage-dashboard).

### ⑥ 게이팅 — 요금제가 무료/유료 한도를 가른다

무료/유료 차이는 `subscription_plan`(FREE/BASIC/PRO/PREMIUM)과 `subscription_benefit_policy`(플랜별 사용권 수량)로 표현한다. 같은 `feature_type`이라도 플랜에 따라 사용권에 포함될 수도, 크레딧으로만 가능할 수도 있다. 예컨대 오케스트레이터의 첨부 게이팅은 `FREE/BASIC` 1개·`PRO/PREMIUM` 5개로 갈린다([AI 오케스트레이터](/flow/ai-orchestrator) 참고). 요금제 게이팅 화면/정책은 [요금제 게이팅](/area-e/plan-gating)에 상세하다.

## 4. 설계 포인트 (왜 이렇게 연결했나)

### 4-1. 왜 한 테이블로 모았나 — 표시와 과금의 정합

영역마다 사용량 테이블을 따로 두면 "이 사용자가 이번 달 AI를 얼마나 썼나"를 6개 테이블 join으로 풀어야 하고, **화면에 보이는 숫자와 실제 빠진 돈이 다른 데이터를 보게 되어 어긋날 수 있다.** 같은 `ai_usage_log` 행을 표시·과금·감사가 함께 보면 그 모순이 구조적으로 불가능하다.

### 4-2. 왜 성공 기준 차감인가 — 사용자 보호

차감 게이트가 `status='SUCCESS'`인 이유는 단순하다. LLM이 죽거나 폴백이 다 실패한 호출에 돈을 매기면 사용자가 손해를 본다. 실패 로그(`FAILED`, `credit_used=0`)는 감사·실패율 추적용으로 남기되 차감 2단계에서 즉시 skip한다. 적합도(C)도 동일하게 `creditUsed = "SUCCESS".equals(status) ? MOCK_CREDIT : 0`(`FitAnalysisServiceImpl.java:135`)로 처리한다.

### 4-3. 왜 명시적 재생성만 차감인가 — C 캐시 경계

적합도 같은 무거운 분석은 입력이 같으면 결과를 재사용한다. C는 `input_fingerprint`/`source_snapshot`으로 입력을 동결·캐싱해, **사용자가 화면을 다시 열어도 새 LLM 호출이 일어나지 않으면 `ai_usage_log` 행 자체가 안 생긴다.** 차감은 로그를 근거로만 일어나므로, 행이 없으면 돈도 안 빠진다. 즉 **"다시 보기"는 무료, "다시 생성하기(명시적 재분석)"만 과금**이다. 캐시·동결 메커니즘은 [적합도 분석](/area-c/fit-analysis)에 상세하다.

:::warning 흔한 오해 — "화면을 볼 때마다 차감된다"
아니다. 차감의 단일 근거는 새로 적재된 `ai_usage_log` 행이다. 캐시 히트(재생성 없는 조회)는 로그를 만들지 않으므로 과금 트리거가 없다. 비싼 AI를 의도적으로 다시 돌릴 때만 새 행 → 새 차감이 발생한다.
:::

### 4-4. 왜 점수·비용 산정을 LLM에 안 맡기나 — 뉴로-심볼릭

크레딧 금액과 적합도 신뢰도 같은 "숫자/판단"은 LLM이 아니라 서버 규칙이 확정한다. 차감액은 토큰 환산식 또는 `ai_feature_benefit_policy`의 seed 비용에서 나오고, 적합도 신뢰도는 "AI 판단이 아니라 입력 상태 기반의 결정적 계산"(`FitAnalysisServiceImpl.java:84`)이다. 모델은 자연어 생성만, 돈·점수·분류는 결정적 코드가 소유한다.

## 5. 구현 상태 (됨 vs 계획) — 정직한 구분

| 항목 | 상태 |
| --- | --- |
| `ai_usage_log` 적재(성공/실패, `REQUIRES_NEW`) | 구현 — 영역별 기록기에서 호출 |
| `ai_feature_benefit_policy` 비용 seed | 구현 — `schema.sql:1046-1059` |
| `AiChargeServiceImpl`(사용권 우선 → 크레딧 폴백) | 구현·단위 테스트 통과 |
| `CreditServiceImpl` 차감(성공 기준·원자·멱등) | 구현·단위 테스트 통과 |
| `BillingMapper.monthlyUsage` 월 집계 + usage 탭 | 구현 — 사용자 대시보드 연동 |
| 요금제/플랜 게이팅(`subscription_plan` 등) | 구현 |
| **AI 실행 → 차감 호출 배선** | **미연결** — 차감 엔진/과금 정책이 운영 경로에서 호출되지 않음(현재 테스트에서만) |
| 사용량 기반 요금제 추천(#28) | 미구현 — 정책 seed만 존재 |
| 통합 관리자 사용량 콘솔 | 부분 — 관리자 화면은 B 4종 필터 전용, E 전사 콘솔 미완 |
| `REFUND` / `ADMIN_ADJUST` | 스키마·타입만, 코드 경로 없음 |

:::warning 가장 중요한 사실 — "본다 ≠ 빠진다"
차감 엔진(`CreditService.deduct`)과 과금 정책(`AiChargeService.charge`)은 **완성·검증됐지만 아직 실제 AI 실행 경로에 배선되지 않았다.** 따라서 현재는 `ai_usage_log`(와 각 영역 결과 테이블)만 쌓이고, `users.credit` 은 실제로 줄지 않는다. 대시보드의 `credit_used` 합은 "차감했다면 이만큼"의 예상치에 가깝다. 면접에서는 이 갭을 숨기지 말고 **"엔진은 완성·테스트 통과, 호출 지점만 연결하면 동작한다"** 로 정직하게 설명하는 편이 신뢰를 준다.
:::

## 6. 면접 답변 (전체를 흐름으로 설명)

**1단계 (한 문장):**
"6개 영역에 흩어진 AI 호출이 모두 `ai_usage_log` 한 테이블에 1건=1행으로 쌓이고, E 영역이 그 로그를 단일 근거로 성공한 호출에만 크레딧을 원자적·멱등하게 차감하며, 요금제로 무료/유료 한도를 가릅니다."

**2단계 (구조):**
"영역마다 자기 AI를 호출하지만 기록 규약과 과금 척추는 공통입니다. 호출 직후 별도 트랜잭션으로 성공/실패를 로그에 남기고(실패도 감사용으로 보존), `AiChargeService`가 사용권을 먼저 소진하다 부족하면 크레딧으로 폴백하며, `CreditService`가 `WHERE credit >= X` 조건부 UPDATE로 차감한 뒤 `credit_transaction` 원장에 음수 행을 남깁니다. 차감 게이트가 `status='SUCCESS'`라 실패 호출은 무료이고, `(ai_usage_log_id, type)` 유니크로 중복 차감을 막아 멱등합니다. 표시·과금이 같은 행을 보므로 어긋날 수 없습니다."

**3단계 (경계·정직):**
"적합도처럼 캐시되는 기능은 입력 지문으로 동결해, 다시 보기는 무료이고 명시적 재생성만 새 로그 → 새 차감을 만듭니다. 비용 금액과 점수는 LLM이 아니라 서버 규칙이 확정합니다. 다만 현재는 차감 엔진과 과금 정책이 완성·테스트는 됐지만 실제 실행 경로에 배선 전이라 로그만 쌓이고 잔액은 아직 줄지 않습니다 — 호출 지점만 연결하면 동작하는 상태입니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. AI가 6개 영역에 흩어져 있는데 사용량을 어떻게 한곳에서 봅니까?
모든 영역의 AI 호출이 `ai_usage_log` 한 테이블에 1건=1행으로 기록되기 때문입니다. 영역마다 로그 테이블을 따로 두지 않고, 첨삭(E)조차 `applicationcase` 도메인의 `AiUsageLog`를 재사용해 같은 테이블에 씁니다. 그래서 집계는 `GROUP BY feature_type` 한 번이면 끝나고, 영역이 늘어도 집계 코드는 바뀌지 않습니다. 새 기능은 `feature_type` 문자열만 추가하면 자동으로 잡힙니다.
:::

:::details Q2. 크레딧은 정확히 언제 빠집니까? 호출이 실패하면요?
차감의 단일 근거는 `ai_usage_log` 한 행이고, 그 행의 `status='SUCCESS'`일 때만 빠집니다. 실패한 호출은 `status='FAILED'`, `credit_used=0`으로 로그는 남기되 차감 엔진이 `NOT_SUCCESS`로 즉시 건너뜁니다. 실패 로그를 남기는 이유는 관리자 통계에서 실패율과 원인을 추적하기 위해서고, 사용자는 성공한 호출에 대해서만 비용을 냅니다.
:::

:::details Q3. 같은 요청이 두 번 오거나 재시도되면 두 번 빠지나요?
이중 멱등으로 막습니다. 차감 전 애플리케이션이 `credit_transaction`에 해당 `ai_usage_log_id` + `AI_USAGE` 행이 이미 있는지 EXISTS로 선검사해 있으면 `ALREADY_DEDUCTED`로 skip하고, 경합으로 둘 다 통과해도 DB의 `UNIQUE(ai_usage_log_id, type)`가 두 번째 INSERT를 거부합니다. 사용권 경로도 `consumeByFeature`가 `ALREADY_CHARGED`로 같은 보호를 합니다.
:::

:::details Q4. 적합도 화면을 다시 열면 매번 돈이 빠집니까?
아닙니다. 적합도는 `input_fingerprint`/`source_snapshot`으로 입력을 동결·캐싱해, 입력이 같으면 새 LLM 호출을 하지 않습니다. 호출이 없으면 `ai_usage_log` 행이 안 생기고, 차감은 로그를 근거로만 일어나므로 과금 트리거가 없습니다. 즉 "다시 보기"는 무료이고, 입력이 바뀌었거나 사용자가 명시적으로 재분석을 누른 경우에만 새 행과 새 차감이 발생합니다.
:::

:::details Q5. 무료 사용자와 유료 사용자 차이는 코드 어디서 갈립니까?
`subscription_plan`(FREE/BASIC/PRO/PREMIUM)과 `subscription_benefit_policy`(플랜별 사용권 수량), 그리고 `ai_feature_benefit_policy`(기능→사용권그룹·포함 여부·기본 크레딧 비용)에서 갈립니다. `AiChargeService`가 이 정책들을 읽어 "사용권으로 낼지, 크레딧으로 낼지, 못 내는지"를 결정합니다. 첨부 개수처럼 화면 단의 게이팅도 플랜으로 갈립니다(무료/베이직 1개, 프로/프리미엄 5개).
:::

:::details Q6. 동시 요청에서 잔액이 음수가 되지 않는다는 보장은 어디서 옵니까?
읽고-비교하고-쓰는 3단계가 아니라 `UPDATE users SET credit = credit - ? WHERE id = ? AND credit >= ?` 한 문장으로 처리합니다. DB가 행 잠금으로 직렬화하므로 "충분할 때만 차감"이 원자적으로 보장되고, 영향 행 수가 0이면 부족으로 판단해 `INSUFFICIENT_CREDIT`(402)을 던집니다. 애플리케이션 락이나 분산락 없이 DB 한 문장으로 동시성을 막은 것이 핵심입니다.
:::

:::details Q7. 표시되는 사용량 크레딧만큼 실제 잔액이 줄어듭니까?
현재는 줄지 않습니다. `credit_used` 합은 `ai_usage_log`의 값일 뿐이고, 실제 차감을 수행하는 `deductByAiUsageLog`/`AiChargeService.charge`가 운영 경로에 아직 배선되지 않았습니다(테스트에서만 호출). 엔진 자체는 원자·멱등으로 완성·검증돼 있어 호출 지점만 연결하면 동작합니다. 그래서 지금 대시보드 숫자는 "차감했다면 이만큼"의 예상치 성격입니다 — 이 점을 정직하게 말하는 게 맞습니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 1~2분 안에 설명할 수 있으면 이 흐름은 통과다.

1. 화이트보드에 `A~F 각 AI → ai_usage_log → AiChargeService → CreditService → credit_transaction → 대시보드` 척추를 그리고, "표시와 과금이 어긋나지 않는 이유"를 한 문장으로.
2. 차감이 일어나는 4조건(로그 존재·SUCCESS·미차감·잔액 충분)과 각 실패 시 결과(예외 vs skip)를 구분해서.
3. 멱등을 두 층(애플리케이션 EXISTS + DB 유니크), 동시성을 한 문장(`WHERE credit >= X`)으로 막은 설계를 각각.
4. "적합도 다시 보기는 무료, 명시적 재생성만 과금"인 이유를 캐시/지문 개념으로.
5. "엔진은 완성·테스트, 실행 경로 배선은 미완"이라는 현재 상태를 숨기지 않고 한 문장으로.

관련 페이지: [크레딧 시스템](/area-e/credit-system) · [사용량 대시보드](/area-e/usage-dashboard) · [요금제 게이팅](/area-e/plan-gating) · [적합도 분석](/area-c/fit-analysis) · [AI 공급자·폴백 전략](/flow/ai-providers-fallback) · [AI 기능 #1-34 맵](/flow/ai-function-map) · [데이터 소유권 경계 맵](/flow/data-ownership)

## 퀴즈

<QuizBox question="6개 영역에 흩어진 AI 호출의 사용량·과금이 한곳으로 모이는 단일 근거 테이블은?" :choices="['credit_transaction', 'ai_usage_log', 'subscription_plan', 'application_case']" :answer="1" explanation="모든 영역의 AI 호출이 ai_usage_log 한 테이블에 1건=1행으로 쌓이고, 표시(집계)·과금(차감)·감사가 같은 행을 본다. 이 단일 근거 덕분에 화면 숫자와 실제 차감이 구조적으로 어긋날 수 없다. credit_transaction은 그 결과로 남는 원장이다." />

<QuizBox question="크레딧 차감(AI_USAGE)이 실제로 일어나는 기준으로 옳은 것은?" :choices="['사용자가 기능 버튼을 누른 순간 무조건', 'LLM에 요청을 전송한 순간', 'ai_usage_log의 status가 SUCCESS인 경우에만', '결제가 완료된 순간']" :answer="2" explanation="차감의 단일 근거는 ai_usage_log 한 행이고 status=SUCCESS일 때만 빠진다. 실패 호출은 status=FAILED·credit_used=0으로 남아 감사용으로 보존되되 NOT_SUCCESS로 skip된다. 실패는 무료라는 사용자 보호 원칙이다." />

<QuizBox question="적합도(C)처럼 결과를 캐시하는 기능에서, 입력이 같은데 화면을 다시 열 때 크레딧이 안 빠지는 이유를 설명하라." explanation="적합도는 input_fingerprint/source_snapshot으로 입력을 동결·캐싱하므로, 입력이 같으면 새 LLM 호출을 하지 않는다. 호출이 없으면 ai_usage_log 행이 새로 생기지 않고, 차감은 로그를 단일 근거로만 일어나므로 과금 트리거 자체가 없다. 따라서 다시 보기는 무료이고, 입력이 바뀌었거나 사용자가 명시적으로 재분석을 실행한 경우에만 새 로그 → 새 차감이 발생한다. 즉 다시 보기 무료, 명시적 재생성만 과금이다." />
