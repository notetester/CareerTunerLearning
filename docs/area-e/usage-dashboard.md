# AI 사용량 대시보드

> 사용자 Billing 화면은 이번 달 전 영역 AI 사용량, 실제 기록된 크레딧 사용, 잔액과 규칙 기반 추천을 보여 준다.

## 데이터 원천

`BillingMapper.monthlyUsage`가 이번 달 1일 이후 `ai_usage_log`를 기능별로 집계한다.

```sql
SELECT feature_type,
       COUNT(*) AS used,
       COALESCE(SUM(credit_used), 0) AS credit_used
  FROM ai_usage_log
 WHERE user_id = :userId
   AND created_at >= :monthStart
 GROUP BY feature_type
 ORDER BY used DESC
```

사용자별 조회이므로 다른 회원의 사용량이 섞이지 않는다.

## 화면

Billing의 AI 사용량 탭은 다음을 제공한다.

- 기능별 실행 횟수와 크레딧 사용
- 공통 `getAiFeatureLabel`의 한국어 라벨
- 보유 크레딧과 충전 이동
- `UPGRADE_PLAN`, `BUY_CREDITS`, `KEEP` 추천 카드

첨삭 네 종류도 명시 라벨이 있다. 알 수 없는 새 기능은 prefix 그룹 또는 “기타 AI 기능”으로 안전하게 표시한다.

## Progress 막대의 의미

막대는 플랜 한도 소진율이 아니라 **그 달 가장 많이 쓴 기능 대비 상대 비율**이다.

```text
value = row.used / max(모든 row.used) * 100
```

가장 많이 사용한 기능은 항상 100%다. 플랜 한도나 잔여 사용권은 별도 정보이므로 이 막대를 “한도 80% 소진”이라고 설명하면 안 된다.

## 표시 값과 실제 차감

첨삭 같은 연결된 실행은 유효 결과 뒤 `AiChargeService`가 실제 사용권 또는 크레딧을 차감하고, 성공 `ai_usage_log.credit_used`와 장부가 그 결과를 추적한다. 실패 호출은 `credit_used=0`이고 잔액도 줄지 않는다.

사용권으로 처리된 요청은 크레딧 차감이 0일 수 있다. 따라서 호출 횟수와 크레딧 사용량은 항상 같은 비율이 아니다.

## 추천 카드

`getPlanRecommendation()`을 함께 호출한다.

- 월 15회 이상 + 상위 플랜 존재: 업그레이드 검토
- 잔액 5 이하 + 월 3회 이상: 충전 검토
- 그 외: 현재 플랜 유지

추천 조회 자체는 무과금이며 자동 결제로 이어지지 않는다.

## 관리자 화면 경계

관리자 AI 사용량 페이지는 상태·정렬·기간과 raw log를 조회하지만, 빠른 기능 filter 옵션과 요약 카드는 현재 B의 공고 분석 4종에 치우쳐 있다. 사용자 Billing의 전 영역 라벨 맵과 관리자 filter taxonomy를 완전히 통합하는 작업은 별도 개선점이다.

관리자 접근은 `AI_USAGE_READ` 같은 세부 권한 계약을 따라야 하며 단순 ADMIN role만으로 허용하지 않는다.

## 구현 상태

| 항목 | 상태 |
| --- | --- |
| 월 기능별 집계 API | 구현 |
| 사용자 Billing 사용량 UI | 구현 |
| 첨삭 포함 전 영역 라벨 | 구현 |
| 실제 차감과 성공 로그 연결 | 구현 |
| 규칙 기반 추천 카드 | 구현 |
| 관리자 raw log | 구현 |
| 관리자 기능 filter taxonomy 전 영역 통합 | 개선 여지 |

## 면접 답변

> "ai_usage_log를 월 시작 시점부터 feature_type으로 집계해 사용자에게 호출 수와 실제 크레딧 사용을 보여 줍니다. 라벨은 전 영역 공통 맵을 사용하고 첨삭도 한글로 표시합니다. Progress는 한도 소진율이 아니라 기능 간 상대 분포라 의미를 명확히 구분했습니다. 같은 데이터와 잔액으로 규칙 추천 카드를 만들며, 추천은 무과금·비강제입니다."

<QuizBox question="Billing 사용량 Progress가 뜻하는 것은?" :choices="['플랜 한도 소진율', '그 달 최대 사용 기능 대비 상대 비율', '전체 사용자 평균', '크레딧 잔액 비율']" :answer="1" explanation="각 row.used를 화면의 max used로 나눈다." />

<QuizBox question="실패한 첨삭의 사용량·과금은?" :choices="['성공과 동일 차감', 'FAILED 로그는 남지만 credit_used=0이고 잔액 차감 없음', '로그도 없음', '자동 환불']" :answer="1" explanation="감사 로그와 경제적 차감을 분리한다." />
