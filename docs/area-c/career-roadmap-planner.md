# 장기 커리어 로드맵과 플래너

> 적합도 결과를 읽고 끝내지 않고 희망 직무 기준의 월별 행동으로 바꿔 플래너와 캘린더까지 연결한다.

## 연결 흐름

```text
희망 직무 + 프로필 + 누적 적합도
  → 장기 전략·부족 역량 우선순위
  → 월별 roadmap item
  → 학습 task / 시험 일정
  → planner 저장
  → iCalendar(.ics) 단방향 내보내기
```

로드맵은 단일 지원 건만 보지 않는다. 반복해서 부족한 역량, 추천 자격의 검증된 일정, 희망 직무를 함께 보고 실행 항목을 만든다.

## 왜 iCalendar 내보내기인가

Google·Apple·Outlook 각각의 OAuth 쓰기 연동을 모두 구현하면 외부 자격증명과 동기화 충돌이 늘어난다. 현재는 표준 `.ics` 파일을 내려주는 단방향 import를 택했다.

- 외부 캘린더 OAuth 불필요
- 공급자 종속이 낮음
- 사용자가 가져올 항목을 최종 선택
- 양방향 수정 동기화는 제공하지 않음

“캘린더 연동”을 실시간 양방향 동기화로 과장하지 않는 것이 중요하다.

## UI 경계

`CareerRoadmapPage`는 월별 그룹·근거 메모·desired job을 보여주고, `PlannerPage`는 저장된 일정의 생성·수정·소프트 삭제를 담당한다. `StrategyScheduleButton`이 분석 결과를 플래너 행동으로 옮기는 연결점이다.

## 근거 경로

- `backend/src/main/java/com/careertuner/fitanalysis/controller/FitAnalysisController.java`
- `backend/src/main/java/com/careertuner/planner/`
- `frontend/src/features/analysis/pages/CareerRoadmapPage.tsx`
- `frontend/src/features/planner/`
