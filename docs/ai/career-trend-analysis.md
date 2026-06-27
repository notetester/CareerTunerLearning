# 장기 취업경향 분석 [영역 C·구현됨]

> 한 지원 건이 아니라 **여러 지원 건의 누적 분석 이력을 종합**해, 반복해서 부족한 역량·지원 패턴·다음에 집중할 방향을 LLM으로 요약해 주는 기능입니다. 비용이 드는 AI 요약은 입력 지문(fingerprint) 기반 캐시로 재실행을 막고, 점수·통계는 항상 서버 규칙으로 결정적으로 계산합니다.

## 1. 한 줄 정의

사용자의 모든 지원 건에서 나온 적합도·면접·답변 데이터를 **집계**한 뒤, 그 집계만 LLM에 넘겨 "장기 경향 요약 + 다음 지원 방향 3~5개"를 만들어 `career_analysis_run` 테이블에 캐시하는 분석 파이프라인입니다.

적합도 분석([fit analysis](/ai/fit-analysis))이 **한 건**을 보는 거라면, 장기 경향 분석은 **여러 건을 가로질러** 보는 상위 레이어입니다.

## 2. 단어 뜻

| 용어 | 풀이 |
| --- | --- |
| Career Trend | 지원 활동이 시간이 지나며 그리는 추세(반복 부족 역량, 직무 쏠림, 적합도 변화) |
| Aggregation(집계) | 개별 분석 결과를 합산·평균·분포로 압축하는 결정적 계산. 토큰 비용 없음 |
| Fingerprint(지문) | 집계 입력을 정규화(canonical)해 만든 SHA-256 해시. 같은 입력이면 같은 지문 |
| Read-through cache | 조회 시 캐시에 있으면 그대로 주고, 없을 때만 원본(AI)을 실행해 채우는 방식 |
| Fallback | 실 LLM 호출 실패 시 규칙 기반 mock 요약으로 대체해 화면을 안 깨뜨리는 동작 |

`CAREER_TREND`는 이 기능이 `career_analysis_run.analysis_type`에 쓰는 타입 문자열입니다.

## 3. 왜 필요한가

지원 건 하나의 적합도 점수만 보면 "이번 공고에 뭐가 부족한지"는 알지만 **"나는 매번 같은 데서 막히는지"** 는 모릅니다. 그게 가장 비싼 정보입니다.

- 한 건만 보면 보이는 것: 이번 공고는 Kubernetes가 부족하다.
- 누적해서 보면 보이는 것: **최근 분석 6건 중 5건에서** Kubernetes가 부족했다 → 이건 공고 탓이 아니라 내 학습 우선순위 문제다.

없으면 생기는 문제: 사용자는 매번 단발성 처방만 받고 같은 실수를 반복합니다. 또 이 요약을 매 화면 진입마다 LLM으로 새로 만들면 **토큰 비용이 폭발**합니다. 그래서 (1) 누적 관점과 (2) 비용 통제(캐시) 두 가지를 동시에 푸는 게 이 기능의 존재 이유입니다.

## 4. CareerTuner에서 어디에 썼나 (영역 C·구현됨)

핵심 패키지는 `backend/src/main/java/com/careertuner/analysis` 입니다.

| 역할 | 클래스 / 파일 |
| --- | --- |
| 진입점 컨트롤러 | `analysis/controller/AnalysisController` (`GET /api/analysis/summary`, `POST /api/analysis/summary/refresh`, `GET /api/analysis/history`) |
| 집계 + 오케스트레이션 | `analysis/service/AnalysisServiceImpl` |
| AI 입력 묶음(DTO) | `analysis/ai/CareerTrendAiCommand` |
| AI 출력(record) | `analysis/ai/CareerTrendAiResult` |
| AI 서비스 인터페이스 | `analysis/ai/CareerTrendAiService` |
| 실 LLM 구현(@Primary) | `analysis/ai/OpenAiCareerTrendAiService` |
| 규칙 기반 mock/fallback | `analysis/ai/MockCareerTrendAiService` |
| 프롬프트 카탈로그 | `analysis/ai/prompt/CareerTrendPromptCatalog` (`VERSION = "v0.2"`) |
| OpenAI 호출 어댑터 | `analysis/ai/provider/CareerAnalysisOpenAiClient` (Responses API, structured output) |
| 실행 이력 + 캐시 코디네이터 | `analysis/service/CareerAnalysisRunService` |
| 영속 도메인 / 매퍼 | `analysis/domain/CareerAnalysisRun`, `CareerAnalysisRunMapper(.xml)` |
| 누적 집계 원본 조회 | `analysis/mapper/AnalysisMapper(.xml)` |

테이블: 결과/이력은 `career_analysis_run`, 사용량·크레딧은 `ai_usage_log`. 집계 입력은 `application_case` + `fit_analysis`를 JOIN하고, **면접 데이터(`interview_session`, `interview_answer`)는 `AnalysisMapper.xml`의 서브쿼리로 읽기 전용으로만 참조**합니다(면접 도메인은 D/E 담당이라 C는 집계만 읽음).

:::tip 영역 경계
공통 AI 엔진은 팀장 소유라 건드리지 않고, OpenAI 호출 어댑터 `CareerAnalysisOpenAiClient`를 **C 소유 패키지(`analysis/ai/provider`) 안에** 따로 둡니다. 다른 담당자도 자기 도메인에 같은 형태의 어댑터를 둘 수 있게 한 설계입니다.
:::

## 5. 핵심 동작 원리

### 전체 흐름

```text
1. AnalysisServiceImpl.buildSummary(userId, forceRefresh)
2.  └ AnalysisMapper로 application_case + fit_analysis + 면접 집계 조회
3.  └ 결정적 집계 계산: stats / skillGaps / jobReadiness / scoreHistory / interviewTrend ...
4.  └ CareerTrendAiCommand 구성  →  canonical(JSON 직렬화)  →  SHA-256 fingerprint
5.  ├ [forceRefresh=false] findFreshRun(fingerprint) 적중? → 저장된 요약 재사용 (AI 미실행, 비용 0)
6.  └ [캐시 미스 or forceRefresh=true] careerTrendAiService.generate(command)
7.        └ 키 있음 → OpenAI Responses API(json_schema strict)
8.        └ 키 없음/예외 → MockCareerTrendAiService (규칙 기반 SUCCESS / FALLBACK)
9.  └ record(): career_analysis_run insert + ai_usage_log insert(크레딧)
```

### 결정적 집계 vs AI 요약 분리 (가장 중요)

점수·통계는 **절대 LLM에 맡기지 않습니다.** `AnalysisServiceImpl`이 자바 코드로 직접 계산합니다.

- `skillGaps`: 각 분석의 `missing_skills`를 지원 건 단위로 카운트 → "8건 중 5건에서 부족" 같은 빈도.
- `jobReadiness`: 직무명으로 묶어 평균 적합도.
- `scoreHistory`: 적합도 점수 시계열.
- `interviewTrend`: 면접 세션 수·가중 평균 점수(읽기 전용).

LLM이 받는 건 이 **숫자 집계뿐**이고, LLM은 그 숫자를 자연어 서사(`trendSummary`)와 우선순위 추천(`recommendedDirections`)으로만 바꿉니다. 즉 "팩트는 서버가, 말투는 AI가" 구조라 환각으로 점수가 틀어질 여지를 차단합니다.

### fingerprint 캐시

```java
// CareerAnalysisRunService
String fingerprint = CareerAnalysisRunService.fingerprint(canonical(command)); // SHA-256 hex
Optional<CareerAnalysisRun> cached = findFreshRun(userId, "CAREER_TREND", fingerprint);
// 최신 실행의 input_fingerprint가 같고 status != FAILED 이면 그대로 재사용
```

입력(집계)이 그대로면 지문이 같아 AI를 다시 안 부릅니다. 데이터가 바뀌면 지문이 달라져 **1회 자동 재생성**. 사용자가 "재분석"을 누르면(`/summary/refresh`, `forceRefresh=true`) 캐시를 건너뛰고 강제 실행하며 이때만 `ai_usage_log`에 크레딧 1을 차감합니다.

:::warning fingerprint에 안 넣는 것
대시보드용 결정적 집계(주간 변화, 직무 분포 등)는 **fingerprint에 포함하지 않습니다.** 매번 새로 계산해도 토큰 비용이 0이고, 포함하면 사소한 변화에도 기존 AI 요약 캐시가 통째로 무효화돼 비용이 늘기 때문입니다.
:::

### 구조화 출력(structured output)과 Fallback

`OpenAiCareerTrendAiService`는 `CareerAnalysisOpenAiClient`로 OpenAI Responses API를 `json_schema` + `strict: true`로 호출해 `trendSummary`(string)와 `recommendedDirections`(string[]) 형태를 강제받습니다. 실패하면 예외를 잡아 `MockCareerTrendAiService` 결과를 쓰되 status를 `FALLBACK`으로 표시합니다. 클라이언트는 429/5xx/타임아웃에 대해 최대 3회 지수 백오프 재시도합니다.

```text
status 값:  SUCCESS (정상)  |  FALLBACK (LLM 실패→규칙 요약)  |  FAILED (캐시 재사용 제외)
```

## 6. 면접 답변 3단계

- **초간단(1문장):** "여러 지원 건의 분석 결과를 누적 집계해서 반복 부족 역량과 다음 지원 방향을 LLM으로 요약해 주는 기능이고, 비용 때문에 입력 해시 기반 캐시로 재실행을 막았습니다."
- **기본:** "적합도 분석이 한 건을 보는 거라면 이건 여러 건을 가로질러 봅니다. 점수·빈도 같은 팩트는 서버가 결정적으로 계산하고, LLM에는 그 집계만 넘겨 자연어 요약과 우선순위 추천만 받습니다. 결과는 `career_analysis_run`에 저장하는데, 입력 집계를 SHA-256으로 지문화해서 같은 입력이면 AI를 다시 안 부르고 캐시를 재사용합니다."
- **꼬리질문 대응:** "OpenAI는 Responses API의 json_schema strict로 호출해 출력 구조를 강제하고, 호출이 실패하면 규칙 기반 mock으로 폴백하면서 status를 FALLBACK으로 남겨 화면이 안 깨집니다. 면접 데이터는 면접 도메인 담당(D/E) 영역이라 매퍼 서브쿼리로 읽기만 합니다. 크레딧 차감은 사용자가 명시적으로 재분석을 누른 강제 실행 때만 1회 기록합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 왜 점수 계산을 LLM에 안 맡겼나요?**
LLM은 숫자를 환각으로 틀리게 만들 수 있고 같은 입력에도 출력이 흔들립니다. "8건 중 5건 부족" 같은 팩트는 재현 가능해야 하므로 자바 집계로 결정적으로 계산하고, LLM에는 그 집계를 서사·추천으로 바꾸는 역할만 줬습니다. 책임 분리이자 신뢰성·비용 양쪽의 이유입니다.

**Q2. fingerprint를 SHA-256으로 만든 이유는?**
입력 집계를 정규화한 문자열에 대해 안정적이고 충돌이 사실상 없는 캐시 키가 필요했습니다. 같은 입력 → 같은 키 → 캐시 적중, 입력이 한 글자라도 바뀌면 키가 달라져 자동 재생성됩니다. JDK 표준이라 의존성도 안 늘어납니다.

**Q3. 캐시가 stale(낡음)되면 어떻게 갱신되나요?**
지원 건이나 적합도가 바뀌면 집계가 바뀌고 지문이 달라져 다음 조회 때 자동으로 1회 재생성됩니다. 그래도 즉시 다시 보고 싶으면 사용자가 재분석 버튼으로 강제 실행할 수 있습니다. 이때만 크레딧을 차감합니다.

**Q4. LLM 호출이 죽으면 화면도 죽나요?**
아니요. `OpenAiCareerTrendAiService`가 예외를 잡아 `MockCareerTrendAiService`의 규칙 기반 요약으로 폴백하고 status를 `FALLBACK`으로 남깁니다. 또 API 키가 아예 없으면 처음부터 mock으로 동작해, 키 미발급 단계에서도 화면·관리자 통계 흐름을 그대로 검증할 수 있게 했습니다.

**Q5. FALLBACK 결과는 캐시되나요? FAILED는요?**
SUCCESS와 FALLBACK은 결과가 있으니 캐시 재사용 대상입니다. 다만 `findFreshRun`은 status가 `FAILED`인 실행은 재사용 후보에서 제외해, 실패가 사용자에게 고정되지 않고 다음에 다시 시도되도록 했습니다.

## 8. 직접 말해보기

1. "적합도 분석과 장기 경향 분석의 차이를 한 문장으로 말하고, 왜 점수는 서버가 계산하고 문장만 LLM이 만드는지 이유 두 가지를 대보세요."
2. "fingerprint 캐시가 어떻게 비용을 줄이는지, 그리고 데이터가 바뀌었을 때 어떻게 자동으로 갱신되는지를 캐시 미스/적중 흐름으로 설명해 보세요."

## 퀴즈

<QuizBox question="장기 취업경향 분석에서 적합도 점수·부족 역량 빈도 같은 수치는 누가 계산하는가?" :choices="['OpenAI LLM이 프롬프트로 직접 계산한다','AnalysisServiceImpl이 자바 코드로 결정적으로 집계한다','프런트엔드가 차트 라이브러리로 계산한다','MySQL 트리거가 자동 계산한다']" :answer="1" explanation="점수·빈도 같은 팩트는 AnalysisServiceImpl이 자바로 결정적으로 집계하고, LLM에는 그 집계만 넘겨 자연어 요약과 추천만 만들게 한다. 환각으로 수치가 틀어지는 것을 막고 재현성을 확보하기 위해서다." />

<QuizBox question="forceRefresh=false 상태에서 입력 집계의 fingerprint가 직전 성공 실행과 동일하면 어떻게 동작하는가?" :choices="['항상 OpenAI를 다시 호출한다','저장된 career_analysis_run 결과를 재사용하고 AI를 호출하지 않는다','mock 서비스를 강제로 호출한다','크레딧을 1 차감하고 재실행한다']" :answer="1" explanation="findFreshRun이 같은 지문의 최신 성공 실행을 찾으면 저장된 요약을 그대로 재사용한다. AI를 다시 부르지 않아 토큰 비용이 0이다. 입력이 바뀌어 지문이 달라지거나 사용자가 명시적으로 재분석할 때만 실제 AI를 실행한다." />

<QuizBox question="OpenAI 호출이 실패했을 때 CareerTuner의 장기 경향 분석이 결과 신뢰도와 가용성을 어떻게 지키는지 설명하라." explanation="OpenAiCareerTrendAiService가 예외를 잡아 MockCareerTrendAiService의 규칙 기반 요약으로 폴백하고 결과 status를 FALLBACK으로 남긴다. 덕분에 화면이 깨지지 않고, API 키가 없는 단계에서도 mock으로 전 흐름을 검증할 수 있다. 한편 CareerAnalysisOpenAiClient는 429·5xx·타임아웃에 대해 최대 3회 지수 백오프로 재시도하고, json_schema strict로 출력 구조를 강제해 파싱 신뢰도를 높인다. status가 FAILED인 실행은 캐시 재사용에서 제외해 실패가 고정되지 않도록 한다." />
