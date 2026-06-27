# 로깅 (SLF4J · Lombok @Slf4j)

> "로그는 SLF4J 인터페이스에 찍고 실제 구현은 Logback에 맡깁니다. Lombok `@Slf4j`로 logger 보일러플레이트를 없애고, 레벨(debug/info/warn/error)로 운영 노이즈를 조절하며, 토큰·비밀번호 같은 민감정보는 절대 평문으로 남기지 않습니다."

## 1. 한 줄 정의

로깅은 **프로그램이 실행 중에 무슨 일이 일어났는지 시간순 기록을 남기는 것**이고, SLF4J는 그 기록을 남기는 **표준 인터페이스(facade)**, Lombok `@Slf4j`는 그 인터페이스를 한 줄로 자동 주입해 주는 어노테이션이다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| **Log** | 항해일지(logbook)에서 온 말. "언제 무엇이 있었나"를 순서대로 적은 기록 |
| **SLF4J** | Simple Logging Facade for Java. "단순한 자바 로깅 정면(facade)" — 직접 로그를 찍는 게 아니라 **로그 API만 정의**하는 추상화 계층 |
| **Facade** | 건물 정면. 뒤에 어떤 로깅 구현(Logback, Log4j2 등)이 있든 **앞쪽 호출 방식은 똑같이** 보이게 해주는 디자인 패턴 |
| **Logback** | SLF4J를 만든 사람이 만든 기본 구현체. Spring Boot의 기본 로깅 엔진 |
| **`@Slf4j`** | Lombok 어노테이션. 컴파일 시 `private static final Logger log = LoggerFactory.getLogger(클래스.class);` 한 줄을 자동 생성 |

핵심: **SLF4J = 인터페이스(약속), Logback = 구현(실제 동작)**. 코드는 SLF4J에만 의존하고, 구현은 의존성만 바꾸면 갈아끼울 수 있다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **`System.out.println` 으로 찍으면** → 레벨 구분이 없어 운영에서 끄지 못하고, 출력 위치(콘솔/파일)·포맷·시각을 제어할 수 없다. 성능도 떨어진다.
- **로깅 라이브러리를 직접 import 하면(예: Logback에 직접 의존)** → 나중에 구현을 바꾸려면 전 코드를 수정해야 한다. SLF4J facade를 쓰면 코드는 그대로 두고 의존성만 교체.
- **레벨이 없으면** → 디버그용 상세 로그와 진짜 에러가 뒤섞여, 장애 때 핵심을 못 찾는다.
- **장애 추적 불가** → AI 호출 실패, 외부 API 타임아웃, 예외 스택트레이스가 기록 안 되면 "왜 터졌는지"를 재현 없이 알 수 없다.

:::tip 로그 레벨 — 시끄러운 순서대로
`error` (장애) > `warn` (이상하지만 동작은 함) > `info` (정상 흐름 이정표) > `debug` (개발용 상세) > `trace` (초정밀)
운영에서는 보통 `info` 이상만 출력하고, `debug`는 개발/문제분석 때만 켠다. 설정 한 줄로 "어디까지 찍을지"를 바꾼다.
:::

## 4. CareerTuner에서 어디에 썼나 (백엔드)

CareerTuner 백엔드는 SLF4J + Lombok `@Slf4j` + Logback(Spring Boot 기본) 조합을 쓴다. `@Slf4j`는 26개 이상 클래스에 적용돼 있다.

| 위치 | 어떻게 쓰나 | 레벨 |
| --- | --- | --- |
| `common/exception/GlobalExceptionHandler` | 비즈니스 예외 `warn`, 예상 못 한 예외 `error`(스택트레이스 포함) | warn / error |
| `notification/push/LoggingPushSender` | 푸시 인프라 미설정 시 "발송 의도"를 `info`로 남기는 폴백 (토큰은 마스킹) | info |
| `applicationcase/service/OpenAiResponsesClient` | OpenAI 호출 재시도/I-O 실패를 `warn`으로 기록 (영역 C 인접 AI 엔진) | warn |
| `analysis/ai`, `dashboard/ai`, `fitanalysis/ai` (영역 C) | AI 분석 흐름·실패 진단 로그 | warn / info |
| `application.yaml` | `logging.level.com.careertuner: DEBUG` 로 자사 패키지만 상세 로깅 | 설정 |

:::warning 텍스트 로그 vs DB 사용량 로그 — 헷갈리지 말 것
CareerTuner에는 이름이 비슷한 두 가지가 공존한다. 면접에서 구분해 말해야 한다.

- **SLF4J 로그**(이 페이지 주제): 운영자가 콘솔/파일에서 보는 **진단용 텍스트 줄**. 휘발성에 가깝고 사람이 읽는다.
- **`ai_usage_log` 테이블 / `AiUsageLogService`**: AI 토큰·크레딧 사용량을 **DB에 영구 적재**하는 비즈니스 데이터. 관리자 화면(`AdminAiUsage`)·과금에 쓰인다.

즉 "AI 사용량 로깅"은 SLF4J가 아니라 **MyBatis로 테이블에 INSERT**하는 구조다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### `@Slf4j`가 만들어 주는 것

```java
@Slf4j               // ← Lombok이 아래 한 줄을 컴파일 시 자동 생성
@RestControllerAdvice
public class GlobalExceptionHandler {
    // private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    // 위 줄을 직접 안 써도 log 변수를 바로 쓸 수 있다
}
```

### 실제 사용 예 (GlobalExceptionHandler 발췌·축약)

```java
// 1) 예상된 비즈니스 예외 → warn (스택트레이스 불필요, 코드와 메시지만)
log.warn("BusinessException: {} - {}", code.name(), ex.getMessage());

// 2) 예상 못 한 예외 → error + 예외 객체를 마지막 인자로 (스택트레이스 출력)
log.error("Unexpected error", ex);
```

### 두 가지 핵심 관행

| 관행 | 설명 |
| --- | --- |
| **`{}` 파라미터 치환** | `log.warn("user {} failed", id)` 처럼 쓴다. `"... " + id` 문자열 연결보다 빠르고(레벨이 꺼져 있으면 치환 자체를 안 함), SQL/로그 인젝션에도 더 안전 |
| **예외는 마지막 인자로** | `log.error("msg", ex)` — 예외 객체를 `{}` 없이 마지막에 넘기면 SLF4J가 **전체 스택트레이스**를 찍는다. `ex.getMessage()`만 넘기면 원인 위치를 잃는다 |

### 동작 흐름 (한 줄의 로그가 출력되기까지)

1. 코드가 `log.warn(...)` 호출 → SLF4J **인터페이스** 메서드
2. 클래스패스에 있는 **Logback**(구현)이 받음
3. 설정된 **레벨**과 비교 → 통과하면 출력, 아니면 버림
4. **Appender**(콘솔/파일)로 포맷(시각·레벨·스레드·로거명·메시지) 적용해 기록

## 6. 면접 답변 3단계

- **초간단 1문장**: "SLF4J는 로깅 인터페이스, Logback은 구현이고, Lombok `@Slf4j`로 logger를 자동 주입해 레벨별로 로그를 남깁니다."
- **기본**: "코드는 SLF4J facade에만 의존해서 구현 교체가 자유롭고, `@Slf4j`로 보일러플레이트를 없앱니다. 레벨은 error/warn/info/debug로 나눠 운영 노이즈를 조절하고, `{}` 치환으로 성능·안전성을 챙깁니다. CareerTuner에선 `GlobalExceptionHandler`가 비즈니스 예외는 warn, 예상 못 한 예외는 error에 스택트레이스까지 남깁니다."
- **꼬리질문 대응**: "민감정보는 절대 평문으로 안 찍습니다. 예를 들어 `LoggingPushSender`는 푸시 토큰을 앞 12자만 남기고 마스킹합니다. 그리고 AI 토큰 사용량 같은 **비즈니스 데이터**는 텍스트 로그가 아니라 `ai_usage_log` 테이블에 적재해 과금·관리자 통계로 쓰는 식으로, '진단 로그'와 '데이터 로그'를 분리합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q. SLF4J와 Logback의 차이는?
SLF4J는 **인터페이스(facade)**, Logback은 그 인터페이스를 구현한 **실제 로깅 엔진**이다. 코드는 SLF4J에만 의존하므로, Log4j2 등으로 바꿔도 의존성만 교체하면 된다. Spring Boot는 기본으로 Logback을 쓴다.
:::

:::details Q. 왜 `log.info("user " + id)` 대신 `log.info("user {}", id)` 를 쓰나?
세 가지 이유. (1) **성능**: 해당 레벨이 꺼져 있으면 문자열 연결 자체를 건너뛴다. (2) **가독성**: 포맷과 값이 분리된다. (3) **안전**: 사용자 입력을 그대로 문자열에 붙이는 것보다 인젝션 위험이 낮다.
:::

:::details Q. 예외를 로깅할 때 주의할 점은?
예외 객체를 `log.error("msg", ex)` 처럼 **마지막 인자**로 넘겨 스택트레이스를 보존한다. `ex.getMessage()`만 찍으면 원인 줄을 잃는다. 또 **예측 가능한 비즈니스 예외**(잘못된 입력 등)는 `warn`/`info`로, **예측 못 한 예외**만 `error`로 — 그래야 진짜 장애가 묻히지 않는다. CareerTuner의 `GlobalExceptionHandler`가 정확히 이 방식이다(BusinessException은 warn, 나머지는 error).
:::

:::details Q. 로그에 절대 남기면 안 되는 것은?
비밀번호, API 키·JWT 토큰, 주민번호·카드번호 같은 개인정보·결제정보, 인증 헤더 전체. 남겨야 식별이 되는 토큰은 **앞 몇 자만 남기고 마스킹**한다(`LoggingPushSender`가 토큰 앞 12자만 출력). 공개 repo·로그 수집 시스템에 평문으로 흘러가면 곧바로 사고다.
:::

:::details Q. 운영에서 로그 레벨은 어떻게 조절하나?
코드를 고치지 않고 **설정으로** 바꾼다. CareerTuner는 `application.yaml`의 `logging.level.com.careertuner: DEBUG`처럼 **패키지 단위**로 레벨을 지정해, 자사 코드만 상세히 보고 라이브러리는 조용하게 둔다. 운영에선 보통 `info` 이상, 문제 분석 때만 특정 패키지를 `debug`로 내린다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. 동료가 "그냥 `System.out.println` 쓰면 되지 왜 SLF4J를 쓰냐"고 묻는다고 상상하고, 30초 안에 facade·레벨·민감정보 마스킹 세 가지로 반박해 보라.
2. CareerTuner의 `GlobalExceptionHandler`를 예로 들어, "예외 종류에 따라 로그 레벨을 어떻게 나눴고 왜 그렇게 했는지"를 한 호흡에 설명해 보라.

## 퀴즈

<QuizBox question="SLF4J가 로깅 라이브러리(Logback 등)와 구별되는 가장 핵심적인 특징은?" :choices="['로그를 파일로 저장하는 엔진이다', '실제 구현이 아니라 로깅 인터페이스(facade)다', 'JSON 포맷 전용 로거다', '예외를 자동으로 잡아준다']" :answer="1" explanation="SLF4J는 facade(인터페이스)이고 Logback이 실제 구현이다. 코드는 SLF4J에만 의존해 구현을 자유롭게 교체할 수 있다." />

<QuizBox question="예상하지 못한 서버 오류를 로깅할 때 가장 적절한 호출은?" :choices="['log.info(ex.getMessage())', 'log.warn(개발자 메모만)', 'log.error(메시지, ex)', 'System.out.println(ex)']" :answer="2" explanation="예외 객체를 마지막 인자로 넘기면(log.error(메시지, ex)) 전체 스택트레이스가 남아 원인 추적이 된다. CareerTuner GlobalExceptionHandler의 handleUnexpected가 이 방식이다." />

<QuizBox question="CareerTuner에서 사용자 푸시 토큰처럼 민감하지만 식별은 필요한 값을 로그에 남길 때 쓰는 방식을 한 문장으로 설명하라." explanation="값 전체를 평문으로 남기지 않고 앞 일부만 남기고 마스킹한다. 예를 들어 LoggingPushSender는 토큰의 앞 12자만 출력하고 나머지는 생략한다. 또한 비밀번호·API 키·JWT 같은 값은 아예 로그에 찍지 않으며, 토큰 사용량 같은 비즈니스 데이터는 텍스트 로그가 아니라 ai_usage_log 테이블에 적재해 분리 관리한다." />
