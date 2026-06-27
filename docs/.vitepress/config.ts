import { defineConfig } from 'vitepress'

// GitHub Pages 저장소 이름과 일치해야 한다: https://notetester.github.io/CareerTunerLearning/
export default defineConfig({
  lang: 'ko-KR',
  title: 'CareerTuner Learning',
  description: '내가 만든 CareerTuner 프로젝트의 기술을 면접에서 직접 설명하기 위한 학습 자료',
  base: '/CareerTunerLearning/',
  lastUpdated: true,
  cleanUrls: true,

  // 84개 페이지를 에이전트가 생성하므로 일부 상호 링크가 비어 있을 수 있다. 빌드 실패 대신 경고만.
  ignoreDeadLinks: true,

  head: [
    ['meta', { name: 'theme-color', content: '#5e6ad2' }],
    ['meta', { name: 'og:title', content: 'CareerTuner Learning' }],
    ['meta', { name: 'og:description', content: '프로젝트 기반 기술 면접 학습 자료' }],
  ],

  themeConfig: {
    outline: { level: [2, 3], label: '목차' },
    docFooter: { prev: '이전', next: '다음' },
    darkModeSwitchLabel: '테마',
    sidebarMenuLabel: '메뉴',
    returnToTopLabel: '맨 위로',
    lastUpdatedText: '마지막 수정',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '검색', buttonAriaLabel: '검색' },
          modal: {
            noResultsText: '결과 없음',
            resetButtonTitle: '지우기',
            footer: { selectText: '선택', navigateText: '이동', closeText: '닫기' },
          },
        },
      },
    },

    nav: [
      { text: '홈', link: '/' },
      { text: '학습법', link: '/guide/how-to-study' },
      { text: '용어집', link: '/glossary/' },
      { text: '백엔드', link: '/backend/' },
      { text: '프론트엔드', link: '/frontend/' },
      { text: 'AI', link: '/ai/' },
      {
        text: '영역별 심화',
        items: [
          { text: '영역 A · 회원·프로필·인증', link: '/area-a/' },
          { text: '영역 B · 지원건·공고분석', link: '/area-b/' },
          { text: '영역 C · 분석·대시보드', link: '/area-c/' },
          { text: '영역 D · 가상 면접', link: '/area-d/' },
          { text: '영역 E · 첨삭·결제', link: '/area-e/' },
          { text: '영역 F · 커뮤니티·챗봇', link: '/area-f/' },
        ],
      },
      { text: '인프라', link: '/infra/' },
      { text: '프로젝트', link: '/project/overview' },
      { text: '퀴즈', link: '/quizzes/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '학습 가이드',
          items: [
            { text: '왜 아는데 말이 막히나 (학습법)', link: '/guide/how-to-study' },
            { text: '내 코드 기반 기술 지도', link: '/guide/tech-map' },
          ],
        },
      ],

      '/glossary/': [
        {
          text: '용어집 개요',
          items: [
            { text: '왜 단어부터 잡나', link: '/glossary/' },
          ],
        },
        {
          text: '웹 · API · 통신',
          items: [
            { text: 'API', link: '/glossary/api' },
            { text: 'REST API', link: '/glossary/rest-api' },
            { text: 'HTTP 메서드와 상태코드', link: '/glossary/http-methods' },
            { text: 'JSON', link: '/glossary/json' },
            { text: '직렬화 / 역직렬화', link: '/glossary/serialization' },
            { text: 'Request / Response', link: '/glossary/request-response' },
            { text: '무상태 (Stateless)', link: '/glossary/stateless' },
            { text: 'CORS', link: '/glossary/cors' },
            { text: '프록시 (Proxy)', link: '/glossary/proxy' },
            { text: 'ApiResponse 엔벨로프', link: '/glossary/api-response-envelope' },
          ],
        },
        {
          text: '백엔드 · 자바 / 스프링',
          items: [
            { text: '4계층 구조', link: '/glossary/layered-architecture' },
            { text: '의존성 주입(DI)과 IoC', link: '/glossary/di-ioc' },
            { text: '애너테이션 (@)', link: '/glossary/annotation' },
            { text: '제네릭 (Generic)', link: '/glossary/generic' },
            { text: 'DTO', link: '/glossary/dto' },
            { text: 'Entity / Domain', link: '/glossary/entity-domain' },
            { text: 'ORM과 MyBatis', link: '/glossary/orm-and-mybatis' },
            { text: '트랜잭션', link: '/glossary/transaction' },
            { text: '필터 / 필터체인', link: '/glossary/filter-chain' },
          ],
        },
        {
          text: '인증 · 보안',
          items: [
            { text: '인증 vs 인가', link: '/glossary/auth-authn-authz' },
            { text: '토큰 / 세션 / 쿠키', link: '/glossary/token-session-cookie' },
            { text: 'JWT', link: '/glossary/jwt' },
          ],
        },
        {
          text: '프론트 · 실시간 · 운영',
          items: [
            { text: 'SPA', link: '/glossary/spa' },
            { text: '컴포넌트 / Props / State', link: '/glossary/component-props-state' },
            { text: 'Hook', link: '/glossary/hook' },
            { text: 'SSE (실시간 스트리밍)', link: '/glossary/sse' },
            { text: '동기 / 비동기', link: '/glossary/async-sync' },
            { text: '캐시 / 캐싱', link: '/glossary/cache' },
            { text: '환경변수', link: '/glossary/environment-variable' },
            { text: 'CI / CD', link: '/glossary/ci-cd' },
          ],
        },
      ],

      '/backend/': [
        {
          text: '백엔드 (Spring Boot · MyBatis)',
          items: [
            { text: '개요', link: '/backend/' },
            { text: 'Spring Boot', link: '/backend/spring-boot' },
            { text: 'Spring MVC와 REST 컨트롤러', link: '/backend/spring-mvc-rest' },
            { text: 'MyBatis', link: '/backend/mybatis' },
            { text: 'MySQL 스키마 설계', link: '/backend/mysql-schema' },
            { text: '입력 검증', link: '/backend/validation' },
            { text: '예외 처리', link: '/backend/exception-handling' },
            { text: 'JWT와 Spring Security', link: '/backend/jwt-security' },
            { text: 'OAuth2 소셜 로그인', link: '/backend/oauth2' },
            { text: '비밀번호 해싱 (BCrypt)', link: '/backend/bcrypt-password' },
            { text: '파일/URL 텍스트 추출', link: '/backend/file-text-extraction' },
            { text: '이메일 발송', link: '/backend/mail' },
            { text: '푸시 알림', link: '/backend/push-notification' },
            { text: 'API 문서화 (Swagger)', link: '/backend/openapi-swagger' },
            { text: '설정 관리', link: '/backend/configuration-properties' },
            { text: '로깅', link: '/backend/logging' },
          ],
        },
      ],

      '/frontend/': [
        {
          text: '프론트엔드 (React · Vite)',
          items: [
            { text: '개요', link: '/frontend/' },
            { text: 'React', link: '/frontend/react' },
            { text: 'TypeScript', link: '/frontend/typescript' },
            { text: 'Vite', link: '/frontend/vite' },
            { text: 'Tailwind와 다크모드', link: '/frontend/tailwind-darkmode' },
            { text: '디자인 토큰 / CSS 변수', link: '/frontend/design-tokens' },
            { text: 'React Router', link: '/frontend/react-router' },
            { text: '상태 관리', link: '/frontend/state-management' },
            { text: '커스텀 훅', link: '/frontend/custom-hooks' },
            { text: 'API 레이어와 JWT 리프레시', link: '/frontend/api-layer-jwt-refresh' },
            { text: '컴포넌트 아키텍처', link: '/frontend/component-architecture' },
            { text: '폼 처리 (RHF)', link: '/frontend/react-hook-form' },
            { text: '데이터 시각화 (Recharts)', link: '/frontend/recharts' },
            { text: 'PWA와 서비스워커', link: '/frontend/pwa' },
            { text: '모바일 앱 (Capacitor)', link: '/frontend/capacitor-mobile' },
          ],
        },
      ],

      '/ai/': [
        {
          text: 'AI 기능',
          items: [
            { text: '개요', link: '/ai/' },
            { text: 'LLM과 프롬프트', link: '/ai/llm-and-prompt' },
            { text: '프롬프트 카탈로그 패턴', link: '/ai/prompt-catalog' },
            { text: '구조화된 출력', link: '/ai/openai-structured-output' },
            { text: 'LangChain4j와 Ollama', link: '/ai/langchain4j-ollama' },
            { text: 'RAG와 벡터DB (Qdrant)', link: '/ai/rag-qdrant' },
            { text: '임베딩과 벡터 검색', link: '/ai/embedding' },
            { text: '환각과 그라운딩', link: '/ai/hallucination' },
            { text: 'AI 오케스트레이터', link: '/ai/orchestrator-autoprep' },
            { text: '폴백 체인', link: '/ai/fallback' },
          ],
        },
        {
          text: '내 영역 C',
          items: [
            { text: '적합도 분석', link: '/ai/fit-analysis' },
            { text: '장기 취업경향 분석', link: '/ai/career-trend-analysis' },
            { text: '대시보드 AI 요약', link: '/ai/dashboard-insight' },
            { text: '자체 LLM 전략 (설계)', link: '/ai/self-llm-strategy' },
          ],
        },
        {
          text: '다른 영역도 알기',
          items: [
            { text: '공고 추출 (B)', link: '/ai/job-posting-extraction' },
            { text: '가상 면접 (D/E)', link: '/ai/interview-ai' },
            { text: 'AI 사용량·크레딧', link: '/ai/ai-usage-credit' },
          ],
        },
      ],

      '/area-a/': [
        { text: '영역 A · 회원·프로필·인증', items: [{ text: '개요', link: '/area-a/' }] },
        {
          text: '기반 · 인증',
          items: [
            { text: '프로필 데이터 모델', link: '/area-a/profile-data-model' },
            { text: 'JWT 인증 흐름', link: '/area-a/auth-jwt' },
            { text: 'OAuth2 소셜 로그인', link: '/area-a/oauth-social' },
            { text: '비밀번호·이메일 인증', link: '/area-a/password-email' },
            { text: '프로필 스냅샷·버전', link: '/area-a/profile-versioning' },
          ],
        },
        {
          text: 'AI 기능 (#1-5)',
          items: [
            { text: '이력서/프로필 요약', link: '/area-a/ai-resume-summary' },
            { text: '기술스택 추출', link: '/area-a/ai-skill-extraction' },
            { text: '자소서/경력 키워드', link: '/area-a/ai-keyword-extraction' },
            { text: '프로필 완성도 진단', link: '/area-a/ai-profile-completeness' },
          ],
        },
        {
          text: '운영 · UI · 종합',
          items: [
            { text: '동의 관리·게이팅', link: '/area-a/consent-gating' },
            { text: '프론트엔드 UI/UX', link: '/area-a/frontend-ui' },
            { text: '관리자 화면', link: '/area-a/admin' },
            { text: '면접 플레이북', link: '/area-a/interview-playbook' },
          ],
        },
      ],

      '/area-b/': [
        { text: '영역 B · 지원건·공고분석', items: [{ text: '개요', link: '/area-b/' }] },
        {
          text: '지원 건 · 공고',
          items: [
            { text: '지원 건 생명주기', link: '/area-b/application-lifecycle' },
            { text: '공고 원문·revision', link: '/area-b/job-posting-storage' },
            { text: '텍스트 추출·OCR·SSRF', link: '/area-b/text-extraction-ocr' },
            { text: '공고 추출 워커(Python)', link: '/area-b/ml-worker' },
            { text: 'B 데이터 모델', link: '/area-b/data-model' },
          ],
        },
        {
          text: 'AI 분석 (#6-11)',
          items: [
            { text: '공고문 분석', link: '/area-b/job-analysis' },
            { text: '필수·우대 조건', link: '/area-b/required-preferred' },
            { text: '담당 업무 요약', link: '/area-b/duties-summary' },
            { text: '기업 현황 요약', link: '/area-b/company-analysis' },
            { text: '면접 포인트 추출', link: '/area-b/interview-points' },
            { text: '구조화 추출', link: '/area-b/structured-output' },
          ],
        },
        {
          text: 'UI · 운영',
          items: [
            { text: '프론트엔드 UI/UX', link: '/area-b/frontend-ui' },
            { text: '관리자 화면', link: '/area-b/admin' },
            { text: '면접 플레이북', link: '/area-b/interview-playbook' },
          ],
        },
      ],

      '/area-c/': [
        {
          text: '영역 C · 분석·대시보드',
          items: [
            { text: '개요 & 설계 철학', link: '/area-c/' },
          ],
        },
        {
          text: '핵심 파이프라인',
          items: [
            { text: '적합도 분석 파이프라인', link: '/area-c/fit-analysis' },
            { text: '점수 산출 규칙엔진', link: '/area-c/score-engine' },
            { text: '부족역량·학습·자격증', link: '/area-c/gap-and-learning' },
            { text: '지원 전략', link: '/area-c/application-strategy' },
          ],
        },
        {
          text: 'AI 설계',
          items: [
            { text: '뉴로-심볼릭 아키텍처', link: '/area-c/neuro-symbolic' },
            { text: '가드레일 & 그라운딩', link: '/area-c/guardrails' },
            { text: '3단 폴백 체인', link: '/area-c/fallback-chain' },
            { text: '구조화 출력', link: '/area-c/structured-output' },
            { text: 'Read-through 캐시', link: '/area-c/caching-fingerprint' },
          ],
        },
        {
          text: '데이터 · 구조',
          items: [
            { text: '장기 취업경향 분석', link: '/area-c/career-trend' },
            { text: '대시보드 AI 요약', link: '/area-c/dashboard-insight' },
            { text: '오케스트레이터 FIT 파트', link: '/area-c/orchestrator-fit' },
            { text: 'C 데이터 모델', link: '/area-c/data-model' },
            { text: 'C 클래스 설계', link: '/area-c/class-design' },
          ],
        },
        {
          text: 'UI · 종합',
          items: [
            { text: 'C 프론트엔드 UI/UX', link: '/area-c/frontend-ui' },
            { text: 'C 관리자 화면', link: '/area-c/admin' },
            { text: '종합 면접 플레이북', link: '/area-c/interview-playbook' },
          ],
        },
      ],

      '/area-d/': [
        {
          text: '영역 D · 가상 면접',
          items: [
            { text: '개요', link: '/area-d/' },
            { text: '면접 세션 데이터 모델', link: '/area-d/session-model' },
          ],
        },
        {
          text: 'AI 면접 (#19-23)',
          items: [
            { text: '예상 질문 생성', link: '/area-d/question-generation' },
            { text: '꼬리 질문 생성', link: '/area-d/followup-questions' },
            { text: 'AI 면접관 진행', link: '/area-d/interviewer-flow' },
            { text: '답변 평가', link: '/area-d/answer-evaluation' },
            { text: '면접 리포트', link: '/area-d/interview-report' },
          ],
        },
        {
          text: '모델 · 인프라',
          items: [
            { text: '폴백 게이트웨이', link: '/area-d/fallback-gateway' },
            { text: '자체 LLM 파인튜닝', link: '/area-d/self-llm-finetune' },
            { text: '면접 RAG·근거주입', link: '/area-d/rag-grounding' },
            { text: '음성·영상 미디어', link: '/area-d/media-handling' },
            { text: 'SSE 실시간 진행', link: '/area-d/sse-streaming' },
            { text: '오케스트레이터 INTERVIEW', link: '/area-d/orchestrator-interview' },
          ],
        },
        {
          text: 'UI · 종합',
          items: [
            { text: '프론트엔드 UI/UX', link: '/area-d/frontend-ui' },
            { text: '면접 플레이북', link: '/area-d/interview-playbook' },
          ],
        },
      ],

      '/area-e/': [
        {
          text: '영역 E · 첨삭·결제·크레딧',
          items: [
            { text: '개요', link: '/area-e/' },
            { text: '첨삭의 원칙', link: '/area-e/correction-principles' },
          ],
        },
        {
          text: 'AI 첨삭 (#24-28)',
          items: [
            { text: '면접 답변 첨삭', link: '/area-e/ai-answer-correction' },
            { text: '자기소개서 첨삭', link: '/area-e/ai-coverletter' },
            { text: '이력서 표현 개선', link: '/area-e/ai-resume-improve' },
            { text: '포트폴리오 개선', link: '/area-e/ai-portfolio' },
            { text: '요금제 추천', link: '/area-e/ai-plan-recommend' },
            { text: '자체 LLM 첨삭 모델', link: '/area-e/self-llm-correction' },
          ],
        },
        {
          text: '결제 · 크레딧',
          items: [
            { text: '첨삭 데이터 모델', link: '/area-e/correction-data-model' },
            { text: '크레딧 시스템', link: '/area-e/credit-system' },
            { text: '결제 흐름', link: '/area-e/payment-flow' },
            { text: '요금제 게이팅', link: '/area-e/plan-gating' },
            { text: '사용량 대시보드', link: '/area-e/usage-dashboard' },
          ],
        },
        {
          text: 'UI · 종합',
          items: [
            { text: '프론트엔드 UI/UX', link: '/area-e/frontend-ui' },
            { text: '면접 플레이북', link: '/area-e/interview-playbook' },
          ],
        },
      ],

      '/area-f/': [
        {
          text: '영역 F · 커뮤니티·챗봇',
          items: [
            { text: '개요', link: '/area-f/' },
            { text: '커뮤니티 데이터 모델', link: '/area-f/community-data-model' },
          ],
        },
        {
          text: 'AI 기능 (#29-34)',
          items: [
            { text: '면접 후기 요약', link: '/area-f/ai-review-summary' },
            { text: '게시글 태그 추천', link: '/area-f/ai-tag-recommend' },
            { text: '실제 질문 추출', link: '/area-f/ai-question-extract' },
            { text: '게시글 추천', link: '/area-f/ai-post-recommend' },
            { text: '신고 분류', link: '/area-f/ai-report-classify' },
            { text: '문의 답변 초안', link: '/area-f/ai-support-draft' },
          ],
        },
        {
          text: '챗봇 · 에이전트',
          items: [
            { text: 'LangChain4j 에이전트', link: '/area-f/langchain4j-agent' },
            { text: '인테이크 챗봇', link: '/area-f/intake-chatbot' },
            { text: '챗봇 메모리 영속', link: '/area-f/chat-memory' },
          ],
        },
        {
          text: '운영 · UI · 종합',
          items: [
            { text: '고객센터·공지·알림', link: '/area-f/support-notice-faq' },
            { text: '프론트엔드 UI/UX', link: '/area-f/frontend-ui' },
            { text: '관리자 화면', link: '/area-f/admin' },
            { text: '면접 플레이북', link: '/area-f/interview-playbook' },
          ],
        },
      ],

      '/infra/': [
        {
          text: '인프라 / 협업',
          items: [
            { text: '개요', link: '/infra/' },
            { text: 'Gradle 빌드', link: '/infra/gradle' },
            { text: 'npm/Vite 빌드', link: '/infra/vite-npm-build' },
            { text: 'CI/CD (GitHub Actions)', link: '/infra/github-actions' },
            { text: '컨테이너 배포 (Docker)', link: '/infra/docker-compose' },
            { text: 'Git 협업 전략', link: '/infra/git-workflow' },
            { text: '환경변수와 시크릿', link: '/infra/env-and-secrets' },
            { text: '테스트 전략', link: '/infra/testing' },
          ],
        },
      ],

      '/project/': [
        {
          text: '프로젝트 설명 (면접용)',
          items: [
            { text: 'CareerTuner 한눈에', link: '/project/overview' },
            { text: '전체 아키텍처', link: '/project/architecture' },
            { text: '내 역할 — 영역 C', link: '/project/my-role' },
            { text: '자동 스토리보드 파이프라인', link: '/project/storyboard-pipeline' },
            { text: '어려웠던 문제와 해결', link: '/project/troubleshooting' },
            { text: '프로젝트 면접 스토리', link: '/project/interview-story' },
          ],
        },
      ],

      '/quizzes/': [
        {
          text: '퀴즈로 점검',
          items: [
            { text: '퀴즈 모음', link: '/quizzes/' },
            { text: '백엔드 퀴즈', link: '/quizzes/backend' },
            { text: '프론트엔드 퀴즈', link: '/quizzes/frontend' },
            { text: 'AI 퀴즈', link: '/quizzes/ai' },
            { text: '프로젝트 Q&A 점검', link: '/quizzes/project-qna' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notetester/CareerTunerLearning' },
    ],

    footer: {
      message: '개인 면접 대비용 학습 자료 · 민감정보 미포함',
      copyright: 'CareerTuner Learning',
    },
  },
})
