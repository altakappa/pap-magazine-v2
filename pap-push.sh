#!/bin/bash
# PAP 푸시 스크립트 — 도메니코 전용. 여기서만 라이브로 나간다.
#
# 2026-08-05 개정: 푸시 전에 반드시 pull --rebase 를 먼저 한다.
#
# 왜 — 2026-08-05 하루에 "받지 않고 올려서" 거부당한 사고가 두 번 났다.
#   · 저장소: 22커밋 뒤처진 채 푸시 → 병합 충돌
#   · 볼트  : [rejected] main -> main (fetch first)
# 사람이 기억해서 지키는 순서는 반드시 깨진다. 스크립트가 강제한다.
set -u
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

if [ ! -t 0 ]; then
  echo "🚫 대화형 터미널이 아니다. 푸시는 도메니코가 직접 한다. (PAP 절대 규칙)"
  exit 1
fi

rm -f .git/index.lock 2>/dev/null

# 1) 미커밋이 있으면 멈춘다 — rebase 가 안 된다
dirty=$(git status --porcelain)
if [ -n "$dirty" ]; then
  echo "⚠️  커밋 안 된 변경이 있다. 먼저 커밋하고 다시 실행할 것."
  echo "$dirty" | sed 's/^/     /'
  echo
  echo "   커밋하려면:  ./push.sh \"메시지\""
  exit 1
fi

# 2) 원격 것을 먼저 받는다 (이게 핵심)
echo "▸ 원격에서 최신 받는 중..."
if ! git pull --rebase; then
  echo
  echo "🚫 충돌이 났다. 아무것도 안 바꾸고 되돌린다."
  git rebase --abort 2>/dev/null
  echo "   위 충돌 내용을 그대로 Claude 에게 보여줄 것."
  exit 1
fi

# 3) 올릴 게 있나
ahead=$(git log --oneline @{u}..HEAD 2>/dev/null)
if [ -z "$ahead" ]; then
  echo "✅ 올릴 커밋이 없다. 이미 원격과 같다."
  exit 0
fi

echo
echo "다음 커밋이 라이브로 나간다:"
echo "$ahead" | sed 's/^/   /'
echo
echo "   → 푸시하면 Vercel 이 자동 배포한다. 약 90초 뒤 반영."
echo
printf "올릴까? [y/N] "
read -r ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "취소했다. (원격 것은 이미 받아 놓은 상태다)"; exit 1 ;;
esac

git push || exit 1
echo
echo "✅ 푸시 완료. Vercel 배포 확인:"
echo "   https://vercel.com/altakappas-projects/pap-magazine-v2"
