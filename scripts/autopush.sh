#!/bin/bash
# PAP 자동 푸시 집행기 — scripts/autopush.sh (2026-08-09 신설)
#
# 왜 존재하나 ─────────────────────────────────────────────────────────
# 도메니코 승인(2026-08-09): "주간 성장 R&D 의 소형 개선은 예외적으로
# 승인 없이 자동배포해도 좋다." 그런데 클로드의 작업 VM 은 GitHub 에
# 접속할 수 없다(네트워크 차단 — 이건 안전장치이기도 하다). 그래서
# 푸시는 자격증명을 가진 맥(macOS 본체)이 직접 한다:
#
#   클로드: 구현 → 전체 테스트 → 커밋([auto-r&d] 표기) → .autopush/request 에 커밋 해시 기록
#   맥:     이 스크립트가 요청서를 검증하고 조건이 전부 맞을 때만 push
#
# 2026-09-05 확장 — 도메니코가 대화에서 요청한 푸시
# ─────────────────────────────────────────────────────────────────────
# 도메니코: "내가 요청시 푸시를 클로드가 할수있게 변경해줘"
# 계기: 모바일에서 맥의 PAP-푸시하기.command 를 누를 방법이 없었다.
#
# 두 번째 경로를 연다. 요청서 **둘째 줄**에 `kind=요청` 을 적으면
# [auto-r&d] 마커가 없어도 푸시한다. 그 줄은 '도메니코가 대화에서
# 요청했다' 는 기록이고, 검증은 채팅 기록이 한다 — 이 스크립트가 할 수
# 있는 검증이 아니다. **그래서 나머지 안전핀은 그대로 둔다.**
#
#   요청서 형식
#     1줄: 커밋 해시
#     2줄: (없으면 자동 트랙) 또는 `kind=요청`
#
# 안전핀 (하나라도 어긋나면 푸시하지 않고 사유를 log 에 남긴다):
#   ① 요청서 첫 줄의 해시 == 현재 HEAD (다른 커밋을 실수로 밀지 않게)
#   ② 자동 트랙이면 HEAD 커밋 메시지에 [auto-r&d] 마커.
#      `kind=요청` 이면 이 핀만 면제된다 (도메니코가 직접 시킨 것이므로).
#   ③ 워킹트리가 깨끗함 (작업 중인 세션의 미완성 변경을 쓸어가지 않게)
#      ← 이 핀이 특히 중요해졌다. 요청 경로는 마커 검사가 없으므로,
#        남의 미완성 작업을 쓸어가지 않게 막는 건 이 핀 하나다.
# 도메니코가 직접 누르는 길(PAP-푸시하기.command)은 그대로 남는다.

# 기본값은 맥의 실제 경로. 환경변수는 **시험용**이다 — 이 안전장치를 테스트가
# 실제로 돌려 볼 수 있어야 안전핀이 살아 있는지 확인할 수 있다(2026-09-05).
REPO="${PAP_AUTOPUSH_REPO:-/Users/pap/Documents/문서/PAP_Magazine_Deploy}"
DIR="$REPO/.autopush"
REQ="$DIR/request"
LOG="$DIR/log.txt"

# 가동 증명 — 홈 폴더에도 남긴다 (문서 폴더가 TCC 로 안 보일 때 진단용).
HLOG="$HOME/.pap-autopush.log"
if [ ! -d "$REPO" ]; then
  echo "$(date '+%F %T') 🚨 저장소 접근 불가 — 시스템설정>개인정보보호>전체디스크접근권한 에 /bin/bash 추가 필요" >> "$HLOG"
  exit 1
fi
[ -f "$REQ" ] || exit 0
cd "$REPO" || { echo "$(date '+%F %T') 🚨 cd 실패" >> "$HLOG"; exit 1; }
mkdir -p "$DIR"
ts() { date "+%Y-%m-%d %H:%M:%S"; }

# 첫 줄만 해시로 읽는다. 둘째 줄은 종류(없으면 자동 트랙) — 옛 한 줄 요청서도 그대로 동작한다.
WANT=$(sed -n '1p' "$REQ" | tr -d '[:space:]')
KIND=$(sed -n '2p' "$REQ" | tr -d '[:space:]')
HEAD=$(git rev-parse HEAD 2>/dev/null)

if [ -z "$WANT" ] || [ "$WANT" != "$HEAD" ]; then
  echo "$(ts) 거부① 해시 불일치: 요청=$WANT HEAD=$HEAD" >> "$LOG"
  rm -f "$REQ"; exit 0
fi

if [ "$KIND" = "kind=요청" ]; then
  # 도메니코가 대화에서 시킨 푸시 — 마커 검사를 면제한다. 무엇을 밀었는지 크게 남긴다.
  echo "$(ts) 📌 도메니코 요청 푸시 (마커 면제): $(git log -1 --pretty='%h %s')" >> "$LOG"
else
  MSG=$(git log -1 --pretty=%B)
  case "$MSG" in
    *"[auto-r&d]"*) : ;;
    *) echo "$(ts) 거부② [auto-r&d] 마커 없는 커밋 — 자동배포 구역 아님 (도메니코 요청이면 요청서 둘째 줄에 kind=요청)" >> "$LOG"
       rm -f "$REQ"; exit 0 ;;
  esac
fi

if [ -n "$(git status --porcelain | grep -v '^?? .autopush')" ]; then
  echo "$(ts) 거부③ 워킹트리 미정리 — 다른 작업 진행 중 의심" >> "$LOG"
  rm -f "$REQ"; exit 0
fi

if git push origin main >> "$LOG" 2>&1; then
  echo "$(ts) ✅ 자동 푸시 완료: $HEAD" >> "$LOG"
  echo "$(date '+%F %T') ✅ 자동 푸시 완료: $HEAD" >> "$HLOG"
else
  echo "$(ts) 🚨 푸시 실패 — log 위쪽 git 출력 확인" >> "$LOG"
fi
rm -f "$REQ"
