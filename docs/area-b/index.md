# 영역 B 개요 — 지원건·공고·기업분석 (AI #6-11)

> 영역 B는 "**이 공고가 무엇을 요구하는가**"를 기계가 읽을 수 있는 구조로 바꾸는 영역이다. 사용자가 올린 공고 원문(텍스트·PDF·URL)을 추출·저장하고, LLM으로 필수/우대 조건·담당 업무·기업 현황·면접 포인트를 구조화해, 그 결과를 C·D·E가 읽기 전용으로 가져다 쓰게 만든다. 핵심 단위는 공고가 아니라 **지원 건(Application Case)** 이다.

상단 길잡이: [영역별 심화 전체 개요](/areas/) · 인접 영역 [영역 A 개요](/area-a/) · [영역 C 개요](/area-c/) · 전체 그림 [전체 흐름](/flow/) · [AI #1-34 맵](/flow/ai-function-map)

---

## 1. 이 영역이 책임지는 것 — 정체성

영역 B를 한 문장으로 정의하면 이렇다.

> **B는 "지원 건(Application Case)"을 도메인 루트로 삼아, 공고 원문을 수집·저장하고 LLM으로 구조화해 다른 영역이 읽을 수 있는 분석 데이터로 가공하는 영역이다.**

여기서 두 가지가 정체성을 가른다.

- **단위가 "공고"가 아니라 "지원 건"이다.** 같은 채용공고라도 사람마다·시점마다 분석·전략·면접 준비가 다르다. 그래서 공고 원문·공고 분석·기업 분석·추출 잡이 모두 하나의 `application_case`에 매달려 함께 생기고 함께 정리된다. 이것을 DB로 강제한 것이 자식 테이블의 `application_case_id` FK + `ON DELETE CASCADE`다.
- **B는 "텍스트를 구조로 바꾸는" 변환 계층이다.** 사람이 읽는 공고문은 길고 산만하다. B는 이것을 `required_skills`/`preferred_skills`/`duties` 같은 **배열·필드**로 쪼개, 점수 계산(C)·질문 생성(D)·첨삭(E)이 곧바로 입력으로 쓸 수 있는 형태로 만든다.

그래서 B의 출력 품질은 그대로 하류 영역의 품질이 된다. 필수/우대 조건 추출이 부정확하면 C의 적합도 점수가 흔들리고, 담당 업무 요약이 빈약하면 D의 면접 질문이 얕아진다.

:::tip 이 페이지가 답하는 면접 질문
"영역 B가 정확히 뭘 하나요?" / "공고를 어떻게 저장하고, 바뀌면 어떻게 되나요?" / "B가 만든 데이터를 누가 쓰나요?" — 이 개요를 막힘없이 말할 수 있으면, 세부 페이지는 디테일을 채우는 역할이다.
:::

---

## 2. 6개 영역 속에서 B의 위치

CareerTuner는 6명이 한 지원 건을 **수직 분담**으로 함께 채운다. A~F 여섯 영역과 각자의 AI 번호는 다음과 같다.

| 영역 | 책임 범위 | AI 번호 | 대표 산출물 | 개요 |
| --- | --- | --- | --- | --- |
| A | 회원·프로필·인증 | #1~5 | 프로필 요약·기술스택·완성도 | [/area-a/](/area-a/) |
| **B** | **지원건·공고·기업분석** | **#6~11** | **공고 구조화·필수/우대·면접포인트** | **현재 페이지** |
| C | 적합도·전략·대시보드 | #12~18 | 적합도 점수+근거+다음행동 | [/area-c/](/area-c/) |
| D | 가상 면접·리포트 | #19~23 | 예상질문·답변평가·리포트 | [/area-d/](/area-d/) |
| E | 첨삭·결제·크레딧 | #24~28 | 원문 비수정 개선안·요금추천 | [/area-e/](/area-e/) |
| F | 커뮤니티·고객센터·챗봇 | #29~34 | 후기요약·실제질문·문의초안 | [/area-f/](/area-f/) |

### 데이터가 어디서 와서 어디로 가나

B는 흐름의 **앞단 입력 생성자**다. A가 만든 사람 데이터와 만나, C·D·E가 소비할 공고 데이터를 만든다.

```text
        [A user_profile]                         (읽기 전용 참조)
              │ 스펙 원천(읽기 전용)
              ▼
   ┌───────────────────────── 영역 B (소유·쓰기) ─────────────────────────┐
   │  application_case (루트) · job_posting(revision) ·                     │
   │  job_analysis(#6~9) · company_analysis(#10~11) ·                       │
   │  application_case_extraction(추출 큐)                                   │
   └───────────────┬───────────────────────────────────────────────────────┘
                   │ job_analysis · company_analysis = 읽기 전용 참조
        ┌──────────┼─────────────────┬──────────────────┐
        ▼          ▼                 ▼                  ▼
   C 적합도    D 면접 질문        E 첨삭             (분석 시점 revision 동결)
   (필수/우대  (담당업무·         (공고 맥락
    채점기준)   면접포인트 입력)    참조)
```

- **B가 읽어 오는 것(원천, 읽기 전용):** A의 `user_profile` 등 사람 데이터는 B가 직접 수정하지 않는다. B는 공고 쪽 데이터만 소유한다.
- **B가 소유(쓰기)하는 것:** `application_case`·`job_posting`·`job_analysis`·`company_analysis`·`application_case_extraction`.
- **B의 출력을 읽는 곳:** C(필수/우대를 적합도 채점 기준으로), D(담당 업무·면접 포인트를 질문 입력으로), E(공고 맥락을 첨삭 참조로). 이들은 모두 **B 원본을 수정하지 않고 읽기만** 한다.

:::tip 읽기전용 경계 한 문장
"B는 공고·기업 분석의 **단일 쓰기 책임자**이고, C·D·E는 B 분석의 **읽기 소비자**입니다. 그래서 '이 공고가 뭘 요구하는지'에 대한 정합성 책임이 한 곳으로 모입니다."
:::

전체 의존 그래프에서 B의 출력이 누구의 입력이 되는지는 [AI #1-34 맵](/flow/ai-function-map)과 [데이터 소유권](/flow/data-ownership)에서 영역 간 화살표로 본다. 지원 건이라는 단위 자체는 [사용자 여정](/flow/user-journey) 흐름과 함께 보면 이해가 빠르다.

---

## 3. 담당 AI 기능 #6~11

B는 6개의 AI 기능을 소유한다. 주의할 점은 이들이 **6번의 LLM 호출로 흩어져 있지 않다**는 것이다. #6~9는 공고 분석 한 번에 묶여 함께 나오고, #10~11은 기업 분석 호출에서 함께 나온다.

| # | 기능 | 한 줄 설명 | 산출물 / 저장 위치 | 세부 페이지 |
| --- | --- | --- | --- | --- |
| 6 | 공고문 구조화 분석 | 공고 원문을 통째 생성하지 않고 문장을 라벨링→JSON Schema로 채움 | `job_analysis` 행 | [공고문 AI 분석](/area-b/job-analysis) |
| 7 | 필수 조건 추출 | "반드시 충족" 역량을 별도 배열로 분리 | `required_skills` (JSON) | [필수·우대 조건](/area-b/required-preferred) |
| 8 | 우대 조건 추출 | "있으면 가산" 역량을 별도 배열로 분리 | `preferred_skills` (JSON) | [필수·우대 조건](/area-b/required-preferred) |
| 9 | 담당 업무 요약 | 산만한 업무 설명을 짧은 텍스트로 정제 | `job_analysis.duties` | [담당 업무 요약](/area-b/duties-summary) |
| 10 | 기업 현황 요약 | 공고 한 장으로 사업·산업·이슈 요약, 사실/추론 분리 | `company_analysis` 행 | [기업 현황 요약](/area-b/company-analysis) |
| 11 | 면접 포인트 추출 | 공고+기업분석을 묶어 면접 검증 포인트 생성 | `company_analysis.interview_points` | [면접 포인트](/area-b/interview-points) |

:::warning 호출 단위와 "구현됨 vs 계획"을 정직하게
- **#7·#8·#9는 #6 한 번의 호출(`generateJobAnalysis`)에서 함께 나오는 필드**다. 독립 엔드포인트로 6번 부르는 구조가 아니다.
- **#11(면접 포인트)이 D(면접 질문)의 입력으로 직접 들어가는지는 계획과 구현이 갈린다.** 데이터는 `company_analysis.interview_points`에 저장되지만, D가 이를 직접 소비하는 배선은 페이지 단위로 정직하게 구분해 설명한다. "B 면접포인트가 D로 자동으로 흐른다"고 단정하기 전에 [면접 포인트](/area-b/interview-points) 페이지의 구현 상태를 확인하라.

AI 제공자는 공통 폴백 체계를 따른다(자체 OSS → Anthropic Haiku `claude-haiku-4-5` → OpenAI `gpt-5` → Mock). 키 미발급 환경에서는 Mock/규칙 기반 결과로 결정론적으로 동작한다. 폴백 공통 원리는 [AI 오케스트레이터](/flow/ai-orchestrator)를 참고.
:::

---

## 4. 권장 학습 순서

B는 "입력을 어떻게 받고 저장하나 → LLM으로 어떻게 구조화하나 → 화면·운영"의 순서로 보면 의존관계가 자연스럽게 풀린다. 아래 하위 페이지들을 4개 묶음으로 안내한다.

**1단계 — 도메인의 뼈대 (지원 건·공고 저장)**
공고가 어떻게 들어오고, 바뀌면 어떻게 보존되는지부터 잡는다.
1. [지원 건 생명주기](/area-b/application-lifecycle) — `DRAFT → ANALYZING → READY → APPLIED → CLOSED` 상태머신. 모든 것의 루트.
2. [공고 원문 저장 · revision](/area-b/job-posting-storage) — 덮어쓰지 않고 버전을 쌓는 append-only 설계.
3. [데이터 모델 · revision 정합성](/area-b/data-model) — 지원 건 트리 + CASCADE, 분석 시점 revision 동결.

**2단계 — 입력 텍스트 만들기 (추출 파이프라인)**
LLM에 넣을 "입력 텍스트"를 어떻게 안전하게 뽑아내는지.
4. [텍스트 추출 — PDFBox · Jsoup · OCR · SSRF](/area-b/text-extraction-ocr) — PDF 직독, URL 크롤, 스캔본 OCR 폴백, SSRF 방어.
5. [공고 추출 워커 — Python 분리](/area-b/ml-worker) — OCR 의존성을 JVM 밖 별도 Python 프로세스로 떼어낸 이유.

**3단계 — AI 구조화 (B의 핵심 기능 #6~11)**
텍스트를 점수·질문이 바로 쓸 수 있는 구조로 바꾸는 단계.
6. [공고문 AI 분석 #6](/area-b/job-analysis) — 라벨링 + JSON Schema + 환각 후처리 파이프라인.
7. [필수·우대 조건 #7·#8](/area-b/required-preferred) — 두 배열 분리 추출. C 적합도의 채점 기준.
8. [담당 업무 요약 #9](/area-b/duties-summary) — `duties` 필드 정제.
9. [기업 현황 요약 #10](/area-b/company-analysis) — 검증된 사실 vs AI 추론 컬럼 분리.
10. [면접 포인트 #11](/area-b/interview-points) — 면접 검증 포인트, D 연결의 계획/구현 구분.
11. [구조화 추출 · 프롬프트 카탈로그](/area-b/structured-output) — JSON Schema 강제와 프롬프트 카탈로그.

**4단계 — 화면·운영·면접 정리**
사용자/관리자 화면과 종합 답안집.
12. [프론트엔드 UI/UX](/area-b/frontend-ui) — 탭별 페치, 백엔드 자동 파이프라인 트리거.
13. [관리자 화면 & 운영](/area-b/admin) — 읽기·검수·신선도·실패 추적.
14. [영역 B 면접 플레이북](/area-b/interview-playbook) — B 전체를 1분/3분 답변으로 압축.

곁다리로 전체 그림이 궁금하면 [아키텍처](/flow/architecture) · [AI 오케스트레이터](/flow/ai-orchestrator)를, 다른 영역과의 연결은 [영역 C 개요](/area-c/)(적합도가 B 필수/우대를 어떻게 소비하는지)와 [데이터 소유권](/flow/data-ownership)을 함께 보면 좋다.

---

## 5. 이 영역 단골 면접 질문 5개

B를 물어볼 때 반복되는 다섯 질문과 핵심 답의 방향이다. 상세 모범답안은 각 세부 페이지와 [면접 플레이북](/area-b/interview-playbook)에 있다.

**Q1. 왜 "공고"가 아니라 "지원 건"이 루트인가요?**
같은 공고라도 사람마다·시점마다 분석·전략·면접 준비가 다르기 때문입니다. 그래서 공고 원문·분석·추출이 전부 하나의 `application_case`에 매달려 함께 생기고 함께 삭제됩니다. 이걸 DB로 강제한 게 자식 테이블의 `application_case_id` FK + `ON DELETE CASCADE`입니다.

**Q2. 공고가 수정되면 이전 분석은 어떻게 되나요? 덮어쓰나요?**
덮어쓰지 않습니다. `job_posting`은 **append-only**라서, 공고가 바뀌면 같은 케이스 안에서 `revision`을 올려 새 행으로 INSERT합니다. 그리고 분석은 생성 시점에 본 공고의 `job_posting_id`와 `job_posting_revision`을 함께 저장(동결)합니다. 덕분에 "이 분석은 어느 버전 기준인지"를 재현할 수 있고, 최신 revision과 비교해 stale(낡음) 판정도 가능합니다.

**Q3. 공고 텍스트는 어떻게 추출하나요? PDF·URL·이미지를 다 받는데요.**
입력 종류별로 경로가 다릅니다. PDF는 PDFBox로 직접 읽고, URL은 직접 HTTP + Jsoup으로 본문을 긁고, 이미지/스캔 PDF만 OCR로 폴백합니다. URL 추출 경로 전체는 SSRF(내부망 요청 위조)로부터 방어합니다. 그리고 무거운 OCR 의존성은 JVM이 아니라 별도 Python 워커(`POST /extract/job-posting`)로 떼어냈습니다.

**Q4. LLM이 공고를 분석할 때 환각으로 없는 조건을 만들지 않나요?**
세 층으로 막습니다. (1) **데이터 모델** — 기업 분석은 `verified_facts`(검증된 사실)와 `ai_inferences`(AI 추론)를 컬럼 단위로 분리해 추론이 사실로 보이지 않게 합니다. (2) **프롬프트** — 공고를 통째 생성하는 게 아니라 문장을 라벨링한 뒤 JSON Schema에 맞춰 채우게 합니다. (3) **후처리** — 코드가 환각·오분류를 깎아내고 사용자 확정 단계를 둡니다.

**Q5. B가 만든 데이터를 누가, 어떻게 쓰나요?**
C·D·E가 **읽기 전용**으로 씁니다. C는 `required_skills`/`preferred_skills`를 적합도 채점 기준으로, D는 담당 업무·면접 포인트를 질문 입력으로, E는 공고 맥락을 첨삭 참조로 가져갑니다. 이들은 B 원본을 절대 수정하지 않습니다. 그래서 "이 공고가 뭘 요구하는가"의 단일 진실원이 B 한 곳으로 유지됩니다.

---

## 퀴즈

<QuizBox question="영역 B에서 도메인의 루트(최상위 단위)는 무엇인가?" :choices="['job_posting(공고 원문)', 'application_case(지원 건)', 'company_analysis(기업 분석)', 'user_profile(프로필)']" :answer="1" explanation="CareerTuner의 핵심 단위는 공고가 아니라 지원 건(application_case)이다. 공고 원문·공고 분석·기업 분석·추출 잡이 모두 application_case_id FK로 매달려 ON DELETE CASCADE로 함께 정리된다." />

<QuizBox question="공고가 다시 업로드되어 내용이 바뀌었을 때 B의 처리 방식으로 옳은 것은?" :choices="['기존 job_posting 행을 UPDATE로 덮어쓴다', 'revision을 올려 새 행으로 INSERT하고 기존 행은 보존한다', '이전 분석을 즉시 삭제한다', '새 application_case를 별도로 만든다']" :answer="1" explanation="job_posting은 append-only다. 공고가 바뀌면 같은 케이스 안에서 revision을 1 올려 새 행으로 INSERT하고 기존 행은 그대로 둔다. 분석은 생성 시점의 job_posting_id+job_posting_revision을 동결해 재현성과 stale 판정을 보장한다." />

<QuizBox question="영역 B의 AI 기능 #7(필수 조건)·#8(우대 조건)·#9(담당 업무)에 대한 설명으로 가장 정확한 것은?" :choices="['각각 독립된 별도 LLM 호출로 3번 호출된다', '공고 분석 한 번(#6, generateJobAnalysis)의 출력 필드로 함께 나온다', '관리자가 수동으로 입력한다', 'C 적합도 분석이 대신 생성한다']" :answer="1" explanation="#7·#8·#9는 #6 공고 분석 한 번의 호출에서 함께 채워지는 필드다. 필수/우대는 별도 배열(required_skills/preferred_skills)로, 담당 업무는 duties 텍스트로 한 번에 나온다. 이 출력은 C 적합도의 채점 기준이 된다." />
