# 영역 E 개요 — 첨삭 · 결제 · 크레딧

> 영역 E는 성격이 다른 두 축을 한 영역에 묶는다. **축 1 — 첨삭**: 사용자가 이미 쓴 글(자소서·이력서·면접 답변·포트폴리오 설명)을 *실제 지원에 맞게 다듬는* AI 콘텐츠 개선. **축 2 — 과금 인프라**: 모든 영역의 AI 기능이 의존하는 결제·구독·크레딧·사용권 공통 토대. 이 영역의 설계 정체성은 두 가지로 요약된다 — **"원문을 날조하지 않는다(원문 보존형 첨삭)"** 와 **"잔액을 직접 만지지 않고 원장(ledger)으로 기록한다(감사 가능한 과금)"**.

---

## 1. 영역 E의 정체성 — 한 문장으로

영역 E는 **"사용자 작성물을 지원에 맞게 다듬는 첨삭"** 과 **"AI 사용에 필요한 결제·크레딧·사용량 흐름"** 을 함께 책임지는 영역이다(`docs/TEAM_WORK_DISTRIBUTION.md` 8장). 한 영역 안에 콘텐츠 생성 축과 인프라 축이 공존한다는 점이 다른 영역과 다르다.

:::tip 이 페이지가 답하는 면접 질문
"영역 E가 정확히 뭘 하나요?" / "첨삭 4종을 어떻게 한 도메인으로 묶었나요?" / "왜 첨삭은 원문을 덮어쓰지 않나요?" / "결제·크레딧·사용권은 어떻게 분리돼 있나요?" / "AI 쓰면 크레딧이 실제로 깎이나요?"
이 개요만 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

### 두 축을 한 문장씩

- **첨삭(축 1):** 면접 답변·자소서·이력서·포트폴리오 설명을 **하나의 `correction` 도메인 + 하나의 AI 클라이언트**로 처리하고, `correctionType`(SELF_INTRO / INTERVIEW_ANSWER / RESUME / PORTFOLIO)으로만 분기한다. OpenAI Responses API의 구조화 출력(json_schema strict)으로 항상 같은 모양의 결과를 받는다.
- **과금(축 2):** Toss 결제(2단계 ready/confirm) + DEV 즉시결제 + 크레딧 원장 + 기간별 사용권(티켓) + 정책 스냅샷·예약변경. 이 축은 A/B/C/D의 모든 AI 기능이 기대는 **전사 공통 과금 엔진**이라, 실질 코어는 `billing` 도메인에 집약돼 있다.

---

## 2. 담당 AI 기능 — #24 ~ #28

영역 E가 소유한 AI 기능은 5개다. 첨삭 4종(#24~#27)은 별도 모델·별도 흐름이 아니라 **단일 통합 모델 1개**로 구현되고, #28만 성격이 다른 추천 기능이다.

| # | 기능 | featureType | 엔트리 | 크레딧(메타) | 한 줄 |
| --- | --- | --- | --- | --- | --- |
| 24 | 면접 답변 첨삭 | `CORRECTION_INTERVIEW_ANSWER` | `POST /api/corrections` | 1 | 답변 구조·근거·STAR·구체성 개선 |
| 25 | 자기소개서 첨삭 | `CORRECTION_SELF_INTRO` | `POST /api/corrections` | 2 | 문장 흐름·직무 연관성·강점 표현·중복 제거 |
| 26 | 이력서 표현 개선 | `CORRECTION_RESUME` | `POST /api/corrections` | 2 | 성과 중심 문장·역할 명확화·정량 지표 보강 |
| 27 | 포트폴리오 설명 개선 | `CORRECTION_PORTFOLIO` | `POST /api/corrections` | 2 | 문제 해결 과정·기술 선택 이유·결과 표현 개선 |
| 28 | 사용량 기반 요금제 추천 | `USAGE_PLAN_RECOMMENDATION` | (미구현) | — | 사용량·잔액·패턴 → 요금제/충전 안내 |

:::warning 정직한 구분
- **#24~#27 백엔드는 실재**한다 — `POST /api/corrections` 생성, `GET /api/corrections` 목록, `GET /api/corrections/{id}` 단건이 동작한다. 다만 프론트 `Correction.tsx`는 **"첨삭 API 준비 중" 배너가 달린 정적 플레이스홀더**(버튼 disabled, `api()` 호출 0건)라 화면에서는 아직 실행되지 않는다.
- **#28은 정책 seed row만 존재**하고 추천을 산출하는 서비스/컨트롤러가 없다. 추천 재료 데이터(이번 달 사용량·플랜·잔여 사용권)는 모두 준비됐지만 묶는 코드가 없는, "설계됨·데이터 준비됨·산출 로직 미구현" 상태다.
- 위 표의 **크레딧 값은 프론트(`Correction.tsx`)에 하드코딩된 표시용 상수**다. 서버 정책(`ai_feature_benefit_policy`)과 비동기화 상태이며, 실제 차감은 현재 어느 경로에서도 일어나지 않는다(아래 4절).
:::

---

## 3. 첨삭의 핵심 원칙 — "원문을 날조하지 않는다"

영역 E에서 가장 중요한 단 하나의 원칙이다. 첨삭은 채용에 직접 쓰이는 글을 손대므로, 없는 성과·수치·경력을 지어내면 곧바로 채용 리스크가 된다. 그래서 시스템 프롬프트(`CorrectionPromptCatalog.SYSTEM_PROMPT`)에 가드레일이 박혀 있다.

```text
Improve only the user's existing material...
Do not invent achievements, metrics, employers, projects, or experiences.
If a stronger sentence needs missing evidence,
keep it as a suggestion instead of adding false facts.
```

이 원칙이 구현으로 이어지는 방식:

- **원문 비파괴:** 첨삭은 원본(A 영역 자소서·이력서 등)을 덮어쓰지 않는다. 새 결과 행(`correction_request`)을 append-only로 쌓고, 확정 반영은 사용자의 선택으로만 처리한다.
- **근거 없으면 제안으로:** 더 강한 문장이 빠진 근거를 필요로 하면, 본문에 끼워 넣지 않고 `suggestions`로만 돌린다.
- **변경 이유 노출:** 결과에 `changeReasons`(왜 바꿨는지)를 별도로 담아, 사용자가 검증하고 받아들일지 직접 고르게 한다.

즉 첨삭은 "더 잘 써주는 도구"가 아니라 **"있는 사실을 더 잘 표현하게 돕는 도구"** 로 의도적으로 좁혀져 있다. 그래서 더미 응답을 주는 mock/룰베이스 폴백을 일부러 두지 않았다 — 사실 생성 책임이 무거운 작업에 가짜 결과가 오히려 위험하기 때문이다(OpenAI 키 없으면 첨삭 자체가 불가).

---

## 4. 과금의 핵심 정체성 — 원장·인스턴스·"결제는 잔액을 만들지 않는다"

과금 축(`billing`/`payment`/`credit`)은 세 가지 설계 결정으로 요약된다.

| 결정 | 의미 | 효과 |
| --- | --- | --- |
| **원장(ledger) 분리** | 잔액을 직접 갱신하지 않고 변동분+변동후잔액을 행으로 기록(`credit_transaction`, `benefit_transaction`) | 모든 차감/충전이 감사 추적 가능 |
| **마스터-인스턴스 분리** | 카탈로그(`subscription_plan`/`credit_product`/`benefit_catalog`)=마스터, 구매·구독·잔량(`payment`/`user_subscription`/`user_benefit_balance`)=인스턴스 | 정책 변경이 기존 구매자를 건드리지 않음 |
| **정책의 데이터화** | 가격·혜택을 코드가 아닌 테이블로 관리 + `policy_snapshot_json`으로 가입 시점 동결 | 코드 배포 없이 DML로 정책 변경, 소급 적용 없음 |

핵심 문장 하나: **"결제 도메인은 잔액을 직접 만들지 않는다."** Toss confirm(또는 DEV 결제)이 끝나면 후처리를 `billingService.grantCreditsAfterPayment` / `activateSubscriptionAfterPayment`에 위임하고, 실제 크레딧·사용권 지급은 그 공통 메서드가 원장에 기록한다.

:::warning 이 영역에서 가장 중요한 "미연결" 사실
차감 엔진(`AiChargeService.charge` / `consumeByFeature` / `deductByAiUsageLog`)은 **원자적·멱등하게 완성되어 단위 테스트를 통과**하지만, 운영 컨트롤러/서비스 어디에서도 호출되지 않는다(호출처가 모두 `src/test`에만 존재). 결과적으로 첨삭을 포함한 AI 기능을 실행하면 `ai_usage_log`와 결과 행만 쌓이고 **`users.credit`·`user_benefit_balance`는 실제로 차감되지 않는다.** 면접에서 "크레딧이 깎이나요?"를 물으면 이 갭을 정직하게 말할 수 있어야 한다.
:::

---

## 5. 다른 영역과의 경계 (★중요)

영역 E는 두 축 모두에서 다른 영역과 맞닿는다. 경계를 흐리지 않는 방식이 곧 설계 품질이다.

| 영역 | 무엇을 주고받나 | 경계 규칙 |
| --- | --- | --- |
| **A (프로필/자소서/이력서)** | 자소서·이력서 첨삭이 A의 원본을 **참조** | 원문을 덮어쓰지 않고, 확정 반영은 사용자 선택으로만 |
| **D (면접)** | 면접 답변 첨삭(#24)에서 경계 교차 | D는 첨삭 **소개/진입 탭**(`CorrectionInfoTab`)만 두고, 실행은 E의 `/correction`으로 위임 |
| **지원 건(Application Case)** | 첨삭에 `applicationCaseId` 연결 가능 | E가 직접 소유권을 판단하지 않고 `applicationCaseAccessService.requireOwned`에 위임 |
| **공통 `ai_usage_log`** | 모든 영역의 AI 사용량이 쌓이는 단일 테이블 | E는 이 로그를 **재사용**하고, 과금은 이 로그를 단일 근거(source of truth)로 삼도록 설계 |
| **전 영역 (과금)** | 모든 feature_type을 혜택코드에 매핑(`ai_feature_benefit_policy`) | E의 billing은 사실상 전사 과금 엔진 |

핵심 정리: **첨삭은 다른 영역의 데이터를 "읽기 참조"만 하고 원본을 건드리지 않으며, 과금은 다른 영역의 사용량 위에서 동작하는 공통 인프라다.** E는 두 방향 모두 "남의 소유권을 직접 판단하지 않고 공통 서비스에 위임"한다는 일관된 규칙을 따른다.

---

## 6. 권장 학습 순서

세부 페이지는 아래 순서로 읽으면 "두 축 → 첨삭 메커니즘 → 과금 메커니즘 → 화면" 으로 자연스럽게 깊어진다.

1. **[첨삭 설계 원칙](/area-e/correction-principles)** — 4종 단일 도메인 통합, 원문 보존, 출력 5필드 계약.
2. **[AI 답변 첨삭(#24)](/area-e/ai-answer-correction)** — D와의 경계, `correctionType` 분기, 입력 설계.
3. **[첨삭 데이터 모델](/area-e/correction-data-model)** — `correction_request`(append-only, `result_json`)와 `ai_usage_log` 연결.
4. **[크레딧 시스템](/area-e/credit-system)** — 원장·조건부 원자적 차감·멱등성, 1000토큰=1크레딧 환산.
5. **[결제 흐름](/area-e/payment-flow)** — Toss ready/confirm 2단계, 금액 위변조 방지, DEV provider.
6. **[플랜·사용권 게이팅](/area-e/plan-gating)** — 사용권 티켓, FREE 폴백, 사용권→크레딧 폴백 차감, 정책 스냅샷·예약변경.
7. **[사용량 대시보드 & #28](/area-e/usage-dashboard)** — 월 사용량 집계, 요금제 추천의 "데이터는 있으나 산출 로직 없음".
8. **[프론트 화면 구조](/area-e/frontend-ui)** — `Correction.tsx` 플레이스홀더 vs `Billing.tsx` 4탭 실연동.

배경 지식이 필요하면 [공통 구조화 출력](/ai/openai-structured-output)과 [영역 D 개요](/area-d/)를 함께 본다(D는 면접 답변 첨삭 진입 탭의 출발점).

---

## 7. 단골 면접 질문 5개 (개요 레벨)

:::details Q1. "영역 E는 한마디로 무엇인가요?"
첨삭(AI 콘텐츠 개선)과 과금 인프라(결제·크레딧·사용권)를 함께 책임지는 영역입니다. 첨삭은 자소서·이력서·면접 답변·포트폴리오 4종을 단일 `correction` 도메인으로 처리하고, 과금은 다른 모든 영역의 AI 기능이 기대는 공통 엔진입니다. 설계 정체성은 "원문을 날조하지 않는 첨삭"과 "잔액을 직접 만지지 않고 원장으로 기록하는 과금"입니다.
:::

:::details Q2. "첨삭 4종을 왜 하나의 도메인으로 묶었나요?"
입력·출력·검증·과금 흐름이 동일하기 때문입니다. 모델·서비스·AI 클라이언트를 1개로 두고 `correctionType`(SELF_INTRO/INTERVIEW_ANSWER/RESUME/PORTFOLIO)으로만 분기합니다. 유지보수가 단순해지고, 출력 형식과 과금 정책(첨삭 4종이 `benefit_code=CORRECTION` 한 풀 공유)을 일관되게 가져갈 수 있습니다.
:::

:::details Q3. "첨삭이 사용자의 경험을 지어내지 않게 어떻게 막나요?"
세 겹입니다. (1) 시스템 프롬프트에 "없는 성과·수치·경력을 만들지 말 것" 가드레일을 명시하고, (2) 근거가 부족한 강화 문장은 본문이 아니라 `suggestions`로만 돌리며, (3) `changeReasons`로 변경 이유를 노출해 사용자가 검증 후 선택 반영하게 합니다. 원본은 절대 덮어쓰지 않고 새 행으로 append-only 저장합니다.
:::

:::details Q4. "AI를 쓰면 크레딧이 실제로 차감되나요?"
현재는 아닙니다. 차감 엔진(`AiChargeService`/`consumeByFeature`/`deductByAiUsageLog`)은 원자적·멱등하게 완성돼 테스트를 통과하지만, 운영 경로에서 호출되지 않아 AI 기능 실행 경로와 배선되지 않았습니다. 실행 시 `ai_usage_log`와 결과 행만 쌓이고 실제 잔액은 깎이지 않습니다. 엔진은 완성됐고 "연결만 남은" 상태라고 설명하는 게 정확합니다.
:::

:::details Q5. "결제와 크레딧 지급의 책임은 어떻게 나뉘나요?"
"결제 도메인은 잔액을 직접 만들지 않는다"가 원칙입니다. Toss confirm(2단계 핸드셰이크)이나 DEV 즉시결제는 결제 상태만 PAID로 확정하고, 실제 크레딧·사용권 지급은 `billingService`의 공통 메서드(`grantCreditsAfterPayment`/`activateSubscriptionAfterPayment`)에 위임합니다. 그 메서드가 `credit_transaction`/`benefit_transaction` 원장에 기록하면서 잔액을 변동시킵니다.
:::

---

## 8. 직접 말해보기

아래를 보지 않고 60초 안에 말할 수 있으면 이 개요는 통과다.

1. 영역 E의 두 축과, 각 축의 "한 문장 정체성"(원문 보존 / 원장 기록).
2. 첨삭 4종이 왜 한 도메인인지, 그리고 분기 키(`correctionType`).
3. "원문을 날조하지 않는다"가 프롬프트·출력(`suggestions`/`changeReasons`)·저장(append-only)으로 어떻게 이어지는지.
4. 과금의 세 결정(원장 분리 / 마스터-인스턴스 / 정책 데이터화)과 "결제는 잔액을 만들지 않는다".
5. 차감 엔진이 완성됐지만 운영 경로에 미배선이라는 갭을, 사실대로.

---

## 퀴즈

<QuizBox question="영역 E의 첨삭 4종(#24~#27)은 코드에서 어떻게 구현돼 있나?" :choices="['기능마다 별도 모델·별도 도메인·별도 컨트롤러로 분리', '하나의 correction 도메인 + 하나의 AI 클라이언트에서 correctionType으로만 분기', '면접 답변만 백엔드가 있고 나머지 3종은 프론트 전용', '4종 모두 billing 도메인 안에서 결제와 함께 처리']" :answer="1" explanation="입력·출력·검증·과금 흐름이 동일해서 모델·서비스·AI 클라이언트를 1개로 통합하고 correctionType(SELF_INTRO/INTERVIEW_ANSWER/RESUME/PORTFOLIO)으로만 분기한다." />

<QuizBox question="첨삭의 핵심 가드레일인 '원문 보존'이 출력 구조에 반영된 방식으로 옳은 것은?" :choices="['근거 없는 강화 문장도 improvedText 본문에 바로 반영한다', '근거가 부족한 문장은 suggestions로만 돌리고, 변경 이유는 changeReasons로 노출한다', '원본 데이터를 곧바로 덮어써서 사용자가 다시 고를 필요가 없게 한다', 'mock 폴백으로 가짜 성과를 채워 결과를 항상 완성한다']" :answer="1" explanation="없는 사실을 지어내지 않기 위해, 근거가 부족한 강화 문장은 suggestions로만 제안하고 changeReasons로 변경 이유를 노출해 사용자가 검증 후 선택 반영하게 한다. 원본은 덮어쓰지 않는다." />

<QuizBox question="현재 코드 기준으로, 첨삭을 포함한 AI 기능을 실행하면 크레딧/사용권 차감은 어떻게 되나?" :choices="['실행 즉시 users.credit과 user_benefit_balance가 차감된다', '차감 엔진이 아예 없어서 과금 자체가 불가능하다', '차감 엔진은 완성·테스트 통과 상태지만 운영 경로에 미배선이라 실제 차감은 일어나지 않는다', '결제 도메인이 직접 잔액을 깎아 항상 동기화된다']" :answer="2" explanation="AiChargeService/consumeByFeature/deductByAiUsageLog는 원자적·멱등하게 완성돼 테스트를 통과하지만 호출처가 src/test에만 있어 운영 경로와 배선되지 않았다. 실행 시 ai_usage_log와 결과 행만 쌓인다." />
