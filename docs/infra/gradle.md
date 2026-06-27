# Gradle 빌드 (백엔드)

> CareerTuner 백엔드는 Gradle로 의존성을 선언적으로 관리하고, `gradlew` 래퍼로 빌드 환경을 고정하며, `bootJar`로 실행 가능한 단일 JAR를 만들어 멀티스테이지 Dockerfile에 넣어 배포한다.

## 1. 한 줄 정의

Gradle은 **JVM 프로젝트의 빌드 자동화 도구**다. 의존성 다운로드 → 컴파일 → 테스트 → 패키징(JAR/WAR)까지의 과정을 `build.gradle`이라는 스크립트 하나로 정의하고 명령 한 줄로 재현한다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| **Gradle** | 약자가 아니라 고유명사. Groovy/Kotlin DSL 기반 빌드 도구 |
| **build.gradle** | 빌드 스크립트. 플러그인·의존성·태스크를 선언 |
| **wrapper (gradlew)** | 프로젝트에 동봉된 실행 스크립트. 지정된 Gradle 버전을 자동 내려받아 실행 |
| **task** | Gradle의 작업 단위 (`compileJava`, `test`, `bootJar` 등) |
| **plugin** | 태스크 묶음을 주입하는 확장 (`java`, `org.springframework.boot`) |
| **bootJar** | Spring Boot 플러그인이 만드는 실행 가능한 fat JAR |
| **daemon** | 백그라운드에 상주하며 JVM 워밍업을 재사용해 빌드를 빠르게 하는 프로세스 |

:::tip Maven과의 차이
같은 일을 하는 도구로 Maven(`pom.xml`, XML)이 있다. Gradle은 XML 대신 코드(DSL)로 빌드를 정의해 유연하고, 증분 빌드·빌드 캐시·daemon으로 더 빠르다. CareerTuner 백엔드는 Gradle을 쓴다.
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **의존성 지옥 해결**: Spring Boot, MyBatis, JWT(jjwt), PDFBox, LangChain4j 등 수십 개 라이브러리를 손으로 받고 버전을 맞추는 건 불가능하다. Gradle이 `mavenCentral()`에서 전이 의존성까지 자동 해결한다.
- **"내 컴퓨터에선 됐는데" 방지**: `gradlew` 래퍼가 **Gradle 버전 자체를 고정**(`gradle-9.5.1`)하고, `java toolchain`이 **JDK 21**을 고정한다. 팀원 6명과 CI가 모두 동일 환경에서 빌드한다.
- **재현 가능한 산출물**: `./gradlew bootJar` 한 줄이면 누구의 머신에서든, CI에서든, Docker 빌드 안에서든 똑같은 실행 JAR가 나온다.
- **테스트 자동화 연결**: `./gradlew test`가 CI 파이프라인에 그대로 꽂힌다.

없으면 → 라이브러리 버전 충돌, 빌드 환경 제각각, 배포 산출물 비재현으로 협업이 무너진다.

## 4. CareerTuner에서 어디에 썼나 (실제 파일/구조, 영역 표시)

영역: **인프라 (Owner: 팀장)** — `build.gradle`은 공통 영역이라 변경 시 팀 합의 필요.

| 파일 | 역할 |
| --- | --- |
| `backend/build.gradle` | 플러그인·의존성·JDK 21 toolchain·`test` 태스크 정의 |
| `backend/settings.gradle` | `rootProject.name = 'CareerTuner'` (단일 모듈) |
| `backend/gradlew`, `gradlew.bat` | 래퍼 실행 스크립트 (Unix/Windows) |
| `backend/gradle/wrapper/gradle-wrapper.properties` | 고정 Gradle 버전 `gradle-9.5.1-bin.zip` |
| `backend/gradle/wrapper/gradle-wrapper.jar` | 래퍼 부트스트랩 바이너리 |
| `backend/Dockerfile` | 멀티스테이지: build 단계에서 `./gradlew bootJar -x test` 실행 |
| `.github/workflows/service-pipeline-ci.yml` | CI에서 `./gradlew test` 실행 (backend-test job) |

핵심 플러그인 3종(실제 `build.gradle`):

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '4.0.6'
    id 'io.spring.dependency-management' version '1.1.7'
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}
```

- `io.spring.dependency-management`가 Spring 의존성들의 **버전을 BOM으로 관리**하기 때문에, 많은 `spring-boot-starter-*`는 버전 숫자를 안 적어도 된다.

## 5. 핵심 동작 원리 (표/코드/단계)

### (1) 의존성 선언 — scope(configuration)가 핵심

같은 라이브러리라도 "언제 필요한가"에 따라 선언 키워드가 다르다. CareerTuner `build.gradle`의 실제 예:

| configuration | 의미 | CareerTuner 예시 |
| --- | --- | --- |
| `implementation` | 컴파일+런타임 모두 필요 | `spring-boot-starter-webmvc`, `jjwt-api`, `pdfbox`, LangChain4j 스타터 |
| `runtimeOnly` | 실행할 때만 필요(컴파일 시 불필요) | `mysql-connector-j`, `jjwt-impl`, `jjwt-jackson` |
| `compileOnly` | 컴파일에만 필요(JAR에 미포함) | `lombok` |
| `annotationProcessor` | 컴파일 시 코드 생성 | `lombok`, `spring-boot-configuration-processor` |
| `developmentOnly` | 개발 중에만 | `spring-boot-devtools` |
| `testImplementation` | 테스트 코드에만 | `spring-boot-starter-*-test`, `mybatis-spring-boot-starter-test` |

:::details 왜 jjwt가 api/impl/jackson 셋으로 쪼개져 있나
jjwt는 **컴파일 시 보는 인터페이스(`jjwt-api`)**와 **실행 시 동작하는 구현체(`jjwt-impl`, `jjwt-jackson`)**를 분리한 설계다. 그래서 `api`는 `implementation`, 구현체 둘은 `runtimeOnly`로 선언한다. 내 코드는 API에만 의존하고 구현은 런타임에 끼워진다.
:::

:::warning 버전 명시가 필요한 경우 — LangChain4j
대부분의 Spring 스타터는 BOM이 버전을 관리해 숫자가 없지만, LangChain4j는 별도 버전 체계라 직접 명시한다. 또한 이 프로젝트는 **Spring Boot 4**라 반드시 `-spring-boot4-starter`(Boot 3용 `-spring-boot-starter` 아님)를 써야 한다. 실제 선언: `dev.langchain4j:langchain4j-spring-boot4-starter:1.16.3-beta26`.
:::

### (2) 래퍼(gradlew)의 동작

```text
./gradlew <task>
   └─ gradle-wrapper.properties 읽음
        └─ distributionUrl = gradle-9.5.1-bin.zip
             └─ 해당 버전 없으면 자동 다운로드 → 캐시
                  └─ 그 버전의 gradle로 task 실행
```

→ **시스템에 Gradle을 따로 설치할 필요가 없다.** 저장소를 clone한 사람·CI·Docker가 모두 `9.5.1`로 통일된다.

### (3) 자주 쓰는 명령

| 명령 | 하는 일 |
| --- | --- |
| `./gradlew bootRun` | 앱 실행 (개발용, :8080) |
| `./gradlew test` | JUnit 5 테스트 실행 (CI가 사용) |
| `./gradlew bootJar` | 실행 가능 fat JAR 생성 → `build/libs/*-SNAPSHOT.jar` |
| `./gradlew bootJar -x test` | 테스트 건너뛰고(`-x`) JAR만 (Docker 빌드가 사용) |
| `./gradlew build` | 컴파일+테스트+패키징 전체 |
| `--no-daemon` | daemon 미사용 (CI/Docker처럼 일회성 환경에서 권장) |

Windows는 `.\gradlew.bat bootRun` 형태로 호출한다.

### (4) bootJar → Dockerfile 멀티스테이지

`backend/Dockerfile`은 **빌드 환경(JDK)과 실행 환경(JRE)을 분리**한다.

```dockerfile
# ① build 단계: JDK 21, 의존성 캐시 위해 빌드 스크립트 먼저 복사
FROM eclipse-temurin:21-jdk AS build
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
COPY src ./src
RUN ./gradlew bootJar -x test --no-daemon

# ② runtime 단계: 가벼운 JRE만, 산출물 JAR만 복사
FROM eclipse-temurin:21-jre
COPY --from=build /app/build/libs/*-SNAPSHOT.jar /app/app.jar
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

핵심 이점 3가지:
1. **레이어 캐시**: `build.gradle`을 `src`보다 먼저 복사 → 소스만 바뀌면 의존성 다운로드 레이어를 재사용.
2. **이미지 경량화**: 최종 이미지엔 JDK·Gradle·소스가 없고 JRE + JAR만 남는다.
3. **테스트 분리**: 이미지 빌드는 `-x test`로 산출물만, 테스트는 CI(`./gradlew test`)에서 담당.

## 6. 면접 답변 3단계

- **초간단(1문장)**: "Gradle로 백엔드 의존성과 빌드를 관리하고, `gradlew` 래퍼로 버전을 고정해 `bootJar`로 만든 실행 JAR를 멀티스테이지 Docker 이미지로 배포했습니다."
- **기본**: "`build.gradle`에서 Spring Boot·MyBatis·JWT·PDFBox·LangChain4j 같은 의존성을 `implementation`/`runtimeOnly` 등 scope로 선언하고, JDK 21 toolchain을 고정했습니다. 래퍼가 Gradle 9.5.1을 자동으로 맞춰주기 때문에 팀원과 CI 환경이 동일하고, Docker 빌드 단계에서 `./gradlew bootJar -x test`로 fat JAR를 뽑아 JRE 이미지에 넣었습니다."
- **꼬리질문 대응**: "테스트는 이미지 빌드에서 분리해 CI의 `./gradlew test` job에서 돌립니다. LangChain4j처럼 BOM이 버전을 관리하지 않는 의존성은 버전을 직접 명시하고, Spring Boot 4 환경이라 `-spring-boot4-starter`를 써야 하는 점도 주의했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. implementation과 runtimeOnly의 차이는?
`implementation`은 컴파일·런타임 모두 필요한 의존성, `runtimeOnly`는 실행할 때만 필요하고 컴파일 시엔 안 보이는 의존성입니다. CareerTuner에선 JDBC 드라이버(`mysql-connector-j`)와 jjwt 구현체(`jjwt-impl`, `jjwt-jackson`)를 `runtimeOnly`로 뒀습니다. 내 코드는 jjwt의 API에만 의존하고 구현은 런타임에 끼워지기 때문입니다.
:::

:::details Q2. gradlew 래퍼를 왜 쓰나? 그냥 gradle 설치하면 안 되나?
래퍼는 `gradle-wrapper.properties`에 적힌 버전(여기선 9.5.1)을 자동으로 내려받아 실행합니다. 덕분에 팀원이 Gradle을 설치하지 않아도 되고, 모두가 동일한 버전으로 빌드해 "내 컴퓨터에선 되는데" 문제를 막습니다. CI와 Docker도 같은 래퍼를 쓰므로 환경이 완전히 통일됩니다.
:::

:::details Q3. bootJar와 일반 jar의 차이는?
일반 jar는 내 클래스만 들어있어 실행하려면 클래스패스에 의존성을 따로 줘야 합니다. `bootJar`는 모든 의존성을 포함한 fat(실행 가능) JAR라 `java -jar app.jar`만으로 뜹니다. Spring Boot 플러그인이 만들며, Dockerfile은 `*-SNAPSHOT.jar`만 복사하고 `-plain.jar`(일반 jar)는 매칭에서 제외합니다.
:::

:::details Q4. -x test는 무슨 의미이고 왜 쓰나?
`-x`는 특정 태스크를 제외하는 플래그라 `bootJar -x test`는 테스트를 건너뛰고 JAR만 만듭니다. Docker 이미지 빌드 시간을 줄이려고 쓰고, 테스트 책임은 CI의 `./gradlew test` job으로 분리했습니다. 즉 테스트를 안 하는 게 아니라 빌드 단계에서 분리한 것입니다.
:::

:::details Q5. dependency-management 플러그인은 왜 있나?
`io.spring.dependency-management`가 Spring BOM을 적용해 `spring-boot-starter-*` 의존성들의 버전을 일괄 관리해줍니다. 그래서 대부분의 스타터에 버전 숫자를 안 적어도 호환되는 버전이 자동으로 들어갑니다. 반대로 BOM이 관리하지 않는 LangChain4j 같은 건 버전을 직접 적어야 합니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. `build.gradle`을 보지 않고, CareerTuner 백엔드가 의존성 scope(`implementation`/`runtimeOnly`/`compileOnly`/`annotationProcessor`)를 어떻게 나눠 썼는지 실제 라이브러리 예를 들어 1분간 설명해보라.
2. "왜 Dockerfile을 멀티스테이지로 했고, 그 안에서 Gradle을 어떤 명령으로 호출했나?"를 면접관에게 답하듯 말해보라. (키워드: JDK→JRE 분리, 레이어 캐시, `bootJar -x test`, 테스트는 CI)

관련 페이지: [Dockerfile/배포](/infra/docker-compose) · [CI/CD 파이프라인](/infra/github-actions) · [JWT 보안](/backend/jwt-security)

## 퀴즈

<QuizBox question="CareerTuner 백엔드에서 MySQL JDBC 드라이버(mysql-connector-j)를 선언한 Gradle configuration은?" :choices="['implementation', 'runtimeOnly', 'compileOnly', 'testImplementation']" :answer="1" explanation="드라이버는 컴파일 시점엔 직접 참조하지 않고 실행할 때만 필요하므로 runtimeOnly로 선언한다. jjwt-impl, jjwt-jackson도 같은 이유로 runtimeOnly다." />

<QuizBox question="Docker 멀티스테이지 빌드의 build 단계에서 실행하는 명령은 무엇이며, 왜 그 형태인가?" explanation="./gradlew bootJar -x test --no-daemon 이다. bootJar는 모든 의존성을 포함한 실행 가능 fat JAR를 만들고, -x test로 테스트를 제외해 이미지 빌드 시간을 줄이며(테스트는 CI의 ./gradlew test job이 담당), --no-daemon으로 일회성 컨테이너 환경에서 daemon을 띄우지 않는다. 빌드 스크립트를 src보다 먼저 COPY해 의존성 레이어를 캐시하는 것도 핵심이다." />

<QuizBox question="gradlew 래퍼(gradle-wrapper.properties)가 프로젝트에 주는 가장 큰 이점은?" :choices="['빌드 속도를 daemon으로 높여준다', '팀원과 CI가 동일한 Gradle 버전으로 빌드하게 고정한다', 'JAR 크기를 줄여준다', '의존성 버전을 자동으로 최신화한다']" :answer="1" explanation="래퍼는 distributionUrl에 적힌 버전(gradle-9.5.1)을 자동으로 받아 실행하므로, 누가 어디서 빌드하든 동일 버전이 보장된다. 환경 차이로 인한 빌드 불일치를 막는 것이 핵심 이점이다." />
