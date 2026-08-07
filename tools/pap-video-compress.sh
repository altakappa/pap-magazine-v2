#!/bin/bash
#
# PAP 영상 자동 압축기 (맥미니용)
# ─────────────────────────────────────────────────────────────
# 구글 드라이브 "내 드라이브 / 유튜브" 폴더를 지켜보다가,
# 큰 영상이나 .MOV 가 들어오면 유튜브 쇼츠·틱톡에 바로 쓸 수 있는
# H.264 mp4 로 압축한다. 원본은 지우지 않고 `원본/` 으로 옮겨 보관한다.
#
# 왜 필요한가:
#   인스타에서 릴스 mp4 회수 실패율이 2026-08-03 부터 18% → 69% 로 뛰었다.
#   라이선스 음원이 붙은 릴스는 인스타가 파일 주소를 아예 안 준다(영구).
#   그래서 제작 시점에 원본을 드라이브에 쌓기로 했는데, 카메라 원본은
#   73~264MB 라 우리 서버(Vercel, 120초·1GB 상한)가 처리하지 못한다.
#   압축은 서버가 아니라 여기(맥미니)에서 한다.
#
# 설치: 같은 폴더의 설치안내.md 참고
# 로그: ~/Library/Logs/pap-video-compress.log
#
# 사용법:
#   ./pap-video-compress.sh          한 번 훑고 끝 (launchd 가 이걸 반복 호출)
#   ./pap-video-compress.sh --dry    실제로 안 건드리고 뭘 할지만 출력
#

set -uo pipefail

# ── 설정 ─────────────────────────────────────────────────────
MAX_MB="${PAP_MAX_MB:-80}"          # 이 크기 이하로 만든다 (서버 상한 100MB 대비 여유)
MAX_WIDTH="${PAP_MAX_WIDTH:-1080}"  # 가로 최대 (세로 영상이면 1080 유지)
CRF="${PAP_CRF:-23}"                # 화질. 낮을수록 고화질·큰 용량 (18~28 권장)
AUDIO_KBPS="${PAP_AUDIO_KBPS:-128}" # 소리는 살린다 (도메니코 2026-08-07 결정)
STABLE_WAIT="${PAP_STABLE_WAIT:-10}" # 동기화 중인 파일을 건드리지 않기 위한 대기(초)
LOG="${PAP_LOG:-$HOME/Library/Logs/pap-video-compress.log}"

DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

# ── 감시 폴더 찾기 ───────────────────────────────────────────
# 구글 드라이브 데스크톱은 계정·언어에 따라 경로가 달라서 후보를 훑는다.
find_watch_dir() {
  if [ -n "${PAP_WATCH_DIR:-}" ] && [ -d "$PAP_WATCH_DIR" ]; then
    echo "$PAP_WATCH_DIR"; return 0
  fi
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

# ── 죽은사람 스위치 ──────────────────────────────────────────
# 훑기가 끝날 때마다 서버에 "나 살아있음"을 보낸다. 이 신호가 30시간
# 끊기면 서버(pipeline-watch)가 텔레그램으로 알린다.
# 왜: 이 스크립트는 우리 서버 밖에서 돈다. 맥이 꺼지거나 권한이 풀리거나
# 드라이브 동기화가 끊기면 아무 흔적 없이 조용히 멎는다. 대시보드는
# 평화롭고 유튜브만 마른다. 오늘 하루에만 같은 침묵을 네 번 봤다.
# 실패해도 스크립트는 계속 간다 — 감시가 본업을 죽이면 안 된다.
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
  log "   구글 드라이브 데스크톱이 깔려 있고 폴더가 동기화 중인지 확인하세요."
  log "   경로를 직접 지정하려면: PAP_WATCH_DIR='/경로/유튜브' 로 환경변수 설정"
  # 고장 사유를 신호에 실어 보낸다 — 침묵보다 '왜 멎었는지'가 훨씬 쓸모 있다.
  beat 0 "드라이브 유튜브 폴더 못 찾음"
  exit 1
}

command -v ffmpeg >/dev/null 2>&1 || {
  log "❌ ffmpeg 없음. 'brew install ffmpeg' 먼저."
  beat 0 "ffmpeg 없음"
  exit 1
}

# 동시 실행 방지 — 압축은 몇 분씩 걸린다. 두 번 돌면 같은 파일을 서로 밟는다.
LOCK="/tmp/pap-video-compress.lock"
if [ $DRY -eq 0 ]; then
  if ! mkdir "$LOCK" 2>/dev/null; then
    # 30분 넘게 남아 있으면 죽은 락으로 보고 회수한다.
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
      log "⚠️ 오래된 락 회수"; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null
    else
      exit 0   # 이미 돌고 있다 — 조용히 종료 (launchd 가 5분 뒤 또 부른다)
    fi
  fi
  trap 'rm -rf "$LOCK"' EXIT
fi

ARCHIVE="$WATCH/원본"
[ $DRY -eq 0 ] && mkdir -p "$ARCHIVE"

MAX_BYTES=$(( MAX_MB * 1024 * 1024 ))

# ── 파일 하나 처리 ───────────────────────────────────────────
process() {
  local src="$1"
  local name base ext size
  name="$(basename "$src")"
  base="${name%.*}"
  ext="$(echo "${name##*.}" | tr '[:upper:]' '[:lower:]')"
  size=$(stat -f%z "$src" 2>/dev/null || echo 0)

  # 이미 조건을 만족하는 mp4 는 그대로 둔다 — 재인코딩은 화질만 깎는다.
  if [ "$ext" = "mp4" ] && [ "$size" -le "$MAX_BYTES" ]; then
    return 0
  fi

  # 동기화가 끝났는지 확인 — 크기가 안 변해야 손을 댄다.
  # (받는 중인 파일을 압축하면 잘린 영상이 만들어진다)
  sleep "$STABLE_WAIT"
  local size2
  size2=$(stat -f%z "$src" 2>/dev/null || echo 0)
  if [ "$size" != "$size2" ]; then
    log "⏳ 아직 동기화 중이라 건너뜀: $name"
    return 0
  fi

  local mb=$(( size / 1024 / 1024 ))
  local out="$WATCH/$base.mp4"
  # 같은 이름 mp4 가 이미 있으면 덮어쓰지 않는다.
  if [ -e "$out" ] && [ "$out" != "$src" ]; then
    out="$WATCH/${base}_압축.mp4"
  fi
  local tmp="$WATCH/.압축중_$$_$base.mp4"

  if [ $DRY -eq 1 ]; then
    log "[dry] $name (${mb}MB) → $(basename "$out")"
    return 0
  fi

  log "🎬 압축 시작: $name (${mb}MB)"

  # 세로 영상을 눕히지 않는다: 긴 변이 아니라 '가로'만 제한하고
  # 높이는 -2 로 짝수 자동 계산. 원본이 1080 이하면 확대하지 않는다.
  local vf="scale='min(${MAX_WIDTH},iw)':-2"

  if ! ffmpeg -y -nostdin -loglevel error -i "$src" \
      -vf "$vf" \
      -c:v libx264 -crf "$CRF" -preset medium -pix_fmt yuv420p \
      -profile:v high -level 4.1 \
      -c:a aac -b:a "${AUDIO_KBPS}k" -ar 48000 \
      -movflags +faststart \
      "$tmp" 2>>"$LOG"; then
    log "❌ 압축 실패: $name"
    rm -f "$tmp"
    return 1
  fi

  local outsize outmb
  outsize=$(stat -f%z "$tmp" 2>/dev/null || echo 0)

  # 아직 크면 목표 용량에 맞춰 비트레이트를 계산해 한 번 더 (2-pass).
  if [ "$outsize" -gt "$MAX_BYTES" ]; then
    local dur vbits
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src" 2>/dev/null | cut -d. -f1)
    [ -z "$dur" ] || [ "$dur" -lt 1 ] 2>/dev/null && dur=60
    # 목표 총 비트 = MAX_MB * 8Mbit, 여기서 오디오 몫과 컨테이너 여유(6%)를 뺀다
    vbits=$(( (MAX_BYTES * 8 / dur) - (AUDIO_KBPS * 1000) ))
    vbits=$(( vbits * 94 / 100 ))
    [ "$vbits" -lt 300000 ] && vbits=300000
    log "   ↻ $(( outsize / 1024 / 1024 ))MB — 목표 초과. 비트레이트 $(( vbits / 1000 ))kbps 로 재압축"
    rm -f "$tmp"
    local passlog="$WATCH/.2pass_$$"
    ffmpeg -y -nostdin -loglevel error -i "$src" -vf "$vf" \
      -c:v libx264 -b:v "$vbits" -preset medium -pix_fmt yuv420p -pass 1 -passlogfile "$passlog" \
      -an -f mp4 /dev/null 2>>"$LOG" \
    && ffmpeg -y -nostdin -loglevel error -i "$src" -vf "$vf" \
      -c:v libx264 -b:v "$vbits" -preset medium -pix_fmt yuv420p -pass 2 -passlogfile "$passlog" \
      -profile:v high -level 4.1 \
      -c:a aac -b:a "${AUDIO_KBPS}k" -ar 48000 -movflags +faststart "$tmp" 2>>"$LOG"
    rm -f "$passlog"-*.log "$passlog"-*.log.mbtree
    outsize=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
  fi

  if [ "$outsize" -lt 10000 ]; then
    log "❌ 결과 파일이 비정상적으로 작음 — 버림: $name"
    rm -f "$tmp"
    return 1
  fi

  outmb=$(( outsize / 1024 / 1024 ))
  mv "$tmp" "$out"

  # 원본은 지우지 않는다. 압축이 잘못됐을 때 되돌릴 길을 남긴다.
  # (원본/ 은 드라이브에도 동기화되니 용량이 부담되면 주기적으로 비울 것)
  if [ "$src" != "$out" ]; then
    mv "$src" "$ARCHIVE/$name" 2>/dev/null || log "⚠️ 원본 이동 실패(무시): $name"
  fi

  if [ "$outsize" -gt "$MAX_BYTES" ]; then
    log "⚠️ 압축했지만 아직 ${outmb}MB (>${MAX_MB}MB): $(basename "$out") — 영상이 너무 길 수 있음"
  else
    log "✅ 완료: $name (${mb}MB) → $(basename "$out") (${outmb}MB)"
  fi
}

# ── 훑기 ─────────────────────────────────────────────────────
# 최상위만 본다. 원본/ 안이나 숨김파일(.압축중_)은 건드리지 않는다.
count=0     # 훑은 파일 수
made=0      # 실제로 압축한 수
failed=0    # 실패한 수
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in .*) continue;; esac
  count=$((count+1))
  before_ext="$(echo "${f##*.}" | tr '[:upper:]' '[:lower:]')"
  before_size=$(stat -f%z "$f" 2>/dev/null || echo 0)
  if process "$f"; then
    # 압축 대상이었는데 원본이 사라졌으면(원본/으로 이동) 실제로 일한 것
    if [ ! -e "$f" ]; then made=$((made+1)); fi
  else
    failed=$((failed+1))
  fi
done < <(find "$WATCH" -maxdepth 1 -type f \
          \( -iname '*.mov' -o -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.avi' -o -iname '*.mkv' \) \
          2>/dev/null)

[ "$made" -gt 0 ] || [ "$failed" -gt 0 ] && \
  log "훑기 완료 — 파일 $count건 · 압축 $made건 · 실패 $failed건 (감시: $WATCH)"

# 살아있음 신호. 한 건도 안 했어도 보낸다 —
# '할 일이 없어서 조용한 것'과 '죽어서 조용한 것'을 서버가 구분해야 하니까.
if [ "$failed" -gt 0 ]; then
  beat 0 "압축 실패 ${failed}건 (성공 ${made}건)" "$made" "$failed"
else
  beat 1 "파일 ${count}건 확인 · 압축 ${made}건" "$made" 0
fi
exit 0
