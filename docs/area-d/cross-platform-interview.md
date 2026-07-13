# 면접 기능의 웹·모바일·데스크톱 연결

> 세 플랫폼은 같은 면접 세션·질문·답변·리포트를 사용하지만, 입력 장치와 화면 생명주기는 따로 구현한다.

## 공통 계약

- 지원 건과 프로필·공고·적합도 provenance
- 질문 생성, 답변 제출, 평가, 꼬리질문, 리포트 API
- 모델 선택 값과 실제 사용 모델 기록
- SSE의 진행·완료·오류 terminal event
- 답변·미디어 소유권과 soft delete

## 플랫폼별 책임

| 웹 | Android | Desktop |
| --- | --- | --- |
| 브라우저 녹음·카메라·반응형 면접 UI | Capacitor 권한·뒤로가기·deep link·WebView lifecycle | Qt Multimedia 녹음·QML timeline·로컬 리포트 export |

공통 API를 쓴다고 UI 검증을 생략하지 않는다. 모바일의 권한 거부·앱 resume, 데스크톱의 파일 경로·패키지 런타임, 웹의 브라우저 API 지원 여부는 서로 다른 실패점이다.

## 재시도와 모델 선택

재시도 화면의 기본값은 최초 선택 모델이다. 하지만 사용자가 응답 품질을 비교하고 싶으면 다른 모델로 바꿔 재시도할 수 있다. 요청 모델과 실제 사용 모델을 둘 다 남겨 폴백이 일어났는지도 구분한다.

## 검증 항목

1. 같은 계정으로 세 플랫폼에서 동일 세션 목록을 보는가
2. 한 플랫폼에서 제출한 답변·리포트가 다른 플랫폼에 나타나는가
3. 모델 변경 재시도가 선택값대로 시작하고 실제 provider를 기록하는가
4. SSE 오류가 무한 로딩이 아니라 terminal 상태로 끝나는가
5. 녹음·임시 파일이 완료·취소·삭제 때 정리되는가
6. 라이트/다크와 좁은 화면에서 평가 카드가 잘리지 않는가

## 근거 경로

- `backend/src/main/java/com/careertuner/interview/`
- `frontend/src/features/interview/`
- `desktop/core/InterviewSession.cpp`
- `docs/verification/DEMO_READINESS_LEDGER.md`
