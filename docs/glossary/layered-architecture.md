# 4계층 구조 (Controller / Service / Mapper / Domain)

> 요청이 들어오면 Controller가 받고 → Service가 비즈니스 로직과 트랜잭션을 처리하고 → Mapper가 DB와 대화하고 → Domain이 데이터를 담아 오가는, 관심사를 4개 층으로 분리한 백엔드 표준 구조입니다.

## 1. 한 줄 정의

**계층형 아키텍처(Layered Architecture)** 는 백엔드 코드를 책임에 따라 `controller → service → mapper → domain` 4개 층으로 나누고, 각 층이 바로 아래 층만 의존하게 만든 구조입니다. CareerTuner 백엔드의 모든 도메인 패키지가 이 규칙을 따릅니다.

## 2. 단어 뜻 (역할별 풀이)

| 층 | 영어 의미 | 한 마디 책임 | CareerTuner 표식 |
| --- | --- | --- | --- |
| Controller | 제어/입출구 | HTTP 요청 수신·검증·응답 변환 | `@RestController` |
| Service | 서비스/일처리 | 비즈니스 로직 + 트랜잭션 경계 | `@Service` |
| Mapper | 매핑(SQL↔객체) | DB 접근(MyBatis) | `@Mapper` |
| Domain | 영역/데이터 모델 | DB 행을 담는 순수 객체 | 일반 POJO |

- **DTO**(Data Transfer Object)는 별도 층은 아니지만, Controller가 외부와 주고받는 요청/응답 전용 객체로 `dto` 패키지에 둡니다. Domain(내부 모델)과 DTO(외부 계약)를 분리하는 게 핵심입니다. → [DTO](/glossary/dto)
- "계층"이라 부르는 이유는 각 층이 **위에서 아래로만** 호출하기 때문입니다. Mapper가 Controller를 부르거나, Domain이 Service를 아는 일은 없습니다.

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

층을 안 나누고 Controller 한 곳에 HTTP 파싱·비즈니스 규칙·SQL을 다 쓰면 다음 문제가 생깁니다.

- **테스트 불가**: SQL과 로직이 엉켜 있어 비즈니스 규칙만 단위 테스트할 수 없습니다. CareerTuner는 `OpenAiFitAnalysisAiServiceTest`처럼 Service/AI 로직을 따로 테스트합니다.
- **변경 파급**: DB 컬럼 하나 바뀌면 컨트롤러까지 줄줄이 수정해야 합니다.
- **재사용 불가**: 같은 비즈니스 로직을 다른 컨트롤러(예: 사용자용·관리자용)에서 못 씁니다.
- **트랜잭션 경계 모호**: "어디서부터 어디까지 한 묶음으로 커밋/롤백하나"가 흩어집니다.

:::tip 면접 한 줄
"관심사 분리(Separation of Concerns)로 테스트·유지보수·재사용을 쉽게 하려고 4계층으로 나눴습니다."
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일)

전 도메인이 같은 패턴이라, 제가 담당한 **[영역 C] 적합도 분석** 패키지로 4계층을 끝까지 추적할 수 있습니다.

```text
com.careertuner.fitanalysis
├─ controller/  FitAnalysisController        (@RestController, /api/fit-analyses)
├─ service/     FitAnalysisService           (인터페이스)
│               FitAnalysisServiceImpl       (@Service, @Transactional)
├─ mapper/      FitAnalysisMapper            (@Mapper)
├─ domain/      FitAnalysisResult            (DB 행 모델)
│               FitAnalysisLearningTask
│               FitAnalysisGenerationSource
└─ dto/         FitAnalysisDetailResponse    (외부 응답)
                UpdateLearningTaskRequest    (외부 요청)
```

| 층 | 실제 파일 | 핵심 한 줄 |
| --- | --- | --- |
| Controller | `FitAnalysisController.java` | `@RequestMapping("/api/fit-analyses")`, 결과를 `ApiResponse.ok(...)`로 감쌈 |
| Service | `FitAnalysisServiceImpl.java` | `@Transactional`로 적합도 생성 전체를 한 묶음 처리 |
| Mapper | `FitAnalysisMapper.java` + `resources/mapper/fitanalysis/FitAnalysisMapper.xml` | `findGenerationSource`, `insertFitAnalysis` 등 SQL |
| Domain | `FitAnalysisResult.java` | `fit_analysis` 테이블 한 행을 담는 모델 |

:::details 인터페이스/구현 분리 (FitAnalysisService vs FitAnalysisServiceImpl)
Service는 인터페이스(`FitAnalysisService`)와 구현(`FitAnalysisServiceImpl`)을 나눠 둡니다. Controller는 인터페이스 타입에 의존하므로, 구현을 갈아끼우거나 목(mock)으로 테스트하기 쉽습니다. AI 호출 부분(`FitAnalysisAiService`)도 같은 이유로 인터페이스 + `OpenAiFitAnalysisAiService` / `MockFitAnalysisAiService` / `FallbackFitAnalysisAiService` 구현으로 분리돼 있습니다.
:::

관리자 화면도 같은 4계층입니다: `admin/fitanalysis/{controller,service,mapper,domain,dto}`. 사용자 기능과 관리자 기능이 동일 구조를 공유하는 게 팀 규칙입니다.

## 5. 핵심 동작 원리 (요청 1건의 여정)

`POST /api/fit-analyses/application-cases/{id}` (적합도 분석 생성) 한 건이 흐르는 과정입니다.

```text
HTTP 요청
  │
  ▼  ① Controller (FitAnalysisController.generate)
     - @AuthenticationPrincipal로 로그인 사용자 식별
     - service 호출, 반환값을 ApiResponse.ok(...)로 포장
  │
  ▼  ② Service (FitAnalysisServiceImpl.generate, @Transactional)
     - mapper.findGenerationSource()로 입력(공고분석+프로필) 조회
     - 없으면 BusinessException(NOT_FOUND) 던짐
     - AI 호출 → 점수/판정은 서버 규칙으로 검증·확정
     - mapper.insertFitAnalysis(), insertLearningTask(), insertAiUsageLog()
  │
  ▼  ③ Mapper (FitAnalysisMapper)
     - @Mapper 인터페이스 메서드 ↔ XML의 SQL 매핑
     - map-underscore-to-camel-case로 fit_score → fitScore 자동 변환
  │
  ▼  ④ Domain (FitAnalysisResult)
     - DB 행이 객체로 채워져 위로 돌아옴
  │
  ▼  Service가 Domain → DTO(FitAnalysisDetailResponse) 변환
  ▼  Controller가 ApiResponse 엔벨로프로 JSON 응답
```

핵심 규칙 4가지:

- **위에서 아래로만 호출**: Controller→Service→Mapper. 역방향 없음.
- **@Transactional은 Service에**: 여러 INSERT(분석 본문 + 학습과제 + 사용량 로그)가 하나로 커밋/롤백됩니다. 조회 전용은 `@Transactional(readOnly = true)`.
- **예외는 BusinessException + ErrorCode**: Service에서 던지면 `GlobalExceptionHandler`가 잡아 `ApiResponse.error(...)`로 변환. → [전역 예외 처리](/backend/exception-handling)
- **층 간 데이터 변환**: Domain(내부)은 절대 그대로 노출하지 않고 DTO로 바꿔 응답합니다.

```java
// Controller: 받고, 위임하고, 엔벨로프로 포장만 한다 (로직 없음)
@PostMapping("/application-cases/{applicationCaseId}")
public ApiResponse<FitAnalysisDetailResponse> generate(
        @AuthenticationPrincipal AuthUser authUser,
        @PathVariable Long applicationCaseId) {
    return ApiResponse.ok(
        fitAnalysisService.generate(authUser.id(), applicationCaseId));
}
```

```java
// Service: 트랜잭션 경계 + 비즈니스 규칙 (얇은 Controller, 두꺼운 Service)
@Override
@Transactional
public FitAnalysisDetailResponse generate(Long userId, Long applicationCaseId) {
    FitAnalysisGenerationSource source =
        fitAnalysisMapper.findGenerationSource(userId, applicationCaseId);
    if (source == null) {
        throw new BusinessException(ErrorCode.NOT_FOUND, "지원 건을 찾을 수 없습니다.");
    }
    // ... AI 호출, 점수 검증, insert 들 ...
}
```

## 6. 면접 답변 3단계

- **초간단(1문장)**: "요청 수신은 Controller, 비즈니스 로직과 트랜잭션은 Service, DB 접근은 Mapper, 데이터 모델은 Domain으로 책임을 나눈 4계층 구조입니다."
- **기본**: "관심사 분리가 목적입니다. Controller는 HTTP 입출력만 담당하고 로직이 없으며, Service에 `@Transactional`을 붙여 여러 DB 작업을 한 트랜잭션으로 묶습니다. 영속성은 JPA 대신 MyBatis `@Mapper`로 처리하고, 내부 Domain은 외부에 DTO로 변환해 노출합니다. 제 적합도 분석 도메인은 `FitAnalysisController → FitAnalysisServiceImpl → FitAnalysisMapper → FitAnalysisResult` 흐름으로 구현했습니다."
- **꼬리질문 대응**: "Service만 트랜잭션을 가져 경계가 명확하고, 인터페이스+구현 분리로 AI 클라이언트를 OpenAI·Mock·Fallback으로 갈아끼우며 테스트할 수 있습니다. 예외는 Service에서 `BusinessException`을 던지고 `GlobalExceptionHandler`가 일괄 변환해, 응답 형식이 `ApiResponse` 엔벨로프로 항상 일관됩니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 왜 비즈니스 로직을 Controller가 아니라 Service에 두나요?
Controller는 HTTP에 묶인 얇은 입출구여야 합니다. 로직을 Controller에 두면 (1) HTTP 없이 단위 테스트가 어렵고 (2) 다른 진입점(관리자 API, 배치, 다른 컨트롤러)에서 재사용할 수 없으며 (3) 트랜잭션 경계가 모호해집니다. 그래서 "얇은 Controller, 두꺼운 Service" 원칙을 따릅니다.
:::

:::details Q2. @Transactional은 어느 층에 붙이나요? 왜 거기인가요?
Service 메서드에 붙입니다. 한 비즈니스 작업이 여러 DB 쓰기(적합도 본문 + 학습과제 + ai_usage_log)로 이뤄지는데, 이걸 전부 한 단위로 커밋/롤백해야 데이터 정합성이 지켜집니다. 비즈니스 작업의 시작·끝이 곧 Service 메서드의 시작·끝이라 트랜잭션 경계로 자연스럽습니다. 조회 전용 메서드는 `@Transactional(readOnly = true)`로 최적화합니다.
:::

:::details Q3. Domain과 DTO를 굳이 나누는 이유는?
Domain은 DB 테이블 구조를 반영한 내부 모델이고, DTO는 외부와의 계약입니다. 둘을 합치면 DB 컬럼이 그대로 API로 새어 나가 내부 구조가 외부에 노출되고, 컬럼 변경이 곧 API 깨짐으로 이어집니다. 분리하면 `FitAnalysisResult`(내부)와 `FitAnalysisDetailResponse`(외부)가 독립적으로 진화할 수 있고, 응답에 불필요한 필드를 숨길 수 있습니다.
:::

:::details Q4. JPA를 안 쓰고 MyBatis를 쓰는데, 이게 4계층과 무슨 관계인가요?
영속성 기술이 무엇이든 "DB 접근을 Mapper 층으로 격리한다"는 원칙은 같습니다. CareerTuner는 복잡한 조인·동적 SQL 제어를 위해 MyBatis만 씁니다. `@Mapper` 인터페이스가 SQL을 정의한 XML과 매핑되고, `map-underscore-to-camel-case` 설정으로 `fit_score` 컬럼이 `fitScore` 필드로 자동 매핑됩니다. Service는 SQL을 몰라도 되고 Mapper 메서드만 호출하면 됩니다.
:::

:::details Q5. 층을 건너뛰면 안 되나요? (Controller에서 바로 Mapper 호출)
원칙적으로 금지입니다. 단순 조회라 로직이 없어 보여도, 권한 검증·트랜잭션·DTO 변환은 Service의 책임입니다. 층을 건너뛰면 그 책임이 갈 곳을 잃고 결국 코드가 일관성을 잃습니다. CareerTuner는 조회조차 `Service`를 거쳐 `@Transactional(readOnly = true)`와 DTO 변환을 일관되게 적용합니다.
:::

## 8. 직접 말해보기

1. 적합도 분석 생성 요청(`POST /api/fit-analyses/...`) 하나가 들어와서 JSON으로 응답이 나갈 때까지, 4개 층을 거치는 과정을 클래스 이름을 넣어 1분 안에 설명해 보세요.
2. "왜 `@Transactional`을 Controller가 아니라 Service에 붙였냐"는 꼬리질문에, CareerTuner의 적합도 생성에서 여러 INSERT가 묶이는 예를 들어 답해 보세요.

## 퀴즈

<QuizBox question="CareerTuner 4계층에서 @Transactional이 주로 붙는 층은?" :choices="['Controller', 'Service', 'Mapper', 'Domain']" :answer="1" explanation="비즈니스 작업의 시작과 끝이 곧 Service 메서드라, 여러 DB 쓰기를 한 단위로 커밋/롤백하기 위해 Service에 트랜잭션 경계를 둡니다." />

<QuizBox question="다음 중 계층형 구조의 의존 방향으로 옳은 것은?" :choices="['Mapper -> Service -> Controller', 'Controller -> Service -> Mapper -> Domain', 'Domain -> Mapper -> Service', 'Service -> Controller -> Mapper']" :answer="1" explanation="요청은 위(Controller)에서 아래(Mapper/Domain)로만 호출이 흐릅니다. 역방향 의존은 없습니다." />

<QuizBox question="Controller에 비즈니스 로직을 직접 넣지 않고 Service로 위임하는 이유를 2가지 이상 설명해 보세요." explanation="첫째, 관심사 분리로 Controller를 HTTP 입출력만 담당하는 얇은 층으로 유지해 테스트와 가독성을 높입니다. 둘째, 비즈니스 로직을 Service에 두면 관리자 API 등 다른 진입점에서 재사용할 수 있습니다. 셋째, 트랜잭션 경계(@Transactional)를 Service 메서드 단위로 명확히 그을 수 있고, 예외(BusinessException)도 한 곳에서 일관되게 던질 수 있습니다." />
