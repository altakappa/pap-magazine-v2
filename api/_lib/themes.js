/**
 * PAP Magazine — Theme definitions (single source of truth).
 *
 * 7 curated theme bundles, each mapping a "theme id" to:
 *   - `tags`:   the list of editorial tags that count as a match for this theme
 *   - `labels`: 9-language display name (matches the rest of the UI's lang set)
 *
 * Lifted from the previous inline IIFE in index.html so backend AND frontend
 * read from the same place. The /api/editorials/themes endpoint uses `tags`
 * to fetch matching editorials and `labels[lang]` to render the row heading.
 *
 * Never reorder this array — the day-of-year rotation for anonymous visitors
 * (themes.js endpoint) hashes by index, so reordering would silently change
 * which themes show up on which days.
 */

const THEMES = [
  {
    id: 'dreamy',
    tags: ['dreamy','romantic','soft','ethereal','pastel','gentle','tender','nostalgia','light','spiritual','peaceful'],
    labels: { ko:'몽환적이고 로맨틱한', en:'Dreamy & Romantic', it:'Onirico & Romantico', fr:'Onirique & Romantique', es:'Onírico & Romántico', ja:'夢幻的でロマンティック', zh:'梦幻浪漫风格', ru:'Мечтательный и романтичный', de:'Träumerisch & Romantisch' }
  },
  {
    id: 'bold',
    tags: ['bold','colorful','vibrant','intense','dramatic','fierce','powerful','maximalist','pop','energetic'],
    labels: { ko:'강렬하고 대담한', en:'Bold & Intense', it:'Audace & Intenso', fr:'Audacieux & Intense', es:'Audaz e Intenso', ja:'大胆で強烈な', zh:'大胆前卫风格', ru:'Смелый и яркий', de:'Kühn & Intensiv' }
  },
  {
    id: 'dark',
    tags: ['dark','moody','noir','shadow','gritty','mysterious','cinematic','urban','underground','dystopian'],
    labels: { ko:'다크 & 시네마틱', en:'Dark & Cinematic', it:'Dark & Cinematico', fr:'Sombre & Cinématique', es:'Oscuro & Cinemático', ja:'ダーク＆シネマティック', zh:'暗黑电影风格', ru:'Тёмный и кинематографичный', de:'Dunkel & Filmisch' }
  },
  {
    id: 'nature',
    tags: ['warm','natural','organic','earthy','golden','desert','landscape','bohemian','flowing','sand'],
    labels: { ko:'자연과 따뜻함', en:'Warm & Organic', it:'Caldo & Organico', fr:'Chaleureux & Organique', es:'Cálido & Orgánico', ja:'自然と温もり', zh:'自然温暖风格', ru:'Тёплый и органичный', de:'Warm & Organisch' }
  },
  {
    id: 'modern',
    tags: ['futuristic','modern','geometric','structured','clean','sleek','chrome','metallic','industrial','space','precision','minimal'],
    labels: { ko:'미래적이고 모던한', en:'Futuristic & Modern', it:'Futuristico & Moderno', fr:'Futuriste & Moderne', es:'Futurista & Moderno', ja:'未来的でモダンな', zh:'未来摩登风格', ru:'Футуристичный и современный', de:'Futuristisch & Modern' }
  },
  {
    id: 'classic',
    tags: ['elegant','classic','refined','sophisticated','timeless','grace','beauty','muse','feminine'],
    labels: { ko:'클래식 & 엘레강스', en:'Classic & Elegance', it:'Classico & Eleganza', fr:'Classique & Élégance', es:'Clásico & Elegancia', ja:'クラシック＆エレガンス', zh:'经典优雅风格', ru:'Классика и элегантность', de:'Klassisch & Elegant' }
  },
  {
    id: 'surreal',
    tags: ['surreal','dreamlike','fantasy','conceptual','whimsical','artistic','abstract','creative','imaginative'],
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
