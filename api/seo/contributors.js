/**
 * PAP Magazine — 기여자 인덱스 /contributors (Ⅲ-30, 2026-08-27)
 * 화보 2편 이상 인물 기여자(현재 44명)의 목록. 프로필 페이지의 발견 경로이자
 * ItemList(Person) 스키마 표면. 데이터는 top_contributors RPC — 공개 크레딧만.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { MIN_EDITORIALS, SITE, escText, escAttr, normHandle, isPersonRole, pageShell } =
  require('../_lib/contributorProfile');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  try {
    const { data, error } = await supabaseAdmin.rpc('top_contributors', { p_min: MIN_EDITORIALS });
    if (error) throw error;
    const rows = (data || []).map(r => ({
      handle: normHandle(r.handle),
      name: r.display_name || r.handle,
      roles: (r.roles || []).filter(isPersonRole).slice(0, 4),
      count: r.editorial_count,
    })).filter(r => r.handle);

    const canonical = SITE + '/contributors';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'PAP MAGAZINE contributors — repeat editorial credits',
      numberOfItems: rows.length,
      itemListElement: rows.slice(0, 100).map((r, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: { '@type': 'Person', name: r.name, url: SITE + '/contributor/' + r.handle,
                sameAs: ['https://www.instagram.com/' + r.handle + '/'] },
      })),
    };

    const body =
      '<div class="eyebrow">Contributors</div>\n'
      + '<h1>PAP 기여 크리에이티브</h1>\n'
      + '<p class="sub">PAP MAGAZINE에 화보를 ' + MIN_EDITORIALS + '편 이상 발행한 크리에이티브 '
      + rows.length + '명의 목록이다. 이름을 누르면 참여 화보 전체와 크레딧을 볼 수 있다. '
      + '전 세계 팀의 화보 게재 신청은 <a href="/submissions" style="border-bottom:1px solid rgba(255,255,255,.35)">서브미션</a>으로 받는다.</p>\n'
      + '<div class="list">\n'
      + rows.map(r =>
          '<a class="row" href="/contributor/' + escAttr(r.handle) + '">'
          + '<span><span class="n">' + escText(r.name) + '</span>'
          + (r.roles.length ? ' <span class="r">' + escText(r.roles.join(' · ')) + '</span>' : '')
          + '</span><span class="c">화보 ' + r.count + '편</span></a>').join('\n')
      + '\n</div>\n'
      + '<div class="foot">크레딧은 각 화보 발행 시 게재된 공개 정보를 집계한 것입니다. '
      + '표기 정정은 <a href="/editorial-policy#corrections">정정 정책</a>을 따릅니다.</div>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(pageShell(
      'PAP 기여 크리에이티브 — 반복 기여자 ' + rows.length + '명 | PAP MAGAZINE',
      'PAP MAGAZINE에 화보 ' + MIN_EDITORIALS + '편 이상을 발행한 크리에이티브 목록. 포토그래퍼·스타일리스트·스튜디오의 참여 화보와 크레딧.',
      canonical, jsonLd, body));
  } catch (err) {
    console.error('[contributors]', (err && err.message) || err);
    return res.status(500).send('temporary error');
  }
};
