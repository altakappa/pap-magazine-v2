/**
 * 구글 드라이브 '유튜브' 폴더 읽기 (2026-08-07)
 *
 * 왜 필요한가:
 *   인스타에서 릴스 mp4 회수 실패율이 08-03 부터 18% → 69% 로 뛰었다.
 *   라이선스 음원이 붙은 릴스는 Graph 가 media_url 을 아예 안 준다(영구).
 *   그래서 제작 시점에 원본을 드라이브에 쌓고, 맥미니 압축기가 80MB 이하
 *   H.264 mp4 로 만들어 둔다. 여기는 그 결과물을 서버로 가져오는 창구다.
 *
 * 인증: YouTube OAuth 토큰을 그대로 쓴다 (api/_lib/youtube.js).
 *   같은 구글 계정·같은 앱이라 스코프에 drive.readonly 만 더하면 된다.
 *   ⚠️ 스코프를 추가한 뒤 /api/youtube/oauth 로 **1회 재인증**해야 한다.
 *      안 하면 여기서 403 이 난다 — 그때 사람이 읽을 메시지로 알려준다.
 *
 * 폴더: 내 드라이브 / 유튜브  (DRIVE_VIDEO_FOLDER_ID)
 *   하위 '원본/' 은 압축 전 카메라 원본이라 보지 않는다 (최상위만 훑는다).
 */

'use strict';

const { getAccessToken } = require('./youtube');

const API = 'https://www.googleapis.com/drive/v3';
const DEFAULT_FOLDER = '1guzrzqzsTAUC7qg9ZVTsgXIXRW0va-lF';   // 내 드라이브/유튜브

function folderId() {
  return process.env.DRIVE_VIDEO_FOLDER_ID || DEFAULT_FOLDER;
}

async function driveFetch(url, opts) {
  const token = await getAccessToken();
  const r = await fetch(url, {
    ...(opts || {}),
    headers: { Authorization: 'Bearer ' + token, ...((opts && opts.headers) || {}) },
  });
  if (r.status === 401 || r.status === 403) {
    const body = await r.text().catch(() => '');
    // 403 은 원인이 두 갈래인데 구글이 같은 코드로 준다. 갈라서 말해야
    // 사람이 헛다리를 안 짚는다 (2026-08-07 실제로 여기서 시간을 버렸다):
    //   ① 프로젝트에 Drive API 자체가 꺼져 있음 → 콘솔에서 '사용 설정'
    //   ② 토큰에 drive.readonly 가 없음        → /api/youtube/oauth 재인증
    if (/has not been used in project|is disabled/i.test(body)) {
      const proj = (body.match(/project (\d+)/) || [])[1] || '';
      throw new Error(
        '드라이브 API 가 꺼져 있음 — 구글 클라우드 콘솔에서 Google Drive API 를 사용 설정하세요'
        + (proj ? ' (프로젝트 번호 ' + proj + ')' : '')
        + '. 스코프·재인증 문제가 아닙니다.'
      );
    }
    throw new Error(
      '드라이브 접근 거부 (HTTP ' + r.status + ') — 토큰에 drive.readonly 스코프가 없습니다. '
      + '/api/youtube/oauth 로 1회 재승인하세요. ' + body.slice(0, 200)
    );
  }
  if (!r.ok) throw new Error('드라이브 HTTP ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  return r;
}

/**
 * 파일명 기반 제외 규칙 (순수 함수, 테스트 대상).
 * 배포 없이 에디터가 스스로 뺄 수 있게 파일명 규칙을 먼저 본다.
 *   · '_' 로 시작              → 보류 (모든 채널)
 *   · 이름에 '보류'/'skip' 포함 → 보류 (모든 채널)
 *   · DRIVE_VIDEO_SKIP          → 모든 채널에서 제외
 *   · DRIVE_VIDEO_SKIP_YOUTUBE  → 유튜브에서만 제외
 *   · DRIVE_VIDEO_SKIP_TIKTOK   → 틱톡에서만 제외
 *
 * ⚠️ 채널별 목록이 왜 필요한가 (2026-08-07):
 * 도메니코의 지시는 "**유튜브에는** 휴닝카이는 빼도 돼" 였다. 그 영상은 이미
 * 유튜브 채널에 올라가 있었기 때문이다(조회 456회). 그런데 처음 구현할 때
 * 목록을 채널 구분 없이 전역으로 만들어, 틱톡에서까지 빠졌다.
 * '어디서 빼라'는 말을 '전부에서 빼라'로 넓혀 읽은 것이다.
 * @param {string} name
 * @param {string|null} [skipListRaw] 전역 목록 오버라이드 (테스트용)
 * @param {string} [platform] 'youtube' | 'tiktok'
 */
function shouldSkip(name, skipListRaw, platform) {
  const n = String(name || '');
  if (!n) return '이름 없음';
  if (n.startsWith('_')) return "이름이 '_' 로 시작 (보류 표시)";
  const low = n.toLowerCase();
  if (low.indexOf('보류') !== -1 || low.indexOf('skip') !== -1) return '이름에 보류 표시';

  const parse = (raw) => String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  const global = parse(skipListRaw == null ? process.env.DRIVE_VIDEO_SKIP : skipListRaw);
  for (const frag of global) {
    if (low.indexOf(frag.toLowerCase()) !== -1) return '제외 목록에 걸림: ' + frag;
  }
  if (platform) {
    const key = 'DRIVE_VIDEO_SKIP_' + String(platform).toUpperCase();
    for (const frag of parse(process.env[key])) {
      if (low.indexOf(frag.toLowerCase()) !== -1) {
        return platform + ' 제외 목록에 걸림: ' + frag;
      }
    }
  }
  return null;
}

const VIDEO_EXT = /\.(mp4|m4v|mov)$/i;

/** 폴더 최상위의 영상 파일 목록. 하위 폴더(원본/)는 안 본다. */
async function listVideos() {
  const q = encodeURIComponent(`'${folderId()}' in parents and trashed=false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,createdTime)');
  const url = `${API}/files?q=${q}&fields=${fields}&pageSize=200&orderBy=modifiedTime desc`
    + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
  const r = await driveFetch(url);
  const j = await r.json();
  return (j.files || [])
    .filter((f) => f && f.mimeType !== 'application/vnd.google-apps.folder')
    .filter((f) => VIDEO_EXT.test(f.name || '') || String(f.mimeType || '').startsWith('video/'))
    .map((f) => ({
      id: f.id,
      name: f.name,
      bytes: Number(f.size || 0),
      modifiedAt: f.modifiedTime || f.createdTime || null,
    }));
}

/** 파일 바이트 내려받기. maxBytes 초과면 받지 않고 던진다. */
async function downloadVideo(fileId, maxBytes) {
  const cap = maxBytes || 100 * 1024 * 1024;
  const r = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    signal: AbortSignal.timeout(70000),
  });
  const len = Number(r.headers.get('content-length') || 0);
  if (len && len > cap) {
    throw new Error('영상 ' + Math.round(len / 1048576) + 'MB — 상한 ' + Math.round(cap / 1048576) + 'MB 초과');
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > cap) throw new Error('영상 크기 상한 초과 (' + Math.round(buf.length / 1048576) + 'MB)');
  if (buf.length < 10000) throw new Error('내려받은 파일이 비정상적으로 작음');
  return buf;
}

function isConfigured() {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

module.exports = { listVideos, downloadVideo, shouldSkip, folderId, isConfigured, DEFAULT_FOLDER, VIDEO_EXT };
