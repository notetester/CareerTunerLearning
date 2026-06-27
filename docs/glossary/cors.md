# CORS

> CORS는 브라우저의 동일 출처 정책 때문에 막히는 교차 출처 요청을, 서버가 응답 헤더로 허용해주는 표준입니다. CareerTuner는 SecurityConfig에서 허용 오리진(localhost:5173, capacitor://localhost 등)만 풀어줍니다.

## 1. 한 줄 정의

CORS는 **브라우저의 동일 출처 정책(Same-Origin Policy)에 합법적으로 구멍을 뚫어주는 서버 측 허가 메커니즘**이다. 서버가 응답 헤더로 "이 출처는 내 자원을 읽어도 된다"고 명시하면, 브라우저가 그 응답을 JS에게 넘겨준다.

## 2. 단어 뜻 (약자/어원 풀이)

| 조각 | 뜻 |
| --- | --- |
| **C**ross | 가로질러 — 출처 경계를 넘어 |
| **O**rigin | 출처 = `프로토콜 + 호스트 + 포트` 셋이 전부 같아야 같은 출처 |
| **R**esource | 자원 (API 응답, 폰트, 이미지 등) |
| **S**haring | 공유 — 다른 출처에 자원을 내어줌 |

핵심은 **origin의 정의**다. `http://localhost:5173`과 `http://localhost:8080`은 포트가 달라서 **다른 출처**다. `http`와 `https`도 다른 출처, 서브도메인이 달라도 다른 출처다.

:::tip
CORS는 "보안 기능"처럼 들리지만, 정확히는 **브라우저가 거는 제약을 서버가 풀어주는 협상**이다. CORS 자체가 서버를 보호하는 방패가 아니다. (꼬리질문에서 다시 다룬다.)
:::

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

브라우저에는 기본적으로 **동일 출처 정책(SOP)**이 깔려 있다. 이게 없으면 내가 은행에 로그인한 상태로 악성 사이트에 들어갔을 때, 그 사이트의 JS가 내 쿠키를 실어 은행 API를 호출하고 응답(잔액 등)을 훔쳐볼 수 있다. SOP는 이걸 막는다.

그런데 현대 웹은 프론트(`:5173`)와 API 서버(`:8080`)의 출처가 다른 게 정상이다. 막기만 하면 정당한 SPA가 자기 API를 못 부른다. 그래서 **서버가 "이 출처는 믿는다"고 명시적으로 허락하는 표준**이 CORS다.

| CORS 설정이 잘못되면 | 증상 |
| --- | --- |
| 허용 오리진에 프론트 출처 누락 | 콘솔에 `blocked by CORS policy`, 네트워크는 응답 왔는데 JS가 못 읽음 |
| 너무 넓게(`*` + credentials) 허용 | 인증 쿠키를 임의 사이트에 노출 — 보안 사고 |
| Preflight(OPTIONS) 응답 누락 | PUT/DELETE/커스텀 헤더 요청이 본 요청 전에 실패 |

## 4. CareerTuner에서 어디에 썼나 (실제 클래스/파일)

영역 표시: **공통(common) — Owner는 팀장**. CORS 설정 변경은 팀 합의가 필요한 영역이다.

| 위치 | 역할 |
| --- | --- |
| `common/config/SecurityConfig.java` | `corsConfigurationSource()` 빈에서 허용 오리진·메서드·헤더·credentials 정의. `http.cors(...)`로 시큐리티 체인에 연결 |
| `careertuner.cors.allowed-origins` (`CORS_ALLOWED_ORIGINS` env) | 허용 오리진 목록. 기본값은 코드에 박혀 있고 환경변수로 덮어씀 |
| `frontend/vite.config.ts` | 개발 모드 `/api` 프록시 — 브라우저가 동일 출처로 보게 만들어 CORS를 회피 |
| `frontend/capacitor.config.ts` | 모바일 WebView 오리진(`capacitor://localhost`, `http://localhost`)이 백엔드 허용 목록과 맞물림 |

실제 `corsConfigurationSource()` 핵심:

```java
config.setAllowedOriginPatterns(allowedOriginPatterns); // 패턴 매칭 (와일드카드 + credentials 공존)
config.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
config.setAllowedHeaders(List.of("*"));
config.setAllowCredentials(true);
source.registerCorsConfiguration("/api/**", config); // /api 경로에만 적용
```

기본 허용 오리진(코드 기본값, 환경변수로 교체 가능):

```text
http://localhost:5173   ← Vite 개발 서버
http://localhost        ← Android WebView
https://localhost       ← Android WebView(https)
capacitor://localhost   ← iOS WebView
```

:::warning 흔한 오해 (CareerTuner 런북에 명시됨)
모바일 앱이 백엔드를 LAN/터널/클라우드 어디에 두든, 앱이 보내는 요청의 **origin은 백엔드 주소가 아니라 WebView 자신의 `capacitor://localhost`**다. 그 origin은 이미 허용돼 있으므로 **백엔드를 옮겨도 CORS는 대개 안 건드려도 된다.** "CORS에 백엔드 IP를 넣어야지"는 틀린 직관이다.
:::

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### Simple request vs Preflight

브라우저는 요청을 두 부류로 나눈다.

| 구분 | 조건 | 동작 |
| --- | --- | --- |
| Simple request | GET/POST/HEAD + 단순 헤더만 | 본 요청 바로 보냄. 응답의 `Access-Control-Allow-Origin`을 보고 JS에게 줄지 결정 |
| Preflight 필요 | PUT/PATCH/DELETE, 또는 `Authorization` 같은 비단순 헤더 | **본 요청 전에 OPTIONS 요청**을 먼저 보내 허락받음 |

CareerTuner는 JWT를 `Authorization: Bearer ...` 헤더로 보내므로 대부분 요청이 **Preflight 대상**이다. 그래서 `setAllowedMethods`에 `OPTIONS`가 들어가 있어야 한다.

### Preflight 흐름

```text
1) 브라우저: OPTIONS /api/...
              Origin: http://localhost:5173
              Access-Control-Request-Method: PUT
              Access-Control-Request-Headers: authorization
2) 서버:     200 + Access-Control-Allow-Origin: http://localhost:5173
                   Access-Control-Allow-Methods: ...
                   Access-Control-Allow-Credentials: true
3) 브라우저: 허락 확인 후 진짜 PUT 요청 전송
```

### credentials와 와일드카드의 함정

`allowCredentials=true`일 때 `Access-Control-Allow-Origin: *`는 **브라우저가 거부**한다(둘 다 못 씀). CareerTuner가 `setAllowedOrigins`가 아니라 **`setAllowedOriginPatterns`**를 쓰는 이유가 이것이다. 패턴은 와일드카드를 쓰면서도 응답에는 **요청한 구체 origin을 그대로 반사**해주므로 credentials와 공존한다.

### 개발에선 CORS를 아예 회피한다

```text
[개발]  브라우저 → http://localhost:5173/api/...  (Vite 프록시) → http://localhost:8080
        브라우저 눈엔 같은 출처(:5173)라 CORS 발생 안 함
[운영]  프론트·API가 같은 도메인이면 동일 출처라 CORS 무관
```

그래서 CORS 설정이 실제로 의미를 갖는 건 **모바일 WebView**나 **다른 도메인으로 직접 호출(절대 URL 빌드)**할 때다.

## 6. 면접 답변 3단계

- **초간단(1문장):** "CORS는 브라우저의 동일 출처 정책 때문에 막히는 교차 출처 요청을, 서버가 응답 헤더로 허용해주는 표준입니다."
- **기본:** "브라우저는 프로토콜·호스트·포트가 모두 같아야 같은 출처로 보고, 다르면 응답을 JS가 못 읽게 막습니다. 서버가 `Access-Control-Allow-Origin` 등으로 신뢰 출처를 명시하면 풀립니다. 저희는 Spring Security `SecurityConfig`에서 `CorsConfigurationSource` 빈으로 프론트(`localhost:5173`)와 모바일 WebView(`capacitor://localhost`)만 허용했습니다."
- **꼬리질문 대응:** "JWT를 `Authorization` 헤더로 보내 대부분 요청이 Preflight 대상이라 OPTIONS를 허용 메서드에 넣었고, credentials를 쓰니 `*` 대신 `setAllowedOriginPatterns`로 구체 origin을 반사하게 했습니다. 개발 단계에선 Vite 프록시로 같은 출처처럼 만들어 CORS를 우회합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

:::details Q1. CORS가 서버를 보호하나요?
아니요. CORS는 **브라우저가** 응답을 JS에게 넘길지 말지를 결정하는 클라이언트 측 제약입니다. 서버는 요청을 이미 처리한 뒤 헤더로 "읽어도 된다"를 알려줄 뿐입니다. curl이나 다른 서버, Postman은 CORS를 무시하고 요청합니다. 그래서 서버 보호는 **인증/인가(JWT, `/api/admin/**` 권한 등)**가 담당하고, CORS는 별개 레이어입니다.
:::

:::details Q2. allowCredentials=true에서 왜 `*`를 못 쓰나요?
`*` + credentials 조합은 표준이 금지합니다. 임의 사이트가 사용자 쿠키를 실어 보내고 응답까지 읽을 수 있게 되니까요. 그래서 credentials를 켜면 응답의 `Access-Control-Allow-Origin`에 구체적인 출처를 명시해야 합니다. CareerTuner는 `setAllowedOriginPatterns`를 써서 패턴 매칭은 유연하게 하되, 실제 응답엔 요청 origin을 반사해 이 규칙을 만족시킵니다.
:::

:::details Q3. Preflight는 언제 발생하나요?
GET/POST/HEAD이면서 단순 헤더만 쓰면 Preflight가 없습니다(simple request). PUT/PATCH/DELETE이거나 `Authorization`·`Content-Type: application/json` 같은 비단순 헤더를 쓰면, 브라우저가 본 요청 전에 OPTIONS를 보내 허락을 받습니다. JWT를 헤더로 쓰는 우리 API는 대부분 Preflight 대상이라 허용 메서드에 OPTIONS를 넣었습니다.
:::

:::details Q4. dev 서버가 :5174로 뜨면 로그인이 403 나던데요?
CORS 허용 목록에 `:5173`만 있어서 프록시가 보내는 `Origin: localhost:5174`가 거부된 사례입니다. `:5173`에서 실행/접속하면 정상이고, 운영은 동일 출처라 무관합니다. (403은 백엔드가 죽은 게 아니라 거부했다는 신호 — 구동은 되고 있다는 뜻이기도 합니다.)
:::

:::details Q5. 모바일 앱 백엔드를 옮기면 CORS를 고쳐야 하나요?
대개 아니요. 앱 WebView가 보내는 origin은 백엔드 주소가 아니라 `capacitor://localhost`이고, 그 origin은 이미 허용돼 있습니다. 백엔드를 LAN/터널/클라우드 어디로 옮겨도 origin은 그대로입니다. 단, 실측해 origin이 다르게 뜨면 그때 `CORS_ALLOWED_ORIGINS` 환경변수로 추가합니다.
:::

## 8. 직접 말해보기 (말하기 훈련용)

1. "동일 출처 정책이 없으면 어떤 공격이 가능한지, 그리고 CORS는 그 정책과 어떤 관계인지"를 30초로 말해보라.
2. CareerTuner에서 "개발에선 CORS가 안 보이는데 운영/모바일에선 신경 써야 하는 이유"를 프록시와 WebView origin 개념으로 설명해보라.

## 퀴즈

<QuizBox question="다음 중 'http://localhost:5173'과 같은 출처(same-origin)인 것은?" :choices="['http://localhost:8080', 'https://localhost:5173', 'http://localhost:5173/api', 'http://127.0.0.1:5173']" :answer="2" explanation="출처는 프로토콜+호스트+포트로 정의된다. 경로(/api)는 출처에 포함되지 않으므로 http://localhost:5173/api는 같은 출처다. 포트(8080), 프로토콜(https), 호스트(127.0.0.1은 localhost와 문자열이 달라 별개 호스트로 취급)가 다르면 모두 다른 출처다." />

<QuizBox question="CareerTuner가 SecurityConfig에서 setAllowedOrigins 대신 setAllowedOriginPatterns를 쓴 핵심 이유는?" :choices="['패턴이 더 빠르게 매칭돼서', 'allowCredentials=true와 와일드카드를 함께 쓰면서도 구체 origin을 반사할 수 있어서', 'OPTIONS 요청을 자동 생성해줘서', 'JWT 검증을 대신 해줘서']" :answer="1" explanation="credentials를 켜면 Access-Control-Allow-Origin에 와일드카드를 쓸 수 없다. setAllowedOriginPatterns는 와일드카드 패턴을 허용하면서도 응답에는 요청한 구체 origin을 반사해주므로 credentials와 공존한다." />

<QuizBox question="CORS는 서버를 외부 공격으로부터 보호하는 보안 방패다 — 이 설명의 문제점을 지적하라." explanation="CORS는 서버 보호 장치가 아니라 브라우저가 교차 출처 응답을 JS에게 넘길지 결정하는 클라이언트 측 제약이다. 서버는 요청을 이미 처리한 뒤 허용 헤더만 붙인다. curl, Postman, 다른 서버는 CORS를 무시한다. 따라서 실제 서버 보호는 인증/인가(JWT, 권한 체크, /api/admin/** 같은 URL 권한)가 담당하고, CORS는 브라우저 한정의 별개 레이어다." />
