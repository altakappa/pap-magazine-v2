// PAP Magazine — pap-app.js
//
// HISTORY: this file was the original ~10,000-line frontend bundle. The
// HARNESS_CHECKLIST.md refactor (missions 2–11) split it into 14 focused
// modules. Final shell-bootstrap code moved to pap-shell-bootstrap.js
// (mission 11). This file is intentionally empty — kept as a no-op so that
// the existing <script src="pap-app.js"> tags in 10 HTMLs and any cached
// references continue to resolve to a valid file. Future cleanup can remove
// it and the script tags together.
//
// Module map (in HTML load order):
//   pap-utils.js                 — scroll lock, escapeHtml, pagination,
//                                  carousel arrow state + smooth scroll
//   pap-i18n.js                  — 9-language T dict + setLang + every
//                                  language dictionary previously inlined
//                                  across the codebase
//   pap-auth.js                  — isLoggedIn, header dropdown, logout
//   pap-search.js                — toggleSearch, searchEditorials
//   pap-static.js                — Terms / Privacy modal pages
//   pap-subscription.js          — isPremium / isStandardOrAbove,
//                                  interstitial subsystem, image right-click
//                                  protection
//   pap-home.js                  — floating cursor logo, signup popup,
//                                  marquee
//   pap-content-editorial.js     — edData / edDetails, openEditorial family,
//                                  ALL EDITORIALS overlay, edImgError
//   pap-content-film.js          — filmAllData, openAllFilms / openFilmDetail,
//                                  film slug helpers, Netflix hover, autoplay
//   pap-content-article.js       — artData, openAllArticles / openArticleDetail
//   pap-content-creator-shorts.js — creatorData, openCreatorPopup; shortsData,
//                                  buildShortsCarousel, moveShort
//   pap-content-api-sync.js      — Lazy data loaders + Supabase API hydration
//   pap-content-seo.js           — _updateEditorialMeta + deep-link IIFEs
//   pap-shell-bootstrap.js       — beta flag, page loader, hero slider, nav,
//                                  fashion carousel, scroll reveal, popstate
//                                  router, language auto-detection
