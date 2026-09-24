#!/bin/bash
# PAP-Vault 자동 푸시 집행기 — scripts/vault-autopush.sh (2026-09-25 신설)
#
# 왜 존재하나 ─────────────────────────────────────────────────────────
# 도메니코(2026-09-25): "볼트에도 푸시할 수 있게 변경해줘"
# 계기: "이전에 안 올라간 것까지 모두 푸시해줘" 했더니 웹사이트는 다 올라갔는데
# 볼트는 커밋 39개 + 변경 190개가 남아 있었다. 볼트는 볼트-푸시하기.command 를
# 맥에서 더블클릭해야만 올라가서, 모바일에서는 방법이 없었다.
#
# 웹사이트 저장소와 같은 구조를 쓴다. 클로드 VM 은 GitHub 에 못 닿으므로
# 자격증명을 가진 맥이 대신 민다:
#
#   클로드: 볼트 변경을 **파일 이름을 보고** 골라 커밋 → 볼트 .autopush/request 에
#           1줄 커밋 해시(= HEAD) · 2줄 kind=요청
#   맥:     이 스크립트를 scripts/autopush.sh 가 60초마다 부른다 (LaunchAgent
#           com.pap.autopush 를 그대로 쓴다. 새로 설치할 것 없음)
#
# 안전핀 (하나라도 어긋나면 밀지 않고 사유를 볼트 .autopush/log.txt 에 남긴다):
#   ① 요청서 해시 == 현재 HEAD
#   ② 둘째 줄이 kind=요청. 볼트에는 자동 트랙이 없다. 도메니코가 대화에서 시킨 것만.
#   ③ main 브랜치에서만
#   ④ iCloud 껍데기 방지 (도메니코-설명서: "맥미니의 볼트가 iCloud 껍데기면 빈 파일이
#      깃허브를 덮어쓴다"). 원격(origin/main)과 비교해
#        · 지워지는 파일 20개 초과, 또는
#        · 원격에서 내용이 있던 파일이 0바이트가 된 것 5개 초과, 또는
#        · 추적 파일 수가 원격의 80% 미만
#      이면 거부한다.
#
# 워킹트리 청결 핀은 **일부러 두지 않는다.** 웹사이트와 달리 볼트는 옵시디언과
# 여러 세션이 늘 파일을 고치고 있어서 그 핀이 있으면 영영 못 민다. push 는
# 커밋된 것만 올라가므로 커밋 안 된 남의 작업은 어차피 따라가지 않는다.
#
# 도메니코가 직접 누르는 길(볼트-푸시하기.command)은 그대로 남는다.

VAULT="${PAP_VAULT_AUTOPUSH_REPO:-/Users/pap/Documents/문서/PAP-Vault}"
DIR="$VAULT/.autopush"
REQ="$DIR/request"
LOG="$DIR/log.txt"

[ -d "$VAULT" ] || exit 0
[ -f "$REQ" ] || exit 0
cd "$VAULT" || exit 0
ts() { date "+%Y-%m-%d %H:%M:%S"; }
done_req() { rm -f "$REQ"; exit 0; }

# 클로드 VM 은 잠금 파일을 못 지운다. 2분 넘은 잠금은 맥이 치운다 (볼트-푸시하기.command 와 같은 처리).
for L in .git/index.lock .git/HEAD.lock; do
  if [ -f "$L" ] && [ -z "$(find "$L" -mmin -2 2>/dev/null)" ]; then rm -f "$L"; fi
done

WANT=$(sed -n '1p' "$REQ" | tr -d '[:space:]')
KIND=$(sed -n '2p' "$REQ" | tr -d '[:space:]')
HEAD=$(git rev-parse HEAD 2>/dev/null)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ -z "$WANT" ] || [ "$WANT" != "$HEAD" ]; then
  echo "$(ts) 거부① 해시 불일치: 요청=$WANT HEAD=$HEAD" >> "$LOG"; done_req
fi
if [ "$KIND" != "kind=요청" ]; then
  echo "$(ts) 거부② kind=요청 없음 — 볼트는 도메니코가 시킨 푸시만" >> "$LOG"; done_req
fi
if [ "$BRANCH" != "main" ]; then
  echo "$(ts) 거부③ main 이 아님: $BRANCH" >> "$LOG"; done_req
fi

GIT_TERMINAL_PROMPT=0 git fetch -q origin main 2>/dev/null   # 실패해도 마지막으로 아는 origin/main 과 비교한다
BASE=$(git rev-parse -q --verify origin/main 2>/dev/null)
if [ -n "$BASE" ]; then
  DEL=$(git diff --diff-filter=D --name-only "$BASE" HEAD | wc -l | tr -d ' ')
  EMPTIED=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    old=$(git cat-file -s "$BASE:$f" 2>/dev/null || echo 0)
    new=$(git cat-file -s "HEAD:$f" 2>/dev/null || echo 0)
    if [ "$old" -gt 0 ] && [ "$new" -eq 0 ]; then EMPTIED=$((EMPTIED + 1)); fi
  done < <(git -c core.quotepath=false diff --diff-filter=M --name-only "$BASE" HEAD)   # 한글 파일명이 \354… 로 따옴표 처리되면 cat-file 이 못 찾는다
  N_BASE=$(git ls-tree -r --name-only "$BASE" | wc -l | tr -d ' ')
  N_HEAD=$(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ')
  if [ "$DEL" -gt 20 ] || [ "$EMPTIED" -gt 5 ] || [ $((N_HEAD * 5)) -lt $((N_BASE * 4)) ]; then
    echo "$(ts) 거부④ 대량 삭제·빈 파일 의심 (iCloud 껍데기?): 삭제 $DEL · 빈파일 $EMPTIED · 파일 $N_BASE→$N_HEAD" >> "$LOG"; done_req
  fi
fi

if GIT_TERMINAL_PROMPT=0 git push origin main >> "$LOG" 2>&1; then
  echo "$(ts) ✅ 볼트 푸시 완료: $(git log -1 --pretty='%h %s')" >> "$LOG"
  echo "$(date '+%F %T') ✅ 볼트 푸시 완료: $HEAD" >> "$HOME/.pap-autopush.log"
else
  echo "$(ts) 🚨 볼트 푸시 실패 — 위 git 출력 확인 (인증이면 볼트-푸시하기.command 를 한 번 눌러 키체인 갱신)" >> "$LOG"
fi
done_req
