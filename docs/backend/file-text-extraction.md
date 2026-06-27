# 파일/URL 텍스트 추출 (PDFBox·Jsoup·SSRF)

> 사용자가 올린 채용공고를 PDF·이미지·URL 어디서 받든 "안전하게" 평문 텍스트로 뽑아 AI 분석에 넘기는 입력 게이트웨이다. 핵심은 추출 자체보다 **SSRF 방어**다.

## 1. 한 줄 정의

`JobPostingTextExtractor`는 채용공고 원본(PDF / 이미지 / 웹 URL)을 받아 **분석 가능한 평문 텍스트로 변환**하는 백엔드 서비스이며, 그 과정에서 외부 URL 요청이 내부망을 찌르지 못하도록 막는다.

## 2. 단어 뜻 (약자/어원 풀이)

| 용어 | 풀이 |
| --- | --- |
| PDFBox | Apache의 PDF 라이브러리. `PDFTextStripper`로 PDF 안의 텍스트 레이어를 추출 |
| Jsoup | Java용 HTML 파서. 깨진 HTML도 DOM으로 만들어 `body().text()`로 본문만 추출 |
| OCR | Optical Character Recognition. 그림 속 글자를 인식. 텍스트 레이어가 없는 이미지 PDF에 필요 |
| SSRF | Server-Side Request Forgery. 서버가 공격자가 시킨 주소로 요청을 대신 보내게 만드는 공격 |
| Vision | OpenAI가 이미지를 보고 글자/내용을 읽는 멀티모달 기능. 여기선 OCR 폴백 수단 |
| DNS 핀닝 | 호스트명을 IP로 한 번 검증한 뒤 그 IP로만 접속해, 재조회 시 IP가 바뀌는 공격을 막는 기법 |

## 3. 왜 필요한가 (없으면 무슨 문제가 생기나)

CareerTuner의 핵심 단위는 "지원 건"이고, 그 출발점은 채용공고다. 그런데 사용자가 주는 공고는 형태가 제각각이다.

- **PDF**: 텍스트가 들어있는 정상 PDF도 있고, 스캔본처럼 그림만 든 PDF도 있다.
- **이미지**: PNG·JPG로 캡처한 공고. 텍스트 레이어가 아예 없다.
- **URL**: 채용 사이트 링크. HTML을 받아 본문만 골라내야 한다.

이걸 통일된 평문으로 만들지 않으면 뒤 단계(공고 분석 JOB → 적합도 FIT 등)가 입력 형태마다 따로 코드를 짜야 한다.

::: warning URL 추출이 가장 위험하다
"URL을 받아서 서버가 대신 가져온다"는 기능은 SSRF의 교과서적 시나리오다. 막지 않으면 사용자가 `http://169.254.169.254/...`(클라우드 메타데이터)나 `http://192.168.x.x/admin`(내부 관리 페이지)을 넣어 **우리 서버를 통해 내부망을 정찰**할 수 있다. 그래서 이 클래스는 "추출기"인 동시에 "방화벽"이다.
:::

## 4. CareerTuner에서 어디에 썼나 (백엔드 · 영역 B 입력 파이프라인)

| 요소 | 위치 | 역할 |
| --- | --- | --- |
| `JobPostingTextExtractor` | `jobposting/service/` | 추출 + SSRF 방어의 본체 |
| `JobPostingFileStorage` | 같은 패키지 | 업로드 파일 검증·저장, `StoredJobPostingFile` record 생성 |
| `JobPostingFallbackPolicy` | 같은 패키지 | OpenAI OCR 폴백을 켤지 DB/프로퍼티 기준으로 판단 |
| `JobPostingAiWorkerClient` | 같은 패키지 | Python 공고추출 워커 우선 호출(가능하면 로컬 추출 대신) |
| `OpenAiResponsesClient` | `applicationcase/service/` | Vision OCR 폴백 (`extractPdfText`, `extractImageText`) |
| `JobPostingTextExtractorTest` | `src/test/.../jobposting/service/` | SSRF 차단·리다이렉트·인코딩을 검증하는 30+개 케이스 |

흐름상 추출된 텍스트는 공고 분석으로 흘러가고, 이는 본인(영역 C)의 적합도 분석([적합도 분석 AI](/ai/fit-analysis)) 입력이 된다. 즉 이 추출기가 입력 품질의 1차 관문이다.

## 5. 핵심 동작 원리 (표/작은 코드/단계)

### 5-1. 진입점 두 개

```java
// 파일(PDF/이미지) → Python 워커 우선, 없으면 로컬 추출
public ExtractedPosting extractFile(StoredJobPostingFile file) {
    return aiWorkerClient.extractFile(file).orElseGet(() -> extractFileLocally(file));
}

// URL → 먼저 안전성 검증, 그 다음 fetch
public ExtractedPosting extractUrl(String url) {
    ValidatedHttpUrl validatedUrl = validateSafeHttpUrlForFetch(url, hostResolver);
    Document document = fetchDocument(validatedUrl);
    ...
}
```

### 5-2. 파일 추출 단계 (fail-closed 폴백)

| 입력 | 1순위 | 텍스트 비었을 때 | 폴백 꺼져 있으면 |
| --- | --- | --- | --- |
| 정상 PDF | PDFBox `PDFTextStripper` | OpenAI Vision OCR | `qualityStatus="FAILED"` 반환 (열어두지 않음) |
| 이미지 PDF (그림만) | PDFBox가 빈 문자열 반환 | OpenAI Vision OCR | 위와 동일 |
| 이미지(PNG/JPG) | 바로 OpenAI Vision OCR | — | 위와 동일 |

폴백 허용 여부는 `JobPostingFallbackPolicy.allowed(STAGE_PDF_OCR / STAGE_IMAGE_OCR)`로 묻는다. 이 정책은 DB의 런타임 설정을 먼저 읽고 없으면 프로퍼티 기본값을 쓴다 → **관리자가 켜고 끌 수 있고, 기본은 보수적으로 꺼짐.**

### 5-3. HTML 추출 (Jsoup)

```java
document.select("script, style, noscript, svg").remove(); // 노이즈 제거
String title = document.title();
String body  = document.body().text();                    // 태그 벗긴 순수 본문
```

### 5-4. SSRF 방어 — 이 파일의 진짜 핵심

추출 전, 그리고 **리다이렉트마다 다시** 다음을 검사한다.

1. **스킴 화이트리스트**: `http`/`https`만. `ftp://`, `file://` 등은 호스트 조회조차 하기 전에 거부.
2. **localhost 이름 차단**: `localhost`, `*.localhost`, `localhost.localdomain`.
3. **DNS 조회 후 IP 단위 검사**: 호스트를 IP로 풀고, 하나라도 위험 대역이면 차단.
   - 루프백(127/8, ::1), 사설망(10/8·172.16/12·192.168/16=site-local), 링크로컬(169.254/16), `0.0.0.0`/0.x, 멀티캐스트, 브로드캐스트, 메타데이터 `169.254.169.254`, CGNAT `100.64/10`, 벤치마크 `198.18/15`, 문서용 `192.0.2/24`·`198.51.100/24`·`203.0.113/24`, 예약 `240/4`, IPv6 ULA(`fc00::/7`).
4. **DNS 핀닝**: 검증에 쓴 IP를 `ValidatedHttpUrl`에 담아 들고 가, 실제 접속도 **그 IP로** 한다. 호스트명을 다시 조회하지 않으므로 "검증 땐 안전 IP, 접속 땐 내부 IP"로 바꾸는 **DNS 리바인딩 / TOCTOU** 공격이 막힌다.
5. **리다이렉트 재검증**: 302 등의 `Location`을 따라갈 때 그 새 URL을 처음부터 다시 1~4 검사. 최대 5회.

```java
// 위험 대역 판정의 한 줄 요약
private static boolean isUnsafeAddress(InetAddress a) {
    return a.isLoopbackAddress() || a.isSiteLocalAddress()
        || a.isLinkLocalAddress() || a.isMulticastAddress()
        || isMetadataAddress(a)   /* 169.254.169.254 */
        || isCarrierGradeNatAddress(a) /* 100.64/10 */
        || ...;
}
```

::: tip 왜 표준 HttpClient를 안 쓰고 직접 소켓을?
`fetchDocument`는 자바 기본 클라이언트의 자동 리다이렉트를 쓰지 않고, `DirectSocketHttpFetcher`로 **검증된 IP에 직접 소켓을 연결**한다. 이렇게 해야 (1) 리다이렉트를 한 단계씩 가로채 매번 재검증하고, (2) DNS 핀닝을 강제하며, (3) 응답 본문 크기(1MB)·헤더 크기·타임아웃(5초)을 직접 제한할 수 있다. HTTPS도 SNI/엔드포인트 식별을 직접 세팅한다.
:::

### 5-5. 출력 한도

추출 텍스트는 `limit()`으로 최대 **120,000자**까지만 자른다. AI 입력 토큰 폭주와 메모리 남용을 막는 방어선.

## 6. 면접 답변 3단계

- **1문장**: "채용공고를 PDF·이미지·URL 어디서 받든 평문으로 추출하는 서비스인데, URL 추출은 SSRF가 위험해서 스킴·IP 대역 검증과 DNS 핀닝으로 막았습니다."
- **기본**: "PDF는 PDFBox로 텍스트 레이어를 뽑고, 이미지거나 텍스트가 없으면 OpenAI Vision OCR로 폴백합니다. 폴백은 `JobPostingFallbackPolicy`로 켜고 끌 수 있고 기본은 꺼짐입니다. URL은 Jsoup으로 본문만 추출하는데, 그 전에 http(s)만 허용하고 호스트를 IP로 풀어 루프백·사설망·메타데이터 같은 위험 대역을 전부 차단합니다."
- **꼬리질문 대응**: "검증한 IP를 들고 다니며 그 IP로 직접 접속하는 DNS 핀닝을 써서 DNS 리바인딩을 막고, 리다이렉트는 한 단계씩 가로채 매번 재검증하며 최대 5회로 제한합니다. 응답은 1MB·5초·120,000자로 한도를 걸어 자원 고갈도 방어합니다."

## 7. 자주 나오는 꼬리질문 + 모범답안

::: details Q1. SSRF가 정확히 뭐고 왜 위험한가요?
서버가 공격자가 시킨 임의 주소로 요청을 대신 보내게 만드는 공격입니다. 우리 기능은 "URL 주면 서버가 가져다 준다"라 딱 표적입니다. 막지 않으면 공격자가 클라우드 메타데이터 엔드포인트(`169.254.169.254`)에서 임시 자격증명을 빼내거나, 외부에선 안 보이는 내부 관리 페이지·DB를 우리 서버를 발판으로 정찰할 수 있습니다.
:::

::: details Q2. 호스트명 문자열만 검사하면 안 되나요?
안 됩니다. `localhost`처럼 이름으로 막을 수 있는 건 일부고, 공격자는 공개 도메인이 사설 IP로 풀리게 DNS를 설정할 수 있습니다. 그래서 실제로 **DNS 조회 결과 IP**를 보고 위험 대역인지 판단해야 합니다. 이름 차단은 1차 필터일 뿐입니다.
:::

::: details Q3. DNS 핀닝(rebinding 방어)이 왜 필요한가요?
검증 시점과 접속 시점 사이에 DNS 응답이 바뀌는 TOCTOU 구멍이 있기 때문입니다. 검증할 때는 안전한 공인 IP를 주고, 실제 접속할 때 같은 도메인이 `127.0.0.1`로 풀리게 만들면 검사를 우회할 수 있습니다. 그래서 검증에 쓴 IP를 그대로 들고 가 그 IP로 접속합니다. 테스트(`fetchUsesAlreadyValidatedAddress...`)도 호스트를 두 번 조회하지 않음을 확인합니다.
:::

::: details Q4. 이미지 PDF인지 어떻게 알고 OCR로 넘어가나요?
별도 판별 없이 PDFBox로 먼저 추출해 결과가 빈 문자열이면 텍스트 레이어가 없는 것으로 보고 OCR 폴백 단계로 갑니다. 단 폴백이 정책상 허용돼 있을 때만 OpenAI Vision을 호출하고, 꺼져 있으면 OpenAI를 부르지 않고 `qualityStatus="FAILED"`로 닫습니다(fail-closed). 비용·외부 의존을 통제하려는 의도입니다.
:::

::: details Q5. Python 워커와 로컬 추출, OpenAI는 어떤 순서인가요?
`extractFile`은 Python 공고추출 워커(영역 B)가 켜져 있으면 그쪽을 우선 호출하고, 없거나 비활성이면 `extractFileLocally`(PDFBox/Vision)로 내려갑니다. 워커가 깨진 JSON이나 타임아웃을 주면 OpenAI로 조용히 넘어가지 않고 `INTERNAL_ERROR`로 명확히 실패시킵니다(테스트로 보장). 즉 폴백 체인은 있지만 "조용한 무한 폴백"이 아니라 단계마다 정책·실패 조건이 명확합니다.
:::

## 8. 직접 말해보기

1. 화이트보드 없이, "사용자가 채용공고 URL을 넣었을 때 우리 서버가 그걸 가져오기까지 거치는 보안 검사"를 순서대로 60초 안에 설명해 보라. (스킴 → 이름 → IP 대역 → 핀닝 → 리다이렉트 재검증 → 한도)
2. 면접관이 "왜 라이브러리 HttpClient 대신 소켓을 직접 열었냐"고 물었다고 가정하고, 리다이렉트 재검증·DNS 핀닝·응답 한도 세 가지로 답해 보라.

## 퀴즈

<QuizBox question="JobPostingTextExtractor의 URL 추출에서 'DNS 핀닝'을 적용하는 주된 이유는?" :choices="['응답 속도를 높이려고', '검증 시점과 접속 시점 사이 IP가 바뀌는 DNS 리바인딩을 막으려고', '텍스트 추출 정확도를 높이려고', 'OCR 비용을 줄이려고']" :answer="1" explanation="호스트명을 한 번 IP로 검증한 뒤 그 IP로만 접속한다. 접속 직전에 도메인을 다시 조회하면 안전 IP에서 내부 IP로 바뀌는 TOCTOU(DNS 리바인딩) 우회가 가능하므로, 검증한 IP를 들고 다녀 막는다." />

<QuizBox question="텍스트 레이어가 없는 이미지 PDF를 처리할 때의 동작으로 옳은 것은?" :choices="['무조건 OpenAI Vision OCR을 호출한다', 'PDFBox 결과가 비면, 폴백 정책이 허용될 때만 Vision OCR을 부르고 아니면 FAILED로 닫는다', '항상 Python 워커만 사용한다', '빈 텍스트라도 그대로 분석에 넘긴다']" :answer="1" explanation="PDFBox 추출이 빈 문자열이면 JobPostingFallbackPolicy.allowed(STAGE_PDF_OCR)를 확인한다. 허용돼 있으면 OpenAI Vision OCR로 폴백하고, 꺼져 있으면 OpenAI를 호출하지 않고 qualityStatus=FAILED로 fail-closed 처리한다." />

<QuizBox question="이 추출기가 차단해야 하는 URL의 예를 두 개 들고, 각각 왜 위험한지 한 문단으로 설명하라." explanation="대표 예는 (1) http://169.254.169.254/... 클라우드 인스턴스 메타데이터 엔드포인트 — 임시 자격증명이 노출돼 계정 탈취로 이어질 수 있다. (2) http://192.168.x.x/admin 또는 http://127.0.0.1/... 같은 사설망·루프백 주소 — 외부에선 안 보이는 내부 관리 콘솔/서비스를 우리 서버를 발판 삼아 정찰·접근할 수 있다. 둘 다 isUnsafeAddress의 메타데이터/사설망/루프백 판정으로 차단되며, 공개 도메인이 이런 IP로 풀리는 경우도 DNS 조회 결과 IP를 보고 막는다." />
