# 공고 텍스트 추출 — PDFBox · Jsoup · OCR · SSRF

> 분석 엔진에 넣을 "입력 텍스트"를 만드는 단계. 핵심은 PDF는 PDFBox로 직접 읽고, URL은 직접 소켓 HTTP + Jsoup으로 긁고, 이미지/스캔 PDF만 OCR로 폴백하며, URL 추출 경로 전체를 SSRF로부터 방어하는 것이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 B의 첫 관문은 **공고 원문을 사람이 올린 형태(텍스트 / PDF / 이미지 / URL)에서 분석 가능한 plain text로 변환**하는 일이다. 이 일을 전담하는 클래스가 `JobPostingTextExtractor`(`backend/.../jobposting/service/`)다. 핵심 철학은 그라운딩 문서의 한 문장으로 요약된다 — **"OCR은 입력 텍스트 확보 단계일 뿐, 자체 모델의 본질은 OCR 이후의 문장 분류와 조건 추출."** 즉 추출은 화려한 AI가 아니라 **싸고 결정론적인 경로를 먼저 쓰고, 정말 안 될 때만 비싼 OCR로 폴백**하는 게 설계 목표다.

이 페이지가 답하는 면접 질문:

- "사용자가 PDF/이미지/URL로 공고를 올리면 텍스트를 어떻게 뽑나요?"
- "URL 입력을 받아 서버가 그 주소를 직접 fetch하는데, SSRF는 어떻게 막았나요?" (보안 면접의 단골)
- "왜 OCR을 항상 쓰지 않고 PDFBox/Jsoup을 먼저 쓰나요? 비용·정확도 트레이드오프는?"
- "스캔본 PDF(텍스트 레이어 없음)처럼 추출이 비는 경우는 어떻게 처리하나요?"

## 2. 왜 이렇게 설계했나 (의도·트레이드오프)

추출 경로를 소스 타입별로 분기한 이유는 **각 입력마다 "공짜로 정확한 텍스트"가 나오는 경로가 다르기 때문**이다.

| 소스 | 1차 경로(싸고 정확) | OCR 폴백 트리거 | 이유 |
| --- | --- | --- | --- |
| `PDF` (텍스트 레이어 있음) | PDFBox `PDFTextStripper` | 추출 텍스트가 `isBlank()`일 때만 | 디지털 PDF는 글자가 이미 들어 있어 OCR이 불필요·부정확 |
| `IMAGE` | (없음) | 항상 OCR 필요 | 이미지엔 텍스트 레이어가 없음 |
| `URL` | 직접 소켓 HTTP + Jsoup 파싱 | 없음(텍스트 미추출 시 실패) | 웹페이지는 HTML 텍스트라 OCR 대상이 아님 |
| `TEXT`/`MANUAL` | 사용자가 친 텍스트 그대로 | 없음 | 추출 자체가 불필요 |

핵심 트레이드오프 세 가지:

1. **비용/정확도 vs 항상-OCR**: 디지털 PDF에 OCR을 돌리면 토큰·시간을 낭비하고 표/레이아웃에서 오히려 글자가 깨진다. 그래서 PDFBox가 글자를 한 자라도 뽑으면 OCR을 건너뛴다.
2. **자체 처리 우선 vs 외부 LLM**: OCR 폴백은 기본적으로 **비활성**이다. OpenAI OCR은 명시 allowlist된 단계에서만, Python 워커(PaddleOCR)는 둘 다 기본 OFF다(§5). "추출이 안 되면 무조건 외부 API"가 아니라, 운영자가 명시적으로 켜야 비싼 경로가 열린다.
3. **편의성 vs SSRF 위험**: "URL만 붙여넣으면 자동 등록"은 사용자 경험상 매력적이지만, 서버가 임의 URL을 fetch한다는 건 곧 **공격자가 서버 내부망을 들여다보는 통로**가 될 수 있다. 그래서 URL 경로에만 가장 두꺼운 방어가 붙는다.

## 3. 어떤 기술로 구현했나 (실제 클래스·라이브러리)

추출 1단계는 외부 라이브러리 의존을 최소화하고, 네트워크 fetch는 표준 라이브러리로 직접 구현해 통제권을 확보했다.

| 책임 | 기술 / 클래스 | 근거 |
| --- | --- | --- |
| PDF 텍스트 | Apache **PDFBox** `Loader.loadPDF` + `PDFTextStripper` | `extractTextPdf()` |
| HTML 파싱 | **Jsoup** `Jsoup.parse(...)`, `document.select("script, style, noscript, svg").remove()` | `fetchDocument()` |
| URL fetch | **직접 소켓**(`java.net.Socket`/`SSLSocket`) `DirectSocketHttpFetcher` | extractor 내부 static class |
| 이미지/스캔 PDF OCR | `OpenAiResponsesClient.extractImageText / extractPdfText` 또는 Python 워커 | OCR 폴백 |
| SSRF 방어 | 자체 IP 분류 메서드 군(`isUnsafeAddress` 등) | extractor static 메서드 |
| 폴백 on/off | `JobPostingFallbackPolicy` (DB 영속 토글) | `allowed(stage)` |
| 파일 검증/저장 | `JobPostingFileStorage` (타입·크기 검증) | `store()` |

:::tip 왜 HttpClient나 Jsoup의 자체 `connect()`를 안 쓰고 소켓을 직접 열었나?
SSRF 방어의 핵심은 **"DNS로 해석한 바로 그 IP에 연결한다"**는 보장이다. 고수준 HTTP 클라이언트는 호스트명을 내부에서 다시 resolve하므로, 검사한 IP와 실제 연결되는 IP가 달라지는 **TOCTOU(time-of-check vs time-of-use) / DNS rebinding** 틈이 생긴다. `DirectSocketHttpFetcher`는 검증을 통과한 `InetAddress`로 직접 `socket.connect()`해서 이 틈을 닫는다. HTTPS에서도 SNI와 `setEndpointIdentificationAlgorithm("HTTPS")`로 인증서 검증은 유지한다.
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 PDF — PDFBox 먼저, 비면 OCR 폴백

```java
// extractFileLocally(file) — PDF 분기 (요지)
String text = extractTextPdf(file);          // PDFBox로 텍스트 레이어 추출
if (text.isBlank()) {                          // 스캔본 등 → 글자 0
    if (!fallbackPolicy.allowed(STAGE_PDF_OCR))// OCR 단계가 허용됐나?
        return FAILED(...);                    // 아니면 실패로 끝냄
    payload = openAiClient.extractPdfText(...);// 허용 시에만 OCR
    text = payload.text();
}
return new ExtractedPosting(..., limit(text), usage);
```

```java
private String extractTextPdf(StoredJobPostingFile file) {
    try (PDDocument document = Loader.loadPDF(file.bytes())) {
        return new PDFTextStripper().getText(document).trim();
    } catch (IOException ex) {
        throw new BusinessException(ErrorCode.INVALID_INPUT, "PDF 텍스트를 추출하지 못했습니다.");
    }
}
```

포인트: 디지털 PDF면 한 번의 PDFBox 호출로 끝(무과금). `isBlank()`일 때만 OCR로 내려가고, 그마저도 정책이 막혀 있으면 `qualityStatus="FAILED"` + `fallbackReason`을 담은 `ExtractedPosting`을 돌려준다(예외를 던지지 않고 "실패 상태"로 표현 → 비동기 워커가 상태기계로 처리).

### 4.2 IMAGE — 항상 OCR (정책 필요)

이미지에는 1차 경로가 없으므로 바로 `STAGE_IMAGE_OCR` 허용 여부를 본다. 허용이면 `openAiClient.extractImageText(contentType, bytes)`, 불허면 FAILED. 즉 **OCR 폴백이 꺼진 환경에서 IMAGE 업로드는 실패**하도록 정직하게 동작한다.

### 4.3 URL — 직접 소켓 fetch → Jsoup 본문 추출

```text
extractUrl(url)
 └ validateSafeHttpUrlForFetch(url)   # ① scheme/host 검사 + DNS resolve + IP 안전성 검사
 └ fetchDocument(validatedUrl)        # ② 검증된 IP로만 소켓 연결
     ├ fetch() → DirectSocketHttpFetcher.fetch()
     ├ 3xx면 Location을 다시 validate (리다이렉트마다 재검증, 최대 5회)
     └ Jsoup.parse(body, charset, url)
 └ select("script, style, noscript, svg").remove()  # ③ 노이즈 제거
 └ title + "\n\n" + body.text()       # ④ 제목+본문 결합
 └ limit(text)                        # ⑤ 12만자 상한
```

본문 추출 시 `script/style/noscript/svg`를 먼저 제거해 JS·CSS·인라인 SVG 노이즈가 분석 입력에 섞이지 않게 한다. 응답 본문이 비면 `INVALID_INPUT`("URL에서 공고문 텍스트를 추출하지 못했습니다.")로 명확히 실패시킨다.

### 4.4 ★ SSRF 방어 — 다층 차단(이 페이지의 백미)

URL 추출은 "서버가 사용자가 준 주소로 직접 나간다"는 점에서 SSRF의 교과서적 표적이다. 방어는 **검증→연결→리다이렉트 재검증**의 3중 구조이고, 차단 대상 IP 범위가 구체적이다.

`isUnsafeAddress(address)`가 막는 것:

| 차단 범주 | 검사 | 막는 공격 |
| --- | --- | --- |
| 모든 로컬/루프백 | `isAnyLocalAddress` / `isLoopbackAddress`(`127.0.0.0/8`) | `localhost`, 자기 자신 |
| 사설망 | `isSiteLocalAddress`(`10/8`,`172.16/12`,`192.168/16`) | 내부망 스캔 |
| 링크로컬 | `isLinkLocalAddress`(`169.254/16`) | 링크로컬 자원 |
| ★ 클라우드 메타데이터 | `isMetadataAddress` → **`169.254.169.254`** 정확 매칭 | AWS/GCP 메타데이터 → 자격증명 탈취 |
| ★ CGNAT | `isCarrierGradeNatAddress` → **`100.64.0.0/10`** | 캐리어급 NAT 내부 |
| ★ IPv6 ULA | `isIpv6UniqueLocalAddress` → **`fc00::/7`** | IPv6 우회 |
| 특수 IPv4 | `isSpecialIpv4Address`(`0/8`,`192.0.0/24`,`192.0.2/24`,`198.18/15`,`broadcast` 등) | 예약/문서용/벤치마크 대역 |
| 멀티캐스트 | `isMulticastAddress` | 비정상 대상 |
| 호스트명 단계 | `isLocalhostName`(`localhost`, `*.localhost`, `localhost.localdomain`) | resolve 전 이름 차단 |

추가 견고화 장치:

- **DNS의 모든 A/AAAA 레코드를 검사**: `validateSafeHost`가 `resolver.resolve(host)`로 받은 **배열 전체**를 순회하며 하나라도 unsafe면 차단. 멀티-레코드로 안전 IP와 내부 IP를 섞는 우회를 막는다.
- **리다이렉트 재검증(최대 5회)**: 3xx의 `Location`을 그대로 따라가지 않고 `validateRedirectUrl`로 **다시 전체 검증**을 돌린다. "안전한 URL → 302 → 내부 IP" 우회를 차단. 5회 초과 시 실패.
- **검증한 IP로만 연결**: `fetch()`가 `url.addresses()`(검증 통과 IP들)로만 소켓을 연다. 이름 재해석을 안 하므로 DNS rebinding이 무력화된다.
- **응답 상한**: 헤더 누적 64KB·헤더 한 줄 8KB·**본문 1MB**(`URL_MAX_BODY_SIZE`)·타임아웃 5초로 DoS/거대 응답을 막는다. chunked/Content-Length/EOF-종료 본문을 모두 1MB 상한 안에서만 읽는다.

:::warning 면접에서 자주 파고드는 지점
"`isSiteLocalAddress` 하나로 끝낸 게 아니냐"는 질문이 흔하다. 답은 **메타데이터(`169.254.169.254`)·CGNAT(`100.64/10`)·IPv6 ULA(`fc00::/7`)는 표준 사설망 판정으로 안 잡혀서 별도로 막았다**는 것. 특히 `169.254.169.254`는 링크로컬 대역 안이긴 하지만, 클라우드 자격증명 탈취라는 결과가 치명적이라 명시적으로 한 번 더 검사한다.
:::

## 5. 구현 상태 (됨 vs 계획) — 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| PDF 텍스트 추출(PDFBox) | **구현** | `extractTextPdf`, `PDFTextStripper` |
| URL 추출(직접 소켓 + Jsoup) | **구현** | `DirectSocketHttpFetcher`, `fetchDocument` |
| SSRF 다층 차단 | **구현(견고)** | `isUnsafeAddress` 외 IP 분류 메서드 + 리다이렉트 재검증 |
| 추출 텍스트 12만자 상한 | **구현** | `MAX_EXTRACTED_TEXT_LENGTH=120_000`, `limit()` |
| 업로드 검증(타입/크기) | **구현** | `JobPostingFileStorage`(PDF=`application/pdf`만, IMAGE=PNG/JPG/WEBP/GIF, **최대 5MB**) |
| OpenAI OCR 폴백(이미지/스캔PDF) | **구현됐으나 기본 OFF** | `JobPostingFallbackPolicy`(allowlist `JOB_POSTING_PDF_OCR`/`JOB_POSTING_IMAGE_OCR`), `application.yaml` `job-posting-fallback-enabled:false` |
| Python OCR 워커(PaddleOCR, `:8091`) | **구현됐으나 기본 OFF** | `JobPostingAiWorkerProperties.enabled=false`, `ml/job-posting-worker` |
| 품질 점수/상태(`meta`) | **워커 응답에서만 채움** | `JobPostingAiWorkerClient.parseResponse`가 `strategy/qualityScore/qualityStatus...` 매핑 |

핵심 정직 포인트:

- **폴백은 두 토글을 모두 통과해야 켜진다**: `JobPostingFallbackPolicy.allowed(stage)`는 `snapshot.enabled() && allowedStages.contains(stage)`일 때만 true다. 그리고 DB(`ai_runtime_setting`)에 영속된 값이 있으면 그게 우선, 없으면 properties 기본값(=OFF)을 쓴다. 즉 **운영 중 DB 토글로 OCR을 켜고 끌 수 있다**.
- **Python 워커가 켜져 있으면 워커가 우선**: `extractFile`은 `aiWorkerClient.extractFile(file).orElseGet(() -> extractFileLocally(file))` — 워커가 OFF(`Optional.empty()`)일 때만 로컬 PDFBox/OpenAI 경로로 내려간다. 워커는 PaddleOCR/PyMuPDF로 self-hosted OCR을 하고 OpenAI를 호출하지 않는다(데이터 주권).
- **품질 게이트 자체는 이 클래스가 아니다**: `qualityScore`/`qualityStatus`는 Python 워커가 채워주거나, 워커 없는 로컬 경로에선 후단 `ApplicationCaseExtractionQualityGate`(규칙 기반)가 점수를 매긴다. 추출기는 "텍스트 + (있으면) 메타"만 만든다.

## 6. 면접 답변 3단계

1. **한 문장**: "공고를 PDF는 PDFBox, 웹페이지는 직접 소켓 HTTP + Jsoup으로 먼저 뽑고, 이미지나 스캔 PDF처럼 텍스트 레이어가 없을 때만 OCR로 폴백하는 `JobPostingTextExtractor`가 입력 텍스트를 만듭니다."
2. **한 단락**: "디지털 PDF에 OCR을 돌리면 비용·시간 낭비에 정확도까지 떨어지니, PDFBox가 글자를 뽑으면 OCR을 건너뛰고 `isBlank`일 때만 폴백합니다. OCR 폴백은 OpenAI든 Python PaddleOCR 워커든 기본 OFF이고, DB에 영속된 정책 토글로 단계별 allowlist를 통과해야만 켜집니다. URL 추출은 서버가 임의 주소로 나가는 SSRF 표적이라, DNS로 해석한 모든 IP를 검사해 로컬·사설·링크로컬·클라우드 메타데이터·CGNAT·IPv6 ULA를 차단하고, 검증한 IP로만 소켓을 직접 열며, 리다이렉트마다 재검증합니다."
3. **트레이드오프 한 줄**: "고수준 HTTP 클라이언트 대신 소켓을 직접 연 건 DNS rebinding/TOCTOU를 닫기 위해서고, 그 대가로 chunked·리다이렉트·인코딩을 직접 다루는 코드 복잡도를 떠안았습니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 스캔본 PDF(텍스트 레이어 없음)는 어떻게 처리되나요?
PDFBox가 빈 문자열을 반환하므로 `text.isBlank()` 분기로 들어갑니다. 이때 `STAGE_PDF_OCR`이 허용돼 있으면 `openAiClient.extractPdfText`(또는 워커가 켜져 있으면 PaddleOCR 경로)로 OCR하고, 허용 안 됐으면 `qualityStatus="FAILED"` + `fallbackReason="OpenAI fallback disabled and Python worker unavailable."`를 담은 결과를 반환합니다. 예외가 아니라 "실패 상태"로 표현해 비동기 워커가 상태기계에서 처리하게 합니다.
:::

:::details Q2. SSRF를 `isSiteLocalAddress` 하나로 막으면 안 되나요?
부족합니다. 표준 사설망 판정은 `10/8`·`172.16/12`·`192.168/16`만 잡습니다. 클라우드 메타데이터(`169.254.169.254`), CGNAT(`100.64.0.0/10`), IPv6 ULA(`fc00::/7`)는 별도 검사가 필요하고, 특히 메타데이터 IP는 자격증명 탈취로 이어져 가장 위험합니다. 그래서 `isMetadataAddress`/`isCarrierGradeNatAddress`/`isIpv6UniqueLocalAddress`를 따로 두고, 추가로 예약·문서용 대역(`0/8`, `192.0.2/24`, `198.18/15` 등)까지 막습니다.
:::

:::details Q3. DNS rebinding은 어떻게 막나요?
검증 시점에 호스트명을 resolve해 얻은 모든 IP를 검사하고, 실제 연결은 그 검증된 `InetAddress`로 `DirectSocketHttpFetcher`가 **직접** socket.connect합니다. 고수준 클라이언트처럼 연결 직전 호스트명을 다시 resolve하지 않으므로, "검사 때는 안전 IP를 주고 연결 때는 내부 IP로 바꿔치기"하는 rebinding이 무력화됩니다. 리다이렉트의 `Location`도 따라가기 전에 같은 검증을 다시 거칩니다.
:::

:::details Q4. 응답이 무한히 크거나 느리면요?
연결·읽기 타임아웃 5초, 헤더 한 줄 8KB·헤더 누적 64KB·본문 1MB 상한을 둡니다. Content-Length·chunked·close-종료 세 가지 본문 형태 모두 1MB 안에서만 읽고, 추출된 텍스트는 최종적으로 12만 자(`MAX_EXTRACTED_TEXT_LENGTH`)로 절단합니다. 응답 크기와 시간 양쪽을 상한으로 묶어 DoS를 방어합니다.
:::

:::details Q5. OpenAI OCR과 Python 워커 중 무엇이 먼저 쓰이나요?
워커가 켜져 있으면 워커가 우선입니다. `extractFile`은 `aiWorkerClient.extractFile(...).orElseGet(() -> extractFileLocally(...))` 구조라, 워커가 활성이면 그 결과를 쓰고, 비활성(`Optional.empty()`)일 때만 로컬 PDFBox/OpenAI 경로로 내려갑니다. 둘 다 기본 OFF라, 기본 실행에서는 디지털 PDF만 PDFBox로 처리되고 이미지·스캔본은 OCR 정책을 켜야 처리됩니다.
:::

:::details Q6. 왜 추출기가 품질 점수를 직접 매기지 않나요?
관심사 분리입니다. 추출기는 "텍스트를 뽑는다"에만 집중하고, 품질 판정(PASS/REVIEW_REQUIRED/FAILED)은 후단 `ApplicationCaseExtractionQualityGate`(규칙 기반)나 Python 워커의 `meta`가 담당합니다. 이렇게 나눠야 추출 경로를 바꿔도 품질 게이트를 재사용할 수 있고, 워커가 보내준 점수와 로컬 규칙 점수를 같은 자리에 흡수할 수 있습니다.
:::

## 8. 직접 말해보기

아래를 막힘없이 설명할 수 있으면 이 페이지를 이해한 것이다.

- PDF·이미지·URL 각각의 1차 경로와, OCR 폴백이 언제·왜 트리거되는지.
- "디지털 PDF에 OCR을 돌리지 않는" 결정의 비용/정확도 근거.
- SSRF를 막기 위해 차단하는 IP 범주 6가지 이상과, 그중 `169.254.169.254`가 왜 특별히 위험한지.
- 고수준 HTTP 클라이언트 대신 소켓을 직접 연 이유(DNS rebinding/TOCTOU).
- 폴백을 켜려면 통과해야 하는 두 조건(`enabled` + 단계 allowlist)과 DB 영속 토글의 우선순위.

관련 페이지: [공고 원문 저장 · revision](/area-b/job-posting-storage) · [공고 분석 #6~9](/area-b/job-analysis) · [ML 워커](/area-b/ml-worker) · [영역 B 개요](/area-b/)

## 퀴즈

<QuizBox question="디지털(텍스트 레이어가 있는) PDF를 업로드했을 때 기본 동작은?" :choices="['항상 OpenAI OCR로 텍스트를 뽑는다', 'PDFBox로 먼저 뽑고, 비어 있을 때만 OCR 폴백을 시도한다', 'Python 워커가 무조건 PaddleOCR로 처리한다', 'Jsoup으로 PDF를 파싱한다']" :answer="1" explanation="extractFileLocally의 PDF 분기는 PDFBox(PDFTextStripper)로 먼저 추출하고, text.isBlank()일 때만 OCR 폴백 단계가 허용됐는지 확인합니다. 디지털 PDF는 OCR을 건너뜁니다." />

<QuizBox question="URL 추출의 SSRF 방어에서, 표준 '사설망' 판정만으로는 못 막아 별도로 차단하는 대상이 아닌 것은?" :choices="['클라우드 메타데이터 IP 169.254.169.254', 'CGNAT 대역 100.64.0.0/10', 'IPv6 ULA fc00::/7', '공인 IP를 가진 정상 웹사이트']" :answer="3" explanation="메타데이터/CGNAT/IPv6 ULA는 isSiteLocalAddress로는 잡히지 않아 isMetadataAddress·isCarrierGradeNatAddress·isIpv6UniqueLocalAddress로 따로 막습니다. 공인 IP의 정상 웹사이트는 차단 대상이 아니라 허용 대상입니다." />

<QuizBox question="고수준 HTTP 클라이언트 대신 DirectSocketHttpFetcher로 소켓을 직접 연 가장 큰 이유는?" :choices="['속도가 빨라서', '검증한 IP로만 연결해 DNS rebinding/TOCTOU 틈을 닫기 위해', 'PDF를 파싱하려고', 'OpenAI 호출 비용을 줄이려고']" :answer="1" explanation="고수준 클라이언트는 연결 직전 호스트명을 다시 resolve해 검사한 IP와 연결되는 IP가 달라질 수 있습니다. 검증된 InetAddress로 직접 connect하면 그 틈(DNS rebinding)이 닫힙니다." />
