# 내 코드 기반 기술 지도 (기능에서 기술, 파일로)

> CareerTuner의 각 기능 뒤에 어떤 기술이 깔려 있는지 한 장으로 보는 지도. "이 화면 만들 때 뭘 썼냐"는 질문에 파일 이름까지 대답할 수 있게 하는 게 목표다.

## 1. 한 줄 정의

기능(로그인, 공고 업로드, 적합도 분석, 면접 등) 하나하나를 "어떤 기술 + 어떤 클래스/테이블"로 매핑한 역참조 표. 면접에서 "그 기능은 어떻게 구현했어요?"가 나왔을 때 기억을 더듬을 출발점이다.

영역 표기: A~F는 6명 수직 분담의 담당 영역이고, 이 프로젝트에서 **본인은 영역 C**다. 표에서 C 행을 특히 자신 있게 말할 수 있어야 한다.

## 2. 단어 뜻 (이 지도에서 쓰는 영역 코드)

| 코드 | 담당 영역(대략) |
| --- | --- |
| A | 인증/계정/공통 기반 |
| B | 공고 추출 (Python 워커) |
| **C (나)** | AI 분석 — 적합도·취업경향·대시보드 요약 |
| D/E | 가상면접·RAG·평가 |
| F | 빌링/크레딧·관리자·기타 |

:::tip
영역 경계는 [docs/TEAM_WORK_DISTRIBUTION.md] 기준이며, 이 페이지에서는 "내가 직접 만든 것(C)"과 "옆 영역 것"을 구분하는 용도로만 쓴다. 면접에서 남의 영역을 내 것처럼 말하지 않기 위한 안전장치다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

면접에서 망하는 전형적 패턴은 두 가지다.

- **추상적으로만 안다**: "JWT로 인증했어요"는 말하는데, 어느 필터가 토큰을 파싱하고 어디에 Refresh를 저장했는지 못 댄다 → 깊이 없음으로 읽힌다.
- **남의 영역을 내 것처럼 말한다**: 면접관이 꼬리질문 한 번 하면 무너진다.

이 지도는 그 두 위험을 동시에 막는다. 기능 → 기술 → **실제 파일/테이블** → **담당 영역**까지 한 줄로 묶여 있어서, 말할 때 "내가 만든 부분"과 "구조만 아는 부분"을 정직하게 끊어 말할 수 있다.

## 4. CareerTuner에서 어디에 썼나 (기능별 기술 지도)

핵심 표다. 행마다 관련 학습 페이지로 링크가 걸려 있으니, 약한 칸을 눌러 깊게 파면 된다.

### 4-1. 인증 / 계정 (영역 A)

| 기능 | 핵심 기술 | 실제 파일 / 테이블 |
| --- | --- | --- |
| 로그인·토큰 발급 | [JWT](/backend/jwt-security) (jjwt 0.12.6) | `common/security/JwtTokenProvider` (Access 30분 / Refresh 14일 DB / OAuth state 5분) |
| 요청 인증 | Spring Security 필터 | `common/security/JwtAuthenticationFilter` (Bearer 파싱) |
| 인가·CORS·세션 | [Spring Security](/backend/jwt-security) | `common/config/SecurityConfig` (BCrypt, STATELESS, `/api/admin/**` → ADMIN) |
| 소셜 로그인 | OAuth2 | Kakao / Naver / Google, state token CSRF 방어 |
| 토큰 저장(서버) | MyBatis | `refresh_token` 테이블 |

### 4-2. 공고 업로드 / 추출 (영역 B + 공통)

| 기능 | 핵심 기술 | 실제 파일 / 테이블 |
| --- | --- | --- |
| PDF 텍스트 추출 | Apache PDFBox | `jobposting/service/JobPostingTextExtractor` (`PDFTextStripper`) |
| HTML 공고 파싱 | Jsoup | 같은 클래스, `Jsoup.parse` |
| [SSRF 방어](/backend/file-text-extraction) | URL/호스트 검증 | 같은 클래스 — 내부 IP·localhost 차단, redirect 5회 제한, 본문 크기 제한 |
| 이미지 PDF 폴백 | OpenAI Vision OCR | `OpenAiResponsesClient` 경유 |
| 비동기 추출 워커 | Python Flask + Docker | `ml/job-posting-worker` (:8091) |
| 저장 | MyBatis | `job_posting` 테이블 |

### 4-3. AI 분석 — **본인 영역 C (구현됨, 강조)**

| 기능 | 핵심 기술 | 실제 파일 / 테이블 |
| --- | --- | --- |
| **적합도 분석** | [OpenAI structured output](/ai/openai-structured-output) + 서버 검증 | `fitanalysis/ai/FitAnalysisAiService`, `FitAnalysisAiResult`, 프롬프트 `fitanalysis/ai/prompt/FitAnalysisPromptCatalog` → `fit_analysis` 테이블 |
| **장기 취업경향 분석** | OpenAI + Mock 폴백 | `analysis/ai/CareerTrendAiService` / `OpenAiCareerTrendAiService` / `MockCareerTrendAiService`, `CareerTrendAiCommand` → `career_analysis_run` |
| **대시보드 요약** | [프롬프트 카탈로그 패턴](/ai/prompt-catalog) | `dashboard/ai/DashboardInsightAiCommand` + `DashboardInsightPromptCatalog` |
| **AutoPrep 오케스트레이션** | [SSE](/glossary/sse) 실시간 진행 | `ai/autoprep/handler/FitPrepHandler` 등, 의존그래프 JOB(B) 완료 → FIT(C)·INTERVIEW(D) 시작 |

:::warning 정직하게: 자체 LLM은 설계 단계
자체 커리어전략 LLM(`careertuner-c-career-strategy`, Qwen/Gemma 베이스, Fallback 캐시→규칙엔진→OpenAI→Mock, Ollama 서빙)은 **계획·미구현** 상태다. 학습데이터 `ml/career-strategy-llm`도 아직 생성 전. 면접에서는 "현재는 OpenAI 호출 + 서버 규칙으로 점수/판정을 확정하고, 자체 LLM은 비용·일관성 개선용으로 설계 중"이라고 끊어 말한다. 자세한 비교는 [OpenAI vs 자체 LLM](/ai/self-llm-strategy).
:::

### 4-4. 가상 면접 / RAG (영역 D·E)

| 기능 | 핵심 기술 | 실제 파일 / 테이블 |
| --- | --- | --- |
| 면접 진행 | 오케스트레이터 | `interview/InterviewAgentOrchestrator` |
| 답변 평가 | OpenAI | 답변 채점 로직 → `interview_session` / `interview_answer` |
| [RAG](/ai/rag-qdrant) | Qdrant 벡터DB | `QDRANT_URL`, `INTERVIEW_RAG_ENABLED` 플래그 |

### 4-5. 모바일 / 프론트 / 인프라 (공통·F)

| 기능 | 핵심 기술 | 실제 파일 / 테이블 |
| --- | --- | --- |
| 모바일 앱 | [Capacitor](/frontend/capacitor-mobile) 8.4 | `frontend/capacitor.config.ts` (appId `com.careertuner.app`, androidScheme http + cleartext) |
| API 레이어 | 제네릭 fetch + 자동 리프레시 | `app/lib/api.ts` (401 → `tryRefresh()` single-flight), `app/lib/tokenStore.ts` |
| 전역 상태 | [Context + Zustand](/frontend/state-management) | `AuthContext`(인증) + Zustand 5(그 외) |
| 오프라인/설치 | [PWA](/frontend/pwa) | `vite-plugin-pwa` (autoUpdate, `/api`는 캐시 제외) |
| 사용량·크레딧 | MyBatis + 예외 | `ai_usage_log`, `ErrorCode.INSUFFICIENT_CREDIT`, 관리자 `AdminAiUsage` |
| 배포 | Docker Compose + GitHub Actions | backend + qdrant + worker, MySQL은 외부 인스턴스 |

## 5. 핵심 동작 원리 (지도 읽는 법 — 한 요청의 흐름)

한 줄로 외우는 백엔드 공통 골격:

```text
@RestController  →  @Service  →  @Mapper (MyBatis)  →  domain
        ↑ @Valid DTO 검증            ↑ resources/mapper/**/*.xml
        ↓ 항상 ApiResponse<T> 엔벨로프로 응답 (common/web/ApiResponse)
예외는 BusinessException + ErrorCode → GlobalExceptionHandler(@RestControllerAdvice)
```

예를 들어 "적합도 분석 요청" 한 건을 지도에서 따라가면:

1. 프론트 `api.ts`가 `Authorization: Bearer` 헤더로 호출
2. `JwtAuthenticationFilter`가 토큰 검증(영역 A)
3. 컨트롤러 → `FitAnalysisAiService`(영역 C)가 `FitAnalysisPromptCatalog`로 시스템 프롬프트 구성
4. OpenAI structured output 호출 → `FitAnalysisAiResult`로 파싱
5. **점수·판정은 서버 규칙으로 재검증** 후 `fit_analysis` 테이블 저장
6. `ApiResponse.ok(data)`로 응답, 사용량은 `ai_usage_log`에 적재

:::details 왜 5번이 중요한가
LLM 출력을 그대로 점수로 쓰지 않고 서버에서 확정한다. "AI가 90점 줬어요"가 아니라 "AI는 후보 신호만 내고, 점수/판정은 결정 로직이 보장한다"가 핵심 설계 포인트다. 면접에서 신뢰성·재현성 질문이 오면 이 한 줄로 답한다.
:::

## 6. 면접 답변 3단계

- **초간단(1문장)**: "기능별로 어떤 기술과 파일을 썼는지 머릿속에 표로 들고 있고, 제 담당은 적합도·취업경향·대시보드 AI 분석(영역 C)입니다."
- **기본**: "예를 들어 적합도 분석은 `FitAnalysisAiService`에서 프롬프트 카탈로그로 OpenAI를 호출하고, 결과는 `FitAnalysisAiResult`로 받되 점수·판정은 서버 규칙으로 확정해 `fit_analysis`에 저장합니다. 인증은 A 영역의 JWT 필터 위에서 동작하고요."
- **꼬리질문 대응**: "공고 추출(B)·면접 RAG(D)은 제가 만든 게 아니라 구조만 이해하고 있습니다. 추출은 PDFBox/Jsoup에 SSRF 방어가 들어간 `JobPostingTextExtractor`, 면접은 Qdrant 기반 RAG를 씁니다." — 이렇게 영역을 끊어 말하면 신뢰가 올라간다.

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 본인이 직접 구현한 부분은 정확히 어디인가요?
A. 영역 C입니다. 적합도 분석(`FitAnalysisAiService`, `fit_analysis`), 장기 취업경향 분석(`CareerTrendAiService` 계열, `career_analysis_run`), 대시보드 요약(`DashboardInsightAiCommand`)입니다. 공통점은 도메인별 시스템 프롬프트를 `*PromptCatalog` 클래스로 분리한 프롬프트 카탈로그 패턴을 쓴다는 점입니다.
:::

:::details Q2. AI 응답을 그대로 믿나요? 일관성은 어떻게 보장하나요?
A. 안 믿습니다. structured output으로 형식을 강제해 받고, 점수·판정 같은 결정적 값은 서버 검증 로직으로 다시 확정합니다. 또 OpenAI 미가용 시를 대비해 Mock 구현체(`MockCareerTrendAiService`)를 두어 인터페이스 동일하게 폴백합니다.
:::

:::details Q3. 공고 URL을 받아 크롤링하면 SSRF 위험이 있는데요?
A. 맞습니다. `JobPostingTextExtractor`에서 내부 IP·localhost 호스트를 차단하고, redirect를 5회로 제한하며 응답 본문 크기·타임아웃도 제한합니다. 제 영역은 아니지만 보안 설계 의도는 설명할 수 있습니다. 자세히는 [SSRF](/backend/file-text-extraction) 참고.
:::

:::details Q4. 인증 토큰 만료 시 사용자 경험은 어떻게 처리했나요?
A. 프론트 `api.ts`에서 401을 받으면 `tryRefresh()`로 `/auth/refresh`를 single-flight(동시 요청 1번만)로 호출해 토큰을 자동 갱신하고 원 요청을 재시도합니다. Access 30분, Refresh 14일(DB 저장)이라 사용자는 보통 끊김을 못 느낍니다.
:::

:::details Q5. 모바일 앱은 네이티브인가요, 웹뷰인가요?
A. Capacitor 기반 하이브리드입니다. 동일 React 코드를 `capacitor.config.ts`로 안드로이드/iOS 패키징하고, androidScheme를 http + cleartext로 둬 평문 HTTP 백엔드(테스트 환경)도 호출 가능하게 했습니다. PWA(`vite-plugin-pwa`)도 병행하되 `/api`는 캐시에서 제외합니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "로그인 → 공고 업로드 → 적합도 분석" 한 흐름을 **클래스/테이블 이름까지** 넣어 90초 안에 말해보라. 막히는 칸이 바로 다음에 공부할 페이지다.
2. "이 프로젝트에서 본인이 만든 것과 안 만든 것을 구분해 주세요"에 30초로 답해보라. C 영역 3개(적합도/취업경향/대시보드)를 먼저 또렷이, 그다음 옆 영역은 "구조만 안다"로 끊어 말하는 연습.

## 퀴즈

<QuizBox question="적합도 분석에서 OpenAI가 낸 점수를 최종 점수로 그대로 쓰는가?" :choices="['그대로 신뢰해 저장한다','서버 규칙·검증 로직으로 점수와 판정을 다시 확정한다','프론트에서 계산한다','Qdrant가 점수를 매긴다']" :answer="1" explanation="LLM은 후보 신호만 내고, 점수·판정 같은 결정적 값은 FitAnalysisAiService의 서버 검증 로직으로 확정해 fit_analysis에 저장한다. 재현성과 신뢰성을 위한 핵심 설계다." />

<QuizBox question="공고 URL을 받아 텍스트를 추출하는 JobPostingTextExtractor가 SSRF를 막기 위해 하는 일로 옳은 것은?" :choices="['모든 외부 URL을 무조건 허용한다','내부 IP·localhost 차단과 redirect 횟수·본문 크기 제한','JWT 토큰을 검증한다','Qdrant에 임베딩을 저장한다']" :answer="1" explanation="내부망 주소·localhost 호스트를 차단하고 redirect를 5회로 제한하며 본문 크기·타임아웃을 제한해 서버가 내부 자원을 대신 찌르지 못하게 한다." />

<QuizBox question="본인(영역 C)이 직접 구현했다고 면접에서 자신 있게 말할 수 있는 기능 세 가지를 클래스/테이블 이름과 함께 한 문단으로 설명해 보라." explanation="적합도 분석(FitAnalysisAiService + FitAnalysisAiResult → fit_analysis), 장기 취업경향 분석(CareerTrendAiService/OpenAiCareerTrendAiService/MockCareerTrendAiService → career_analysis_run), 대시보드 요약(DashboardInsightAiCommand + DashboardInsightPromptCatalog)이다. 셋 다 도메인별 시스템 프롬프트를 PromptCatalog 클래스로 분리한 프롬프트 카탈로그 패턴을 쓰고, OpenAI 호출 결과는 구조화 출력으로 받되 결정적 값은 서버에서 확정한다. 자체 LLM 모델은 아직 설계 단계임을 정직하게 덧붙인다." />
