# MyBatis

> SQL을 내가 직접 XML에 쓰고, MyBatis가 그 SQL과 자바 메서드를 연결해 주는 SQL 매퍼 프레임워크다. JPA처럼 객체로 추상화하지 않고 SQL을 그대로 다룬다.

## 1. 한 줄 정의

MyBatis는 **자바 인터페이스 메서드 ↔ XML에 손으로 쓴 SQL**을 매핑해 주는 SQL 매퍼(SQL Mapper) 프레임워크다. SQL을 자동 생성하지 않고 개발자가 SQL의 주인이 된다.

## 2. 단어 뜻 (약자/어원 풀이)

- **MyBatis**: 원래 Apache의 **iBATIS**("internet" + "abatis") 프로젝트가 2010년 구글 코드로 옮겨오며 개명한 이름. 정식 약자는 아니지만 "My SQL + iBATIS" 느낌으로 기억하면 된다.
- **SQL Mapper**: ORM(Object-Relational Mapping)과 대비되는 용어. ORM은 객체↔테이블을 자동 매핑하지만, SQL Mapper는 **SQL 결과 ↔ 객체**만 매핑한다. SQL 자체는 사람이 쓴다.
- **Mapper**: 여기선 두 가지를 같이 부른다 — `@Mapper` 자바 인터페이스(시그니처)와 그 짝인 `*.xml`(실제 SQL).

:::tip 한 문장 정리
"JPA는 SQL을 숨기고, MyBatis는 SQL을 드러낸다." CareerTuner는 의도적으로 MyBatis만 쓰고 JPA를 금지한다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

순수 JDBC만 쓰면 매 쿼리마다 반복 보일러플레이트가 쏟아진다.

| JDBC 직접 | MyBatis |
| --- | --- |
| `Connection`/`PreparedStatement`/`ResultSet` 직접 열고 닫기 | 프레임워크가 자원 관리 |
| `rs.getString("col")`를 일일이 객체에 set | `resultType`/`resultMap`이 자동 매핑 |
| `?` 바인딩 인덱스 수동 관리 | `#{이름}` 으로 이름 바인딩 |
| 조건 분기 SQL을 문자열 `+`로 연결 (SQL Injection 위험) | `<if>` `<choose>` 동적 SQL 태그 |

반대로 JPA를 쓰면 SQL을 가려주지만, **복잡한 통계·조인·동적 정렬 쿼리**에서 JPQL/QueryDSL이 어려워지고 실행 SQL을 예측하기 힘들다. CareerTuner는 AI 사용량 집계, 적합도 다중 조인 등 **튜닝이 필요한 쿼리가 많아서** SQL을 직접 통제하는 MyBatis를 택했다.

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일/테이블)

영속성 계층은 **전 도메인이 MyBatis만** 사용한다(JPA 금지). 매퍼 XML은 70개 이상.

| 영역 | 인터페이스 / XML | 핵심 테이블 |
| --- | --- | --- |
| C (적합도) | `fitanalysis.mapper.FitAnalysisMapper` + `mapper/fitanalysis/FitAnalysisMapper.xml` | `fit_analysis`, `fit_analysis_learning_task` |
| C (취업경향) | `analysis.mapper.CareerAnalysisRunMapper` | `career_analysis_run` |
| 관리자(B 사용량) | `admin.aiusage.mapper.AdminAiUsageMapper` + 동명 XML | `ai_usage_log` JOIN `users`/`application_case` |
| 공통 | `user.mapper.UserMapper`, `billing.mapper.BillingMapper` 등 | `users`, `refresh_token` 등 |

설정은 `application.yaml`의 `mybatis:` 블록 한 군데로 끝난다:

```yaml
mybatis:
  type-aliases-package: com.careertuner       # 패키지 내 타입을 짧은 별칭으로
  mapper-locations: classpath*:mapper/**/*.xml # XML 위치
  configuration:
    map-underscore-to-camel-case: true        # fit_score -> fitScore 자동 변환
```

빌드 의존성은 `build.gradle`의 `mybatis-spring-boot-starter`(스프링 부트가 매퍼를 자동 스캔/등록).

:::details map-underscore-to-camel-case가 왜 중요한가
DB 컬럼 `application_case_id`, `fit_score`는 스네이크 케이스인데, 자바 필드는 `applicationCaseId`, `fitScore` 카멜 케이스다. 이 옵션이 켜져 있어서 `resultType`만 줘도 자동 매핑된다. `AdminAiUsageMapper.xml`은 `user_email`, `token_usage` 같은 컬럼을 별도 매핑 없이 DTO로 받는다.
:::

## 5. 핵심 동작 원리 (인터페이스 + XML 한 쌍)

### (1) 자바 쪽 — `@Mapper` 인터페이스

구현체를 내가 안 만든다. MyBatis가 런타임에 프록시를 만들어 XML SQL을 실행한다.

```java
@Mapper
public interface FitAnalysisMapper {
    // 파라미터가 1개면 그냥 받고, 2개 이상이면 @Param으로 이름 부여
    FitAnalysisResult findLatestByUserIdAndApplicationCaseId(
            @Param("userId") Long userId,
            @Param("applicationCaseId") Long applicationCaseId);

    // INSERT 후 생성된 PK를 객체에 다시 채워줌
    void insertFitAnalysis(FitAnalysisResult fitAnalysis);
}
```

### (2) XML 쪽 — `namespace`로 인터페이스에 묶고, `id`로 메서드에 묶는다

```xml
<mapper namespace="com.careertuner.fitanalysis.mapper.FitAnalysisMapper">
  <select id="findLatestByUserIdAndApplicationCaseId" resultMap="FitAnalysisResultMap">
    SELECT ... FROM fit_analysis fa
    INNER JOIN application_case ac ON ac.id = fa.application_case_id
    WHERE ac.user_id = #{userId}
      AND ac.id = #{applicationCaseId}
    ORDER BY fa.id DESC LIMIT 1
  </select>

  <insert id="insertFitAnalysis" useGeneratedKeys="true" keyProperty="id">
    INSERT INTO fit_analysis (application_case_id, fit_score, ...)
    VALUES (#{applicationCaseId}, #{fitScore}, ...)
  </insert>
</mapper>
```

핵심 연결 규칙: **`namespace`=인터페이스 FQCN, 태그 `id`=메서드명**. 둘이 정확히 일치해야 매핑된다.

### (3) `#{}` vs `${}` — 면접 단골

| 표기 | 의미 | 안전성 |
| --- | --- | --- |
| `#{userId}` | `PreparedStatement` 바인딩 파라미터(`?`) | 안전 (SQL Injection 방어) |
| `${col}` | 문자열 그대로 치환 | 위험 (값에 SQL이 섞이면 그대로 실행) |

원칙: **값은 무조건 `#{}`**. `${}`는 컬럼/테이블명처럼 바인딩 불가한 식별자를 동적으로 넣을 때만, 그것도 화이트리스트로 검증해 쓴다.

### (4) 동적 SQL — `<if>` / `<choose>` / `<sql>` 재사용

CareerTuner 관리자 사용량 화면은 필터 조합이 많아 동적 SQL이 필수다. `AdminAiUsageMapper.xml` 실제 예:

```xml
<sql id="BUsageLogWhere">
  WHERE aul.feature_type IN ('JOB_ANALYSIS', 'COMPANY_RESEARCH', ...)
  <if test="criteria.status != null">
    AND aul.status = #{criteria.status}
  </if>
  <if test="criteria.keyword != null">
    AND (u.email LIKE CONCAT('%', #{criteria.keyword}, '%')
         OR ac.company_name LIKE CONCAT('%', #{criteria.keyword}, '%'))
  </if>
</sql>
```

정렬은 `<choose>`/`<when>`/`<otherwise>`로 안전하게 분기한다(사용자 입력을 `${}`로 ORDER BY에 직접 꽂지 않는다):

```xml
<choose>
  <when test="criteria.sort == 'TOKEN_USAGE_DESC'">ORDER BY aul.token_usage DESC, aul.id DESC</when>
  <otherwise>ORDER BY aul.created_at DESC, aul.id DESC</otherwise>
</choose>
```

그리고 `<sql id="...">` + `<include refid="..."/>`로 SELECT 절·WHERE 절·ORDER BY 절을 **목록 조회와 통계 조회가 공유**해 중복을 없앤다. `AdminAiUsageMapper`의 `findBUsageLogs`(목록)와 `summarizeBUsageLogs`(집계)가 같은 `BUsageLogWhere`를 `include`한다.

:::warning XML에서 부등호 escape
XML이라 `<`, `>`를 그대로 못 쓴다. `created_at >= ...`는 `aul.created_at &gt;= #{...}`처럼 `&gt;`/`&lt;`로 써야 한다(실제 XML에 이렇게 들어가 있다). 또는 `<![CDATA[ ... ]]>`로 감싼다.
:::

### (5) `resultType` vs `resultMap`

- `resultType`: 컬럼명↔필드명이 (underscore-camel 규칙으로) 1:1이면 끝. `summarizeBUsageLogs`가 `resultType="...AdminAiUsageSummary"`로 바로 받는다.
- `resultMap`: 컬럼 별칭이 복잡하거나 PK(`<id>`)/연관 매핑이 필요하면 명시적으로 작성. `FitAnalysisResultMap`이 `application_status` → `applicationStatus`처럼 별칭까지 매핑한다.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "MyBatis는 SQL을 XML에 직접 쓰고 자바 인터페이스 메서드와 매핑하는 SQL 매퍼라서, 복잡한 쿼리를 내가 통제할 수 있습니다."
- **기본**: "JPA처럼 SQL을 추상화하지 않고 `@Mapper` 인터페이스 + XML 한 쌍으로 동작합니다. `namespace`로 인터페이스에, `id`로 메서드에 묶고, 값은 `#{}`로 바인딩해 SQL Injection을 막습니다. CareerTuner는 적합도·AI 사용량 집계처럼 동적 필터와 조인이 많아서 `<if>`·`<choose>`·`<include>`로 동적 SQL을 작성했고, `map-underscore-to-camel-case`로 컬럼 매핑을 자동화했습니다."
- **꼬리질문 대응**: "JPA를 안 쓴 건 팀 컨벤션이자 의도적 선택입니다. 실행 SQL을 정확히 예측·튜닝해야 하는 통계/조인 쿼리가 많고, N+1이나 영속성 컨텍스트 같은 ORM 특유의 함정을 피하고 싶었습니다. 대신 SQL을 손으로 쓰니 보일러플레이트와 컴파일 타임 타입 안정성은 포기하는 트레이드오프가 있습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. `#{}`와 `${}` 차이는?
`#{}`는 `PreparedStatement`의 `?` 파라미터로 바인딩돼 값이 안전하게 escape됩니다. `${}`는 문자열을 SQL에 그대로 치환해 SQL Injection 위험이 있습니다. 그래서 값은 전부 `#{}`로 쓰고, `${}`는 컬럼/테이블명 같은 식별자에만 화이트리스트 검증 후 제한적으로 씁니다. CareerTuner는 정렬도 사용자 입력을 `${}`에 꽂지 않고 `<choose>`로 분기합니다.
:::

:::details Q2. MyBatis와 JPA의 차이, 언제 뭘 쓰나?
JPA(ORM)는 객체↔테이블을 자동 매핑하고 SQL을 생성해 주므로 CRUD가 단순하고 DB 독립성이 높습니다. MyBatis(SQL Mapper)는 SQL을 직접 쓰므로 복잡한 조인·동적 쿼리·튜닝에 유리하지만 보일러플레이트가 늘고 컴파일 타임 검증이 약합니다. 통계/리포트성 쿼리가 많은 CareerTuner엔 MyBatis가 적합하다고 판단했습니다.
:::

:::details Q3. 인터페이스와 XML은 어떻게 연결되나?
구현 클래스는 없습니다. `@Mapper` 인터페이스를 스프링이 스캔하면 MyBatis가 런타임 프록시를 만들고, XML의 `namespace`(인터페이스 FQCN)와 태그 `id`(메서드명)를 보고 해당 SQL을 실행합니다. `mapper-locations`로 XML 위치를, `@Mapper`로 인터페이스를 등록합니다.
:::

:::details Q4. 파라미터가 여러 개일 때는?
파라미터가 1개면 그대로 `#{필드}`로 접근하지만, 2개 이상이면 `@Param("userId")`로 이름을 붙여야 XML에서 `#{userId}`로 쓸 수 있습니다. 객체를 넘기면 `#{fitScore}`처럼 프로퍼티 경로로 접근하고, `@Param("criteria")` 객체면 `#{criteria.status}`처럼 중첩 접근합니다. `AdminAiUsageMapper`가 `criteria` 객체로 필터를 받습니다.
:::

:::details Q5. INSERT 후 생성된 PK를 어떻게 받나?
`<insert useGeneratedKeys="true" keyProperty="id">`로 설정하면 AUTO_INCREMENT로 생성된 PK가 인자로 넘긴 객체의 `id` 필드에 다시 채워집니다. `insertFitAnalysis`가 이렇게 동작해, INSERT 직후 그 id로 자식 행(learning_task 등)을 연결합니다.
:::

## 8. 직접 말해보기

1. "우리 프로젝트는 왜 JPA를 안 쓰고 MyBatis만 쓰나요?"라는 질문에 트레이드오프까지 포함해 40초로 답해 보라.
2. `AdminAiUsageMapper.xml`을 떠올리며, 동적 필터·정렬·SQL 재사용을 각각 어떤 태그로 구현했는지 코드 없이 말로 설명해 보라.

## 퀴즈

<QuizBox question="MyBatis에서 사용자 입력 값을 SQL에 넣을 때 올바른 표기는?" :choices="['#{value} 를 쓴다', '${value} 를 쓴다', '문자열 + 로 직접 연결한다', 'PreparedStatement를 직접 만든다']" :answer="0" explanation="#{}는 PreparedStatement 파라미터로 바인딩돼 SQL Injection을 방어한다. ${}는 문자열 치환이라 값에는 쓰면 안 되고, 검증된 식별자(컬럼/테이블명)에만 제한적으로 쓴다." />

<QuizBox question="application.yaml의 map-underscore-to-camel-case: true 설정이 하는 일은?" :choices="['XML 파일 위치를 지정한다', 'DB 컬럼 fit_score 를 자바 필드 fitScore 로 자동 매핑한다', 'JPA를 활성화한다', 'SQL 로그를 출력한다']" :answer="1" explanation="스네이크 케이스 컬럼명을 카멜 케이스 자바 필드에 자동 매핑해 준다. 덕분에 resultType 만으로도 별도 매핑 없이 DTO/도메인에 값이 채워진다." />

<QuizBox question="CareerTuner가 JPA 대신 MyBatis만 쓰기로 한 이유와 그 트레이드오프를 면접에서 말하듯 한 문단으로 설명해 보라." explanation="AI 사용량 집계·적합도 다중 조인처럼 실행 SQL을 정확히 예측하고 튜닝해야 하는 쿼리가 많아, SQL을 직접 통제할 수 있는 MyBatis를 팀 컨벤션으로 채택했다. if·choose·include 로 동적 필터/정렬/SQL 재사용을 표현력 있게 작성할 수 있다는 장점이 있다. 대신 SQL을 손으로 쓰는 만큼 보일러플레이트가 늘고, ORM 같은 컴파일 타임 타입 안정성과 DB 독립성은 일부 포기하는 트레이드오프가 있다." />
