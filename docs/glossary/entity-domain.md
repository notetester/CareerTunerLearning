# Entity / Domain 모델

> "DB 한 행(row)을 자바 객체 한 개로 1:1 대응시킨 게 도메인(엔티티) 객체입니다. CareerTuner에선 `career_analysis_run` 테이블이 `CareerAnalysisRun` 클래스로, MyBatis resultMap이 컬럼을 필드로 매핑합니다."

## 1. 한 줄 정의

**도메인(엔티티) 모델은 DB 테이블의 행 구조를 그대로 닮은, 영속성 계층 전용 자바 객체**다. CareerTuner에서는 `backend/.../domain/` 패키지에 모여 있고, MyBatis가 SELECT 결과의 각 행을 이 객체로 채워서 돌려준다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| Entity | "실체". DB의 한 테이블/한 행처럼 **고유 식별자(id)로 구분되는 데이터 단위** |
| Domain (model) | "문제 영역". 비즈니스가 다루는 개념(지원 건, 적합도 분석…)을 코드로 표현한 객체 |
| POJO | Plain Old Java Object. 프레임워크 상속 없이 필드 + getter/setter만 가진 평범한 객체 |
| ORM/SQL Mapper | 행(row) ↔ 객체(object) 변환 담당. JPA는 ORM, **CareerTuner는 SQL Mapper인 MyBatis** |

:::tip 용어 정리
"Entity"는 JPA에서 `@Entity` 애너테이션이 붙은 클래스를 부르는 말이라 오해하기 쉽다. CareerTuner는 **JPA를 안 쓰므로** `@Entity`가 없다. 그래서 우리 프로젝트에서는 "엔티티"보다 **"도메인 객체"**라고 부르는 게 더 정확하다. 면접에서는 "JPA 엔티티는 아니고, MyBatis가 매핑하는 POJO 도메인 객체"라고 정확히 말하면 좋다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

도메인 객체가 없으면 DB에서 꺼낸 데이터를 `Map<String,Object>`나 `Object[]` 같은 **타입 없는 자루**로 들고 다녀야 한다. 그러면:

- 컬럼 오타가 컴파일 때 안 잡히고 **런타임에서 NPE**로 터진다.
- IDE 자동완성·리팩터링이 안 먹는다 (`run.getStatus()` 대신 `map.get("statsu")`).
- 같은 데이터를 여러 서비스가 제각각 해석해 **계약이 무너진다.**

도메인 객체는 "이 테이블 한 행은 이런 필드들로 이루어진다"는 **단일 진실(single source of truth)**을 타입으로 못 박는다. 서비스 계층은 SQL을 신경 쓰지 않고 객체만 다루면 된다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

도메인 객체는 도메인별 `domain/` 패키지에 모여 있다. 영역 C가 직접 소유한 것부터 보자.

| 도메인 클래스 | 대응 테이블 | 영역 | 비고 |
| --- | --- | --- | --- |
| `analysis/domain/CareerAnalysisRun` | `career_analysis_run` | **C** | 장기 취업경향 분석 실행 1건 |
| `applicationcase/domain/FitAnalysis` | `fit_analysis` | **C** | 적합도 분석 결과(점수·매칭/부족 스킬·전략) |
| `applicationcase/domain/ApplicationCase` | `application_case` | 공통 | 핵심 단위 "지원 건" |
| `applicationcase/domain/AiUsageLog` | `ai_usage_log` | 공통 | AI 호출·토큰·크레딧 기록 |
| `jobanalysis/domain/JobAnalysis` | `job_analysis` | B | 공고 분석 |
| `companyanalysis/domain/CompanyAnalysis` | `company_analysis` | - | 기업 분석 |
| `admin/analytics/domain/AdminCareerAnalysisRun` | `career_analysis_run`(+조인) | C(어드민) | 관리자 화면용 확장 뷰 |

집중 포인트인 **사용자용 `CareerAnalysisRun` vs 관리자용 `AdminCareerAnalysisRun`** 대비가 도메인 모델의 본질을 잘 보여준다. 같은 테이블을 보지만 **읽는 쓰임이 다르면 도메인 객체도 분리**한다.

```java
// analysis/domain/CareerAnalysisRun  — 사용자 본인의 실행 1건 (실행/재현용 내부 필드 포함)
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class CareerAnalysisRun {
    private Long id;
    private Long userId;
    private String analysisType;       // 분석 종류
    private String status;             // 진행 상태
    private String inputSnapshot;      // 입력 스냅샷(JSON)
    private String inputFingerprint;   // 입력 해시 = 캐시 키 (내부용)
    private String result;             // AI 결과(JSON)
    private int inputTokens;           // 토큰 회계 (내부용)
    private int outputTokens;
    private int tokenUsage;
}
```

```java
// admin/analytics/domain/AdminCareerAnalysisRun — 관리자 모니터링용 확장 뷰
public class AdminCareerAnalysisRun {
    private Long id;
    private Long userId;
    private String userName;       // ★ users 테이블 조인으로 끌어온 표시용
    private String userEmail;      // ★ 관리자가 누가 돌렸는지 봐야 하므로
    private int memoCount;         // ★ 관리자 메모 집계
    private LocalDateTime latestMemoAt;
    // inputFingerprint / inputTokens 같은 실행 내부 필드는 빠짐
}
```

:::warning 영역 경계
`AdminCareerAnalysisRun`은 같은 테이블을 보더라도 **관리자 영역(`admin/analytics`)** 소속이다. C가 사용자 기능을 완료하면 관련 관리자 화면·API도 같은 릴리스의 완료 기준에 포함하므로, 두 도메인을 한 세트로 관리한다.
:::

## 5. 핵심 동작 원리 (행 → 객체 매핑)

CareerTuner의 도메인 객체는 두 가지 관례로 굴러간다.

**(1) Lombok으로 보일러플레이트 제거** — 모든 필드 위에 `@Data`(getter/setter/equals), `@Builder`, `@NoArgsConstructor`, `@AllArgsConstructor`. 그래서 클래스 본문은 필드 선언만 있다.

**(2) MyBatis resultMap으로 컬럼→필드 매핑** — snake_case 컬럼을 camelCase 필드로 잇는다. 전역 `map-underscore-to-camel-case` 설정이 있어 대부분 자동이지만, `CareerAnalysisRunMapper.xml`은 명시적 `resultMap`으로 못 박아 둔다.

```xml
<!-- mapper/analysis/CareerAnalysisRunMapper.xml -->
<resultMap id="CareerAnalysisRunMap"
           type="com.careertuner.analysis.domain.CareerAnalysisRun">
    <id     property="id"             column="id"/>
    <result property="userId"         column="user_id"/>
    <result property="inputSnapshot"  column="input_snapshot"/>
    <result property="inputTokens"    column="input_tokens"/>
</resultMap>

<select id="findLatest" resultMap="CareerAnalysisRunMap">
    SELECT * FROM career_analysis_run
    WHERE user_id = #{userId} AND analysis_type = #{analysisType}
    ORDER BY created_at DESC, id DESC LIMIT 1
</select>
```

데이터 흐름 한눈에:

```text
DB 행(career_analysis_run)
   │  MyBatis @Mapper + resultMap
   ▼
도메인 객체 CareerAnalysisRun  ← 영속성 계층의 모양
   │  Service에서 가공 / 외부 노출 필드만 골라
   ▼
DTO CareerAnalysisRunResponse  ← API 응답의 모양
   │  ApiResponse<T> 엔벨로프에 담겨
   ▼
프론트(JSON)
```

### 도메인 vs DTO — 절대 헷갈리면 안 되는 핵심

| | 도메인(Domain) | DTO |
| --- | --- | --- |
| 모양의 기준 | **DB 테이블 행** | **API 요청/응답** |
| 위치 | `domain/` | `dto/` |
| 예 | `CareerAnalysisRun` | `CareerAnalysisRunResponse` |
| 자바 형태 | `class` + Lombok | 보통 `record` (불변) |
| 내부 필드 노출 | 함 (`inputFingerprint`, `inputTokens`) | **숨김** |

실제 `CareerAnalysisRunResponse`는 `record`이고, 정적 팩토리 `from(run)`이 도메인에서 **외부에 보여줄 필드만 골라** 옮긴다. `inputFingerprint`(캐시 키), `inputTokens/outputTokens`(토큰 회계) 같은 내부 구현 디테일은 DTO에 안 넣는다 — 클라이언트가 알 필요 없기 때문이다.

```java
public record CareerAnalysisRunResponse(
        Long id, String analysisType, String status,
        String inputSnapshot, String result, String model,
        String promptVersion, int tokenUsage,
        String errorMessage, boolean retryable, LocalDateTime createdAt) {
    public static CareerAnalysisRunResponse from(CareerAnalysisRun run) {
        return new CareerAnalysisRunResponse(
            run.getId(), run.getAnalysisType(), run.getStatus(),
            run.getInputSnapshot(), run.getResult(), run.getModel(),
            run.getPromptVersion(), run.getTokenUsage(),
            run.getErrorMessage(), run.isRetryable(), run.getCreatedAt());
    }
}
```

자세한 차이는 [DTO](/glossary/dto) 페이지에서 더 다룬다.

## 6. 면접 답변 3단계

- **초간단(1문장):** "DB 한 행을 1:1로 담는 자바 객체가 도메인 모델이고, CareerTuner는 MyBatis가 그 매핑을 해줍니다."
- **기본:** "영속성 계층 전용 객체라 `domain/` 패키지에 두고, 필드는 테이블 컬럼과 대응합니다. `career_analysis_run` 테이블 ↔ `CareerAnalysisRun` 클래스가 한 쌍이고, snake_case 컬럼을 resultMap으로 camelCase 필드에 매핑합니다. Lombok `@Data @Builder`로 보일러플레이트는 제거합니다."
- **꼬리질문 대응:** "API로 내보낼 땐 도메인을 그대로 노출하지 않고 DTO(record)로 변환합니다. 예를 들어 `CareerAnalysisRunResponse.from()`이 `inputFingerprint`나 토큰 카운트 같은 내부 필드는 빼고 응답에 필요한 값만 옮깁니다. 또 같은 테이블이라도 관리자 모니터링용은 `AdminCareerAnalysisRun`처럼 사용자 이름·메모 집계를 조인한 별도 도메인으로 분리합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

**Q. JPA Entity랑 뭐가 다른가요?**
A. JPA `@Entity`는 영속성 컨텍스트가 관리하고 더티 체킹·지연 로딩이 붙습니다. CareerTuner는 JPA 금지 규칙이라 그냥 POJO입니다. 매핑은 MyBatis resultMap이 SELECT 결과를 객체에 채워주는 방식이고, 변경 감지 같은 마법은 없어서 UPDATE는 직접 SQL로 명시합니다.

**Q. 왜 도메인을 그대로 API로 안 내보내고 DTO를 또 만드나요?**
A. 도메인은 테이블 모양에 묶여 있어서 내부 필드(`inputFingerprint`, 토큰 회계)까지 들고 있습니다. 그대로 노출하면 구현이 새고, 테이블이 바뀌면 API 계약도 깨집니다. DTO를 두면 응답 스키마를 독립적으로 통제할 수 있습니다.

**Q. snake_case 컬럼은 어떻게 camelCase 필드가 되나요?**
A. MyBatis 전역 설정 `map-underscore-to-camel-case`가 기본 자동 변환을 해주고, `CareerAnalysisRunMapper.xml`처럼 정확성을 위해 `resultMap`으로 컬럼-필드를 명시한 곳도 있습니다.

**Q. 같은 테이블에 도메인 클래스가 둘인 게 낭비 아닌가요?**
A. 쓰임이 다르면 분리하는 게 오히려 명확합니다. 사용자용 `CareerAnalysisRun`은 실행·재현 내부 필드를 갖고, 관리자용 `AdminCareerAnalysisRun`은 `users` 조인으로 가져온 이름·이메일과 메모 집계를 갖습니다. 한 클래스에 다 욱여넣으면 절반은 항상 null이라 더 헷갈립니다.

**Q. 도메인 객체에 비즈니스 로직을 넣나요?**
A. CareerTuner 도메인은 대부분 데이터 보관용(POJO)이고, 점수 확정·검증 같은 규칙은 서비스 계층(예: `FitAnalysisAiService`)에 둡니다. 이른바 빈약한 도메인 모델 쪽인데, MyBatis 기반 4계층 구조에서는 흔한 선택입니다.

## 8. 직접 말해보기

1. `career_analysis_run` 행 한 개가 프론트의 JSON 응답이 되기까지, 거쳐 가는 객체(도메인 → DTO → 엔벨로프)를 클래스 이름까지 넣어 30초 안에 말해보라.
2. "왜 `CareerAnalysisRun`과 `AdminCareerAnalysisRun`을 따로 만들었나"를 면접관에게 설명하듯 한 문단으로 말해보라. 어떤 필드가 어디에만 있는지 한 가지씩 예로 들 것.

## 퀴즈

<QuizBox question="CareerTuner의 도메인 객체에 대한 설명으로 옳은 것은?" :choices="['JPA @Entity 애너테이션이 붙은 영속성 관리 객체다', 'DB 테이블 행에 1:1로 대응하는 POJO이며 MyBatis resultMap이 매핑한다', 'API 요청/응답 모양을 정의하는 record다', '프론트엔드 Zustand 스토어의 상태 타입이다']" :answer="1" explanation="CareerTuner는 JPA 금지 규칙이라 @Entity가 아니라 Lombok 기반 POJO이고, MyBatis resultMap이 snake_case 컬럼을 camelCase 필드로 매핑한다. API 모양을 정의하는 건 dto 패키지의 DTO(record)다." />

<QuizBox question="도메인 CareerAnalysisRun에는 있지만 응답 DTO CareerAnalysisRunResponse에는 빠지는 대표적인 필드와 그 이유를 설명하라." explanation="inputFingerprint(입력 해시=캐시 키)와 inputTokens/outputTokens(토큰 회계) 같은 내부 구현 필드가 DTO에서 빠진다. 이런 값은 서버 내부 캐싱·과금 계산용이라 클라이언트가 알 필요가 없고, 노출하면 구현 디테일이 새고 테이블 변경이 API 계약을 깨뜨릴 수 있다. 그래서 from() 팩토리가 외부에 필요한 필드만 골라 옮긴다." />

<QuizBox question="같은 career_analysis_run 테이블을 보면서도 CareerAnalysisRun과 AdminCareerAnalysisRun을 따로 둔 이유로 가장 적절한 것은?" :choices="['MyBatis가 한 테이블에 클래스 하나만 허용해서', '쓰임이 달라서 — 관리자 뷰는 users 조인으로 얻은 userName/userEmail과 memoCount 집계가 필요하다', '관리자는 JPA를 쓰고 사용자는 MyBatis를 써서', 'DTO를 만들기 싫어서 도메인을 두 개로 나눴다']" :answer="1" explanation="읽는 목적이 다르면 도메인도 분리한다. 사용자용은 실행/재현 내부 필드를, 관리자용은 모니터링에 필요한 사용자 이름·이메일·메모 집계를 갖는다. 한 클래스에 다 넣으면 절반은 항상 null이 되어 더 혼란스럽다." />
