# 음성·영상 미디어 처리

> 면접의 음성·영상은 "원본을 저장하느냐"가 핵심이다. 영역 D는 원본을 거의 저장하지 않고 점수·트랜스크립트(JSON)만 남기며, 파일을 저장해야 할 때만 `file_asset` 메타 + 로컬 디스크로 보관한다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 D의 음성·영상 미디어 처리란 **음성 모의면접·아바타 화상 면접에서 발생하는 오디오/비디오를 "어디에·어떤 형태로 보관하고, 무엇을 버리는가"를 결정하는 저장·메타 계층**이다.

이 페이지가 답하는 면접 질문:

- "사용자 면접 음성/영상은 서버에 저장되나요? 안 한다면 점수는 어떻게 남기죠?"
- "`file_asset` 테이블은 왜 있고, `interview_answer.audio_url`/`video_url`과 어떻게 연결되나요?"
- "저장소는 로컬 디스크인가요 S3인가요? 운영 전환은 어떻게 할 계획인가요?"
- "녹음/녹화 준비 상태(권한·진행률·폴백)는 누가 책임지나요?"

핵심 결론부터: **두 가지 저장 경로가 공존한다.** ① 점수·트랜스크립트만 남기는 `interview_media_analysis`(원본 미저장, 기본 경로), ② 실제 바이트를 보관해야 할 때 쓰는 `file_asset` + 로컬 디스크(부가 경로). ①이 설계의 중심이고 ②는 느슨하게만 연결된다.

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

### 2.1 원본 미저장이 기본값인 이유 (ADR-002/006/007)

면접 음성·영상은 가장 민감한 개인정보다. 이를 서버에 쌓으면 보관·유출·삭제 책임이 무한히 커진다. 그래서 D는 **원본을 저장하지 않는 것을 기본 정책으로 못 박았다.** `interview_media_analysis` 마이그레이션 주석이 그 결정을 명문화한다:

> "ADR-002 — 원본 음성·영상은 서버에 저장하지 않고(온디바이스 분석), 트랜스크립트와 점수(JSON)만 보관한다."

`InterviewMediaService` 클래스 주석도 동일하다: "원본 음성·영상은 받지 않는다 — 온디바이스 분석 결과(트랜스크립트 + 지표 + 점수 JSON)만 저장." 자체 추론 서버 경로(`InterviewNonverbalClient`)도 base64로 받은 오디오를 점수 산출 후 **버린다**("원본 음성은 점수 산출 후 버려진다").

트레이드오프: 원본이 없으니 "나중에 다시 채점"이나 "녹취 재생"은 불가능하다. 대신 트랜스크립트(텍스트)와 지표(JSON)는 남으므로 리포트·복기에는 충분하다. 이 비대칭(텍스트는 남기고 미디어는 버린다)이 의도된 선택이다.

### 2.2 그런데 왜 `file_asset`·`audio_url`/`video_url`이 따로 있나

원본 미저장이 기본이지만, **"파일 저장이 필요한 케이스를 위한 메타 계층"** 도 함께 갖춰 두었다. `file_asset`은 음성/영상/이력서/포트폴리오 등 업로드 파일의 위치·종류를 기록하는 공통 테이블이고, `interview_answer`에는 `audio_url`/`video_url` 컬럼이 있다. 즉 정책은 "원칙적으로 미저장, 필요 시 명시적 업로드"다.

:::warning 정직한 구현 갭 — 두 메커니즘은 느슨하게만 연결된다
`submitAnswer`는 프론트가 보낸 `audioUrl`/`videoUrl` 문자열을 그대로 `interview_answer`에 저장한다(`InterviewServiceImpl.java:341-342`). `file_asset`의 `ref_type=INTERVIEW_ANSWER` / `ref_id` 메커니즘은 스키마에 존재하지만, 답변 저장 흐름이 자동으로 그 링크를 채우지는 않는다. 현재는 "URL을 직접 받아 저장"과 "file_asset 메타"가 **별개로 존재하며 자동 연결은 약하다.**
:::

## 3. 어떤 기술로 구현했나 (실제 클래스 · 테이블 근거)

### 3.1 저장 계층 두 갈래

| 경로 | 무엇을 저장 | 핵심 테이블 | 핵심 클래스 |
|---|---|---|---|
| 분석 결과 저장(기본) | 트랜스크립트 + 지표 + 점수(JSON), **원본 미저장** | `interview_media_analysis` | `InterviewMediaService.save` |
| 파일 바이트 저장(부가) | 실제 오디오/영상 바이트 + 메타 | `file_asset` + 로컬 디스크 | `FileService` / `FileStorageService` |

### 3.2 `interview_media_analysis` 테이블 (patch `20260612_d_interview_media_analysis.sql`)

```sql
CREATE TABLE interview_media_analysis (
    id, interview_session_id,
    kind         VARCHAR(20),  -- VOICE(음성 모의면접) / AVATAR(아바타 화상)
    transcript   JSON,         -- [{"role":"ai|user","text":"..."}]
    metrics      JSON,         -- 말속도·침묵·필러·피치, 표정/자세
    score        INT,          -- 종합 0~100
    score_detail JSON,         -- {"pace":80,"fluency":70,...}
    created_at, ...
    FOREIGN KEY (interview_session_id) REFERENCES interview_session (id) ON DELETE CASCADE
);
```

- **schema.sql 본체에는 없다** — 별도 가드형 패치로 추가했고 `CREATE TABLE IF NOT EXISTS`라 재실행 안전하다.
- 미디어 종류는 `kind` 두 값(`VOICE`/`AVATAR`)으로만 구분하고 **같은 테이블을 공유**한다. `InterviewMediaService`의 `KINDS = Set.of("VOICE", "AVATAR")`가 이를 검증한다.
- 저장 시 `score`는 `0~100` 범위를 강제하고(아니면 `INVALID_INPUT`), `transcript`/`metrics`/`scoreDetail`은 `JsonNode`를 문자열로 직렬화해 JSON 컬럼에 넣는다.

### 3.3 `file_asset` 테이블 (`schema.sql:588-603`) — 공통 미디어 메타

```sql
CREATE TABLE file_asset (
    id, owner_user_id,
    kind         VARCHAR(20),  -- AUDIO/VIDEO/RESUME/PORTFOLIO/POSTING/ATTACHMENT
    ref_type     VARCHAR(30),  -- 연결 대상 종류 (예: INTERVIEW_ANSWER)
    ref_id       BIGINT,       -- 연결 대상 id
    original_name, content_type, size_bytes,
    storage_key  VARCHAR(512), -- 디스크 저장 경로/키 (예: media/12/uuid.webm)
    created_at, ...
);
```

설계 포인트:

- **메타만 저장, 바이트는 디스크.** 테이블 주석이 명시한다: "실제 바이트는 로컬 디스크(`careertuner.uploads.media-dir`)에 저장하고, 본 테이블은 메타만 보관한다."
- **`storage_key`는 상대 경로.** `FileStorageService.store`는 `ownerUserId + "/" + UUID + 확장자` 형태의 상대 키를 만들고, 디스크의 절대 경로는 `mediaDir` 기준으로만 해석한다. 키에 절대 경로나 호스트가 들어가지 않아 저장소 위치를 바꿔도 메타는 그대로 쓸 수 있다.
- **`ref_type`/`ref_id`로 느슨한 다형 연결.** `INTERVIEW_ANSWER` 외에 이력서·포트폴리오 등 다른 도메인도 같은 테이블을 쓴다. `file` 도메인은 공통 영역(팀장 승인 필요)이라 D 단독으로 정책을 바꾸지 않는다.

### 3.4 로컬 디스크 저장소와 S3 자리표시자

저장소 설정은 `FileStorageProperties`에 있고 **현재는 로컬 디스크 한 종류만 구현되어 있다.**

```java
@ConfigurationProperties(prefix = "careertuner.file")
class FileStorageProperties {
    String mediaDir = ".uploads/media";          // 기본 로컬 경로
    long   maxFileSizeBytes = 10L * 1024 * 1024;  // 10MB
}
```

`FileStorageService`가 하는 일:

1. 크기 한도 검사(`maxFileSizeBytes`) → 초과 시 `INVALID_INPUT`.
2. `UUID` 파일명 + content-type 기반 확장자 결정(`audio/webm→.webm`, `video/mp4→.mp4` 등).
3. `Files.write`로 `mediaDir` 하위에 기록.
4. **경로 탈출 방어:** `resolve`가 정규화 후 `target.startsWith(base)`를 확인해 `mediaDir` 밖을 가리키는 키(`../` 등)를 거부한다.

:::tip S3는 "자리표시자" — 인터페이스 추상화가 먼저
현재 저장 백엔드는 **로컬 디스크 단일 구현**이다. `storage_key`를 "경로/키"로 두고(S3 객체 키와 형태가 호환), 위치 결정을 `FileStorageProperties.mediaDir` 한 곳으로 모아 둔 것이 S3 전환의 발판이다. 즉 운영 전환 시 `FileStorageService`의 read/store 구현만 객체 스토리지로 바꾸면 메타 스키마(`file_asset`)는 손대지 않아도 되도록 설계의 결을 맞춰 두었다. **단, S3 클라이언트 코드 자체는 아직 없다(계획).**
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 두 흐름을 한 그림으로

```text
[A] 분석 결과만 저장 (기본 경로 · 원본 미저장)
브라우저 녹음(webm)
  → 온디바이스 분석(Web Audio/MediaPipe) 또는 base64로 자체 서버 전송
  → 점수+트랜스크립트+지표(JSON)만 산출
  → POST /sessions/{id}/media-results
  → InterviewMediaService.save → interview_media_analysis INSERT
  → (원본 webm 은 버려짐)

[B] 파일 바이트 저장 (부가 경로 · 명시적 업로드)
브라우저 Blob
  → POST /api/file/upload (multipart)
  → FileStorageService.store → 로컬 디스크 write + file_asset INSERT
  → 재생 시 GET /api/file/{id}/content (인증 헤더 + object URL)
```

### 4.2 자체 추론 서버로 보낼 때도 원본은 안 남는다

베이직 음성/아바타 채점은 원본을 base64로 **자체 추론 서버에만** 보내고, 서버가 ffmpeg 변환·피처 추출·점수 산출 후 버린다. `InterviewNonverbalClient`가 그 클라이언트다.

```java
// 음성 채점 — base64 + 보조 지표를 POST, 점수만 돌려받는다
body.put("audio_base64", audioBase64);
body.put("audio_format", "webm");   // null 이면 webm
body.put("transcript_chars", ...);  // 말속도 계산용
body.put("filler_count", ...);
JsonNode root = post(serveUrl + "/score/voice-base64", body);
// → score / detail / metrics / source("rule" 또는 모델)
```

- 엔드포인트 3종: `/score/voice-base64`(음성), `/score/avatar-base64`(음성+영상 late fusion), `/transcribe`(자체 STT, faster-whisper로 OpenAI Whisper API 대체).
- 서버 base URL은 `careertuner.interview.nonverbal.serve-url`(로컬 기본 `127.0.0.1:8500`), 사용 여부는 `enabled` 토글. 미기동이면 호출은 실패하고 프론트는 브라우저 온디바이스 점수로 폴백한다.

### 4.3 미디어 URL이 답변에 실리는 경로

```java
// InterviewServiceImpl.submitAnswer (발췌)
InterviewAnswer answer = InterviewAnswer.builder()
    .answerText(request.answerText())
    .audioUrl(blankToNull(request.audioUrl()))   // 프론트가 준 URL 그대로
    .videoUrl(blankToNull(request.videoUrl()))   // 없으면 null
    .score(evaluation.score())
    ...
```

즉 `audio_url`/`video_url`은 **선택적**이고, 값이 있으면 그대로 저장한다. 보통 음성/영상 면접은 [A] 경로(점수만 저장)를 타므로 이 두 컬럼은 비어 있는 경우가 많다.

### 4.4 다운로드는 왜 envelope를 우회하나

업로드한 파일을 재생할 때는 `GET /api/file/{id}/content`로 **바이너리를 직접** 받는다. 이 응답은 `ApiResponse<T>` envelope가 아니므로 프론트는 공용 `api()` 래퍼를 우회해 수동으로 `Authorization` 헤더를 붙이고, `URL.createObjectURL`로 재생용 URL을 만든 뒤 사용 후 `URL.revokeObjectURL`로 해제해야 한다(`fetchFileObjectUrl`).

| 항목 | 일반 API(`api()`) | 파일 다운로드(`fetchFileObjectUrl`) |
|---|---|---|
| 응답 형태 | `ApiResponse<T>` JSON | 바이너리(blob) |
| envelope | 적용 | 미적용 → 직접 `fetch` |
| 메모리 관리 | 불필요 | `revokeObjectURL` 필수 |

## 5. 구현 상태 — 됨 vs 계획 (정직 구분)

| 항목 | 상태 | 근거 |
|---|---|---|
| `interview_media_analysis` 점수/트랜스크립트 저장 | 구현됨 | `InterviewMediaService.save`, patch `20260612` |
| 원본 음성·영상 미저장(ADR-002) | 구현됨 | 마이그레이션 주석 + 서비스 주석, 자체 서버도 산출 후 폐기 |
| `file_asset` 메타 + 로컬 디스크 업로드/다운로드 | 구현됨 | `FileService`/`FileStorageService`, `/api/file/**` |
| 경로 탈출 방어 · 크기 한도(10MB) | 구현됨 | `resolve` `startsWith` 검사, `maxFileSizeBytes` |
| 자체 추론 서버(음성/영상/STT) 클라이언트 | 구현됨 | `InterviewNonverbalClient` (기본 enabled, 서버 미기동 시 폴백) |
| 온디바이스 음성/영상 분석(프론트) | 구현됨 | `voiceAnalysis.ts`/`visualAnalysis.ts` |
| **S3 등 객체 스토리지 백엔드** | **계획** | `FileStorageService`는 로컬 디스크 단일 구현, S3 클라이언트 없음 |
| **`file_asset` ↔ `interview_answer` 자동 연결** | **느슨/부분** | `submitAnswer`는 URL 문자열만 저장, `ref_type`/`ref_id` 자동 채움 없음 |
| 음성/영상 URL 컬럼(`audio_url`/`video_url`) | 구현됨(선택적) | 보통 비어 있음(점수만 저장 경로가 기본) |

:::warning 추측 금지 — 실제로 확인된 사실만
"S3로 저장된다"는 말은 **틀렸다.** 현재는 로컬 디스크뿐이고 S3는 인터페이스 결만 맞춰 둔 자리표시자 수준이다. 또 "면접 녹음이 서버에 보관된다"도 틀렸다 — 기본 경로는 원본을 버린다. 면접에서 이 둘을 단정하지 말 것.
:::

## 6. 면접 답변 3단계

**1단계 (한 문장):** "면접 미디어는 원본을 거의 저장하지 않고 점수·트랜스크립트(JSON)만 `interview_media_analysis`에 남기며, 파일 바이트가 필요할 때만 `file_asset` 메타 + 로컬 디스크로 보관합니다."

**2단계 (왜·어떻게):** "음성·영상은 가장 민감한 개인정보라 ADR-002에서 원본 미저장을 기본 정책으로 정했습니다. 온디바이스 또는 자체 추론 서버가 점수·전사만 만들고 원본은 버립니다. 저장이 필요한 케이스를 위해 `file_asset`이라는 공통 메타 테이블과 로컬 디스크 저장소(`FileStorageService`)를 갖췄고, `storage_key`를 상대 경로로 두고 위치 결정을 한 곳(`FileStorageProperties.mediaDir`)에 모아 객체 스토리지 전환 발판을 마련했습니다."

**3단계 (한계·계획):** "다만 정직히 말하면 S3 백엔드는 아직 자리표시자라 로컬 디스크 단일 구현이고, `file_asset`과 답변(`interview_answer.audio_url`)의 자동 연결은 느슨합니다. 운영 전환 시 `FileStorageService` 구현만 교체하면 메타 스키마는 유지되도록 추상화해 둔 상태입니다."

## 7. 꼬리질문 + 모범답안

::: details Q1. 원본 음성을 저장하지 않으면 채점은 어떻게 신뢰하나요?
온디바이스(또는 자체 서버)가 **원본을 보는 순간에 지표를 추출**합니다. 말속도·침묵·필러·피치 같은 음성 지표(`VoiceMetricsTracker`)와 트랜스크립트를 만들고, 그 JSON만 `interview_media_analysis.metrics`/`transcript`/`score_detail`에 남깁니다. 채점은 원본 재생이 아니라 이 지표 + 내용 채점(LLM)으로 이뤄지므로 원본 보관 없이도 재현 가능한 근거가 남습니다. 단 "사후 재채점"은 원본이 없어 불가능하다는 트레이드오프를 인정합니다.
:::

::: details Q2. `interview_media_analysis`와 `file_asset`은 무엇이 다른가요?
전자는 **분석 결과(점수·트랜스크립트·지표 JSON)** 를 담고 원본 바이트는 없습니다. 후자는 **실제 업로드된 파일의 메타**(소유자·종류·크기·`storage_key`)를 담고 바이트는 로컬 디스크에 있습니다. 전자는 면접 세션에 `ON DELETE CASCADE`로 종속되고, 후자는 `ref_type`/`ref_id`로 다양한 도메인을 느슨하게 가리키는 공통 테이블입니다. 기본 면접 흐름은 전자만 쓰고, 후자는 명시적 파일 업로드가 있을 때만 쓰입니다.
:::

::: details Q3. 저장소가 로컬 디스크인데 S3 전환은 어떻게 하나요?
전환 비용을 줄이려고 세 가지를 미리 맞췄습니다. ① `storage_key`를 절대 경로가 아닌 상대 "경로/키"(예 `media/12/uuid.webm`)로 둬 S3 객체 키와 형태가 호환됩니다. ② 위치 결정을 `FileStorageProperties.mediaDir` 한 곳으로 모았습니다. ③ 읽기/쓰기를 `FileStorageService`가 캡슐화합니다. 그래서 객체 스토리지로 갈 때 이 서비스 구현만 바꾸면 되고 `file_asset` 스키마와 호출부는 그대로입니다. 다만 **S3 클라이언트 코드는 아직 없는 계획 단계**임을 명확히 합니다.
:::

::: details Q4. 업로드 파일 크기·경로 보안은 어떻게 막나요?
크기는 `FileStorageProperties.maxFileSizeBytes`(기본 10MB)로 제한하며, multipart 한도(`SPRING_SERVLET_MULTIPART_MAX_FILE_SIZE`)도 함께 영향을 줍니다. 경로는 `FileStorageService.resolve`가 키를 정규화한 뒤 `target.startsWith(base)`로 `mediaDir` 밖을 가리키는지 검사해 `../` 같은 디렉터리 탈출을 차단합니다. 다운로드 시에는 `FileService.download`가 `ownerUserId` 일치를 확인해 남의 파일 접근을 막고, `FileController`는 `Content-Disposition` 파일명에서 따옴표·개행을 제거해 헤더 인젝션을 방어합니다.
:::

::: details Q5. 파일 다운로드는 왜 공용 API 래퍼를 못 쓰나요?
`/api/file/{id}/content`는 바이너리를 직접 반환해 `ApiResponse<T>` envelope를 쓰지 않기 때문입니다. 공용 `api()`는 envelope의 `data`를 풀어 반환하도록 만들어졌으므로 바이너리에는 맞지 않습니다. 그래서 프론트는 `fetchFileObjectUrl`에서 직접 `fetch`로 `Authorization` 헤더를 붙여 blob을 받고 `URL.createObjectURL`로 재생 URL을 만든 뒤, 누수를 막기 위해 사용 후 `URL.revokeObjectURL`로 해제합니다.
:::

::: details Q6. `audio_url`/`video_url` 컬럼은 보통 채워지나요?
대개 비어 있습니다. 음성/영상 면접의 기본 경로는 점수·트랜스크립트만 남기는 [A] 경로라 원본 URL이 없습니다. `submitAnswer`는 프론트가 `audioUrl`/`videoUrl`을 명시적으로 보낼 때만 그 문자열을 그대로 저장하고, 없으면 `null`입니다. 그리고 이 URL과 `file_asset`의 자동 연결은 약하다는 점도 함께 설명할 수 있어야 합니다.
:::

## 8. 직접 말해보기

다음을 막힘없이 1~2분으로 설명할 수 있으면 이 주제를 이해한 것이다.

1. "원본 미저장(ADR-002)이 기본이고, 점수·트랜스크립트만 `interview_media_analysis`에 남는다"를 흐름 그림으로.
2. `file_asset`이 **메타만** 저장하고 바이트는 로컬 디스크에 있다는 사실 + `storage_key`가 상대 경로인 이유.
3. S3가 왜 "자리표시자"인지 — 무엇은 맞춰 뒀고(상대 키·`mediaDir` 단일화·`FileStorageService` 캡슐화) 무엇은 아직 없는지(S3 클라이언트).
4. 다운로드가 envelope를 우회하는 이유와 `revokeObjectURL`까지.
5. `audio_url`/`video_url`이 보통 비어 있고 `file_asset` 연결이 느슨하다는 한계를 정직하게.

관련 페이지: [면접 AI 개요](/ai/interview-ai) · [공통 구조화 출력](/ai/openai-structured-output) · [JWT 보안](/backend/jwt-security) · [영역 C](/area-c/)

## 퀴즈

<QuizBox question="기본 면접 흐름에서 사용자의 음성·영상 원본은 어떻게 처리되나요?" :choices="['모두 file_asset 테이블에 저장된다', '서버에 저장하지 않고 점수·트랜스크립트(JSON)만 남긴다', 'S3 버킷에 암호화 후 영구 보관된다', 'interview_answer.audio_url 에 base64 로 통째로 저장된다']" :answer="1" explanation="ADR-002 정책상 원본은 저장하지 않고 온디바이스/자체 서버가 점수·트랜스크립트만 interview_media_analysis 에 남긴다. file_asset 은 명시적 파일 업로드가 있을 때만 쓰는 부가 경로다." />

<QuizBox question="file_asset 테이블의 storage_key 와 실제 파일 바이트에 대한 설명으로 옳은 것은?" :choices="['storage_key 에 파일 바이트가 base64 로 들어 있다', '바이트는 S3 에 있고 storage_key 는 객체 ARN 이다', '바이트는 로컬 디스크(mediaDir)에 있고 storage_key 는 상대 경로다', '바이트와 메타가 모두 interview_media_analysis 에 있다']" :answer="2" explanation="file_asset 은 메타만 저장하고 바이트는 로컬 디스크에 둔다. storage_key 는 ownerUserId/uuid.ext 형태의 상대 경로라 저장소 위치를 바꿔도 메타는 유지된다. S3 는 아직 자리표시자다." />

<QuizBox question="파일 다운로드(fetchFileObjectUrl)가 공용 api() 래퍼를 우회하는 이유는?" :choices="['속도가 더 빨라서', '응답이 ApiResponse envelope 가 아닌 바이너리라서', '인증이 필요 없어서', 'CORS 를 피하려고']" :answer="1" explanation="/api/file/{id}/content 는 바이너리를 직접 반환해 ApiResponse envelope 를 쓰지 않는다. 그래서 직접 fetch 로 Authorization 을 붙이고 createObjectURL 로 재생 URL 을 만든 뒤 revokeObjectURL 로 해제해야 한다." />
