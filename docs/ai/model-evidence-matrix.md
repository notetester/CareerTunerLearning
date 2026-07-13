# AI 모델 근거 매트릭스

> 모델명, 학습, 런타임 연결, 운영 기본값을 따로 기록한다. 이 표는 “자체 모델이 있다”는 한 문장으로 서로 다른 상태를 뭉개지 않기 위한 면접용 기준표다.

## 먼저 구분할 것

CareerTuner에서 “자체 AI”는 적어도 세 종류다.

1. 공개 베이스 모델에 CareerTuner 데이터로 LoRA/QLoRA를 적용한 모델
2. 팀이 직접 파인튜닝하지는 않았지만 로컬 장비에서 직접 서빙하는 OSS 모델
3. 점수·정책·검증을 결정적으로 수행하는 규칙 모델

첫 번째만 “프로젝트 데이터로 파인튜닝했다”고 말할 수 있다. 두 번째는 “자체 호스팅했다”, 세 번째는 “규칙 엔진을 구현했다”가 정확하다.

## 영역별 상태

| 영역 | 모델·엔진 | 학습 근거 | 런타임 연결 | 기본 경로·주의점 |
| --- | --- | --- | --- | --- |
| A | Qwen3 4B + Profile LoRA v4 | 학습·비교 기록 확인 | 프로필 평가용 선택 경로 | 산출물 일부가 새 clone에 없고 기본 runtime은 비활성이라 재현 가능 범위를 과장하지 않는다 |
| A | `qwen3:8b` 이력서 구조화 | 직접 학습 근거 없음 | 로컬 구조화 provider | “직접 학습”이 아니라 자체 호스팅 OSS 통합 |
| A | `profile-rule-v2` | 코드 규칙 | 항상 가능한 안전망 | 완성도 최종 계산은 provider 공통 서버 산식 |
| B | `careertuner-b-jobposting-r1` | LoRA 학습 기록 일부 확인 | 공고 분석 로컬 경로 | backend 모델 기본과 worker 전체 활성 여부는 별도 설정이므로 항상 live라고 말하지 않는다 |
| B | R2 후보 | 학습·Ollama 등록 기록 | 후보 경로 | 최종 정본 품질 게이트 완료로 과장하지 않는다 |
| B | PaddleOCR·PP-StructureV3 | 직접 학습 근거 없음 | Python 추출 worker | OCR·레이아웃 엔진 통합이며 CareerTuner 파인튜닝 모델이 아님 |
| C | Qwen2.5 3B + Career Strategy LoRA | 데이터 조립·QLoRA·평가·연결 확인 | `OssFitAnalysisAiService` | 기본 provider는 OpenAI다. 자체 모델은 설정 시 1차로 시도되고 실패 시 OpenAI→Mock으로 내려간다 |
| C | evidence-gated RAG 변형 | hard-case 비교 실험 | 기본 비활성 | 단순 RAG의 안정적 이득이 입증되지 않아 현재 결론은 `KEEP_RAG_DISABLED` |
| D | Qwen2.5 3B + Interview LoRA | 학습 및 60-case 평가 기록 | 질문·평가 gateway | 생성 task는 품질 때문에 기본 비활성, 평가는 기본 OpenAI다. “모든 면접을 자체 모델이 처리”는 과장 |
| D | 음성·시각 LightGBM | 각 2,000 clip 학습·평가 기록 | 비언어 분석 코드 | 학습 기록과 별개로 배포 artifact 추적 상태를 확인해야 한다 |
| D | faster-whisper | 직접 학습 근거 없음 | 로컬 STT 경로 | 자체 호스팅 음성 인식 통합 |
| E | Qwen2.5 3B + Correction LoRA delivery-s | 단계별 SFT·repair 평가 기록 | `SelfLlmCorrectionProvider` | 사용자 선택 또는 AUTO에서 자체→Claude→OpenAI. 전부 실패하면 성공을 가장한 Mock 없이 오류 종료 |
| E | Qwen3 8B Correction 후보 | 비교 실험 기록 | 레거시·비교 경로 | 최종 기본 모델과 구분 |
| F | `qwen3:8b` | 직접 학습 근거 없음 | 챗봇·인테이크 | tool 호출과 슬롯 수집을 결합한 자체 호스팅 OSS |
| F | `careertuner-mod` | 이름 외 base·dataset·adapter·평가 provenance 부족 | 검열 tag 연결 | 자료가 복원되기 전 직접 학습 성과로 집계하지 않는다 |
| F | Gemma 계열·Vision 모델·BGE-M3 | 직접 학습 근거 없음 | 태깅·이미지 검토·검색 | 자체 호스팅/embedding 통합이며 live digest와 품질 benchmark는 별도 확인 |

## C 모델의 정확한 설명

C는 프롬프트 정의를 넘어 실제 학습·평가·연결 근거를 갖췄다. `ml/career-strategy-llm/`에 데이터 조립·학습·평가 경로가 있고, 백엔드에는 다음 실행 사슬이 연결돼 있다.

```text
FitAnalysisAiService
  └─ FallbackFitAnalysisAiService
       ├─ OssFitAnalysisAiService      설정 시 자체 모델
       ├─ OpenAiFitAnalysisAiService   외부 provider
       └─ MockFitAnalysisAiService     결정적 안전망
```

다만 source 기본 provider가 OpenAI이므로 “운영 요청이 항상 자체 모델을 탄다”고 말하면 안 된다. 정확한 표현은 “학습·평가·서빙 연결을 완료했고 설정으로 승격할 수 있지만, 기본 경로는 OpenAI이며 규칙 Mock이 가용성을 보장한다”다.

또한 C의 LLM은 설명을 생성하지만 최종 점수·지원판정의 권위는 서버 규칙에 있다. `EvidenceGateService`와 `SkillAliasNormalizer`는 공고·프로필에 없는 보유 기술 주장과 별칭 오판을 후처리한다.

## LoRA와 RAG를 함께 보되 같은 것으로 보지 않는 이유

| 질문 | LoRA/QLoRA | RAG·evidence context |
| --- | --- | --- |
| 무엇을 바꾸나 | 출력 습관·JSON 계약·도메인 rubric | 요청 시점의 공고·프로필·FAQ 근거 |
| 어디에 남나 | adapter 가중치 | 검색 문서·source id·request context |
| 최신성 | 재학습 전까지 고정 | 요청마다 갱신 가능 |
| 개인정보 | 학습 데이터에 넣지 않는 것이 원칙 | 권한을 확인한 사용자별 context로 제한 |

CareerTuner는 RAG를 배제하지 않았다. D 면접과 F 검색에는 실제 retrieval 경로가 있고, B는 source-scoped grounding을 쓴다. C는 RAG 비교까지 했지만 단순 검색 증강이 unsupported claim을 안정적으로 줄이지 못해 기본 비활성으로 유지했다. “LoRA+RAG”라는 구호보다 각 영역의 실제 연결 상태를 말해야 한다.

## 파라미터를 설명할 때 지켜야 할 경계

공통적으로 확인되는 LoRA 계열 설정은 `r=16`, `alpha=32`, `dropout=0.05`, attention과 MLP projection target, 4-bit NF4 QLoRA다. 이 값은 24GB급 단일 GPU에서 학습 메모리를 줄이고 작은 도메인 데이터의 과적합을 완화하려는 선택이다.

그러나 설정값의 공학적 의도와 독립적인 ablation 결과는 다르다. 모든 파라미터 조합을 실험했다고 말하지 않는다. 실제 비교표·평가 artifact가 있는 변경만 “실험으로 개선을 검증했다”고 표현한다.

## 공급자 선택과 폴백

모든 영역이 같은 사다리를 쓰지는 않는다.

- C: 자체 모델(설정 시) → OpenAI → 결정적 Mock
- D: task·화이트리스트와 사용자 선택에 따라 자체 → Claude → OpenAI
- E: AUTO는 자체 → Claude → OpenAI, 명시 선택은 선택 tier부터 시작
- E는 전부 실패했을 때 원문 복제를 성공으로 저장하지 않는다
- F는 Ollama·검색·도구 호출 조합이며 task별 경로가 다르다

사용자가 모델을 고를 수 있는 D/E 재시도는 최초 모델을 기본값으로 유지하되 다른 모델을 다시 선택할 수 있다. “재시도는 무조건 최초 모델”이 아니다.

## 면접에서의 짧은 답변

> “범용 LLM을 처음부터 사전학습하지 않았습니다. 데이터·장비·기간 대비 효용이 낮았기 때문에 공개 instruction 모델의 언어 능력을 보존하고, 도메인 출력 습관만 LoRA/QLoRA로 적응했습니다. 최신 사실은 모델별로 다릅니다. C와 E는 학습·평가·런타임 연결 근거가 있지만 기본 provider와 활성 설정은 별도이고, RAG도 D/F에는 연결했지만 C 단순 RAG는 hard-case 결과 때문에 비활성입니다. 점수와 권한 같은 결정은 모델이 아니라 서버 규칙이 확정합니다.”

## 근거 경로

- `docs/AI_REPORT/CAREERTUNER_SELF_AI_MODEL_DEEP_DIVE.md`
- `ml/career-strategy-llm/`
- `ml/interview-finetune/`
- `ml/interview-nonverbal/`
- `ml/correction-llm/`
- `backend/src/main/java/com/careertuner/fitanalysis/ai/`
- `backend/src/main/java/com/careertuner/fitanalysis/service/EvidenceGateService.java`
- `backend/src/main/java/com/careertuner/correction/ai/CorrectionAiClient.java`
