# C 클래스 설계 — 전략·폴백 패턴

> 한 줄 핵심: 적합도 AI는 `FitAnalysisAiService` 인터페이스 하나에 4개 구현(`@Primary` 디스패처 + OSS + OpenAI + Mock)을 꽂아 **전략(Strategy) + 폴백(Fallback)** 으로 묶었고, 호출부(`FitAnalysisServiceImpl`)는 인터페이스 타입만 알기 때문에 어떤 백엔드가 뜨든 코드가 변하지 않는다.

---

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

C 영역의 클래스 골격은 프로젝트 공통 규약인 **4계층(controller → service → mapper → domain)** 위에, AI 호출만 따로 떼어 **인터페이스 + 다중 구현 폴백 체인**으로 설계한 구조다. 핵심 추상화는 세 가지다.

- `FitAnalysisAiService` 인터페이스 + 4구현 = 전략 + 폴백 (적합도 #12~15)
- `CareerAnalysisRunService` = 장기 경향(#16/17)과 대시보드(#18)가 공유하는 **read-through 캐시 코디네이터**
- `PrepStepHandler` 인터페이스 = 오케스트레이터(autoprep)가 `key`로 찾아 부르는 단계 핸들러

:::tip 이 페이지가 대비하는 면접 질문
- "AI 서비스를 왜 인터페이스로 분리했나요? 그냥 `if/else` 한 클래스로 안 되나요?"
- "구현이 4개인데 스프링은 어떤 걸 주입하나요? 충돌 안 나나요?"
- "폴백 체인을 클래스로 어떻게 표현했나요? 새 모델을 추가하려면 어디를 고치나요?"
- "캐시 코디네이터를 왜 별도 클래스로 뽑았나요?"
- "오케스트레이터에 새 단계를 추가할 때 기존 코드를 안 건드릴 수 있나요?"
:::

근거 문서: 영역 C 클래스 설계서(스토리보드 산출물), 런타임 소스 `backend/src/main/java/com/careertuner/fitanalysis/**`, `analysis/**`, `ai/autoprep/**`.

---

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 2.1 풀고 싶었던 문제

적합도 분석 AI는 **세 가지 백엔드**가 공존해야 했다.

| 백엔드 | 언제 동작 | 비용 | 가용성 |
| --- | --- | --- | --- |
| 자체 OSS 모델(Ollama, `careertuner-c-career-strategy-3b`) | `provider=oss` + base-url 설정 | 무료(자체 서빙) | 서빙 떠 있을 때만 |
| OpenAI Responses API | `OPENAI_API_KEY` 발급 시 | 토큰당 과금 | 외부 의존 |
| Mock 규칙엔진 | 항상 | 0 | 100% (순수 자바) |

문제는 "어느 하나가 죽어도 화면이 깨지면 안 된다"와 "비즈니스 로직(`FitAnalysisServiceImpl`)이 이 분기를 알면 안 된다"였다.

### 2.2 선택: 인터페이스 + 다중 구현 (전략) + 디스패처 (폴백)

`FitAnalysisAiService`라는 **얇은 인터페이스 하나**(메서드 단 1개: `generate(command)`)를 정의하고, 그 뒤에 네 구현을 두되, 외부에 보이는 **유일한 빈은 `@Primary` 디스패처**(`FallbackFitAnalysisAiService`)로 정했다.

```text
FitAnalysisServiceImpl
   └─ depends on: FitAnalysisAiService (인터페이스만)
        ↑ 스프링이 @Primary 빈을 주입
   FallbackFitAnalysisAiService (디스패처)
        ├─ 1차: OssFitAnalysisAiService
        ├─ 2차: OpenAiFitAnalysisAiService
        └─ (최종 안전망) MockFitAnalysisAiService
```

### 2.3 대안과 트레이드오프

| 대안 | 왜 안 썼나 |
| --- | --- |
| `if (provider=="oss") … else if …` 한 클래스에 다 넣기 | 분기·재시도·가드레일이 한 메서드에 뭉쳐 테스트 불가. 새 모델 추가 = 거대 메서드 수정. SRP 위반. |
| 스프링 프로파일로 빈 교체(`@Profile`) | 런타임에 OSS→OpenAI로 **즉시 폴백**해야 하는데, 프로파일은 부팅 시 한 번 고정이라 부적합. |
| `@Qualifier`로 호출부가 직접 구현 선택 | 호출부가 어떤 모델이 사는지 알아야 함 → 결합도 상승. C가 원한 건 "호출부는 무지(無知)". |
| 데코레이터로 폴백을 감싸기 | 폴백 순서가 단순 1차→2차→안전망이라 디스패처 한 클래스로 충분. 데코레이터는 오버엔지니어링. |

:::tip 핵심 한 문장
"전략 패턴으로 **알고리즘(어떤 모델)** 을 갈아끼우고, 디스패처 한 곳에 **폴백 순서**를 모았다. 비즈니스 로직은 인터페이스만 안다."
:::

---

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 · 테이블 근거)

### 3.1 4계층 + AI 하위 패키지

| 계층 | 적합도(`fitanalysis`) 실제 클래스 | 역할 |
| --- | --- | --- |
| controller | `FitAnalysisController` (`/api/fit-analyses`) | `@AuthenticationPrincipal`에서 `userId`만 추출 |
| service | `FitAnalysisService` 인터페이스 → `FitAnalysisServiceImpl` | 집계·파생·오케스트레이션, `@Transactional` |
| mapper | `FitAnalysisMapper` (`@Mapper` + XML) | `findGenerationSource`, `insertFitAnalysis`, `insertAiUsageLog` 등 |
| domain | `FitAnalysisResult`, `FitAnalysisLearningTask`, `FitAnalysisGenerationSource` | DB 행 매핑 |
| **ai (별도)** | `FitAnalysisAiService` + 4구현 | 폴백 체인 |
| **ai.prompt (별도)** | `FitAnalysisPromptCatalog` | 도메인 전용 프롬프트 카탈로그 |

4계층 자체는 [Spring MVC REST 규약](/backend/spring-mvc-rest)과 [MyBatis](/backend/mybatis)를 그대로 따르지만, **AI 호출만 `ai` 하위 패키지로 격리**한 것이 C의 설계 포인트다. 서비스는 "비싼 부분(AI)"을 인터페이스 너머로 위임하고, 자기는 결정적 집계와 영속화에 집중한다.

### 3.2 전략 + 폴백을 이루는 4개 클래스

```text
fitanalysis/ai/
  FitAnalysisAiService.java          ← «interface»  generate(command)
  FallbackFitAnalysisAiService.java  ← @Primary @Service  디스패처
  OssFitAnalysisAiService.java       ← @Service  뉴로-심볼릭 조립
  OpenAiFitAnalysisAiService.java    ← @Service  + guardApplyDecision
  MockFitAnalysisAiService.java      ← @Service  규칙엔진(symbolic 권위)
```

실제 인터페이스는 정말 메서드 하나뿐이다.

```java
public interface FitAnalysisAiService {
    FitAnalysisAiResult generate(FitAnalysisAiCommand command);
}
```

명령(`FitAnalysisAiCommand`)과 결과(`FitAnalysisAiResult`)를 **record**로 고정해, 어떤 구현이 동작하든 입·출력 계약이 동일하다. 이 record 계약이 곧 전략 패턴의 "공통 인터페이스"다.

### 3.3 공유 인프라와 캐시 코디네이터

- 자체모델/OpenAI 호출 인프라(`CareerAnalysisOssClient`, `CareerAnalysisOpenAiClient`, 설정 Properties, `CareerAnalysisAiUsage` record)는 **`analysis.ai.provider` 한 곳**에 모아 `fitanalysis`·`analysis`·`dashboard` 세 도메인이 공유한다.
- `CareerAnalysisRunService`는 `analysis` 패키지에 있지만 **대시보드(#18)와 공유**되는 캐시 코디네이터다. `findFreshRun(...)` / `record(...)` / `fingerprint(canonical)`(SHA-256)을 노출한다.

---

## 4. 동작 원리 (데이터 흐름 · 단계 · 표/작은 코드)

### 4.1 디스패처가 폴백을 결정하는 실제 코드

`FallbackFitAnalysisAiService.generate`는 게이트 두 개만 본다.

```java
@Primary @Service
public class FallbackFitAnalysisAiService implements FitAnalysisAiService {
    public FitAnalysisAiResult generate(FitAnalysisAiCommand command) {
        if (properties.isOss() && ossClient.available()) {     // 게이트 ①②
            try {
                return ossService.generate(command);           // 1차: 자체모델
            } catch (RuntimeException ex) {
                log.warn("OSS 실패 → OpenAI/Mock 폴백: {}", ex.getMessage());
            }
        }
        return openAiService.generate(command);                // 2차(+내부 Mock)
    }
}
```

- 게이트 ① `properties.isOss()` — 설정 문자열이 `"oss"`인가(대소문자 무시).
- 게이트 ② `ossClient.available()` — base-url이 설정돼 있나.
- 둘 다 참이고 OSS가 성공하면 거기서 끝. OSS가 `RuntimeException`을 던지면 **로그만 남기고** OpenAI 단계로 흘러간다.

### 4.2 "최종 안전망"은 디스패처가 아니라 OpenAI 구현 안에 있다

설계의 묘수 하나: `FallbackFitAnalysisAiService`는 Mock을 **직접 참조하지 않는다**. 대신 `OpenAiFitAnalysisAiService`가 자기 안에서 Mock으로 떨어진다.

```java
// OpenAiFitAnalysisAiService
public FitAnalysisAiResult generate(FitAnalysisAiCommand command) {
    if (!openAiClient.configured()) {
        return mockService.generate(command);     // 키 없음 → 즉시 Mock
    }
    try {
        StructuredResponse response = openAiClient.request("fit_analysis", schema(), ...);
        // ... json_schema strict 파싱 + guardApplyDecision
    } catch (RuntimeException e) {
        FitAnalysisAiResult fb = mockService.generate(command);   // 호출 깨짐 → Mock
        // status="FALLBACK", model="mock-fallback", retryable=true 로 감쌈
    }
}
```

즉 **OpenAI 단계는 항상 결과를 돌려준다**(성공 또는 Mock). 그래서 디스패처는 "OSS 시도 → 안 되면 OpenAI"라는 두 줄로 끝나고, "그래도 안 되면?"이라는 무한 분기를 적지 않아도 된다. **항상 성공하는 Mock**이 체인의 바닥을 받친다.

### 4.3 폴백 경로별 상태 라벨

| 경로 | status | usage.model | retryable |
| --- | --- | --- | --- |
| OSS 자체모델 성공 | `SUCCESS` | `careertuner-c-career-strategy-3b` | false |
| OpenAI 성공 | `SUCCESS` | `gpt-5`(설정값) | false |
| 키 미발급 → Mock | `SUCCESS` | mock 토큰(`usage.mock=true`) | false |
| OpenAI 호출 실패 → Mock | `FALLBACK` | `mock-fallback` | **true** |
| 모든 경로 예외 후 기록 | `FAILED` | — | — (캐시 제외) |

이 status 어휘는 `ai_usage_log`와 `career_analysis_run.status`에 그대로 기록돼, 관리자 화면에서 "어느 경로로 동작했는지"를 추적할 수 있다.

### 4.4 Mock의 이중 역할 (왜 4구현이 깔끔한가)

`MockFitAnalysisAiService`(규칙엔진)는 두 자리에서 쓰인다.

1. **최종 안전망** — OpenAI/OSS가 실패할 때 결정적 결과 공급.
2. **OSS의 골격(skeleton) 공급자** — `OssFitAnalysisAiService`가 점수·판단을 만들 때 `ruleEngine.generate(command)`를 먼저 부른다.

```java
// OssFitAnalysisAiService
FitAnalysisAiResult skeleton = ruleEngine.generate(command);  // symbolic 권위
// ... 자체모델은 fitSummary/strategyActions/learningTaskReasons 설명만 채움
// 병합 시 점수·applyDecision은 skeleton(규칙엔진) 값을 그대로 사용
```

이게 [뉴로-심볼릭 분리](/ai/self-llm-strategy)의 코드 표현이다. **점수·판단은 Mock(규칙엔진)이 소유**하고, 모델은 설명만 만든다. 그래서 Mock은 단순 "더미"가 아니라 **체인 전체의 결정론적 권위**다 — 클래스를 4개로 나눈 덕에 이 권위를 한 곳(Mock)에 모을 수 있었다.

### 4.5 캐시 코디네이터의 흐름

`CareerAnalysisRunService`는 장기 경향·대시보드가 공유한다. AI 재실행을 막는 read-through 캐시다.

```java
public Optional<CareerAnalysisRun> findFreshRun(Long userId, String type, String fingerprint) {
    CareerAnalysisRun latest = mapper.findLatest(userId, type);
    if (latest == null || "FAILED".equals(latest.getStatus())
            || !fingerprint.equals(latest.getInputFingerprint())) {
        return Optional.empty();                 // miss → 재실행 필요
    }
    return Optional.of(latest);                   // hit → 저장 결과 재사용
}
```

- `fingerprint`는 `SHA-256(canonical JSON input)`. 입력이 같으면 같은 키 → 저장 결과 재사용(토큰·크레딧 0).
- `FAILED`는 캐시하지 않는다(다음에 재시도하라고).
- `record(...)`가 실제 AI 실행을 `career_analysis_run` + `ai_usage_log`에 append하고, `DASHBOARD_SUMMARY` 타입이면 `dashboard_insight`까지 미러한다.

이 한 클래스를 `analysis`와 `dashboard`가 공유하기 때문에, **두 기능이 하나의 실행 이력 테이블과 fingerprint 규칙을 일관되게** 쓴다. 자세한 캐시 메커니즘은 [폴백 체인](/ai/fallback)·[캐시·fingerprint](/area-c/caching-fingerprint) 참고.

### 4.6 오케스트레이터의 `PrepStepHandler`

자동 준비(autoprep) 오케스트레이터는 6개 도메인 단계를 병렬·의존 순서로 돌린다. 각 단계는 인터페이스 하나로 추상화돼 있다.

```java
public interface PrepStepHandler {
    String key();                                  // "FIT" / "JOB" / "INTERVIEW" ...
    default boolean enabled() { return true; }     // false면 SKIPPED
    PrepStepResult handle(PrepStepContext ctx, PrepProgress progress);
}
```

C의 구현은 `FitPrepHandler`(`key()="FIT"`)이며, 내부에서 `FitAnalysisService.generate(...)`를 호출하고 서브스텝("근거 검색"/"채점"/"검증")을 SSE로 흘린다.

```java
@Component
public class FitPrepHandler implements PrepStepHandler {
    public String key() { return "FIT"; }
    public PrepStepResult handle(PrepStepContext context, PrepProgress progress) {
        if (context.applicationCaseId() == null)
            return PrepStepResult.skipped("FIT", "지원 건이 없어 건너뜀");
        progress.substep("근거 검색", "지식베이스 근거 주입");
        progress.substep("채점", "요건 매칭 점수화");
        progress.substep("검증", "근거 가드 적용");
        var result = fitAnalysisService.generate(context.userId(), context.applicationCaseId());
        return PrepStepResult.done("FIT", "적합도 분석 완료", result, ms);
    }
}
```

인터페이스 주석이 핵심을 말한다 — "새 파트는 이 인터페이스를 구현한 `@Component`를 추가하기만 하면 자동 등록된다(오케 무변경)". 즉 **개방-폐쇄 원칙(OCP)** 이 코드로 보장된다. 자세한 흐름은 [오케스트레이터(autoprep)](/ai/orchestrator-autoprep)·[오케스트레이터 FIT](/area-c/orchestrator-fit) 참고.

---

## 5. 구현 상태 (됨 vs 향후) 정직 구분

| 항목 | 상태 |
| --- | --- |
| `FitAnalysisAiService` 인터페이스 + 4구현 클래스 | **구현됨** |
| `@Primary` 디스패처 폴백 배선(OSS→OpenAI→Mock) | **구현됨** (단위 테스트 `FallbackFitAnalysisAiServiceTest` 존재) |
| Mock 규칙엔진(점수·판단·조건매트릭스·로드맵·자격증) | **구현됨**, 결정론적 동작 |
| OSS 뉴로-심볼릭 조립 + grounding 가드 코드 | **구현됨** (`OssFitAnalysisAiService`) |
| OpenAI Responses API + `guardApplyDecision` 재검증 코드 | **구현됨** |
| `CareerAnalysisRunService` 캐시 코디네이터 + SHA-256 fingerprint | **구현됨** |
| `PrepStepHandler` / `FitPrepHandler` 자동 등록 | **구현됨** |
| 프롬프트 카탈로그 분리(`FitAnalysisPromptCatalog` VERSION `v0.2`) | **구현됨** |
| 실제 파인튜닝 모델 학습·서빙 | **향후 과제** (Ollama base-url 연결 시 OSS 경로 활성화) |
| OpenAI 키 연동 라이브 호출 | **향후 과제** (`OPENAI_API_KEY` 발급 시 즉시 활성) |

:::warning 정직하게 말할 포인트
"아키텍처(인터페이스·폴백 배선·가드레일·캐시)는 **완성**이고, 현재는 키 미발급이라 Mock 규칙엔진 경로로 결정론적으로 동작합니다. 화면·계약·DTO는 실제 LLM과 **동일**하고, 키만 발급되면 `OpenAi*Service` 경로가 코드 변경 없이 켜집니다."
:::

---

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문 대응)

**초간단(10초).**
"적합도 AI는 인터페이스 하나에 구현 4개를 꽂은 전략+폴백 구조입니다. 비즈니스 로직은 인터페이스만 알고, `@Primary` 디스패처가 자체모델→OpenAI→Mock 순서로 폴백해서 어떤 게 죽어도 화면이 안 깨집니다."

**기본(40초).**
"`FitAnalysisAiService`는 메서드 하나(`generate`)짜리 얇은 인터페이스이고, 구현이 Oss/OpenAI/Mock 세 종류, 거기에 `@Primary` 디스패처 `FallbackFitAnalysisAiService`가 더해집니다. 호출부 `FitAnalysisServiceImpl`은 인터페이스 타입으로 주입받기 때문에 스프링이 `@Primary` 디스패처를 넣어줍니다. 디스패처는 `provider=oss`와 base-url 두 게이트를 보고 자체모델을 시도하고, 실패하면 OpenAI 단계로 넘기는데, OpenAI 구현은 키가 없거나 호출이 깨지면 자기 안에서 Mock으로 폴백합니다. Mock은 항상 성공하는 규칙엔진이라 체인의 바닥을 받칩니다."

**꼬리질문 대응(핵심 한 줄).**
"Mock이 두 역할입니다 — 최종 안전망이면서, 동시에 OSS가 점수·판단 골격을 만들 때 쓰는 규칙엔진(symbolic 권위)이죠. 그래서 점수는 늘 결정론적입니다."

---

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 구현이 4개인데 스프링은 어떻게 하나만 주입하나요? 충돌 안 나나요?**
A. `FallbackFitAnalysisAiService`에 `@Primary`를 붙였습니다. 인터페이스 타입(`FitAnalysisAiService`)으로 주입을 요청하면 스프링이 후보 4개 중 `@Primary` 빈을 고릅니다. 나머지 3개(Oss/OpenAi/Mock)는 디스패처와 서로가 **구체 타입으로** 생성자 주입해 쓰니 충돌이 없습니다.

**Q2. 왜 디스패처가 Mock을 직접 안 부르고 OpenAI 구현 안에 폴백을 뒀나요?**
A. "키 없음"과 "호출 실패"는 둘 다 OpenAI 단계의 사정이라, 그 폴백 책임을 OpenAI 구현에 응집시키는 게 자연스럽습니다. 덕분에 디스패처는 "OSS 안 되면 OpenAI"라는 두 줄로 끝나고, OpenAI 단계가 **항상 결과를 보장**하니 체인이 단순해집니다. 단일 책임이 더 명확해지는 배치입니다.

**Q3. 새 모델(예: 다른 OSS)을 추가하려면 어디를 고치나요?**
A. `FitAnalysisAiService`를 구현한 클래스를 하나 추가하고, 디스패처에서 시도 순서에 한 줄 끼우면 됩니다. 호출부(`FitAnalysisServiceImpl`)와 record 계약(`Command`/`Result`)은 **그대로**입니다. 전략 패턴이라 알고리즘 교체가 국소적입니다.

**Q4. `if/else` 한 클래스로 안 되나요? 클래스가 많아진 게 오버엔지니어링 아닌가요?**
A. 각 구현이 재시도·백오프·grounding 가드·guardApplyDecision 같은 **고유 로직**을 갖습니다. 한 클래스에 모으면 한 메서드가 수백 줄이 되고 단위 테스트가 불가능합니다. 실제로 구현마다 별도 테스트(`OssFitAnalysisAiServiceTest`, `OpenAiFitAnalysisAiServiceTest` 등)가 있어 분리의 값을 회수합니다.

**Q5. `CareerAnalysisRunService`는 왜 별도 클래스로 뽑았나요?**
A. 장기 경향(#16/17)과 대시보드 요약(#18)이 **같은 캐시 규칙**(SHA-256 fingerprint, FAILED 미캐시, 같은 실행 이력 테이블)을 써야 합니다. 캐시 코디네이션을 한 클래스에 모으면 두 도메인이 일관된 정책을 공유하고, 캐시 정책을 한 곳에서 바꿀 수 있습니다. 단일 진실 지점입니다.

**Q6. 오케스트레이터에 새 단계를 넣을 때 기존 코드를 안 건드릴 수 있나요?**
A. `PrepStepHandler`를 구현한 `@Component`만 추가하면 스프링이 자동 수집해 오케스트레이터가 `key`로 찾아 부릅니다. 오케스트레이터 코드는 무변경입니다(OCP). `FitPrepHandler`가 그 예이고, JOB→FIT 의존 순서만 선언으로 표현합니다.

---

## 8. 직접 말해보기

아래를 막힘없이 30초씩 설명할 수 있으면 합격선이다.

1. "`FitAnalysisAiService` 인터페이스 뒤에 구현이 몇 개고, 스프링이 어떤 걸 주입하며, 왜 그렇게 되는가?"
2. "OSS가 실패하면 정확히 어떤 순서로 폴백이 일어나고, 각 경로의 `status`/`model` 라벨은 무엇인가?"
3. "Mock 규칙엔진의 두 가지 역할을 코드 위치까지 짚어 설명하기."
4. "`CareerAnalysisRunService`가 캐시 히트/미스를 판정하는 세 조건과, 왜 별도 클래스인가."
5. "`PrepStepHandler`로 새 단계를 추가할 때 오케스트레이터를 왜 안 건드려도 되는가(OCP)."

---

## 퀴즈

<QuizBox question="FitAnalysisServiceImpl이 AI를 호출할 때, 스프링이 주입하는 실제 빈은 무엇인가?" :choices="['MockFitAnalysisAiService', 'OpenAiFitAnalysisAiService', '@Primary가 붙은 FallbackFitAnalysisAiService 디스패처', 'OssFitAnalysisAiService']" :answer="2" explanation="FitAnalysisServiceImpl은 인터페이스 타입(FitAnalysisAiService)으로 주입을 요청하고, 후보 4개 중 @Primary가 붙은 FallbackFitAnalysisAiService가 선택된다. 호출부는 어떤 구현이 동작하는지 모른다." />

<QuizBox question="폴백 체인에서 MockFitAnalysisAiService가 맡는 두 가지 역할로 가장 정확한 것은?" :choices="['로깅 전용과 캐시 전용', '최종 안전망(항상 성공)과, OSS 경로의 점수·판단 골격(규칙엔진) 공급', '프롬프트 생성과 토큰 집계', 'OpenAI 호출과 재시도 관리']" :answer="1" explanation="Mock은 (a) OpenAI/OSS 실패 시 결정적 결과를 주는 최종 안전망이자, (b) OssFitAnalysisAiService가 ruleEngine.generate로 점수·applyDecision 골격을 만들 때 쓰는 symbolic 권위다. 점수·판단은 늘 Mock이 소유한다." />

<QuizBox question="CareerAnalysisRunService.findFreshRun이 캐시 미스로 판정하지 않는 경우는?" :choices="['최신 실행의 status가 FAILED일 때', '입력 fingerprint가 저장된 값과 다를 때', '같은 fingerprint이고 최신 실행이 FAILED가 아닐 때', '해당 타입의 실행 기록이 아예 없을 때']" :answer="2" explanation="findFreshRun은 최신 실행이 존재하고, FAILED가 아니며, fingerprint(SHA-256)가 일치할 때만 그 결과를 재사용(히트)한다. FAILED·fingerprint 불일치·기록 없음은 모두 미스다." />
