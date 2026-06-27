# 영역별 심화 — 6개 영역 한눈에

> CareerTuner는 6명이 **수직 분담**으로 만든 팀 프로젝트입니다. 한 **지원 건(Application Case)**을 6개 영역(A~F)이 함께 채웁니다. 여기서 각 영역으로 들어가세요.

## 이 사이트를 쓰는 법

- **특정 기술 하나**가 궁금하면 → [용어집](/glossary/) · [백엔드](/backend/) · [프론트엔드](/frontend/)
- **한 영역을 깊게** 알고 싶으면 → 아래 6개 영역 카드에서 선택
- **영역들이 어떻게 연결되는지**가 궁금하면 → [전체 흐름](/flow/) (아키텍처·사용자 여정·AI 오케스트레이터·AI #1-34 맵)

## 6개 영역

| 영역 | 책임 | 담당 AI | 핵심 기술 | 들어가기 |
| --- | --- | --- | --- | --- |
| **A** | 회원·프로필·인증 (스펙 원천 데이터) | #1~5 | JWT·OAuth·BCrypt·프로필 스냅샷 | [영역 A →](/area-a/) |
| **B** | 지원 건·공고·기업 분석 | #6~11 | PDFBox·Jsoup·SSRF 방어·공고추출 워커 | [영역 B →](/area-b/) |
| **C** | 적합도·전략·대시보드 | #12~18 | 뉴로심볼릭(규칙엔진+LLM)·3단 폴백·캐시 | [영역 C →](/area-c/) |
| **D** | 가상 면접 | #19~23 | 폴백 게이트웨이·SSE·자체 LLM 파인튜닝 | [영역 D →](/area-d/) |
| **E** | 첨삭·결제·크레딧 | #24~28 | 원문 보존 첨삭·크레딧 장부·PG 결제 | [영역 E →](/area-e/) |
| **F** | 커뮤니티·고객센터·챗봇 | #29~34 | LangChain4j 에이전트·인테이크 챗봇 | [영역 F →](/area-f/) |

> AI 기능 34개가 **6영역에 고르게** 나뉘어 있습니다. 어느 영역을 물어도 답할 수 있게, 각 영역은 동일한 깊이로 다룹니다.

## 영역별 대표 페이지

### A · 회원·프로필·인증 [(전체 →)](/area-a/)
[프로필 데이터 모델](/area-a/profile-data-model) · [JWT 인증](/area-a/auth-jwt) · [OAuth 소셜 로그인](/area-a/oauth-social) · [이력서 요약 AI #1](/area-a/ai-resume-summary) · [면접 플레이북](/area-a/interview-playbook)

### B · 지원 건·공고·기업 분석 [(전체 →)](/area-b/)
[지원 건 생명주기](/area-b/application-lifecycle) · [텍스트 추출·OCR·SSRF](/area-b/text-extraction-ocr) · [공고문 분석 AI #6](/area-b/job-analysis) · [공고추출 워커](/area-b/ml-worker) · [면접 플레이북](/area-b/interview-playbook)

### C · 적합도·전략·대시보드 [(전체 →)](/area-c/)
[적합도 분석 파이프라인](/area-c/fit-analysis) · [점수 규칙엔진](/area-c/score-engine) · [뉴로심볼릭](/area-c/neuro-symbolic) · [3단 폴백](/area-c/fallback-chain) · [면접 플레이북](/area-c/interview-playbook)

### D · 가상 면접 [(전체 →)](/area-d/)
[질문 생성 AI #19](/area-d/question-generation) · [답변 평가 AI #22](/area-d/answer-evaluation) · [폴백 게이트웨이](/area-d/fallback-gateway) · [SSE 실시간 진행](/area-d/sse-streaming) · [면접 플레이북](/area-d/interview-playbook)

### E · 첨삭·결제·크레딧 [(전체 →)](/area-e/)
[첨삭의 원칙(원문 보존)](/area-e/correction-principles) · [답변 첨삭 AI #24](/area-e/ai-answer-correction) · [크레딧 시스템](/area-e/credit-system) · [결제 흐름](/area-e/payment-flow) · [면접 플레이북](/area-e/interview-playbook)

### F · 커뮤니티·고객센터·챗봇 [(전체 →)](/area-f/)
[커뮤니티 데이터 모델](/area-f/community-data-model) · [후기 요약 AI #29](/area-f/ai-review-summary) · [LangChain4j 에이전트](/area-f/langchain4j-agent) · [인테이크 챗봇](/area-f/intake-chatbot) · [면접 플레이북](/area-f/interview-playbook)

## 영역을 잇는 흐름

각 영역을 본 뒤에는 [전체 흐름](/flow/)에서 어떻게 맞물리는지 확인하세요.

- [전체 아키텍처](/flow/architecture) — SPA + REST + MyBatis/MySQL + ML 워커 + Qdrant + AI 공급자
- [사용자 end-to-end 여정](/flow/user-journey) — 가입(A) → 공고분석(B) → 적합도(C) → 면접(D) → 첨삭(E) → 커뮤니티(F)
- [지원 건 중심 흐름](/flow/application-case) — 한 지원 건이 A~F 데이터로 채워지는 과정
- [데이터 소유권 경계 맵](/flow/data-ownership) — 누가 소유하고 누가 읽기전용 참조하나
- [AI 오케스트레이터](/flow/ai-orchestrator) · [AI #1-34 의존 맵](/flow/ai-function-map)
- [프로젝트 전체 면접 플레이북](/flow/interview-whole-project) — "프로젝트를 설명해보세요" 1분/3분/5분

::: tip 추천 순서
처음이면 **[전체 흐름 개요](/flow/)로 큰 그림 → 관심 영역(A~F) 심화 → [AI #1-34 맵](/flow/ai-function-map)으로 연결 복습**.
:::
