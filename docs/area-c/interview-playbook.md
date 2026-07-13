# C 종합 면접 플레이북

> 영역 C(취업 전략 분석·대시보드)의 **종합 정리**. 1분·3분 소개 스크립트, 핵심 메시지 6개, 기술선택 이유 Q&A, 트러블슈팅, 개선 로드맵, 예상 질문 20개 모범답안을 한 장에 모았다. 다른 페이지가 "한 주제를 깊게"라면, 이 페이지는 **면접장에서 그 깊이를 막힘없이 꺼내는 인덱스**다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

이 페이지는 개별 기술이 아니라 **"영역 C 전체를 어떻게 말로 풀 것인가"**를 다룬다. 면접관이 "본인 파트 소개해 주세요"부터 "왜 그렇게 만들었어요?"의 꼬리질문 5단까지 들어와도, 일관된 한 줄 철학에서 모든 답이 파생되도록 스크립트와 답변 트리를 정리한다.

대비하는 질문군:

- "본인이 담당한 부분을 1분 / 3분으로 소개해 주세요."
- "이 프로젝트에서 가장 잘 설계했다고 생각하는 한 가지는?"
- "왜 MyBatis인가요 / 왜 규칙엔진과 LLM을 분리했나요 / 왜 자체 LLM인가요?"
- "구현하면서 가장 어려웠던 문제와 해결 과정은?"
- "지금 부족한 점, 더 개선한다면?"

::: tip 모든 답의 출발점 — 한 문장
**"영역 C는 '지원해도 되나 / 무엇을 보완하나 / 다음 어디로'를 한 흐름으로 답하는 취업 전략 엔진이고, 핵심 철학은 점수·판단은 규칙엔진이 확정하고 LLM은 설명만 하는 뉴로-심볼릭입니다."**
이 한 문장에서 6개 핵심 메시지가 전부 갈라져 나온다.
:::

전체 지도는 [영역 C 개요](/area-c/index)에 있다. 이 페이지는 그 위에 "말하기"를 얹는다.

---

## 2. 왜 이렇게 설계했나 — 면접 답변을 지배하는 한 줄

영역 C의 모든 코드 결정은 단 하나의 도메인 통찰에서 나온다: **채용 의사결정 도메인에서는 "왜"를 못 대면 제품 가치가 0이다.** "당신은 73점입니다"는 근거가 없으면 사용자가 믿지 않고, 떨어졌을 때 책임도 못 진다.

그래서 C는 LLM에게서 *점수를 빼앗는* 역발상을 택했다. 대부분의 AI 제품이 "LLM이 다 한다"로 갈 때, C는 "LLM은 **설명만** 한다"로 갔다. 이 선택이 신뢰·재현·책임·비용·가용성을 동시에 사면서, 대신 "규칙엔진 품질 = 점수 정교함"이라는 트레이드오프를 떠안는다. 면접에서 이 트레이드오프를 **먼저** 인정하는 정직함이 오히려 설계의 신뢰성을 증명한다.

| 갈림길 | 흔한 선택 | C의 선택 | 면접에서의 효과 |
| --- | --- | --- | --- |
| 점수 산출 주체 | LLM이 점수까지 | 규칙엔진이 점수, LLM은 설명 | "재현 가능한 의사결정"을 어필 |
| 외부 의존 | OpenAI 단일 | OSS→OpenAI→Mock 3단 폴백 | "장애에 안 죽는 시스템" 어필 |
| 비용 모델 | 매 조회 호출 | fingerprint 캐시 | "운영 비용을 아는 엔지니어" 어필 |

---

## 3. 어떤 기술로 구현했나 — C의 기술 지도 (한눈에)

면접에서 "스택을 말해보라"고 하면 나열이 아니라 **이 표를 골격으로** 설명한다.

| 레이어 | 기술 | C에서의 역할·근거 클래스 |
| --- | --- | --- |
| 백엔드 | Spring Boot 4.1.0 + Java 21 | 4계층 `controller→service→mapper→domain` |
| 영속성 | MyBatis + MySQL 8 | `FitAnalysisMapper` + `resources/mapper/**/*.xml` |
| AI 디스패치 | Strategy + Fallback 패턴 | `FallbackFitAnalysisAiService`(`@Primary`) |
| 규칙엔진 | 순수 Java(외부 호출 0) | `MockFitAnalysisAiService.score()` |
| 자체 LLM | Ollama(`careertuner-c-career-strategy-3b`) | `OssFitAnalysisAiService` + grounding guard |
| 외부 LLM | OpenAI Responses API(json_schema strict) | `OpenAiFitAnalysisAiService`, `CareerAnalysisOpenAiClient`(`java.net.http`) |
| 캐시 | SHA-256 input fingerprint | `CareerAnalysisRunService.fingerprint()` |
| 실시간 | SSE(SseEmitter 5분) | `AutoPrepOrchestrator.runStream()` |
| 프론트 | React 19 + Vite 8 + TS + Tailwind v4 | `useApplicationFitAnalysis`, Recharts |

핵심 메서드 4개만 기억하면 C의 절반을 설명할 수 있다: `MockFitAnalysisAiService.score()`(점수), `applyDecision()`(판단), `FitAnalysisConfidence.evaluate()`(신뢰도), `CareerAnalysisRunService.fingerprint()`(캐시 키).

---

## 4. 동작 원리 — 핵심 메시지 6개 (면접의 뼈대)

C 면접 답변은 결국 이 6개 메시지의 조합이다. 어떤 질문이 와도 "그건 메시지 N의 문제입니다"로 환원해서 답한다.

### 메시지 1 — 뉴로-심볼릭 (역할 분리)

점수·판단·신뢰도는 규칙엔진이 소유하고, LLM은 한국어 설명만 만든다. `OssFitAnalysisAiService`는 모델 응답에서 화이트리스트(`fitSummary`/`strategyActions`/`learningTaskReasons`)만 읽어, 모델이 `fitScore`를 뱉어도 **읽는 코드가 없어** 무력화된다. → [뉴로-심볼릭](/area-c/neuro-symbolic)

### 메시지 2 — 설명가능성 (감사 가능)

모든 분석에 `source_snapshot`(분석 시점의 프로필·공고 revision 동결), `score_basis`, `condition_matrix`, `apply_decision`, `analysis_confidence`, `model`/`prompt_version`/`status`를 함께 저장한다. 입력이 나중에 바뀌어도 **그때 기준으로 재현·감사** 가능하다. → [데이터 모델](/area-c/data-model)

### 메시지 3 — 사용자 여정의 일관성

홈 → 대시보드 → 지원건 적합도 → 학습/자격증 → 장기경향 → 다음 지원방향이 **하나의 의사결정 루프**다. 적합도 결과는 불변이라 재분석마다 새 행을 `INSERT`하고, `fit_analysis_history`가 "지난번 대비 점수 변화"를 추적해 보완→재분석→개선확인 루프를 닫는다. → [프론트엔드 UI](/area-c/frontend-ui)

### 메시지 4 — 운영가능성 (가드레일 + 신뢰도)

`guardApplyDecision`이 `(fitScore>=70 AND requiredUnmet==0)`이 아니면 AI의 APPLY를 COMPLEMENT로 강등한다. `FitAnalysisConfidence`는 점수와 **별개로** 입력 충실도로 신뢰도를 결정적 계산해(공고 역량 비면 −40 등) "점수를 얼마나 믿을지"를 투명화한다. → [가드레일](/area-c/guardrails)

### 메시지 5 — 데이터 주권 (자체 LLM)

1차 경로가 자체 OSS 모델(`careertuner-c-career-strategy-3b`, Ollama)이다. 채용·이력 같은 민감 데이터를 외부에 덜 보내고, 도메인 특화 튜닝과 비용 통제를 가능하게 한다. → [폴백 체인](/area-c/fallback-chain)

### 메시지 6 — 재현·감사 + 비용 (캐시)

`career_analysis_run.input_fingerprint = SHA-256(canonical JSON)`. 장기경향·대시보드는 fingerprint가 같으면 저장 결과를 재사용한다. 초기 로드는 무료, 명시적 재생성만 크레딧 1 차감. `FAILED`는 캐시하지 않는다. → [캐시·지문](/area-c/caching-fingerprint)

::: tip 6개를 한 호흡에
**분리(1) · 감사(2) · 일관성(3) · 운영(4) · 주권(5) · 재현/비용(6)** — "분·감·일·운·주·재"로 외운다.
:::

---

## 5. 소개 스크립트 (1분 / 3분)

면접 첫 질문은 거의 항상 "본인 파트 소개"다. 외워서 더듬지 않고 나오게 둔다.

### 5.1 1분 스크립트 (암기용, ~150단어)

> "저는 영역 C, **취업 전략 분석과 대시보드**를 담당했습니다. 사용자가 공고 하나를 두고 '**지원해도 되나, 무엇을 보완하나, 다음엔 어디로**'를 한 흐름으로 답하게 만드는 파트입니다. 적합도·부족역량·학습로드맵·자격증·장기경향·다음방향·대시보드요약까지 AI 기능 7종을 소유합니다.
>
> 가장 중요한 설계 결정은 **뉴로-심볼릭**입니다. 점수와 지원 판단은 **결정적 규칙엔진**이 확정하고, LLM은 그 결과를 한국어로 설명만 합니다. 채용 의사결정에서는 '왜 이 점수인지' 답할 수 있어야 하기 때문입니다.
>
> 안정성을 위해 **자체 OSS → OpenAI → Mock 3단 폴백**을 깔았고, 마지막 Mock이 순수 규칙엔진이라 LLM이 다 죽어도 화면은 안 깨집니다. 모든 분석은 입력 스냅샷을 동결해 **재현·감사**가 되고, SHA-256 지문 캐시로 비용을 통제합니다."

### 5.2 3분 스크립트 (구조)

1분 버전에 **구체 근거**를 한 단계씩 덧붙인다.

| 30초 블록 | 핵심 문장 | 덧붙일 근거 |
| --- | --- | --- |
| ① 정체성 | 세 질문 한 흐름 | 담당 화면(홈/대시보드/분석 5탭/적합도탭) |
| ② 철학 | 점수=규칙, 설명=LLM | `score()`=`10+필수*70+우대*20`, 화이트리스트 병합 |
| ③ 신뢰성 | 가드·신뢰도·설명가능성 | `guardApplyDecision`, `FitAnalysisConfidence`, `source_snapshot` |
| ④ 가용성 | 3단 폴백 | `FallbackFitAnalysisAiService` `@Primary` 디스패처 |
| ⑤ 비용·운영 | fingerprint 캐시 + SSE | `CareerAnalysisRunService`, `AutoPrepOrchestrator` |
| ⑥ 정직 | 됨 vs 향후 | 아키텍처 완성, 실 LLM 연동은 키 발급 후 |

::: warning 3분 스크립트의 마지막은 항상 "정직 블록"
과장하지 않는 것 자체가 C의 철학(신뢰)과 일관된다. "아키텍처는 완성, 실 LLM은 키 발급 후 활성화"로 닫으면 신뢰도가 올라간다.
:::

---

## 6. 기술선택 이유 Q&A (왜 그걸 골랐나)

"왜 X를 썼냐"는 질문은 **대안과 트레이드오프를 아는지** 보는 질문이다. 나열 금지, 비교로 답한다.

### 왜 MyBatis인가 (JPA가 아니라)
C는 장기경향에서 **25종 결정적 집계**를 SQL로 돌린다(점수분포·반복부족·직무별 준비도 등). 복잡한 통계 쿼리는 SQL을 직접 쓰는 게 명시적이고 튜닝하기 쉽다. JPA의 객체-중심 추상화보다, 매퍼 XML로 쿼리를 눈에 보이게 두는 MyBatis가 이 도메인에 맞다. (팀 공통 규약이기도 하다.)

### 왜 규칙엔진 + LLM 분리인가
순수 LLM이면 같은 입력에 점수가 흔들리고(재현 불가), 근거를 못 대고(설명 불가), 매 호출 과금되고(비용), 모델이 죽으면 화면도 죽는다(가용성). 분리하면 이 넷을 한 번에 산다. 대가는 "규칙엔진이 단순하면 점수 정교함도 거기 묶인다"인데, 그 해법은 LLM에 점수를 넘기는 게 아니라 **규칙엔진을 정교화**(임베딩 유사도 매칭 등)하는 것이다.

### 왜 자체 LLM인가 (OpenAI만 쓰지 않고)
세 가지다. **데이터 주권**(이력·채용은 민감 데이터라 외부 전송을 줄인다), **비용**(트래픽이 늘면 토큰 비용이 선형 증가), **도메인 특화**(취업 전략 설명 톤을 파인튜닝으로 맞춘다). 단, 자체 모델이 불안정할 수 있으니 OpenAI를 2차, 규칙엔진을 3차에 둬서 품질·가용성을 보강한다.

### 왜 캐시인가
장기경향·대시보드는 매 조회마다 LLM을 부르면 비싸고 느리다. 입력이 안 바뀌었으면 결과도 같으니, `SHA-256(canonical JSON)` 지문이 같으면 저장 결과를 재사용한다. AI 입력을 **핵심 6개**(stats/skillGaps/jobReadiness/scoreHistory/interviewTrend/bestStrategy)로 제한해, 부가 집계가 흔들려도 지문이 안 깨지게 했다.

### 왜 SSE인가 (WebSocket이 아니라)
오케스트레이터는 plan→part-start→substep→part-done을 **서버→클라이언트 단방향**으로 흘려보내면 충분하다. 양방향이 필요 없으니 양방향 연결을 관리하는 WebSocket은 과하다. `SseEmitter`(타임아웃 5분)가 더 단순하고 HTTP 인프라와 잘 맞는다.

### 왜 JSON 컬럼인가
`fit_analysis`의 `condition_matrix`/`score_basis`/`apply_decision`은 분석 1건에 종속된 **불변 스냅샷**이라, 정규화해 조인하기보다 한 행에 JSON으로 동결하는 게 재현·감사에 맞다. 다만 **집계·관리자 검색이 필요한 조건 매트릭스는 예외로** `fit_analysis_condition_match` 테이블에 정규화해 둘 다 가진다(스냅샷 + 검색).

---

## 7. 자주 나오는 꼬리질문 + 모범답안

### Q1. 결국 LLM이 안 붙었으면 그냥 규칙엔진 데모 아닌가요?
"점수·판단·신뢰도·가드레일·캐시·3단 폴백 배선·4테이블 저장·히스토리·조건매트릭스·오케스트레이터 SSE·프론트·관리자 화면은 **전부 구현돼 돌아갑니다.** 화면과 계약(스키마)은 실제 LLM과 동일합니다. 자체 OSS 통합 코드와 grounding guard, 폴백 배선도 구현됐고, 남은 건 **실제 파인튜닝 모델 서빙과 OpenAI 키 연동**입니다. 분리 설계 덕분에 그 둘은 '키만 꽂으면' 활성화됩니다."

### Q2. APPLY를 COMPLEMENT로 강등하면 사용자가 혼란스럽지 않나요?
"AI의 원래 reasons는 **지우지 않고 유지**한 채, 가드가 자동보정 사유를 *추가*합니다. 사용자는 'AI는 이렇게 봤지만, 필수 미충족이 있어 보완을 권한다'는 두 관점을 다 봅니다. 결과 카드에 'AI 제안·확인 필요' 배지가 있어 과신을 막습니다."

### Q3. fingerprint가 같은데 사용자가 새 결과를 원하면요?
"명시적 **재생성(refresh)** 액션을 두고, 그때만 크레딧 1을 차감하며 새로 기록합니다. 초기 로드는 캐시라 무료입니다. 비용이 드는 행위(LLM 실행)와 무료 행위(캐시 재사용)를 UX에서 분리해 사용자가 비용을 통제하게 했습니다."

### Q4. 점수 공식이 너무 단순하지 않나요? (`10+필수*70+우대*20`)
"맞습니다, 의도적으로 단순합니다. 핵심은 공식의 정교함이 아니라 **'점수를 LLM이 아니라 코드가 소유한다'**는 분리 원칙입니다. 공식은 향후 임베딩 유사도 매칭으로 정교화할 수 있고, 그때도 점수는 여전히 코드가 소유합니다 — 분리는 유지됩니다. 부분 일치(PARTIAL)는 이미 조건 매트릭스에서 처리합니다."

### Q5. 신뢰도와 점수는 뭐가 다른가요?
"점수는 '얼마나 적합한가', 신뢰도는 '그 점수를 얼마나 믿어도 되나'입니다. 프로필이 비어 있으면 점수는 낮게 나오지만, 그 점수 자체의 신뢰도도 낮습니다(`−35`). 둘을 분리해 '신뢰도 보통 · 72점'처럼 함께 표기하고, `FitAnalysisConfidence`는 입력 상태 기반 결정적 계산이라 mock/실제 동일합니다."

### Q6. OpenAI 응답을 어떻게 신뢰하나요? (자유 텍스트 파싱 위험)
"Responses API의 **json_schema strict**로 받아 자유 텍스트 파싱을 원천 회피합니다. 그래도 `fitScore` 같은 수치는 응답 후 0~100으로 클램핑하고, `applyDecision`은 `guardApplyDecision`으로 다시 검증합니다. 4xx/5xx를 분기해 재시도+지수 백오프를 겁니다." → [구조화 출력](/area-c/structured-output)

### Q7. 오케스트레이터에서 한 단계가 실패하면 전체가 멈추나요?
"아니요. `FitPrepHandler`는 지원 건이 없으면 skip하고, 부분 실패를 허용합니다. FIT은 JOB(B) 의존이라 공고 분석이 끝나야 시작하고, `CompletableFuture.allOf`로 의존 없는 단계는 병렬 실행합니다. SSE로 substep('근거 검색'/'채점'/'검증')을 흘려보내 진행을 보여줍니다." → [오케스트레이터 FIT](/area-c/orchestrator-fit)

---

## 8. 트러블슈팅 — 구현 중 실제로 부딪힌 문제

"가장 어려웠던 문제"는 단골이다. 추상론 말고 **구체 사례 + 해결**로 답한다.

| 문제 | 증상 | 해결 |
| --- | --- | --- |
| grounding guard 과도 폴백 | "Kubernetes 경험이 **부족**"을 환각으로 오탐 → 불필요한 재호출 | 한 문장에 보유표현(`POSSESSION`)이 있고 *동시에* 결핍표현(`LACK`)이 **없을 때만** 위반 판정 (보수적 판정) |
| 보유 자격증 오탐 | 규칙엔진이 자격증을 스킬로 안 쳐 `missing`에 남음 → 모델이 "정보처리기사 보유"(사실)를 말해도 위반 | 병합 전 `profileCertificates`를 `missing`에서 제거 |
| 캐시가 자주 깨짐 | 부가 집계가 조금만 바뀌어도 fingerprint 변동 → 캐시 미스 | AI 입력을 **핵심 6개 필드로 제한**해 canonical JSON 안정화 |
| 프론트 race condition | 빠른 화면 전환 시 이전 요청 응답이 새 화면 상태를 덮어씀 | `useApplicationFitAnalysis`에서 `useEffect` cleanup `ignore` 플래그로 stale 응답 폐기 |
| 로딩 상태 혼동 | 초기 GET과 생성 POST가 같은 loading을 써서 UX가 어긋남 | `loading`(초기 GET)과 `generating`(POST 생성) 상태를 분리 |
| 점수 과대평가 | 프로필 미입력 시 보유를 추정해 점수가 부풀려짐 | 프로필 비면 필수를 전부 미충족 처리하고 점수를 10으로 바닥 고정 |

이 표에서 **두 개만 골라 깊게** 말하면 충분하다(추천: grounding guard 보수적 판정 + 프론트 race condition).

---

## 9. 개선점 — 더 한다면 (정직한 로드맵)

"부족한 점은?"에 "없습니다"는 최악이다. 아는 한계를 우선순위로 말한다.

1. **실 LLM 연동 활성화.** 자체 파인튜닝 모델 학습·서빙과 OpenAI 키 연동. 배선·계약은 완성, 키/리소스만 남음.
2. **점수 공식 정교화.** 현재 정확 매칭 기반 → 임베딩 유사도 매칭으로 "AWS"와 "AWS EC2", "React"와 "프론트엔드"의 의미 근접을 점수에 반영. 분리 원칙은 유지.
3. **가중치 보정.** `scoreBreakdown` 5카테고리 가중(REQUIRED 45/PREFERRED 25/PROJECT 15/EXPERIENCE 10/PROFILE 5)을 실제 합격 데이터로 캘리브레이션.
4. **데이터 축적 기반 경향.** `fit_analysis_history`와 장기경향 집계가 사용자 데이터가 쌓일수록 정확해지므로, 콜드스타트 구간의 안내 UX 보강.
5. **A/B 가능한 프롬프트 버전 운영.** `prompt_version`을 이미 기록하므로, 버전별 품질 비교 파이프라인을 붙일 수 있음.

::: tip 개선점 답변의 황금 패턴
"한계를 인지 → 왜 지금 그 상태인지(우선순위/리소스) → 어떻게 풀지(구체) → **원칙은 안 깨진다**" 4박자로 답한다.
:::

---

## 10. 예상 질문 20개 — 빠른 답변 인덱스

면접 직전 1분 스캔용. 각 항목은 "키워드 답 → 어느 페이지 깊이"로.

| # | 질문 | 30자 답 | 깊이 |
| --- | --- | --- | --- |
| 1 | C가 뭘 하나요 | 지원해도 되나·보완·다음방향 한 흐름 | [개요](/area-c/index) |
| 2 | 왜 AI에 점수 안 맡겼나 | 재현·설명·책임·비용·가용성 | [뉴로-심볼릭](/area-c/neuro-symbolic) |
| 3 | 점수 공식은 | `10+필수*70+우대*20` 클램핑 | [점수 엔진](/area-c/score-engine) |
| 4 | AI가 틀린 판단 내면 | guardApplyDecision이 COMPLEMENT 강등 | [가드레일](/area-c/guardrails) |
| 5 | LLM 죽으면 | OSS→OpenAI→Mock, 최후단 항상 성공 | [폴백 체인](/area-c/fallback-chain) |
| 6 | 매번 AI 부르면 비싸지 | SHA-256 지문 캐시, refresh만 과금 | [캐시·지문](/area-c/caching-fingerprint) |
| 7 | 나중에 근거 증명 | source_snapshot 동결 + prompt_version | [데이터 모델](/area-c/data-model) |
| 8 | 신뢰도 vs 점수 | 적합도 vs 그 점수를 믿을 정도 | [점수 엔진](/area-c/score-engine) |
| 9 | 모델이 점수 뱉으면 | 화이트리스트만 읽어 구조적 무시 | [뉴로-심볼릭](/area-c/neuro-symbolic) |
| 10 | 자유텍스트 파싱 위험 | json_schema strict + 클램핑 | [구조화 출력](/area-c/structured-output) |
| 11 | 부족역량 분류 | 필수미충족/우대보완/장기성장 3단계 | [부족역량·학습](/area-c/gap-and-learning) |
| 12 | 자격증 과도추천 | catalog 기반·가치 낮으면 LOW | [부족역량·학습](/area-c/gap-and-learning) |
| 13 | 지원 전략 어떻게 | APPLY/COMPLEMENT/HOLD + 3단 액션 | [지원 전략](/area-c/application-strategy) |
| 14 | 장기경향 입력 | 25종 집계→핵심 6개 커맨드 | [장기 경향](/area-c/career-trend) |
| 15 | 대시보드/홈 관계 | 홈=대시보드 재투영, 공유 캐시 | [대시보드 인사이트](/area-c/dashboard-insight) |
| 16 | 오케스트레이터 | FitPrepHandler, JOB 의존, SSE | [오케스트레이터 FIT](/area-c/orchestrator-fit) |
| 17 | 왜 MyBatis | 복잡 집계 SQL 명시·튜닝 | 본 페이지 §6 |
| 18 | 왜 SSE | 단방향이면 충분, WebSocket 과함 | 본 페이지 §6 |
| 19 | 디자인 패턴 | Strategy+Fallback, 인터페이스+4구현 | [클래스 설계](/area-c/class-design) |
| 20 | 관리자 화면 | 처리큐·분석통계·운영메모·위험노트 | [관리자](/area-c/admin) |

---

## 11. 직접 말해보기

종이를 덮고 다음을 시간 안에 말할 수 있으면 합격이다.

- **1분 소개**를 끊김 없이 (외운 티 안 나게).
- **6개 핵심 메시지**를 "분·감·일·운·주·재" 순서로 각 한 줄.
- **기술선택 이유** 6개(MyBatis·분리·자체LLM·캐시·SSE·JSON) 중 임의 3개를 *대안 비교*로.
- **트러블슈팅** 2개를 증상→원인→해결로 (grounding guard 보수적 판정 추천).
- **구현 완료 vs 향후 과제** 경계를 과장 없이.
- "가장 잘 설계한 것?" → 뉴로-심볼릭 분리 + 화이트리스트 병합을 60초로.

---

## 퀴즈

<QuizBox question="C의 1분 소개에서 모든 답이 파생되는 '한 문장 철학'으로 가장 적절한 것은?" :choices="['모든 분석을 OpenAI로 처리해 품질을 높였다', '점수·판단은 규칙엔진이 확정하고 LLM은 설명만 하는 뉴로-심볼릭', '캐시를 적극 써서 비용을 0으로 만들었다', 'SSE로 모든 화면을 실시간 갱신한다']" :answer="1" explanation="C 면접의 중심 문장은 '점수·판단=규칙엔진, 설명=LLM(뉴로-심볼릭)'이다. 신뢰·재현·책임·비용·가용성과 6개 핵심 메시지가 전부 이 한 줄에서 파생된다." />

<QuizBox question="'왜 SSE를 썼나요?'에 대한 모범답안의 핵심 논거는?" :choices="['SSE가 WebSocket보다 항상 빠르다', '진행 상황 전달은 서버→클라이언트 단방향이면 충분해 양방향 WebSocket은 과하다', 'SSE만 JSON을 보낼 수 있다', 'SSE는 인증이 필요 없다']" :answer="1" explanation="오케스트레이터의 plan/part-start/substep/part-done은 서버에서 클라이언트로 흐르는 단방향 진행 신호다. 양방향이 필요 없으므로 연결 관리 부담이 큰 WebSocket 대신 SseEmitter가 더 단순하고 HTTP 인프라와 맞는다." />

<QuizBox question="구현 중 grounding guard가 정상 문장을 환각으로 오탐(과도 폴백)하던 문제를 어떻게 해결했는지 설명하라. 보유 자격증 예외까지 포함해 말해보라(주관식)." explanation="모범답안: (1) 보수적 판정 — 한 문장에 보유표현(POSSESSION '보유/강점/숙련')이 있고 동시에 결핍표현(LACK '부족/없/않')이 없을 때만 위반으로 본다. 그래서 'Kubernetes 경험이 부족'은 정상 통과한다. (2) 보유 자격증 예외 — 규칙엔진이 자격증을 스킬로 치지 않아 보유 자격증이 missing에 남는데, 안 빼면 모델이 '정보처리기사 보유'(사실)를 말해도 위반으로 오탐하므로, 병합 전 profileCertificates를 missing에서 제거한다. 둘 다 false-positive로 인한 불필요한 재호출·폴백을 줄이려는 의도적 보정이다." />
