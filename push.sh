#!/bin/bash
# PAP 커밋 스크립트 — 커밋까지만 한다. push 는 하지 않는다.
#
# 2026-08-03 (도메니코 승인): 여기서 `git push` 를 뺐다.
#
# 왜 —
#   (1) 이 스크립트가 push 를 감싸고 있어서, .claude/hooks/block-push.sh 의
#       차단 정규식(git…push)이 한 번도 걸리지 않았다. `./push.sh` 라는
#       문자열에는 "git" 도 "push" 명령도 없다. 절대 규칙이 있는데도
#       2026-08-03 하루에 무단 푸시가 두 번 났다.
#   (2) `git add -A` 는 작업 트리에 있는 걸 전부 쓸어담는다. 다른 세션이
#       만들던 중인 파일까지 함께 커밋·배포됐다.
#
# 푸시는 ./pap-push.sh 로 도메니코가 직접 한다.
set -u
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1
rm -f .git/index.lock 2>/dev/null

changed=$(git status --porcelain)
if [ -z "$changed" ]; then
  echo "변경 없음. 커밋할 게 없다."
  exit 0
fi

echo "다음 파일이 커밋된다:"
echo "$changed" | sed 's/^/   /'
echo

if [ ! -t 0 ]; then
  echo "🚫 대화형 터미널이 아니다. 통째 커밋(git add -A)을 막는다."
  echo "   자동 세션은 필요한 파일만 골라서 커밋할 것:"
  echo "     git add <파일들> && git commit -m '...'"
  exit 1
fi

printf "전부 커밋할까? 모르는 파일이 섞여 있으면 n. [y/N] "
read -r ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "취소했다."; exit 1 ;;
esac

git add -A
git commit -m "${1:-update}" || exit 1

echo
echo "✅ 커밋 완료 — 아직 라이브 아니다."
git log --oneline -1
echo
echo "   라이브로 올리려면:  ./pap-push.sh"
