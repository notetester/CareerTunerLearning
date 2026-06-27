# ORM과 MyBatis (JPA와의 차이)

> "ORM은 객체와 DB 테이블을 자동으로 이어주는 기술이고, MyBatis는 그중에서도 SQL을 내가 직접 쓰는 'SQL 매퍼' 방식입니다. CareerTuner는 JPA를 의도적으로 안 쓰고 MyBatis만 씁니다 — 복잡한 조인·집계 쿼리가 많아 SQL을 직접 통제하는 게 유리하기 때문입니다."

## 1. 한 줄 정의

- **ORM**: 객체(Java 클래스)와 관계형 DB의 테이블·행을 자동으로 매핑해, SQL을 직접 안 짜도 객체로 DB를 다루게 해주는 기술 패러다임.
- **MyBatis**: SQL은 개발자가 직접 작성하되, **SQL 결과 ↔ 자바 객체 변환**과 **파라미터 바인딩**만 자동화해주는 **SQL 매퍼(반자동 ORM)** 프레임워크.

CareerTuner는 ORM 진영의 두 갈래 중 **MyBatis(SQL 직접 작성)** 만 쓰고, **JPA/Hibernate(SQL 자동 생성)** 는 의도적으로 배제했다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| ORM | **O**bject-**R**elational **M**apping. 객체-관계 매핑. "관계형 DB"와 "객체 지향 언어"의 표현 차이(임피던스 불일치)를 메우는 계층 |
| JPA | **J**ava **P**ersistence **A**PI. 자바 표준 ORM 명세(인터페이스). 구현체가 Hibernate |
| Hibernate | JPA의 대표 구현체. 엔티티 어노테이션만 보고 SQL을 자동 생성 |
| MyBatis | iBATIS에서 이름이 바뀐 SQL 매퍼. "My" + "BATIS" |
| 매퍼(Mapper) | SQL과 자바 메서드를 연결하는 인터페이스/XML |

:::tip 한 줄 비유
JPA/Hibernate는 "자동변속(SQL 자동 생성)", MyBatis는 "수동변속(SQL 직접 작성, 결과 매핑만 자동)". 둘 다 넓게는 ORM 계열이지만, MyBatis는 SQL을 숨기지 않는다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

ORM 계층이 전혀 없으면 순수 JDBC로 작업해야 한다. 그러면 매 쿼리마다 반복되는 고통이 생긴다.

- `ResultSet`에서 컬럼을 하나씩 꺼내 `setXxx()`로 객체에 옮기는 **보일러플레이트** 코드 폭증
- `PreparedStatement`에 `?` 인덱스로 파라미터를 일일이 바인딩 → 순서 실수로 버그
- `Connection`/`Statement`/`ResultSet`을 직접 닫아야 함 → 자원 누수 위험
- 문자열 연결로 SQL을 만들다 보면 **SQL Injection** 위험

MyBatis는 이 중 **결과 매핑·파라미터 바인딩·자원 관리**를 자동화하면서도, **SQL 자체는 개발자가 통제**하게 남겨둔다. 그래서 "복잡한 쿼리를 정확히 짜야 하는 프로젝트"에 잘 맞는다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

> 영역 표시: 아래 적합도(fit) 도메인이 **본인 담당 영역 C**. 영속성 규약(MyBatis만)·`application.yaml` 설정은 **공통 영역(팀장 Owner)**.

**전역 규약 (`backend/build.gradle`, `application.yaml`)**

- `build.gradle`에 `mybatis-spring-boot-starter:4.0.1`만 추가, JPA 스타터는 의도적으로 제외 (주석: *"Persistence: MyBatis only (JPA intentionally excluded)"*)
- `application.yaml`의 `mybatis` 블록:

```yaml
mybatis:
  type-aliases-package: com.careertuner
  mapper-locations: classpath*:mapper/**/*.xml
  configuration:
    map-underscore-to-camel-case: true   # fit_score -> fitScore 자동 매핑
    default-fetch-size: 100
    default-statement-timeout: 30
```

**구조 패턴 (전 도메인 공통)**: `@Mapper` 자바 인터페이스 + 같은 namespace의 `resources/mapper/**/*.xml`. 인터페이스 메서드 이름 = XML statement `id`.

**영역 C 실제 매퍼**

| 매퍼 | XML | 주요 테이블 | 역할 |
| --- | --- | --- | --- |
| `FitAnalysisMapper` | `mapper/fitanalysis/FitAnalysisMapper.xml` | `fit_analysis`, `fit_analysis_history`, `fit_analysis_learning_task`, `fit_analysis_condition_match` | 적합도 분석 저장·조회·재분석 이력 |
| `CareerAnalysisRunMapper` | `mapper/analysis/CareerAnalysisRunMapper.xml` | `career_analysis_run` | 장기 취업경향 분석 실행·캐시 조회 |
| (공통 로그) | 위 매퍼들의 `insertAiUsageLog` | `ai_usage_log` | AI 사용량 공통 기록(공통 스키마라 기존 컬럼만 사용) |

`FitAnalysisMapper`는 단순 CRUD를 넘는 쿼리가 많다 — `findGenerationSource`는 `application_case + 최신 job_analysis + user_profile`을 **읽기 전용 조인**하면서 `user_id`로 소유권까지 한 쿼리에서 검증한다. 이게 "MyBatis로 복잡 쿼리를 직접 통제"하는 실제 사례다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 호출 흐름 (4계층 중 mapper 단계)

```text
Service (@Transactional)
  → FitAnalysisMapper.findLatestByUserId(userId)   // 자바 인터페이스 호출
    → MyBatis가 같은 namespace XML에서 id="findLatestByUserId" SQL 찾음
      → #{userId}를 PreparedStatement에 바인딩
        → SELECT 실행 → ResultSet
          → resultMap 규칙으로 컬럼 → FitAnalysisResult 객체 변환
```

### 인터페이스 ↔ XML 1:1 매핑

```java
// FitAnalysisMapper.java (영역 C)
@Mapper
public interface FitAnalysisMapper {
    List<FitAnalysisResult> findLatestByUserId(Long userId);
    void insertFitAnalysis(FitAnalysisResult fitAnalysis);   // useGeneratedKeys로 id 채워줌
}
```

```xml
<!-- FitAnalysisMapper.xml -->
<mapper namespace="com.careertuner.fitanalysis.mapper.FitAnalysisMapper">
  <select id="findLatestByUserId" resultMap="FitAnalysisResultMap">
    SELECT <include refid="FitAnalysisWithApplicationColumns"/>
    FROM fit_analysis fa
    INNER JOIN application_case ac ON ac.id = fa.application_case_id
    WHERE ac.user_id = #{userId}
  </select>
</mapper>
```

### MyBatis 핵심 기능 4가지 (CareerTuner 실물 기준)

| 기능 | 무엇 | CareerTuner 실제 위치 |
| --- | --- | --- |
| `resultMap` | 컬럼명 → 객체 프로퍼티 명시 매핑 | `FitAnalysisResultMap` (`apply_decision → applyDecision`, 별칭 `ac.status AS application_status`) |
| `<sql>` + `<include>` | 컬럼 목록 재사용(중복 제거) | `FitAnalysisWithApplicationColumns`를 3개 select가 공유 |
| `useGeneratedKeys` | INSERT 후 자동 생성 PK를 객체에 채움 | `insertFitAnalysis`, `insertLearningTask` (`keyProperty="id"`) |
| `#{}` 바인딩 | PreparedStatement 파라미터(SQL Injection 방지) | 모든 `#{userId}`, `#{fitScore}` 등 |

:::warning `#{}` vs `${}`
`#{}`는 PreparedStatement 파라미터로 바인딩(안전). `${}`는 문자열을 그대로 SQL에 치환(인젝션 위험). 정렬 컬럼처럼 불가피한 경우 외에는 항상 `#{}`를 쓴다. CareerTuner의 적합도 매퍼는 전부 `#{}` 사용.
:::

### `map-underscore-to-camel-case`

DB는 스네이크(`fit_score`), 자바는 카멜(`fitScore`)이 관례다. 이 옵션을 켜면 둘을 **자동 매핑**해서 `resultMap`에 일일이 안 적어도 된다. 다만 `fit_analysis` 매퍼는 별칭/조인이 많아 가독성·명시성을 위해 `resultMap`을 함께 쓴다.

## 6. 면접 답변 3단계

1. **초간단 (1문장)**: "ORM은 객체와 테이블을 매핑하는 기술이고, MyBatis는 SQL을 직접 쓰는 SQL 매퍼라 JPA보다 복잡 쿼리 통제가 쉽습니다."
2. **기본**: "JPA/Hibernate는 엔티티만 보고 SQL을 자동 생성하지만, MyBatis는 SQL을 XML/어노테이션에 직접 작성하고 결과 매핑·파라미터 바인딩만 자동화합니다. CareerTuner는 적합도 분석처럼 여러 테이블을 조인하고 소유권까지 한 쿼리로 검증하는 복잡 쿼리가 많아 MyBatis만 채택했습니다."
3. **꼬리질문 대응**: "`@Mapper` 인터페이스와 동일 namespace XML을 1:1로 두고, `resultMap`으로 명시 매핑하거나 `map-underscore-to-camel-case`로 스네이크-카멜을 자동 변환합니다. INSERT는 `useGeneratedKeys`로 PK를 객체에 되돌려받고, 트랜잭션은 서비스 계층의 `@Transactional`로 묶습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. JPA가 생산성이 더 높다는데 왜 MyBatis를 골랐나요?
단순 CRUD만 보면 JPA가 빠릅니다. 하지만 CareerTuner는 `findGenerationSource`처럼 `application_case + 최신 job_analysis + user_profile`을 조인하고 서브쿼리로 최신 행을 고르는 등 SQL을 정밀하게 제어해야 하는 쿼리가 많습니다. 이런 경우 JPQL/QueryDSL보다 SQL을 그대로 쓰는 MyBatis가 의도를 명확히 표현하고 튜닝하기 쉽습니다. 팀 차원에서 영속성 규약을 'MyBatis only'로 통일해 일관성도 확보했습니다.
:::

:::details Q2. 그럼 MyBatis의 단점은 무엇인가요?
SQL을 직접 쓰니 보일러플레이트(반복 컬럼 나열)가 늘고, DB 종속성이 높으며, JPA의 더티 체킹·지연 로딩·1차 캐시 같은 자동 최적화가 없습니다. CareerTuner는 `<sql>`+`<include>`로 컬럼 재사용(`FitAnalysisWithApplicationColumns`)을 해 반복을 줄였습니다.
:::

:::details Q3. `#{}`와 `${}`의 차이는?
`#{}`는 PreparedStatement의 `?` 파라미터로 치환돼 값이 바인딩되므로 SQL Injection이 막힙니다. `${}`는 문자열을 SQL에 그대로 끼워넣어 위험합니다. 동적 테이블/컬럼명처럼 바인딩이 불가능한 경우에만 검증 후 `${}`를 쓰고, 값은 항상 `#{}`를 씁니다.
:::

:::details Q4. INSERT 후 생성된 PK는 어떻게 받나요?
`<insert>`에 `useGeneratedKeys="true" keyProperty="id"`를 주면 DB의 AUTO_INCREMENT 값이 파라미터 객체의 `id`에 자동 세팅됩니다. CareerTuner의 `insertFitAnalysis` 후 그 `id`를 `insertConditionMatch`·`insertLearningTask`의 외래키로 바로 씁니다.
:::

:::details Q5. 트랜잭션과 N+1은 어떻게 다루나요?
트랜잭션은 MyBatis가 아니라 Spring의 `@Transactional`로 서비스 계층에서 관리합니다(적합도 생성은 분석 1건 + 조건 매칭 N건 + 학습과제 N건 INSERT를 한 트랜잭션으로). MyBatis는 JPA의 자동 지연 로딩이 없어 N+1이 '숨어서' 터지지 않고, 필요하면 조인 쿼리를 직접 작성하거나 `<collection>` 매핑으로 한 번에 가져옵니다.
:::

## 8. 직접 말해보기

1. 면접관이 "MyBatis 쓰셨네요, JPA랑 뭐가 다른가요?"라고 물었다고 가정하고, **JPA=SQL 자동 생성 / MyBatis=SQL 직접 작성+매핑 자동**이라는 축으로 30초 안에 답해보자. 마지막에 CareerTuner의 `FitAnalysisMapper` 조인 쿼리를 근거로 덧붙이면 만점.
2. `#{}`와 `${}`의 차이를 SQL Injection 관점에서 한 문장으로 설명하고, 본인이 `${}`를 써야 했던/쓰지 않은 이유를 말해보자.

## 퀴즈

<QuizBox question="MyBatis를 가장 정확히 설명한 것은?" :choices="['엔티티 어노테이션을 보고 SQL을 자동 생성하는 완전 자동 ORM', 'SQL은 개발자가 직접 작성하고 결과 매핑과 파라미터 바인딩만 자동화하는 SQL 매퍼', 'DB 없이 메모리에서만 동작하는 캐시 라이브러리', '자바 객체를 JSON으로 바꿔주는 직렬화 도구']" :answer="1" explanation="MyBatis는 반자동 ORM(SQL 매퍼)으로, SQL은 직접 작성하되 결과-객체 매핑과 파라미터 바인딩, 자원 관리를 자동화한다. SQL 자동 생성은 JPA/Hibernate의 특징이다." />

<QuizBox question="CareerTuner의 application.yaml에서 fit_score 컬럼을 자바의 fitScore 필드로 자동 매핑되게 하는 설정은?" :choices="['type-aliases-package', 'map-underscore-to-camel-case: true', 'default-fetch-size', 'useGeneratedKeys']" :answer="1" explanation="map-underscore-to-camel-case: true 옵션이 스네이크 케이스 컬럼명을 카멜 케이스 프로퍼티로 자동 변환한다. useGeneratedKeys는 INSERT 후 생성 PK를 객체에 채우는 별개 기능이다." />

<QuizBox question="CareerTuner가 JPA 대신 MyBatis만 채택한 핵심 이유를, 적합도 분석 도메인의 실제 쿼리를 근거로 설명해보세요." explanation="적합도 분석에는 단순 CRUD를 넘는 복잡 쿼리가 많다. 예를 들어 FitAnalysisMapper.findGenerationSource는 application_case에 최신 job_analysis와 user_profile을 조인하고, 서브쿼리로 최신 행을 고르며, user_id로 소유권까지 한 쿼리에서 검증한다. 이런 정밀한 SQL 제어는 JPQL/QueryDSL보다 SQL을 직접 쓰는 MyBatis가 의도를 명확히 표현하고 튜닝하기 쉽다. 또 팀 영속성 규약을 MyBatis only로 통일해 일관성을 확보했고, build.gradle에서 JPA 스타터를 의도적으로 제외했다." />
