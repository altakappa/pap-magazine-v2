/**
 * CTR 회수 — 검색 결과 전용 제목·설명 (2026-08-24 신설)
 *
 * [왜] 8월 실측: GSC 노출 515,864 · 클릭 10,687 · CTR 2.1% (4월엔 12.6%).
 * 많이 보여주는데 안 눌린다. 원인 중 코드가 고칠 수 있는 것:
 * articles 에 seo 칼럼이 없어 검색 설명줄이 제목 반복으로 나갔고,
 * seoRenderer 는 record.seo_title/seo_description 을 존중하는 코드가
 * 이미 있는데 값을 만들어 주는 곳이 없었다.
 *
 * [무엇을 지키나] 기사 생성 → 파싱 → INSERT 세 단계가 seo_title ·
 * seo_description 을 계속 나른다. 한 단계라도 빠지면 새 기사가 다시
 * 폴백(제목 반복)으로 돌아간다. 135 마이그레이션이 칼럼을 만들었다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const imp = R('api/_lib/instagramImport.js');
const seo = R('api/_lib/seoRenderer.js');
const mig = R('supabase_migrations/135_article_seo_fields.sql');

console.log('\n[1] 프롬프트 — 검색용 제목·설명을 항상 요청한다');
{
  t('seo_title 을 요청한다 (검색어 앞배치 지시 포함)',
    /"seo_title":/.test(imp) && /검색할 단어.*맨 앞/.test(imp));
  t('seo_description 을 요청한다 (구체 사실 + 제목 반복 금지)',
    /"seo_description":/.test(imp) && /제목 반복 금지/.test(imp));
  t('낚시 금지가 명시돼 있다 (본문에 없는 약속 금지)',
    /낚시 금지/.test(imp) && /본문에 없는 (약속|사실) 금지/.test(imp),
    '이 지시가 빠지면 CTR 은 오르고 이탈이 함께 오른다 — 구글이 그걸 벌준다');
}

console.log('\n[2] 파서 — 비면 null 로 안전하게 넘긴다');
{
  t('seo_title 파싱 (길이 상한 포함)', /seo_title: String\(parsed\.seo_title/.test(imp));
  t('seo_description 파싱 (길이 상한 포함)', /seo_description: String\(parsed\.seo_description/.test(imp));
  t('빈 값은 null (seoRenderer 폴백이 살아 있어야 한다)',
    /seo_title: String\(parsed\.seo_title[^\n]*\|\| null/.test(imp)
      && /seo_description: String\(parsed\.seo_description[^\n]*\|\| null/.test(imp));
}

console.log('\n[3] INSERT — buildArticleRow 가 싣는다');
{
  t('row 에 seo_title', /seo_title: generated\.seo_title \|\| null/.test(imp));
  t('row 에 seo_description', /seo_description: generated\.seo_description \|\| null/.test(imp));
}

console.log('\n[4] 렌더러·스키마 — 받는 쪽이 실제로 존중한다');
{
  t('seoRenderer 가 record.seo_title 을 최우선으로 쓴다', /record\.seo_title \|\|/.test(seo));
  t('seoRenderer 가 record.seo_description 을 설명에 쓴다', /record\.seo_description/.test(seo));
  t('135 마이그레이션이 세 칼럼을 만든다',
    /add column if not exists seo_title/.test(mig)
      && /add column if not exists seo_description/.test(mig)
      && /add column if not exists description_en/.test(mig));
}

console.log('\n검색 제목·설명 파이프라인: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
if (fail) process.exit(1);
