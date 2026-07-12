# CLAUDE.md — PAP_Magazine_Deploy 작업 규칙

이 저장소는 pap-magazine.com (Vercel 배포). 어떤 모델이든 코드 작업 전 이 파일과,
가능하면 볼트(PAP-Vault)의 `60_Agents/도메니코-설명서.md` · `60_Agents/작업-프로토콜.md`를 읽는다.

## 절대 규칙
1. **push 금지 — 커밋까지만.** push는 도메니코가 `PAP-푸시하기.command`로 직접 한다.
2. 커밋 아이덴티티: `git -c user.name="ALTAKAPPA" -c user.email="contact@pap-magazine.com" commit`
   트레일러 필수:
   `Co-Authored-By: Claude <noreply@anthropic.com>` + `Claude-Session: (세션 링크)`
3. **비밀값 취급 금지.** 토큰·키·비밀번호는 도메니코가 콘솔에서 직접. Claude는 공개값만 입력.
4. DB 기사 INSERT는 `status='draft'`만. 발행 판단은 도메니코.

## 코드 체크리스트
- `api/` 최상위 파일: `require('./_lib/...')` — `../_lib` 아님 (node --check는 이 오류를 못 잡는다)
- `pap-*.js` 등 프론트 JS 수정 시: 참조하는 HTML(10개)의 `?v=` 버전 올리기 (캐시버스트)
- 수정 후 `npm test` — 하네스 55개 전부 통과해야 커밋
- OAuth 성공 랜딩은 `api/_lib/oauthSuccess.js`의 `sendOAuthSuccessHtml()` 공용 헬퍼 사용 (Safari ITP 대응)
- 회원 등급 게이트 변경 시 3종(Free/Standard/Premium) + subscribe 9개 언어 문구 정합 확인

## 배포 검증 (커밋→푸시 이후)
1. push 후 ~95초 대기 → Vercel 배포 READY 확인
2. 라이브에서 실제 동작 확인 (브라우저/HTTP) — "코드가 맞다"가 아니라 "라이브가 된다"까지
3. 중요 작업은 볼트 `45_Business/`에 날짜 파일로 기록

## 인프라 좌표
- Vercel: project `prj_bJ4s6cgv7HbrDYYU0mu0B9xyl3n5` / team `team_EmYMio2vO29fe2ZFbeRJ2Nsi` (env 추가 시 재배포 필요, Sensitive 값은 저장 후 읽기 불가)
- Supabase: `igcazquhkwxtqsaqpznx` (서버는 service_role)
- 결제: Paddle (plan_key는 premium_*/standard_* → base plan으로 정규화되어 profiles 저장)
