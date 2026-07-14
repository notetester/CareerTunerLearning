# CareerTuner Learning

CareerTuner 팀 프로젝트에서 **실제로 사용한 기술**을, 면접에서 막힘없이 설명하기 위해 만든 학습 사이트입니다.
6명이 나눠 만든 **6개 영역(A~F)을 각각 동등한 깊이**로 다루는 프로젝트 전체 학습 자료입니다.
[VitePress](https://vitepress.dev) 기반 정적 문서 사이트이고, GitHub Pages로 배포합니다.

> 목표: "써봤어요"가 아니라 **"어디에, 왜, 어떻게 썼고, 무엇이 어려웠는지"** 까지 설명하기.

## 구성

| 영역 | 내용 |
| --- | --- |
| 가이드 | 학습/말하기 전략, 내 코드 기반 기술 지도 |
| 용어집 | API·DTO·트랜잭션·인증/인가 등 기초 용어 (30초 답변용) |
| 백엔드 | Spring Boot · MyBatis · JWT/Security · 검증 · 예외 처리 등 |
| 프론트엔드 | React · Vite · TypeScript · 상태관리 · API 레이어 · Capacitor 등 |
| AI | LLM·프롬프트·RAG·오케스트레이터·구조화 출력 등 영역 공통 AI 패턴 |
| **영역별 심화 (A~F)** | 6개 영역을 각각 깊게 — A 회원·프로필 / B 공고·기업분석 / C 분석·대시보드 / D 가상면접 / E 첨삭·결제 / F 커뮤니티·챗봇 (각 영역 면접 플레이북 포함) |
| 인프라 | Gradle/Vite 빌드 · GitHub Actions · Docker · Git 협업 · 테스트 |
| 프로젝트 | 전체 아키텍처 · 내 역할 · 트러블슈팅 · 면접 스토리 |
| 퀴즈 | 영역별 객관식/주관식 자가 점검 |

각 페이지는 `단어 뜻 → 개념 → 왜 필요한가 → 내 코드 위치 → 동작 원리 → 면접 답변 3단계 → 꼬리질문 → 직접 말해보기 → 퀴즈` 순서로 구성됩니다.

## 로컬 실행

```bash
npm install
npm run docs:dev      # http://localhost:5173 (개발 서버)
npm run docs:build    # 정적 사이트 빌드
npm run docs:preview  # 빌드 결과 미리보기
```

Node.js 22 이상 필요. 제품 프런트엔드와 CI의 기준도 Node 22다.

## 배포 (GitHub Pages)

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`(GitHub Actions)이 빌드 후 Pages에 배포합니다.

최초 1회 GitHub 저장소 설정에서 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 지정해야 합니다.
배포 주소: `https://notetester.github.io/CareerTunerLearning/`

> `docs/.vitepress/config.ts` 의 `base` 값(`/CareerTunerLearning/`)은 저장소 이름과 일치해야 합니다.

## 기준 소스와 공개 포트폴리오

이 학습 자료의 현재 사실 기준은 CareerTuner `dev`의 `23bb4d221a9568db6b46b08af57514a5097ee33a`다. 상세 기준과 사실 채택 순서는 [문서 기준선](docs/project/source-baseline.md)에 기록한다.

- 제품 원본: <https://github.com/notetester/CareerTuner>
- 공개 포트폴리오: <https://github.com/notetester/CareerTunerPortfolio>
- 공개 포트폴리오 병행 저장소: <https://github.com/notetester/CareerTunerPortfolios>

공개 포트폴리오는 비밀값·개인정보를 제거한 별도 이력이며, 이 Learning 저장소는 실행 코드 정본이 아니라 설명·면접 학습 자료다.

## 퀴즈 컴포넌트

마크다운 어디서나 `<QuizBox>` 를 쓸 수 있습니다(전역 등록, `docs/.vitepress/theme/`).

```md
<!-- 객관식 (answer는 0부터 시작하는 인덱스) -->
<QuizBox
  question="REST에서 URI가 주로 표현하는 것은?"
  :choices="['서버의 물리적 위치', '자원', '컴포넌트', 'DB 비밀번호']"
  :answer="1"
  explanation="REST에서 URI는 자원을, HTTP 메서드는 행위를 표현한다."
/>

<!-- 주관식 (정답 보기형) -->
<QuizBox question="DTO를 왜 쓰나요?" explanation="계층 간 데이터 전달과 Entity 비노출을 위해..." />
```

## ⚠️ 공개 저장소 주의

이 저장소는 **공개(public)** 입니다. 실제 비밀번호·API 키·JWT 시크릿·DB 호스트/IP·내부 주소 등 **민감정보는 절대 넣지 않습니다.**
환경값은 `DB_HOST`, `OPENAI_API_KEY` 같은 자리표시자로만 표기하고, 회사 소스는 학습용으로 추상화/축약합니다.
