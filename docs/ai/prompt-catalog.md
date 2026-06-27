# 프롬프트 카탈로그 패턴

> LLM에게 보내는 시스템 프롬프트를 코드 곳곳에 문자열로 흩뿌리지 않고, 도메인별 "카탈로그 클래스" 한 곳에 상수와 빌더 메서드로 모아 버전·일관성·테스트를 관리하는 패턴입니다.

## 1. 한 줄 정의

프롬프트 카탈로그 패턴은 **도메인마다 시스템 프롬프트·사용자 프롬프트 빌더·프롬프트 버전을 담는 전용 클래스(`*PromptCatalog`)를 두고**, AI 서비스가 그 상수만 가져다 쓰게 하는 구조입니다.

## 2. 단어 뜻 (약자/어원 풀이)

| 단어 | 뜻 | CareerTuner에서 |
| --- | --- | --- |
| 프롬프트(Prompt) | LLM에게 주는 지시문. `system`(역할·규칙)과 `user`(실제 입력)로 나뉨 | `SYSTEM_PROMPT` 상수, `userPrompt(...)` 메서드 |
| 카탈로그(Catalog) | "목록·도감". 같은 종류를 한곳에 정리한 모음 | 도메인별 프롬프트를 모은 클래스 |
| 시스템 프롬프트 | 모델의 역할·출력 규칙을 고정하는 머리말 | "너는 ~ 분석가다. 한국어로, JSON 스키마에 맞는 결과만 생성한다" |
| 사용자 프롬프트 | 매 호출마다 달라지는 실제 데이터(공고·프로필 등) | `String.format` 으로 값을 채워 만든 본문 |
| 버전(Version) | 프롬프트 개정 버전 식별자 | `public static final String VERSION = "v0.2";` |

"카탈로그"라는 이름은 GoF 디자인 패턴이 아니라 **CareerTuner 내부에서 합의한 명명 규칙**입니다. 본질은 "프롬프트를 상수로 외부화(externalize)한 모음 클래스"입니다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

프롬프트를 서비스 코드 안에 인라인 문자열로 박으면 다음 문제가 생깁니다.

- **일관성 붕괴**: 같은 도메인을 여러 곳에서 호출하면 프롬프트가 미묘하게 갈라집니다. OpenAI 호출과 자체모델(OSS) 호출이 서로 다른 규칙을 쓰면 결과가 달라집니다.
- **버전 추적 불가**: "이 분석 결과는 어떤 프롬프트로 나왔나"를 알 수 없습니다. 프롬프트를 고치면 과거 결과와 비교가 안 됩니다.
- **테스트 곤란**: 프롬프트 텍스트를 단위 테스트로 검증하거나, 빌더가 입력을 제대로 채우는지 확인하기 어렵습니다.
- **train/serve skew**: 자체 LLM을 파인튜닝할 때, 학습 데이터의 system 메시지와 서빙 시 보내는 system 메시지가 다르면 모델 성능이 무너집니다. 두 곳이 같은 한 문자열을 참조해야 안전합니다.

카탈로그로 모으면 **프롬프트가 "코드 자산"이 되어** Git diff로 변경 이력이 남고, 상수 한 곳만 고치면 모든 호출처에 반영되며, 버전 문자열을 결과에 함께 저장할 수 있습니다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영역 C(본인 담당)가 만든 분석 계열 프롬프트가 이 패턴을 따릅니다. 도메인별로 1클래스 1카탈로그입니다.

| 카탈로그 클래스 | 패키지/영역 | 역할 | 소비 서비스 |
| --- | --- | --- | --- |
| `FitAnalysisPromptCatalog` | `fitanalysis.ai.prompt` (C) | 적합도 분석 system + userPrompt + FIT_EXPLAIN | `OpenAiFitAnalysisAiService`, `OssFitAnalysisAiService` |
| `CareerTrendPromptCatalog` | `analysis.ai.prompt` (C) | 장기 취업경향·다음 방향 | `OpenAiCareerTrendAiService` |
| `DashboardInsightPromptCatalog` | `dashboard.ai.prompt` (C) | 대시보드 한 문단 요약 | `OpenAiDashboardInsightAiService` |
| `JobAnalysisPromptCatalog` | `jobanalysis.ai.prompt` (B) | 공고 분석 + `view()` 관리자 노출 | `OpenAiResponsesClient`, `OssJobAnalysisClient` |
| `CompanyAnalysisPromptCatalog` | `companyanalysis.ai.prompt` (B) | 기업 분석 | `OpenAiResponsesClient`, `BAnalysisGenerationService` |

설계 규칙(실제 코드 주석에 명시):

- **공통 엔진은 팀장 소유**: `com.careertuner.ai.prompt` 패키지(`package-info.java`)와 `ai/common` 은 공통 프롬프트 엔진 영역으로 **팀장 소유**입니다. 각 카탈로그는 자기 도메인 하위 폴더(`<도메인>/ai/prompt/`)에만 둡니다. (AGENTS.md의 공통 영역 합의 규칙)
- **버전 영속화**: `FitAnalysisServiceImpl` 이 결과를 `fit_analysis` 테이블에 저장할 때 `.promptVersion(FitAnalysisPromptCatalog.VERSION)` 로 **그 결과를 만든 프롬프트 버전을 함께 기록**합니다. `CareerAnalysisRunService` 도 `career_analysis_run` 에 동일하게 버전을 남깁니다.

:::tip 구현 vs 설계 구분
적합도·취업경향·대시보드 카탈로그는 **구현되어 동작 중**입니다. `FIT_EXPLAIN_SYSTEM_PROMPT` 와 `fitExplainUserPrompt(...)` 는 **자체 파인튜닝 모델용으로 정의는 되어 있으나, 학습 데이터(`ml/career-strategy-llm`)와 자체 LLM 서빙은 아직 설계/계획 단계**입니다. 상수는 학습 스크립트와 정합을 맞추기 위해 미리 고정해 둔 것입니다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 카탈로그 클래스의 형태

```java
public final class FitAnalysisPromptCatalog {
    public static final String VERSION = "v0.2";   // 1) 버전 상수

    private FitAnalysisPromptCatalog() {}           // 2) 인스턴스화 금지 (정적 유틸)

    public static final String SYSTEM_PROMPT = """  // 3) 역할·규칙 고정
            너는 채용 공고 요구 조건과 지원자 스펙을 비교하는 커리어 적합도 분석가다.
            반드시 한국어로, 주어진 JSON 스키마에 맞는 결과만 생성한다.
            ... (fitScore는 0~100, applyDecision은 APPLY/COMPLEMENT/HOLD 중 하나 등)
            """;

    public static String userPrompt(String companyName, String jobTitle, ...) {  // 4) 빌더
        return """
                [공고] 회사: %s / 직무: %s ...
                위 정보를 비교해 적합도 분석 결과를 생성하라.
                """.formatted(safe(companyName), safe(jobTitle), ...);
    }

    private static String safe(String v) {          // 5) 빈 값 방어
        return v == null || v.isBlank() ? "(정보 없음)" : v.trim();
    }
}
```

### 설계 포인트 5가지

| 요소 | 이유 |
| --- | --- |
| `final class` + `private` 생성자 | 상태 없는 정적 유틸. 잘못 `new` 하지 못하게 막음 |
| `VERSION` 상수 | 결과 테이블(`fit_analysis.prompt_version`)에 함께 저장 → 추적성 |
| `SYSTEM_PROMPT` 상수 | 모든 호출처가 **같은 한 문자열**을 참조 → 일관성·train/serve 정합 |
| `userPrompt(...)` 빌더 | 가변 입력만 받아 텍스트 골격에 채움. 텍스트 골격은 고정 |
| `safe(...)` 정규화 | null/공백을 `(정보 없음)` 으로 바꿔 LLM에 빈 칸을 그대로 노출하지 않음 |

### 호출 흐름

```text
AI 서비스 (예: OpenAiFitAnalysisAiService)
   ├─ FitAnalysisPromptCatalog.SYSTEM_PROMPT      (역할·규칙)
   └─ FitAnalysisPromptCatalog.userPrompt(공고,프로필) (이번 입력)
        ↓ structured output 요청
   OpenAI / Ollama 클라이언트
        ↓
   결과 저장 시 .promptVersion(FitAnalysisPromptCatalog.VERSION)
        ↓
   fit_analysis 테이블 (prompt_version 컬럼 함께 기록)
```

한 카탈로그를 **여러 백엔드가 공유**하는 점이 핵심입니다. 예를 들어 `FitAnalysisPromptCatalog.SYSTEM_PROMPT` 는 OpenAI 경로(`OpenAiFitAnalysisAiService`)와 자체모델 경로(`OssFitAnalysisAiService`)가 같이 참조해, 어느 백엔드를 타든 모델의 역할 정의가 동일합니다.

### 관리자 노출 (확장형)

`JobAnalysisPromptCatalog` 는 `AdminPromptView view()` 메서드를 추가해, 프롬프트 자체를 관리자 화면에서 조회할 수 있게 합니다. 카탈로그가 단순 상수 모음을 넘어 **운영 가시성의 단일 출처**가 되는 형태입니다.

```java
public static AdminPromptView view() {
    return new AdminPromptView(FEATURE, "공고 분석 프롬프트", VERSION, ..., SYSTEM_PROMPT, SCHEMA_SUMMARY);
}
```

## 6. 면접 답변 3단계

**초간단(1문장):** "LLM 프롬프트를 코드에 흩어 두지 않고 도메인별 `*PromptCatalog` 클래스에 시스템 프롬프트·빌더·버전으로 모아, 일관성과 버전 추적을 확보한 패턴입니다."

**기본:** "CareerTuner의 적합도·취업경향·대시보드 같은 AI 기능마다 `FitAnalysisPromptCatalog` 처럼 전용 카탈로그 클래스를 뒀습니다. 시스템 프롬프트는 `public static final` 상수로, 사용자 프롬프트는 입력을 받아 채우는 빌더 메서드로 둡니다. AI 서비스는 이 상수만 가져다 쓰니, OpenAI 경로와 자체모델 경로가 같은 프롬프트를 공유하고, 결과를 DB에 저장할 때 `VERSION` 을 함께 기록해 어떤 프롬프트로 나온 결과인지 추적할 수 있습니다."

**꼬리질문 대응:** "프롬프트도 코드 자산으로 봅니다. 한 곳에 모으니 Git diff로 개정 이력이 남고, 빌더와 빈 값 정규화(`safe`)를 단위 테스트로 검증할 수 있습니다. 공통 프롬프트 엔진(`ai/prompt`, `ai/common`)은 팀 합의상 팀장 소유라 각 도메인 카탈로그는 자기 패키지 하위에만 두는 소유권 경계도 지켰습니다. 자체 파인튜닝 모델을 붙일 때는 학습 데이터의 system 메시지와 서빙 system 메시지가 동일 상수를 참조하게 해 train/serve skew를 막도록 설계했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 그냥 properties 파일이나 DB에 프롬프트를 두면 안 되나요?
가능하지만 트레이드오프가 있습니다. 외부 파일/DB는 재배포 없이 수정할 수 있는 대신, **컴파일 타임 타입 안정성·IDE 추적·테스트 용이성**을 잃습니다. CareerTuner는 프롬프트를 코드 자산으로 취급해 Git 이력·코드리뷰·단위 테스트의 이점을 택했습니다. 운영 중 비개발자가 수정해야 하는 요구가 생기면 `AdminPromptView` 처럼 조회를 먼저 열고, 편집은 별도 검증 파이프라인을 붙이는 방향으로 확장할 수 있습니다.
:::

:::details Q2. system 프롬프트와 user 프롬프트를 왜 나눕니까?
system은 **역할과 출력 규칙처럼 매 호출 고정되는 부분**, user는 **공고·프로필처럼 매번 바뀌는 입력**입니다. 분리하면 system을 상수로 고정해 일관성을 보장하고, user만 빌더로 동적 생성해 변경 지점을 좁힐 수 있습니다. LLM API 자체도 두 역할을 구분해 받으므로 자연스러운 매핑입니다.
:::

:::details Q3. VERSION 문자열은 실제로 어디에 쓰입니까?
결과 영속화 시 함께 저장합니다. `FitAnalysisServiceImpl` 이 `fit_analysis` 행을 만들 때 `.promptVersion(FitAnalysisPromptCatalog.VERSION)` 로 기록하고, `CareerAnalysisRunService` 는 `career_analysis_run` 에 남깁니다. 덕분에 "이 분석은 v0.2 프롬프트로 생성됐다"가 데이터에 박혀, 프롬프트 개정 후 결과 품질을 버전별로 비교·롤백 판단할 수 있습니다.
:::

:::details Q4. train/serve skew를 어떻게 막습니까?
자체 파인튜닝 모델용 `FIT_EXPLAIN_SYSTEM_PROMPT` 상수가 학습 데이터 생성 스크립트(`ml/career-strategy-llm`의 system 메시지)와 **같은 텍스트**가 되도록 한 출처로 고정합니다. 학습 때 본 system 문장과 서빙 때 보내는 system 문장이 동일해야 모델이 분포 변화를 겪지 않습니다. 이 모델 서빙은 아직 설계 단계지만, 상수를 미리 맞춰 두는 것이 카탈로그 패턴의 확장 포인트입니다.
:::

:::details Q5. LLM이 규칙을 어겨도 그대로 사용자에게 나가나요?
아니요. 프롬프트는 "지시"일 뿐 강제력이 없어 보강합니다. 예: 적합도에서 `applyDecision` 을 받은 뒤 서버가 `guardApplyDecision` 으로 "70점 이상 & 필수 미충족 0개"가 아니면 `APPLY` 를 `COMPLEMENT` 로 강등하는 가드레일을 둡니다. 점수·판정은 서버 규칙·검증으로 확정하고, LLM에는 설명·근거 생성을 맡기는 역할 분리(뉴로-심볼릭)입니다.
:::

## 8. 직접 말해보기

1. "왜 프롬프트를 서비스 코드에 인라인으로 두지 않고 카탈로그 클래스로 빼냈는지, 일관성·버전 추적·테스트 세 관점에서 30초로 설명해 보세요."
2. "`FitAnalysisPromptCatalog.VERSION` 이 `fit_analysis` 테이블에 같이 저장되는 게 운영에서 어떤 실익을 주는지 한 가지 시나리오로 말해 보세요."

연관 개념: [DTO](/glossary/dto) · [JWT 보안](/backend/jwt-security)

## 퀴즈

<QuizBox question="프롬프트 카탈로그 패턴에서 SYSTEM_PROMPT를 public static final 상수로 두는 가장 큰 이유는?" :choices="['배포 없이 런타임에 수정하려고', '여러 호출처가 같은 한 문자열을 참조해 프롬프트 일관성을 보장하려고', 'LLM 응답 속도를 높이려고', 'DB 부하를 줄이려고']" :answer="1" explanation="상수를 한 곳에 두면 OpenAI 경로와 자체모델 경로 등 모든 호출처가 동일한 system 프롬프트를 공유해, 도메인 규칙이 갈라지지 않습니다. 런타임 수정은 오히려 컴파일 타임 추적성과 트레이드오프 관계입니다." />

<QuizBox question="CareerTuner에서 FitAnalysisPromptCatalog.VERSION 값은 결과 저장 시 어떻게 활용되나?" :choices="['JWT 토큰에 서명할 때 사용', 'fit_analysis 테이블에 promptVersion으로 함께 저장돼 어떤 프롬프트로 나온 결과인지 추적', 'CORS 허용 오리진 목록에 추가', '프론트 라우팅 키로 사용']" :answer="1" explanation="FitAnalysisServiceImpl이 결과 행을 만들 때 .promptVersion(FitAnalysisPromptCatalog.VERSION)으로 기록합니다. 프롬프트 개정 후 버전별 품질 비교와 롤백 판단의 근거가 됩니다." />

<QuizBox question="자체 파인튜닝 모델용 FIT_EXPLAIN_SYSTEM_PROMPT를 학습 스크립트의 system 메시지와 동일한 한 출처로 고정하는 이유를 한 문단으로 설명하라." explanation="학습 때 모델이 본 system 문장과 서빙 때 보내는 system 문장이 다르면 입력 분포가 어긋나 성능이 무너지는 train/serve skew가 발생합니다. 동일 상수를 양쪽이 참조하게 하면 학습·서빙 프롬프트가 항상 일치해 이 불일치를 원천 차단할 수 있고, 프롬프트 카탈로그가 그 단일 출처 역할을 합니다. CareerTuner에서 자체 LLM 서빙 자체는 아직 설계 단계지만 상수를 미리 맞춰 둔 것이 이 확장 포인트입니다." />
