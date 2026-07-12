# API 코드 규칙 (api/** 작업 시)

- `api/` 최상위 파일의 _lib는 `require('./_lib/...')` — `../_lib` 금지 (node --check로 안 잡히는 오류, c9c323b 교훈)
- DB 기사 INSERT는 `status='draft'`만. published 전환은 도메니코
- 비밀값을 코드·로그·커밋에 절대 넣지 않는다. Vercel env는 도메니코가 콘솔에서
- OAuth 성공 랜딩은 `api/_lib/oauthSuccess.js`의 `sendOAuthSuccessHtml()` 공용 헬퍼 사용 (Safari ITP)
- 새 엔드포인트를 만들면 배포 후 그 URL을 직접 호출해 200 + 기대 응답 확인
