/**
 * PAP Magazine — 기여자 인덱스 /contributors (Ⅲ-30, 2026-08-27)
 * 화보 2편 이상 인물 기여자(현재 44명)의 목록. 프로필 페이지의 발견 경로이자
 * ItemList(Person) 스키마 표면. 데이터는 top_contributors RPC — 공개 크레딧만.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { MIN_EDITORIALS, SITE, escText, escAttr, normHandle, isPersonRole, pageShell, premiumCreatorsByHandle, locationLabel } =
  require('../_lib/contributorProfile');

/* 2026-09-13 도메니코(5번 장치) — 프리미엄 크리에이터는 첫 화보부터 목록에 오르고 배지를 달고 맨 위에 선다.
   base: top_contributors(2). 프리미엄인데 base 에 없는 아이디는 contributor_counts(RPC, 마이그레이션 155)로 채운다.
   순수 정렬/합치기 함수 — 테스트가 직접 돌린다. */
function mergeRows(baseRows, premiumByHandle, extraRows) {
  const map = new Map();
  for (const r of (baseRows || [])) if (r && r.handle) map.set(r.handle, r);
  for (const r of (extraRows || [])) if (r && r.handle && !map.has(r.handle) && premiumByHandle[r.handle]) map.set(r.handle, r);
  const rows = Array.from(map.values()).map(r => Object.assign({}, r, {
    premium: !!premiumByHandle[r.handle],
    location: premiumByHandle[r.handle] ? locationLabel(premiumByHandle[r.handle]) : '',
  }));
  rows.sort((a, b) => (b.premium - a.premium) || (b.count - a.count) || String(b.latest || '').localeCompare(String(a.latest || '')));
  return rows;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  try {
    const { data, error } = await supabaseAdmin.rpc('top_contributors', { p_min: MIN_EDITORIALS });
    if (error) throw error;
    const shape = r => ({
      handle: normHandle(r.handle),
      name: r.display_name || r.handle,
      roles: (r.roles || []).filter(isPersonRole).slice(0, 4),
      count: Number(r.editorial_count) || 0,
      latest: r.latest || null,
    });
    const baseRows = (data || []).map(shape).filter(r => r.handle);
    const premiumByHandle = await premiumCreatorsByHandle(supabaseAdmin);
    const missing = Object.keys(premiumByHandle).filter(h => !baseRows.some(r => r.handle === h));
    let extraRows = [];
    if (missing.length) {
      try {
        const { data: ex } = await supabaseAdmin.rpc('contributor_counts', { p_handles: missing });
        extraRows = (ex || []).map(shape).filter(r => r.handle && r.count >= 1 && r.roles.length);
      } catch (_) { extraRows = []; }
    }
    const rows = mergeRows(baseRows, premiumByHandle, extraRows);

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
      + '<p class="sub">PAP 프리미엄 크리에이터는 첫 화보부터 인증 배지와 함께 맨 위에 오른다.</p>\n'
      + '<div class="list">\n'
      + rows.map(r =>
          '<a class="row" href="/contributor/' + escAttr(r.handle) + '">'
          + '<span><span class="n">' + escText(r.name) + '</span>'
          + (r.premium ? '<span class="pbadge-s" translate="no">✓ Premium</span>' : '')
          + (r.roles.length ? ' <span class="r">' + escText(r.roles.join(' · ')) + '</span>' : '')
          + (r.location ? ' <span class="r">' + escText(r.location) + '</span>' : '')
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
module.exports.mergeRows = mergeRows;
