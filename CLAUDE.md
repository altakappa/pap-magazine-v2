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

## 성장 헌법 (2026-08-08 — 도메니코 확정. 전문: 볼트 45_Business/PAP-성장-가이드라인.md)
1. 최종 도달점은 둘뿐: ① **PAP 인스타그램**(진성 한국인 유입·팔로워·인사이트 — 최우선)
   ② **PAP 웹사이트**(유료 구독자 증식 — 차순위). 그 외 모든 채널은 이 둘로 보내는 통로다.
2. 기능·콘텐츠·채널 작업 전 반드시 답하라: "두 도달점 중 어디로, 어떤 경로로 사람을
   보내는가? 무엇으로 측정되는가?" — 답 못 하면 만들지 않는다.
3. 외부 발신 링크는 전부 utm_source (x·ig·naver·kakao·newsletter·threads·tiktok·youtube).
   웹→IG 이동은 `/api/ig-out` 경유만.
4. 두 목표 충돌 시 인스타그램이 이긴다. 웹 체류를 위해 IG 전환 장치를 약화시키는 변경 금지.
5. 한국인 유입이 걸린 결정은 네이버·카카오·한국어 품질을 글로벌 채널보다 우선.
6. 부풀리기(이벤트·맞팔·비계측 유입) 구현 금지 — "진성" 정의 위반 + IG 도달률 훼손.
7. 유료 전환은 사다리 순서: 무로그인 좋아요 → 로그인 유인(댓글·다운로드) → 구독.
   첫 방문 결제 강요 UI 금지.
8. 두 도달점은 서로의 파이프(무한 구도): 웹→IG(ig-out)와 IG→웹(바이오·스토리, utm=ig)
   양방향을 모두 유지·강화. 한쪽을 위해 다른 쪽 장치를 제거하지 않는다.
9. 근거(2026-08-08): 웹→IG 16,016 vs 외부→웹 120 — 병목은 "외부→플라이휠 진입"과 "IG→웹".

## 코드 체크리스트
- `api/` 최상위 파일: `require('./_lib/...')` — `../_lib` 아님 (node --check는 이 오류를 못 잡는다)
- `pap-*.js` 등 프론트 JS 수정 시: 참조하는 HTML(10개)의 `?v=` 버전 올리기 (캐시버스트)
- 수정 후 `npm test` — 하네스 **전부** 통과해야 커밋 (개수는 계속 늘어난다. 2026-08-03 기준 96개)
- OAuth 성공 랜딩은 `api/_lib/oauthSuccess.js`의 `sendOAuthSuccessHtml()` 공용 헬퍼 사용 (Safari ITP 대응)
- 회원 등급 게이트 변경 시 3종(Free/Standard/Premium) + subscribe 9개 언어 문구 정합 확인
- **환경변수(env)를 바꾸면 — 추가·수정·삭제 모두 — 반드시 재배포한다.** Vercel은 env를 *빌드 시점*에 함수에 구워 넣는다. 설정 화면에서 지워도 이미 돌고 있는 배포는 옛 값을 그대로 쓴다. 코드가 안 바뀌었어도 Redeploy(빌드 캐시 끄기) 필요. → 2026-08-04 `SEO_TRANSLATE_KINDS` 삭제가 1시간 동안 먹지 않은 원인 (볼트 `45_Business/PAP_번역크론_독일어정지_2026-08-04.md`)

## 배포 검증 (커밋→푸시 이후)
1. push 후 ~95초 대기 → Vercel 배포 READY 확인
2. 라이브에서 실제 동작 확인 (브라우저/HTTP) — "코드가 맞다"가 아니라 "라이브가 된다"까지
3. 중요 작업은 볼트 `45_Business/`에 날짜 파일로 기록

## 인프라 좌표
- **작업 폴더(유일): `/Users/pap/Documents/문서/PAP_Magazine_Deploy`.** `PAP-푸시하기.command` 가 푸시하는 곳이 여기다. `~/Downloads/PAP_Magazine_Deploy` 는 맥미니 이전 때 남은 옛 사본 — 여기에 커밋하면 GitHub·Vercel 에 절대 닿지 않는다. (2026-08-04 릴스 mp4 수정본이 그 사본에 갇혀 하루를 날렸다. 작업 시작 전 `pwd` 로 확인한다.)
- Vercel: project `prj_bJ4s6cgv7HbrDYYU0mu0B9xyl3n5` / team `team_EmYMio2vO29fe2ZFbeRJ2Nsi` (env 추가·수정·삭제 모두 재배포 필요 — 위 체크리스트 참조, Sensitive 값은 저장 후 읽기 불가)
- Supabase: `igcazquhkwxtqsaqpznx` (서버는 service_role)
- 결제: Paddle (plan_key는 premium_*/standard_* → base plan으로 정규화되어 profiles 저장)

## .claude/ 구조 (2026-07-12 추가)

- `.claude/rules/api.md` — api/** 작업 규칙 · `.claude/rules/frontend.md` — frontend/** 작업 규칙 (작업 전 해당 규칙 읽기)
- `.claude/agents/code-reviewer.md` — 읽기 전용 리뷰어 (커밋 전 "code-reviewer로 리뷰해줘")
- `.claude/commands/deploy-check.md` — /deploy-check 배포 검증
- `.claude/hooks/block-push.sh` + `settings.json` — **git push·rm -rf·파괴적 SQL을 기계적으로 차단** (문서 규칙의 강제 집행)
- 사업 판단·전략·기록은 이 저장소가 아니라 PAP-Vault(옵시디언)에 있다 — 중복 저장 금지
