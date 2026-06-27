# 컨테이너 배포 (Docker · Compose)

> "코드를 OS·라이브러리·실행환경까지 통째로 한 이미지로 굳혀서, 어느 서버에서든 똑같이 띄웁니다. CareerTuner는 멀티스테이지 Dockerfile로 JAR을 빌드하고, docker-compose로 백엔드·Qdrant·공고추출 워커를 한 번에 올립니다."

## 1. 한 줄 정의

- **Docker**: 애플리케이션과 그 실행환경(OS 패키지, JRE, 의존성)을 하나의 **이미지**로 묶고, 그 이미지를 격리된 프로세스인 **컨테이너**로 실행하는 기술.
- **Docker Compose**: 여러 컨테이너(서비스)와 네트워크·볼륨을 `docker-compose.yml` 한 파일에 선언하고 `docker compose up` 한 줄로 전체 스택을 띄우는 오케스트레이션 도구.

CareerTuner에서는 `docker-compose.yml` 하나가 **backend + qdrant + job-posting-worker** 세 컨테이너를 묶어 배포 단위로 만든다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 뜻 |
| --- | --- |
| 이미지(Image) | 실행에 필요한 모든 것을 굳혀 놓은 읽기 전용 템플릿. 빌드 결과물. |
| 컨테이너(Container) | 이미지를 실제로 실행한 격리된 프로세스. 같은 이미지로 여러 개 띄울 수 있다. |
| Dockerfile | 이미지를 어떻게 만들지 적은 빌드 레시피(FROM/COPY/RUN/ENTRYPOINT…). |
| 레이어(Layer) | Dockerfile 명령 한 줄마다 생기는 캐시 가능한 변경분. 안 바뀐 레이어는 재사용. |
| Compose | "구성하다" — 여러 서비스를 한 파일로 **구성**한다는 의미. |
| 멀티스테이지(Multi-stage) | 빌드용 이미지와 실행용 이미지를 분리해 최종 이미지를 가볍게 만드는 기법. |
| 볼륨(Volume) | 컨테이너가 죽어도 데이터를 보존하는 Docker 관리 저장소. |
| Healthcheck | 컨테이너가 "살아있을 뿐 아니라 정상 서빙 중"인지 주기적으로 확인하는 명령. |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

- **"내 PC에선 되는데" 문제 제거**: JDK 버전, Python 버전, 시스템 라이브러리 차이로 인한 환경 불일치를 이미지가 통째로 고정한다.
- **여러 프로세스의 수동 기동 지옥 제거**: 백엔드·벡터DB·Python 워커를 각각 손으로 띄우고 포트 맞추고 순서 맞추는 일을, Compose가 `depends_on`·네트워크·헬스체크로 자동화한다.
- **재현 가능한 배포**: 같은 이미지 태그면 로컬·EC2 어디서든 동일하게 실행. 롤백도 이전 태그로 되돌리면 끝.
- **격리와 정리**: 컨테이너를 지우면 환경이 깨끗이 사라진다. 호스트 OS를 더럽히지 않는다.

:::warning 없을 때의 실제 고통
워커(B)·벡터DB·백엔드가 서로 다른 런타임(JRE / Python / Qdrant 바이너리)을 요구한다. Compose가 없으면 신규 환경마다 3종 런타임을 설치·버전 정렬·기동 순서까지 사람이 챙겨야 한다.
:::

## 4. CareerTuner에서 어디에 썼나 (실제 파일·서비스)

> 인프라는 **공통 영역**이라 팀장 소유. 본인(영역 C)은 이 위에서 도는 AI 서비스(적합도·경향 분석)를 올린다.

| 파일 | 역할 | 영역 |
| --- | --- | --- |
| `docker-compose.yml` (루트) | backend + qdrant + job-posting-worker 3서비스 정의 | 인프라(팀장) |
| `backend/Dockerfile` | 멀티스테이지 JDK21 빌드 → JRE21 런타임 | 인프라 |
| `ml/job-posting-worker/Dockerfile` | Python 3.12 공고추출 워커 이미지 | 인프라 + B |
| `qdrant/qdrant:latest` | RAG 벡터DB(공식 이미지 그대로 사용) | 인프라 + D/E |

세 서비스의 연결 관계:

| 서비스 | 포트 노출 | 의존 | 비고 |
| --- | --- | --- | --- |
| `backend` | `8080:8080` (호스트 공개) | qdrant(started), worker(**healthy**) | Spring Boot. `QDRANT_URL=http://qdrant:6333` |
| `job-posting-worker` | `expose: 8091` (내부 전용) | — | Flask 공고추출. healthcheck 있음 |
| `qdrant` | `6333`(REST)·`6334`(gRPC) | — | 볼륨 `qdrant_storage` 에 인덱스 영속 |

:::tip 핵심 설계 포인트 — MySQL은 컴포즈에 없다
`docker-compose.yml` 주석에 명시: **MySQL은 팀 공용 원격 인스턴스를 재사용**하므로 컨테이너로 포함하지 않는다. DB 접속값은 `.env` 로만 주입(`DB_HOST`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`)하고 평문 커밋 금지. 미설정 시 `application.yaml` 의 `ENV:기본값` 패턴 기본값으로 폴백한다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 멀티스테이지 Dockerfile (backend)

빌드 도구(JDK + Gradle)는 무겁고, 실행에는 JRE만 있으면 된다. 그래서 **두 스테이지**로 나눈다.

```dockerfile
# ① build 스테이지: JDK + Gradle 로 bootJar 생성
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradlew settings.gradle build.gradle ./   # 빌드 스크립트 먼저 = 의존성 캐시 최적화
COPY gradle ./gradle
COPY src ./src
RUN ./gradlew bootJar -x test --no-daemon       # 테스트는 CI 담당, 이미지는 산출물만

# ② runtime 스테이지: JRE 만, 빌드 산출물만 가져옴
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd -r -u 1001 appuser && mkdir -p /app/.uploads && chown -R appuser /app
USER appuser                                     # root 아닌 비특권 유저로 실행
COPY --from=build /app/build/libs/*-SNAPSHOT.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

이 Dockerfile에서 면접용으로 짚을 포인트 3가지:
- **레이어 캐시**: 자주 안 바뀌는 빌드 스크립트(`build.gradle`)를 `src` 보다 먼저 COPY해서, 소스만 고쳤을 땐 의존성 다운로드 레이어를 캐시로 재사용한다.
- **이미지 슬림화**: 최종 이미지는 JRE 베이스 + JAR 하나뿐. JDK·Gradle·소스는 build 스테이지에 남고 버려진다.
- **비루트 실행**: `useradd` 후 `USER appuser`. 컨테이너 탈취 시 피해를 줄이는 보안 기본기.

### 5-2. 기동 순서와 헬스체크

```yaml
backend:
  depends_on:
    qdrant:
      condition: service_started      # 떠 있기만 하면 OK
    job-posting-worker:
      condition: service_healthy      # 헬스체크 통과해야 백엔드 시작
```

```yaml
job-posting-worker:
  healthcheck:
    test: ["CMD", "python", "-c",
           "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=3).read()"]
    interval: 30s
    timeout: 5s
    retries: 3
```

`service_started` 와 `service_healthy` 의 차이가 핵심: 단순히 컨테이너가 켜진 것과, **실제로 요청을 받을 준비가 된 것**은 다르다. 백엔드는 워커의 `/health` 가 통과한 뒤에야 뜬다.

### 5-3. 네트워크 · 포트 · 볼륨

| 항목 | 동작 |
| --- | --- |
| 서비스 간 통신 | Compose 기본 네트워크에서 **서비스명이 호스트명**. `http://qdrant:6333`, `http://job-posting-worker:8091` 처럼 부른다 |
| `ports:` vs `expose:` | `ports`는 호스트로 공개(backend 8080, qdrant 6333). `expose`는 내부 컨테이너 간에만(worker 8091) |
| 공유 볼륨 | `media_uploads` 를 backend(읽기/쓰기)·worker(`:ro` 읽기전용)가 공유 → 업로드 PDF를 워커가 본다 |
| 영속 볼륨 | `qdrant_storage` 에 벡터 인덱스 저장 → 컨테이너 재생성해도 RAG 데이터 유지 |

### 5-4. 환경변수와 .env 주입

```yaml
environment:
  DB_HOST: ${DB_HOST}                       # .env 에서 주입(평문 커밋 금지)
  DB_PORT: ${DB_PORT:-3306}                 # 미설정 시 기본값 3306
  OPENAI_API_KEY: ${OPENAI_API_KEY:-}       # 비밀값 — 시크릿/EC2 로 주입
  QDRANT_URL: http://qdrant:6333            # 내부 고정값은 코드에 박아도 됨
```

`${VAR}` 는 호스트 환경변수 또는 같은 디렉터리의 `.env` 파일에서 읽는다. `${VAR:-기본값}` 은 없을 때 기본값. **비밀값(DB 비번, `OPENAI_API_KEY`, `JWT_SECRET`)은 `.env`/시크릿으로만** 넣고 절대 yml에 적지 않는다.

```bash
# 실행 (compose 헤더 주석에 적힌 방식)
OPENAI_API_KEY=... docker compose up -d --build
```

## 6. 면접 답변 3단계

- **초간단(1문장)**: "멀티스테이지 Dockerfile로 백엔드 이미지를 가볍게 빌드하고, docker-compose로 백엔드·Qdrant·공고추출 워커를 한 번에 띄웁니다."
- **기본**: "백엔드 Dockerfile은 JDK21로 bootJar를 만드는 build 스테이지와 JRE21 런타임 스테이지로 나눠 최종 이미지를 슬림하게 유지하고 비루트 유저로 실행합니다. Compose는 세 서비스를 서비스명 기반 내부 네트워크로 연결하고, 백엔드가 워커의 헬스체크 통과 후 뜨도록 `depends_on` 조건을 걸었습니다. MySQL은 팀 공용 원격 인스턴스를 재사용해서 컨테이너에 포함하지 않고, DB·API 키 같은 비밀값은 `.env`로만 주입합니다."
- **꼬리질문 대응**: "Qdrant 인덱스와 업로드 파일은 named volume으로 영속화했고, 업로드 볼륨은 워커에 `:ro`로 공유해 권한을 최소화했습니다. 레이어 캐시를 살리려고 `build.gradle`을 `src`보다 먼저 COPY했고, 이미지 빌드 시 테스트는 `-x test`로 빼서 CI가 책임지게 분리했습니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. 멀티스테이지 빌드는 왜 쓰나요? 안 쓰면?
빌드에는 JDK·Gradle이 필요하지만 실행에는 JRE만 있으면 된다. 단일 스테이지면 JDK·Gradle·소스가 전부 최종 이미지에 남아 이미지가 수백 MB 더 커지고, 소스가 그대로 배포돼 공격 표면도 넓어진다. 멀티스테이지는 `COPY --from=build` 로 **산출물 JAR만** 런타임 이미지에 가져와 작고 안전하게 만든다.
:::

:::details Q2. depends_on 의 service_started 와 service_healthy 차이는?
`service_started`는 컨테이너 프로세스가 시작되기만 하면 다음으로 넘어간다(앱이 아직 준비 안 됐을 수 있음). `service_healthy`는 그 서비스의 healthcheck가 통과해야 한다 — 즉 실제로 요청을 받을 준비가 됐음을 보장한다. CareerTuner는 워커에 대해 `service_healthy`를 걸어, 백엔드가 죽은 워커에 붙는 경쟁 상태를 막는다.
:::

:::details Q3. MySQL은 왜 Compose에 안 넣었나요?
팀이 공용 원격 MySQL 인스턴스를 이미 운영 중이라 컨테이너로 또 띄우면 데이터가 분산되고 관리 포인트가 늘어난다. 그래서 DB는 외부로 두고 접속값만 `.env`로 주입한다. 상태를 가진 DB를 컨테이너 밖에 두는 건 데이터 영속성·백업 관점에서도 흔한 운영 패턴이다.
:::

:::details Q4. .env 에 비밀값을 넣는데 그게 안전한가요?
`.env`는 **커밋하지 않고**(gitignore) 서버/CI 시크릿으로만 채운다. yml에는 `${DB_PASSWORD}` 같은 참조만 남는다. 추가로 deploy-demo 파이프라인은 빌드 결과물에 시크릿 패턴이 새어나갔는지 스캔한다. 더 강하게 가려면 Docker secrets나 외부 secret manager로 옮길 수 있다.
:::

:::details Q5. ports 와 expose 는 뭐가 다른가요?
`ports: "8080:8080"`은 호스트의 8080을 컨테이너로 매핑해 **외부에서 접근 가능**하게 한다. `expose: 8091`은 Compose 내부 네트워크의 다른 컨테이너에서만 닿는 **내부 전용** 포트다. 그래서 공고추출 워커는 외부에 안 열고 `expose`만, 백엔드는 사용자 트래픽을 받아야 하니 `ports`로 공개한다.
:::

:::details Q6. 이미지 빌드 시간을 어떻게 줄였나요?
Dockerfile에서 자주 안 바뀌는 `gradlew`·`build.gradle`·`gradle/`을 `src`보다 먼저 COPY한다. 소스만 고치면 의존성 다운로드 레이어가 캐시에서 재사용돼 빌드가 빨라진다. 또 이미지 빌드에서 테스트를 빼(`-x test`) CI가 테스트를 책임지게 하고, `--no-daemon`으로 컨테이너 빌드 환경에 맞게 Gradle을 돌린다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이 입으로만: "CareerTuner를 새 서버에 배포한다면, `docker compose up` 한 줄을 치고 나서 어떤 순서로 무엇이 뜨는지" 서비스 3개의 기동 순서·의존·헬스체크를 흐름으로 설명해보라.
2. "이미지를 더 작고 더 안전하게 만들려고 이 Dockerfile에서 한 선택 3가지"를 멀티스테이지·비루트 유저·레이어 캐시 키워드로 30초 안에 말해보라.

## 퀴즈

<QuizBox question="CareerTuner의 docker-compose.yml 에 컨테이너로 포함되지 않은 것은?" :choices="['backend', 'qdrant', 'job-posting-worker', 'MySQL']" :answer="3" explanation="MySQL은 팀 공용 원격 인스턴스를 재사용하므로 Compose에 포함하지 않고, 접속값만 .env 로 주입한다. 나머지 셋(backend, qdrant, job-posting-worker)은 서비스로 정의돼 있다." />

<QuizBox question="backend 의 depends_on 에서 job-posting-worker 에 걸린 조건과 그 이유는?" explanation="condition: service_healthy 가 걸려 있다. service_started 는 컨테이너 프로세스가 켜지기만 하면 통과하지만, service_healthy 는 워커의 /health 헬스체크가 통과해야 백엔드가 시작된다. 즉 워커가 실제로 요청을 받을 준비가 됐음을 보장해, 백엔드가 아직 준비 안 된 워커에 붙는 경쟁 상태를 막는다." />

<QuizBox question="backend Dockerfile 이 멀티스테이지(JDK21 build → JRE21 runtime)로 나뉜 가장 큰 이유는?" :choices="['테스트를 두 번 돌리려고', '빌드에 필요한 JDK·Gradle을 최종 이미지에서 제외해 이미지를 작고 안전하게 만들려고', 'MySQL을 함께 빌드하려고', '포트를 두 개 열려고']" :answer="1" explanation="실행에는 JRE만 필요하다. build 스테이지에서 bootJar를 만든 뒤 COPY --from=build 로 JAR만 JRE 런타임 이미지에 가져오면, JDK·Gradle·소스가 빠져 최종 이미지가 가볍고 공격 표면도 줄어든다." />
