#!/bin/bash
#
# PAP 영상 자동 압축기 v2.1 (맥미니용)  — 2026-08-09 / 2026-08-17 대기경보 추가
# ─────────────────────────────────────────────────────────────
# v1 과 하는 일은 같다. 고친 것은 "실패했을 때의 행동" 세 가지다.
#
#  ① 실패한 파일을 치운다.
#     v1 은 실패해도 파일을 감시 폴더에 그대로 뒀다. launchd 가 5분 뒤 또 부르고
#     또 실패한다 — 영원히. 그래서 실패 신호가 무한 반복되고, 진짜 신호가 묻힌다.
#     v2 는 같은 파일이 MAX_FAILS(기본 2)번 실패하면 `실패/` 로 옮기고 그 이름을
#     서버 신호에 실어 보낸다.
#
#  ② 2-pass 실패를 실패라고 말한다.
#     v1 은 2-pass 두 번의 ffmpeg 성공 여부를 안 봤다. 실패하면 결과 파일이 없어
#     "결과 파일이 비정상적으로 작음" 이라는 **엉뚱한 사유**가 로그에 남았다.
#
#  ③ '아직 안 받아진 파일' 과 '진짜 깨진 파일' 을 구분한다.
#     구글 드라이브 데스크톱은 파일 목록만 보여주고 내용은 나중에 받는다
#     (스트리밍 모드). 그 상태의 파일은 크기는 정상인데 읽으면 실패한다.
#     v2 는 ffprobe 로 먼저 열어보고, 못 열면 실패가 아니라 '대기' 로 넘긴다.
#
# ── 2026-08-17 추가 ────────────────────────────────────────────
#  ④ '너무 오래 대기하는 파일' 을 알린다.
#     ③ 덕분에 멀쩡한 파일이 실패 폴더로 안 치워지게 됐다. 그런데 그 대신
#     **영원히 조용히 기다리는** 새 구멍이 생겼다. 260815_콜드인터뷰.mov 는
#     8월 14일부터 사흘 동안 대기만 했고, 로그에도 신호에도 "대기 N건" 이라는
#     숫자 하나뿐이라 아무도 몰랐다. 유튜브에는 그 인터뷰가 끝내 안 올라갔다.
#     v2.1 은 대기 시작 시각을 장부에 적고, PAP_WAIT_ALERT_DAYS(기본 1일)를
#     넘기면 **실패와 똑같이** 서버에 ok=0 신호를 보낸다. 침묵은 정상이 아니다.
#
# 로그: ~/Library/Logs/pap-video-compress.log
#
# 사용법:
#   ./pap-video-compress-v2.sh            한 번 훑고 끝 (launchd 가 반복 호출)
#   ./pap-video-compress-v2.sh --dry      안 건드리고 뭘 할지만 출력
#   ./pap-video-compress-v2.sh --file "/경로/영상.mov"
#                                         한 파일만 압축 + ffmpeg 오류 전문 출력
#                                         ← 지금 막힌 파일 진단·수동 처리용
#

set -uo pipefail

# ── 설정 (v1 과 동일) ────────────────────────────────────────
MAX_MB="${PAP_MAX_MB:-80}"
MAX_WIDTH="${PAP_MAX_WIDTH:-1080}"
CRF="${PAP_CRF:-23}"
AUDIO_KBPS="${PAP_AUDIO_KBPS:-128}"
STABLE_WAIT="${PAP_STABLE_WAIT:-10}"
LOG="${PAP_LOG:-$HOME/Library/Logs/pap-video-compress.log}"
# 같은 파일이 몇 번 실패하면 치울지. 일시적 오류(동기화 중 등)에 성급하지 않게 2회.
MAX_FAILS="${PAP_MAX_FAILS:-2}"
# 실패 횟수 장부. 드라이브 폴더에 두면 동기화되므로 홈에 둔다.
FAILDB="${PAP_FAILDB:-$HOME/.pap-video-compress-fails}"
# 대기 시작 시각 장부(2026-08-17 신설). 역시 홈에 둔다.
WAITDB="${PAP_WAITDB:-$HOME/.pap-video-compress-waits}"
# 며칠 넘게 대기만 하면 '고장'으로 보고 알릴지. 0 이면 이 경보를 끈다.
WAIT_ALERT_DAYS="${PAP_WAIT_ALERT_DAYS:-1}"

DRY=0
ONE=""
case "${1:-}" in
  --dry)  DRY=1 ;;
  --file) ONE="${2:-}"; [ -n "$ONE" ] || { echo "사용법: $0 --file '/경로/영상.mov'"; exit 2; } ;;
esac

find_watch_dir() {
  if [ -n "${PAP_WATCH_DIR:-}" ] && [ -d "$PAP_WATCH_DIR" ]; then echo "$PAP_WATCH_DIR"; return 0; fi
  local base sub
  for base in "$HOME/Library/CloudStorage"/GoogleDrive-* "$HOME/Google Drive"; do
    [ -d "$base" ] || continue
    for sub in "My Drive" "내 드라이브" "."; do
      if [ -d "$base/$sub/유튜브" ]; then echo "$base/$sub/유튜브"; return 0; fi
    done
  done
  return 1
}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
mkdir -p "$(dirname "$LOG")"
touch "$FAILDB" 2>/dev/null || true
touch "$WAITDB" 2>/dev/null || true
TAB="$(printf '\t')"

# ── 실패 장부 ────────────────────────────────────────────────
# 한 줄에 "실패횟수<TAB>파일이름". 이름만 쓴다(경로는 바뀔 수 있다).
fail_count() { awk -F'\t' -v n="$1" '$2==n{print $1; f=1} END{if(!f)print 0}' "$FAILDB" 2>/dev/null | tail -1; }
fail_bump() {
  local n="$1" c
  c=$(fail_count "$n"); c=$((c+1))
  grep -v -F "	$n" "$FAILDB" 2>/dev/null > "$FAILDB.tmp" || true
  printf '%s\t%s\n' "$c" "$n" >> "$FAILDB.tmp"
  mv "$FAILDB.tmp" "$FAILDB"
  echo "$c"
}
fail_clear() {
  grep -v -F "	$1" "$FAILDB" 2>/dev/null > "$FAILDB.tmp" || true
  mv "$FAILDB.tmp" "$FAILDB"
}

# ── 대기 장부 (2026-08-17 신설) ──────────────────────────────
# 한 줄에 "처음 대기한 시각(초)<TAB>파일이름".
# 실패 장부와 다르게 '지우기'가 없다. 훑을 때마다 지금 대기 중인 것만 모아
# 통째로 새로 쓰기 때문이다. 압축됐거나 사라진 파일은 저절로 빠지므로,
# 이름이 바뀌거나 손으로 옮겨도 유령 항목이 남지 않는다.
wait_first_seen() {
  awk -F'\t' -v n="$1" '$2==n{print $1; f=1; exit} END{if(!f) print 0}' "$WAITDB" 2>/dev/null
}
# stdin 으로 받은 줄들을 장부에 통째로 쓴다. --dry 는 아무것도 안 바꾼다.
wait_save() {
  if [ $DRY -eq 1 ]; then cat >/dev/null; return 0; fi
  cat > "$WAITDB.tmp" 2>/dev/null && mv "$WAITDB.tmp" "$WAITDB" 2>/dev/null || true
}

# ── 죽은사람 스위치 (v1 과 동일 + 사유를 더 자세히) ──────────
beat() {
  local ok="$1" note="$2" done_n="${3:-0}" failed_n="${4:-0}"
  [ "${PAP_BEAT:-1}" = "0" ] && return 0
  local url="${PAP_BEAT_URL:-https://www.pap-magazine.com/api/ops/heartbeat}"
  curl -fsS --max-time 10 -o /dev/null -G "$url" \
    --data-urlencode "source=video-compress" \
    --data-urlencode "ok=$ok" \
    --data-urlencode "note=$note" \
    --data-urlencode "host=$(hostname -s 2>/dev/null || echo mac)" \
    --data-urlencode "done=$done_n" \
    --data-urlencode "failed=$failed_n" \
    ${PAP_BEAT_TOKEN:+--data-urlencode "token=$PAP_BEAT_TOKEN"} \
    2>/dev/null || true
}

WATCH="$(find_watch_dir)" || {
  log "❌ 드라이브 '유튜브' 폴더를 못 찾음."
  beat 0 "드라이브 유튜브 폴더 못 찾음"
  exit 1
}
command -v ffmpeg >/dev/null 2>&1 || { log "❌ ffmpeg 없음. 'brew install ffmpeg' 먼저."; beat 0 "ffmpeg 없음"; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { log "❌ ffprobe 없음. 'brew install ffmpeg' 먼저."; beat 0 "ffprobe 없음"; exit 1; }

# 동시 실행 방지 (수동 --file 모드는 락을 쓰지 않는다)
if [ $DRY -eq 0 ] && [ -z "$ONE" ]; then
  LOCK="/tmp/pap-video-compress.lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
      log "⚠️ 오래된 락 회수"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null
    else
      exit 0
    fi
  fi
  trap 'rm -rf "$LOCK"' EXIT
fi

ARCHIVE="$WATCH/원본"
FAILDIR="$WATCH/실패"
[ $DRY -eq 0 ] && mkdir -p "$ARCHIVE"

MAX_BYTES=$(( MAX_MB * 1024 * 1024 ))

# 실패 사유를 담아 두는 전역 (process 가 채운다)
LAST_REASON=""

# ── 파일 하나 처리 ───────────────────────────────────────────
# 반환값: 0 성공/대상아님 · 1 실패 · 2 아직 대기(실패로 세지 않음)
process() {
  local src="$1" verbose="${2:-0}"
  local name base ext size
  name="$(basename "$src")"
  base="${name%.*}"
  ext="$(echo "${name##*.}" | tr '[:upper:]' '[:lower:]')"
  size=$(stat -f%z "$src" 2>/dev/null || echo 0)
  LAST_REASON=""

  if [ "$ext" = "mp4" ] && [ "$size" -le "$MAX_BYTES" ] && [ -z "$ONE" ]; then
    return 0
  fi

  # 동기화 안정성 — 크기가 안 변해야 손을 댄다
  if [ -z "$ONE" ]; then
    sleep "$STABLE_WAIT"
    local size2; size2=$(stat -f%z "$src" 2>/dev/null || echo 0)
    if [ "$size" != "$size2" ]; then
      log "⏳ 아직 동기화 중이라 건너뜀: $name"
      LAST_REASON="동기화 중(크기가 계속 변함)"
      return 2
    fi
  fi

  # ★ v2 신설 — 진짜로 읽히는 파일인지 먼저 확인한다.
  # 구글 드라이브 스트리밍 모드의 파일은 크기는 보이는데 내용이 없다.
  # 이걸 '압축 실패' 로 세면 멀쩡한 파일을 실패 폴더로 치워 버린다.
  local probe
  if ! probe=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src" 2>&1); then
    log "⏳ 아직 못 읽는 파일 (드라이브가 내용을 안 받았거나 권한 문제): $name"
    [ "$verbose" = "1" ] && echo "--- ffprobe 오류 ---" && echo "$probe"
    LAST_REASON="드라이브에서 내용 미수신(ffprobe 실패)"
    return 2
  fi

  local mb=$(( size / 1024 / 1024 ))
  local out="$WATCH/$base.mp4"
  if [ -e "$out" ] && [ "$out" != "$src" ]; then out="$WATCH/${base}_압축.mp4"; fi
  local tmp="$WATCH/.압축중_$$_$base.mp4"

  if [ $DRY -eq 1 ]; then log "[dry] $name (${mb}MB) → $(basename "$out")"; return 0; fi

  log "🎬 압축 시작: $name (${mb}MB)"
  local vf="scale='min(${MAX_WIDTH},iw)':-2"
  local err1=""

  if ! err1=$(ffmpeg -y -nostdin -loglevel error -i "$src" \
      -vf "$vf" -c:v libx264 -crf "$CRF" -preset medium -pix_fmt yuv420p \
      -profile:v high -level 4.1 \
      -c:a aac -b:a "${AUDIO_KBPS}k" -ar 48000 -movflags +faststart \
      "$tmp" 2>&1); then
    log "❌ 압축 실패(1차 인코딩): $name"
    echo "$err1" | tail -5 >> "$LOG"
    [ "$verbose" = "1" ] && echo "--- ffmpeg 1차 오류 전문 ---" && echo "$err1"
    LAST_REASON="1차 인코딩 실패: $(echo "$err1" | tail -1 | cut -c1-120)"
    rm -f "$tmp"
    return 1
  fi

  local outsize; outsize=$(stat -f%z "$tmp" 2>/dev/null || echo 0)

  if [ "$outsize" -gt "$MAX_BYTES" ]; then
    local dur vbits
    dur=$(echo "$probe" | cut -d. -f1)
    case "$dur" in ''|*[!0-9]*) dur=60 ;; esac
    [ "$dur" -lt 1 ] && dur=60
    vbits=$(( (MAX_BYTES * 8 / dur) - (AUDIO_KBPS * 1000) ))
    vbits=$(( vbits * 94 / 100 ))
    [ "$vbits" -lt 300000 ] && vbits=300000
    log "   ↻ $(( outsize / 1024 / 1024 ))MB — 목표 초과. 비트레이트 $(( vbits / 1000 ))kbps 로 재압축"
    rm -f "$tmp"
    local passlog="/tmp/pap2pass_$$"     # ★ v2: 드라이브 폴더 밖에 둔다 (동기화 간섭 방지)
    local err2=""
    # ★ v2: 두 패스의 성공 여부를 실제로 본다
    if ! err2=$( { ffmpeg -y -nostdin -loglevel error -i "$src" -vf "$vf" \
          -c:v libx264 -b:v "$vbits" -preset medium -pix_fmt yuv420p -pass 1 -passlogfile "$passlog" \
          -an -f mp4 /dev/null \
      && ffmpeg -y -nostdin -loglevel error -i "$src" -vf "$vf" \
          -c:v libx264 -b:v "$vbits" -preset medium -pix_fmt yuv420p -pass 2 -passlogfile "$passlog" \
          -profile:v high -level 4.1 \
          -c:a aac -b:a "${AUDIO_KBPS}k" -ar 48000 -movflags +faststart "$tmp"; } 2>&1 ); then
      log "❌ 압축 실패(2-pass 재압축): $name"
      echo "$err2" | tail -5 >> "$LOG"
      [ "$verbose" = "1" ] && echo "--- ffmpeg 2-pass 오류 전문 ---" && echo "$err2"
      LAST_REASON="2-pass 실패: $(echo "$err2" | tail -1 | cut -c1-120)"
      rm -f "$tmp" "$passlog"-*.log "$passlog"-*.log.mbtree
      return 1
    fi
    rm -f "$passlog"-*.log "$passlog"-*.log.mbtree
    outsize=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
  fi

  if [ "$outsize" -lt 10000 ]; then
    log "❌ 결과 파일이 비정상적으로 작음 — 버림: $name"
    LAST_REASON="결과 파일 ${outsize}바이트 — 비정상"
    rm -f "$tmp"
    return 1
  fi

  local outmb=$(( outsize / 1024 / 1024 ))
  mv "$tmp" "$out"
  if [ "$src" != "$out" ]; then
    mkdir -p "$ARCHIVE"
    mv "$src" "$ARCHIVE/$name" 2>/dev/null || log "⚠️ 원본 이동 실패(무시): $name"
  fi

  if [ "$outsize" -gt "$MAX_BYTES" ]; then
    log "⚠️ 압축했지만 아직 ${outmb}MB (>${MAX_MB}MB): $(basename "$out") — 영상이 너무 길 수 있음"
  else
    log "✅ 완료: $name (${mb}MB) → $(basename "$out") (${outmb}MB)"
  fi
  return 0
}

# ── 수동 한 파일 모드 ────────────────────────────────────────
if [ -n "$ONE" ]; then
  [ -f "$ONE" ] || { echo "그런 파일이 없다: $ONE"; exit 2; }
  echo "── 한 파일만 처리 (오류가 나면 전문을 그대로 보여준다) ──"
  process "$ONE" 1
  rc=$?
  case $rc in
    0) echo "✅ 처리 완료";;
    2)
      echo "⏳ 아직 처리할 수 없는 상태: $LAST_REASON"
      # 언제부터 이 상태였는지 알려준다 — '방금부터'와 '사흘째'는 완전히 다른 얘기다.
      one_first=$(wait_first_seen "$(basename "$ONE")")
      case "$one_first" in ''|*[!0-9]*) one_first=0 ;; esac
      if [ "$one_first" -gt 0 ]; then
        echo "   ↳ $(( ( $(date +%s) - one_first ) / 3600 ))시간째 대기 중이다."
        echo "   ↳ 구글 드라이브에서 이 파일 우클릭 → '오프라인 액세스 사용 설정' 하면 풀린다."
      fi
      ;;
    *) echo "❌ 실패: $LAST_REASON";;
  esac
  exit $rc
fi

# ── 훑기 ─────────────────────────────────────────────────────
count=0; made=0; failed=0; waiting=0; quarantined=""
NOW="$(date +%s)"
WAITLINES=""           # 이번 훑기에서 대기 중인 것들 (장부에 통째로 다시 쓴다)
STUCK=""; stuck_n=0    # 기준일을 넘긴 것들 (경보 대상)
WAIT_ALERT_SECS=$(( WAIT_ALERT_DAYS * 86400 ))
while IFS= read -r f; do
  [ -f "$f" ] || continue
  nm="$(basename "$f")"
  case "$nm" in .*) continue;; esac
  count=$((count+1))
  if process "$f"; then
    [ ! -e "$f" ] && { made=$((made+1)); fail_clear "$nm"; }
  else
    rc=$?
    if [ "$rc" = "2" ]; then
      waiting=$((waiting+1))
      # 대기는 실패가 아니다 — 실패 장부에는 안 적는다.
      # 대신 '언제부터 대기 중인지'는 적는다. 그래야 조용히 안 묻힌다.
      first=$(wait_first_seen "$nm")
      case "$first" in ''|*[!0-9]*) first=0 ;; esac
      [ "$first" -le 0 ] && first="$NOW"
      [ "$first" -gt "$NOW" ] && first="$NOW"   # 시계가 뒤로 갔을 때 방어
      WAITLINES="${WAITLINES}${first}${TAB}${nm}
"
      held=$(( NOW - first ))
      if [ "$WAIT_ALERT_SECS" -gt 0 ] && [ "$held" -ge "$WAIT_ALERT_SECS" ]; then
        hours=$(( held / 3600 ))
        stuck_n=$((stuck_n+1))
        log "🚨 ${hours}시간째 대기만 하고 있다: $nm  (${LAST_REASON:-사유불명})"
        log "   ↳ 구글 드라이브에서 우클릭 → '오프라인 액세스 사용 설정' 하면 풀린다."
        # 신호 note 는 서버에서 300자로 잘린다. 이름은 3개까지만 싣는다.
        if [ "$stuck_n" -le 3 ]; then
          STUCK="$STUCK${STUCK:+, }$nm(${hours}시간)"
        fi
      fi
      continue
    fi
    failed=$((failed+1))
    c=$(fail_bump "$nm")
    log "   ↳ 누적 실패 ${c}/${MAX_FAILS}회: $nm  ($LAST_REASON)"
    # ★ v2 핵심 — 반복 실패하는 파일은 치운다. 안 치우면 5분마다 영원히 실패한다.
    if [ "$c" -ge "$MAX_FAILS" ]; then
      mkdir -p "$FAILDIR"
      if mv "$f" "$FAILDIR/$nm" 2>/dev/null; then
        log "🧺 ${MAX_FAILS}회 실패 — 실패/ 로 옮김: $nm"
        quarantined="$quarantined${quarantined:+, }$nm"
        fail_clear "$nm"
      else
        log "⚠️ 실패/ 로 옮기지 못함: $nm"
      fi
    fi
  fi
done < <(find "$WATCH" -maxdepth 1 -type f \
          \( -iname '*.mov' -o -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.avi' -o -iname '*.mkv' \) \
          2>/dev/null)

# 대기 장부를 이번 훑기 기준으로 통째로 새로 쓴다.
# (풀린 파일과 사라진 파일은 여기서 자동으로 빠진다)
printf '%s' "$WAITLINES" | wait_save

stuck_note=""
[ "$stuck_n" -gt 0 ] && stuck_note=" (그중 ${WAIT_ALERT_DAYS}일 초과 ${stuck_n}건)"

if [ "$made" -gt 0 ] || [ "$failed" -gt 0 ] || [ "$waiting" -gt 0 ]; then
  log "훑기 완료 — 파일 ${count}건 · 압축 ${made}건 · 실패 ${failed}건 · 대기 ${waiting}건${stuck_note} (감시: $WATCH)"
fi

# ★ v2: 신호에 '무엇이' 실패했는지 싣는다. v1 은 숫자만 보내서 로그를
#        직접 보기 전에는 아무것도 알 수 없었다.
wait_msg=""
[ "$waiting" -gt 0 ] && wait_msg=" · 대기 ${waiting}건"

if [ -n "$quarantined" ]; then
  beat 0 "실패 ${failed}건 · 실패/ 로 치움: ${quarantined}" "$made" "$failed"
elif [ "$failed" -gt 0 ]; then
  beat 0 "압축 실패 ${failed}건 (성공 ${made}건) — ${LAST_REASON:-사유불명}" "$made" "$failed"
elif [ "$stuck_n" -gt 0 ]; then
  # ★ 2026-08-17 신설 — 실패는 아니지만 '조용히 멈춘' 상태다.
  # 여기서 ok=0 을 보내야 pipeline-watch 가 이걸 고장으로 보고 알림을 준다.
  # ok=1 로 보내면 대시보드는 초록불인데 영상만 안 올라간다 — 그게 지난 사흘이었다.
  more=""
  [ "$stuck_n" -gt 3 ] && more=" 외 $(( stuck_n - 3 ))건"
  beat 0 "${WAIT_ALERT_DAYS}일 넘게 대기만 함 ${stuck_n}건: ${STUCK}${more} · 드라이브에서 '오프라인 액세스 사용 설정' 필요" "$made" 0
else
  beat 1 "파일 ${count}건 확인 · 압축 ${made}건${wait_msg}" "$made" 0
fi
exit 0
