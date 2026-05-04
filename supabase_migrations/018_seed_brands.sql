/**
 * PAP Magazine — Seed brand master + initial alias map
 * Step 18 in supabase_migrations/README.md execution order.
 *
 * 49 seed brands per AFFILIATE_SPEC.md §1.3, plus the alias variants seen
 * in the existing editorial credit data (so the auto-mapping job in Phase 1
 * has something to work against on day one).
 *
 * All brands start at status='pending' — they only become 'active' (and
 * eligible for /go/[id] redirect) once an affiliate URL is filled in by
 * admin.  Aliases ship as confidence='manual' since they're hand-curated
 * from the spec rather than auto-extracted.
 *
 * Idempotent: ON CONFLICT DO NOTHING so seed re-runs after admin edits
 * don't overwrite human work.
 */

-- ── BEAUTY (11) ─────────────────────────────────────────────────────────
INSERT INTO public.brands (brand_id, display_name, category, tier, instagram_handle) VALUES
  ('pat_mcgrath_labs',          'PAT McGRATH LABS',          'beauty', 'luxury',       'patmcgrathreal'),
  ('mac_cosmetics',             'M·A·C COSMETICS',           'beauty', 'mass',         'maccosmetics'),
  ('nyx_professional_makeup',   'NYX PROFESSIONAL MAKEUP',   'beauty', 'mass',         'nyxcosmetics'),
  ('makeup_by_mario',           'MAKEUP BY MARIO',           'beauty', 'contemporary', 'makeupbymario'),
  ('jane_iredale',              'JANE IREDALE',              'beauty', 'contemporary', 'janeiredale'),
  ('maybelline_new_york',       'MAYBELLINE NEW YORK',       'beauty', 'mass',         'maybelline'),
  ('caia_cosmetics',            'CAIA COSMETICS',            'beauty', 'indie',        'caiacosmetics'),
  ('lethal_cosmetics',          'LETHAL COSMETICS',          'beauty', 'indie',        'lethalcosmetics'),
  ('snowdrop_cosmetics',        'SNOWDROP COSMETICS',        'beauty', 'indie',        'snowdropcosmetics'),
  ('duff_beauty',               'DUFF BEAUTY',               'beauty', 'indie',        'duffbeauty'),
  ('panduro',                   'PANDURO',                   'beauty', 'mass',         'panduroofficial')
ON CONFLICT (brand_id) DO NOTHING;

-- ── FASHION — Luxury (10) ───────────────────────────────────────────────
INSERT INTO public.brands (brand_id, display_name, category, tier, instagram_handle) VALUES
  ('balenciaga',                'BALENCIAGA',                'fashion', 'luxury', 'balenciaga'),
  ('maison_margiela',           'MAISON MARGIELA',           'fashion', 'luxury', 'maisonmargiela'),
  ('rick_owens',                'RICK OWENS',                'fashion', 'luxury', 'rickowensonline'),
  ('mugler',                    'MUGLER',                    'fashion', 'luxury', 'muglerofficial'),
  ('saint_laurent',             'SAINT LAURENT',             'fashion', 'luxury', 'ysl'),
  ('chloe',                     'CHLOÉ',                     'fashion', 'luxury', 'chloe'),
  ('alexander_wang',            'ALEXANDER WANG',            'fashion', 'luxury', 'alexanderwangny'),
  ('af_vandevorst',             'A.F. VANDEVORST',           'fashion', 'luxury', 'afvandevorst'),
  ('andersson_bell',            'ANDERSSON BELL',            'fashion', 'luxury', 'anderssonbell'),
  ('calvin_klein',              'CALVIN KLEIN',              'fashion', 'luxury', 'calvinklein')
ON CONFLICT (brand_id) DO NOTHING;

-- ── FASHION — Contemporary / Mass (5) ───────────────────────────────────
INSERT INTO public.brands (brand_id, display_name, category, tier, instagram_handle) VALUES
  ('diesel',                    'DIESEL',                    'fashion', 'contemporary', 'diesel'),
  ('misbhv',                    'MISBHV',                    'fashion', 'contemporary', 'misbhv'),
  ('calzedonia',                'CALZEDONIA',                'fashion', 'mass',         'calzedonia'),
  ('converse',                  'CONVERSE',                  'footwear', 'mass',        'converse'),
  ('schutz',                    'SCHUTZ',                    'footwear', 'contemporary','schutz')
ON CONFLICT (brand_id) DO NOTHING;

-- ── FASHION — Indie / Designer (16) ─────────────────────────────────────
INSERT INTO public.brands (brand_id, display_name, category, tier, instagram_handle) VALUES
  ('mark_gong',                 'MARK GONG',                 'fashion', 'indie', 'markgong'),
  ('senseaweek',                'SENSEAWEEK',                'fashion', 'indie', 'senseaweek'),
  ('showroom_plus',             'SHOWROOM PLUS',             'fashion', 'indie', 'showroomplus'),
  ('455emble',                  '455EMBLE',                  'fashion', 'indie', '455emble'),
  ('qingchun_chen',             'QINGCHUN CHEN',             'fashion', 'indie', 'qingchun_chen'),
  ('liwen_liang',               'LIWEN LIANG',               'fashion', 'indie', 'liwen_liang'),
  ('untitlab',                  'UNTITLAB',                  'fashion', 'indie', 'untitlab_'),
  ('reserva',                   'RESERVA',                   'fashion', 'indie', 'usereserva'),
  ('brasilero',                 'BRASILERO',                 'footwear','indie', 'brasilero_oficial'),
  ('zantti',                    'ZANTTI',                    'fashion', 'indie', 'zantti'),
  ('penha_maia',                'PENHA MAIA',                'fashion', 'indie', 'penhamaia'),
  ('gigil',                     'GIGIL',                     'fashion', 'indie', 'gigil_lab'),
  ('lucas_adriano_atelier',     'LUCAS ADRIANO ATELIER',     'fashion', 'indie', 'lucasadriano_atelier'),
  ('mieli',                     'MIELI',                     'fashion', 'indie', 'mieli_studio'),
  ('bigandmilky',               'BIG AND MILKY',             'fashion', 'indie', 'bigandmilky'),
  ('roxie_vintage',             'ROXIE VINTAGE',             'fashion', 'indie', 'roxie_vintage')
ON CONFLICT (brand_id) DO NOTHING;

-- ── FASHION — Vintage / Other (7) ───────────────────────────────────────
INSERT INTO public.brands (brand_id, display_name, category, tier, instagram_handle) VALUES
  ('swissskulls',               'SWISSSKULLS',               'fashion',  'indie', 'swissskulls'),
  ('donde_misalas_melleven',    'DONDE MIS ALAS ME LLEVEN',  'fashion',  'indie', 'donde_misalas_melleven'),
  ('eldantes',                  'EL DANTES',                 'fashion',  'indie', 'eldantes'),
  ('honour_clothing',           'HONOUR CLOTHING',           'fashion',  'indie', 'honour.clothing'),
  ('jeffrey_campbell',          'JEFFREY CAMPBELL',          'footwear', 'contemporary', 'jeffreycampbell'),
  ('vintage_lincanto',          'VINTAGE LINCANTO',          'fashion',  'indie', 'vintage_lincanto'),
  ('epoca_barcelona',           'EPOCA BARCELONA',           'fashion',  'indie', 'epocabarcelona')
ON CONFLICT (brand_id) DO NOTHING;

-- ── ALIASES ─────────────────────────────────────────────────────────────
-- Hand-curated from SPEC §1.3 — every variant we've already seen in the
-- credit corpus. All keys are stored in their already-normalised form
-- (lowercase, no dots, single underscores) so brandAlias.js's normalise()
-- output can match directly without preprocessing the table side.
INSERT INTO public.brand_aliases (alias, brand_id, confidence) VALUES
  -- Beauty
  ('patmcgrathreal',           'pat_mcgrath_labs',         'manual'),
  ('pat_mcgrath',              'pat_mcgrath_labs',         'manual'),
  ('pat_mcgrath_labs',         'pat_mcgrath_labs',         'manual'),
  ('maccosmetics',             'mac_cosmetics',            'manual'),
  ('maccosmeticsnordics',      'mac_cosmetics',            'manual'),
  ('mac_cosmetics',            'mac_cosmetics',            'manual'),
  ('nyxcosmetics',             'nyx_professional_makeup',  'manual'),
  ('nyxcosmeticsnordics',      'nyx_professional_makeup',  'manual'),
  ('nyx_professional_makeup',  'nyx_professional_makeup',  'manual'),
  ('makeupbymario',            'makeup_by_mario',          'manual'),
  ('makeup_by_mario',          'makeup_by_mario',          'manual'),
  ('janeiredale',              'jane_iredale',             'manual'),
  ('janeiredale_norway',       'jane_iredale',             'manual'),
  ('jane_iredale',             'jane_iredale',             'manual'),
  ('maybelline',               'maybelline_new_york',      'manual'),
  ('maybelline_new_york',      'maybelline_new_york',      'manual'),
  ('caiacosmetics',            'caia_cosmetics',           'manual'),
  ('caia_cosmetics',           'caia_cosmetics',           'manual'),
  ('lethalcosmetics',          'lethal_cosmetics',         'manual'),
  ('lethal_cosmetics',         'lethal_cosmetics',         'manual'),
  ('snowdropcosmetics',        'snowdrop_cosmetics',       'manual'),
  ('snowdrop_cosmetics',       'snowdrop_cosmetics',       'manual'),
  ('duffbeauty',               'duff_beauty',              'manual'),
  ('duff_beauty',              'duff_beauty',              'manual'),
  ('panduroofficial',          'panduro',                  'manual'),
  ('panduro',                  'panduro',                  'manual'),
  -- Fashion luxury (canonical-only; admin can add nicknames later)
  ('balenciaga',               'balenciaga',               'manual'),
  ('maisonmargiela',           'maison_margiela',          'manual'),
  ('maison_margiela',          'maison_margiela',          'manual'),
  ('margiela',                 'maison_margiela',          'manual'),
  ('rickowens',                'rick_owens',               'manual'),
  ('rick_owens',               'rick_owens',               'manual'),
  ('rickowensonline',          'rick_owens',               'manual'),
  ('mugler',                   'mugler',                   'manual'),
  ('muglerofficial',           'mugler',                   'manual'),
  ('saintlaurent',             'saint_laurent',            'manual'),
  ('saint_laurent',            'saint_laurent',            'manual'),
  ('ysl',                      'saint_laurent',            'manual'),
  ('chloe',                    'chloe',                    'manual'),
  ('alexanderwang',            'alexander_wang',           'manual'),
  ('alexander_wang',           'alexander_wang',           'manual'),
  ('alexanderwangny',          'alexander_wang',           'manual'),
  ('afvandevorst',             'af_vandevorst',            'manual'),
  ('af_vandevorst',            'af_vandevorst',            'manual'),
  ('anderssonbell',            'andersson_bell',           'manual'),
  ('andersson_bell',           'andersson_bell',           'manual'),
  ('calvinklein',              'calvin_klein',             'manual'),
  ('calvin_klein',             'calvin_klein',             'manual'),
  -- Fashion contemporary/mass + footwear
  ('diesel',                   'diesel',                   'manual'),
  ('misbhv',                   'misbhv',                   'manual'),
  ('calzedonia',               'calzedonia',               'manual'),
  ('converse',                 'converse',                 'manual'),
  ('schutz',                   'schutz',                   'manual'),
  -- Fashion indie/designer
  ('markgong',                 'mark_gong',                'manual'),
  ('mark_gong',                'mark_gong',                'manual'),
  ('senseaweek',               'senseaweek',               'manual'),
  ('showroomplus',             'showroom_plus',            'manual'),
  ('showroom_plus',            'showroom_plus',            'manual'),
  ('455emble',                 '455emble',                 'manual'),
  ('qingchun_chen',            'qingchun_chen',            'manual'),
  ('qingchunchen',             'qingchun_chen',            'manual'),
  ('liwen_liang',              'liwen_liang',              'manual'),
  ('liwenliang',               'liwen_liang',              'manual'),
  ('untitlab',                 'untitlab',                 'manual'),
  ('reserva',                  'reserva',                  'manual'),
  ('usereserva',               'reserva',                  'manual'),
  ('brasilero',                'brasilero',                'manual'),
  ('brasilero_oficial',        'brasilero',                'manual'),
  ('zantti',                   'zantti',                   'manual'),
  ('penha_maia',               'penha_maia',               'manual'),
  ('penhamaia',                'penha_maia',               'manual'),
  ('gigil',                    'gigil',                    'manual'),
  ('gigil_lab',                'gigil',                    'manual'),
  ('lucas_adriano_atelier',    'lucas_adriano_atelier',    'manual'),
  ('lucasadriano_atelier',     'lucas_adriano_atelier',    'manual'),
  ('mieli',                    'mieli',                    'manual'),
  ('mieli_studio',             'mieli',                    'manual'),
  ('bigandmilky',              'bigandmilky',              'manual'),
  ('big_and_milky',            'bigandmilky',              'manual'),
  ('roxie_vintage',            'roxie_vintage',            'manual'),
  ('roxievintage',             'roxie_vintage',            'manual'),
  -- Fashion vintage/other
  ('swissskulls',              'swissskulls',              'manual'),
  ('donde_misalas_melleven',   'donde_misalas_melleven',   'manual'),
  ('eldantes',                 'eldantes',                 'manual'),
  ('honour_clothing',          'honour_clothing',          'manual'),
  ('honourclothing',           'honour_clothing',          'manual'),
  ('jeffrey_campbell',         'jeffrey_campbell',         'manual'),
  ('jeffreycampbell',          'jeffrey_campbell',         'manual'),
  ('vintage_lincanto',         'vintage_lincanto',         'manual'),
  ('epoca_barcelona',          'epoca_barcelona',          'manual'),
  ('epocabarcelona',           'epoca_barcelona',          'manual')
ON CONFLICT (alias) DO NOTHING;
