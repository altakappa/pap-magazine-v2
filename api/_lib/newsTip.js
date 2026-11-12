/**
 * newsTip.js — 제보(특종)의 규칙 한 벌 (2026-11-12 신설)
 *
 * 도메니코 2026-11-11: "제보는 확인 안 된 단서를 받는게 아니라 특종을 받는거임.
 *   ... 저스틴비버가 한국에서 어떤 식당에서 밥을 먹고있는 장면을 포착했다면
 *   그것을 영상으로 찍어서 우리에게 제보하는거지"
 *
 * ■ 왜 별도 모듈인가
 * 폼(브라우저)·업로드 발급·접수 세 곳이 **같은 숫자와 같은 목록**을 봐야 한다.
 * 세 벌이면 한쪽만 고쳐진다. 특히 MIME 목록은 버킷 설정과도 맞아야 해서
 * (어긋나면 조용한 실패) 한 곳에 모아 두고 테스트로 묶는다.
 *
 * ■ 버킷 설정과 **반드시** 같아야 하는 것
 *   supabase_migrations/186_news_tips_bucket.sql
 *     public=false · file_size_limit=1GiB
 *     allowed_mime_types = video/mp4, video/quicktime,
 *                          image/jpeg, image/png, image/webp, image/heic, image/heif
 */

'use strict';

/** 제보 미디어가 사는 곳 — **비공개** 버킷. 확인 전에는 아무도 못 본다. */
const BUCKET = 'news-tips';

/** 채택된 제보의 미디어를 옮겨 두는 공개 버킷(기사에 실리려면 공개로 읽혀야 한다). */
const ARCHIVE_BUCKET = 'media';
const ARCHIVE_PREFIX = 'news-tips/';

/* 도메니코 2026-11-11: "1기가 용량까지 허락해주자" — 영상 기준이다.
   사진에 1GB 를 주면 오히려 실수로 올린 거대 파일을 걸러낼 수 없다. */
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;   // 1 GiB
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;     // 50 MB

/** 한 제보에 붙일 수 있는 파일 수. 증거 묶음이라 넉넉하되 무한은 아니다. */
const MAX_FILES = 10;

const VIDEO_MIME = ['video/mp4', 'video/quicktime'];
/* HEIC/HEIF 를 받는 이유: 아이폰 사진이 그 포맷으로 올라온다. 브라우저가
   미리보기를 못 그리지만(submissions 에서 TIFF 를 뺀 것과 같은 문제) 제보는
   증거가 우선이다. 거부하면 증거 자체를 잃는다 — 받아 두고 관리자 화면에서
   미리보기 대신 내려받기 링크를 준다. */
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const ALLOWED_MIME = new Set(VIDEO_MIME.concat(IMAGE_MIME));

/* 비표준 별칭을 표준으로 — 일부 브라우저·OS 가 image/jpg, video/mov 를 보낸다.
   그 값으로 PUT 하면 버킷이 거부해 '앱은 통과시켰는데 업로드만 실패' 가 된다. */
const MIME_CANONICAL = {
  'image/jpg': 'image/jpeg',
  'video/mov': 'video/quicktime',
  'video/x-quicktime': 'video/quicktime',
};
function canonicalMime(type) {
  const t = String(type == null ? '' : type).toLowerCase().trim();
  return MIME_CANONICAL[t] || t;
}

const MIME_TO_EXT = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

function isVideo(type) { return VIDEO_MIME.indexOf(canonicalMime(type)) !== -1; }
function isImage(type) { return IMAGE_MIME.indexOf(canonicalMime(type)) !== -1; }

/** 이 MIME 에 허용된 최대 바이트. 모르는 MIME 은 이미지 상한(더 엄한 쪽). */
function maxBytesFor(type) { return isVideo(type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES; }

/* 글자 상한 */
const MAX = { title: 150, body: 2000, location: 200, happenedAtText: 80 };

/* 도메니코 '라 - 제보는 전부 긴급제보만 받고 텔레그램으로 알림필요' →
   모든 접수가 즉시 알림이다. 그래서 남용 방지가 알림 폭주 방지이기도 하다.
   계정당 하루 상한(설계안 §4). IP 레이트리밋은 rateLimit 이 따로 본다. */
const DAILY_LIMIT_PER_USER = 5;

/* 미디어 수명 — 도메니코: "일주일뒤 보관하지않고 삭제" */
const PURGE_AFTER_DAYS = 7;

/** 제보함 원본을 지울 때가 됐나 */
function isPurgeDue(createdAtIso, nowMs) {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return false;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return now - t >= PURGE_AFTER_DAYS * 24 * 3600 * 1000;
}

/** 채택된 제보의 보관 경로 (공개 버킷 안) */
function archivePathFor(tipId, storagePath) {
  const base = String(storagePath || '').split('/').pop() || 'file';
  return ARCHIVE_PREFIX + String(tipId) + '/' + base;
}

module.exports = {
  BUCKET,
  ARCHIVE_BUCKET,
  ARCHIVE_PREFIX,
  MAX_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_FILES,
  VIDEO_MIME,
  IMAGE_MIME,
  ALLOWED_MIME,
  MIME_CANONICAL,
  MIME_TO_EXT,
  MAX,
  DAILY_LIMIT_PER_USER,
  PURGE_AFTER_DAYS,
  canonicalMime,
  isVideo,
  isImage,
  maxBytesFor,
  isPurgeDue,
  archivePathFor,
};
