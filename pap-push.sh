#!/bin/bash
# PAP 푸시 스크립트 — 도메니코 전용. 여기서만 라이브로 나간다.
#
# 2026-08-03 신설. push.sh 에서 분리했다. 커밋과 푸시를 한 명령에 묶어 두면
# "커밋만 하려다 배포까지" 가 구조적으로 막히지 않는다.
#
# 자동 세션(Claude)은 이 스크립트를 실행하지 않는다. 대화형 터미널이
# 아니면 스스로 거부한다.
set -u
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

if [ ! -t 0 ]; then
  echo "🚫 대화형 터미널이 아니다. 푸시는 도메니코가 직접 한다. (PAP 절대 규칙)"
  exit 1
fi

dirty=$(git status --porcelain)
if [ -n "$dirty" ]; then
  echo "⚠️  커밋 안 된 변경이 남아 있다 (푸시에는 안 들어간다):"
  echo "$dirty" | sed 's/^/   /'
  echo
fi

git fetch origin --quiet 2>/dev/null
ahead=$(git log --oneline @{u}..HEAD 2>/dev/null)
if [ -z "$ahead" ]; then
  echo "올릴 커밋이 없다. origin 과 같다."
  exit 0
fi

echo "다음 커밋이 라이브로 나간다:"
echo "$ahead" | sed 's/^/   /'
echo
echo "   → 푸시하면 Vercel 이 자동 배포한다. 약 90초 뒤 반영."
echo

printf "올릴까? [y/N] "
read -r ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "취소했다."; exit 1 ;;
esac

git push || exit 1
echo
echo "✅ 푸시 완료. Vercel 배포 확인:"
echo "   https://vercel.com/altakappas-projects/pap-magazine-v2"
