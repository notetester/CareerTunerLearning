# 3단 폴백 체인 — 화면이 절대 깨지지 않게

> 자체 OSS → OpenAI → Mock 규칙엔진. 어느 단계가 죽어도 사용자 화면은 그대로 뜬다. 마지막 단은 외부 의존이 0이라 **항상 성공**한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

3단 폴백 체인은 **적합도 분석 AI 호출이 실패해도 사용자에게 깨진 화면을 절대 보여주지 않게** 하는 안전망이다. 1차로 자체 파인튜닝 모델(Ollama), 2차로 OpenAI, 3차로 결정적 규칙엔진(Mock)을 순서대로 시도하고, 마지막 단은 외부 의존이 없어 무조건 결과를 만든다.

이 페이지가 답하는 면접 질문:

- "AI가 죽으면 화면은 어떻게 되나요?" → 안 깨진다. 왜 안 깨지는지 구조로 설명할 수 있어야 한다.
- "왜 3단이나 두셨나요? 그냥 OpenAI 한 군데 쓰면 안 되나요?"
- "어느 단계로 응답이 나왔는지 추적할 수 있나요?" → `status` (`SUCCESS`/`FALLBACK`/`FAILED`)와 `retryable` 플래그.
- "API 키가 아직 없는데 어떻게 개발/시연을 했나요?" → mock 토글.

:::tip 핵심 한 문장
"AI는 **있으면 좋은 것**이지 **없으면 안 되는 것**이 아니게 설계했습니다. 점수·판단은 규칙엔진이 소유하므로, AI 텍스트가 없어도 분석 결과 자체는 항상 만들어집니다."
:::

이 페이지는 [뉴로-심볼릭 설계](/area-c/neuro-symbolic)와 [가드레일](/area-c/guardrails)을 전제로 한다. 폴백 체인이 "항상 성공"할 수 있는 근본 이유가 바로 점수·판단을 LLM이 아니라 규칙엔진이 소유하기 때문이다.

## 2. 왜 이렇게 설계했나 (설계 의도 · 대안과 트레이드오프)

### 풀어야 했던 문제

취업 적합도 분석은 사용자가 **"지원해도 되나"를 결정하는 화면**이다. 여기서 스피너가 영원히 돌거나 500 에러가 뜨면, 단순 UX 문제가 아니라 제품 신뢰가 무너진다. 게다가 우리 팀은 프로젝트 진행 시점에 **OpenAI 키가 아직 발급되지 않은 상태**였다. 즉:

1. 외부 LLM은 언제든 느려지거나 5xx를 던질 수 있다(가용성).
2. 자체 모델은 소형(3B)이라 JSON이 가끔 깨진다(안정성).
3. 키가 없어도 개발·시연·데모는 계속 돌아가야 한다(개발 연속성).

### 선택지와 트레이드오프

| 대안 | 장점 | 단점 | 채택 |
| --- | --- | --- | --- |
| OpenAI 단일 호출 | 단순 | 키 없으면 개발 불가, 외부 장애 = 화면 장애 | 미채택 |
| OpenAI + try/catch로 빈 결과 | 화면은 안 죽음 | 결과가 비어 사용자에게 무의미 | 미채택 |
| **자체 OSS → OpenAI → Mock 규칙엔진** | 어느 단도 죽어도 의미 있는 결과, 키 없이 개발 | 구조 복잡, 단계마다 계약 일치 필요 | **채택** |

핵심 통찰은 **"Mock을 가짜가 아니라 결정적 규칙엔진으로 승격"** 시킨 것이다. 보통 mock은 테스트용 더미지만, 우리 `MockFitAnalysisAiService`는 [점수 규칙엔진](/area-c/score-engine) 그 자체다. 점수·매칭·부족역량·지원판단·조건매트릭스를 결정론적으로 계산한다. 그래서 3차 폴백이 "그럴듯한 빈 껍데기"가 아니라 **실제로 쓸 수 있는 분석**이 된다.

:::warning 폴백이 "항상 성공"하는 진짜 이유
규칙엔진은 외부 네트워크·키·모델이 전혀 필요 없다. 입력(공고 요구조건 + 프로필)만 있으면 순수 계산으로 점수를 낸다. 외부 의존이 0이므로 **던질 예외가 구조적으로 없다.** 이것이 graceful degradation의 마지막 바닥(floor)이다.
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 메서드 근거)

체인은 **전략(Strategy) + 폴백 패턴**으로 구현했다. `FitAnalysisAiService` 인터페이스에 4개 구현체가 있고, 디스패처 하나가 `@Primary`로 진입점을 잡는다.

| 역할 | 클래스 | 비고 |
| --- | --- | --- |
| 진입점 / 디스패처 | `FallbackFitAnalysisAiService` (`@Primary`) | OSS→OpenAI 분기 |
| 1차 — 자체 OSS | `OssFitAnalysisAiService` | 규칙엔진 골격 + 모델은 설명만 |
| 2차 — OpenAI | `OpenAiFitAnalysisAiService` | 구조화 출력 + 내부 Mock 폴백 |
| 3차 — 규칙엔진 | `MockFitAnalysisAiService` | 결정적, 항상 성공 |

진입점이 `@Primary`인 게 핵심이다. 서비스 레이어(`FitAnalysisServiceImpl`)는 인터페이스 `FitAnalysisAiService`만 주입받고, 스프링이 `@Primary`인 디스패처를 꽂아준다. **호출하는 쪽은 폴백이 몇 단인지 전혀 모른다.** 디스패처를 갈아끼워도 호출부는 그대로다.

디스패처의 실제 분기 (`FallbackFitAnalysisAiService.generate`, 추상화):

```java
public FitAnalysisAiResult generate(FitAnalysisAiCommand command) {
    if (properties.isOss() && ossClient.available()) {     // provider=oss && base-url 설정됨
        try {
            return ossService.generate(command);           // 1차: 자체 OSS
        } catch (RuntimeException ex) {
            log.warn("C 적합도 OSS 자체모델 실패 → OpenAI/Mock 폴백: {}", ex.getMessage());
        }
    }
    return openAiService.generate(command);                // 2차 진입(키 없으면 내부에서 3차 Mock)
}
```

여기서 두 가지를 읽어내야 한다.

- **OSS는 두 조건이 모두 참일 때만 시도한다.** `properties.isOss()`(`provider=oss`)이고 `ossClient.available()`(`oss.base-url` 설정됨). 둘 중 하나라도 거짓이면 OSS는 건너뛴다. `available()`은 내부적으로 `oss.configured()`(base-url이 비어있지 않은지)를 본다.
- **2차/3차의 경계는 디스패처에 없다.** `openAiService.generate()` 호출 한 줄로 끝난다. OpenAI 단계 안에 Mock 폴백이 **포개져(nested)** 있기 때문이다(다음 섹션).

관련 설정은 `CareerAnalysisAiProviderProperties`(prefix `careertuner.analysis.ai`)에 모여 있다: `provider`(기본 `openai`), `oss.base-url`(비면 OSS 비활성), `oss.model`(`careertuner-c-career-strategy-3b`), `oss.max-tokens`(최소 1024 강제), `oss.max-retries`, `oss.grounding-retries`.

## 4. 동작 원리 (데이터 흐름 · 단계 · 표)

### 4-1. 전체 흐름

```text
FitAnalysisServiceImpl
   │  generate(command)         ← 인터페이스만 안다
   ▼
FallbackFitAnalysisAiService (@Primary, 디스패처)
   │
   ├─ provider=oss && base-url 설정?
   │     예 → OssFitAnalysisAiService.generate()
   │            성공 → status="SUCCESS" 반환 ✅
   │            예외 → catch → 아래로 폴백 ↓
   │
   ▼ (OSS 건너뜀 또는 실패)
OpenAiFitAnalysisAiService.generate()
   │
   ├─ openAiClient.configured()(키 있음)?
   │     아니오 → MockFitAnalysisAiService.generate()  → status="SUCCESS"(mock) ✅
   │     예    → OpenAI Responses API 호출
   │              성공 → status="SUCCESS" ✅
   │              예외 → catch → Mock 결과 + status="FALLBACK", retryable=true ✅
   ▼
규칙엔진은 외부 의존 0 → 항상 결과 → 화면 안 깨짐
```

### 4-2. 단계별 실패 처리

| 단계 | 무엇이 호출됨 | 실패 시 | 결과 status |
| --- | --- | --- | --- |
| 1차 OSS | `OssFitAnalysisAiService` (Ollama, 자체 모델) | `RuntimeException` 던짐 → 디스패처가 catch | (다음 단계로) |
| 2차 OpenAI | `OpenAiFitAnalysisAiService` (Responses API) | 내부 `catch`에서 Mock 결과로 대체 | `FALLBACK` |
| 3차 Mock | `MockFitAnalysisAiService` (규칙엔진) | 실패 없음 (외부 의존 0) | `SUCCESS`(mock) |

### 4-3. OSS 단계 내부 — 재시도와 grounding guard

OSS 단계는 그냥 한 번 부르고 마는 게 아니다. 두 겹의 방어선을 통과해야 SUCCESS다.

1. **전송 재시도** — `CareerAnalysisOssClient`가 일시적 실패(5xx, 네트워크/타임아웃, 빈 응답/JSON 깨짐)를 `OssTransientException`으로 보고 `max-retries+1`회까지 재시도(선형 백오프 1·2·3배). 4xx는 재시도해도 같으니 즉시 폴백. 소진하면 `BusinessException`을 던져 디스패처가 OpenAI로 넘어가게 한다.
2. **grounding guard** — 모델이 **부족 역량을 보유한 것처럼 서술**하면(`groundingViolation`) 재호출하고, `grounding-retries` 소진 시 예외를 던져 폴백. 점수·판단은 어차피 규칙엔진이 소유하므로 이 검사는 **설명 텍스트(`fitSummary`/`strengths`)만** 본다.

:::details OSS 단계가 "설명만" 생성한다는 게 무슨 뜻인가
`OssFitAnalysisAiService.generate()`는 먼저 규칙엔진(`ruleEngine.generate()`)으로 **점수·매칭·부족·지원판단·조건매트릭스 골격**을 만든다. 그 값들을 *입력*으로 자체 모델에 넘기고, 모델은 `fitSummary`(한국어 설명)·`strategyActions`·`learningTaskReasons` 같은 **텍스트만** 반환한다. 모델이 `fitScore`나 `decision` 같은 금지키를 출력해도 **읽지 않는다**(화이트리스트). 그래서 OSS가 성공해도 점수는 규칙엔진 값 그대로다. 자세한 건 [뉴로-심볼릭](/area-c/neuro-symbolic) 참고.
:::

### 4-4. status / retryable의 의미

| 필드 | 값 | 의미 | 누가 세팅 |
| --- | --- | --- | --- |
| `status` | `SUCCESS` | 의도한 경로(OSS 또는 OpenAI 또는 mock)로 정상 생성 | 각 서비스 |
| `status` | `FALLBACK` | OpenAI 시도 실패 → Mock으로 대체됨 | `OpenAiFitAnalysisAiService` catch |
| `status` | `FAILED` | (장기경향/대시보드) AI가 끝내 실패 | `AnalysisServiceImpl` |
| `retryable` | `true` | 재시도하면 성공 가능성 있음(일시적) | FALLBACK/FAILED 경로 |
| `retryable` | `false` | 정상 결과거나 재시도 의미 없음 | SUCCESS 경로 |

이 `status`/`retryable`은 그냥 로깅용이 아니다. 서비스 레이어가 이걸로 **부수효과를 분기**한다(`FitAnalysisServiceImpl`):

- `ai_usage_log`에 `status`·model·토큰·`errorMessage`를 기록 → 어느 경로로 응답했는지 사후 추적.
- `creditUsed = "SUCCESS".equals(status) ? MOCK_CREDIT : 0` → **폴백(FALLBACK)이면 크레딧을 차감하지 않는다.** 우리가 못 준 값에 과금하지 않는다.
- `"SUCCESS".equals(status)`일 때만 완료 알림(`FIT_ANALYSIS_COMPLETE`)을 보낸다.
- [캐시](/area-c/caching-fingerprint) 코디네이터는 `FAILED`를 **저장/재사용하지 않는다**(실패를 캐싱하면 영구히 실패가 굳는다).

`AI_UNAVAILABLE`은 공통 `ErrorCode`(HTTP 502, "AI 초안 생성에 일시적으로 실패했습니다")다. 적합도 분석은 Mock 바닥이 있어 거의 502까지 가지 않지만, 외부 AI 의존이 더 강한 어드민 초안 류에서 이 코드를 쓴다. 즉 `AI_UNAVAILABLE`은 "일시적·재시도 가능"을 사용자에게 알리는 신호다.

## 5. 구현 상태 (됨 vs 향후) — 정직하게

| 항목 | 상태 |
| --- | --- |
| 3단 폴백 **배선**(디스패처 + 4 구현체) | 구현됨 |
| `status`/`retryable`/`AI_UNAVAILABLE` 분기 + `ai_usage_log` 기록 | 구현됨 |
| Mock 규칙엔진(점수·판단·신뢰도) | 구현됨, 결정적으로 동작 |
| OSS 통합 코드(`OssFitAnalysisAiService`, 재시도, grounding guard) | 구현됨 |
| OpenAI 통합 코드(`OpenAiFitAnalysisAiService`, 구조화 출력, `guardApplyDecision`) | 구현됨 |
| 단위 테스트(`FallbackFitAnalysisAiServiceTest` 5케이스: OSS 사용/OSS 실패→OpenAI/openai 기본/base-url 미설정 skip/기본값) | 구현됨 |
| 실제 파인튜닝 모델 학습·서빙 | **향후** (모델 카드/리포트는 작성, 운영 서빙은 키·인프라 확정 후) |
| OpenAI 키 실연동 | **향후** (키 발급 시 `oss.base-url`/키 설정만으로 활성) |

:::tip 면접에서의 정직한 한 줄
"**아키텍처와 코드는 완성**되어 있고, 현재는 규칙엔진(mock 토글) 기준으로 결정론적으로 데모합니다. **화면·API 계약은 실제 LLM과 동일**하므로, 키 발급 시 설정 한 줄(`provider`/`base-url`)로 1차·2차 경로가 켜집니다."
:::

이게 mock 토글 전략의 핵심이다. 프론트의 `VITE_USE_MOCK`과 백엔드의 `provider=openai`(키 없으면 내부 Mock) 덕분에, **키가 없어도 전체 흐름이 끊김 없이 돌았다.** 키가 생기면 토글만 바꾸면 된다. 화면 코드는 한 줄도 안 바뀐다.

## 6. 면접 답변 3단계

**초간단 (10초):**
"적합도 AI를 자체 모델 → OpenAI → 규칙엔진 순서로 3단 폴백시켜, 어느 단이 죽어도 화면이 안 깨지게 했습니다. 마지막 단은 외부 의존이 없어 항상 성공합니다."

**기본 (30초):**
"`FitAnalysisAiService` 인터페이스에 구현체 4개를 두고, `@Primary` 디스패처(`FallbackFitAnalysisAiService`)가 진입점입니다. provider가 oss이고 base-url이 있으면 자체 Ollama 모델을 먼저 시도하고, 실패하면 OpenAI로, OpenAI도 키가 없거나 실패하면 결정적 규칙엔진(Mock)으로 떨어집니다. 규칙엔진은 점수·판단을 순수 계산으로 만들어 외부 의존이 0이라 절대 실패하지 않습니다. 각 응답에 `status`(SUCCESS/FALLBACK/FAILED)와 `retryable`을 달아 `ai_usage_log`에 남기고, 폴백이면 크레딧을 안 깎습니다."

**꼬리질문 대응 (60초):**
"핵심 설계 의도는 'AI를 없어도 되는 것으로 만든다'였습니다. 점수·판단을 LLM이 아니라 규칙엔진이 소유하기 때문에(뉴로-심볼릭), LLM은 설명 텍스트만 담당하고 그게 비어도 분석 결과 자체는 만들어집니다. 그래서 폴백 마지막 단이 빈 껍데기가 아니라 실제로 쓸 수 있는 분석이 됩니다. 또 우리 팀은 OpenAI 키가 늦게 나와서, mock 토글로 키 없이 전체 흐름을 개발·시연했고, 키가 생기면 설정만 바꾸면 1·2차가 켜지도록 계약을 동일하게 맞춰뒀습니다. OSS 단계는 단순 호출이 아니라 일시 오류 재시도와 grounding guard(부족 역량을 보유로 서술하면 재호출)까지 통과해야 SUCCESS로 인정합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q1. 폴백이 "항상 성공"한다고 하셨는데, 진짜 절대 안 죽나요?**
마지막 단 `MockFitAnalysisAiService`는 외부 네트워크·키·모델을 일절 호출하지 않습니다. 입력(공고 요구조건 + 프로필)을 받아 `score = 10 + 필수충족비율*70 + 우대충족비율*20`처럼 순수 계산만 합니다. I/O가 없으니 던질 예외가 구조적으로 없습니다. 입력 자체가 비어 있으면 점수는 낮게 나오되 결과는 만들어지고, 별도 [신뢰도(confidence)](/area-c/neuro-symbolic)로 "이 점수를 얼마나 믿을지"를 따로 표기합니다.

**Q2. 그냥 OpenAI 하나만 쓰고 try/catch로 빈 값 주면 안 되나요?**
빈 값은 사용자에게 무의미합니다. "지원해도 되나"를 결정하는 화면에서 빈 분석은 오류 화면과 다를 바 없습니다. 우리 3차는 **결정적 규칙엔진**이라 폴백 시에도 점수·매칭·부족역량·액션플랜이 전부 채워집니다. 가용성과 결과 품질을 동시에 잡는 게 목적이었습니다.

**Q3. 어느 단계로 응답이 나왔는지 어떻게 압니까?**
응답의 `status`(`SUCCESS`/`FALLBACK`/`FAILED`)와 model 이름, `retryable` 플래그를 `ai_usage_log`에 기록합니다. FALLBACK이면 OpenAI 실패 후 mock으로 대체된 것이고 `retryable=true`입니다. 사용자에겐 결과 카드에 "AI 제안·확인 필요" 배지를 띄워 자동 생성물임을 투명하게 알립니다.

**Q4. 1차 OSS가 가끔 깨진 JSON을 준다면서요. 그건 어떻게 막나요?**
자체 모델은 3B 소형이라 JSON이 잘리거나 깨질 수 있어 두 가지로 방어합니다. (1) `CareerAnalysisOssClient`가 5xx·네트워크·빈 응답·JSON 파싱 실패를 일시 오류로 보고 `max-retries+1`회 재시도(선형 백오프). (2) `max-tokens`를 최소 1024로 강제해 설명 JSON truncation을 막습니다(`@PostConstruct`에서 부팅 시 검증). 그래도 안 되면 예외를 던져 OpenAI로 폴백합니다.

**Q5. OpenAI도 키가 없을 때는요?**
`OpenAiFitAnalysisAiService`가 `openAiClient.configured()`로 키 유무를 먼저 봅니다. 키가 없으면 호출 자체를 안 하고 바로 `MockFitAnalysisAiService.generate()`를 반환합니다(status SUCCESS, mock usage). 키가 있는데 호출이 실패하면 catch에서 mock 결과로 대체하되 status는 FALLBACK으로 구분합니다. 전자는 "설정상 mock", 후자는 "장애로 인한 폴백"이라 의미가 다릅니다.

**Q6. 디스패처를 `@Primary`로 둔 이유는?**
서비스 레이어가 인터페이스 `FitAnalysisAiService`만 의존하게 하려는 의존성 역전입니다. 스프링이 `@Primary` 빈을 주입하므로 호출부는 폴백 구조를 전혀 모릅니다. 나중에 폴백 순서를 바꾸거나 단을 추가해도 디스패처만 고치면 되고 호출 코드는 불변입니다. 전형적인 전략(Strategy) + 폴백 패턴입니다.

## 8. 직접 말해보기

다음을 막힘없이 60초 안에 설명할 수 있으면 이 페이지를 마스터한 것이다.

1. 3단을 순서대로 말하고, **각 단이 실패하면 어떻게 다음 단으로 가는지** 코드 흐름으로.
2. "마지막 단이 왜 절대 안 죽는가"를 **외부 의존 0 + 규칙엔진**으로.
3. `SUCCESS` / `FALLBACK` / `FAILED` / `retryable`이 각각 언제 세팅되고, 그걸로 **크레딧·알림·캐시**가 어떻게 분기되는지.
4. mock 토글로 **키 없이 개발/시연**한 전략과, 키 발급 시 무엇만 바꾸면 실 LLM이 켜지는지.
5. OSS 단계의 두 겹 방어(전송 재시도 + grounding guard)를 한 문장씩.

## 퀴즈

<QuizBox question="3단 폴백 체인의 마지막 단(3차)이 '항상 성공'할 수 있는 근본 이유는?" :choices="['OpenAI에 무한 재시도하기 때문', 'try/catch로 모든 예외를 빈 결과로 바꾸기 때문', 'Mock 규칙엔진이 외부 네트워크·키·모델 의존 없이 순수 계산만 하기 때문', '항상 캐시된 과거 결과를 반환하기 때문']" :answer="2" explanation="3차 MockFitAnalysisAiService는 입력(요구조건+프로필)만으로 결정적으로 점수를 계산합니다. 외부 I/O가 0이라 던질 예외가 구조적으로 없어 graceful degradation의 바닥이 됩니다." />

<QuizBox question="OpenAI 호출이 실패해 Mock 결과로 대체됐을 때, 응답의 status와 크레딧 처리는?" :choices="['status=SUCCESS, 크레딧 1 차감', 'status=FALLBACK, 크레딧 차감 안 함', 'status=FAILED, 크레딧 1 차감', 'status=FALLBACK, 크레딧 2 차감']" :answer="1" explanation="OpenAiFitAnalysisAiService의 catch가 mock 결과에 status=FALLBACK·retryable=true를 답니다. 서비스 레이어는 creditUsed를 SUCCESS일 때만 부과하므로 폴백에는 크레딧을 차감하지 않습니다." />

<QuizBox question="디스패처 FallbackFitAnalysisAiService가 1차 OSS를 시도하는 조건으로 옳은 것은?" :choices="['항상 무조건 시도한다', 'provider=oss 이고 oss.base-url(ossClient.available)이 설정돼 있을 때만', 'OpenAI 키가 없을 때만', 'mock 토글이 꺼져 있을 때만']" :answer="1" explanation="properties.isOss()(provider=oss)와 ossClient.available()(base-url 설정됨)가 모두 참일 때만 OSS를 시도하고, 실패하면 catch 후 OpenAI 단계로 넘어갑니다. 기본 provider=openai라 평소엔 OSS를 건너뜁니다." />
