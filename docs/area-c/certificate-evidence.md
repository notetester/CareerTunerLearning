# 자격증 추천의 근거 검증

> 자격증 이름을 LLM이 그럴듯하게 추천하는 데서 끝내지 않고, 자격 유형·등록 상태·시험 일정의 근거를 수집해 결과와 함께 보존한다.

## 해결하려는 문제

자격증 추천은 세 가지 환각 위험이 있다.

- 실제로 존재하지 않거나 이름이 부정확한 자격
- 국가자격과 민간자격의 혼동
- 오래되거나 확인되지 않은 시험 일정 단정

그래서 모델의 추천 문자열과 외부 근거를 분리한다. 모델은 후보를 제안할 수 있지만, UI 상태와 일정 표시는 provider의 확인 결과를 따른다.

## 처리 흐름

```text
AI 추천 후보
  → alias/canonical name 정규화
  → 국가자격 offline catalog 판별
  → 국가기술·전문자격 일정 provider 조회
  → 민간자격 등록 근거 조회
  → 상태·출처·확인 시각을 snapshot으로 저장
  → 상세 조회는 저장 snapshot만 읽음
```

외부 기관 API를 매 화면 조회마다 호출하지 않는다. 적합도 결과 생성 시 한 번 수집해 `certificateEvidence` snapshot으로 저장하므로, 외부 장애가 기존 결과 조회 성능을 끊지 않는다.

## offline catalog의 역할

국가자격 전체 목록과 canonical key를 로컬 snapshot으로 둔다. 네트워크가 없어도 자격 유형과 조회 라우팅을 결정할 수 있고, snapshot이 누락·잘림·인코딩 오류로 보이면 경고 후 네트워크 경로로 안전하게 내려간다.

offline snapshot은 “최신 일정 정본”이 아니다. 자격 종류 판별과 canonical mapping을 안정화하는 기준이며, 일정은 공식 provider 상태와 확인 시각을 함께 보여준다.

## 상태를 숨기지 않는 UI

근거가 확인되면 일정·출처를 보여주고, 미설정·미발견·외부 장애는 서로 다른 상태로 표시한다. 조회 실패를 빈 배열로 바꿔 “시험이 없음”처럼 보이게 하지 않는다.

자격증은 어디까지나 보조 전략이다. 실무 프로젝트·배포 경험이 더 중요한 공고라면 `CertificateNeedGate`가 자격증 추천의 우선순위를 낮춘다.

## 근거 경로

- `backend/src/main/java/com/careertuner/fitanalysis/certificate/`
- `backend/src/main/java/com/careertuner/fitanalysis/service/FitAnalysisServiceImpl.java`
- `frontend/src/features/analysis/pages/CertificateSearchPage.tsx`
