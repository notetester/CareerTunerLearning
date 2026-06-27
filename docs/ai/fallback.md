# 폴백 체인 (다단 폴백 / Graceful Degradation)

> 외부 AI나 인프라가 죽거나 아직 설정 안 됐을 때, 단계적으로 대체 수단으로 내려가며 서비스 자체는 살려두는 설계.

## 1. 한 줄 정의

폴백 체인은 "가장 좋은 수단 → 그다음 → 최후의 안전망" 순서로 줄을 세워두고, 앞 단계가 실패하면 자동으로 다음 단계로 내려가 **응답을 어떻게든 돌려주는** 방어 전략이다.

## 2. 단어 뜻 (약자·어원)

| 용어 | 뜻 | 메모 |
| --- | --- | --- |
| Fallback | "물러설 곳, 대비책" — fall(떨어지다) + back(뒤로) | 앞 수단이 무너지면 뒤로 물러설 자리 |
| Fallback chain | 폴백을 여러 개 사슬(chain)처럼 연결한 것 | 1단계 실패 → 2단계 → ... → 최후단계 |
| Graceful degradation | "우아한 성능 저하" | 기능을 *전부* 잃는 대신, *일부만* 줄여서 계속 동작 |
| Fail-fast vs Fail-soft | 빨리 죽기 vs 부드럽게 버티기 | 폴백은 fail-soft 쪽 |

핵심 대비: **장애(failure)는 "전부 멈춤"이 기본값**이다. 폴백은 그 기본값을 "조금 덜 좋은 상태로 계속"으로 바꾸는 의도적 설계다.

## 3. 왜 필요한가 (없으면 무슨 문제)

AI 플랫폼은 "내 코드 밖"에 의존이 너무 많다. OpenAI API, 로컬 Ollama, Qdrant 벡터DB, 푸시 발송 인프라, 결제 게이트웨이... 이들은 내가 통제할 수 없고 **언제든 느려지거나, 죽거나, 아직 키조차 안 발급됐을 수 있다.**

폴백이 없으면:

- 외부 API 키 한 개 미발급 = 그 기능이 통째로 500 에러. 개발/데모조차 막힘.
- OpenAI 일시 장애 = 적합도 분석 화면이 빈 화면 + 스택트레이스.
- 푸시 서버 미구축 = 알림을 호출하는 모든 흐름이 예외로 끊김.
- 한 파트(예: 면접)가 실패하면 같이 돌던 멀쳐 파트(프로필·공고)까지 동반 실패.

:::tip 핵심 직관
"외부 의존은 깨질 것"을 **전제**로 깔고 설계한다. 폴백 체인은 그 전제 위에서 "깨졌을 때 어디로 도망갈지"를 미리 정해두는 것.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 근거)

CareerTuner에는 **이미 구현된 graceful 패턴**과 **자체 LLM 도입 시의 계획된 폴백 체인**이 둘 다 있다. 정직하게 구분한다.

### (구현) AI 실패 → AI_UNAVAILABLE 에러코드

외부 LLM 호출이 실패하면 스택트레이스를 던지는 대신, 의미 있는 도메인 에러로 변환해 사용자에게 "일시적 실패"를 알린다.

`backend/.../common/exception/ErrorCode.java`:

```java
AI_UNAVAILABLE(HttpStatus.BAD_GATEWAY, "AI 초안 생성에 일시적으로 실패했습니다."),
INSUFFICIENT_CREDIT(HttpStatus.PAYMENT_REQUIRED, "크레딧이 부족합니다."),
```

`backend/.../admin/ticket/ai/TicketDraftAiClient.java` — Ollama 호출이 던진 저수준 예외를 잡아 도메인 에러로 변환:

```java
} catch (RestClientException | ClassCastException e) {
    log.error("티켓 답변 초안 생성 실패", e);
    throw new BusinessException(ErrorCode.AI_UNAVAILABLE);  // 502 + 사람이 읽는 메시지
}
```

같은 파일에서 **프롬프트 파일 로드 실패**도 폴백한다 — 파일이 없으면 코드에 박아둔 기본 프롬프트로 계속 진행한다.

```java
} catch (IOException e) {
    log.error("티켓 초안 프롬프트 로드 실패, 기본 프롬프트 사용", e);
    return "너는 CareerTuner 고객센터 상담사를 돕는 AI 어시스턴트다. ...";
}
```

### (구현) 푸시 인프라 미설정 → LoggingPushSender

푸시(Web Push/FCM/APNs) 발송기가 아직 없을 때, 호출부가 깨지지 않게 **로그로 대체**하는 기본 구현을 둔다. `PushSender` 인터페이스 경계를 두고, 실제 발송기를 추가하면 `@Primary`로 갈아끼운다.

`backend/.../notification/push/LoggingPushSender.java`:

```java
@Component
public class LoggingPushSender implements PushSender {
    @Override
    public void send(PushSubscription subscription, String title, String body, String link) {
        // 실제 전송 대신 의도를 로그로 남겨 흐름이 끊기지 않게 한다
        log.info("[push] 발송기 미설정 — {} 기기로 보낼 알림: '{}' / link={}", ...);
    }
}
```

코드 주석이 직접 말한다: *"OpenAI/RAG 와 동일한 graceful 패턴"*. 즉 같은 철학이 코드베이스 전체에 깔려 있다.

### (구현) AutoPrep 오케스트레이터 — 부분 실패 격리

`backend/.../ai/autoprep/AutoPrepOrchestrator.java`는 여러 파트(A 프로필·B 공고·C 적합도·D 면접 등)를 의존 그래프대로 병렬 실행한다. 핵심 폴백 정책이 클래스 주석에 박혀 있다:

> *"미구현/비활성은 SKIPPED, 실패해도 FAILED 로 기록하고 완주한다."*

한 파트가 죽어도 SSE 진행 보고는 그 파트만 FAILED로 표시하고 **나머지 파트는 끝까지 돌린다.** 이건 체인이 아니라 **격리(isolation)형 graceful degradation** — 한 부분의 실패가 전체를 끌고 내려가지 않게 막는다.

### (구현) 프론트 USE_MOCK 토글 — 백엔드 없이도 개발 지속

API 키가 미발급이거나 백엔드가 안 떠 있어도 개발/데모가 멈추지 않도록, 프론트에 mock 토글이 있다. `frontend/src/app/lib/api.ts`:

```ts
// 데모/목 모드: 백엔드 없이 동작. 등록된 mock 핸들러로 응답한다.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
```

이건 "런타임 폴백"은 아니지만, **공급자 부재에 대비한 대체 경로**라는 같은 사상이다. 같은 파일의 401 → `/auth/refresh` 단일-플라이트 자동 리프레시도 "실패를 곧장 노출하지 않고 한 번 회복을 시도"하는 작은 폴백이다. (자세히는 [프론트 API 레이어](/frontend/api-layer-jwt-refresh))

### (계획) 자체 LLM career-strategy 폴백 체인

[자체 LLM 전략](/ai/self-llm-strategy) 도입 시 적용할 4단 체인이다. **아직 계획 단계**임을 명확히 한다.

```text
캐시(cache) → 규칙엔진(rule engine) → OpenAI → Mock
   가장 빠름/싸다              결정적·검증된 답   고품질      최후 안전망
```

- **캐시**: 같은 입력이면 저장된 결과 즉시 반환 (비용 0, 지연 최소)
- **규칙엔진**: 서버 규칙으로 산출 가능한 부분(적합도 점수·판정은 이미 서버 규칙으로 확정)
- **OpenAI**: 자유서술·전략 등 LLM이 필요한 부분
- **Mock**: 위가 전부 실패해도 형식이 맞는 더미를 돌려줘 화면이 깨지지 않게

## 5. 핵심 동작 원리 (표·작은 코드)

폴백에는 두 가지 형태가 있고, CareerTuner는 둘 다 쓴다.

| 형태 | 동작 | CareerTuner 예 |
| --- | --- | --- |
| **체인(chain)형** | 1순위 실패 → 2순위 → ... 순차 시도 | 캐시→규칙→OpenAI→Mock (계획) |
| **격리(isolation)형** | 병렬 파트 중 실패한 것만 표시, 나머지 완주 | AutoPrep SKIPPED/FAILED |
| **대체(substitute)형** | 인프라 부재 시 같은 인터페이스의 더미 구현 | LoggingPushSender, USE_MOCK |
| **변환(translate)형** | 저수준 예외 → 의미 있는 도메인 에러 | catch → AI_UNAVAILABLE |

체인형의 뼈대는 단순하다 — 각 단계를 try로 감싸고, 실패하면 다음으로:

```java
// 의사코드: 캐시 → 규칙 → OpenAI → Mock
public Strategy generate(Input in) {
    var cached = cache.get(in);
    if (cached != null) return cached;               // 1) 캐시 적중

    try { return ruleEngine.run(in); }               // 2) 규칙으로 가능하면
    catch (NotApplicable ignored) { /* 다음 단계 */ }

    try {
        var r = openAi.call(in);
        cache.put(in, r);
        return r;                                     // 3) LLM 호출 성공
    } catch (AiException e) {
        log.warn("OpenAI 실패, mock 폴백", e);
        return mock(in);                              // 4) 최후 안전망
    }
}
```

:::warning 폴백 설계의 함정
- **조용한 폴백 금지**: 단계가 내려갈 때 반드시 로그/지표를 남긴다. 안 그러면 "Mock으로만 돌고 있는데 아무도 모르는" 사태가 난다. CareerTuner는 매 폴백마다 `log.warn`/`log.error`를 찍는다.
- **품질 표시**: 폴백으로 나온 답은 "정확도가 낮을 수 있음"을 사용자/로그에 표시. 점수·판정 같은 **확정값은 절대 Mock에 맡기지 않고** 서버 규칙으로 확정한다.
- **무한 재시도 금지**: 폴백 ≠ 같은 실패를 계속 두드리는 것. 한 번 회복 시도(refresh) 후 안 되면 다음 단계로.
:::

## 6. 면접 답변 3단계 (초간단 / 기본 / 꼬리질문)

**초간단**: "외부 AI나 인프라가 죽었을 때 서비스가 같이 죽지 않게, 더 단순한 대체 수단으로 단계적으로 내려가는 설계입니다."

**기본**: "CareerTuner는 외부 LLM·푸시·벡터DB 등 통제 못 하는 의존이 많아서, 실패를 전제로 깔고 graceful degradation을 적용했습니다. 구현된 것으로는 AI 호출 실패를 `AI_UNAVAILABLE` 도메인 에러로 변환하고, 푸시 인프라가 없으면 `LoggingPushSender`로 로그 대체하고, AutoPrep 오케스트레이터는 한 파트가 실패해도 FAILED로 기록만 하고 나머지를 완주시킵니다. 자체 LLM을 붙일 때는 캐시→규칙엔진→OpenAI→Mock 4단 폴백 체인을 계획하고 있습니다."

**꼬리질문 대비**: "단, 폴백은 조용하면 안 돼서 매 단계 로그를 남기고, 점수처럼 정확해야 하는 값은 Mock이 아니라 서버 규칙으로 확정합니다. 무한 재시도가 아니라 한 번 회복 시도 후 다음 단계로 넘기는 식으로 폭주를 막습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 폴백 체인과 그냥 try-catch의 차이는?
try-catch는 "한 번 잡는다". 폴백 체인은 "잡은 뒤 **대안을 줄 세워** 다음 수단으로 넘긴다". 핵심은 catch 안에서 *다른 품질의 결과를 계속 생산*한다는 점. CareerTuner의 `AI_UNAVAILABLE` 변환은 변환형 폴백, 캐시→규칙→OpenAI→Mock은 진짜 체인형입니다.
:::

:::details Q2. 폴백 때문에 잘못된(저품질) 데이터가 정답처럼 보이면?
그래서 두 가지를 분리합니다. (1) **확정값**(적합도 점수·판정)은 LLM/Mock에 맡기지 않고 **서버 규칙으로 확정**합니다. (2) 폴백으로 생성된 자유서술은 출처/품질 메타를 남겨 추적 가능하게 합니다. Mock은 "형식만 맞는 더미"라 화면 깨짐 방지용이지, 사용자에게 사실로 단정하지 않습니다.
:::

:::details Q3. AutoPrep에서 한 파트가 실패하면 사용자는 뭘 보나요?
SSE로 파트별 진행을 실시간 보고하는데, 실패한 파트만 FAILED 상태로 표시되고 나머지는 정상 완료됩니다. 의존 관계상 FIT·INTERVIEW는 JOB(공고 분석) 커밋 뒤 시작하므로, JOB이 죽으면 그 둘은 SKIPPED 처리됩니다. 전체가 빈 화면으로 죽는 일은 없습니다. (자세히는 [AutoPrep 오케스트레이터](/ai/orchestrator-autoprep))
:::

:::details Q4. OpenAI가 느리기만 하고 안 죽으면(타임아웃)? 폴백이 작동하나요?
타임아웃을 명시적으로 둬야 폴백이 동작합니다. CareerTuner의 Ollama 클라이언트는 connect 10초·read 60초 타임아웃을 설정해두고, 초과하면 예외 → 폴백 경로로 빠집니다. 타임아웃 없는 호출은 "영원히 매달려" 폴백 자체가 무의미해지므로 의존 호출엔 항상 타임아웃을 겁니다.
:::

:::details Q5. 폴백이 항상 Mock으로만 동작하는 걸 어떻게 감지하나요?
각 단계 진입 시 로그(`log.warn`)와 지표를 남기고, "폴백 단계 분포"를 모니터링합니다. OpenAI 단계 성공률이 0%로 떨어지면 알림을 받는 식. 폴백의 진짜 위험은 "조용히 저품질로 돌아가는 것"이라, 관측 가능성(observability)이 폴백 설계의 절반입니다.
:::

## 8. 직접 말해보기

아래를 막힘 없이 말할 수 있으면 이 개념을 가진 것이다.

1. 폴백 체인을 한 문장으로 정의하고, "fail-fast"와 대비해 설명해 보라.
2. CareerTuner에서 **이미 구현된** graceful 패턴 3개를 클래스 이름과 함께 대보라. (힌트: 에러코드 변환, 푸시 대체, 부분 실패 격리)
3. 계획된 4단 폴백 체인의 순서와, 각 단계가 빠른지/싼지/정확한지를 말해 보라.
4. 폴백 설계에서 절대 하면 안 되는 것 2가지(조용한 폴백, 확정값을 Mock에 위임)를 이유와 함께 설명하라.

## 퀴즈

<QuizBox question="CareerTuner에서 푸시 발송 인프라가 아직 없을 때 호출 흐름이 끊기지 않게 하는 구현은?" :choices="['예외를 던져 즉시 503 반환', 'LoggingPushSender로 로그를 남겨 대체', '요청을 큐에 무한 대기', '프론트에서 호출 자체를 막음']" :answer="1" explanation="LoggingPushSender는 PushSender 인터페이스의 기본 구현으로, 발송기 미설정 시 실제 전송 대신 의도를 로그로 남겨 흐름을 끊지 않는다. 실제 발송기 추가 시 @Primary로 교체한다." />

<QuizBox question="계획된 자체 LLM career-strategy 폴백 체인의 올바른 순서는?" :choices="['OpenAI → 캐시 → 규칙엔진 → Mock', '캐시 → 규칙엔진 → OpenAI → Mock', '규칙엔진 → Mock → OpenAI → 캐시', 'Mock → OpenAI → 규칙엔진 → 캐시']" :answer="1" explanation="가장 빠르고 싼 캐시부터, 결정적인 규칙엔진, 고품질 OpenAI, 최후 안전망 Mock 순으로 내려간다. 확정값(점수·판정)은 Mock이 아니라 서버 규칙으로 확정한다." />

<QuizBox question="폴백 설계에서 '조용한 폴백(silent fallback)'이 위험한 이유를 한 문장으로 설명하라." explanation="모범답안: 단계가 내려갈 때 로그/지표를 남기지 않으면, 실제로는 저품질 대체 수단(예: Mock)으로만 돌고 있는데도 아무도 알아채지 못해 품질 저하가 은폐되기 때문이다. 그래서 매 폴백 단계마다 log.warn/지표를 남기고 단계 분포를 모니터링해야 한다." />
