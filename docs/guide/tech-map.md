# 기술 지도 — 기능에서 기술·파일·영역으로

> "이 화면은 어떻게 만들었어요?"에 **기술 이름 + 실제 클래스/테이블 + 담당 영역**까지 한 줄로 답할 수 있게 하는 역참조 지도. CareerTuner의 기능 하나하나를 "무슨 기술 → 어느 파일 → 어느 AI 번호 → 어느 영역"으로 매핑한다. 이 사이트는 6개 영역(A~F)을 **동등하게** 다루는 프로젝트 전체 학습 자료이며, 이 페이지는 그 6영역과 공통 기반을 한 장에 펼친다.

## 1. 한 줄 정의

기능(로그인, 공고 분석, 적합도 판정, 면접, 첨삭, 챗봇 등)을 "어떤 기술 + 어떤 클래스/테이블 + 어느 AI 기능 번호 + 어느 영역"으로 묶은 **기능→구현 역참조 표**다. 영역별 심화 페이지가 "한 영역을 깊게"라면, 이 페이지는 "전 영역을 한눈에"다.

## 2. 영역 코드 (이 지도에서 쓰는 6분할)

CareerTuner는 6명이 **수직 분담**한 6개 영역이고, 각 영역이 `사용자 화면 + REST API + 관리자 + AI + DB 테이블`을 통째로 소유한다. AI 기능 번호(#1~34)도 영역별로 끊어 가진다. 영역 경계는 [docs/TEAM_WORK_DISTRIBUTION.md] 기준이다.

| 코드 | 한 줄 정체성 | AI # | 심화 |
| --- | --- | --- | --- |
| **A** | 회원·프로필·인증 (기반 신뢰 데이터 원천) | 1~5 | [/area-a/](/area-a/) |
| **B** | 지원 건·공고·기업 분석 (구조화 추출) | 6~11 | [/area-b/](/area-b/) |
| **C** | 적합도·전략·대시보드 (뉴로-심볼릭 허브) | 12~18 | [/area-c/](/area-c/) |
| **D** | 가상 면접 (세션·질문·평가·리포트) | 19~23 | [/area-d/](/area-d/) |
| **E** | 첨삭·결제·크레딧 (콘텐츠 개선 + 과금 인프라) | 24~28 | [/area-e/](/area-e/) |
| **F** | 커뮤니티·고객센터·챗봇 (공용 공간 + 운영 보조) | 29~34 | [/area-f/](/area-f/) |
| **공통** | 인증 경계·`ApiResponse` 규약·AutoPrep 오케스트레이터 | — | [/flow/](/flow/) |

:::tip 핵심 단위는 "공고"가 아니라 "지원 건"
모든 산출물(프로필·공고분석·적합도·면접·첨삭·후기)이 하나의 **지원 건(Application Case)** 에 매달린다. 6영역이 같은 지원 건을 함께 채운다고 보면 흐름이 정렬된다. 자세히는 [지원 건 중심 흐름](/flow/application-case).
:::

## 3. 왜 이 지도가 필요한가

면접에서 깊이가 갈리는 지점은 두 가지다.

- **추상적으로만 안다**: "JWT로 인증했어요"는 말하는데, 어느 필터가 토큰을 파싱하고 Refresh를 어디에 두었는지 못 댄다 → 깊이 없음으로 읽힌다.
- **영역 경계가 흐리다**: "이 기능은 어느 영역 소유고 어떤 기술인가요"에 답이 흩어진다.

이 지도는 **기능 → 기술 → 실제 파일/테이블 → AI 번호 → 영역**을 한 줄로 묶어 두 문제를 동시에 막는다. 각 칸이 약하면 링크된 영역/주제 페이지로 들어가 깊게 파면 된다.

## 4. 공통 기반 — 모든 영역이 공유하는 골격

영역을 보기 전에, 6영역이 똑같이 올라타는 공통 토대를 먼저 잡는다.

| 기능 | 핵심 기술 | 대표 파일 / 규약 | 주제 페이지 |
| --- | --- | --- | --- |
| 요청 인증 | Spring Security 필터 + [JWT](/glossary/jwt) | `JwtAuthenticationFilter`(Bearer 파싱), `JwtTokenProvider` | [JWT 보안](/backend/jwt-security) |
| 인가·CORS·세션 | Spring Security (STATELESS) | `SecurityConfig` (`/api/admin/**`→ADMIN, BCrypt) | [JWT 인증 흐름](/area-a/auth-jwt) |
| 응답 형식 | 단일 envelope | `common/web/ApiResponse<T>` (성공/실패 동형) | [ApiResponse 엔벨로프](/glossary/api-response-envelope) |
| 예외 처리 | `@RestControllerAdvice` | `BusinessException` + `ErrorCode` → `GlobalExceptionHandler` | [예외 처리](/backend/exception-handling) |
| 영속성 | MyBatis (JPA 금지) | `@Mapper` + `resources/mapper/**/*.xml` | [MyBatis](/backend/mybatis) |
| 계층 구조 | 4계층 | `controller → service → mapper → domain` (+ `dto`) | [레이어드 아키텍처](/glossary/layered-architecture) |
| AI 사용량 집계 | 공통 로그 테이블 | `ai_usage_log`(featureType/status/model/token/credit) | [AI 사용량·크레딧](/ai/ai-usage-credit) |
| AI 오케스트레이션 | AutoPrep + [SSE](/glossary/sse) | 인테이크→플래너→의존그래프 JOB(B) 후 FIT(C)·INTERVIEW(D) 병렬 | [AI 오케스트레이터](/flow/ai-orchestrator) |
| 공통 폴백 정책 | 다단 폴백 | 자체 OSS → Haiku(claude-haiku-4-5) → OpenAI → Mock | [AI 공급자·폴백](/flow/ai-providers-fallback) |

:::tip 한 줄로 외우는 요청 골격
`@RestController → @Service → @Mapper(MyBatis) → domain`, 입력은 `@Valid DTO`로 검증, 출력은 항상 `ApiResponse<T>`, 오류는 `BusinessException + ErrorCode`. 6영역이 전부 이 골격을 공유한다.
:::

## 5. 영역별 기술 지도 (A~F)

각 표는 **기능 → 핵심 기술 → 대표 클래스·파일·테이블 → AI #**의 매핑이다. 행 끝의 심화 링크로 깊게 들어갈 수 있다.

### 5-A. 회원·프로필·인증 (영역 A)

| 기능 | 핵심 기술 | 대표 클래스 / 테이블 | AI # | 심화 |
| --- | --- | --- | --- | --- |
| 토큰 발급·갱신 | access=무상태 JWT / refresh=DB opaque UUID | `JwtTokenProvider`, `refresh_token` | — | [JWT 인증 흐름](/area-a/auth-jwt) |
| 소셜 로그인 | OAuth2 수동 REST + 서명 state JWT | Kakao/Naver/Google, `user_social` | — | [OAuth2 소셜](/area-a/oauth-social) |
| 비밀번호·메일 | BCrypt + purpose 분기 토큰 | `email_verification`(VERIFY/RESET_PW) | — | [비밀번호·이메일](/area-a/password-email) |
| 프로필 원천 | 1:1 upsert, JSON 컬럼 | `user_profile`(전 영역 읽기전용 입력) | — | [프로필 데이터 모델](/area-a/profile-data-model) |
| 동의 게이팅 | append-only 이벤트 이력 | `user_consent`(AI 실행 전제) | — | [동의·게이팅](/area-a/consent-gating) |
| 프로필 요약·스킬·완성도 | 뉴로-심볼릭(서버가 점수 합산) + 규칙엔진 폴백 | `ProfileAiService`, `RuleBasedProfileAiService` | 1·2·5 | [요약](/area-a/ai-resume-summary)·[스킬](/area-a/ai-skill-extraction)·[완성도](/area-a/ai-profile-completeness) |

:::warning 정직한 구분 (A)
AI 엔드포인트는 `summary`/`skills`/`completeness` **3개**다. 계획상 자소서·경력 키워드(#3·#4)는 요약 응답 필드에 흡수됐고, 자체 모델 `careertuner-a-profile-3b`(Qwen2.5-3B LoRA)는 키 미발급이라 운영 기본값은 규칙엔진이다. → [키워드 추출](/area-a/ai-keyword-extraction)
:::

### 5-B. 지원 건·공고·기업 분석 (영역 B)

| 기능 | 핵심 기술 | 대표 클래스 / 테이블 | AI # | 심화 |
| --- | --- | --- | --- | --- |
| 지원 건 루트 | 상태머신(DRAFT→…→CLOSED) | `application_case`(트리 루트) | — | [지원 건 생애주기](/area-b/application-lifecycle) |
| PDF 텍스트 추출 | Apache PDFBox `PDFTextStripper` | `JobPostingTextExtractor` | — | [텍스트 추출·OCR](/area-b/text-extraction-ocr) |
| HTML/URL 수집 + SSRF 방어 | Jsoup + 사설/메타데이터 IP 차단·redirect 제한 | 같은 클래스 | — | [파일·텍스트 추출](/backend/file-text-extraction) |
| 이미지 OCR 폴백 | OpenAI Vision / Python 워커(PaddleOCR) | (기본 OFF, allowlist 필요) | — | [ML 워커](/area-b/ml-worker) |
| 공고 분석(필수/우대/업무) | 자체 Ollama R1 + `self-rules-v1` 폴백, grounding 검증 | `BAnalysisGenerationService`, `job_analysis` | 6·7·8·9 | [공고 분석](/area-b/job-analysis) |
| 기업 분석(사실/추론 분리) | 별 JSON 컬럼 + 외부조회 금지 프롬프트 | `company_analysis`(`verified_facts`/`ai_inferences`) | 10·11 | [기업 분석](/area-b/company-analysis) |
| 공고 원문 보존 | revision append-only(UPDATE 없음), 분석 시 동결 | `job_posting`(`UNIQUE(case, revision)`) | — | [공고 저장·revision](/area-b/job-posting-storage) |

:::warning 정직한 구분 (B)
런타임은 자체 호스팅 Ollama R1(`careertuner-b-jobposting-r1`)이 **기본 ON**이고, 추출 결과가 원문에 실제 등장하는지 `validateGrounding`으로 검증해 환각을 막는다. #11 `interview_points`는 설계상 D 입력이지만, 자동 파이프라인은 스킬 기반 템플릿을 쓰는 **간접 연결**이다. → [면접 포인트](/area-b/interview-points)
:::

### 5-C. 적합도·전략·대시보드 (영역 C)

| 기능 | 핵심 기술 | 대표 클래스 / 테이블 | AI # | 심화 |
| --- | --- | --- | --- | --- |
| 적합도 점수·판단 | 뉴로-심볼릭(규칙엔진이 점수 확정) | `MockFitAnalysisAiService.score()`, `fit_analysis` | 12 | [적합도 분석](/area-c/fit-analysis) |
| 지원 판단 가드레일 | 사후 보정(`APPLY`→`COMPLEMENT` 강등) | `guardApplyDecision` | 12 | [가드레일](/area-c/guardrails) |
| 부족역량·학습 로드맵 | 3단계 갭 분류 + 체크리스트 | `fit_analysis_learning_task` | 13·14·15 | [부족역량·학습](/area-c/gap-and-learning) |
| 장기 취업경향 | 25종 결정적 집계 + SHA-256 캐시 | `career_analysis_run`(`input_fingerprint`) | 16·17 | [장기 경향](/area-c/career-trend) |
| 대시보드 요약 | 핵심 지표 1줄 재투영 | `dashboard_insight` | 18 | [대시보드 인사이트](/area-c/dashboard-insight) |
| 3단 폴백 디스패치 | Strategy + Fallback | `FallbackFitAnalysisAiService`(`@Primary`) | 12 | [폴백 체인](/area-c/fallback-chain) |
| 설명가능성 | 분석 시점 입력 동결 | `source_snapshot`, `condition_matrix` | 12 | [데이터 모델](/area-c/data-model) |

:::tip C 한 줄
"LLM은 점수를 정하지 않는다. 점수·판단·신뢰도는 규칙엔진이 결정적으로 확정하고, LLM은 그 결과를 설명 문장으로 풀어쓴다." → [뉴로-심볼릭 설계](/area-c/neuro-symbolic)
:::

### 5-D. 가상 면접 (영역 D)

| 기능 | 핵심 기술 | 대표 클래스 / 테이블 | AI # | 심화 |
| --- | --- | --- | --- | --- |
| 세션 생성 | 지원 건 종속(`ON DELETE CASCADE`) | `interview_session`(`application_case_id`) | — | [세션 모델](/area-d/session-model) |
| 예상 질문 생성 | 공고 기반 생성 + 모범답안 백그라운드 | `generateQuestions`, `interview_question` | 19 | [질문 생성](/area-d/question-generation) |
| 꼬리 질문 | 압박 모드 전용 반박 1개 | `generateFollowUps` | 20 | [꼬리 질문](/area-d/followup-questions) |
| 면접 진행 | 텍스트 / 음성(Realtime) / 아바타 + [SSE](/glossary/sse) | `InterviewRealtimeService`, `InterviewAvatarService` | 21 | [SSE 스트리밍](/area-d/sse-streaming) |
| 답변 평가 | 멀티에이전트 채점·Critic 루프, `clampScore` | `InterviewAgentOrchestrator`, `interview_answer` | 22 | [답변 평가](/area-d/answer-evaluation) |
| 면접 리포트 | 총점·카테고리·피드백(리포트=세션 종료) | `getReport`(`ended_at` 세팅) | 23 | [면접 리포트](/area-d/interview-report) |
| 2-축 LLM 추상화 | 생성축/평가축 분리, 자체 LLM(Qwen3 LoRA) 교체 활발 | `FallbackInterviewLlmGateway`(자체→Haiku→OpenAI), `InterviewEvaluatorProvider` | 19~23 | [폴백 게이트웨이](/area-d/fallback-gateway)·[자체 LLM](/area-d/self-llm-finetune) |

### 5-E. 첨삭·결제·크레딧 (영역 E)

| 기능 | 핵심 기술 | 대표 클래스 / 테이블 | AI # | 심화 |
| --- | --- | --- | --- | --- |
| 첨삭 4종 통합 | 단일 도메인, `correctionType` 분기 + json_schema strict | `correction_request`(append-only, 원문 보존) | 24·25·26·27 | [답변 첨삭](/area-e/ai-answer-correction)·[자소서](/area-e/ai-coverletter)·[이력서](/area-e/ai-resume-improve)·[포트폴리오](/area-e/ai-portfolio) |
| 원문 날조 방지 | 시스템 프롬프트 가드레일 + 자체 LLM(Qwen3 LoRA) | `CorrectionPromptCatalog`(`changeReasons`/`suggestions`) | 24~27 | [첨삭 원칙](/area-e/correction-principles) |
| 결제 | Toss 2단계(ready/confirm) + PG 콜백 검증 | `payment`(마스터-인스턴스 분리) | — | [결제 흐름](/area-e/payment-flow) |
| 크레딧 원장 | 잔액 직접갱신 금지, 변동+잔액 행 기록 | `credit_transaction`(감사 가능 원장) | — | [크레딧 시스템](/area-e/credit-system) |
| 요금제 게이팅 | 정책의 데이터화 + 가입 시점 스냅샷 동결 | `plan`/`policy_snapshot_json` | — | [요금제 게이팅](/area-e/plan-gating) |
| 사용량 대시보드 | 전사 `ai_usage_log` 집계 | (관리자 사용량 화면) | 28 | [사용량 대시보드](/area-e/usage-dashboard) |

:::warning 정직한 구분 (E)
첨삭 백엔드(`POST /api/corrections`)는 실재하지만 프론트는 아직 플레이스홀더 단계이고, 차감 엔진(`AiChargeService`)은 단위 테스트는 통과하나 **운영 경로에서 미호출**이라 실제 크레딧 차감은 아직 일어나지 않는다. #28 요금제 추천은 데이터만 준비된 미구현 상태다. → [요금제 추천](/area-e/ai-plan-recommend)
:::

### 5-F. 커뮤니티·고객센터·챗봇 (영역 F)

| 기능 | 핵심 기술 | 대표 클래스 / 테이블 | AI # | 심화 |
| --- | --- | --- | --- | --- |
| 게시글·댓글·반응·신고 | 커뮤니티 도메인 | `community_post`/`community_comment`/`post_report` | — | [커뮤니티 데이터 모델](/area-f/community-data-model) |
| 면접질문 추출 | 후기 글→질문 구조화 후 D RAG 지식에 적재 | `extractInterviewQuestions()`→`interview_knowledge` | 31 | [질문 추출](/area-f/ai-question-extract) |
| 태그 추천·신고 분류 | `judge()` 두뇌 재사용, confidence 게이트 | `PostModerationService`(`tag()`/`moderate()`/`classify()`) | 30·33 | [태그 추천](/area-f/ai-tag-recommend)·[신고 분류](/area-f/ai-report-classify) |
| 게시글 의미검색 | 2단계 SQL + 코사인 유사도 | `CommunityPostSearchService.search()` | 32 | [게시글 추천](/area-f/ai-post-recommend) |
| 고객문의 답변 초안 | 동기·미영속 초안(상담원 검토) | `TicketDraftAiClient.generateDraft()`, `support_ticket` | 34 | [문의 초안](/area-f/ai-support-draft) |
| 챗봇 3종 통합 라우팅 | LangChain4j `@Tool` + Ollama qwen3, 임베딩 argmax | `UnifiedChatRouter`, `IntakeChatAgent`/`CommunityChatAgent`, `chatbot_conversation_memory` | 29~34 | [LangChain4j 에이전트](/area-f/langchain4j-agent)·[인테이크 챗봇](/area-f/intake-chatbot) |

:::tip F 한 줄
"AI는 운영자 보조이지 자동 처분자가 아니다." 자동 검열은 생성 시점에, 신고 분류는 운영자 확정으로 `task_type`을 나눠 같은 판정 두뇌를 재사용한다. 인테이크 챗봇이 AutoPrep의 입구다.
:::

## 6. 프론트엔드·인프라 (전 영역 공통)

| 기능 | 핵심 기술 | 대표 파일 | 주제 페이지 |
| --- | --- | --- | --- |
| SPA | React 18 + Vite 6 + TypeScript | `frontend/src/features/<기능>/{pages,components,api,hooks,types}` | [React](/frontend/react)·[Vite](/frontend/vite) |
| 스타일 | Tailwind v4 (다크모드) | 디자인 토큰 | [Tailwind·다크모드](/frontend/tailwind-darkmode) |
| API 레이어 | 제네릭 fetch + 401 자동 리프레시(single-flight) | `app/lib/api.ts`, `tokenStore.ts` | [API 레이어·JWT 리프레시](/frontend/api-layer-jwt-refresh) |
| 전역 상태 | Context(인증) + Zustand 5 | `AuthContext` | [상태 관리](/frontend/state-management) |
| 차트 | Recharts | 적합도·경향 시각화 | [Recharts](/frontend/recharts) |
| 모바일 | Capacitor (하이브리드) | `capacitor.config.ts`(appId `com.careertuner.app`) | [Capacitor 모바일](/frontend/capacitor-mobile) |
| 오프라인/설치 | PWA(`vite-plugin-pwa`, `/api` 캐시 제외) | autoUpdate | [PWA](/frontend/pwa) |
| 벡터 검색 | Qdrant (면접 RAG·임베딩) | `QDRANT_URL` | [RAG·Qdrant](/ai/rag-qdrant) |
| 배포 | Docker Compose + GitHub Actions | backend + qdrant + worker | [Docker Compose](/infra/docker-compose)·[GitHub Actions](/infra/github-actions) |

## 7. 지도 읽는 법 — 한 요청이 6영역을 가로지른다

"○○ 통째로 준비해줘" 한 줄이 들어왔을 때, 이 지도를 따라 흐름을 짚으면 이렇다.

1. **F 인테이크 챗봇**(`IntakeChatAgent`)이 지원 건·모드 슬롯을 수집한다.
2. **공통 인증**(`JwtAuthenticationFilter`)이 토큰을 검증하고, **AutoPrep 오케스트레이터**가 실행 계획을 세운다.
3. **B 공고 분석**(`BAnalysisGenerationService` → `job_analysis`)이 먼저 끝나야 한다(의존 그래프의 뿌리).
4. JOB 완료 후 **C 적합도**(`FallbackFitAnalysisAiService` → `fit_analysis`)와 **D 면접 질문**(`generateQuestions` → `interview_question`)이 **병렬** 출발한다.
5. 각 단계 진행은 [SSE](/glossary/sse)(plan/part-start/substep/part-done)로 실시간 스트리밍된다.
6. 모든 AI 호출은 `ai_usage_log`에 적재되고(공통), 크레딧 회계는 **E**가 소유한다.

:::details 왜 점수는 LLM이 아니라 서버가 정하나 (전 영역 공통 신뢰성 원칙)
C 적합도(점수·판단), A 프로필(완성도 점수), D 답변(채점) 모두 **결정적 값은 서버 규칙엔진/클램프가 확정**하고 LLM은 설명·생성만 한다. 같은 입력이면 mock이든 실제 LLM이든 같은 결정 값이 나오므로 재현성·설명가능성·가용성이 보장된다. LLM이 전부 죽어도 Mock/규칙엔진이 받쳐 화면이 깨지지 않는다. → [뉴로-심볼릭](/area-c/neuro-symbolic), [AI 공급자·폴백](/flow/ai-providers-fallback)
:::

## 8. 면접 답변 3단계

- **초간단(1문장)**: "기능마다 어떤 기술·클래스·테이블을 썼는지, 그리고 어느 영역(A~F)이 소유하는지를 표로 들고 있습니다."
- **기본**: "예컨대 적합도 분석(C)은 `FallbackFitAnalysisAiService`가 OSS→OpenAI→Mock으로 폴백하되 점수는 규칙엔진이 확정해 `fit_analysis`에 저장하고, 그 앞단 공고 분석(B)은 `BAnalysisGenerationService`가 자체 Ollama R1에 grounding 검증을 걸어 `job_analysis`를 만듭니다. 둘 다 공통 인증(JWT 필터)과 `ApiResponse` 규약 위에서 돕니다."
- **꼬리질문 대응**: "AutoPrep 오케스트레이터는 새 AI를 만들지 않고 6영역의 기존 도메인 서비스를 의존 그래프대로(JOB 후 FIT·INTERVIEW 병렬) 호출해 SSE로 묶는 구조입니다." → [AI 오케스트레이터](/flow/ai-orchestrator)

## 9. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 6명이 나눠 짰는데 통합이 어떻게 유지되나요?
공통 계약 덕분입니다. 출력은 전부 `ApiResponse<T>` 단일 envelope, 인증은 STATELESS JWT 필터 한 곳, 영속성은 MyBatis 4계층으로 통일했습니다. 데이터는 각 영역이 자기 결과 테이블만 쓰고 타 영역 원본은 읽기전용으로만 참조합니다. 자세히는 [데이터 소유권](/flow/data-ownership)·[팀 협업 경계](/flow/team-collaboration).
:::

:::details Q2. 공고 URL을 크롤링하면 SSRF 위험이 있는데요?
영역 B의 `JobPostingTextExtractor`가 사설·메타데이터 IP와 localhost를 차단하고 redirect 횟수·본문 크기·타임아웃을 제한합니다. 서버가 내부 자원을 대신 찌르지 못하게 막는 설계입니다. → [파일·텍스트 추출](/backend/file-text-extraction).
:::

:::details Q3. AI 응답을 그대로 믿나요?
결정적 값은 안 믿습니다. C 적합도 점수는 규칙엔진이, A 프로필 완성도는 서버 산식이, D 답변 점수는 `clampScore`가 확정하고, LLM은 설명·생성만 합니다. 구조화 출력(json_schema)으로 형식을 강제하고 grounding으로 환각을 검증합니다. → [뉴로-심볼릭](/area-c/neuro-symbolic), [환각 방지](/ai/hallucination).
:::

:::details Q4. 토큰 만료 시 사용자 경험은요?
프론트 `api.ts`가 401을 받으면 `tryRefresh()`를 single-flight(동시 1회)로 호출해 토큰을 자동 갱신하고 원 요청을 재시도합니다. access는 짧은 무상태 JWT, refresh는 DB opaque UUID라 회전·폐기가 됩니다. → [API 레이어·JWT 리프레시](/frontend/api-layer-jwt-refresh).
:::

:::details Q5. 모바일은 네이티브인가요?
Capacitor 기반 하이브리드입니다. 동일 React 코드를 `capacitor.config.ts`로 패키징하고 PWA(`vite-plugin-pwa`)도 병행하되 `/api`는 캐시에서 제외합니다. → [Capacitor 모바일](/frontend/capacitor-mobile).
:::

## 10. 직접 말해보기

1. "로그인(A) → 공고 분석(B) → 적합도 판정(C) → 면접 질문(D)" 한 흐름을 **클래스/테이블 이름까지** 넣어 90초로 말해보라. 막히는 칸이 다음에 공부할 페이지다.
2. 아무 AI 기능 하나를 골라 "어느 영역 #몇 번이고, 무슨 기술·클래스로 구현됐고, 무엇이 구현됨/계획인지"를 30초로 끊어 말해보라.

## 퀴즈

<QuizBox question="CareerTuner의 모든 백엔드 응답이 공통으로 따르는 형식은?" :choices="['각 컨트롤러가 자유 형식으로 반환','공통 ApiResponse<T> 단일 envelope','GraphQL 스키마','프로토콜 버퍼']" :answer="1" explanation="6영역 모두 common/web/ApiResponse<T> 단일 envelope로 성공·실패를 동형으로 반환한다. 인증은 STATELESS JWT 필터, 영속성은 MyBatis 4계층으로 통일된 공통 골격을 공유한다." />

<QuizBox question="적합도(C)·프로필 완성도(A)·면접 답변 평가(D)에서 점수 같은 결정적 값을 최종 확정하는 주체는?" :choices="['LLM이 직접 생성한 숫자를 그대로 사용','서버의 규칙엔진/산식/clampScore가 확정하고 LLM은 설명·생성만','프론트엔드가 계산','Qdrant 벡터 거리']" :answer="1" explanation="세 영역 모두 뉴로-심볼릭 원칙을 공유한다. 결정적 값은 서버 코드가 확정하고 LLM은 설명·생성만 맡으므로 같은 입력이면 같은 결과가 나와 재현성·가용성이 보장된다." />

<QuizBox question="공고 URL을 받아 텍스트를 뽑는 영역 B의 JobPostingTextExtractor가 SSRF를 막기 위해 하는 일은?" :choices="['모든 외부 URL을 무조건 허용','사설·메타데이터 IP와 localhost 차단, redirect 횟수·본문 크기·타임아웃 제한','JWT를 검증','임베딩을 Qdrant에 저장']" :answer="1" explanation="내부망·메타데이터 IP와 localhost를 차단하고 redirect 횟수·본문 크기·타임아웃을 제한해 서버가 내부 자원을 대신 요청하지 못하게 막는다." />

<QuizBox question="AutoPrep 오케스트레이터의 의존 그래프에서 C(적합도)와 D(면접 질문)가 병렬로 출발할 수 있으려면 먼저 끝나야 하는 단계는?" :choices="['E 결제','B 공고 분석(JOB)','F 챗봇','A 회원가입']" :answer="1" explanation="의존 그래프의 뿌리는 B 공고 분석(JOB)이다. JOB이 끝나면 FIT(C)·INTERVIEW(D)가 병렬로 출발하고, 진행 상황은 SSE로 스트리밍된다. 오케스트레이터는 새 AI가 아니라 기존 도메인 서비스를 지휘한다." />
