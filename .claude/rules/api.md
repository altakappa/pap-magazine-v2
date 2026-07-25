# API 코드 규칙 (api/** 작업 시)

- `api/` 최상위 파일의 _lib는 `require('./_lib/...')` — `../_lib` 금지 (node --check로 안 잡히는 오류, c9c323b 교훈)
- DB 기사 INSERT는 `status='draft'`만. published 전환은 도메니코
- 비밀값을 코드·로그·커밋에 절대 넣지 않는다. Vercel env는 도메니코가 콘솔에서
- OAuth 성공 랜딩은 `api/_lib/oauthSuccess.js`의 `sendOAuthSuccessHtml()` 공용 헬퍼 사용 (Safari ITP)
- 새 엔드포인트를 만들면 배포 후 그 URL을 직접 호출해 200 + 기대 응답 확인

## 에러 응답 규칙 (2026-07-26, 감사 A-3)
- **원문 에러를 응답에 싣지 않는다.** `detail: err.message`, `'...' + err.message`,
  `code=` 이어붙이기 전부 금지 — DB 컬럼명·제약·스토리지 내부 구조가 샌다.
- 상세는 `console.error` 로만. 응답은 **문의처가 포함된 일반 안내 + 분류용 `code`**.
  예: `{ message: 'Failed to … contact@pap-magazine.com', code: 'fetch_failed' }`
- `code` 는 프론트가 언어별 문구로 매핑하는 열쇠다(회원 대면 문구는 9개 언어).
  새 에러 경로를 만들면 `code` 를 반드시 붙이고 프론트 매핑도 함께 추가한다.

## 업로드 검증 규칙 (2026-07-26, 감사 A-1·A-5·A-6)
- **사용자 URL 은 스킴을 검증한다.** `new URL()` 파싱 후 `http:`/`https:` 가
  아니면 400. 저장된 값이 관리자 화면에서 `<a href>` 로 렌더되므로 저장 단계에서 막는다.
- **스토리지 경로는 자기 폴더 아래인지 확인한다.** 클라이언트가 보낸 경로/URL 을
  그대로 저장하지 않는다(`_userPathPrefix` 패턴).
- **앱 화이트리스트와 버킷 `allowed_mime_types` 를 반드시 일치시킨다.** 어긋나면
  앱은 통과시켰는데 스토리지가 거부하는 '조용한 실패'가 된다. 서명 URL 발급 시
  실제로 PUT 할 `contentType` 을 정규화해 함께 돌려주고 클라이언트가 그 값을 쓴다
  (`image/jpg` 같은 비표준 별칭, 빈 MIME 의 확장자 폴백 때문).
- **서버가 바이트를 쥐는 경로는 매직바이트를 검증한다** — `api/_lib/fileSignature.js`
  (`verifyFileOnDisk` / `verifySignature`). `_lib/upload.js` 의 `uploadFiles` 에
  이미 걸려 있어 multipart 경유 업로드는 자동 적용된다.
  2단계 직접 업로드는 바이트가 서버를 거치지 않아 버킷 MIME 강제가 유일한 관문이다.

## 현재 버킷 설정 (2026-07-26 기준)
| 버킷 | 공개 | file_size_limit | allowed_mime_types |
|---|---|---|---|
| `submissions` | 공개 | 50MB | image/jpeg, image/png, image/webp, image/tiff |
| `pullletters` (무드보드) | 공개 | 50MB | 이미지 7종 + pdf + ppt/pptx |
| `pull-letters` (시안·발급) | 비공개 | 50MB | application/pdf |

앱 화이트리스트를 바꾸면 이 표와 실제 버킷 설정을 함께 갱신할 것.
