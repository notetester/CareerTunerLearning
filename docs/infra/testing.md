# 테스트 전략

> CareerTuner는 "전체를 켜서 확인"하는 대신, AI 폴백 디스패처·매퍼 SQL·타입 계약처럼 깨지기 쉬운 지점을 빠른 단위/계약 테스트로 핀포인트 검증한다. 백엔드 JUnit 5(45개 이상), 프런트 타입 계약 + tsc, 파이썬 unittest + 릴리즈 게이트가 CI에서 자동으로 돈다.

## 1. 한 줄 정의

테스트 전략이란, "무엇을 어떤 종류의 테스트로 어디까지 자동 검증할지"에 대한 의도적인 선택이다. CareerTuner는 외부 의존성(AI, DB)이 많은 프로젝트라, 느린 통합 테스트를 늘리는 대신 **경계와 계약을 좁게 찌르는 단위/계약 테스트**에 무게를 둔다.

## 2. 단어 뜻 (용어 풀이)

| 용어 | 뜻 | CareerTuner에서의 예 |
| --- | --- | --- |
| 단위 테스트(Unit Test) | 클래스/함수 하나를, 협력 객체는 가짜(Mock)로 대체해 격리 검증 | `FallbackFitAnalysisAiServiceTest`가 OSS/OpenAI 클라이언트를 Mockito로 대체 |
| 계약 테스트(Contract Test) | 두 계층/모듈이 주고받는 데이터 "모양(스키마)"이 어긋나지 않는지 검증 | 프런트 `types.contract.test.ts`, 백엔드 매퍼 XML 테스트 |
| Mock / Stub | 진짜 의존성 대신 동작을 미리 지정한 가짜 객체 | `mock(OpenAiFitAnalysisAiService.class)` |
| 테스트 더블(Test Double) | Mock/Stub/Fake를 아우르는 상위 개념 | mock LLM 결과를 반환하는 `MockFitAnalysisAiService` |
| 회귀(Regression) 테스트 | 고친 버그가 다시 살아나지 않는지 막는 테스트 | 워커의 `test_*_regression*` 세트 |
| 스모크(Smoke) 테스트 | "켜지긴 하는가"를 얕고 빠르게 보는 테스트 | docker compose config + 워커 이미지 스모크 |

:::tip JUnit / Mockito / AssertJ
- **JUnit 5(Jupiter)**: 자바 표준 테스트 프레임워크. `@Test`로 메서드를 테스트로 표시.
- **Mockito**: 가짜 객체 생성·행위 지정(`when(...).thenReturn(...)`)·호출 검증(`verify(...)`).
- **AssertJ**: 읽기 쉬운 단언(`assertThat(x).isEqualTo(y)`).
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

CareerTuner는 검증을 안 하면 특히 위험한 구조다.

- **AI 호출은 비결정적이고 비용·키가 든다.** 매번 진짜 OpenAI/Ollama를 부르면 테스트가 느리고 불안정하며 돈이 든다. → AI 클라이언트를 Mock으로 바꿔, "분기 로직"만 결정론적으로 검증한다.
- **MyBatis SQL은 XML 문자열이라 컴파일러가 안 잡는다.** 오타나 잘못된 `WHERE`가 런타임에야 터진다. → 매퍼 XML을 읽어 핵심 조건문 존재를 단언하는 계약 테스트로 컴파일 타임 수준의 안전망을 만든다.
- **프런트/백엔드 응답 필드명이 어긋나면 화면이 조용히 빈다.** TypeScript는 런타임 응답을 모른다. → 응답 타입을 객체 리터럴로 실제 채워보며 `tsc`가 누락/오타를 잡게 한다.
- **공개 데모 배포가 있다.** 시크릿이 빌드 결과에 섞이면 사고다. → CI에 시크릿 스캔과 릴리즈 준비 체크를 둔다.

## 4. CareerTuner에서 어디에 썼나 (실제 파일/영역)

### 백엔드 — JUnit 5 (45개 이상)

`backend/src/test/java/com/careertuner/**` 아래에 도메인별로 위치한다.

| 분류 | 대표 테스트 | 무엇을 검증 |
| --- | --- | --- |
| AI 서비스 (영역 C) | `fitanalysis/ai/FallbackFitAnalysisAiServiceTest` | OSS→OpenAI→Mock 폴백 분기, "OSS 실패 시 OpenAI로 넘어가는가" |
| AI 서비스 (영역 C) | `analysis/ai/OpenAiCareerTrendAiServiceTest`, `dashboard/ai/OpenAiDashboardInsightAiServiceTest` | 취업경향·대시보드 인사이트 응답 파싱/검증 |
| 오케스트레이터 | `interview/service/InterviewAgentOrchestratorTest` | 가상면접 에이전트 흐름 |
| 매퍼 XML 계약 | `applicationcase/mapper/ApplicationCaseExtractionMapperXmlTest`, `admin/mapper/AdminSearchMapperXmlTest` | SQL의 상태 전이·잠금·스키마 컬럼 |
| 서비스 규칙 | `fitanalysis/service/FitAnalysisServiceImplTest`, `credit/service/CreditServiceImplTest` | 점수/판정·크레딧 차감 같은 비즈니스 규칙 |
| 컨벤션 | `JacksonUsageConventionTests`, `applicationcase/dto/ApplicationCaseExtractionContractTest` | 직렬화 관례, DTO 계약 |

:::details 폴백 디스패처 테스트가 핵심인 이유 (영역 C)
`FallbackFitAnalysisAiServiceTest`는 AI를 한 번도 진짜로 부르지 않고 다음을 못 박는다.

- provider=oss이고 클라이언트 available()이면 OSS 사용, OpenAI는 `never()` 호출.
- OSS가 `BusinessException`을 던지면 OpenAI 결과로 폴백.
- base-url이 없으면(`available()==false`) OSS를 아예 시도하지 않음.
- 기본 provider는 openai, OSS 모델 기본값/`maxTokens>=1024` 같은 설정 불변식.

즉 "값비싼 외부 의존성의 분기 로직"만 떼어내 결정론적으로 검증하는, AI 코드 단위 테스트의 교과서적 형태다.
:::

### 프런트 — 타입 계약 테스트 + tsc

`frontend/src/admin/features/*/types.contract.test.ts` 4종(application-cases, company-analysis, job-analysis, prompts).

:::warning 이 파일들은 실행되지 않는다
프런트엔드에는 vitest 같은 테스트 러너가 없고 `test` 스크립트도 없다. `.contract.test.ts`는 응답/쿼리 타입을 **객체 리터럴로 채워보는 타입 전용 파일**이고, 검증은 `npm run typecheck`(= `tsc --noEmit`)가 한다. 필드명·옵셔널·null 허용이 백엔드 응답과 어긋나면 컴파일이 깨진다. 끝에 `void value;`를 붙이는 건 "값을 쓰진 않지만 타입은 확정하겠다"는 관용구다.
:::

### 파이썬 워커 (영역 B) — unittest + 릴리즈 게이트

`ml/job-posting-worker/tests/test_*.py`. API/HTTP 서버 테스트(`test_job_posting_worker_api`, `test_worker_http_server`), 문서 추출, 회귀 후보, 그리고 `test_release_readiness_check`·`test_production_readiness_audit` 같은 **출시 준비 점검 테스트**까지 포함한다.

### CI 연결 (`.github/workflows/`)

| 워크플로 | 테스트 단계 |
| --- | --- |
| `frontend-ci.yml` | `tsc` 타입체크 + build (계약 테스트가 여기서 검증됨) |
| `service-pipeline-ci.yml` | 백엔드 `./gradlew test` + 워커 `python -m unittest discover -s tests` + 운영 드릴 + 릴리즈 준비 체크 + docker compose/이미지 스모크 |
| `deploy-demo.yml` | mock 빌드 + 빌드 결과 시크릿 스캔 + 공개 데모 repo 푸시 |

## 5. 핵심 동작 원리 (패턴별로)

### (1) AI 단위 테스트 = "가짜로 갈아끼우고 분기만 본다"

```java
OssFitAnalysisAiService oss = mock(OssFitAnalysisAiService.class);
when(oss.generate(command)).thenThrow(new BusinessException(ErrorCode.INTERNAL_ERROR, "..."));
when(openAi.generate(command)).thenReturn(tagged("openai-result", "gpt-5"));

FitAnalysisAiResult result = service.generate(command);

assertThat(result.strategy()).isEqualTo("openai-result"); // OSS 실패 → OpenAI 폴백
verify(oss, never()).generate(command); // 시도 안 했음을 검증하는 경우도 있음
```

핵심은 진짜 LLM을 안 부른다는 것. 검증 대상은 응답 내용이 아니라 **어떤 경로를 탔는가**다.

### (2) 매퍼 XML 계약 = "SQL 문자열을 읽어 불변식을 단언"

DB를 띄우지 않고, XML 파일을 읽어 특정 `<select>`/`<update>` 블록의 조건이 그대로 있는지 본다.

```java
String xml = Files.readString(Path.of(".../ApplicationCaseExtractionMapper.xml"));
String claim = xml.substring(xml.indexOf("<update id=\"claimQueuedExtraction\""), ...);
assertThat(claim).contains("status = 'RUNNING'");
assertThat(claim).contains("status = 'QUEUED'"); // QUEUED → RUNNING 전이만 허용
```

DB 없이 빠르게 돌면서도 "큐 클레임이 RUNNING 행을 잘못 건드리는" 회귀를 막는다. 스키마 컬럼·UNIQUE 키 존재까지 같은 방식으로 검증한다.

### (3) 타입 계약 = "리터럴로 채우고 컴파일러가 채점"

```ts
const row: AdminJobAnalysisRow = { id: 11, confirmedAt: null, /* ...모든 필드... */ };
void row; // 타입만 확정. 런타임 실행 없음
```

### 테스트 피라미드 위치

```
        스모크/통합 (적게)   ← docker compose config, 워커 이미지 스모크
      계약 (중간)           ← 매퍼 XML, types.contract.ts
   단위 (많게, 빠르게)        ← AI 폴백/서비스 규칙, 워커 함수
```

## 6. 면접 답변 3단계

- **초간단(1문장)**: "느리고 비싼 AI·DB는 직접 안 부르고, 폴백 분기는 Mock 단위 테스트로, SQL과 응답 타입은 계약 테스트로 좁게 찔러 CI에서 자동 검증합니다."
- **기본**: "백엔드는 JUnit 5 45개 이상으로 AI 폴백 디스패처·서비스 규칙·매퍼 SQL을 검증합니다. AI는 Mockito로 클라이언트를 대체해 OSS→OpenAI→Mock 폴백 경로만 결정론적으로 보고, 매퍼는 DB 없이 XML 문자열을 읽어 상태 전이·잠금 조건을 단언합니다. 프런트는 응답 타입을 리터럴로 채운 계약 테스트를 tsc로 검증하고, 파이썬 워커는 unittest와 릴리즈 준비 체크를 둡니다. 셋 다 GitHub Actions에서 PR마다 돕니다."
- **꼬리질문 대응**: "통합 테스트를 늘리지 않은 건 ROI 판단입니다. AI는 비결정적·유료라 통합으로 안정 검증이 어렵고, 가치 있는 버그는 대부분 '분기 로직'과 '계층 간 계약'에서 나옵니다. 그래서 그 둘을 빠른 테스트로 집중 커버하고, 진짜 기동은 스모크 한 겹으로만 확인합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. 단위 테스트와 계약 테스트의 차이는?
단위 테스트는 한 클래스의 **내부 동작/분기**를 격리해 검증합니다(예: 폴백 디스패처가 OSS 실패 시 OpenAI로 가는가). 계약 테스트는 두 경계가 **주고받는 데이터의 모양**이 어긋나지 않는지를 봅니다(매퍼 SQL이 기대 조건을 포함하는가, 프런트 타입이 백엔드 응답과 맞는가). 전자는 "맞게 동작하나", 후자는 "약속을 지키나"입니다.
:::

:::details Q. AI 응답이 매번 다른데 어떻게 테스트하나요?
응답 자체를 검증하지 않습니다. 실제 LLM 호출은 Mock으로 대체하고, 검증 대상을 "결정론적인 부분", 즉 폴백 분기·예외 처리·점수 확정 규칙·설정 불변식으로 좁힙니다. `FallbackFitAnalysisAiServiceTest`가 `when(...).thenReturn/thenThrow`로 가짜 결과를 주고 `result.strategy()` 같은 태그로 어떤 경로를 탔는지만 확인하는 식입니다.
:::

:::details Q. 프런트 contract 테스트는 어떤 러너로 실행되나요?
별도 러너가 없습니다. `.contract.test.ts`는 타입 전용 파일이라 `npm run typecheck`(tsc --noEmit)가 컴파일하며 검증합니다. 객체 리터럴에 모든 필드를 채워보므로, 백엔드 응답과 필드명·옵셔널·null 허용이 어긋나면 빌드가 깨집니다. CI의 frontend-ci에서 자동으로 돕니다.
:::

:::details Q. DB도 안 띄우고 SQL을 어떻게 테스트하나요?
매퍼 XML 파일을 문자열로 읽어, 특정 statement 블록에 기대하는 조건이 그대로 있는지 AssertJ의 `contains`/`doesNotContain`으로 단언합니다. 가벼운 정적 계약 검증이라 빠르고, "큐 클레임이 QUEUED만 RUNNING으로 바꾸는가" 같은 회귀를 막습니다. 한계는 SQL의 의미·실행 결과까지는 못 본다는 점이라, 실행 동작은 서비스 테스트와 스모크가 보완합니다.
:::

:::details Q. 커버리지보다 무엇을 우선하나요?
커버리지 숫자보다 "깨지면 아픈 곳"을 우선합니다. 외부 의존성의 분기 로직, 계층 간 계약, 비즈니스 규칙(점수·크레딧)이 우선순위이고, getter처럼 부서질 일 없는 코드에 테스트를 늘리지 않습니다. 공개 데모가 있어 시크릿 스캔·릴리즈 준비 체크도 테스트 전략의 일부로 봅니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "왜 진짜 OpenAI를 안 부르고 Mock으로 폴백만 테스트하는가"를 30초 안에 설명해 보라. (비결정성·비용·검증 가치 세 단어가 들어가야 한다.)
2. "매퍼 XML 계약 테스트의 장점과 한계"를 각각 한 문장으로 말해 보라.

## 퀴즈

<QuizBox question="CareerTuner의 AI 폴백 디스패처 단위 테스트(FallbackFitAnalysisAiServiceTest)가 실제 OpenAI/Ollama를 호출하지 않는 가장 큰 이유는?" :choices="['테스트 코드 작성이 더 쉬워서', 'AI 호출이 비결정적이고 비용·키가 들어 결정론적 검증이 어렵기 때문', '자바에서 HTTP 호출이 불가능해서', '커버리지 수치를 높이려고']" :answer="1" explanation="진짜 LLM은 매번 결과가 다르고 비용·API키가 들어 테스트가 느리고 불안정해진다. 그래서 클라이언트를 Mock으로 대체하고 폴백 분기 같은 결정론적 로직만 검증한다." />

<QuizBox question="프런트엔드의 types.contract.test.ts 파일들은 무엇으로 검증되는가?" :choices="['vitest run', 'jest', 'npm run typecheck (tsc --noEmit)', 'eslint']" :answer="2" explanation="프런트엔드에는 테스트 러너가 없다. 계약 파일은 타입 전용이라 tsc(타입체크)가 컴파일하며 백엔드 응답과의 타입 불일치를 잡는다." />

<QuizBox question="매퍼 XML 계약 테스트(ApplicationCaseExtractionMapperXmlTest)의 장점과 한계를 한 문장씩 설명하라." explanation="장점은 DB를 띄우지 않고 XML 문자열을 읽어 핵심 SQL 조건(상태 전이·잠금·스키마 컬럼)의 존재를 빠르게 단언하므로, 컴파일러가 못 잡는 SQL 오타·잘못된 조건의 회귀를 막아준다는 점이다. 한계는 SQL의 실제 의미나 실행 결과까지는 검증하지 못하므로, 실행 동작은 서비스 단위 테스트와 스모크 테스트로 보완해야 한다는 점이다." />
