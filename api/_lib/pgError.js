/**
 * PAP Magazine — Postgres 제약 위반을 사람이 읽는 안내로 바꾼다 (2026-08-07 신설).
 *
 * ── 왜 만들었나 (실제 사고) ────────────────────────────────────────
 * 2026-08-07 21:35~22:18, 도메니코가 에디토리얼 'BOYS' 발행을 **8번** 눌렀고
 * 8번 다 실패했다. 화면에는 "발행 실패: Failed to update editorial" 만 떴다.
 *
 * 서버 로그에는 원인이 처음부터 찍혀 있었다:
 *     code: '23505'
 *     details: 'Key (slug)=(boys) already exists.'
 *     constraint: 'editorials_published_slug_uniq'
 *
 * 2024-10-09 에 발행한 화보 'Boys' 가 이미 slug `boys` 를 쓰고 있었다.
 * 이 제약은 **published 끼리만** 유니크라(부분 인덱스) draft 저장은 통과하고
 * 발행 순간에만 막힌다 — 그래서 "등록은 됐는데 발행만 안 된다" 로 보였다.
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────────────
 * 고칠 방법(슬러그 변경)이 명확한 오류인데 화면이 그걸 말해주지 않았다.
 * `.claude/rules/api.md` 의 "원문 에러를 응답에 싣지 않는다" 를 지키느라
 * **분류용 code 를 붙이는 나머지 절반을 안 했기 때문**이다. 그 규칙의 요구는
 * '아무것도 말하지 말라' 가 아니라 '내부 구조 대신 code 를 주라' 다.
 *
 * ── 이 파일의 원칙 ────────────────────────────────────────────────
 * · 새는 것: 제약 이름 · 컬럼 목록 · 테이블 구조 → **응답에 넣지 않는다**
 * · 주는 것: 분류용 `code` + 한국어 안내 + 충돌한 **값**(사용자가 방금 입력한
 *   공개 값이므로 안전하고, 이게 없으면 어느 걸 고쳐야 할지 모른다)
 * · 모르는 제약은 null 을 돌려주고 호출부가 기존 500 경로를 그대로 탄다 —
 *   이 파일 때문에 새 실패 모드가 생기지 않게.
 */
'use strict';

/* 제약 이름 → 사용자 안내. 이름은 **여기서만** 쓰고 응답에는 내보내지 않는다.
   새 유니크 제약을 만들면 여기에 한 줄 추가한다(안 하면 그냥 기존 500). */
const UNIQUE_RULES = {
  editorials_published_slug_uniq: {
    code: 'slug_conflict',
    field: 'slug',
    msg: (v) => `이미 발행된 다른 에디토리얼이 같은 주소를 쓰고 있습니다`
      + (v ? ` (주소: ${v}).` : '.')
      + ` 주소(슬러그)를 다른 값으로 바꾼 뒤 다시 발행해 주세요.`,
  },
  articles_slug_key: {
    code: 'slug_conflict',
    field: 'slug',
    msg: (v) => `같은 주소를 쓰는 기사가 이미 있습니다`
      + (v ? ` (주소: ${v}).` : '.')
      + ` 주소(슬러그)를 다른 값으로 바꿔 주세요.`,
  },
  films_slug_key: {
    code: 'slug_conflict',
    field: 'slug',
    msg: (v) => `같은 주소를 쓰는 필름이 이미 있습니다`
      + (v ? ` (주소: ${v}).` : '.')
      + ` 주소(슬러그)를 다른 값으로 바꿔 주세요.`,
  },
  editorials_source_submission_uniq: {
    code: 'submission_already_used',
    field: 'source_submission_id',
    msg: () => '이 서브미션으로 만든 에디토리얼이 이미 있습니다. 기존 항목을 수정해 주세요.',
  },
  idx_articles_ig_post_id: {
    code: 'ig_post_already_imported',
    field: 'source_instagram_post_id',
    msg: () => '이 인스타그램 게시물은 이미 기사로 등록돼 있습니다.',
  },
};

/* Postgres 가 주는 details 는 `Key (slug)=(boys) already exists.` 형태다.
   값만 뽑는다 — 컬럼 목록·따옴표 규칙이 버전마다 달라질 수 있어 실패하면
   그냥 null 을 돌려주고 안내 문구는 값 없이 나간다(문구가 그 경우를 감안한다). */
function conflictValue(details) {
  const m = /^Key \(([^)]*)\)=\((.*)\) already exists\.?$/.exec(String(details || '').trim());
  return m ? m[2] : null;
}

/**
 * 알려진 제약 위반이면 `{ status, body }`, 아니면 null.
 * body 에는 제약 이름·컬럼 구조를 넣지 않는다.
 */
function describePgError(err) {
  if (!err || err.code !== '23505') return null;         // 지금은 유니크 위반만 다룬다
  /* supabase-js 는 constraint 를 따로 주지 않을 때가 있다. message 안에
     제약 이름이 들어오므로 둘 다 본다. */
  const hay = String((err.constraint || '') + ' ' + (err.message || ''));
  const name = Object.keys(UNIQUE_RULES).find(k => hay.includes(k));
  if (!name) return null;
  const rule = UNIQUE_RULES[name];
  const value = conflictValue(err.details);
  return {
    status: 409,                                          // Conflict — 재시도해도 그대로다
    body: {
      error: rule.msg(value),
      code: rule.code,
      field: rule.field,
      // 사용자가 방금 입력한 공개 값. 이게 있어야 무엇을 고칠지 안다.
      conflict_value: value || undefined,
    },
  };
}

module.exports = { describePgError, conflictValue, UNIQUE_RULES };
