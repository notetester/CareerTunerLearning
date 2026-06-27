# 영역 B 개요 — 지원 건·공고·기업 분석

> 영역 B는 CareerTuner의 **데이터 중추**다. 핵심 단위는 공고가 아니라 **지원 건(Application Case)**이고, 그 아래에 공고 원문·공고 분석·기업 분석이 매달린다. B의 철학은 한 줄로 요약된다 — **"공고를 통째로 생성형으로 대체하지 않는다. 공고 텍스트를 문장 단위로 쪼개 필수/우대/담당업무/기술스택으로 분류하는 *구조화 추출*이 본질이다."**

---

## 1. 영역 B의 정체성 — 한 문장으로

영역 B는 **"이 공고가 무엇을 요구하는가"를 구조화된 데이터로 만들어, 나머지 모든 영역이 소비할 수 있게 공급하는 영역**이다. 사용자가 채용공고를 던지면, B가 그것을 OCR·추출하고, 문장을 분류하고, 필수/우대/담당업무/기업 현황으로 쪼개어 저장한다.

CareerTuner 전체에서 가장 먼저 짚어야 할 사실은 이것이다 — **핵심 도메인 루트는 공고(job posting)가 아니라 지원 건(`application_case`)이다.** 같은 회사 같은 직무라도 내가 두 번 지원하면 지원 건은 둘이고, 공고 원문·분석·추출 잡은 전부 그 지원 건에 종속된다.

| B가 소유하는 것 | 테이블 | 역할 |
| --- | --- | --- |
| **지원 건(루트)** | `application_case` | 모든 산출물이 매달리는 트리의 뿌리 |
| **공고 원문** | `job_posting` | 사용자가 올린 원문, revision append-only(불변) |
| **공고 분석** | `job_analysis` | 필수/우대/담당업무/난이도 (AI #6~9) |
| **기업 분석** | `company_analysis` | 검증된 사실 vs AI 추론 + 면접 포인트 (AI #10~11) |
| **추출 잡** | `application_case_extraction` | 비동기 OCR/추출 상태기계 |

모든 산출물에 대해 **출처(source)·버전(revision)·사용자 확인 상태(confirmed/checked)**를 함께 관리하는 것이 B의 책임이다.

:::tip 이 페이지가 답하는 면접 질문
"영역 B가 정확히 뭘 하는 거예요?" / "공고가 아니라 지원 건이 핵심이라는 게 무슨 뜻이죠?" / "B에서 나온 데이터가 다른 기능으로 어떻게 흘러가나요?"
이 개요만 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

---

## 2. 핵심 철학 — "생성"이 아니라 "구조화 추출"

### 한 줄 정의

> **공고문 전체를 한 번에 LLM으로 다시 써내지 않는다. 원문에서 *근거를 인용하며* 조건을 뽑아낸다.**

가장 흔한 오해는 "AI가 공고를 읽고 멋진 요약을 생성한다"는 그림이다. B는 그 반대 방향으로 설계됐다. OCR은 입력 텍스트를 확보하는 단계일 뿐이고, B의 본질은 **OCR 이후 문장 분류와 조건 추출**이다.

이 철학이 런타임에서 두 클래스로 구현된다.

| 단계 | 클래스 | 하는 일 |
| --- | --- | --- |
| 전처리(분류) | `BJobSentenceClassifier` | 공고를 줄/문장 단위로 쪼개 11라벨(REQUIRED/PREFERRED/RESPONSIBILITY/TECH_STACK …)을 규칙·키워드로 부착 |
| 추출(엔진) | `BAnalysisGenerationService` | 분류 신호 + 원문을 LLM에 넣어 구조화 JSON을 받고, **원문에 실제로 등장하는지 검증**하고, 실패 시 규칙엔진으로 폴백 |

핵심은 **환각 방지**다. 추출한 스킬이 실제 공고 원문에 토큰으로 등장하는지 검증(`validateGrounding`)하고, grounded 비율이 임계값(`groundingThreshold` 기본 0.6) 미만이면 예외를 던져 규칙 폴백으로 떨어뜨린다. "근거 기반"이라는 말이 코드로 보증되는 것이다.

자세히: [공고 분석 (필수/우대/담당업무)](/area-b/job-analysis) · [환각 방지 3중 방어](/ai/hallucination)

---

## 3. 담당 AI 기능 #6~#11

영역 B는 6개의 AI 기능을 소유한다. 놀랍게도 이 6개는 **단 2번의 LLM 호출**로 산출된다 — `generateJobAnalysis`(#6~9) + `generateCompanyAnalysis`(#10~11). 그 앞단에 OCR/추출과 메타데이터 추출(회사명·직무명·마감일 프리필)이 붙는다.

| # | 기능 | 한 줄 설명 | 주요 산출물 |
| --- | --- | --- | --- |
| 6 | 공고문 AI 분석 | 공고 전체를 구조화 분석 | `summary`, `difficulty`, `experienceLevel` |
| 7 | 필수 조건 추출 | 반드시 갖춰야 할 역량 | `required_skills`(JSON 배열) |
| 8 | 우대 조건 추출 | 있으면 좋은 역량 | `preferred_skills`(JSON 배열) |
| 9 | 담당업무 요약 | 입사 후 할 일 | `duties`, `qualifications` |
| 10 | 기업 현황 AI 요약 | **사실 vs 추론 분리** | `verified_facts`, `ai_inferences` |
| 11 | 면접 포인트 추출 | 면접에서 물어볼 만한 지점 | `interview_points` |

모든 #6~11이 공유하는 엔진 패턴은 하나다 — **로컬 LLM 우선 → 실패 시 `self-rules-v1` 결정론 규칙엔진 폴백.**

```text
입력(공고 텍스트 + 분류 신호)
   │
   ▼
[BLocalLlmClient.chat]  Ollama /api/chat
   ├─ JSON Schema 강제(format), temperature=0, think=false
   ├─ 모델 careertuner-b-jobposting-r1 (파인튜닝 R1)
   │
   ├─ 성공 → 소형모델 결함 후처리 → grounding 검증
   │           (경력/스킬/업무문장 혼입 교정)
   │            └─ 통과 → 저장
   │            └─ 실패 → ▼
   └─ 실패/검증탈락 → selfRules 규칙엔진(결정론) → 저장
```

:::warning 소형모델 결함 후처리 — 설계의 백미
작은 파인튜닝 R1 모델은 알려진 오류가 있다. B는 그걸 결정론 코드로 교정한다.
- `reconcileExperienceLevel`: "경력 5년↑"을 JUNIOR로 오분류 → 정규식으로 연차를 파싱해 보정
- `filterSkillItems`: "결제 시스템 백엔드 API 설계 및 개발" 같은 **업무 문장**이 스킬에 섞임 → 길이·단어수·패턴으로 제거
- `validateGrounding`: 추출 스킬이 원문에 없으면 폴백

"왜 작은 모델을 쓰면서 품질을 유지하나?"의 답이 바로 이 후처리다.
:::

자세히: [자체 LLM 전략](/ai/self-llm-strategy) · [프롬프트 카탈로그](/ai/prompt-catalog) · [공고 텍스트 추출·OCR](/ai/job-posting-extraction)

---

## 4. 데이터가 C·D·E로 흐르는 경계 — 출력 계약

B가 데이터 중추인 이유는, B의 산출물이 **다른 영역의 입력 계약**이기 때문이다. B는 데이터를 만들고, C·D·E는 그것을 소비한다.

```text
        ┌─────────────  영역 A (프로필)  ─────────────┐
        │  B는 A를 읽기만, 수정 금지                   │
        ▼                                              ▼
┌──────────────────  영역 B  ──────────────────┐
│  job_analysis: required_skills / preferred_skills / duties
│  company_analysis: verified_facts / interview_points
└───────┬───────────────┬───────────────┬──────────────┘
        │ (필수/우대/업무) │ (면접 포인트) │ (공고·기업 분석)
        ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐     ┌─────────┐
   │ C 적합도 │    │ D 면접   │     │ E 첨삭   │
   └─────────┘    └─────────┘     └─────────┘
   fit_analysis    면접 질문        첨삭 맥락
   (C 소유)         생성             참조
```

| 흐름 | B가 공급하는 것 | 소비처 | 상태 |
| --- | --- | --- | --- |
| B → C | `required_skills`/`preferred_skills`/`duties` | 적합도 판정 기준 | **구현** |
| B → D | (설계) `interview_points` / 기업 현황 | 면접 질문 입력 | **부분/간접** ⚠️ |
| B → E | 공고·기업 분석 전체 | 첨삭 맥락 참조 | 설계 |

:::warning ★정직한 갭 — #11 면접 포인트와 D의 연결
설계상 #11 `interview_points`는 D 면접 질문 생성의 입력이어야 한다. **하지만 실측하면 자동 파이프라인의 D 질문 생성(`createInterviewPrep`)은 `interview_points`를 직접 소비하지 않는다.** 대신 `job_analysis`의 required/preferred 스킬 + 케이스 회사/직무명으로 **하드코딩 템플릿 6문항**을 만든다.

즉 #11 산출물은 "사용자에게 보여줄 기업 분석 카드"로는 저장되지만, D 질문 생성과는 **스킬을 경유한 간접 연결**뿐이다. 면접에서 이 갭을 정직하게 말할 수 있어야 한다 — "계획은 직접 입력, 현재 구현은 스킬 기반 템플릿"이라고.
:::

자세히: [영역 C — 적합도·전략](/area-c/) · [면접 포인트 추출](/area-b/interview-points)

---

## 5. 두 진입 경로 — 둘 다 같은 엔진으로 수렴

B 분석이 실행되는 방법은 둘인데, 둘 다 결국 `BAnalysisGenerationService`라는 한 엔진을 부른다.

### 5.1 비동기 자동 파이프라인 (주 경로)

```text
공고 등록 → 추출 큐 적재 → 스케줄러 워커가 텍스트 추출 + 품질게이트
   │
   └─ PASS → ApplicationCaseAutoPipelineService.runAfterExtractionPass()
              한 트랜잭션에서:
              ① B 공고 분석   generateJobAnalysis
              ② B 기업 분석   generateCompanyAnalysis
              ③ C 적합도      createFitAnalysis
              ④ D 면접 질문   createInterviewPrep
```

프런트엔드의 핵심 설계 원칙도 여기서 나온다 — **분석 실행의 단일 진실원은 백엔드 자동 파이프라인이다.** 프런트는 `createJobAnalysis`를 직접 호출하지 않고, 추출/검수 통과를 **트리거로만** 사용한다.

### 5.2 동기 단건 재생성

`POST /job-analysis`, `POST /company-analysis` → `JobAnalysisService`/`CompanyAnalysisService`가 같은 엔진을 직접 호출. 사용자가 "다시 분석" 버튼을 눌렀을 때의 경로다.

:::tip "AI는 트랜잭션 밖" — 핵심 동시성 패턴
LLM 호출은 최대 5분 걸린다. 그 동안 DB 커넥션을 잡고 있으면 커넥션 풀이 고갈된다. 그래서 B는 **LLM 응답을 받은 뒤에만** `TransactionTemplate`으로 INSERT + 상태전이 + 로그를 한 트랜잭션에 묶는다. 실패하면 `restorePreviousStatus`로 롤백한다.
:::

자세히: [지원 건 생애주기](/area-b/application-lifecycle) · [ML 워커·비동기 큐](/area-b/ml-worker)

---

## 6. 영역 B의 시그니처 3대 설계

면접에서 B를 한 번에 설명하려면 이 세 가지를 말하면 된다.

### 6.1 공고 revision append-only + 분석 시 revision 동결
`job_posting`은 **UPDATE 메서드가 없다.** 공고를 고치면 새 revision으로 INSERT만 한다(`UNIQUE(application_case_id, revision)`). 분석할 때는 `job_posting_id`+`job_posting_revision`을 분석 시점에 **동결**한다. 덕분에 "이 분석이 어느 원문 버전 기준인지"를 못 박아 **재현성**과 **stale 판정**(공고가 바뀌면 "이전 공고 rev" 배지)을 가능케 한다. 원문이 삭제돼도 `ON DELETE SET NULL`로 분석은 보존된다.

### 6.2 기업 분석 사실/추론 분리 (환각 3중 방어)
`company_analysis`는 `verified_facts`와 `ai_inferences`를 **별도 JSON 컬럼**으로 분리한다. LLM 환각이 "검증된 사실"로 사용자에게 보이면 취업 의사결정을 왜곡하므로, **데이터 모델(별 컬럼) + 프롬프트(외부조회 금지) + 검증(원문 토큰 매칭)** 세 층에서 방어한다. 프런트도 "검증된 사실 vs AI 추론" 2분할 UI로 이를 그대로 보여준다.

### 6.3 추출 동시 실행 1건 강제
`application_case_extraction`은 생성(가상) 컬럼 `active_status_marker` + `UNIQUE(application_case_id, active_status_marker)`로 **케이스당 동시 진행 1건**을 DB 레벨에서 강제한다. 같은 공고에 OCR이 중복 실행돼 토큰·비용을 낭비하는 걸 원천 차단한다.

자세히: [공고 저장·revision](/area-b/job-posting-storage) · [기업 분석](/area-b/company-analysis) · [데이터 모델](/area-b/data-model)

---

## 7. 현재 런타임 vs 설계서 — 시점이 갈린다 (정직하게)

영역 B에는 **시기가 다른 두 1차 자료**가 공존한다. 면접에서 헷갈리지 않으려면 이 갈림을 알아야 한다.

| | 클래스 설계서(과거 진실) | 현재 런타임(현재 진실) |
| --- | --- | --- |
| LLM 경로 | OpenAI 단일 직결(기본 `gpt-5`) | **자체 호스팅 Ollama R1** + `self-rules-v1` 폴백 |
| 근거 | 설계 문서 | `application.yaml:125` `B_ANALYSIS_LOCAL_LLM_ENABLED:true`(코드 확인) |
| 시점 | 서브모듈이 과거 커밋 고정 | "B파트 자체 모델 1개로 통합" 커밋 이후 |

**결론:** 설계서가 묘사하는 "OpenAI 직결" 시대는 이미 지나갔다. 그 증거가 코드에 그대로 있다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 로컬 LLM(Ollama R1) 공고/기업 분석 | **구현·기본 ON** | `application.yaml:125`, `BLocalLlmClient` |
| `self-rules-v1` 규칙 폴백 | **구현** | `BAnalysisGenerationService` |
| LLM 출력 보정(연차/스킬/grounding) | **구현** | `reconcileExperienceLevel`/`filterSkillItems`/`validateGrounding` |
| URL SSRF 방어 | **구현(견고)** | `JobPostingTextExtractor`(사설/메타데이터 IP 차단) |
| PDF 텍스트 추출 | **구현** | Apache PDFBox `PDFTextStripper` |
| OpenAI OCR 폴백 | **구현됐으나 기본 OFF** | `application.yaml:86` `false`, allowlist 필요 |
| Python AI 워커(PaddleOCR) | **구현됐으나 기본 OFF** | `application.yaml` `ai-worker.enabled:false` |
| `jobanalysis/ai`(OpenAI/OSS provider 추상화) | **죽은 코드(미배선)** | 외부 참조 0건(Grep 재확인) |
| #11 `interview_points` → D 직접 입력 | **부분/간접** | 자동 파이프라인은 스킬 기반 템플릿 사용 |
| KLUE-RoBERTa 문장 분류 모델 | **계획**(현재는 규칙 기반) | 런타임은 `BJobSentenceClassifier`(규칙) |

:::warning 인용 시 주의값 3가지
1. 프롬프트 버전은 런타임 `b-v1`이 정답이다(코드 확인). 스토리보드의 "b-v3.2"는 `VITE_USE_MOCK` 데모 빌드 값이라 인용 금지.
2. 스토리보드 캡처 수치는 mock 데모라 실제 값이 아니다.
3. `local-llm.enabled`는 Java 기본값 false / yaml 오버라이드 true라 **"실행 기본 ON"이 정답**이다.
:::

자세히: [구현 상태·죽은 코드](/area-b/structured-output) · [자체 LLM 전략](/ai/self-llm-strategy)

---

## 8. 권장 학습 순서

처음부터 끝까지 한 흐름으로 읽으면 면접 답변이 자연스럽게 이어진다.

**1단계 — 도메인의 뼈대**
1. [지원 건 생애주기](/area-b/application-lifecycle) — 왜 공고가 아니라 지원 건인가, 상태머신
2. [데이터 모델](/area-b/data-model) — 소유 테이블 6종 + 트리 + CASCADE
3. [공고 저장·revision](/area-b/job-posting-storage) — append-only, 분석 시 동결

**2단계 — 입력 확보**
4. [텍스트 추출·OCR](/area-b/text-extraction-ocr) — PDF/OCR/URL(SSRF 방어), 품질 게이트
5. [ML 워커·비동기 큐](/area-b/ml-worker) — 스케줄러, 가상컬럼 유니크, 점유

**3단계 — AI 분석 (B의 핵심)**
6. [공고 분석](/area-b/job-analysis) — #6, 문장 분류, 소형모델 후처리
7. [필수·우대 추출](/area-b/required-preferred) — #7#8, KNOWN_SKILLS, grounding
8. [담당업무 요약](/area-b/duties-summary) — #9
9. [기업 분석](/area-b/company-analysis) — #10, 사실/추론 분리
10. [면접 포인트](/area-b/interview-points) — #11, D와의 갭
11. [구조화 출력](/area-b/structured-output) — JSON Schema 강제, 검증

**4단계 — 화면과 운영**
12. [프론트엔드 UI](/area-b/frontend-ui) — 패널 4종, stale 추적, 전역 모니터
13. [관리자 화면](/area-b/admin) — 검수·메타데이터·AI 사용량
14. [면접 플레이북](/area-b/interview-playbook) — 종합 정리

연관: [환각 방지](/ai/hallucination) · [폴백 전략](/ai/fallback) · [AI 사용량·크레딧](/ai/ai-usage-credit) · [JWT 보안](/backend/jwt-security)

---

## 9. B 면접 단골질문 5개 (요약 답안)

1. **왜 공고가 아니라 '지원 건'이 핵심 단위인가요?**
   같은 공고에 여러 번 지원하거나 여러 사람이 지원할 수 있고, 공고 원문·분석·추출은 모두 한 번의 지원 맥락에 종속됩니다. 그래서 `application_case`를 트리의 루트로 두고 모든 산출물을 CASCADE로 함께 정리합니다.

2. **AI가 공고를 그냥 요약하는 거 아닌가요?**
   아닙니다. 통째로 생성하지 않고, 원문에서 **근거를 인용하며** 필수/우대/담당업무로 구조화 추출합니다. 추출한 스킬이 원문에 실제 등장하는지 `validateGrounding`으로 검증하고, 근거 비율이 낮으면 규칙엔진으로 폴백합니다.

3. **작은 자체 모델로 어떻게 품질을 유지하나요?**
   소형 파인튜닝 R1 모델의 알려진 오류(경력 오분류, 스킬에 업무문장 혼입)를 결정론 코드로 후처리합니다. 정규식으로 연차를 보정하고, 길이·패턴으로 업무문장을 걸러내고, grounding으로 환각을 막습니다.

4. **기업 분석 LLM이 거짓 정보를 사실처럼 말하면요?**
   세 층에서 막습니다 — 데이터 모델은 `verified_facts`와 `ai_inferences`를 별도 컬럼으로 분리하고, 프롬프트는 외부 웹 검색과 내부지식 사용을 금지하고, 검증은 회사 사실이 입력에서 직접 확인되는지 체크합니다.

5. **B 데이터가 다른 영역으로 어떻게 흘러가나요?**
   `required_skills`/`preferred_skills`/`duties`는 C 적합도 판정 기준이 되고, 공고·기업 분석은 E 첨삭 맥락이 됩니다. D 면접은 설계상 `interview_points`를 쓰려 했지만, 현재 구현은 스킬 기반 템플릿을 쓰는 간접 연결입니다(정직한 갭).

---

## 10. 직접 말해보기

다음을 보지 않고 60초 안에 말할 수 있으면 B 개요는 합격이다.

- **핵심 단위가 지원 건**인 이유와, 그 아래 매달리는 5개 테이블
- B의 철학 한 문장 — **"생성이 아니라 근거 인용 구조화 추출"**
- 담당 AI **#6~11**이 **단 2번의 LLM 호출**로 산출된다는 점
- 데이터가 **C·D·E로 흐르는 경계**와, **#11→D의 정직한 갭**
- 시그니처 3대 설계 — **revision 동결 / 사실·추론 분리 / 추출 1건 강제**
- 현재 런타임이 **자체 LLM 기본 ON**이고, 설계서의 OpenAI 직결은 지난 시점이라는 것

---

## 퀴즈

<QuizBox question="영역 B에서 데이터 트리의 '루트(핵심 단위)'에 해당하는 것은?" :choices="['job_posting (공고 원문)', 'application_case (지원 건)', 'job_analysis (공고 분석)', 'company_analysis (기업 분석)']" :answer="1" explanation="CareerTuner의 핵심 단위는 공고가 아니라 지원 건(application_case)이다. 공고 원문·공고 분석·기업 분석·추출 잡이 모두 이 지원 건에 종속되며 ON DELETE CASCADE로 함께 정리된다." />

<QuizBox question="영역 B의 '구조화 추출' 철학을 가장 정확히 설명한 것은?" :choices="['공고문 전체를 LLM이 더 읽기 좋게 새로 생성한다', '공고 텍스트를 문장 단위로 쪼개 필수/우대/담당업무로 분류·추출하며 원문 근거를 검증한다', '공고를 임베딩해 벡터 DB에 저장만 한다', '관리자가 수작업으로 조건을 입력한다']" :answer="1" explanation="B는 공고를 통째로 생성형으로 대체하지 않는다. OCR로 텍스트를 확보한 뒤 문장을 분류하고 조건을 구조화 추출하며, validateGrounding으로 추출 결과가 원문에 실제 등장하는지 검증해 환각을 막는다." />

<QuizBox question="자동 파이프라인에서 D(면접 질문) 생성과 #11 interview_points의 실제 관계는?" :choices="['interview_points를 그대로 D 질문으로 사용한다', 'interview_points를 직접 소비하지 않고, job_analysis의 스킬 기반 템플릿으로 질문을 만든다', 'D는 B 데이터를 전혀 쓰지 않는다', 'interview_points가 없으면 D 분석이 실패한다']" :answer="1" explanation="설계상으로는 #11이 D의 입력이어야 하지만, 실측하면 createInterviewPrep은 interview_points를 직접 쓰지 않고 required/preferred 스킬과 회사·직무명으로 하드코딩 템플릿 6문항을 만든다. '계획 vs 구현'의 정직한 갭으로 기술해야 한다." />
