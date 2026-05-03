/**
 * PAP Magazine — Theme definitions (single source of truth).
 *
 * 7 curated theme bundles, each mapping a "theme id" to:
 *   - `tags`:     exact tag tokens that count as a tag-set match (Phase 1)
 *   - `keywords`: multilingual keyword bag for content text matching across
 *                 title + description (Phase 2 in /api/editorials/themes).
 *                 Editorial copy can be in ANY language (Korean, Japanese,
 *                 Chinese, English, Italian, etc.) and the same theme should
 *                 still pull it in — keywords below cover all 9 supported
 *                 languages so the matcher is language-agnostic.
 *   - `labels`:   9-language display name for the row heading
 *
 * Lifted from the previous inline IIFE in index.html so backend AND frontend
 * read from the same place. The /api/editorials/themes endpoint uses `tags`
 * for exact matching, `keywords` for substring search in the editorial's
 * title+description, and `labels[lang]` to render the row heading.
 *
 * Never reorder this array — the day-of-year rotation for anonymous visitors
 * (themes.js endpoint) hashes by index, so reordering would silently change
 * which themes show up on which days.
 *
 * Keyword guidelines:
 *   • Korean: ≥2 syllables (e.g. "몽환" not "꿈") to avoid common-word noise
 *   • CJK languages: prefer 2+ char tokens for the same reason
 *   • English: lowercase, exact substring (catches plurals via stem)
 *   • Stems for inflected langs (it/fr/es/de/ru): pick a common substring
 *     that catches multiple inflections (e.g. "romant" matches romantic,
 *     romantica, romantique, romántico, romantisch, романт*)
 */

const THEMES = [
  {
    id: 'dreamy',
    tags: ['dreamy','romantic','soft','ethereal','pastel','gentle','tender','nostalgia','light','spiritual','peaceful'],
    keywords: [
      // English
      'dreamy','romantic','ethereal','pastel','gentle','tender','nostalgic','spiritual','peaceful','whisper','serenity','soft light','daydream',
      // Korean
      '몽환','로맨틱','부드러운','환상적','꿈결','아련','서정','낭만','평화','꿈같','달콤',
      // Japanese
      '夢幻','ロマンティック','幻想','夢のよう','優しい','穏やか',
      // Chinese
      '梦幻','浪漫','柔美','诗意','温柔',
      // Italian / French / Spanish / German / Russian (stems)
      'onirico','romantic','sognante','rêveur','soñador','traum','verträumt','мечт','романт'
    ],
    labels: { ko:'몽환적이고 로맨틱한', en:'Dreamy & Romantic', it:'Onirico & Romantico', fr:'Onirique & Romantique', es:'Onírico & Romántico', ja:'夢幻的でロマンティック', zh:'梦幻浪漫风格', ru:'Мечтательный и романтичный', de:'Träumerisch & Romantisch' }
  },
  {
    id: 'bold',
    tags: ['bold','colorful','vibrant','intense','dramatic','fierce','powerful','maximalist','pop','energetic'],
    keywords: [
      'bold','colorful','vibrant','intense','dramatic','fierce','powerful','maximalist','energetic','vivid','electric','striking',
      '강렬','대담','화려','다채','강력','역동','임팩트','비비드','선명',
      '大胆','強烈','鮮やか','ビビッド',
      '大胆','强烈','鲜艳','前卫',
      'audace','intens','vibrante','dramat','vibrant','audaz','vibrante','kühn','intensiv','lebhaft','смел','ярк'
    ],
    labels: { ko:'강렬하고 대담한', en:'Bold & Intense', it:'Audace & Intenso', fr:'Audacieux & Intense', es:'Audaz e Intenso', ja:'大胆で強烈な', zh:'大胆前卫风格', ru:'Смелый и яркий', de:'Kühn & Intensiv' }
  },
  {
    id: 'dark',
    tags: ['dark','moody','noir','shadow','gritty','mysterious','cinematic','urban','underground','dystopian'],
    keywords: [
      'dark','moody','noir','shadow','gritty','mysterious','cinematic','urban','underground','dystopian','gothic','monochrome','black and white',
      '다크','어두운','그림자','음울','미스터리','시네마틱','어반','고딕','흑백','모노톤','음영',
      'ダーク','影','闇','シネマティック','ノワール','モノクロ',
      '暗黑','阴暗','神秘','电影感','黑白',
      'oscur','scur','ombra','sombre','ténèbr','misterios','dunkel','schatten','geheimnis','тёмн','тень','мрачн'
    ],
    labels: { ko:'다크 & 시네마틱', en:'Dark & Cinematic', it:'Dark & Cinematico', fr:'Sombre & Cinématique', es:'Oscuro & Cinemático', ja:'ダーク＆シネマティック', zh:'暗黑电影风格', ru:'Тёмный и кинематографичный', de:'Dunkel & Filmisch' }
  },
  {
    id: 'nature',
    tags: ['warm','natural','organic','earthy','golden','desert','landscape','bohemian','flowing','sand'],
    keywords: [
      'warm','natural','organic','earthy','golden','desert','landscape','bohemian','flowing','sand','sunset','forest','beach','nature','field','meadow','outdoor',
      '자연','따뜻','유기','황금','사막','풍경','보헤미안','노을','석양','숲','해변','바다','들판','초원','야외',
      '自然','暖か','黄金','砂漠','風景','森','海辺',
      '自然','温暖','有机','黄金','沙漠','森林','海滩','田园',
      'natural','calde','organic','desert','paesaggi','natur','chaleureu','organique','désert','paysage','natural','cálid','orgánic','desierto','paisaj','natur','warm','organisch','wüste','природ','тёпл','органич','пустын','пейзаж'
    ],
    labels: { ko:'자연과 따뜻함', en:'Warm & Organic', it:'Caldo & Organico', fr:'Chaleureux & Organique', es:'Cálido & Orgánico', ja:'自然と温もり', zh:'自然温暖风格', ru:'Тёплый и органичный', de:'Warm & Organisch' }
  },
  {
    id: 'modern',
    tags: ['futuristic','modern','geometric','structured','clean','sleek','chrome','metallic','industrial','space','precision','minimal'],
    keywords: [
      'futuristic','modern','geometric','structured','sleek','chrome','metallic','industrial','space','minimal','minimalist','digital','robotic','sci-fi','cyber',
      '미래','모던','기하','구조','매끈','크롬','금속','산업','우주','미니멀','디지털','로봇','사이버',
      '未来','モダン','幾何','金属','ミニマル','宇宙','サイバー',
      '未来','现代','几何','金属','极简','太空','赛博',
      'futurist','moderno','geometric','minimal','futurist','moderne','géométrique','minimal','futurist','moderno','geométric','minimal','futurist','modern','geometrisch','minimal','футурист','современн','геометр','минимал'
    ],
    labels: { ko:'미래적이고 모던한', en:'Futuristic & Modern', it:'Futuristico & Moderno', fr:'Futuriste & Moderne', es:'Futurista & Moderno', ja:'未来的でモダンな', zh:'未来摩登风格', ru:'Футуристичный и современный', de:'Futuristisch & Modern' }
  },
  {
    id: 'classic',
    tags: ['elegant','classic','refined','sophisticated','timeless','grace','beauty','muse','feminine'],
    keywords: [
      'elegant','classic','refined','sophisticated','timeless','grace','muse','feminine','vintage','couture','luxury','royal','heritage','aristocrat',
      '클래식','엘레강스','세련','우아','정제','뮤즈','여성스','빈티지','오뜨꾸뛰르','럭셔리','고전','품격',
      'クラシック','エレガンス','優雅','ヴィンテージ','高級','古典',
      '经典','优雅','精致','复古','高级','古典',
      'elegant','classic','raffinat','sofistic','vintage','élégant','classique','raffiné','vintage','elegant','clásic','refinad','vintage','elegant','klassisch','raffiniert','vintage','элегант','классик','изыск','винтаж'
    ],
    labels: { ko:'클래식 & 엘레강스', en:'Classic & Elegance', it:'Classico & Eleganza', fr:'Classique & Élégance', es:'Clásico & Elegancia', ja:'クラシック＆エレガンス', zh:'经典优雅风格', ru:'Классика и элегантность', de:'Klassisch & Elegant' }
  },
  {
    id: 'surreal',
    tags: ['surreal','dreamlike','fantasy','conceptual','whimsical','artistic','abstract','creative','imaginative'],
    keywords: [
      'surreal','dreamlike','fantasy','conceptual','whimsical','artistic','abstract','creative','imaginative','otherworldly','magical','alien','illusion',
      '초현실','판타지','환상','개념','예술','추상','창의','상상','마법','동화','기묘','불가사의',
      'シュール','ファンタジー','幻想','抽象','魔法','奇妙',
      '超现实','幻想','抽象','创意','魔法','奇幻',
      'surreal','fantasia','astratt','surréal','fantaisie','abstrait','surrealist','fantasía','abstract','surreal','fantasie','abstrakt','сюрреал','фантаз','абстракт'
    ],
    labels: { ko:'초현실적 판타지', en:'Surreal Fantasy', it:'Fantasia Surrealista', fr:'Fantaisie Surréaliste', es:'Fantasía Surrealista', ja:'シュールファンタジー', zh:'超现实幻想', ru:'Сюрреалистическая фантазия', de:'Surreale Fantasie' }
  }
];

const THEME_BY_ID = THEMES.reduce(function(m, t){ m[t.id] = t; return m; }, {});
const SUPPORTED_LANGS = ['ko','en','it','fr','es','ja','zh','ru','de'];

function safeLang(lang) {
  return SUPPORTED_LANGS.indexOf(lang) > -1 ? lang : 'ko';
}

// Stable rotation for anonymous visitors: deterministic per-day choice of 3
// of the 7 themes, so every anonymous visitor on the same day sees the same
// rows (no flicker from re-rolls, easy to cache, easy to reason about).
// Uses day-of-year + a small per-position offset so the 3 picks stay distinct.
function pickAnonymousThemes(date) {
  const d = date || new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d - start) / (1000 * 60 * 60 * 24));
  const picks = [];
  const seen = new Set();
  for (let offset = 0; picks.length < 3 && offset < THEMES.length * 2; offset++) {
    const idx = (dayOfYear + offset * 3) % THEMES.length;
    if (seen.has(idx)) continue;
    seen.add(idx);
    picks.push(THEMES[idx]);
  }
  return picks;
}

module.exports = { THEMES, THEME_BY_ID, SUPPORTED_LANGS, safeLang, pickAnonymousThemes };
