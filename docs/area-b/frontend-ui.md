# B 프론트엔드 UI/UX

> 지원 건 상세는 "탭 1개 = 데이터 1종"으로 쪼개 필요한 것만 페치하고, AI 실행은 프런트가 직접 트리거하지 않는다 — 추출·검수 통과가 백엔드 자동 파이프라인을 깨우는 단일 진실원이다.

## 1. 한 줄 정의 · 이 페이지가 답하는 면접 질문

영역 B의 프런트엔드는 **지원 건(Application Case) 하나를 5개 탭(개요/공고문/공고 분석/기업 분석/적합도)으로 쪼개 보여주는 상세 허브**와, **3단계 위저드로 새 지원 건을 만드는 등록 흐름**으로 이뤄진다. 이 페이지가 답하는 면접 질문은 다음과 같다.

- "느린 AI 분석·OCR 추출을 프런트에서 어떻게 다뤘나? 사용자가 화면을 떠나도 진행 상태를 어떻게 보장했나?"
- "공고문을 수정했을 때 OCR을 다시 돌릴지(재추출), 분석만 갱신할지(검수 확정)를 누가 어떻게 판정하나?"
- "공고가 바뀌었는데 분석이 옛 버전 기준일 때(stale) 사용자에게 어떻게 알리나?"
- "AI 실패 메시지에 SQL이나 스택트레이스가 섞여 들어오면 사용자에게 그대로 노출되나?"

코드 기준 핵심 파일: `pages/ApplicationDetailPage.tsx`(상세 허브), `pages/NewApplicationPage.tsx`(3단계 위저드), `components/JobPostingPanel.tsx`·`JobAnalysisPanel.tsx`·`CompanyAnalysisPanel.tsx`·`ApplicationOverviewPanel.tsx`(B 패널 4종).

## 2. 왜 이렇게 설계했나 (의도 · 트레이드오프)

이 화면은 "AI가 느리고, 비동기이고, 가끔 실패한다"는 전제를 UI 전반에 박아 넣은 설계다. 핵심 결정 4가지.

| 결정 | 의도 | 트레이드오프 |
| --- | --- | --- |
| **분석 실행의 단일 진실원 = 백엔드 자동 파이프라인** | 프런트가 `createJobAnalysis`를 직접 호출하지 않고, 추출/검수 통과만 트리거로 쓴다. 분석 생성 로직이 두 곳에 흩어지지 않음 | 위저드가 "분석 결과 보기" 버튼으로도 분석을 시작할 수 없다. 등록 직후엔 분석이 비어 있을 수 있어 안내 문구가 필요 |
| **탭별 데이터 페치 게이팅** | 활성 탭에 맞는 hook만 `enabled`로 켜서 불필요한 호출을 차단 | 탭 전환마다 페치가 새로 일어나 짧은 로딩 스켈레톤이 보일 수 있음 |
| **전역 추출 모니터 + localStorage 브리지** | 화면을 떠나도 추출 진행/완료 토스트가 따라옴 | 폴링이 늘어남(4초 주기). stuck 잡 방어 코드를 따로 둬야 함 |
| **저장 라우팅을 순수 헬퍼로 공유** | "본문만 수정→confirm" vs "소스 변경→재추출" 판정 로직을 패널과 페이지가 동일하게 사용 | 판정 조건이 추출 상태(`qualityStatus`)에 강하게 묶여, 상태 모델이 바뀌면 헬퍼도 같이 바꿔야 함 |

특히 두 번째 결정의 구현이 `ApplicationDetailPage`의 `needs*` 플래그다. `activeTab`에 따라 `needsExtraction`, `needsJobPosting`, `needsJobAnalysis` 등을 계산하고, 그 boolean을 각 hook의 `enabled` 인자로 그대로 넘긴다.

```ts
// ApplicationDetailPage.tsx (요지)
const needsExtraction   = detailDataEnabled && (activeTab === "overview" || activeTab === "posting");
const needsJobPosting   = detailDataEnabled && (activeTab === "posting" || activeTab === "jobAnalysis" || activeTab === "companyAnalysis");
const needsJobAnalysis  = detailDataEnabled && activeTab === "jobAnalysis";
const needsCompanyAnalysis = detailDataEnabled && activeTab === "companyAnalysis";
const needsBFailureLogs = needsJobAnalysis || needsCompanyAnalysis;
```

공고분석/기업분석 탭에서만 `needsJobPosting`이 켜지는 이유는, 두 탭이 "최신 공고 revision"을 알아야 stale 여부를 판정할 수 있기 때문이다(§4.4).

## 3. 어떤 기술로 구현했나 (실제 클래스 · 라우팅 근거)

- **스택**: React 18 + React Router(`react-router`) + TypeScript + Tailwind v4. UI 프리미티브는 shadcn 계열(`Button`/`Card`/`Input`/`Textarea`/`Select`/`Checkbox`/`AlertDialog`/`Badge`), 아이콘은 `lucide-react`.
- **라우팅(`app/routes.ts`)**: 상세는 3중 라우트가 같은 컴포넌트에 매핑된다.

  | path | 의미 |
  | --- | --- |
  | `applications/:id` | 기본(개요) |
  | `applications/:id/:section` | 탭 진입(`posting`/`job-analysis`/`company-analysis`/`fit`) |
  | `applications/:id/:section/:mode` | 분석 탭의 `edit` 모드 |

  탭 키는 `overview \| posting \| jobAnalysis \| companyAnalysis \| fit`, URL slug는 `overview/posting/job-analysis/company-analysis/fit`. **view/edit 모드 분리는 공고분석·기업분석 탭에만 존재**한다(`isBAnalysisTab` + `detailPath()`가 `/edit` 접미사를 붙임). 잘못된 slug나 view 모드인데 `/edit`가 붙은 URL은 `useEffect`가 `navigate(..., { replace: true })`로 교정한다.
- **B 패널 4종**(`components/`): `ApplicationOverviewPanel`, `JobPostingPanel`, `JobAnalysisPanel`, `CompanyAnalysisPanel`. (적합도 탭의 `FitAnalysisPanel`/`StrategyPanel`/`LearningRecommendationPanel`은 영역 C 소유이고, B 패널과 같은 `features/applications/` 폴더를 공유하지만 컴포넌트 단위로 소유권이 갈린다.)
- **공유 소형 컴포넌트**: `ApplicationExtractionBadge`(추출 상태 + 품질 배지), `AnalysisFailureNotice`(실패 메시지 마스킹), `AnalysisStructuredText`(JSON/텍스트 자동 분기 렌더), `StructuredRowsEditor`(제네릭 행 편집기).
- **순수 헬퍼(`utils/jobPostingConfirm.ts`)**: `hasPostingSourceChange`, `isConfirmableTextCorrection`, `shouldDisableSaveForReview`, `currentPostingText`, `requestPostingText` — 저장 라우팅 판정을 패널과 페이지가 공유.

:::tip
**`features/applications/`는 B·C 공유 폴더다.** 면접에서 "B만 만든 컴포넌트"를 물으면 위 4종 패널과 위저드/상세 페이지로 답하고, 적합도(fit) 탭 컴포넌트는 C 소유라고 정직히 구분하라.
:::

## 4. 동작 원리 (흐름 · 표 · 작은 코드)

### 4.1 상세 페이지의 탭 오케스트레이션

`ApplicationDetailPage`는 자체로 데이터를 그리지 않고, hook들을 모아 패널에 주입하는 오케스트레이터다. 한 화면에서 도는 hook은 `useApplicationCase`, `useApplicationCases`(사이드바), `useJobPosting`, `useApplicationCaseExtraction`, `useJobAnalysis`, `useCompanyAnalysis`, `useBAnalysisFailureLogs`이며, 각각 §2의 `needs*` 플래그로 켜고 끈다.

추출이 끝난 직후 자동 반영도 여기서 처리한다. `extraction.status === "SUCCEEDED"`가 되면 **그 추출 id를 `refreshedExtractionIdRef`에 한 번만 기록**하고 `refresh()` + `refreshPosting()`을 호출해, 같은 추출에 대해 무한 새로고침이 일어나지 않게 막는다.

### 4.2 새 지원 건 위저드 (3단계, 업로드/추출중 UX의 핵심)

`NewApplicationPage`는 0→1→2 위저드다.

| Step | 화면 | 핵심 동작 |
| --- | --- | --- |
| 0 등록 | 소스 5종(TEXT/PDF/IMAGE/URL/MANUAL) 선택 + 입력 | "공고문 추출 시작" = **지원 건 생성**. 파일은 `validateJobPostingFile`, URL은 `isHttpPostingUrl`로 선검증 |
| 1 추출 확인 + 정보 확인 | 추출 상태에 따라 3분기 | active → 진행 스피너("이 화면을 나가도 추출은 계속 진행"), FAILED → 실패 + 다시 추출, 그 외 → 공고문/기업명/직무명/마감일 확인 폼 |
| 2 결과 안내 | 분석 자동 생성 안내 + 탭 이동 | 분석을 직접 호출하지 않고 `job-analysis`(또는 체크 시 `company-analysis`) 탭으로 이동만 |

Step 1의 진행 상태는 **3초 폴링**으로 갱신한다(`EXTRACTION_POLL_INTERVAL_MS = 3000`). 폴링은 `extractionPollInFlightRef`로 중복 호출을 막고, `SUCCEEDED`가 되면 최신 케이스+공고를 다시 받아 폼에 채운다. 등록 메타데이터(회사명/직무명/마감일)는 추출 성공 시 백엔드가 추출한 값으로 폼을 프리필한다.

```ts
// NewApplicationPage.tsx — Step1 분기 (요지)
{extractionJob && extractionActive ? (
  <ExtractionProgressState ... />        // 진행 스피너 + "나가도 계속됨"
) : extractionJob?.status === "FAILED" ? (
  <ExtractionFailureState ... />         // 실패 + 다시 추출
) : (
  /* 공고문/기본정보 확인 폼 + 검수 배너 */
)}
```

위저드가 분석을 직접 만들지 않는다는 사실은 코드 주석으로도 못 박혀 있다 — "분석 실행의 단일 진실원은 백엔드 자동 파이프라인이다. ... 프런트는 `createJobAnalysis` 등을 직접 호출하지 않는다."

### 4.3 공고문 저장의 3분기 라우팅 (재추출 vs 검수 확정 vs no-op)

`JobPostingPanel`의 저장 버튼이 만들 요청을 `ApplicationDetailPage.handleSavePosting`이 받아, `utils/jobPostingConfirm.ts`의 순수 헬퍼로 분기한다.

| 조건 | 결과 |
| --- | --- |
| 소스/URL·본문 모두 변경 없음 | **no-op** (새 revision·재추출을 만들지 않음) |
| 추출 PASS + 소스/URL 변경 없이 본문만 수정 (`isConfirmableTextCorrection`) | **confirm** — OCR 재실행 없이 수정 텍스트 기준으로 분석만 갱신 |
| 소스 종류 또는 URL/파일 참조 변경 (`hasPostingSourceChange`) | **재추출 큐잉** — 새 추출 작업 시작 |

같은 판정을 패널 쪽에서도 써서 버튼 상태를 미리 정한다. REVIEW_REQUIRED인데 소스/URL 변경이 없으면(`shouldDisableSaveForReview`) 일반 저장 버튼을 disabled로 만들고 "검수 확정" 버튼으로 사용자를 유도한다. 두 곳이 같은 헬퍼를 공유하므로 "버튼이 활성인데 막상 저장하면 다르게 동작하는" 불일치가 생기지 않는다.

```ts
// jobPostingConfirm.ts (요지)
export function isConfirmableTextCorrection({ request, jobPosting, extraction }) {
  if (!extraction) return false;
  return extraction.status === "SUCCEEDED"
      && extraction.qualityStatus === "PASS"
      && !hasPostingSourceChange(request, jobPosting)
      && requestPostingText(request) !== currentPostingText(jobPosting);
}
```

### 4.4 stale 판정 — "이전 공고 rev 기준" 배지

`JobAnalysisPanel`/`CompanyAnalysisPanel`은 분석이 어느 공고 revision 기준인지(`analysis.jobPostingRevision`)와 최신 공고 revision(`latestJobPostingRevision`)을 비교한다.

```ts
const isStale = Boolean(
  analysis &&
  latestJobPostingRevision !== null &&
  analysis.jobPostingRevision !== latestJobPostingRevision,
);
```

stale이면 카드 제목 옆에 "이전 공고 rev 기준" 배지가 뜨고, "현재 분석은 공고 rev N 기준입니다. 최신 공고 rev M 기준으로 다시 분석할 수 있습니다"라는 배너 + "최신 공고로 재분석" 버튼이 나온다. 이 화면은 백엔드가 **분석 시점에 공고 revision을 동결**한다는 데이터 모델 위에서만 성립한다 — 자세한 동결 메커니즘은 [공고문 저장 모델](/area-b/job-posting-storage)과 [공고 분석](/area-b/job-analysis) 참고.

### 4.5 사실 vs 추론 2분할 UI (#10의 프런트 구현)

`CompanyAnalysisPanel`은 백엔드가 별 컬럼으로 분리한 `verifiedFacts`(검증된 사실)와 `aiInferences`(AI 추론)를 **좌우 2분할 카드**로 렌더한다(`AnalysisStructuredText` 2개). 환각 차단의 데이터 모델이 그대로 UI 대칭으로 드러난다. 출처 메타(`sourceType`/`checkedAt`/`refreshRecommendedAt`)는 값이 있는 것만 필터해 보여준다(`sourceMetadata.filter(Boolean)`).

### 4.6 견고한 JSON ↔ 텍스트 흡수

백엔드 JSON 컬럼(`requiredSkills`/`evidence`/`verifiedFacts` 등)은 형태가 가변이다. 프런트는 `types/analysis.ts`의 파서로 이를 흡수한다.

- `parseJsonStringArray` → 칩(`SkillList`/`JsonList`) 렌더
- `parseJsonArrayOrText`(`AnalysisStructuredText`) → `list`/`text`/`empty` 3분기 렌더
- `parseEvidenceRows`/`parseAmbiguousConditionRows`/`parseVerifiedFactRows`/`parseAiInferenceRows` → `StructuredRowsEditor`의 행 편집
- 편집 후 `serialize*`로 다시 직렬화해 `reviewJobAnalysis`/`reviewCompanyAnalysis`로 전송

`edit` 모드 폼은 스킬을 "한 줄에 하나씩" 텍스트로 받고 `serializeTextareaList`로 배열화하며, 근거/모호조건/사실/추론은 `StructuredRowsEditor`(제네릭 2열 행 편집기)로 다룬다. 행을 실제로 건드렸을 때만(`structuredFieldEdited`) 직렬화해 보내, 안 만진 필드를 `undefined`로 남겨 **null이면 기존값 유지**하는 백엔드 부분 갱신과 맞춘다.

### 4.7 실패 메시지 마스킹 (`AnalysisFailureNotice`)

분석 탭은 `useBAnalysisFailureLogs`로 "이후 같은 feature 성공이 없는 실패"를 받아 배너로 띄운다. `AnalysisFailureNotice`는 원본 메시지를 그대로 쓰지 않는다.

```ts
function isTechnicalMessage(message) {
  const lower = message.toLowerCase();
  return lower.includes("### error") || lower.includes("sql:")
      || lower.includes("com.mysql") || lower.includes("org.springframework")
      || lower.includes("statement cancelled") || lower.includes("timeoutexception");
}
// 300자 초과 또는 기술 문자열 포함이면 → 일반 안내 문구로 치환
```

즉 SQL/`com.mysql`/`org.springframework`/Timeout 등이 섞이거나 메시지가 300자를 넘으면, feature별 일반 문구("공고 분석 처리 중 오류가 발생했습니다...")로 마스킹한다. 백엔드의 에러 마스킹과 프런트의 마스킹이 2중으로 겹친다.

### 4.8 전역 추출 모니터 + stuck 방어

`ApplicationExtractionMonitor`는 `Root.tsx`에 전역 마운트되어 **4초 주기**로 활성 추출을 폴링한다(`POLL_INTERVAL_MS = 4000`). `applicationExtractionTracker`(CustomEvent + localStorage)와 연동해, 사용자가 상세/위저드를 떠나도 진행/완료/실패 토스트를 보장한다. 백엔드가 stuck된 잡을 계속 active로 반환하면 토스트가 영영 안 닫혀 화면을 막을 수 있으므로, **180초(`STUCK_LOADING_TIMEOUT_MS`)를 넘겨 active가 지속되면 토스트를 닫고 억제**한다(active가 0이 되면 억제 해제). 폴링 주기는 흐름별로 일관 — 3초(단건 추출/위저드), 5초(목록), 4초(전역 모니터).

## 5. 구현 상태 (됨 vs 계획) 정직 구분

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 5탭 상세 + view/edit 모드(분석 탭만) | 구현 | `ApplicationDetailPage`, `detailPath()` |
| 탭별 데이터 페치 게이팅 | 구현 | `needs*` 플래그 → hook `enabled` |
| 3단계 위저드 + 추출 3분기 + 3초 폴링 | 구현 | `NewApplicationPage` |
| 공고 저장 3분기(no-op/confirm/재추출) | 구현 | `utils/jobPostingConfirm.ts` 공유 헬퍼 |
| stale "이전 공고 rev" 배지 + 재분석 배너 | 구현 | 두 분석 패널의 `isStale` |
| 사실/추론 2분할 UI | 구현 | `CompanyAnalysisPanel` |
| 실패 메시지 마스킹 | 구현 | `AnalysisFailureNotice.isTechnicalMessage` |
| 전역 추출 모니터 + stuck 타임아웃 | 구현 | `ApplicationExtractionMonitor`, `Root.tsx` |
| 적합도(fit) 탭 패널 | **C 소유** | `FitAnalysisPanel` 등, 같은 폴더지만 영역 C |
| 개요의 첨삭 카드 | **비활성(준비 중)** | "첨삭 API 준비 중. ... 실행 기능은 비활성화" 안내 |
| 프런트에서 분석 직접 실행 | **의도적 미구현** | 단일 진실원은 백엔드 자동 파이프라인 |

:::warning
"AI 분석 실행" 버튼이 패널에 있지만, 이건 **재생성(재분석)** 트리거다. 최초 분석은 추출/검수 통과 시 백엔드 자동 파이프라인이 만든다. "버튼이 있으니 프런트가 분석을 시작한다"고 답하면 단일 진실원 설계를 잘못 설명하는 것이다.
:::

## 6. 면접 답변 3단계

1. **무엇 (10초)**: "B 프런트는 지원 건 하나를 개요/공고문/공고 분석/기업 분석/적합도 5탭으로 보여주는 상세 허브와, 소스 5종을 받는 3단계 등록 위저드로 구성됩니다. AI가 느리고 비동기라는 전제를 UI 전반에 반영했습니다."
2. **어떻게 (30초)**: "탭별로 필요한 hook만 `enabled`로 켜 불필요한 페치를 막고, 추출은 3~4초 폴링으로 진행을 보여줍니다. 공고문 저장은 순수 헬퍼로 '본문만 수정→분석만 갱신(confirm)'과 '소스 변경→재추출'을 판정해 패널·페이지가 동일 로직을 공유합니다. 분석이 옛 공고 revision 기준이면 stale 배지로 재분석을 유도하고, 기업 분석은 검증된 사실과 AI 추론을 2분할로 분리해 보여줍니다."
3. **왜 (20초)**: "분석 실행을 프런트가 직접 트리거하지 않고 추출/검수 통과만 트리거로 쓴 건, 생성 로직을 백엔드 자동 파이프라인 한 곳으로 모아 일관성을 지키기 위해서입니다. 전역 추출 모니터는 화면을 떠나도 진행을 따라오게 하고, stuck 잡이 토스트를 영영 막지 않도록 180초 타임아웃 방어를 뒀습니다. 실패 메시지는 SQL/스택트레이스가 섞이면 일반 문구로 마스킹합니다."

## 7. 꼬리질문 + 모범답안

:::details Q1. 사용자가 추출 진행 중에 다른 페이지로 이동하면 진행 상태는 어떻게 되나?
`ApplicationExtractionMonitor`가 `Root.tsx`에 전역 마운트되어 4초 주기로 활성 추출을 폴링합니다. 진행 중이면 로딩 토스트가, 완료/실패면 결과 토스트가 어느 화면에서든 뜹니다. 상태는 `applicationExtractionTracker`(CustomEvent + localStorage)로 브리지되어 탭을 새로 열어도 추적이 이어집니다. 다만 백엔드가 stuck 잡을 계속 active로 반환하면 토스트가 안 닫힐 수 있어, 180초를 넘기면 토스트를 닫고 억제하는 방어를 뒀습니다.
:::

:::details Q2. PASS 상태에서 공고문 본문만 고쳤는데 OCR을 다시 안 돌리는 이유는?
이미 품질 게이트를 통과(PASS)한 텍스트를 사람이 손본 것이므로, 재추출은 토큰·시간만 낭비합니다. `isConfirmableTextCorrection`이 'PASS + 소스/URL 변경 없음 + 본문만 변경'을 판정하면 `confirm` 경로로 보내 OCR 없이 분석만 1회 갱신합니다. 반대로 소스 종류나 URL/파일 참조가 바뀌면(`hasPostingSourceChange`) 새 추출이 필요하므로 재추출 큐잉 경로로 갑니다. 이 판정을 패널 버튼 상태와 페이지 라우팅이 같은 헬퍼로 공유해 불일치를 막습니다.
:::

:::details Q3. stale 판정은 정확히 무엇을 비교하나?
분석 레코드에 동결된 `jobPostingRevision`과, 현재 최신 공고의 `revision`(`latestJobPostingRevision`)을 비교합니다. 다르면 분석이 옛 공고 기준이라는 뜻이라 "이전 공고 rev 기준" 배지와 "최신 공고로 재분석" 배너를 띄웁니다. 이게 가능한 건 백엔드가 공고를 append-only revision으로 쌓고 분석 시점에 그 revision을 동결하기 때문입니다. 프런트는 그 두 숫자만 비교하면 됩니다.
:::

:::details Q4. edit 모드에서 일부 필드만 고치면 나머지는 어떻게 처리되나?
폼은 `structuredFieldEdited` 같은 dirty 플래그로 '사용자가 실제로 건드린 필드'를 추적합니다. 근거/모호조건/사실/추론처럼 구조화 필드는 만졌을 때만 직렬화해 보내고, 안 만진 건 `undefined`로 둡니다. 백엔드 review API는 null/누락 필드는 기존값을 유지하는 부분 갱신이라, 안 건드린 필드가 빈 값으로 덮어써지지 않습니다. 저장 시 `confirmed: true`를 함께 보내 확정 시각을 기록합니다.
:::

:::details Q5. 분석 실패 메시지에 DB 오류가 들어오면 사용자에게 그대로 보이나?
아니요. `AnalysisFailureNotice`가 메시지를 검사해 `sql:`, `com.mysql`, `org.springframework`, `statement cancelled`, `timeoutexception` 같은 기술 문자열이 있거나 300자를 넘으면 feature별 일반 안내 문구로 치환합니다. 백엔드도 사용자 노출용 메시지를 따로 마스킹하지만, 프런트에서 한 번 더 거르는 2중 방어입니다.
:::

:::details Q6. 같은 폴더(`features/applications/`)에 적합도 패널이 있는데 B가 다 만든 건가?
아니요. `features/applications/`는 B와 C가 공유하는 폴더이고 컴포넌트 단위로 소유권이 갈립니다. B 소유는 공고문/공고 분석/기업 분석/개요 패널과 등록 위저드·상세 페이지이고, `FitAnalysisPanel`/`StrategyPanel`/`LearningRecommendationPanel`(적합도 탭)은 C 소유입니다. 상세 페이지가 fit 탭을 렌더하긴 하지만 그 내부 패널과 생성 트리거는 C가 책임집니다. ([영역 C](/area-c/))
:::

## 8. 직접 말해보기

아래를 막힘없이 입으로 설명할 수 있으면 이 페이지를 이해한 것이다.

1. 상세 페이지가 탭마다 hook을 켜고 끄는 방식(`needs*` → `enabled`)과, 그렇게 한 이유.
2. 공고문 저장이 no-op / confirm / 재추출 3갈래로 갈리는 조건과, 패널·페이지가 같은 헬퍼를 공유하는 이유.
3. stale 배지가 비교하는 두 값과, 그게 동작하려면 백엔드에 어떤 데이터 모델이 필요한지.
4. 화면을 떠나도 추출 진행이 따라오는 메커니즘과 stuck 방어(180초 타임아웃)의 필요성.
5. "AI 분석 실행" 버튼이 있는데도 '분석의 단일 진실원이 백엔드 파이프라인'이라고 말하는 이유.

## 퀴즈

<QuizBox question="ApplicationDetailPage가 활성 탭에 따라 hook의 enabled를 켜고 끄는 'needs*' 플래그를 쓰는 1차 목적은?" :choices="['컴포넌트 렌더링 순서를 강제하기 위해', '불필요한 데이터 페치를 막아 활성 탭에 필요한 호출만 하기 위해', 'URL을 항상 overview로 리다이렉트하기 위해', '백엔드 자동 파이프라인을 트리거하기 위해']" :answer="1" explanation="needsExtraction/needsJobPosting/needsJobAnalysis 등 boolean을 각 hook의 enabled로 넘겨, 활성 탭에 필요한 데이터만 페치하고 나머지 호출은 차단한다." />

<QuizBox question="추출이 PASS 상태이고 소스/URL은 그대로인데 공고문 본문만 수정해 저장하면 일어나는 일은?" :choices="['새 추출 작업이 큐잉되어 OCR을 다시 돌린다', 'OCR 재실행 없이 confirm 경로로 분석만 갱신한다', '저장 버튼이 비활성화되어 아무 일도 일어나지 않는다', '검수 확정 버튼으로만 저장할 수 있다']" :answer="1" explanation="isConfirmableTextCorrection이 'PASS + 소스/URL 변경 없음 + 본문만 변경'을 판정하면 confirm 경로로 보내 OCR 없이 분석만 1회 갱신한다." />

<QuizBox question="분석 패널의 isStale(이전 공고 rev 기준) 배지는 무엇과 무엇을 비교해 결정되나?" :choices="['분석 생성 시각과 현재 시각', 'analysis.jobPostingRevision과 최신 공고의 revision', '추출 품질 점수와 임계값', 'confirmedAt과 createdAt']" :answer="1" explanation="분석에 동결된 jobPostingRevision과 latestJobPostingRevision(최신 공고 revision)이 다르면 stale로 보고 배지와 재분석 배너를 띄운다." />
