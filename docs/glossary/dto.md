# DTO

> DTO는 계층과 계층, 특히 클라이언트와 서버 사이에서 데이터를 실어 나르기 위한 전용 객체로, DB Entity를 그대로 노출하지 않고 요청(Request)과 응답(Response)을 명확히 분리하는 장치다.

## 1. 한 줄 정의

DTO(Data Transfer Object)는 **로직 없이 데이터만 담아 계층 사이를 오가는 운반용 객체**다. CareerTuner에서는 컨트롤러가 받는 요청 바디와 내보내는 응답 바디를 각각 별도 클래스(주로 `record`)로 정의한 것을 말한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 단어 | 뜻 |
| --- | --- |
| Data | 데이터 |
| Transfer | 전달, 운반 |
| Object | 객체 |

즉 "데이터를 운반하는 객체". 비즈니스 로직(계산, 검증 규칙 실행 등)을 넣지 않고, 필드와 그 묶음만 가진다는 게 핵심 뉘앙스다. 비슷한 개념과는 이렇게 구분한다.

- **Entity / Domain**: DB 테이블이나 도메인 상태에 대응하는 객체 (예: `FitAnalysisResult`, `AdminFitAnalysisResult`)
- **DTO**: 계층 경계를 넘기 위한 전송 전용 객체 (예: `FitAnalysisDetailResponse`)
- **VO(Value Object)**: 값 자체로 동등성을 따지는 불변 객체. DTO와 헷갈리기 쉽지만 목적이 다르다(전송 vs 값 표현)

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

Entity를 그대로 컨트롤러 응답으로 내보내면 다음 문제가 생긴다.

1. **민감 정보 노출**: `users` Entity를 그대로 반환하면 비밀번호 해시, 권한 플래그 같은 필드가 같이 새어 나간다.
2. **과다/과소 응답**: 화면은 점수와 매칭 기술 몇 개만 필요한데 Entity의 모든 컬럼이 따라 나간다. 반대로 여러 테이블을 조합한 화면용 데이터는 Entity 하나로는 표현이 안 된다.
3. **계층 결합**: API 응답 모양이 DB 스키마에 묶인다. 컬럼명 하나 바꾸면 프런트 계약이 깨진다.
4. **입력 검증 위치 모호**: 어떤 필드가 필수인지, 길이 제한이 얼만지를 Entity에 섞으면 책임이 흐려진다.

DTO로 분리하면 **"DB가 어떻게 생겼는지"와 "API가 무엇을 주고받는지"를 따로 진화**시킬 수 있다.

:::tip Request와 Response를 왜 또 나누나
같은 도메인이라도 받는 것과 주는 것은 모양이 다르다. 메모를 만들 때는 `memoType`, `content`만 받으면 되지만(`AdminFitAnalysisMemoRequest`), 응답에는 서버가 채운 id, 작성 시각, 작성자까지 실어야 한다. 그래서 Request/Response를 별도 record로 둔다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블, 영역 표시)

DTO는 `backend/src/main/java/com/careertuner/<도메인>/dto/` 패키지에 모은다. 전 영역에서 쓰지만, 아래는 **영역 C(적합도·취업경향·대시보드 분석)** 와 공용에서 실제 쓰는 예다.

| DTO 클래스 | 종류 | 영역 | 역할 |
| --- | --- | --- | --- |
| `AdminCareerRunMemoRequest` | Request | C(관리자) | 취업경향 분석 실행에 운영 메모 추가 (`memoType`, `content`) |
| `AdminFitAnalysisMemoRequest` | Request | C(관리자) | 적합도 분석 결과에 운영 메모 추가 |
| `AdminFitAnalysisListItemResponse` | Response | C(관리자) | `fit_analysis` + 사용자·공고 조인 결과를 목록 행으로 |
| `AdminCareerAnalysisRunResponse` | Response | C(관리자) | `career_analysis_run` 1건을 관리자 화면용으로 |
| `FitAnalysisDetailResponse` | Response | C(사용자) | 적합도 분석 상세(점수·매칭/부족 기술·전략) |
| `UpdateLearningTaskRequest` | Request | C(사용자) | 추천 학습 항목 완료 토글 (`boolean completed`) |
| `LoginRequest` / `TokenResponse` | Request/Response | A/공용 | 로그인 입력과 토큰 발급 응답 |

흐름은 항상 **컨트롤러가 DTO로 받고 → 서비스에서 도메인/Entity로 변환 → 응답 DTO로 다시 변환 → `ApiResponse` 엔벨로프에 담아 반환**이다. `AdminFitAnalysisController`를 보면 그대로 드러난다.

```java
@PostMapping("/{id}/memos")
public ApiResponse<AdminFitAnalysisMemoResponse> createMemo(
        @AuthenticationPrincipal AuthUser authUser,
        @PathVariable Long id,
        @Valid @RequestBody AdminFitAnalysisMemoRequest request) {   // 입력 DTO + 검증
    requireAdmin(authUser);
    return ApiResponse.ok(                                           // 엔벨로프
        adminFitAnalysisService.createMemo(id, authUser.id(), request)); // 응답 DTO
}
```

:::warning DTO와 AI 커맨드/결과 record는 구분
`FitAnalysisAiCommand`, `FitAnalysisAiResult`는 `dto` 패키지가 아니라 `fitanalysis/ai`에 있는 **AI 호출 계층 내부 입출력 모델**이다. 모양은 record로 비슷하지만 역할은 "AI 서비스 경계용"이지 "HTTP 요청/응답용"이 아니다. 면접에서 둘을 같은 DTO로 뭉뚱그리지 말자.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

CareerTuner의 DTO는 거의 다 Java `record`로 작성한다. record는 불변 필드 + 생성자 + 접근자 + `equals/hashCode/toString`을 컴파일러가 자동 생성하므로, 전송 전용 객체에 딱 맞는다.

```java
// AdminCareerRunMemoRequest.java — 입력 DTO + 검증을 한 곳에
public record AdminCareerRunMemoRequest(
        @NotBlank(message = "메모 유형은 필수입니다.")
        @Size(max = 30, message = "메모 유형은 30자 이하여야 합니다.")
        String memoType,

        @NotBlank(message = "메모 내용은 필수입니다.")
        @Size(max = 5000, message = "메모 내용은 5000자 이하여야 합니다.")
        String content
) {}
```

```java
// AdminCareerAnalysisRunResponse.java — 정적 팩토리로 도메인 -> 응답 DTO 변환
public static AdminCareerAnalysisRunResponse from(AdminCareerAnalysisRun run) {
    return new AdminCareerAnalysisRunResponse(
        run.getId(), run.getUserId(), run.getUserName(), /* ... */ );
}
```

동작 단계:

1. **수신**: 컨트롤러가 `@RequestBody`로 JSON을 Request DTO로 역직렬화한다(Jackson).
2. **검증**: `@Valid`가 붙어 있으면 record 필드의 `@NotBlank`, `@Size` 등을 검사한다. 실패 시 `MethodArgumentNotValidException` → `GlobalExceptionHandler`가 `INVALID_INPUT` 에러로 변환.
3. **변환**: 서비스가 DTO를 도메인/Entity로 바꿔 MyBatis 매퍼에 넘기거나, 매퍼가 돌려준 도메인을 응답 DTO로 매핑한다(보통 `of()` / `from()` 정적 팩토리).
4. **반환**: 응답 DTO를 `ApiResponse.ok(...)`로 감싸 JSON 직렬화해 내보낸다.

검증 어노테이션은 [DTO 검증](/backend/validation), 에러 변환은 [예외 처리](/backend/exception-handling), 감싸는 엔벨로프는 [ApiResponse](/glossary/api-response-envelope)와 함께 보면 그림이 완성된다.

## 6. 면접 답변 3단계 (초간단 1문장 / 기본 / 꼬리질문 대응)

- **초간단(1문장)**: "DTO는 계층 사이에서 데이터만 실어 나르는 객체로, Entity를 직접 노출하지 않고 요청·응답을 분리하려고 씁니다."
- **기본**: "저희는 컨트롤러에서 받는 Request DTO와 내보내는 Response DTO를 각각 record로 정의합니다. 예를 들어 관리자 메모 추가는 `AdminFitAnalysisMemoRequest`로 받아 `@Valid`로 검증하고, 응답은 서버가 채운 id·시각까지 포함한 별도 Response DTO로 돌려줍니다. DB Entity를 그대로 노출하지 않아 민감 필드 노출과 스키마 결합을 막습니다."
- **꼬리질문 대응**: "변환은 서비스 계층에서 하고, 도메인→DTO는 보통 `of()`나 `from()` 정적 팩토리로 합니다. record를 쓰는 이유는 불변이라 전송 중 값이 바뀔 위험이 없고 보일러플레이트가 없기 때문입니다. 응답은 항상 `ApiResponse` 엔벨로프로 감쌉니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. DTO와 Entity의 차이는?
Entity는 DB 테이블/도메인 상태에 대응하는 객체이고, DTO는 계층 경계를 넘기 위한 전송 전용 객체다. Entity에는 영속성·도메인 규칙이 묶여 있고, DTO는 로직 없이 데이터 모양만 갖는다. CareerTuner는 `FitAnalysisResult`(도메인)를 `FitAnalysisDetailResponse`(DTO)로 변환해 응답한다.
:::

:::details Q2. 왜 Request와 Response DTO를 따로 두나?
받는 데이터와 주는 데이터의 모양이 다르기 때문이다. 메모 생성 요청은 `memoType`, `content`만 필요하지만, 응답은 서버가 생성한 id·작성 시각·작성자까지 포함한다. 한 클래스로 합치면 어떤 필드가 입력이고 출력인지 모호해지고, 입력에 없어야 할 필드가 노출될 수 있다.
:::

:::details Q3. DTO를 왜 record로 만들었나? class와 뭐가 다른가?
record는 불변이라 전송 도중 값이 바뀔 위험이 없고, 생성자·접근자·equals/hashCode/toString을 자동 생성해 보일러플레이트가 사라진다. 전송 전용 객체는 가변 상태가 필요 없으므로 record가 적합하다. 다만 JPA Entity 같은 가변·프록시가 필요한 곳에는 쓰지 않는다(우리는 MyBatis라 도메인은 일반 class).
:::

:::details Q4. 검증은 DTO에서 하나, 서비스에서 하나?
1차 형식 검증(필수값, 길이, 이메일 형식 등)은 DTO 필드의 Jakarta Validation 어노테이션 + 컨트롤러의 `@Valid`로 한다. 실패하면 `GlobalExceptionHandler`가 `INVALID_INPUT`으로 통일해 응답한다. 반면 "크레딧이 충분한가", "점수 범위가 규칙에 맞는가" 같은 비즈니스 규칙은 서비스 계층에서 `BusinessException`으로 처리한다. 적합도 점수·판정도 AI 출력을 그대로 믿지 않고 서버 규칙으로 확정한다.
:::

:::details Q5. DTO 변환 코드(매핑)는 보통 어디에 두나?
응답 DTO 안에 `of(...)` / `from(...)` 정적 팩토리를 두거나 서비스에서 변환한다. CareerTuner는 `AdminFitAnalysisListItemResponse.of(...)`, `AdminCareerAnalysisRunResponse.from(...)`처럼 DTO에 정적 팩토리를 둬서, 도메인→DTO 매핑 책임을 한곳에 모은다. MapStruct 같은 매핑 라이브러리는 도입하지 않고 명시적으로 변환한다.
:::

## 8. 직접 말해보기 (말하기 훈련용 질문)

1. "DTO가 없으면 어떤 구체적 문제가 생기는지" 민감정보 노출과 스키마 결합 두 가지를 들어 30초 안에 설명해보라.
2. CareerTuner의 메모 추가 기능을 예로, 요청이 들어와서 응답이 나갈 때까지 DTO가 어디서 어떻게 변환되는지(`@Valid` 검증 → 서비스 변환 → `ApiResponse`) 한 호흡에 말해보라.

## 퀴즈

<QuizBox question="CareerTuner에서 컨트롤러 요청·응답 DTO를 주로 어떤 형태로 정의하는가?" :choices="['JPA Entity를 그대로 재사용', 'Java record', 'Map 기반 가변 객체', 'XML 바인딩 클래스']" :answer="1" explanation="요청·응답 DTO는 불변 + 보일러플레이트 제거 이점 때문에 대부분 Java record로 정의한다. 예: AdminCareerRunMemoRequest, FitAnalysisDetailResponse." />

<QuizBox question="Request DTO와 Response DTO를 분리하는 핵심 이유로 가장 적절한 것은?" :choices="['컴파일 속도를 높이려고', '받는 데이터와 주는 데이터의 모양·책임이 다르기 때문', 'record는 분리해야만 쓸 수 있어서', 'MyBatis가 분리를 강제해서']" :answer="1" explanation="입력은 최소 필드만 받고, 응답은 서버가 채운 id·시각 등을 포함한다. 모양과 책임이 다르므로 분리한다." />

<QuizBox question="DTO의 1차 형식 검증(@NotBlank, @Size)이 실패하면 CareerTuner에서 어떻게 처리되는가? 모범답안을 한 문단으로 설명하라." explanation="컨트롤러에서 @Valid가 붙은 Request DTO의 필드 검증이 실패하면 Spring이 MethodArgumentNotValidException을 던지고, @RestControllerAdvice인 GlobalExceptionHandler가 이를 잡아 ErrorCode.INVALID_INPUT으로 변환한 뒤 ApiResponse.error 엔벨로프로 일관된 형태의 에러 응답을 내려준다. 즉 형식 검증은 DTO 어노테이션에 선언적으로 두고, 실패 처리는 전역 핸들러가 통일한다. 비즈니스 규칙 검증은 별도로 서비스 계층에서 BusinessException으로 처리한다." />
