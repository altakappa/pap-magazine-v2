#!/bin/bash
# PreToolUse(Bash) 훅 — 절대 규칙의 기계적 집행
input=$(cat)
cmd=$(echo "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)
block() { echo "🚫 차단됨: $1 — PAP 절대 규칙 (CLAUDE.md). 이 작업은 도메니코가 직접 한다." >&2; exit 2; }
echo "$cmd" | grep -qE 'git([^;|&]*)push' && block "git push"
echo "$cmd" | grep -qE '(^|[^a-zA-Z0-9_-])pap-push\.sh' && block "pap-push.sh (git push 래퍼)"
echo "$cmd" | grep -qE 'rm[[:space:]]+-rf?[[:space:]]+[/~]' && block "rm -rf 루트/홈"
echo "$cmd" | grep -qE '(DELETE[[:space:]]+FROM|DROP[[:space:]]+TABLE)' && block "파괴적 SQL 직접 실행"

# ── 무차별 스테이징 차단 (2026-09-03) ─────────────────────────────────
# 왜: 이 저장소는 **여러 Claude 세션이 같은 워킹트리에서 동시에** 작업한다.
# 2026-08-28 에 그 때문에 양방향으로 두 번 커밋이 오염됐다.
#   · 한 세션의 `git add -A` 가 다른 세션의 seoRenderer 작업을 삼켜 커밋(51a9d64)에
#     넣었다. 푸시된 뒤라 되돌리지 못했다.
#   · 반대로 스테이징해 둔 파서 수정이 다른 세션의 `git add -A` 에 딸려가
#     무관한 커밋(db672eb, 텔레그램 크론)에 들어갔다. 커밋 메시지가 사라졌다.
# 코드는 살아남지만 **커밋 메시지가 그 변경을 설명하지 못하게 된다.** 이 저장소는
# 커밋 서사에 근거·실측·교훈을 적는 곳이라 그 손실이 크다.
#
# 그래서 커밋할 파일을 항상 명시한다: git add api/_lib/x.js tests/x.test.js
# `git add -u` 도 막는다 — 추적 중인 남의 수정까지 전부 담긴다.
blocked_add() {
  echo "🚫 차단됨: $1" >&2
  echo "" >&2
  echo "이 저장소는 여러 세션이 동시에 작업한다. 무차별 스테이징은 남의 작업을" >&2
  echo "내 커밋에 삼킨다 (2026-08-28 실제 사고 2건)." >&2
  echo "→ 파일을 명시할 것:  git add <파일1> <파일2>" >&2
  echo "→ 커밋 전 확인:      git status --short  ·  git diff --cached --name-only" >&2
  exit 2
}
echo "$cmd" | grep -qE 'git([^;|&]*)add[[:space:]]+(-A|--all|-u|--update)([[:space:]]|$)' \
  && blocked_add "git add -A / -u (무차별 스테이징)"
# `git add .` — 경로가 점 하나뿐일 때만. `git add ./api/x.js` 는 명시이므로 통과.
echo "$cmd" | grep -qE 'git([^;|&]*)add[[:space:]]+\.([[:space:]]|$)' \
  && blocked_add "git add . (무차별 스테이징)"
# commit -a / -am 은 add 를 건너뛰고 추적 파일 전부를 담는다 — 같은 사고다.
echo "$cmd" | grep -qE 'git([^;|&]*)commit[[:space:]]+(-[a-zA-Z]*a[a-zA-Z]*)([[:space:]]|$)' \
  && blocked_add "git commit -a (스테이징 건너뛰고 전부 담기)"

exit 0
