#!/bin/bash
# PreToolUse(Bash) 훅 — 절대 규칙의 기계적 집행
input=$(cat)
cmd=$(echo "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)
block() { echo "🚫 차단됨: $1 — PAP 절대 규칙 (CLAUDE.md). 이 작업은 도메니코가 직접 한다." >&2; exit 2; }
echo "$cmd" | grep -qE 'git([^;|&]*)push' && block "git push"
echo "$cmd" | grep -qE '(^|[^a-zA-Z0-9_-])pap-push\.sh' && block "pap-push.sh (git push 래퍼)"
echo "$cmd" | grep -qE 'rm[[:space:]]+-rf?[[:space:]]+[/~]' && block "rm -rf 루트/홈"
echo "$cmd" | grep -qE '(DELETE[[:space:]]+FROM|DROP[[:space:]]+TABLE)' && block "파괴적 SQL 직접 실행"
exit 0
