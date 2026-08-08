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
# 안전핀 (하나라도 어긋나면 푸시하지 않고 사유를 log 에 남긴다):
#   ① 요청서의 해시 == 현재 HEAD (다른 커밋을 실수로 밀지 않게)
#   ② HEAD 커밋 메시지에 [auto-r&d] 마커 (자동배포 허용 구역 커밋만)
#   ③ 워킹트리가 깨끗함 (작업 중인 세션의 미완성 변경을 쓸어가지 않게)
# 일반 작업은 지금까지처럼 PAP-푸시하기.command 로 도메니코가 직접.

REPO="/Users/pap/Documents/문서/PAP_Magazine_Deploy"
DIR="$REPO/.autopush"
REQ="$DIR/request"
LOG="$DIR/log.txt"

[ -f "$REQ" ] || exit 0
cd "$REPO" || exit 1
mkdir -p "$DIR"
ts() { date "+%Y-%m-%d %H:%M:%S"; }

WANT=$(tr -d '[:space:]' < "$REQ")
HEAD=$(git rev-parse HEAD 2>/dev/null)

if [ -z "$WANT" ] || [ "$WANT" != "$HEAD" ]; then
  echo "$(ts) 거부① 해시 불일치: 요청=$WANT HEAD=$HEAD" >> "$LOG"
  rm -f "$REQ"; exit 0
fi

MSG=$(git log -1 --pretty=%B)
case "$MSG" in
  *"[auto-r&d]"*) : ;;
  *) echo "$(ts) 거부② [auto-r&d] 마커 없는 커밋 — 자동배포 구역 아님" >> "$LOG"
     rm -f "$REQ"; exit 0 ;;
esac

if [ -n "$(git status --porcelain | grep -v '^?? .autopush')" ]; then
  echo "$(ts) 거부③ 워킹트리 미정리 — 다른 작업 진행 중 의심" >> "$LOG"
  rm -f "$REQ"; exit 0
fi

if git push origin main >> "$LOG" 2>&1; then
  echo "$(ts) ✅ 자동 푸시 완료: $HEAD" >> "$LOG"
else
  echo "$(ts) 🚨 푸시 실패 — log 위쪽 git 출력 확인" >> "$LOG"
fi
rm -f "$REQ"
