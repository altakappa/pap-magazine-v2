-- =============================================
-- PAP Magazine: Full Database Migration
-- Tables + All Data (141 Films + 317 Articles)
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Create films table
CREATE TABLE IF NOT EXISTS public.films (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  youtube_id TEXT,
  thumbnail_url TEXT,
  published_date DATE,
  categories TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  slug TEXT UNIQUE,
  credits JSONB DEFAULT '[]',
  status TEXT DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create articles table
CREATE TABLE IF NOT EXISTS public.articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  slug TEXT UNIQUE,
  published_date DATE,
  category TEXT,
  tags JSONB DEFAULT '[]',
  thumbnail_url TEXT,
  hero_image_url TEXT,
  content TEXT,
  gallery JSONB DEFAULT '[]',
  credits JSONB DEFAULT '[]',
  custom_url TEXT,
  status TEXT DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Auto-update triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS films_updated ON public.films;
CREATE TRIGGER films_updated BEFORE UPDATE ON public.films
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS articles_updated ON public.articles;
CREATE TRIGGER articles_updated BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_films_status ON public.films(status);
CREATE INDEX IF NOT EXISTS idx_films_date ON public.films(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_films_slug ON public.films(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status ON public.articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_date ON public.articles(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON public.articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_category ON public.articles(category);

-- 5. RLS Policies
ALTER TABLE public.films ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS films_public_read ON public.films;
CREATE POLICY films_public_read ON public.films FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS films_service_all ON public.films;
CREATE POLICY films_service_all ON public.films FOR ALL USING (
  current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
);

DROP POLICY IF EXISTS articles_public_read ON public.articles;
CREATE POLICY articles_public_read ON public.articles FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS articles_service_all ON public.articles;
CREATE POLICY articles_service_all ON public.articles FOR ALL USING (
  current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
);

-- 6. Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;


-- =============================================
-- FILM DATA: 141 films
-- =============================================

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('Slient Gaze', 'm7aQkN6biUk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b582c3f2ff.jpg', '2026-03-12', ARRAY['Editorial','Fashion']::text[], ARRAY['Slient Gaze']::text[], 'slient-gaze-0', '[{"r":"Art Direction & Photo & Styling & Editing","p":"the.trackers.official"},{"r":"Styling Assist","p":"saint.radoslav"},{"r":"Hair","p":"kristiyan.milev"},{"r":"MakeUp","p":"makeupbystanislav"},{"r":"Set Design","p":"sashamiteva"},{"r":"Nails","p":"_nailgasm__"},{"r":"DOP & Gaffer","p":"deni_slav"},{"r":"1st AC","p":"wandering.saturnian"},{"r":"Gaffer","p":"plam_visuals"},{"r":"Retouch","p":"aelitasphotography"},{"r":"BTS Photo","p":"plam_visuals"},{"r":"BTS Social Media Content","p":"tsetsoboy"},{"r":"Starring","p":"eda_s_k,gustav.kr,ginssssssseng,ivetfashion,1uca2e"}]'::jsonb, 'published'),
('Primal Spectrum', 'cGbRlXwBM4Q', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1502714701.jpg', '2026-03-09', ARRAY['Editorial','Fashion','Beauty']::text[], ARRAY['Primal Spectrum']::text[], 'primal-spectrum-1', '[{"r":"Makeup & Art Direction","p":"williamcruzes,ryburk"},{"r":"Photo & Film","p":"tom_barreto"},{"r":"Styling","p":"miguelcuenca"},{"r":"Camera","p":"gabrielkohari"},{"r":"Sound Design","p":"diogoesimao"},{"r":"Gaffers","p":"oiamoroso,pedromedeiros._"},{"r":"Styling Assist","p":"sousamandafnsh"},{"r":"Studio","p":"leftelstudio"},{"r":"Support","p":"qhl______"},{"r":"Starring","p":"lunerubbi,sued.oliv,jaehchang"}]'::jsonb, 'published'),
('Life After', 'uuK6nN1grBk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2fa1bbcb8f.jpg', '2026-03-03', ARRAY['Editorial','Beauty']::text[], ARRAY['Life After']::text[], 'life-after-2', '[{"r":"Photo & Art Director","p":"alexanderkazakov_visuals"},{"r":"Makeup","p":"krasilisa"},{"r":"Stylist","p":"sobolushka_"},{"r":"Stylist assist","p":"uliakhriapina"},{"r":"DOP","p":"7olko7"},{"r":"Gaffer","p":"k_staskov"},{"r":"Video","p":"denis.ozke"},{"r":"Starring","p":"nowaki_kyubi,maybobrova,screamreptiles"}]'::jsonb, 'published'),
('Aurora', 'HYXZ5XMb7pE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a6a67458a6.jpg', '2026-02-19', ARRAY['Editorial','Beauty']::text[], ARRAY['Aurora']::text[], 'aurora-3', '[{"r":"Photography","p":"romtbk"},{"r":"Art direction","p":"leandrofrt_"},{"r":"Photo light assist","p":"romainmanciot"},{"r":"Director & Editor","p":"adrien.labhar"},{"r":"Makeup","p":"beatricefatier,paintyourlips"},{"r":"Hair","p":"antoinewauquier"},{"r":"Nail","p":"kiyedico"},{"r":"Jewelry","p":"angieblingmaker"},{"r":"Sound editor","p":"th.e.o.canavese"},{"r":"Video light assist","p":"vaniayakimov,hugomourard"},{"r":"Editing","p":"rvb_paris"},{"r":"Starring","p":"chieieguchi,marilynagencyparis"}]'::jsonb, 'published'),
('The Shape of Sound', 'Q00cX_AdwmE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_7cd83fc254.jpg', '2026-02-17', ARRAY['Editorial','Fashion']::text[], ARRAY['The Shape of Sound']::text[], 'the-shape-of-sound-4', '[{"r":"Video","p":"alexandermoorestudio"},{"r":"Sound","p":"matresanch"},{"r":"Arr direction","p":"millogiglio"},{"r":"Photographer","p":"lauraandlucastudio"},{"r":"Stylist","p":"sologuaix2"},{"r":"Stylist assist","p":"sirrigesus"},{"r":"MakeUp","p":"chicherdrink"},{"r":"Hair","p":"vivianaferrari_mua"},{"r":"Studio","p":"studio_41_milano"},{"r":"Starring","p":"edoardolvv,raffamuah,xenazupanic"}]'::jsonb, 'published'),
('Before Identity', 'Nw3fJ6wHqaY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_690493ee9a.jpg', '2026-02-15', ARRAY['Editorial','Fashion']::text[], ARRAY['Before Identity']::text[], 'before-identity-5', '[{"r":"Art Director & Concept","p":"borovoy.andrey"},{"r":"Stylist","p":"oxakim_stylist"},{"r":"keup & Hair","p":"vishnevaya.mua"},{"r":"light Asist & BTS","p":"hemultan"},{"r":"light Asist","p":"mansuronn"},{"r":"Starring","p":"ali_dem"}]'::jsonb, 'published'),
('Echo of the Souls', '-PUaODSXPuY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_5cd9904d00.jpg', '2026-01-23', ARRAY['Editorial','Fashion']::text[], ARRAY['Echo of the Souls']::text[], 'echo-of-the-souls-6', '[{"r":"Video & Light Assist","p":"delta.ism"},{"r":"Photo & Producer","p":"nickwantstoniconico"},{"r":"Styling","p":"dianareglar"},{"r":"Makeup","p":"willssassy"},{"r":"Hair","p":"harrisluo_09,nine_lei"},{"r":"Production Assist","p":"meenacsenapathi"},{"r":"Light Assist","p":"masonjin2005"},{"r":"Styling Assist","p":"isaacjmes"},{"r":"Starring","p":"youroleksii,earlbbrewer"}]'::jsonb, 'published'),
('Echoes of the forgotten', 'QEXX5SKgwaY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_07191a64ee.jpg', '2025-12-29', ARRAY['Editorial','Fashion']::text[], ARRAY['Echoes of the forgotten']::text[], 'echoes-of-the-forgotten-7', '[{"r":"Photography","p":"jcphotographs_"},{"r":"Styling","p":"steph.abrajan"},{"r":"Makeup","p":"velveetmuah"},{"r":"Hair","p":"glambyjorge"},{"r":"Video & assist","p":"davtach,stevid.studio"},{"r":"Fashion filmsyn","p":"jurgen_alexander_"},{"r":"Starring","p":"imjuliahecht,quetarojas"}]'::jsonb, 'published'),
('Aurora for', 'tjJb2VovLqs', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b588bcd0ef.jpg', '2025-12-28', ARRAY['Editorial','Fashion']::text[], ARRAY['Aurora for']::text[], 'aurora-for-8', '[{"r":"Photo & Retouch","p":"numerodeplata"},{"r":"DOP & Editor & Colorist","p":"zorak.ar"},{"r":"Stylist","p":"victor___aparicio"},{"r":"Makeup & Hair","p":"lucifrede,kasteelartistmanagement"},{"r":"Stylist Assist","p":"reirainblast,ignasi_caubet"},{"r":"Photo Assist","p":"kaianaizpurua"},{"r":"Text artist","p":"reirainblast"},{"r":"Studio","p":"eltrentanou"},{"r":"Music composer","p":"carambastudios"},{"r":"Starring","p":"yana_polhovskaya,francinamodels"},{"r":"Special Thanks","p":"blendbcnshowroom,moirai.market"}]'::jsonb, 'published'),
('2Much', 'Kb6ijrd0QXw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6cd5da41e7.jpg', '2025-12-20', ARRAY['Editorial','Fashion']::text[], ARRAY['2Much']::text[], '2much-9', '[{"r":"Photo & retoucher & DA & lightset","p":"_studiovisu"},{"r":"light Assist ","p":"margueritelfabre,pierrelouis_studio"},{"r":"Video & Editing ","p":"margueritelfabre"},{"r":"Communications Assist","p":"fanny__brun"},{"r":"Casting Director ","p":"lm.casting,lizamarieferreira"},{"r":"Makeup","p":"lea_svlmua,tamareese,datzalexmua,jade.makeupartist"},{"r":"Hair","p":"createbyeve,camille_snlhair"},{"r":"Stylist","p":"yiokkoo,h2sasha,didyouseebaby.fr"},{"r":"Set designers","p":"mystere_et_compagnie__,lea.lernod,israadjr"},{"r":"Starring","p":"bradphothy,killian_pvl,mmanagementmodels,nastya_chygyryk,crystalmodelsparis,xinyiiidong,mlleagency,raphael.cenderelli,fever_mgmt,alexis.seguinot,imgmodels,robinson.cassier,bananasmodels,karen_ametos"}]'::jsonb, 'published'),
('The floor is lava', 'BEq9GTq8yTs', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_00a6a32303.jpg', '2025-12-05', ARRAY['Editorial','Art']::text[], ARRAY['The floor is lava']::text[], 'the-floor-is-lava-10', '[{"r":"Director","p":"paulinegeorgiah"},{"r":"DOP","p":"helenamayot"},{"r":"Stylist","p":"apollinecoquet"},{"r":"Hair & Makeup","p":"chloedemoussis"},{"r":"Grading","p":"comegrc"},{"r":"IA Artist","p":"dad.stream"},{"r":"Sound Composition","p":"delawhere"},{"r":"Special Thanks","p":"fivedogsofficiel"},{"r":"Starring","p":"mrgrt_0"}]'::jsonb, 'published'),
('Fishy interview', 'hhIF34lNqJQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_8bcf64e5e5.jpg', '2025-12-04', ARRAY['Editorial','Fashion']::text[], ARRAY['Fishy interview']::text[], 'fishy-interview-11', '[{"r":"Production","p":"girlsscoutstudio"},{"r":"Director & Photo","p":"ira.groza"},{"r":"Lead Actress","p":"theevaelfie"},{"r":"DOP","p":"belkasemi"},{"r":"1st AC","p":"kocmos"},{"r":"Stylist","p":"valeriasemu"},{"r":"Stylist Assist","p":"li.li.mur"},{"r":"Hair & Makeup","p":"d.e.t.u.k"},{"r":"Production Designer","p":"ohh.arch"},{"r":"Movement Director","p":"sharleen.temple"},{"r":"Sound","p":"t.rang.dao"},{"r":"Cast Coordinator","p":"theevtul,nashisushi_la"},{"r":"Producer & Starring","p":"ayaoksi"},{"r":"Starring","p":"li.li.mur,l1zzka,such_a_julie,miracle.california,chanderlandd,iammazurov,ullallally,alexandra.ostrovskaia,harrisonwader,RayLHernandezJr,LloydBlum,ConstanceBrenner"}]'::jsonb, 'published'),
('Porcelain & Shadow', 'hRG0GX91Hmw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c2ee344eea.jpg', '2025-11-26', ARRAY['Editorial','Fashion']::text[], ARRAY['Porcelain & Shadow']::text[], 'porcelain-shadow-12', '[{"r":"Photography","p":"alba_garciaa"},{"r":"Makeup & Hair","p":"ingaconarte"},{"r":"Styling","p":"silviahidalgo_mrshat,findmeinandromeda"},{"r":"Starring","p":"mar_modelyst"}]'::jsonb, 'published'),
('Fredericonceptual', 'sD8CaTLGBZ0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_51a834aa9c.jpg', '2025-11-24', ARRAY['Editorial','Fashion']::text[], ARRAY['Fredericonceptual']::text[], 'fredericonceptual-13', '[{"r":"Photo & Art Directior","p":"fredericonceptual"},{"r":"Stylist","p":"vladpavelm"},{"r":"Styling & Hair Assist & Video Footage","p":"paintersradio"},{"r":"Makeup","p":"gggw_27"},{"r":"Wardrobe Provided","p":"eidikoshowroom"},{"r":"Location","p":"palaisdetokyo"},{"r":"Starring & Video Post-Production","p":"amandascarlettt,omgmodelmanagement"}]'::jsonb, 'published'),
('Midnight at Versailles', 'TRcyljDpy28', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c7e6cb896c.jpg', '2025-11-13', ARRAY['Editorial','Fashion']::text[], ARRAY['Midnight at Versailles']::text[], 'midnight-at-versailles-14', '[{"r":"Cd & Photo","p":"danniijophotography"},{"r":"Dop & Video","p":"marigoldfilmandcolour"},{"r":"Stylist","p":"khaosbykalani"},{"r":"Makeup","p":"craighamiltonartistry,bycarolynska"},{"r":"Hair","p":"2kbraidsldn"},{"r":"Wigs & Hair","p":"sophia.dorelli"},{"r":"SFX","p":"specialfxbex"},{"r":"Stylist assist","p":"miaccamilleri"},{"r":"Assistant","p":"riorjoubert"},{"r":"Set","p":"charlotteelizabet"},{"r":"Gaffer","p":"prostar_london"},{"r":"Makeup assist","p":"loisharperbeauty"},{"r":"Starring","p":"____unladylike____,ladyparissmith,jackharvie_,nooirtattoo,graveboygrey"}]'::jsonb, 'published'),
('La Ballade Des Monsters', '3eIJ_RNoEFM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a78d551a3b.png', '2025-11-11', ARRAY['Editorial','Fashion']::text[], ARRAY['La Ballade Des Monsters']::text[], 'la-ballade-des-monsters-15', '[{"r":"Art director","p":"cassidyvelmech,cincin._"},{"r":"Photo & Art director","p":"019osmose"},{"r":"Photo assist","p":"lucasviciouss,wyattkrauss.studio,bove.studio,eden_colloid"},{"r":"Set design","p":"wmr.barn"},{"r":"Set design assist","p":"kateendge"},{"r":"Makeup","p":"antilyzz,isismugkraking,isma.siel,makeupmunster,zozornaa,6malditasea6"},{"r":"Hair","p":"createbyeve"},{"r":"Stylist","p":"olouwa.g,sweetanah_"},{"r":"Styling assist","p":"mystere_et_compagnie_,saussogod,fannybuchholz"},{"r":"Backstage photo","p":"ffd.life"},{"r":"Studio","p":"speos_photo"},{"r":"Film","p":"cassidyvelmech,bove.studio"},{"r":"Starring","p":"sveta_Ovs,amonlain,unfor_,alexacoonen,sematawi,gabrielssss_,kalikamusique,makeupmunster,badboylilous,asipofjack,manondelamonta,sarhaehfar,tamerelamandamere"}]'::jsonb, 'published'),
('Twelve Steps', 't1fUmTUycEQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f83f24876e.jpg', '2025-11-08', ARRAY['Editorial','Fashion']::text[], ARRAY['Twelve Steps']::text[], 'twelve-steps-16', '[{"r":"Art Directior & Styling & Video ","p":"thomasamabile.jpg"},{"r":"Styling assist & Audio mixing & Voice over","p":"kamilikeagod"},{"r":"Photo & Retoucher","p":"sacrocore"},{"r":"Makeup","p":"liafestamua"},{"r":"Studio","p":"sala.pose"},{"r":"Starring","p":"talonaster,ombra7829"}]'::jsonb, 'published'),
('Gloss Venom', '4v8XJDbPLHM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Pc_1_3a3573e036.jpg', '2025-11-01', ARRAY['Editorial','Fashion']::text[], ARRAY['Gloss Venom']::text[], 'gloss-venom-17', '[{"r":"Art Directior & Photography & Production & Post-production & Video & Music","p":"cami.zole"},{"r":"Art Directior &Production & AI","p":"amelielolie"},{"r":"Light Assist","p":"stoubystab"},{"r":"Wig Artist","p":"raphaelperruque"},{"r":"Makeup","p":"l__mnds"},{"r":"Starring","p":"mariektvs,zoedbarz,marilynagencyparis,reymarian,imgmodels"},{"r":"Special thanks to","p":"jean_baptiste_frey"}]'::jsonb, 'published'),
('Boytoy', 'H3LM3xKFMpo', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_7eff92e20c.jpg', '2025-10-25', ARRAY['Editorial','Fashion']::text[], ARRAY['Boytoy']::text[], 'boytoy-18', '[{"r":"Photo & Art directior","p":"Rubi__azul"},{"r":"Hair","p":"Soh_soh_soh_"},{"r":"Nails","p":"Medusa_berlin"},{"r":"Makeup","p":"hugo.trixx,luagamy.mua"},{"r":"Styling","p":"rubi__azul,mnemyts,conlakdeklidad"},{"r":"Styling Assist","p":"Ap0l0ni0"},{"r":"Starring","p":"nmnrden,baj_v_noci,emidemmi_"}]'::jsonb, 'published'),
('Immersed in Confusion', 'QycWR6A8ONI', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_fb716582e2.jpg', '2025-10-23', ARRAY['Editorial','Fashion']::text[], ARRAY['Immersed in Confusion']::text[], 'immersed-in-confusion-19', '[{"r":"Photographer","p":"tatiana_malinnikowa"},{"r":"Video","p":"filmsbylevitt"},{"r":"Stylist","p":"katarzyna_spietelun_"},{"r":"Makeup","p":"ygg_by_ng"},{"r":"Hair","p":"mdkmiecik"},{"r":"Location","p":"off_marina"},{"r":"Starring","p":"rita_jako,gagamodels"},{"r":"Fashion by","p":"calzedonia,fajerska_projektantka_mody,simplecreativeproducts,ritakrzysiek_shoemaker,ratandboa,jilsander,kazar,micaela_greg,prada,jakubbocianowskiofficial,karolinamichniewicz,latexhautecouture,jeffreycampbell"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('Faer', 'EqES46Uxwmo', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_faa0e25250.jpg', '2025-10-11', ARRAY['Editorial','Fashion']::text[], ARRAY['Faer']::text[], 'faer-20', '[{"r":"Photography & Art directior & Styling ","p":"fannymaillardcw"},{"r":"Makeup","p":"mariemakeupartist"},{"r":"Nail","p":"naildelice"},{"r":"Photo assist","p":"allian,meretkernen"},{"r":"Starring","p":"lauura_001,blowmodels"},{"r":"Fashion by","p":"jadedldn,palomawool,laforgemedievale,evadehouse,3rd.world.elite"}]'::jsonb, 'published'),
('Exit Void Bizzarre', '5AvI0PwvMQ8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b6ef438187.jpg', '2025-10-06', ARRAY['Editorial','Fashion']::text[], ARRAY['Exit Void Bizzarre']::text[], 'exit-void-bizzarre-21', '[{"r":"Videography & Music","p":"aaronalanmitchell"},{"r":"Film title","p":"yonelson"},{"r":"Photography","p":"elizakania_"},{"r":"Art directior & Production","p":"ezravlinder,elizakania_"},{"r":"Styling","p":"aniaablinova"},{"r":"Makeup","p":"gypsymakeupme"},{"r":"Hair","p":"mingusanganois,kuro_hair"},{"r":"Photo assist","p":"jquayson"},{"r":"Styling assist","p":"lennardsap5"},{"r":"Hair assist","p":"jipcat"},{"r":"Starring","p":"ualutkizapiecem,brooksmodelingagency,uncovermodelswarsaw,ezravlinder"}]'::jsonb, 'published'),
('Between Us', 'yYkB99ZpkcM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4c3a3c0161.jpg', '2025-09-26', ARRAY['Editorial','Fashion']::text[], ARRAY['Between Us']::text[], 'between-us-22', '[{"r":"Post Edit","p":"Stefan_pecher"},{"r":"Music","p":"Johanngrahamengelhardt"},{"r":"Sound Design & Mixing","p":"Nikibaerchen"},{"r":"Behind","p":"Paytonkuhn"},{"r":"Production Assist","p":"Pablojhphoto,Coleman.Ex"},{"r":"Director","p":"Fredericblindow,J.Berj"},{"r":"Creative Director","p":"Ry_phung"},{"r":"Director Of Photography","p":"Derekmatar"},{"r":"Photographer","p":"J.Berj"},{"r":"Creative Producer","p":"Iamdakotagriffin"},{"r":"Styling","p":"Ry_phung"},{"r":"Styling Assist","p":"Kxxstxl_"},{"r":"Makeup","p":"Ryann.Carter,Opusbeauty"},{"r":"Hair","p":"Brooke.Is.Fine"},{"r":"Hair Assist","p":"Grayglob"},{"r":"Colour","p":"Tmls.Tv"},{"r":"Colourist","p":"Didrikbrathen"},{"r":"Colour Producer","p":"Mimisand"},{"r":"Colour Assist","p":"Malin_imerslund,Chrisremyberrefjord"},{"r":"Graphic Design ","p":"Tomas_bim"},{"r":"Casting Director","p":"Iamdakotagrifin"},{"r":"Starring","p":"Victoriareath_,Mindyyymiao,Elisabetherm,Elisa_primatic"}]'::jsonb, 'published'),
('Heavy Metal', 'kvUnYGhSPVs', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c62173bee0.jpg', '2025-08-29', ARRAY['Editorial','Fashion']::text[], ARRAY['Heavy Metal']::text[], 'heavy-metal-23', '[{"r":"Cinematography","p":"brettsylvia,colorboxcine"},{"r":"Photographer","p":"greg_caparell"},{"r":"Photo assist","p":"kaitlinprince_photos"},{"r":"1st ac","p":"_joshharwood"},{"r":"Stylist","p":"danajkramer,anchorartists,kyleighduarte,arkyive"},{"r":"Stylist assist","p":"rileyjordanstyling"},{"r":"Makeup & Hair","p":"arturodraper,hsartistry,hausofbeautynh"},{"r":"Starring","p":"chancealexandre,modelclubinc,nextworldwide,agenciamodels_athens,primarymgt,leiasophias,geneticsmgmt"}]'::jsonb, 'published'),
('Ad Astra per Tenebras', 'OUmhIq_JELA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_26e85c653c.jpg', '2025-07-19', ARRAY['Editorial','Fashion']::text[], ARRAY['Ad Astra per Tenebras']::text[], 'ad-astra-per-tenebras-24', '[{"r":"Video editor ","p":"croqueta_21"},{"r":"Photographer","p":"teresamaria.z"},{"r":"Digital assist","p":"oscargallafoto"},{"r":"Light assist","p":"emmanuel.hdr_,n3vraxx"},{"r":"Stylist","p":"camyllana"},{"r":"Stylist Assist","p":"francescaabrero"},{"r":"Makeup","p":"regardemua,giuliaantonioli.mua"},{"r":"Nail","p":"linasnailsstudio_"},{"r":"Set desgner","p":"aliiceeeeeeeeeeee"},{"r":"Set assist","p":"mayaagabbi"},{"r":"Starring","p":"ggiacomoffranci,classlourry"}]'::jsonb, 'published'),
('L’Homme Obscur', 'dFCOQi03Wic', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover_684c1d8a4d.png', '2025-07-16', ARRAY['Editorial','Fashion']::text[], ARRAY['L’Homme Obscur','film','songzio','baejungnam','songziohomme','배정남','송지오']::text[], 'lhomme-obscur-25', '[{"r":"Brand","p":"songzio.official"},{"r":"Flimmaker","p":"zionlacroix"},{"r":"Photographer","p":"tsaulrae"},{"r":"Editor","p":"kimim0o"},{"r":"Hair","p":"darwuinsavila"},{"r":"Makeup","p":"patricianeglam"},{"r":"Graphic","p":"krystaliike"},{"r":"Starring","p":"jungnam_bae"}]'::jsonb, 'published'),
('Pathogen', 'yEI4DBTtQNU', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_cec29216b9.jpg', '2025-07-11', ARRAY['Editorial','Fashion']::text[], ARRAY['Pathogen','film']::text[], 'pathogen-26', '[{"r":"Photography","p":"gomezdevillaboa"},{"r":"Stylist","p":"feruladedescarga"},{"r":"Hair & Makeup","p":"onyxunleashed"},{"r":"Styling & Photo Assist","p":"magda_mags,joseterenzi,nikolawho,ali_bajo,dv1Ln,mariachoss,anapaugonzalez_,itsnotvini,violetaaasilvaa,ratacosturera_,avgaavgaavga,majorobles22,ximsantoyo.styling,artisticmind.n.p,sofiiagarciao,trinidad.rg,marcelourena_,__bhumishah__,samayareddyy"},{"r":"Starring","p":"onyxunleashed"}]'::jsonb, 'published'),
('Canvas Couture', '_T95VlHizlY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_cd887eb175.jpg', '2025-07-05', ARRAY['Editorial','Fashion']::text[], ARRAY['Canvas Couture']::text[], 'canvas-couture-27', '[{"r":"Photographer","p":"doma_dovgialo"},{"r":"Director","p":"doma_dovgialo"},{"r":"Photo Assist","p":"eddie.davi3s"},{"r":"Stylist","p":"florentyna_syperek"},{"r":"Stylist Assist","p":"adam_pietraszewski,sotheavyteng"},{"r":"DOP & Edit","p":"awaisnouman"},{"r":"Makeup & Hair","p":"somerveille"},{"r":"Set Design","p":"marcoturcich"},{"r":"Stills Retoucher","p":"AlisonStepanyan"},{"r":"PA","p":"emy.dentler"},{"r":"Location","p":"JoeGiacometStudio"},{"r":"Starring","p":"tatjanasaric,solidsilversister"}]'::jsonb, 'published'),
('Wild bloom', '287k2s_mdz0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_3a0f3d1724.jpg', '2025-06-28', ARRAY['Editorial','Fashion']::text[], ARRAY['Wild bloom']::text[], 'wild-bloom-28', '[{"r":"Photographer","p":"annapozzi_portfolio"},{"r":"Art director","p":"manila.fashion.stylist"},{"r":"Stylist","p":"manila.fashion.stylist"},{"r":"Stylist Assist","p":"ViacheslavNikiforov"},{"r":"Makeup & Hair","p":"stylist.iri"},{"r":"Retoucher","p":"sheda_rt"},{"r":"Ai video","p":"one.fashion.agency"},{"r":"Video","p":"annapozzi_portfolio,one.fashion.agency"},{"r":"Starring","p":"lily.chapmann"}]'::jsonb, 'published'),
('A long, long quest for the calling', 'uk0Tnj25XRM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c9a8bf639a.jpg', '2025-06-23', ARRAY['Editorial','Fashion']::text[], ARRAY['A long','long quest for the calling','film']::text[], 'a-long-long-quest-for-the-calling-29', '[{"r":"Video","p":"e_33ence"},{"r":"Art direction ","p":"seemoneee"},{"r":"Photography","p":"seemoneee"},{"r":"Assistant","p":"dkysns"},{"r":"Stylist","p":"suusushin,sweetproust"},{"r":"Art","p":"hohaseo,craftbloom_official"},{"r":"Florist","p":"unmanagablegirl"},{"r":"Hair","p":"hair_jjjiin"},{"r":"Makeup","p":"blursh.lab"},{"r":"Starring","p":"_k_minah"}]'::jsonb, 'published'),
('Surreal Chess Dreamscape', 'LCBmXR02Xp8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a98f105a4b.jpg', '2025-06-20', ARRAY['Editorial','Fashion']::text[], ARRAY['Surreal Chess Dreamscape']::text[], 'surreal-chess-dreamscape-30', '[{"r":"Credits","p":"agenxin"},{"r":"Videographer","p":"henrylunyc"},{"r":"Creative director ","p":"nycphoto_sibila"},{"r":"Production assist","p":"__bongik"},{"r":"Photo assist","p":"jiajie.vivian_lyu"},{"r":"Retoucher","p":"mirejk_photography"},{"r":"Makeup","p":"juanavieda,hugginsmaria"},{"r":"Hair","p":"_leithestylist"},{"r":"Stylist","p":"sophiebohmeier"},{"r":"Starring","p":"itsmesarat,benlechter,olamididi,mychaelgreeeen"}]'::jsonb, 'published'),
('Paparatzi', '5rvI9M2B9Ms', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_34d818773b.jpg', '2025-04-07', ARRAY['Editorial','Fashion']::text[], ARRAY['Paparatzi']::text[], 'paparatzi-31', '[{"r":"Creative Director","p":"ivanaguilera.style"},{"r":"Photography","p":"irinaguemez"},{"r":"Retouch","p":"irinaguemez"},{"r":"Photo Assist","p":"marissa.illust"},{"r":"Styling","p":"ivanaguilera.style"},{"r":"Styling Assist","p":"laurins13"},{"r":"Starring","p":"dragchacha"}]'::jsonb, 'published'),
('Tras Bambalinas', 'hOcFjQiW9X8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_0ce04acbaf.jpg', '2025-04-03', ARRAY['Editorial','Fashion']::text[], ARRAY['Tras Bambalinas']::text[], 'tras-bambalinas-32', '[{"r":"Creative Direction","p":"magucaffoz"},{"r":"Videomaker","p":"samuele_donghia"},{"r":"Styling","p":"magucaffoz"},{"r":"Makeup & Hair","p":"sax_makeup"},{"r":"Assistant Light","p":"grivettal"},{"r":"Starring","p":"e.mh.ily"}]'::jsonb, 'published'),
('System', '1OgozyEOeyQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b0eeec8c3b.jpg', '2025-03-26', ARRAY['Editorial','Fashion']::text[], ARRAY['System','film']::text[], 'system-33', '[{"r":"Photographer","p":"andrew.twinbrthrs,kirill.twinbrthrs"},{"r":"Art direction","p":"wwwhydee"},{"r":"Styling","p":"wwwhydee"},{"r":"Line producer","p":"glushkova_prof"},{"r":"MakeUp","p":"elviranoir_"},{"r":"Hair","p":"sashashortcut"},{"r":"Nails","p":"want_nailss"},{"r":"Assistant","p":"cherrrnykh"},{"r":"Location manager","p":"zinichas_avtourist"},{"r":"Starring","p":"sonyaamaltsevaa"}]'::jsonb, 'published'),
('Who is she?', '-2Ajn5Sd7Hw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2af7e4fd65.jpg', '2025-03-16', ARRAY['Editorial','Fashion']::text[], ARRAY['Who is she?']::text[], 'who-is-she-34', '[{"r":"Video","p":"thomashabr"},{"r":"Photographer","p":"filiphlad"},{"r":"Styling","p":"kelm_style"},{"r":"Styling Assist","p":"danilpyima"},{"r":"Makeup & Hair","p":"jitkabou"},{"r":"Starring","p":"ozirochka,exitmodelmanagement"}]'::jsonb, 'published'),
('I Shine', 'QSc-e9EcLWs', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_abd724cfec.jpg', '2025-03-14', ARRAY['Editorial','Fashion']::text[], ARRAY['I Shine']::text[], 'i-shine-35', '[{"r":"Art Director","p":"aleandrie"},{"r":"Photographer","p":"frankferone"},{"r":"Stylist","p":"aleandrie"},{"r":"Makeup","p":"_makeupbyfabiana"},{"r":"Tooth Gems","p":"outofgems"},{"r":"Starring","p":"_orrido_,ventisei_,leilaxsavadogo,saintvenere"},{"r":"Special Thanks to","p":"andreeamanuelamihalache"}]'::jsonb, 'published'),
('Fractured Minds', '-19vVXQRVt0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_8355d92a85.jpg', '2025-03-07', ARRAY['Editorial','Fashion']::text[], ARRAY['Fractured Minds','film']::text[], 'fractured-minds-36', '[{"r":"Creative Director","p":"lu3alo,sheismaia_agency"},{"r":"Photographer","p":"marcelogomezph"},{"r":"Photo Assist","p":"fdc97_"},{"r":"Stylist","p":"lu3alo,sheismaia_agency"},{"r":"Stylist Assist","p":"julizzavalle"},{"r":"MakeUp & Hair","p":"my_in_genius"},{"r":"Post Production","p":"nikadness_,retouch_katya"},{"r":"Starring","p":"lanierhandy,elitenyc"}]'::jsonb, 'published'),
('We are food', 'LXCESBIUQGo', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_de3cb06451.jpg', '2025-03-01', ARRAY['Editorial','Art']::text[], ARRAY['We are food','art']::text[], 'we-are-food-37', '[{"r":"Creative Direction","p":"not.pena"},{"r":"Art direction","p":"avgaavgaavga"},{"r":"Videography","p":"delfinaciancio"},{"r":"Styling","p":"ratacosturera_"},{"r":"Styling assist","p":"nikolawho"},{"r":"Set design","p":"delfinacomoeldelfin"},{"r":"Set design assist","p":"candelrua"},{"r":"Makeup & Hair","p":"ginebracaducada"},{"r":"MUAH assist","p":"mamiquieroserartista"},{"r":"Starring","p":"me.anamar,charlottenaav,elenaurdiales,barbie_krr,iam_lyubov"}]'::jsonb, 'published'),
('Slithering', 'gYGLHJKe6tU', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a88ce5dde5.jpg', '2025-02-25', ARRAY['Editorial','Fashion','Beauty']::text[], ARRAY['slithering']::text[], 'slithering-38', '[{"r":"Creative Direction","p":"tiffany_baron_"},{"r":"DOP","p":"jacobmcfadden"},{"r":"Starring","p":"thekatbook,the.diversityagency,mylohhi,nevsmodels,wesmatsukawilliams,thesquadmanagement"}]'::jsonb, 'published'),
('Warrior princess', 'oFC3OA53SP8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_145cb7f53a.jpg', '2025-02-18', ARRAY['Editorial','Fashion']::text[], ARRAY['Warrior princess']::text[], 'warrior-princess-39', '[{"r":"Videographer","p":"marco_ph.mw"},{"r":"Art Direction","p":"ladecadanse.studio"},{"r":"Styling","p":"ladecadanse.studio"},{"r":"Hair & Makeup","p":"cinziatri"},{"r":"Nails","p":"aurii.nails"},{"r":"Starring","p":"korlanmadi"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('Links of Self', 'l_jBYS441RQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6616718748.jpg', '2025-02-12', ARRAY['Editorial','Fashion']::text[], ARRAY['Links of Self']::text[], 'links-of-self-40', '[{"r":"Videography","p":"lavvoaev"},{"r":"Original music","p":"_mauvvvv"},{"r":"Starring","p":"oujiana"}]'::jsonb, 'published'),
('Boy Who Turns Into Stardust ', 'GEANTuB3g_o', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_c157e9a046.jpg', '2025-02-01', ARRAY['Editorial','Fashion']::text[], ARRAY['Boy Who Turns Into Stardust','Backstage']::text[], 'boy-who-turns-into-stardust-41', '[{"r":"Creative Director","p":"amaurineto_"},{"r":"Backstage editor","p":"batxxbat"},{"r":"Photographer","p":"gustavozylbersztajn"},{"r":"Makeup & Hair","p":"crisbiato"},{"r":"Stylist","p":"katharinavtaylor"},{"r":"Stylist assist","p":"gagumsilvestre"},{"r":"Set Designer","p":"lucyland.lununes"},{"r":"Photo assist","p":"ander_sb77"},{"r":"Graphic Designer","p":"gustvovieira"},{"r":"Set Designer Rocks","p":"galpaooito,fetadeu"},{"r":"Agency","p":"waymodel,dandoway,brunoyg,andretold"},{"r":"Studio","p":"estudio.janela,juliapavin"},{"r":"Starring","p":"rafafonseca"},{"r":"Fashion by","p":"balenciaga,rickowensonline,pitonlab,aneoutopia,eduardocaires,yar.atelier"}]'::jsonb, 'published'),
('Broken Flowers', 'rP0tyFylmWI', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_851a832101.jpg', '2025-01-24', ARRAY['Editorial','Fashion']::text[], ARRAY['Broken Flowers','film','Backstage']::text[], 'broken-flowers-42', '[{"r":"Video","p":"_ivantesta"},{"r":"Photographer","p":"_maurotesta"},{"r":"Stylist","p":"fabian__galindo"},{"r":"Makeup","p":"emezmakeup"},{"r":"Photo Assist","p":"paulmeraki"},{"r":"Studio","p":"masterprostudio"},{"r":"Starring","p":"akoldemeen,trendmodelsmgmt"}]'::jsonb, 'published'),
('Velvet Rebellion', 'kYoOYrXt46w', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_0d4839534c.jpg', '2025-01-22', ARRAY['Editorial','Fashion']::text[], ARRAY['Velvet Rebellion','BACKSTAGE']::text[], 'velvet-rebellion-43', '[{"r":"Art Direction","p":"madita.talies"},{"r":"Photography","p":"madita.talies"},{"r":"Hair & Makeup","p":"joelynsteinbeck"},{"r":"Styling","p":"amelielaurab"},{"r":"Assistant","p":"maximelouisee"},{"r":"Starring","p":"debiskm,m4models"}]'::jsonb, 'published'),
('A Journey to Self-Acceptance', 'EtaF5jXt3fg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_3e9ad6d468.jpg', '2025-01-13', ARRAY['Editorial','Fashion']::text[], ARRAY['A Journey to Self-Acceptance','film']::text[], 'a-journey-to-self-acceptance-44', '[{"r":"Video","p":"Luidgi.Alexis"},{"r":"Photographer","p":"tiwel_"},{"r":"Stylist","p":"barbu"},{"r":"Makeup","p":"datzalexmua"},{"r":"Artistic Direction","p":"tiwel_"},{"r":"Assistant","p":"Luidgi.Alexis"},{"r":"Starring","p":"Elviedesu"}]'::jsonb, 'published'),
('A wicked game', '_UpkiV3Xaro', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_e522e2dc57.jpg', '2025-01-10', ARRAY['Editorial','Fashion']::text[], ARRAY['A wicked game']::text[], 'a-wicked-game-45', '[{"r":"Photographer","p":"sbarucha"},{"r":"Makeup & Hair","p":"sarah_gehrmann_hmua"},{"r":"Styling","p":"style_by_suzana"},{"r":"Starring","p":"valeriaromach,via_model_management"}]'::jsonb, 'published'),
('Fighting The Dragon', 'croy9NqSxfo', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_0e58c1202f.jpg', '2024-12-26', ARRAY['Editorial','Fashion']::text[], ARRAY['Fighting The Dragon','film']::text[], 'fighting-the-dragon-46', '[{"r":"Video","p":"zuzagolas"},{"r":"Photography","p":"jakub_jezierski"},{"r":"Set design","p":"dominik__jastrzebski"},{"r":"Styling","p":"wiktoria___krol_"},{"r":"Makeup & Hair","p":"koletagabrysiak"},{"r":"Gaffer","p":"mnowosad"},{"r":"Photo assist","p":"zuzagolas"},{"r":"Studio","p":"okustudio.pl"},{"r":"Starring","p":"fryderykawicherkiewicz,divisionmodel"}]'::jsonb, 'published'),
('Ego Superstar', 'V7flPNuzvvE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_36b93205d3.jpg', '2024-12-19', ARRAY['Editorial','Fashion']::text[], ARRAY['Ego Superstar']::text[], 'ego-superstar-47', '[{"r":"Video","p":"rubi__azul,aestheticalpleasingshit"},{"r":"Music","p":"estratosfera___"},{"r":"Direction","p":"rubi__azul"},{"r":"Production","p":"bazofiasofia"},{"r":"Makeup","p":"ilya.fesenko,sombrazul_,karlaromeromakeup"},{"r":"Hair","p":"tupalovaalina,karlaromeromakeup"},{"r":"Styling","p":"conlakdeklidad,rubi__azul"},{"r":"Nails","p":"medusa_berlin"},{"r":"Starring","p":"viridianmarbles,creationisnotacrime,lxcxxnxp"}]'::jsonb, 'published'),
('Fashion That Just Won''t Cover Up', '6yjW-mHU95g', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c4b7a56fd4.jpg', '2024-12-06', ARRAY['Editorial','Fashion']::text[], ARRAY['Fashion That Just Won''t Cover Up']::text[], 'fashion-that-just-wont-cover-up-48', '[{"r":"DOP","p":"harryblackley"},{"r":"Directed","p":"roisino_"},{"r":"Photography","p":"andyhoangphoto"},{"r":"Styling","p":"styledbyfreya"},{"r":"Makeup","p":"sophiegiamoore"},{"r":"Hair","p":"edoco_hair"},{"r":"Colourist","p":"isaachargreaves"},{"r":"Nails","p":"nailedbyhotwing"},{"r":"Photo Assist","p":"waleidoscope"},{"r":"Production assist","p":"junayd.khan5"},{"r":"Starring","p":"blimey_riley,selectmodelglobal,yixuan_effy,jocelyn_adu"}]'::jsonb, 'published'),
('Subverting Expectations', '5A8IjOEAti4', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3fd759d08f.jpg', '2024-11-09', ARRAY['Editorial','Fashion']::text[], ARRAY['Subverting Expectations']::text[], 'subverting-expectations-49', '[{"r":"Art director","p":"antonietta_dalessio"},{"r":"Photographer","p":"cristiano_temporin"},{"r":"Hair","p":"mrsmithhair"},{"r":"Makeup","p":"lilcavallina"},{"r":"Stylist","p":"antonietta_dalessio"},{"r":"Stylist assist","p":"fabianaborrielloo,giulia._capone,_conservamatteo_"},{"r":"Starring","p":"dobee14,elitemodelworld"}]'::jsonb, 'published'),
('Annie', 'UkMGy9JIJb8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_fb71a2210d.jpg', '2024-10-23', ARRAY['Editorial','Fashion']::text[], ARRAY['Annie']::text[], 'annie-50', '[{"r":"Film director ","p":"jhenyfy_muller"},{"r":"Creative director ","p":"jhenyfy_muller"},{"r":"Styling","p":"vasilbozhilov"},{"r":"Hair","p":"anastasialawadi"},{"r":"Makeup","p":"Sara.ymakeup"},{"r":"Location","p":"bickibossstudio"},{"r":"Special thanks ","p":"mr.plala"},{"r":"Starring","p":"annie_karwi"}]'::jsonb, 'published'),
('Funeralopolis', '0_xxufxz_aE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_fa6136dd5e.jpg', '2024-10-18', ARRAY['Editorial','Fashion']::text[], ARRAY['Funeralopolis','Alessia Nocera','branded content']::text[], 'funeralopolis-51', '[{"r":"Brand","p":"_alessianocera_"},{"r":"Fashion film","p":"michfilmkr"},{"r":"Creative direction","p":"michfilmkr"},{"r":"DOP","p":"michfilmkr"},{"r":"Editing & Music ","p":"michfilmkr"},{"r":"Art & Creative Director","p":"_alessianocera_"},{"r":"Styling","p":"_alessianocera_"},{"r":"Makeup & Hair ","p":"narcolexiia"},{"r":"Starring","p":"michaelbruny,alien_juli4,francescadibonitoo,xyadpyx,carmine_pierro_"}]'::jsonb, 'published'),
('I’m Late for Work', 'UTYfsxODViU', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_532204ab96.jpg', '2024-10-14', ARRAY['Editorial','Fashion']::text[], ARRAY['I’m Late for Work','film']::text[], 'im-late-for-work-52', '[{"r":"Cinematographer","p":"kehfam"},{"r":"Editor","p":"kehfam"},{"r":"Score","p":"young_dervish"},{"r":"Sound Design","p":"alright_yao"},{"r":"Stylist","p":"kennylgstylist"},{"r":"Wardrobe","p":"blacknvni"},{"r":"Hair","p":"tanyawhite___"},{"r":"Makeup","p":"pangzouathor"},{"r":"Stylist Assist","p":"verose_val,casswastaken"},{"r":"Production","p":"casswastaken"},{"r":"Starring","p":"riley.leonard"}]'::jsonb, 'published'),
('Shadow', 'KPzAalyvf2w', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_604744b766.jpg', '2024-10-11', ARRAY['Editorial','Fashion']::text[], ARRAY['Shadow']::text[], 'shadow-53', '[{"r":"Photographer","p":"nationaltreasure"},{"r":"Creative Director","p":"witchs.broom"},{"r":"Stylist","p":"witchs.broom"},{"r":"Makeup","p":"witchs.broom"},{"r":"Makeup Assist","p":"venenochelle"},{"r":"Director Assist","p":"mp3demi"},{"r":"Light Assist","p":"aricvhphoto,liam4shore"},{"r":"Starring","p":"kittyumina,sugaplumcris"},{"r":"Fashion by","p":"erikch4r,s1lver.seams,piecesofporcelain,sedonalegge"}]'::jsonb, 'published'),
('Visceral', 'dtPHhCSx5OQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2c350b1a98.jpg', '2024-10-04', ARRAY['Editorial','Fashion']::text[], ARRAY['visceral']::text[], 'visceral-54', '[{"r":"Creative Direction","p":"alvarodserra"},{"r":"Production","p":"alvarodserra"},{"r":"Video & SFX","p":"aestheticalpleasingshit"},{"r":"MakeUp & Hair","p":"andreaegidomuah,lademaqui"},{"r":"Makeup Assist","p":"neerrr,ameliebardera.mk,adrixnueve,jva_fx"},{"r":"Styling","p":"nat_lorenzzo"},{"r":"Styling assist","p":"jorgeclemente_5"},{"r":"Voice Over","p":"_maxtimothy"},{"r":"Set design","p":"saioa.dezerio,hayacomoelarbol"},{"r":"Starring","p":"_satanasa,ellamuore,pabblogarcia,ferrabe08,carb0nelll,henrysll,laurentmeri24,franuis.rosso,ezra.mal"}]'::jsonb, 'published'),
('A Pool Story : Kiss Shot', '-j6RBckT6uk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b8ae448861.jpg', '2024-09-20', ARRAY['Editorial','Fashion']::text[], ARRAY['A Pool Story : Kiss Shot']::text[], 'a-pool-story-kiss-shot-55', '[{"r":"Videographer","p":"tahababacannn"},{"r":"Video Assist","p":"umutbozyil"},{"r":"Stylist","p":"leamistrafovic"},{"r":"Makeup & Hair","p":"makeoverhamburg"},{"r":"Assist","p":"inga_1502"},{"r":"Starring","p":"cindyreisc"}]'::jsonb, 'published'),
('Eleganza Resiliente', '39tkTyZqwCY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6b85df066e.jpg', '2024-09-14', ARRAY['Editorial','Fashion']::text[], ARRAY['Eleganza Resiliente']::text[], 'eleganza-resiliente-56', '[{"r":"Filmmaker","p":"samuele.petrin"},{"r":"Cinematography","p":"lorenzocaramelli"},{"r":"Director","p":"raffaellacampeggi"},{"r":"Art Director","p":"majovelascoo"},{"r":"Stylist","p":"isabellagao_"},{"r":"Stylist assistant","p":"alan_tinajero"},{"r":"Makeup & Hair","p":"jasmyne_gc_makeup_"},{"r":"Set designer","p":"sarebbe.bellissimo"},{"r":"Casting director","p":"nala_reale"},{"r":"Production","p":"isabellagao_"},{"r":"Studio","p":"menouno.eu"},{"r":"Studio manager","p":"alessandraalba_"},{"r":"Starring","p":"nastyaa.gonchar,manifestomodels,benattitais,fashionmodel.it"}]'::jsonb, 'published'),
('Fashion Olympics', '-JrUCQqphWM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_30f2ac242d.jpg', '2024-09-10', ARRAY['Editorial','Fashion']::text[], ARRAY['Fashion Olympics']::text[], 'fashion-olympics-57', '[{"r":"Videographer","p":"carlmax_official"},{"r":"Stylist","p":"tina.musiba,melaninairre"},{"r":"Makeup","p":"evierawnsley.mua"},{"r":"Assitant","p":"picasso.projects,norfnorfnoir"},{"r":"Starring","p":"saskia_roy,melaninairre,salmonsuushimi,tishainyconstancia,bae.bela"}]'::jsonb, 'published'),
('The Gardeners', 'rjZFLh4YUFY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_dd8f821620.jpg', '2024-09-08', ARRAY['Editorial','Fashion']::text[], ARRAY['The Gardeners','BACKSTAGE']::text[], 'the-gardeners-58', '[{"r":"Photographer","p":"hupe.clara"},{"r":"Light & Digital Assist","p":"paul.beaumond"},{"r":"Makeup","p":"alxmkup"},{"r":"Stylist","p":"amelielavigne"},{"r":"Starring","p":"adrienvoutaz,montagemodels"}]'::jsonb, 'published'),
('Billions of nights', 'P57ZLQFb55A', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2087c2e011.jpg', '2024-09-04', ARRAY['Editorial','Fashion']::text[], ARRAY['Billions of nights']::text[], 'billions-of-nights-59', '[{"r":"Photography","p":"dylan_lu2000"},{"r":"Retouch","p":"dylan_lu2000"},{"r":"Styling","p":"derio_chua"},{"r":"Makeup","p":"tansypanp"},{"r":"Hair","p":"liu_dddongzi"},{"r":"Set design","p":"Ww"},{"r":"Light assist","p":"xidong1998,Halsey"},{"r":"Fashion by ","p":"chatsbycdam,pearlona_jewelry,jellojellousa,edito.of,Chicxūab,Darkness Lab,Provoka,Uhot,Yooyojim"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('Fantasia', '-ohjourOIMk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c9a103e000.jpg', '2024-08-28', ARRAY['Editorial','Fashion']::text[], ARRAY['Fantasia']::text[], 'fantasia-60', '[{"r":"Creative director ","p":"danniijophotography"},{"r":"Video","p":"moonimmischmedia"},{"r":"Stylist","p":"khaosbykalani"},{"r":"Makeup","p":"saph.hmua"},{"r":"Hair","p":"soulkittten"},{"r":"Stylist assist","p":"yasmin.alzd,taylor sprinkle"},{"r":"Set Design","p":"eleanormarystrong"},{"r":"Set assist","p":"zenella.a"},{"r":"Studio","p":"devotedcreatives"},{"r":"Starring","p":"smizerc,lilianawolde"},{"r":"Fashion by","p":"miiiiwiii,Alexandermcqueen,acnestudios,epona_,mugler,prada,clarktilly,dolcegabbana,rickowens,miiiiwiii,paulmacspecial,ysl"}]'::jsonb, 'published'),
('Fugaces de l’enfance', 'ciLkTszknWA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f17c8b27d0.jpg', '2024-08-15', ARRAY['Editorial','Beauty']::text[], ARRAY['Fugaces de l’enfance','beauty','make up']::text[], 'fugaces-de-lenfance-61', '[{"r":"Film","p":"ninjahanna"},{"r":"Director","p":"ninjahanna"},{"r":"Music","p":"ninjahanna"},{"r":"Makeup & Hair","p":"johannanordlander"},{"r":"MakeUp Assist","p":"Isabella Johansson ,Wanda Persson"},{"r":"Starring","p":"Belle,Liz,Josefin"}]'::jsonb, 'published'),
('Imprinted', '-CDBsdslfyM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_8f372a5254.jpg', '2024-08-13', ARRAY['Editorial','Fashion']::text[], ARRAY['Imprinted']::text[], 'imprinted-62', '[{"r":"Photographer","p":"sbarucha"},{"r":"Hair","p":"nicolelivaja"},{"r":"MakeUp","p":"beauty_makeup_by_larissa"},{"r":"Styling","p":"helen.spiegelhalter"},{"r":"Retoucher","p":"vitaliifidyk_retouch"},{"r":"Starring","p":"blanka_trombitas,viviennemodels"},{"r":"Fashion by","p":"acnestudios,boss,spiegelhalter.jewelry,jeanpaulgaultier,topshop,asos,weekdayofficial"}]'::jsonb, 'published'),
('Refraction', 'JqunGkXeWT8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_298042c85c.jpg', '2024-08-09', ARRAY['Editorial','Fashion']::text[], ARRAY['Refraction','film']::text[], 'refraction-63', '[{"r":"Direction","p":"ponoponoponpon"},{"r":"Video direction ","p":"green_graphic000"},{"r":"Video","p":"jp_1iam"},{"r":"Light direction ","p":"yoheum_"},{"r":"Styling","p":"ponoponoponpon"},{"r":"Hair","p":"ringosat"},{"r":"Makeup","p":"mokawadamakeup"},{"r":"Nail","p":"tomomiaua"},{"r":"Makeup assist","p":"sora_koko2525"},{"r":"Starring","p":"chelsy____,yuki_pob,mille_management_inc"},{"r":"Fashion by","p":"shushu__tong,florentinaleitner_,dimatnoon,itimi.jp,susanfangofficial,kasiaku,simonewild_,givenchy,coa.nyc,adidasoriginals"}]'::jsonb, 'published'),
('Encuentro', 'wKOnbgNRZgo', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_ac030eecee.jpg', '2024-08-06', ARRAY['Editorial','Fashion']::text[], ARRAY['Encuentro','백스테이지','Backstage']::text[], 'encuentro-64', '[{"r":"Creative Direction","p":"guillermo.solas,alicciamila"},{"r":"Art direction","p":"guillermo.solas"},{"r":"Photography","p":"_dontbeapasco"},{"r":"Editing","p":"guillermo.solas"},{"r":"Styling","p":"byfatimanaseri,alicciamila"},{"r":"Makeup & Hair","p":"anadelafuente.muah,dinamitarts"},{"r":"Set design","p":"__moki"},{"r":"Light","p":"iamquesada"},{"r":"Studio","p":"selah_room"},{"r":"Starring","p":"lafrancesssa,d.oncella,nenu.nenu.nenu,nina.emocional,llumllumllumllumllum"},{"r":"Fashion by","p":"peterspositostudio,nii.hai,rain_and_rivers_,emiliana_rat,espirituclub,coconutscankill,palomawool,luz.muerta"}]'::jsonb, 'published'),
('Artificial desires and their exaggeration', 'j41urak-WY8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_485f43090f.jpg', '2024-08-03', ARRAY['Editorial','Fashion']::text[], ARRAY['Artificial desires and their exaggeration','Paid Submission','Desires','film']::text[], 'artificial-desires-and-their-exaggeration-65', '[{"r":"Art Direction ","p":"_seisei_"},{"r":"Styling","p":"_seisei_"},{"r":"Set design ","p":"_seisei_"},{"r":"Hair","p":"hiroki_kitada"},{"r":"Makeup","p":"umeooo"},{"r":"Install","p":"rinnershigh"},{"r":"Starring","p":"musashi.suzuki,ichir0_______"}]'::jsonb, 'published'),
('Something Melancholy', 'GHOWVpc_5S0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_22bd63835d.jpg', '2024-07-26', ARRAY['Editorial','Fashion']::text[], ARRAY['Something Melancholy','film']::text[], 'something-melancholy-66', '[{"r":"Photographer","p":"dylanperlot,exclusiveartists"},{"r":"Stylist","p":"lil_saigon"},{"r":"Makeup & Hair","p":"tammyyi,exclusiveartists"},{"r":"Nail","p":"statement_not_maintenance"},{"r":"Starring","p":"mayabeal1,dtmodelmgmt"},{"r":"Fashion by","p":"kennethbarlis_official,calzedonia,jaggedhalojewelry,mariemonsod,iriinnyc,kristinakofficial,ceraofficial,alabamablonde,jonak,atranova_by_sheilab,charlesandron,carolinesvedbom,deliguoro,halinhthu,asanchezfashion,ramstiofficial,beeombi"}]'::jsonb, 'published'),
('Unfinished Business', 'bSwajwshBOE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_12ede6dd10.jpg', '2024-07-21', ARRAY['Editorial','Fashion']::text[], ARRAY['Unfinished Business']::text[], 'unfinished-business-67', '[{"r":"Concept","p":"patrickmecherkany"},{"r":"Photography","p":"patrickmecherkany"},{"r":"Styling","p":"seekskyeyes"},{"r":"Makeup","p":"paintedbyhawraa"},{"r":"Hair","p":"hairbymarcos_"},{"r":"Studio","p":"velvetmanagementstudio"},{"r":"Starring","p":"valeriabrovkova,velvetmanagement,myriam_pouloh_,nidals.agency"},{"r":"Fashion by","p":"gemini.officials,jeanpaulgaultier,marineserre_official,diesel,maisonmargiela,laperlalingerie,dtjeans,gemini.officials,newrocks,miumiu,danasaadstyls,dolcegabbana,maisonmarais_official,hyeinantwerp,moonboot,vetements_official,thug_club,_e1000__"}]'::jsonb, 'published'),
('I found the flowers you gave yourself', 'tfZZv-Hwyps', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1199317d74.jpg', '2024-07-18', ARRAY['Editorial','Fashion']::text[], ARRAY['I found the flowers you gave yourself']::text[], 'i-found-the-flowers-you-gave-yourself-68', '[{"r":"Film maker","p":"lanoramirez"},{"r":"Sound design","p":"imaabs"},{"r":"Photography","p":"ffinat"},{"r":"Stylist","p":"javiera_moreno_"},{"r":"Makeup","p":"antonia__pvaldivia"},{"r":"Hair","p":"mortis74"},{"r":"Production","p":"paulavalentinaf,rociogtw,rose_estudio"},{"r":"Art Se","p":"unpistilo"},{"r":"Photo assist","p":"__brial,agstinu"},{"r":"Starring","p":"sophisantamarina,mabiandrad,dianarichard112"},{"r":"Fashion by","p":"danielabustamanted,stevemaddencl,stevemadden,javierajordan,danielabustamanted,hm,juaneldaltonico,gaba.studio,perfumeriabotanica,unpistilo,grada_nakarytorres"}]'::jsonb, 'published'),
('Sonya', 'p52JbM9OMAQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1cd7af83e3.jpg', '2024-07-12', ARRAY['Editorial','Beauty']::text[], ARRAY['Sonya','beauty']::text[], 'sonya-69', '[{"r":"Photography","p":"thebrisva"},{"r":"Make Up","p":"marika.krasit"},{"r":"Hair","p":"air_hair_makeup"},{"r":"Starring","p":"how.to.sonya"},{"r":"Fashion by","p":"acnestudios,ivilosangeles"}]'::jsonb, 'published'),
('Fallen Angels', 'NNpqQMKsyvw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_ec9e67fae2.jpg', '2024-07-08', ARRAY['Editorial','Fashion']::text[], ARRAY['Fallen Angels','film']::text[], 'fallen-angels-70', '[{"r":"Video","p":"to0thgapgirl"},{"r":"Photographer","p":"clellinovara"},{"r":"Art Director","p":"carolinacaccioppoli"},{"r":"Stylist","p":"carolinacaccioppoli"},{"r":"Make up ","p":"avola_chiara17_mua"},{"r":"Hair","p":"lemaisondecoiffeur"},{"r":"Starring","p":"mirucombinaguai,lilketto,2duedipicch3"},{"r":"Special Thanks","p":"_trippat,annacurcio_,dolceamoreintimo,alessandro.chelazzi"},{"r":"Fashion by","p":"dolceamoreintimo,alessandro.chelazzi,diesel,asos,_trippat,mango,playboy,annacurcio,drmartensofficial"}]'::jsonb, 'published'),
('Némesis', 'k0972d6ZoGY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_420601413d.jpg', '2024-07-01', ARRAY['Editorial','Fashion']::text[], ARRAY['Némesis','film','티저','teaser']::text[], 'nemesis-71', '[{"r":"Photography","p":"lucasborromeo"},{"r":"Outfit Design","p":"tom_roses"},{"r":"Stylist","p":"guidorodriguezj"},{"r":"Hair & Makeup","p":"joaquinvegacaro,martupucheta_"},{"r":"Digital Assist","p":"agustinagalak"},{"r":"Studio","p":"huemulestudios"},{"r":"Starring","p":"pameminola,adon_management"}]'::jsonb, 'published'),
('Noctural Jungle', '3nut9M5B518', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_254c2101d5.jpg', '2024-06-27', ARRAY['Editorial','Beauty']::text[], ARRAY['Noctural Jungle']::text[], 'noctural-jungle-72', '[{"r":"Art Director","p":"leilabld_"},{"r":"Photographer","p":"elisa_grosman"},{"r":"Makeup","p":"maya.palermo"},{"r":"Nail","p":"nailzbyilana"},{"r":"Starring","p":"lio6.2"}]'::jsonb, 'published'),
('Fall Inside', 'AzLWf4vh_1s', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a68856b5f7.jpg', '2024-06-18', ARRAY['Editorial','Fashion']::text[], ARRAY['Fall Inside','film']::text[], 'fall-inside-73', '[{"r":"Photographer","p":"yedihael"},{"r":"Art direction","p":"antoinechuck"},{"r":"Set Design","p":"antoinechuck"},{"r":"Stylist","p":"abzfoster"},{"r":"Hair","p":"lucile.hair"},{"r":"Make up","p":"shanamontier"},{"r":"DOP","p":"bataaard"},{"r":"Light","p":"Anaïs Nieto"},{"r":"Music","p":"antoinechuck"},{"r":"Photo assist","p":"paul_claverie"},{"r":"Stylist Assist","p":"roxchp,aina_ureta"},{"r":"Set design assist","p":"Julia Grgurić"},{"r":"Studio","p":"lpovs"},{"r":"Casting director","p":"frenchiller"},{"r":"Photo editing","p":"paufrchn"},{"r":"Starring","p":"lyscanton,fridajuhler"},{"r":"Fashion by","p":"floredesermet,lamomebijou,martialparis_,espero_atelier,creak_hannah,feteimperiale,juliabartsch_jewellery,r.l.eofficial,pengtaiofficial,florinefournier,skua.studio,humanitas2019,angele.lepolard,victoriatomasofficial,marineserre_official,emptybehavior,wolford,balmain,muglerofficial,tribal_hotel,chocheng,rochasofficial"}]'::jsonb, 'published'),
('Angel and Devils', 'E52BPCpF5XY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c17d551f5a.jpg', '2024-05-30', ARRAY['Editorial','Fashion']::text[], ARRAY['Angel and Devils']::text[], 'angel-and-devils-74', '[{"r":"Photographer","p":"Eylulezik"},{"r":"Styling","p":"Nedaisbilirr"},{"r":"MakeUp","p":"Bediraydinn"},{"r":"Hair","p":"Yildirimbozuyuk"},{"r":"Photo Assist","p":"Erenkandira,Furcantplay"},{"r":"Styling Assist","p":"Meliisayylmz,Vanessafeyruzdemir"},{"r":"Hair Assist","p":"Mehmettiyi__"},{"r":"Studio","p":"Digioneplus"},{"r":"Starring","p":"Esilkayaa,Vishnyakova__k,Alminailhan,Newmodelsistanbul"},{"r":"Fashion by","p":"pieddepoulevintage,manc,candantulga,burak_bayraktaroglu,sudietuzofficial,zara,thecansuxi,sillage.me,amorgaribovic,cihannacar,killyouridols,zeyneptosunofficial"}]'::jsonb, 'published'),
('The nature of communication is misinterpretation', 'Y3rcIZGmX1E', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c7640b6809.jpg', '2024-05-24', ARRAY['Editorial','Fashion']::text[], ARRAY['The nature of communication is misinterpretation','film']::text[], 'the-nature-of-communication-is-misinterpretation-75', '[{"r":"Director & Editor","p":"tobeivo"},{"r":"DOP","p":"tobeivo"},{"r":"Sound Designer","p":"tobeivo"},{"r":"Producer","p":"chiarrrawen"},{"r":"Art Director","p":"yuruijun17"},{"r":"Stylist","p":"yuruijun17"},{"r":"Makeup","p":"madhavamake"},{"r":"Makeup Assist","p":"fabiolabecattini"},{"r":"Photo Assist","p":"robinnko"},{"r":"Production House","p":"kezi_studio"},{"r":"Starring","p":"ooooooliver,laura_manzan"},{"r":"Special Thanks ","p":"alpr_communication"},{"r":"Fashion by","p":"maisonmargiela,magliano.insta,mercurioargento,giorgiaalu_official,christopherraxxy_official,nodaleto,livinginherown2022,martinavega.aaa"}]'::jsonb, 'published'),
('Creature', 'Qby2gmLeTow', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6dceca7daf.jpg', '2024-05-10', ARRAY['Editorial','Fashion']::text[], ARRAY['Creature','film','BACKSTAGE']::text[], 'creature-76', '[{"r":"Photographer","p":"amelie_canon"},{"r":"Art Direction ","p":"amelie_canon"},{"r":"Make Up ","p":"laetitia_majer"},{"r":"Prosthesis","p":"laetitia_majer"},{"r":"Hair & Wigs","p":"kelig.hairstudioparis"},{"r":"Stylist","p":"heleneredolfi"},{"r":"Set Design ","p":"jimy_tenbraak"},{"r":"Light Director ","p":"mathyll2"},{"r":"Production","p":"mkswr,profoto"},{"r":"Videographer","p":"etienneblg"},{"r":"Starring","p":"eniramca,isaak_dssx,elliott.verdier"},{"r":"Fashion by","p":"anthonypeto,castanerofficial,femmedinterieur,fyr.jewelry,herina_creation,hod_paris,litkovska_offcial,maisonrabihkayrouz,femmedinterieur,marcdelocheofficiel,marguerite.tenot,martian.agency,mossi.officiel,noneofmybusiness,vak_official,vandano,vann_Jewellery,victorclavelly,victoriatomasofficial,yoox,zagbijoux,zylberstein"}]'::jsonb, 'published'),
('Euphorbia', 'bTPhK-pF1vw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_24f1f9af25.jpg', '2024-04-19', ARRAY['Editorial','Fashion']::text[], ARRAY['Euphorbia']::text[], 'euphorbia-77', '[{"r":"Videographer","p":"_aaronbenjamin"},{"r":"Light","p":"Alban_champion"},{"r":"Music","p":"Caddarikidemontmort"},{"r":"Artistic Director ","p":"Birdmarij,Visueljo"},{"r":"Stylist","p":"Celiastern"},{"r":"Set Designer ","p":"Cas.Ta.Gne"},{"r":"Set Assist","p":"Dimitri Kojevnikov"},{"r":"Stylist Assist","p":"Rougemars_stylist"},{"r":"Makeup","p":"Marineokt.Mua"},{"r":"Hair","p":"Mathilde_mrv_mua"},{"r":"Starring","p":"Atassel"},{"r":"Fashion by","p":"delphinecharlotteparmentier,ziadnakad,maisonernest,etiennejeanson,baylandiofficial,pengtaiofficial,guylarocheparis,chocheng,maisonchoppin,thenewelisabeth"}]'::jsonb, 'published'),
('Glacia Regina', 'kD9erG1rRwA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_8137ac7263.jpg', '2024-04-12', ARRAY['Editorial','Fashion']::text[], ARRAY['Glacia Regina','film']::text[], 'glacia-regina-78', '[{"r":"Art Director","p":"ozdencerrahoglu"},{"r":"Videographer","p":"thewizzninni"},{"r":"Stylist","p":"ozdencerrahoglu"},{"r":"Makeup","p":"farukeldem"},{"r":"Hair","p":"farukeldem"},{"r":"Location","p":"glass.art.co"},{"r":"Sculpture Artist","p":"artem.martis"},{"r":"Casting","p":"flashmodelturkey"},{"r":"Starring","p":"marie.louwes"},{"r":"Fashion by","p":"junuscoban_official,ozdencerrahoglu.co,tekbitane,calzedonia"}]'::jsonb, 'published'),
('Roses to deaden the clods as they fall', 'yfv7SxLijac', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_7af1651009.jpg', '2024-04-03', ARRAY['Editorial','Art']::text[], ARRAY['Roses to deaden the clods as they fall']::text[], 'roses-to-deaden-the-clods-as-they-fall-79', '[{"r":"Videography","p":"a_korean_in_london"},{"r":"Choreography","p":"willowfenner,pixiebrooke"},{"r":"Movement Direction","p":"willowfenner,pixiebrooke"},{"r":"Theatre Designer","p":"Iris Cardew,ozz_designs"},{"r":"Performers","p":"yohlivia,lilygmcdonald,rozedoza,luella_rebbeck,bronteleahadelman,charlotteguilbertt,its_mingming"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('Eternal Lines', 'M5TmQqlrIlw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c6fa397243.jpg', '2024-04-01', ARRAY['Editorial','Fashion']::text[], ARRAY['Eternal Lines']::text[], 'eternal-lines-80', '[{"r":"Video","p":"jmichaelfulton"},{"r":"Stylist","p":"styledbykingsley"},{"r":"Makeup","p":"marikoarai"},{"r":"Hair","p":"tak8133"},{"r":"Retoucher","p":"ak_retouching"},{"r":"Studio","p":"elskerstudio"},{"r":"Starring","p":"thetaradew,statemgmt"},{"r":"Fashion by","p":"bykarisgould,houseofatana,shushuchnofficial,noahk.studio,teseiofficial,Yu Xiao,o.yzng,pipencolorena"}]'::jsonb, 'published'),
('Faded Figure', '3RGPXPTCJdY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_c1f1339b37.png', '2024-03-25', ARRAY['Editorial']::text[], ARRAY['Faded Figure','ameliastentiford','freyathomastaylor','dior','balenciaga']::text[], 'faded-figure-81', '[{"r":"Director & Photographer","p":"dylanrhayes"},{"r":"Styling","p":"freyathomastaylor"},{"r":"Styling Assistant","p":"abiwood"},{"r":"Cinematographer","p":"max_conran"},{"r":"Makeup","p":"jinny_mua"},{"r":"Hair ","p":"taku_hair"},{"r":"Starring ","p":"nikki_kahr,hehivemodels"},{"r":"Fashion by ","p":"ameliastentiford,freyathomastaylor,dior,abiwood,balenciaga ,louisewebber.design,ariannastapleystudio,libidex,chopovalowena"}]'::jsonb, 'published'),
('Poor Things', 'NiPE0YPxDLk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_047827afbd.png', '2024-03-19', ARRAY['Editorial','Art']::text[], ARRAY['Poor Things','solgoatelier','maisonelmadawy','infinityvessel','tullejour','beautiisolesbyrobynshreiber','bbcouture','elenarudenko']::text[], 'poor-things-82', '[{"r":"Art Director & Photographer","p":"taiga_dm "},{"r":"Stylist & Producer","p":"lu3alo"},{"r":"AI Artist","p":"evgenia_huber"},{"r":"Makeup","p":"aliya.probeauty "},{"r":"Hair","p":"gvk.beauty"},{"r":"Starring","p":"teamunicorncarl"},{"r":"Fashion by","p":"solgoatelier ,maisonelmadawy,infinityvessel ,tullejour ,beautiisolesbyrobynshreiber ,bbcouture_italy,elenarudenko_official ,talaalamuddin ,totallytala,carolinajewelry.co ,seragliodesigns,wear_honghoa ,antiqua__wa,sofieandiris,liinasteinofficial ,Noahs_inc_19 ,dreamwalkersshoes ,pearlsociety_jewelry,rosaiselacouture,linaenriquezluxe,gyanjaipur ,lnb.jewellery,hautelifeworld ,lorenacorderocoutureofficial,monzlapur.ny,einstakt_official ,liliafisher ,fancypanty_kobenhavn,houseofatana ,olenanewyork ,jeannierichardjewelry ,maisonclad,byombare,kam_za_90myfashioncollection,flora_harrison ,borboletabag,lechellepetite,ggsays.hello,seasonalwhispers,arcandbow"}]'::jsonb, 'published'),
('Obsesión Hardcore', '5G2-JYzJGsA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4affd9936d.jpg', '2024-03-15', ARRAY['Editorial','Fashion']::text[], ARRAY['Obsesión Hardcore']::text[], 'obsesion-hardcore-83', '[{"r":"video","p":"rubi__azul"},{"r":"creative direction ","p":"rubi__azul"},{"r":"styling","p":"rubi__azul"},{"r":"Audio","p":"3stratosfera"},{"r":"3D letters","p":"errortemporal"},{"r":"Video edit","p":"urboysaysarchives,errortemporal"},{"r":"Accessories","p":"merrfer_thebrand"},{"r":"Assistants","p":"mnemyts,sijilosalpasar"},{"r":"Starring","p":"ione__666,miagchilo"},{"r":"Fashion by","p":"Loewe,Merrfer_thebrand,Prada,maisonfoufoustore,misss.diabla,rubi__azul,sugarthrillz,lui.trash,jadedldn,ludovicdesaintsernin,balenciaga,shopnaughtythoughts,pacorabanne"}]'::jsonb, 'published'),
('Outer Space Abduction Dance', 'jpBW_dkj4T4', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1e9a588a9a.jpg', '2024-03-06', ARRAY['Editorial','Fashion']::text[], ARRAY['Outer Space Abduction Dance']::text[], 'outer-space-abduction-dance-84', '[{"r":"Film","p":"jhenyfy_muller,mmgartists"},{"r":"Creative Direction","p":"jhenyfy_muller,mmgartists"},{"r":"Styling","p":"rabihrowell"},{"r":"Makeup","p":"sara.ymakeup,mmgartists"},{"r":"Hair","p":"kavyarajpowell,mmgartists"},{"r":"Location","p":"mmgartstudios"},{"r":"Special Thanks to ","p":"mr.plala"},{"r":"Starring","p":"tomc_ymen,ymenmodels"},{"r":"Fashion by","p":"yaspis.brand,anomalousworld,balenciaga,vetements_official,amiri,louboutinworld,burberry,ambush_official,fendi,gentlemonster,louboutinworld"}]'::jsonb, 'published'),
('Perpetual Bloom', 'n8vB1q93ca0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b891427411.jpg', '2024-02-24', ARRAY['Editorial','Fashion']::text[], ARRAY['Perpetual Bloom']::text[], 'perpetual-bloom-85', '[{"r":"Executive Producer","p":"Liko.Sukhoy,Likosukhoyd"},{"r":"Creative Direction","p":"Liko.Sukhoy"},{"r":"Production","p":"Liko.Sukhoy"},{"r":"Art & Design ","p":"Liko.Sukhoy"},{"r":"Videography","p":"Rakasatri.A"},{"r":"Stylist","p":"April_lisue"},{"r":"Makeup & Hair","p":"April_lisue"},{"r":"Nail","p":"Kukurashistudio"},{"r":"Videography","p":"Rakasatri.A"},{"r":"Assist Art Director","p":"Almahanafi,Ayunmh"},{"r":"Starring","p":"Michellebusy,Scoutmodelagency"},{"r":"Fashion by","p":"liko.sukhoy,__anw"}]'::jsonb, 'published'),
('ACIDA', '7LEdiGmELT8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_89b401b698.jpg', '2024-02-22', ARRAY['Fashion']::text[], ARRAY['Acida']::text[], 'acida-86', '[{"r":"Photographer","p":"Martinaamoruso"},{"r":"Creative Director","p":"Francescaalbergo"},{"r":"Stylist","p":"Ineslirio"},{"r":"Make Up","p":"Violachi_mua"},{"r":"Hair","p":"Stefanoferrari_hairstylist"},{"r":"Starring","p":"Sofiapallottini,Imgmodels"},{"r":"Fashion by","p":"contessamiseriaarchivio,tezenis,perlesexy,danaemarramilano,howtobenina,buffalo,ganni,clarissabalossi,afolmoda,calzedonia"}]'::jsonb, 'published'),
('LULU', 'vZ5UW0XK8Sk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_16bd525e1a.jpg', '2024-01-05', ARRAY['Editorial','Fashion']::text[], ARRAY['LULU','January']::text[], 'lulu-87', '[{"r":"Production","p":"idle_creative"},{"r":"Photographer","p":"jamesguyphoto"},{"r":"Videographer","p":"samguycreative"},{"r":"Stylist","p":"dontbebasik"},{"r":"Nail","p":"naillabby_el"},{"r":"Hair","p":"jackvickersmakeupartist"},{"r":"Makeup","p":"jackvickersmakeupartist"},{"r":"Studios","p":"spectrum_mcr"},{"r":"Starring","p":"lulucresantia,brother.models"},{"r":"Fashion by","p":"ninetysixjewellery,sylkstore,prada,galore_clothes,gucci,erj_london,ninetysixjewellery"}]'::jsonb, 'published'),
('Shirim', 'HCMNGKZ0LEc', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_569d6e41e7.jpg', '2023-12-30', ARRAY['Editorial','Fashion']::text[], ARRAY['Shirim','December','editorial']::text[], 'shirim-88', '[{"r":"Photographer","p":"whatsthelocation"},{"r":"Videographer","p":"makoto88kamiya"},{"r":"DP Assist","p":"Hanako Otsuka"},{"r":"Stylist","p":"remi_kawasaki_"},{"r":"Makeup","p":"xxmarikobaxx"},{"r":"Hair","p":"djyusaku"},{"r":"Starring","p":"_mariajune_,tsukina_official"},{"r":"Fashion by","p":"yohjiyamamotoofficial,maisonalaia,rickowensonline"}]'::jsonb, 'published'),
('Sass in Class', 'uigUgtJBkms', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_2662065623.jpg', '2023-12-28', ARRAY['Editorial','Fashion']::text[], ARRAY['Sass İn Class','December','editorial']::text[], 'sass-in-class-89', '[{"r":"Photographer","p":"sezerismailsenturks"},{"r":"Director","p":"yigitbum"},{"r":"styling","p":"alpcelebj,tulinnavcii"},{"r":"Makeup","p":"berkeserenn"},{"r":"Hair","p":"kenannsen"},{"r":"Photo assist","p":"muctebacihan"},{"r":"Makeup assist","p":"erogulzehra"},{"r":"Hair assist","p":"mustafauzunl"},{"r":"Starring","p":"aeduardavieria,newmodelsistanbul"},{"r":"Fashion by ","p":"ersozata,calzedonia,intimissimiofficial,begumkhan,zara,ilio_smeraldo,versace,cerenocakofficial,studiotayfunkaba,wolford,cosstores,studiotayfunkaba,studionoid,endamstudio,selezzalondon,zegnaofficial,gentlemonster,itmfl_official,nocturne"}]'::jsonb, 'published'),
('Simulated Realities', 'IL9l0isLJms', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_9eed9e8b83.jpg', '2023-12-16', ARRAY['Editorial','Fashion']::text[], ARRAY['Simulated Realities','December','editorial']::text[], 'simulated-realities-90', '[{"r":"Director","p":"ilgarozturk,kuscuoguz"},{"r":"Production","p":"asitanestudio"},{"r":"Photography","p":"kuscuoguz"},{"r":"Music & Sound Design","p":"gururgelen"},{"r":"Cast","p":"_mimi2mimi_,newmodelsistanbul,iamsontrava"},{"r":"Paula Rudevica ","p":"rudevica.paula,truemodelsistanbul"},{"r":"Stylist","p":"elyaastorabi"},{"r":"Assistant Camera","p":"kuzeymansuroglu"},{"r":"Gaffer","p":"sever_anil"},{"r":"Production Assist","p":"sercanjpeg"},{"r":"Styling Assist","p":"dilaraceribas"},{"r":"Hair","p":"harunates001,arkhehairdesign"},{"r":"Make up","p":"fulyamurtekin"},{"r":"Special Thanks to","p":"ceylannaz,okanatas,cansu.kiziltass"},{"r":"Fashion by ","p":"ezgiv,mustafasmaoglu,boreal.brandlifting,thecansuxi,arya.elvera,callthehunter,melisahatemi"}]'::jsonb, 'published'),
('Become the white rabbit', '5nzsL3awXu8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_13a244f59c.jpg', '2023-11-30', ARRAY['Editorial','Fashion']::text[], ARRAY['Become the white rabbit','November','editorial']::text[], 'become-the-white-rabbit-91', '[{"r":"Photography","p":"romanovamashaaa"},{"r":"Photo Assist","p":"kesova_dr"},{"r":"Stylist","p":"demi1026_"},{"r":"Makeup","p":"kastiee"},{"r":"Hair","p":"kastiee"},{"r":"Mask Artist","p":"sophia.savagner"},{"r":"Graphics","p":"itsppak"},{"r":"Starring","p":"ilovekat1a"},{"r":"Fashion by ","p":"coperni,rickowensonline,jw_anderson,nicholaskirkwood,acnestudios,manoloblahnik,currentmoodclothing"}]'::jsonb, 'published'),
('Face My Bruise', '8j-X-0PXhuc', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_18ef092570.jpg', '2023-11-30', ARRAY['Editorial','Fashion']::text[], ARRAY['Face My Bruise','November','노창','엄브로','umbro','NoChang']::text[], 'face-my-bruise-92', '[{"r":"Brand","p":"umbrokorea"},{"r":"Photographer","p":"narangchoi"},{"r":"Photo Assist","p":"yoonjinchoe,lymwonhee"},{"r":"Videographer","p":"kyungh0"},{"r":"Video Assist","p":"Jung Jiwoo,Lee Sungjae"},{"r":"Video Edit","p":"Kim Kyungho,Song Junghyun,Jung Jiwoo"},{"r":"Editor","p":"kimim0o ,2.93km ,luvchexxymotion"},{"r":"Hair & Makeup","p":"xoxov3"},{"r":"Assisted by","p":"Oh Sunmin,Shin Boram"},{"r":"Starring","p":"gnncjegrgr,ap_alchemy"},{"r":"Fashion by","p":"umbrokorea,ajo_ajobyajo_official,songzio_official"}]'::jsonb, 'published'),
('Face My Bruise', 'UXXKVFiw5WQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c89ea5b001.png', '2023-11-29', ARRAY['Editorial','Fashion','Music']::text[], ARRAY['Face My Bruise','윤훼이','엄브로','yunhway','umbro']::text[], 'face-my-bruise-93', '[{"r":"Brand","p":"umbrokorea"},{"r":"Photographer","p":"narangchoi"},{"r":"Photo Assist","p":"yoonjinchoe,lymwonhee"},{"r":"Videographer","p":"kyungh0"},{"r":"Video Assist","p":"Jung Jiwoo,Lee Sungjae"},{"r":"Video Edit","p":"Kim Kyungho,Song Junghyun,Jung Jiwoo"},{"r":"Editor","p":"kimim0o,2.93km ,luvchexxymotion"},{"r":"Hair & Makeup","p":"xoxov3"},{"r":"Assisted by","p":"Oh Sunmin,Shin Boram"},{"r":"Starring","p":"yunhway,ap_alchemy"},{"r":"Fashion by","p":"umbrokorea,sio.seoul,jiminleeresults,eseelmi_official,vegan_tiger,blrbluer_official"}]'::jsonb, 'published'),
('Face My Bruise', 'btiU8OOq1lE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_027c53ff42.jpg', '2023-11-28', ARRAY['Editorial','Fashion','Music']::text[], ARRAY['노윤하','Face My Bruise','November','editorial','umbro','엄브로','interview','인터뷰','PAP']::text[], 'face-my-bruise-94', '[{"r":"Brand","p":"umbrokorea"},{"r":"Photographer","p":"narangchoi"},{"r":"Photo Assist","p":"yoonjinchoe,lymwonhee"},{"r":"Videographer","p":"kyungh0"},{"r":"Video Assist","p":"Jung Jiwoo,Lee Sungjae"},{"r":"Video Edit","p":"Kim Kyungho,Song Junghyun,Jung Jiwoo"},{"r":"Editor","p":"kimim0o ,2.93km ,luvchexxymotion"},{"r":"Hair & Makeup","p":"xoxov3"},{"r":"Assisted by","p":"Oh Sunmin,Shin Boram"},{"r":"Starring","p":"1san_newcity_boy,ap_alchemy"},{"r":"Fashion by ","p":"umbrokorea,sur8ery,niceghostclub,hono_report,songzio_official,eseelmi_official"}]'::jsonb, 'published'),
('Join a society or be happy?', 'PB4daip-Xsw', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_69a09e43e5.jpg', '2023-11-11', ARRAY['Editorial','Fashion']::text[], ARRAY['Join a society or be happy?','November','editorial']::text[], 'join-a-society-or-be-happy-95', '[{"r":"Art direction","p":"blumental22"},{"r":"Photography","p":"blumental22"},{"r":"Stylist","p":"maryavolkova1"},{"r":"Set Design","p":"maryavolkova1"},{"r":"Make up","p":"obraz_oblaka"},{"r":"Hair","p":"obraz_oblaka"},{"r":"Videographer","p":"mityamltenka"},{"r":"Producer","p":"sheffnika21"},{"r":"Production assist","p":"khan.ev_ali,nikitarebel"},{"r":"Dog","p":"Timophei"},{"r":"Starring","p":"xankiii"},{"r":"Fashion by","p":"marcomenti,hm,uniqlo,ralfringer_official,pierrecardin,jcrew,pullandbear,levis,adidas,rayban,swatch,calzedonia,massimodutti,highlandkilt"}]'::jsonb, 'published'),
('When I grow up I want to be me', '1Pdg2Vn3KOs', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_42ba0232ff.jpg', '2023-11-08', ARRAY['Editorial','Fashion']::text[], ARRAY['When I grow up I want to be me','November','editorial']::text[], 'when-i-grow-up-i-want-to-be-me-96', '[{"r":"Photographer","p":"_m__ss_"},{"r":"Art direction","p":"_m__ss_"},{"r":"Production","p":"_m__ss_"},{"r":"Post-production ","p":"_m__ss_"},{"r":"Stylist","p":"eseniya.sergienko"},{"r":"Stylist assist","p":"k_volloshina,ulyaschkn"},{"r":"Gaffer","p":"ekimovaelnara"},{"r":"Videographer","p":"ekimovaelnara"},{"r":"Set design ","p":"nikapokus"},{"r":"Set assist","p":"alena_pro_fashion"},{"r":"Light assist","p":"po1inali"},{"r":"Hair","p":"anya_stylist_spb"},{"r":"Makeup","p":"kibisova_liia"},{"r":"Location","p":"station__studio"},{"r":"Starring","p":"frend_baby"},{"r":"Fashion by","p":"newyorkeronline,Vikaru,no.brend.sorry_reserve,befree_fashion,mama_non_stuff,obba.wow,muse________________,loutique_lingerie,_z_b_b_b_,obba.wow"}]'::jsonb, 'published'),
('Elysium', 'trQeYx6WDXA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_46c0be4147.jpg', '2023-11-01', ARRAY['Editorial','Fashion']::text[], ARRAY['Elysium','November','editorial','cover']::text[], 'elysium-97', '[{"r":"Photography","p":"perdurablepain"},{"r":"Videography","p":"perdurablepain"},{"r":"Styling","p":"smakk927927"},{"r":"MakeUp","p":"ambrxx_,elainelomakeup"},{"r":"Hair","p":"tsuyoshi.tamai,oribe"},{"r":"Starring","p":"lacepowder,resilientagency"},{"r":"Fashion by","p":"feifei._.jewellery ,xiangzhi_design,minrisot,mollusknails,hermes,majeparis,herveleger,miumiu,_raphaelxie_,sunkissseeed,newrock,_kvltheretic_,n_h_2.jpg,1ang1ei97,ysl"}]'::jsonb, 'published'),
('Perfect Duo', 'sVu86oO56v8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_0efb80d470.jpg', '2023-10-29', ARRAY['Editorial','Fashion']::text[], ARRAY['Perfect Duo','October','editorial']::text[], 'perfect-duo-98', '[{"r":"Photographer","p":"munglassy"},{"r":"Set Assist","p":"by.beswick"},{"r":"Digi Tech","p":"shottinyc"},{"r":"BTS videographer ","p":"shottinyc"},{"r":"Producer","p":"laneykai"},{"r":"Stylist","p":"caesarpalotta"},{"r":"Stylist Assist","p":"micheviews"},{"r":"Hair","p":"avery_golsonv,seemanagement"},{"r":"Makeup","p":"ann.benjamas,hollycorbettrepresents"},{"r":"Studio","p":"lr2studio"},{"r":"Starring","p":"supermodelnae,musecurve,shermonb,soulartistmgmt"},{"r":"Fashion by","p":"altuzarra,jimmychoo,jaime.newyork,ralphlauren,Celine,staud.clothing,newbottega,Dior,ysl,Zara,ramybrook,proenzaschouler,chanelofficial,Gucci"}]'::jsonb, 'published'),
('We Are The Weirdos', '4AxDVLZOn74', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6dd4252b9c.png', '2023-10-28', ARRAY['Editorial','Fashion']::text[], ARRAY['We Are The Weirdos','October','editorial','film']::text[], 'we-are-the-weirdos-99', '[{"r":"Photographer","p":"svenja.blobel"},{"r":"Photo Assist","p":"maiyezn"},{"r":"Styling","p":"elizaxbosxstyling"},{"r":"Styling Assist","p":"120aufmfahrrad"},{"r":"Hair","p":"elenore_ising"},{"r":"Makeup","p":"elenore_ising"},{"r":"Starring","p":"sebitj,izaio.management,elizaxbos"},{"r":"Fashion by","p":"c.collective2,franscesca.u.jewellery,coexistberlin,_nikinky,lucas_meyer_leclere,trippnyc,vixxsin_official,lamoda,darkinloveofficial,killstar,punkraveau"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('In vitro hysteria', 'ffqsH_W8dgU', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_cd87e9daa3.png', '2023-10-25', ARRAY['Editorial','Fashion']::text[], ARRAY['In vitro hysteria','October','editorial']::text[], 'in-vitro-hysteria-100', '[{"r":"Creative Direction","p":"monb0n,hunterpetersen_"},{"r":"Photographer","p":"hunterpetersen_"},{"r":"Lighting","p":"hunterpetersen_"},{"r":"Photo Assist","p":"phlipisme"},{"r":"Videographer","p":"ilovemagggie"},{"r":"Production Assist","p":"simplyxash_"},{"r":"Stylist","p":"monb0n"},{"r":"Stylist Assist","p":"_mean_queen_nailsandtattoos_"},{"r":"Makeup","p":"byrdartistry"},{"r":"Hair","p":"libertyackerman"},{"r":"Nail","p":"_mean_queen_nailsandtattoos_"},{"r":"Starring","p":"jhadevx,velcrovoltage"},{"r":"Fashion by","p":"sweetest.d,nausicaa_nyc,shop.crackcouture,ffluenzaa,basicallyrotten,synph17"}]'::jsonb, 'published'),
('Heat Wave', 'V8LxclsJYYI', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_785525219b.jpg', '2023-10-21', ARRAY['Editorial','Fashion']::text[], ARRAY['Heat Wave','October','editorial']::text[], 'heat-wave-101', '[{"r":"Photographer","p":"aubane.despres"},{"r":"Cgi artist ","p":"walissime"},{"r":"Stylist","p":"kyojino"},{"r":"Photo assist","p":"duylau.pix"},{"r":"Makeup","p":"rainbowmarchenko,violette_fr,hellomantle"},{"r":"Hair","p":"barthair"},{"r":"Set designer","p":"ettorecrobu"},{"r":"Nail","p":"adrienne.soter"},{"r":"Starring","p":"olibrooklyn,cora_5.0,frejamclean,nextmodels"},{"r":"Special thanks to ","p":"lestudiomoderne,the_ridery"},{"r":"Fashion by","p":"paindesucre_officiel,aminamuaddiofficial,begumkhan,hemsleylondon,monrevebijoux,skua.studio,mopraiso.studios,coppingzone,blackheadstudio,marineserre_official,helenezubeldia,kapushparis,simmishoes,kyojino,weirdbrain_creation,zagbijoux,texto_dallas,laetisstudio,blue_sky_lab,casadeiofficial,patou,morfiumfashion,nakedwolfe,quazar_world,canadagoose,vitaly"}]'::jsonb, 'published'),
('Swift Hand Cold Heart', 'rhdqTUrfy-Y', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_72bb94780f.jpg', '2023-10-18', ARRAY['Editorial','Fashion']::text[], ARRAY['Swift Hand Cold Heart','October','editorial']::text[], 'swift-hand-cold-heart-102', '[{"r":"Photographer","p":"elifseyis"},{"r":"Creative Director","p":"billge"},{"r":"Stylist","p":"billge"},{"r":"Art Director","p":"canaltuntel"},{"r":"Hair","p":"ismailinan1"},{"r":"Makeup","p":"aslibilge"},{"r":"Lighting","p":"uurkarahan"},{"r":"Photo Assist","p":"murat.ozbek____"},{"r":"Styling Assist","p":"cassandracanttellyou"},{"r":"Makeup Assist","p":"belizar"},{"r":"Hair Assist","p":"tahakaymazz"},{"r":"Lighting Assist","p":"Rahmi Gur"},{"r":"Starring","p":"sultan__chik01,mordemgungor"},{"r":"Fashion by","p":"theattico,area,naiaistanbul,diorajewels,zara,venomousglam,louboutinworld,alessandrarich,cassandracanttellypu,wolford,msem_club,sinemtaskin.co,giorgioarmani,lesbebesjewelrydesign,misbhv,zygielle,victoriassecret,versace,tomford,knwlslondon,seasmoda,aybikekarayel,donemkostumleri,killyouridols,elcindaglaroglu,zeworks,goodthingsatelier,diesel,inciozayanofficial,swarovski,gigiiscom,maisonsoula,seasonal.symphony,animliving,by_rg,balenciaga,blumarine,cassandracanttellyou,penti"}]'::jsonb, 'published'),
('Femme', 'x-Olfa49RyQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_8df8dc2141.jpg', '2023-10-09', ARRAY['Editorial','Fashion']::text[], ARRAY['Femme','October','editorial']::text[], 'femme-103', '[{"r":"Creative Director","p":"sorena.pirouzi"},{"r":"Photographer","p":"sorena.pirouzi,aref_karimi_photography"},{"r":"Stylist","p":"elif.soufi"},{"r":"Hair","p":"hastisedaghatbeauty"},{"r":"Makeup","p":"sheyda._kazemi ,saharziaei.mua"},{"r":"Post-Production ","p":"lindroosastrid.retouch"},{"r":"Producer","p":"narimansv"},{"r":"Starring","p":"liparpink"},{"r":"Fashion by","p":"puma,zara,bershka,intimissimiofficial,addax,ninels_artfactory,nafiseyazdanpanah.designs,masinadream"}]'::jsonb, 'published'),
('The perfection of Imperfection', '2WRjZ7gL0tM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3b08d74252.jpg', '2023-10-01', ARRAY['Editorial','Fashion']::text[], ARRAY['The perfection of Imperfection','October','Songzio','Branded content','cover','editorial']::text[], 'the-perfection-of-imperfection-104', '[{"r":"Branded content for","p":"songzio_official"},{"r":"Photographer","p":"giuliopierini_photography"},{"r":"Videographer","p":"zionlacroix"},{"r":"Creative Director","p":"kangdm"},{"r":"Styling","p":"kangdm"},{"r":"Photo assist","p":"claudiok_ph"},{"r":"Styling Assist","p":"itsjennymjia"},{"r":"Hair","p":"bhoila,rosaliasparviero,francesca.basilio"},{"r":"Make up","p":"bhoila,rosaliasparviero,francesca.basilio"},{"r":"Tracks","p":"aydakar"},{"r":"Starring","p":"calley.sur,special_management,battistifederico,bravemodels,hell5oy,independent_mgmt"}]'::jsonb, 'published'),
('Curtain', 'VuF1I608usM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d4e2d0de0d.jpg', '2023-09-28', ARRAY['Editorial','Fashion']::text[], ARRAY['Curtain','September','editorial','film']::text[], 'curtain-105', '[{"r":"Art direction","p":"lucia__nuzzi"},{"r":"Photographer","p":"emanuele_dangelo__"},{"r":"Video editing","p":"brandosblessed"},{"r":"Stylist","p":"lucia__nuzzi"},{"r":"Makeup","p":"__martinameneghetti__"},{"r":"Hair","p":"nanayche"},{"r":"Starring","p":"letiziafederici"},{"r":"Fashion by","p":"bonechigiulio,costumerialariula,contessamiseriaarchivio,moonbabe_t,campusclub195"}]'::jsonb, 'published'),
('Motorcore', '3oRpWll_lAQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d791f2a315.jpg', '2023-09-11', ARRAY['Editorial','Fashion']::text[], ARRAY['Motorcore','September','editorial']::text[], 'motorcore-106', '[{"r":"Photography","p":"egorov.max"},{"r":"Art direction","p":"andrewtungusoff"},{"r":"Styling","p":"andrewtungusoff"},{"r":"Film","p":"ramvi.art"},{"r":"Hair","p":"gayehiette,bigoudi_agency"},{"r":"Makeup","p":"gayehiette,boris_rieker,bigoudi_agency"},{"r":"Producer","p":"sechsundfuenfzig_"},{"r":"Photo assist ","p":"miss_maj_"},{"r":"Styling assist","p":"monsieurmandre"},{"r":"Casting","p":"robstudiogmbh,ostost.studio"},{"r":"Postproduction","p":"ostost.studio"},{"r":"Production","p":"robstudiogmbh"},{"r":"Starring","p":"divanitanuwame,lauretta_nnamani,karambasanchez,addison.stender,slimy_v,fairyyxnina,sakiii4444,brendamutoni,malaika.daa,izaakgodson,anna.larosee,modelwerk,izaio.modelmanagement,mirrrsmodels,spinmodelmanagement"},{"r":"Special thanks to","p":"robstudiogmbh"},{"r":"Fashion by","p":"jeanpaulgaultier,newbottega,alexandermcqueen,balenciaga,gucci,vetements_official,jimmychoo,dolcegabbana,yproject_official,prada,wolford,davidkomalondon,dior,acnestudios,camperlab,032c,maisonmargiela,ysl,moschino,azaleawangofficial,christina_seewald,cartier,calvinklein,tomford,oscardelarenta,versace,vandenbergbjorn"}]'::jsonb, 'published'),
('The REAL smile', 'buk0X3tyFCk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_8b4ceaea62.jpg', '2023-08-24', ARRAY['Editorial','Beauty','Film']::text[], ARRAY['The REAL smile','August','editorial','beauty']::text[], 'the-real-smile-107', '[{"r":"Art Director","p":"tomhillvisuals"},{"r":"Photography","p":"tomhillvisuals"},{"r":"Makeup","p":"ashleyjordanj"},{"r":"Assistant","p":"beccaharrisphoto,josiesmills"},{"r":"Film","p":"designsbybvl"},{"r":"Cinematographer","p":"designsbybvl"},{"r":"Studio Spaces","p":"apstudiosleeds"},{"r":"Starring","p":"_vickyjackson,dancerplant,luciamateo__,jadoremodelsmcr"}]'::jsonb, 'published'),
('Olympia', 'KiKjJ7NTA7g', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6ef18dbdfd.jpg', '2023-08-04', ARRAY['Editorial','Fashion','Film']::text[], ARRAY['Olympia','August','editorial','fashion','film']::text[], 'olympia-108', '[{"r":"Photographer","p":"dianesagnier"},{"r":"Stylist","p":"mariavinagreincrime"},{"r":"Makeup","p":"sebastiencamp_"},{"r":"Hair","p":"sebastiencamp_"},{"r":"Photo assist","p":"Aurelien Berne"},{"r":"Teeth gems","p":"gems_on_my_tooth"},{"r":"Starring","p":"lea.rostain,kai"},{"r":"special thanks","p":"faxionpr,lappartpr,studio_paillette"},{"r":"Fashion by","p":"adidasoriginals,vanessa_schindler,22industry,domestique,mireiaplaya,officialtammygirl,allibijoux,everlast,nakdfashion,apparis,pengtaiofficial,juliabartsch_jewellery,inesdelafressangeparis,sistermorphine_,lironie.official,r.l.e.official,asics,rusmin.fr,persta.paris,lacoste,nike,van_rysel"}]'::jsonb, 'published'),
('Goblin Mode', '79FB7Z-0CGE', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_1e5987e8a7.jpg', '2023-06-30', ARRAY['Editorial','Fashion','Film']::text[], ARRAY['Goblin Mode','June','editorial','film']::text[], 'goblin-mode-109', '[{"r":"Photography","p":"missgherard"},{"r":"Direction","p":"missgherard"},{"r":"Styling","p":"ariannacolciago,gemmaboccardo"},{"r":"Set Designer","p":"ariannamenduni,ariannacolciago,gemmaboccardo"},{"r":"Makeup","p":"milagroschavezmua,_.aalessia.__"},{"r":"Hair","p":"miniquehair,annagglam"},{"r":"Light Assist","p":"_joepal_,sp__sofia,sstephanie.ff"},{"r":"Digital Assist","p":"antvnello"},{"r":"Sound Design","p":"silviadifuria"},{"r":"Video Editing","p":"missgherard,irecavazzuti"},{"r":"Starring","p":"sofiaavaltroni,la.t.ura"}]'::jsonb, 'published'),
('Digital Human', 'ri0HUK5TAm4', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5414ba557f.jpg', '2023-06-25', ARRAY['Editorial','Fashion','Film']::text[], ARRAY['Digital Human','June','branded contents','yaspis','black form','Editorial']::text[], 'digital-human-110', '[{"r":"Branded","p":"yaspis.brand,black.form"},{"r":"Video director","p":"iana.madejska"},{"r":"CG","p":"iana.madejska"},{"r":"Producer","p":"katya_boyarin"},{"r":"Film editor","p":"katya_boyarin"},{"r":"Stylist","p":"vitaclats"},{"r":"Makeup","p":"emmashrayber"},{"r":"Hair","p":"emmashrayber"},{"r":"Assist","p":"kiska_von_muryska"},{"r":"Camera","p":"mikeprikhodko"},{"r":"Light","p":"ivn_svrch"},{"r":"Starring","p":"oleggorchanin_"}]'::jsonb, 'published'),
('ONI-HIME pretending to be human', 'BdoA5ApjKuM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000000_0aad3e5ad2.jpg', '2023-06-18', ARRAY['Fashion','Film']::text[], ARRAY['ONI-HIME pretending to be human','BACKSTAGE','film','Editorial']::text[], 'oni-hime-pretending-to-be-human-111', '[{"r":"Photographer","p":"arisak_official"},{"r":"Stylist","p":"ka___ya___"},{"r":"Special Makeup","p":"pure.ddd"},{"r":"Hair","p":"megumikuji_luckhair"},{"r":"Nail","p":"katherineeeejin"},{"r":"Starring","p":"pure.ddd"},{"r":"Fashion by","p":"hm,muglerofficial"}]'::jsonb, 'published'),
('H.A.I.R', 'rLkzEKPy6F4', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_bb3f43ef97.jpg', '2023-06-02', ARRAY['Beauty','Film']::text[], ARRAY['H.A.I.R','BEAUTY','FILM','Editorial']::text[], 'hair-112', '[{"r":"Art Director","p":"_bluejazmin_,jazmincalcarami,azulrossetti"},{"r":"Photographer","p":"_bluejazmin_,jazmincalcarami,azulrossetti"},{"r":"Hair","p":"johnydean.hmua"},{"r":"Makeup","p":"martupucheta_,kabukimakeupschool"},{"r":"DOP","p":"sergio__claudio"},{"r":"Retoucher","p":"gusgoncalves_dretouch"},{"r":"Starring","p":"lucy_gliter,tuttomauhum,marianoinomata,claire.fatale,adom_management,martidietrich,ceres_management"}]'::jsonb, 'published'),
('Ride or Die', 't2Js4qNRJxk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f64fe2e844.jpg', '2023-05-16', ARRAY['Fashion','Film']::text[], ARRAY['Ride or Die','may','film','editorial']::text[], 'ride-or-die-113', '[{"r":"Photography","p":"adi_segal"},{"r":"Creative Director","p":"adi_segal"},{"r":"Styling","p":"shiraa_levi_"},{"r":"Makeup","p":"moraneilenbergmakeup"},{"r":"Wig","p":"shay_shaz"},{"r":"Styling assist","p":"linoy_levy"},{"r":"Starring","p":"fayjakite"},{"r":"Fashion by","p":"ynon.c,hm,kerenwolf,shenkinglasses,omermichaelofficial,stradivarius,shiraa_levi_,millyvishnia_jewelry,misbhv,mango,the_official_margot,avs__studio,danielleweiz"}]'::jsonb, 'published'),
('Ecce Populus', 'PaGn9q5mLrY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_0c8c5e0d7e.jpg', '2023-05-01', ARRAY['Editorial','Fashion']::text[], ARRAY['Ecce Populus','backstage','editorial','May','cover']::text[], 'ecce-populus-114', '[{"r":"Creative Director ","p":"ces_fra,megelline"},{"r":"Photographer","p":"ces_fra"},{"r":"Photo Assist","p":"markxpenn,Yasmine Tawil"},{"r":"Stylist","p":"megelline"},{"r":"Stylist Assist","p":"anthea_foitzik,natalei_ying"},{"r":"Set Designer","p":"giuliamoliarov"},{"r":"Makeup","p":"loca_mocca_makeup_"},{"r":"Makeup Assist","p":"nicoole_mua"},{"r":"Hair","p":"kostrukhair"},{"r":"Post Production Assist","p":"bhadsophia"},{"r":"Studio","p":"shutterhousestudio"},{"r":"Starring","p":"s3xgodess,hellyarkford,d1models,markxpenn,blueagencyldn"},{"r":"Fashion by","p":"gyoureekim,juoyu__vv,nationaltheatrecostumehire,phoebewalshjewellery,somebodyelsesguy,lydiagreenlondon,shshsheep,blackprgroup,ju_nna_,schuh,beminefootwear,michelleloweholder,mantle_mantle_,huang__studio"}]'::jsonb, 'published'),
('After Hours', 'tgAIJBx0Hms', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2e816b6596.png', '2023-04-15', ARRAY['Editorial','Fashion']::text[], ARRAY['After Hours','April']::text[], 'after-hours-115', '[{"r":"Photographer","p":"maya_wanelik"},{"r":"Producer","p":"maya_wanelik"},{"r":"Stylist","p":"katie_dulieu"},{"r":"Hair","p":"cmstanley13"},{"r":"Makeup","p":"laisumfung"},{"r":"BTS Videographer","p":"ralphogram_"},{"r":"Lighting Assistant","p":"finnwaring"},{"r":"Production","p":"hattiejacksonfilm"},{"r":"Starring","p":"anutumenjargal,_wzhengyu_"},{"r":"Fashion by","p":"susamusaclothing,thisbelongs.to,4elementlondon,connorogrady,nationaltheatrecostumehire,undergroundengland.since1981,beashastudios,_parlemor_,m.r.h.studio,margauxstudios,amber.healey,clubllondon"}]'::jsonb, 'published'),
('Fighting For Yourself', 'KEnbxabppWQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4bb4c2dc0e.png', '2023-04-14', ARRAY['Editorial','Film']::text[], ARRAY['Fighting For Yourself','BACKSTAGE','editorial']::text[], 'fighting-for-yourself-116', '[{"r":"Artistic Director","p":"india.ifh"},{"r":"Photographer","p":"julesbedard"},{"r":"Stylist","p":"india.ifh"},{"r":"Makeup","p":"mainamilitza"},{"r":"Hair","p":"ohkeidokei"},{"r":"Video Editor","p":"mattchirico_"},{"r":"Video Recorder","p":"veravisuals_"},{"r":"Dj / Producer","p":"beurredemiserbe"},{"r":"Starring","p":"m.elu.sine"},{"r":"Fashion by","p":"rachelsudbury,foo_babe,chanel,kovackovackovac,bbsimon_officialpage,mild.therapy,samblakesam"}]'::jsonb, 'published'),
('MASKS', 'pWKeqfGPwYM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2bb9c1b108.png', '2023-04-05', ARRAY['Editorial','Beauty']::text[], ARRAY['Masks','April','beauty']::text[], 'masks-117', '[{"r":"Idea","p":"Anngrego_makeup"},{"r":"Make Up","p":"Anngrego_makeup"},{"r":"Hair","p":"Anngrego_makeup"},{"r":"Fx & Make Up","p":"Grim_ua"},{"r":"Photographer","p":"Katelock_photo"},{"r":"Video","p":"Annamarx.Film"},{"r":"Music","p":"Mikacmp"},{"r":"Starring","p":"Albino_and_human"}]'::jsonb, 'published'),
('UNE AUTRE PERSPECTIVE', 'W1vzyoLbDhY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a630d68ac6.png', '2023-04-02', ARRAY['Editorial','Beauty']::text[], ARRAY['Une autre perspective']::text[], 'une-autre-perspective-118', '[{"r":"Photographer","p":"nadiacorreiaphotography"},{"r":"Hair","p":"sadielauder_mua,authenticbeautyconcept"},{"r":"Make Up","p":"CharlieFitzjohn,samplebeauty"},{"r":"Make Up Assistant","p":"lilysimmonds_mua"},{"r":"Retoucher","p":"retouching.ch"},{"r":"Video Editor","p":"jayneto.edits"},{"r":"Studio","p":"w_modelmgmt"},{"r":"Starring","p":"tulsishivaanand,tkenyaroper,w_modelmgmt"}]'::jsonb, 'published'),
('PUNK!', 'E_1bql3SuYA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_794d721a49.jpg', '2023-03-26', ARRAY['Editorial','Fashion']::text[], ARRAY['Editorial','Punk!']::text[], 'punk-119', '[{"r":"Photographer","p":"shootmecali"},{"r":"Hair","p":"jessiessway"},{"r":"Makeup","p":"jessiessway"},{"r":"Starring","p":"fiohnahh"},{"r":"Fashion by","p":"driesvannoten,zara,miista,weekdayofficial,tiffanyandco,burton,CyConncet,jeanpaulgaultier"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('TRANSPARENT SOUL', '5wI1yF1m8kg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_57be279510.jpg', '2022-06-03', ARRAY['Fashion','Film','Art']::text[], ARRAY['TRANSPARENT SOUL']::text[], 'transparent-soul-120', '[{"r":"포토그래퍼","p":"pho_lee"},{"r":"아트 디렉터","p":"sooksmell"},{"r":"스타일링","p":"sapunova.friendly,sooksmell"},{"r":"비디오","p":"whogotjyp"},{"r":"비디오 어시스던트","p":"t4co93"},{"r":"그래픽","p":"yuja_439"},{"r":"헤어","p":"silvergun_96"},{"r":"메이크업","p":"makeup_hwang"},{"r":"네일","p":"nailed_it_rany"},{"r":"프로듀싱","p":"youarenot_hydrated"},{"r":"모델","p":"iban1ban_,bujung2"},{"r":"함께한 브랜드","p":"kicheleehe,reincarnation_l,pandorum_jewelry,worldsnotmine,bluerofficial,nailed_it_rany,mschf"}]'::jsonb, 'published'),
('SUPPRESSED ADRENALINE', 'ClNhpVczLl8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Suppressed_Adrenaline_7e5668e7c7.jpg', '2022-03-07', ARRAY['Fashion']::text[], ARRAY['Suppressed Adrenaline','FASHION','FILM']::text[], 'suppressed-adrenaline-121', '[{"r":"포토그래퍼 & 필름","p":"anhyuntaee"},{"r":"스타일리스트","p":"woo____lee"},{"r":"세트 디자인","p":"we.are.oori"},{"r":"메이크업 & 헤어","p":"_kwonjiin"},{"r":"사운드","p":"xxmalvo"},{"r":"모델","p":"ewanwpreston,irinaliss,Niall Walker,songgemstone,jmodel_management"},{"r":"함께한 브랜드","p":"seouu_official,louisvuitton,iryuk26,burberry,theopenproduct,koh_seungmin,ysl,andersonbell,boutique_vente,32dawn.official"}]'::jsonb, 'published'),
('DUSK TILL DAWN', 'R-a2IRO-J94', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_4449ef46b3.jpg', '2022-01-31', ARRAY['Fashion']::text[], ARRAY['Dusk Till Dawn','FASHION','FILM','패션','필름']::text[], 'dusk-till-dawn-122', '[{"r":"포토그래퍼","p":"juaryeong_"},{"r":"필름 & 아트 디렉팅","p":"juaryeong_"},{"r":"어시스던트","p":"leejonghyeon_"},{"r":"스타일링","p":"j0ngsi"},{"r":"메이크업","p":"seomyumyu"},{"r":"네일","p":"eva_ofnail"},{"r":"헤어","p":"ma_hair7"},{"r":"강아지","p":"dante_r_wolf"},{"r":"모델","p":"parfeni_julia,fox_kotryna"},{"r":"함께한 브랜드","p":"badblood__,numeroventuno,saltwater_official,NylonB,beaufille,helmutlang,calzedonia,coperni,whole.paper,fendi,Zara,unravelproject,byfar_official,Heard"}]'::jsonb, 'published'),
('FOR TORY', 'mS5HZqlN0cY', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_f2867ead87.jpg', '2022-01-28', ARRAY['Fashion']::text[], ARRAY['For Tory','FASHION','film','필름','패션']::text[], 'for-tory-123', '[{"r":"포토그래퍼","p":"yp300"},{"r":"비디오","p":"__nyxng__"},{"r":"스타일링","p":"lucete_somstyle"},{"r":"메이크업","p":"p._.syeoni"},{"r":"헤어","p":"hairbysjp"},{"r":"모델","p":"torys_"},{"r":"함께한 브랜드","p":"_charlesjeffrey,ysl,chanelofficial,onceinalifetime.shop,gentlemonster,celine,davidechoi,dior,zara,area,Gucci,jlisajewelry,David Komma"}]'::jsonb, 'published'),
('ARTIST-HAEEOHWA', 'VlChrDMLisg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_ef71babe06.jpg', '2021-11-11', ARRAY['Fashion']::text[], ARRAY['Artist-Haeeohwa','HAEEOHWA','해어화','FASHION','FILM','에디토리얼']::text[], 'artist-haeeohwa-124', '[{"r":"크레이티브","p":"_k_mimah"},{"r":"아트 디렉팅","p":"_k_mimah"},{"r":"포토그래퍼","p":"edomrode"},{"r":"디렉팅","p":"edomrode"},{"r":"오브제","p":"edomrode,_k_mimah"},{"r":"비디오","p":"dkgndiem,re_story_3"},{"r":"스타일링","p":"s2__young0"},{"r":"헤어","p":"0__seong"},{"r":"메이크업","p":"0__seong"},{"r":"함께한 브랜드","p":"moonaoq,1001kill,chanelofficial,ZARA"}]'::jsonb, 'published'),
('CYBER 2046', 'LHEXz58lyBM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_266043fce8.jpg', '2021-10-17', ARRAY['Film']::text[], ARRAY['Cyber 2046','BACKSTAGE','FILM','백스테이지','필름']::text[], 'cyber-2046-125', '[{"r":"크리에이티브 디렉션","p":"elana_mity"},{"r":"포토그래퍼","p":"dimacube"},{"r":"포토그래퍼 어시스던트","p":"nowhere.2go"},{"r":"비디오","p":"offmyrrh"},{"r":"메이크업","p":"mary_dav"},{"r":"스타일링","p":"stylekatyaclover"},{"r":"스타일링 어시스던트","p":"hillary_stylist"},{"r":"헤어","p":"hairdresserlf"},{"r":"헤어 어시스던트","p":"hairs_rostislav"},{"r":"뷰티 에이전시","p":"humans.agency"},{"r":"모델","p":"samuraileeyuna,t_modelsagency"},{"r":"함께한 브랜드","p":"svarka_svarka,ponomarev_andrei,adidasrussia,resobjects,prada,bushabon,versace,off___white,sintezia,jackson_de_ville,oakley,balenciaga"}]'::jsonb, 'published'),
('PSYCHO THERAPY', 'DbH6h7Pgc3U', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1d79a2fb3f.jpg', '2021-07-22', ARRAY['Fashion']::text[], ARRAY['Psycho Therapy','FASHION','FILM']::text[], 'psycho-therapy-126', '[{"r":"디렉팅 & 스타일링","p":"s2__young0"},{"r":"포토그래퍼","p":"kimmoondog"},{"r":"비디오","p":"min.paran"},{"r":"메이크업","p":"xoxov3"},{"r":"모델","p":"gg.hyoni,_gonix,keeng_j.m"},{"r":"함께한 브랜드","p":"newri_s.o,ub.sss,ddengbeol,h2rchivo,ye0ngho,minachung_official,021____,roseinmyhead,septem__asia"}]'::jsonb, 'published'),
('CHILD OF THE TYPHOON', 'O7jX2Mv_fGM', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9c0057834d.jpg', '2021-06-20', ARRAY['Editorial']::text[], ARRAY['Child of the Typhoon','BACKSTAGE','film','에디토리얼']::text[], 'child-of-the-typhoon-127', '[{"r":"아이디어","p":"evseenko_style_project"},{"r":"포토그래퍼","p":"izbash"},{"r":"헤어","p":"like_angi_makeup"},{"r":"메이크업","p":"like_angi_makeup"},{"r":"플라워","p":"flower_fay_"},{"r":"스타일링","p":"evseenko_style_project"},{"r":"어시스던트","p":"kate.salivonik.style,natalykim.lifestyle,elen_by_elen"},{"r":"비디오","p":"sashabizzph"},{"r":"리터치","p":"keo_photo_studio"},{"r":"모델","p":"aseldospanbet"},{"r":"함께한 브랜드","p":"svarka_svarka,melissashoesru,try_me_on.msk,amplituda_design,isseymiyakeofficial,because.msk,drgn.dorogina,brand_dobrova,topshop,lamodaru"}]'::jsonb, 'published'),
('PROM PARTY', 'yDMuNGRN2E4', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_f400152150.jpg', '2021-05-20', ARRAY['Fashion']::text[], ARRAY['Prom Party','FASHION','FILM']::text[], 'prom-party-128', '[{"r":"디렉팅","p":"hwangtoe,fitb_d"},{"r":"촬영 감독","p":"hwangtoe"},{"r":"촬영 어시스던트","p":"youth._.__,astronmyy"},{"r":"아트 디렉터","p":"m1m1y"},{"r":"아트 디렉터 어시스던트","p":"pota.my"},{"r":"스타일링","p":"Ena Kim,ninaweirdo"},{"r":"메이크업","p":"ryungkyungshoot,_lheee_"},{"r":"헤어","p":"myeongjaelee_,minguumi"},{"r":"조명","p":"b.think_light"},{"r":"조명 어시스던트","p":"JongWon Jeon,Dongu Jo"},{"r":"음악","p":"makai_space"},{"r":"모델","p":"Lira,Alisa,Dileisy,Hyojin,Yeonsoon,Willy,Gabriel,Alex,Denis,Cosar"},{"r":"특별히 감사한 분들","p":"keemdonggun,jmodel_management,lsacmodel,a.sset_official,modeldirectors,hurjaboyacc,anchovi_official"},{"r":"함께한 브랜드","p":"anchovi_official,boss,hurjaboyacc,kenzo"}]'::jsonb, 'published'),
('LIVING THINGS', 'Yjw0pmWKK2I', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_863f8e414a.jpg', '2021-05-04', ARRAY['Film','Art']::text[], ARRAY['Living Things','아트 필름','film']::text[], 'living-things-129', '[{"r":"포토그래퍼 & 아트 디렉터","p":"talkwg_331young"},{"r":"촬영 감독","p":"alexanderisacc_"},{"r":"그래픽","p":"7days7nights__"},{"r":"세트 & 소품 디자인","p":"bubu_1206"},{"r":"스타일링","p":"saltedbits"},{"r":"모델","p":"goddongjin_,nemui_woo,park_xxo,se._.nnniii,special_j.h,wi_geum00,luce7kim,nahcesnooy,cukeem,beom.o___o,morphmgmt"}]'::jsonb, 'published'),
('EMERGENCY LANDING', '75rzQEsyFEk', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b362d01e99.jpg', '2021-04-26', ARRAY['Fashion']::text[], ARRAY['Emergency Landing','FASHION','FILM','패션','필름']::text[], 'emergency-landing-130', '[{"r":"디렉팅 & 포토그래퍼","p":"min.paran,nekono.aki"},{"r":"헤어 & 메이크업","p":"jieuns_makeup"},{"r":"모델","p":"s2aem,k_sw_"},{"r":"함께한 브랜드","p":"zara,vuiel_official,h&m,songhanna_800"}]'::jsonb, 'published'),
('LABERYNTH', '1C4X-OCMBp0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_ae0e89b265.jpg', '2021-02-18', ARRAY['Fashion']::text[], ARRAY['Laberynth','FASHION','FILM','패션','필름']::text[], 'laberynth-131', '[{"r":"포토그래퍼 & 아트 디렉팅","p":"pan.gur"},{"r":"비디오","p":"carlacococ"},{"r":"스타일링","p":"josefinamezza"},{"r":"메이크업","p":"ipaintonfaces"},{"r":"모델","p":"_luzzzz_"},{"r":"함께한 브랜드","p":"_mal_donado,luispachecofficial,maldonadoc__,la_comune_,fernandoalberto_atelier,bibianblue,urblackjoyeriaconceptual"}]'::jsonb, 'published'),
('DYSMORPHIA', 'v5bWWm1XPCc', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_c4841f319d.jpg', '2021-02-14', ARRAY['Beauty']::text[], ARRAY['Dysmorphia','BEAUTY','FILM','뷰티','필름']::text[], 'dysmorphia-132', '[{"r":"크레이티브 디렉팅","p":"pistachica"},{"r":"포토그래퍼","p":"barbaragabriellee"},{"r":"비디오 디렉팅","p":"quentinpistol"},{"r":"음악","p":"votuvotuvotu"},{"r":"스타일링","p":"Emily Bogner"},{"r":"메이크업","p":"carolinacarpegiani"},{"r":"모델","p":"yoniunius"}]'::jsonb, 'published'),
('LET''S SEW OUR LIPS', '8g6_VCV54AQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_23431650dd.jpg', '2021-01-26', ARRAY['Fashion']::text[], ARRAY['Let''s sew our lips','FASHION','FILM','패션','필름']::text[], 'lets-sew-our-lips-133', '[{"r":"포토그래퍼 & 필름 & 아트 디렉션","p":"ireaw,rocco_gurrieri"},{"r":"스타일링","p":"madameaugust"},{"r":"장식","p":"ub_firenze"},{"r":"모델","p":"_ppprincesss"},{"r":"함께한 브랜드","p":"maisonvalentino,comelerose,atma_maison,celine,mulberryengland,unif,burberry,zara,ralphlauren"}]'::jsonb, 'published'),
('YESTERDAY NIGHTMARE 1', 'lkDxLnMVxP8', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b7d0cfcfb0.png', '2021-01-19', ARRAY['Fashion','Art']::text[], ARRAY['Yesterday Nightmare','Fashion','패션','Film','필름','에디토리얼']::text[], 'yesterday-nightmare-1-134', '[{"r":"포토그래퍼","p":"minasonphotos"},{"r":"스타일링","p":"armmism"},{"r":"메이크업","p":"5miyoung"},{"r":"헤어","p":"_kwonjiin"},{"r":"프로덕션","p":"minasonphotos,armmism,yelloyellow____"},{"r":"아트 디렉팅","p":"minasonphotos,armmism"},{"r":"함께한 브랜드","p":"zara,hm,joyrichla,americanapparel,hei_jewelry,wolford"}]'::jsonb, 'published'),
('YESTERDAY NIGHTMARE 2', 'pPqvdvFEL_g', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Yesterday_Nightmare2_9ded1330f1.jpg', '2021-01-19', ARRAY['Fashion','Art']::text[], ARRAY['Yesterday Nightmare','FILM','ART','FASHION']::text[], 'yesterday-nightmare-2-135', '[{"r":"포토그래퍼","p":"minasonphotos"},{"r":"아트 디렉팅","p":"minasonphotos,armmism"},{"r":"스타일링","p":"armmism"},{"r":"헤어","p":"_kwonjiin"},{"r":"메이크업","p":"5miyoung"},{"r":"프로덕션","p":"minasonphotos,armmism,yelloyellow____"},{"r":"모델","p":"yelloyellow____"},{"r":"함께한 브랜드","p":"zara,hm,joyrichla,americanapparel,hei_jewelry,wolford"}]'::jsonb, 'published'),
('CHRISTMAS WISHES', 'JQU1nz8kSV4', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d4a04bd2ed.jpg', '2021-01-02', ARRAY['Fashion']::text[], ARRAY['Christmas Wishes','FASHION','Film','패션','필름']::text[], 'christmas-wishes-136', '[{"r":"디렉팅","p":"hwangtoe_,fitb_d"},{"r":"촬영 감독","p":"hwangtoe_"},{"r":"촬영 어시스던트","p":"ByeongGu Woo,SangWoong Yoon"},{"r":"아트 디렉팅","p":"m1m1y"},{"r":"아트 디렉팅 어시스던트","p":"pota.my"},{"r":"스타일링","p":"woo____lee"},{"r":"헤어 & 메이크업","p":"suana_makeup,makeup_syshin,Choi Yeongseong"},{"r":"헤어 & 메이크업 어시스던트","p":"flor___892"},{"r":"그래픽 디자인","p":"keemdonggun"},{"r":"모델","p":"Roy,Rahel,Kate,taemeen,Marcin,Varvara,Hannah,maybom__,djang_go_lee"}]'::jsonb, 'published'),
('BREAKING NEWS', 'qUHnp-519f0', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3f43aea1c5.jpg', '2021-01-02', ARRAY['Fashion']::text[], ARRAY['BREAKING NEWS','에디토리얼','필름','film','MEXICO CITY','FIRE']::text[], 'breaking-news-137', '[{"r":"주연","p":"yunaoluna"},{"r":"포토그래퍼","p":"vengacheivs"},{"r":"스타일링","p":"franciscojrondon"},{"r":"메이크업","p":"juanmacons"},{"r":"헤어","p":"alessa_gd"},{"r":"어시스던트","p":"joloyola"},{"r":"크리에이티브 디렉션","p":"franciscojrondon,vengacheivs"},{"r":"비디오","p":"carolinaburbano,enriquetademivida"},{"r":"비디오 프로덕션","p":"krulezzz"},{"r":"모델","p":"yunaoluna,Coco Alvarez ,joloyola"},{"r":"특별히 감사한분들","p":"palomalirastudio,elpetitvintage,colectivocreativodemoda"},{"r":"함께한 브랜드","p":"robertoleoneofficial,tumbiko.embajadora,palomalirastudio,Jesús Parra,julio.jordan,Pascual Orozco + Máxima Murrillo,marcjacobs,nayibi_mexico,givenchy,dior"}]'::jsonb, 'published'),
('METACOGNITION', 'ReGwX9UQLoA', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3d73dd8219.jpg', '2020-12-27', ARRAY['Fashion']::text[], ARRAY['Metacognition','FASHION','FILM','패션 필름']::text[], 'metacognition-138', '[{"r":"포토그래퍼","p":"kimsunwoo___"},{"r":"필름 디렉팅","p":"nonecircle"},{"r":"사운드","p":"xxmalvo"},{"r":"스타일리스트","p":"woo____lee"},{"r":"헤어&메이크업","p":"minguumi"},{"r":"모델","p":"iamdongsunpark,jt4235"},{"r":"함께한 브랜드","p":"00000.official,chindown_official,_ginpal,newwaveboys_official"}]'::jsonb, 'published'),
('OFFICE HUMAN: BLINDFOLD', 'dcQ-eYisMgQ', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d2ebad5159.jpg', '2020-12-13', ARRAY['Fashion']::text[], ARRAY['Office Human: blindfold','blindfold','Film','패션 에디토리얼']::text[], 'office-human-blindfold-139', '[{"r":"포토그래퍼","p":"hong_doyeun"},{"r":"비디오","p":"itschillyoung"},{"r":"비디오 어시스던트","p":"sangboorah,dokyun_w"},{"r":"스타일리스트","p":"__stylist_didii"},{"r":"스타일리스트 어시스던트","p":"sophia_oci"},{"r":"헤어","p":"parkchangdae"},{"r":"메이크업","p":"king_ttora"},{"r":"사운드 디렉터","p":"jadeandb"},{"r":"디지털 리터치","p":"hongbrodigital"},{"r":"리터치 어시스던트","p":"sojiiiiiin_"},{"r":"모델","p":"iam_2jm,morphmgmt"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.films (title, youtube_id, thumbnail_url, published_date, categories, tags, slug, credits, status) VALUES
('SUMMER WALTZ', 'StH9iptHg10', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Summer_Waltz_166266e417.jpg', '2020-12-08', ARRAY['Fashion']::text[], ARRAY['Summer Waltz','FASHION','FILM']::text[], 'summer-waltz-140', '[{"r":"포토그래퍼","p":"HyeonsikShin"},{"r":"모델","p":"0__seok,yg_kplus,kmilds,jennifermodel"},{"r":"메이크업 & 헤어","p":"laheeeee"},{"r":"스타일리스트","p":"imadeit4real"},{"r":"필름 디렉터","p":"kant.98"},{"r":"함께한 브랜드","p":"Ticol,Her Mosa,Vasso,missoni,cp_company_official,ajo_ajobyajo_official,tannersavenue,levis,xyz__official,Hai Sprting Gear"}]'::jsonb, 'published')
ON CONFLICT (slug) DO NOTHING;

-- =============================================
-- ARTICLE DATA: 317 articles
-- =============================================

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('밀란 패션 위크 FW26 스트릿 스타일 Part.2', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-fw26-street-2-0', '2026-03-02', 'Fashion', '["MILAN FASHION WEEK","FW26","STREET STYLE","스트릿 스타일","밀란 패션 위크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_96674e913a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_d2170845de.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">MILAN FASHION WEEK FW26 STREET STYLE</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_c49a411b91.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_e087ad9bf9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_75e7158660.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_8acf73854b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_4fcbb21009.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_c3397e31a1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_15aec15d82.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_5c632f981d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_0330161c12.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_23a9a1242c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_5787ffeb79.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_e395103bf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_a80aa000f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_cc13ffe20d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_eb3d91daef.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_96262be4a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_ac44c56913.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_7ae1a1766a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_f0fdfa38d4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_8d59c2eb67.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_3a6c651473.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_c283646522.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_f7ca07a6cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_3d9726cb0d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_881034be2a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/41_dcb00600ae.jpg"]'::jsonb, '[]'::jsonb, 'mfw-fw26-street-2', 'published'),
('루이사 베카리아 FW26 백스테이지 with 밀란 패션 위크', '<PAP>가 루이사 베카리아 백스테이지 현장을 담아왔다', 'categoryfashion3416news-1', '2026-02-27', 'Fashion', '["루이사 베카리아","백스테이지","밀란 패션 위크","Backstage","FW26","Luisa Beccaria"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a64179d463.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_10f3cf27f9.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Luisa Beccaria</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_4be687bb40.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_fefc1c91d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_4cfaecf1c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b10c82c169.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_d54dbe3ff1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_7c00e4f4e9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_72842ee13b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_dde2940666.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_3c17081251.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_9d00380f95.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_acc0541597.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_87c5523b40.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_b062575b23.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_948f34ecc9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_ed43e7e166.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_deac833f9e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_8f5fdb6f0c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_3074f994da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_ac14f325db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_20c01c2602.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_6e10819f88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_8312dce9ff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_2a3d7b06b6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_50923e140c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_b1ce1edf93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_3df117a503.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_0d6051cc10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_66810755f4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_d39c6fb2d5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_5958edebf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_d16d8cb563.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_8b4961533a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/37_ce6437b1bf.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3416/news/', 'published'),
('밀란 패션 위크 FW26 스트릿 스타일 Part.1', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-fw26-street-1-2', '2026-02-26', 'Fashion', '["MILAN FASHION WEEK","FW26","STREET STYLE","mfw","밀란 패션 위크","스트릿 스타일"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_697f849e71.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_8a8d2b4d65.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">MILAN FASHION WEEK FW26 STREET STYLE</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_48ccddf435.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_bdb3be5b26.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_1a18680213.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_32147dd584.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_c548743227.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_ed0ff8dee6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_ca584829c4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_a2a51ad0af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_ccad23b8c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_c66b32a097.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_4e78e32ef9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_b70d47fd9f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_a11cff7a47.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_45cd4c3a76.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_8157ab1efa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_6b6d6a8e63.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_8761228c7d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_8c5a4067ea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_40a4f24b2a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_fda0e5dc81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_1b88517278.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_04f281fecc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_ebe5a9cac8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_0be451941f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_6415d5171d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/44_a47ee512fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45_34c17ee9d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/46_b6630ad1ea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/47_ef0dea8785.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/48_4a41717d76.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/49_a45580595e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/50_9645a5dfa8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/52_29e919588a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/53_74e5b246a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/54_38668c630d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/59_97b9ba1a52.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/62_ea546c2b37.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/63_c185579f32.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/64_b2e055d638.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/66_23ae46ce4e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/67_9138575143.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/68_7ae551eb05.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/69_f07775c1af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/71_fe1c8af49a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/74_a2d9bd6cd2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/76_8be4d1df88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/77_d30cb8309f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/78_d12526b4a0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/79_8ad791ed34.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/80_c1616ed3ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/82_0654c8e1e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/84_6511d990a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/85_e4e06f1d73.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/87_f86beba681.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/88_52b8060872.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/89_12e3aab744.jpg"]'::jsonb, '[]'::jsonb, 'mfw-fw26-street-1', 'published'),
('설날을 위한 가장 세련된 선택, 에덴 보드카', '최근 명절 선물로 주목받는 몽골의 프리미엄 보드카 ''에덴''', 'categorylife3414news-3', '2026-02-13', 'Life', '["에덴","EDEN","에덴보드카","명절보드카","설날선물"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a7e96c587e.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_a715470bad.jpg', '<br>

<p style="text-align:left;">

#광고 혹독한 겨울을 지나 따뜻한 봄을 맞이하는 몽골의 설날, 차강사르. 한 해의 시작을 알리는 이 명절은 단순한 기념일을 넘어 어른에 대한 존경과 혈통, 전통을 중시하는 몽골 최대의 축제다. 울 보우와 우츠, 부쯔, 아롤과 차강이데 같은 유제품이 오르는 상차림은 몽골인의 생활 방식과 민족적 정체성을 고스란히 담아낸다. 그리고 그 중심에는 차례상의 정수를 이루는 전통주 사르하드가 있다.

<br>
최근에는 몽골 프리미엄 보드카 <a href="https://www.instagram.com/edenvodka/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에덴</strong></a>&#40;Eden&#41;이 명절 주류로 주목받고 있다. 1924년 설립되어 100년 넘게 몽골 식품 산업을 이끌어온 APU 주식회사가 2016년 선보인 브랜드로, 전통과 품질, 현대적 감각을 결합해 시장에서 입지를 다져왔다. 프랑스 ‘Appartement 103’과의 협업으로 리브랜딩을 거쳐 모던 미니멀 디자인으로 재탄생했으며, 현재 GS25와 Wine25+를 통해 국내에서도 쉽게 만나볼 수 있다. 다가오는 설 연휴, 특별한 술과 함께 하고 싶다면 지금 에덴을 주목해볼 것.

<br>
*Drink Responsibly  
19세 이상의 법적 음주 허용 소비자를 위한 콘텐츠입니다.  
경고: 지나친 음주는 뇌졸중, 기억력 손상이나 치매를 유발합니다. 임신 중 음주는 기형아 출생 위험을 높입니다.

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_42e0cdca23.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_f8cdd7475a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_7bb7863f94.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b3944401a5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_ee26cf71a7.jpg"]'::jsonb, '[]'::jsonb, '/category/Life/3414/news/', 'published'),
('왜 델보였을까, 캐스퍼 보스만스에게 묻다', '교류와 이야기, 그리고 협업에 대해 말하는 캐스퍼 보스만스', 'categoryfashionart3412news-4', '2026-02-06', 'Fashion,Art', '["델보","delvaux"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1080_9c9dedd2fd.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_8c451769ab.png', '<br>

<p style="text-align:left;">

세계 최초의 럭셔리 레더 하우스 <a href="https://www.instagram.com/delvaux/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">델보</strong></a>가 더현대 서울에서 새로운 팝업 스토어를 선보인다. 이번 팝업에서는 벨기에 아티스트 <a href="https://www.instagram.com/kasperbosmans/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캐스퍼 보스만스</strong></a>와의 협업으로 완성된 코리아 익스클루시브 컬렉션을 세계 최초로 공개한다.

<br>
이번 협업을 통해 델보와 캐스퍼 보스만스가 나눈 대화는 작품과 공간 전반에 자연스럽게 스며든다. 그가 이번 협업에서 가장 중요하게 생각한 지점과 델보를 선택한 이유, 그리고 이 협업의 핵심 키워드는 지금 슬라이드를 넘겨 &#60;PAP&#62;과 함께한 인터뷰를 통해 보다 자세히 만나볼 수 있다.

<br>
Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_bab65aec23.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_dee4f51257.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01010_29e5045fec.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_4439372570.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11111_b65974ac1e.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_d65e2bfb6f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3e05f266b7.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_2b9d23b8dd.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11111111_9bb54205f6.png"]'::jsonb, '[]'::jsonb, '/category/Fashion,Art/3412/news/', 'published'),
('살 테면 사 봐라, 김해김의 쿠뛰르', '진주와 리본, 그리고 김해김의 도발적 태도', 'categoryfashion3413news-5', '2026-02-06', 'Fashion', '["김해김","KIMHĒKIM","서울패션위크","SFW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01018080_1b0eefe75e.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6757675_82856d34f8.png', '<br>

<p style="text-align:left;">

“살 테면 사 봐라.” 크리에이티브 디렉터 김인태가 이끄는 <a href="https://www.instagram.com/maison_kimhekim/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">김해김</strong></a>의 도발적인 놀이가 서울에서 다시 펼쳐진다. 2021년부터 이어져 온 김해김의 OBSESSION 시리즈 중, 실험적인 쿠튀르 피스를 전개해온 라벨 ‘BUY IT IF YOU CAN’이 서울패션위크를 맞아 <a href="https://www.instagram.com/kimhekim_store/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">김해김 청담 플래그십</strong></a>에서 재조명된다. 진주, 리본, 하트와 같은 상징적인 요소는 김해김 특유의 감성을 또렷하게 드러내며, 헤어를 활용한 디테일과 빈티지 아카이브를 재해석한 작업을 통해 과거와 현재를 자연스럽게 연결한다.

<br>
Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0_00_00_12_53930e93d3.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1_7e099328e9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00000003_9714f3f89c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0002_a8968c139d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0000004_87308d71e3.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_e53c16b079.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111_1_c47baa1c2f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0000007_ba7c105998.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3413/news/', 'published'),
('파리 패션 위크 FW26 스트릿 스타일', '<PAP>가 담아온 파리 패션 위크 현장 공개', 'pfw-fw26-street-6', '2026-02-02', 'Fashion', '["STREETFASHION","2026","PARISFASHIONWEEK"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09828_7d47f1bf96.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_80d6ebd2f0.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">PARIS FASHION WEEK FW26 STREET STYLE</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/anna_trmnn/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Anna</strong></a></p>

<br>

<br>

<p style="text-align:left;">

파리 패션 위크의 쇼장 앞은 언제나 런웨이보다 먼저 움직인다. 옷은 설명되지 않고, 태도는 말없이 드러난다. 과장된 실루엣과 몸에 밀착된 긴장감, 보호와 노출이 교차하는 순간들. 이들은 컬렉션을 기다리는 관객이 아니라, 이미 스타일을 선택한 존재들이다. PAP가 포착한 쇼장 앞의 얼굴들, 그리고 빼놓을 수 없는 착장들의 디테일까지. 슬라이드를 넘기며 지금 확인해볼 것.

<br>
Credit. PAP : &#64;anna_trmnn

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09743_06a141f0db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_00032_0f2c898b10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_00118_a9529c5f90.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09990_9ffc32e238.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09864_acda79cc81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_00152_a37762ccff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09779_533a3af445.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09932_80f0deae9d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09616_90179a4b00.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_09828_d591d4d1f6.jpg"]'::jsonb, '[]'::jsonb, 'pfw-fw26-street', 'published'),
('여전히 파리 패션 위크에 머물러 있다', '에디터가 포착한 파리의 프레젠테이션 신', 'categoryfashion3410news-7', '2026-01-30', 'Fashion', '["PARISFASHIONWEEK","PRESENTATION","2026","FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_1186_2_584ff6bab8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0bed00177c.png', '<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>
<center>

</center>
<center>

</center>
<center>

</center>
<br>

<p style="text-align:left;">

런웨이에서는 맨즈웨어들이 각자의 언어로 정면 승부를 벌이고, 프레젠테이션 현장에서는 시즌이 말하고자 하는 메시지가 보다 명확한 형태로 드러난다. 마네킨 위에 룩을 얹고 해석을 맡기던 방식에서 벗어나, 퍼포먼스와 움직임으로 세계관을 전달하려는 시도 역시 같은 흐름 위에 있다. 결국 컬렉션은 더 이상 정지된 오브제가 아니다. 슬라이드를 통해 에디터가 포착한 파리의 프레젠테이션 신을 따라가본다.

<br>
Credit. PAP

</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/3410/news/', 'published'),
('저 걸렸어요! 로로피아나 차원이 달라병 걸렸어요', '로로피아나 2026 봄 여름 컬렉션', 'categoryfashion3404news-8', '2026-01-28', 'Fashion', '["로로피아나","LoroPiana"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/123_0909588363.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/234_88fc82df3b.png', '<center>

</center>

<center>

</center>

<center>

</center>

<center>

</center>

<br>

<p style="text-align:left;">

계절의 흐름을 따라 색과 질감의 변주를 섬세하게 풀어낸 <a href="https://www.instagram.com/loropiana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">로로피아나</strong></a>의 2026 봄 여름 컬렉션. 캐시미어와 실크, 메리노 울이 만들어내는 부드러운 텍스처 위로 샌디 베이지와 크림 톤이 블렌딩되며, 레드와 터쿼이즈 같은 선명한 컬러가 시즌에 생기를 더한다. 섬유 하우스로서의 유산과 정교한 장인정신이 색채의 깊이를 완성한 것.

<br>
여성 컬렉션은 흐르는 듯하 실루엣으로 우아함을 강조하고, 남성 컬렉션은 자연스러운 테일러링으로 편안한 품격을 드러낸다. 마렘마 재킷과 트래블러 같은 아이콘은 새로운 소재와 비율로 재해석되기도. 도시와 휴양지의 경계를 넘나드는 이번 컬렉션은 절제된 세련미 속에 로로피아나가 지향하는 현대적 라이프스타일을 담아내고 있다.

<br>
Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/123_fa7bc06518.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/123e_64156cc7be.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_0_00_00_00_e88a62c8e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/112_6d9cc10c7a.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3404/news/', 'published'),
('여전히 보헤미안, 여전히 이자벨 마랑', '이자벨 마랑 SS26 컬렉션', 'categoryfashion3403news-9', '2026-01-27', 'Fashion', '["ISABELLEMARANT ","이자벨마랑"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_00_01_24_e41fd0eefa.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/123_650f7402cf.png', '<br>

<p style="text-align:left;">

태양에 물든 방랑자의 무드를 담아낸 <a href="https://www.instagram.com/isabelmarant/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이자벨 마랑</strong></a>의 SS26 컬렉션. 보헤미안의 여유와 유틸리티 요소가 어우러지며 워싱 실크, 저지, 크로셰, 카고 팬츠, 경량 재킷, 비대칭 드레이프 드레스 등으로 자유로운 실루엣을 완성했다. 햇빛에 바랜 듯한 컬러 팔레트와 자수, 비즈 프린지, 자연 질감을 닮은 주얼리는 컬렉션 전반에 장인적 디테일과 여행의 정서를 더한다.

<br>
브레이디드 디테일과 실용적인 실루엣으로 데일리 보헤미안 시크를 제안하는 마이아 백, 아이코닉 베켓 스니커즈, 호보 소프트 백도 함께 주목할 것.

Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1ca4599823.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_c46bbbdc4d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_06bc2e628f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/345_51f9577739.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_2bc68f5ce0.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5d7f541824.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_00_00_12_d4c7794039.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_01_25_7008cf1d67.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a85643b6c2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_834c7caecc.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3403/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('파리패션위크 FW26 DAY 6', '사카이, 우영미, 더블렛, 타크, 자크뮈스', 'categoryfashion3409news-10', '2026-01-25', 'Fashion', '["PARISFASHIONWEEK","2026","FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_699bda9c9f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b9d3f820a6.png', '<br>

<p style="text-align:left;">

사뭇 가벼운 발걸음으로 신이 났던 <a href="https://www.instagram.com/jacquemus/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">시몬 포르테 자크뮈스</strong></a>의 모습처럼, 파리는 다시 한번 황홀경의 런웨이를 마쳤다. DAY 6을 맞아 에디터가 마주한 컬렉션의 중심에는 결국 ‘테일러링’이 있다. 남성복이 도달하는 가장 명확한 지점이자, 일주일의 흐름이 귀결된 언어다. 슬라이드를 넘기며 파리 남성 패션 위크, 긴 여정을 마친 쇼들의 면면을 지금 바로 확인해보자.

<br>
Credit. PAP, VogueRunway, Sacai, Jacquemus

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3421870ce4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_174fecb0c5.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_32661eae3c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c672df6220.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1ff3d872f9.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3409/news/', 'published'),
('파리패션위크 FW26 DAY 5', '키코 코스타디노브, 마리아노, 지기 첸, Y-3, 키드수퍼, 에르메스', 'categoryfashion3408news-11', '2026-01-24', 'Fashion', '["PARISFASHIONWEEK","2026","FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_853823b060.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0da99df291.png', '<center>

</center>

<center>

</center>
<br>

<p style="text-align:left;">

어느덧 5일 차에 접어든 파리 남성 패션 위크는 각자의 사연을 꺼내 보이기 시작했다. 인생의 절반 이상을 바친 디렉터의 헌사부터, 크록스를 스니커즈로 재해석한 집요한 실험까지. 오늘은 새로움보다 축적된 시간과 선택의 이유가 더 또렷하게 남은 하루였다. 슬라이드를 넘겨, DAY 5에 쌓인 이야기는 물론 에디터가 선별한 쇼의 디테일을 이어서 확인해보자.

<br>
Credit. PAP, Y-3, VogueRunway

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_c9eabb5c01.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7bb91df2a1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_7c191452b9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_33e747d75f.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3408/news/', 'published'),
('파리패션위크 FW26 DAY 4', '준야 와타나베, 준지, 메종 미하라 야스히로, 윌리 차바리아, 꼼 데 가르송 옴므 플러스, 루이스 가브리엘 노우치', 'categoryfashion3407news-12', '2026-01-23', 'Fashion', '["PARISFASHIONWEEK","2026","FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_07af7d0533.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_093964218d.png', '<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<br>

<p style="text-align:left;">

시간은 길어졌고, 무대는 더 집요해졌다. 30분간 이어진 <a href="https://www.instagram.com/willychavarria/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">윌리 차바리아</strong></a>의 공연형 런웨이는 옷을 넘어 신체와 집단의 에너지를 전면에 세웠고, <a href="https://www.instagram.com/louisgabrielnouchi/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이스 가브리엘 노우치</strong></a>는 OnlyFans 협업을 통해 관능을 노출이 아닌 선택의 문제로 이동시켰다. 오늘의 파리는 무엇을 보여줬는가보다, 어디까지 밀어붙였는가가 분명했던 날. 슬라이드를 넘겨 DAY 4의 장면들을 이어서 만나보자.

<br>
Credit. PAP, WILLY CHAVARRIA

</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/3407/news/', 'published'),
('파리패션위크 FW26 DAY 3', '아미리, 릭 오웬스, 요지 야마모토, 나미아스, 드롤 드 무슈, 시스템, 이세이 미야케', 'categoryfashion3406news-13', '2026-01-22', 'Fashion', '["PARISFASHIONWEEK","2026","FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b9d4298ea8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bfdd2b2230.png', '<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<br>

<p style="text-align:left;">

<a href="https://www.instagram.com/amiri/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아미리</strong></a>, <a href="https://www.instagram.com/rickowensonline/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">릭 오웬스</strong></a>, <a href="https://www.instagram.com/yohjiyamamotoofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">요지 야마모토</strong></a>, <a href="https://www.instagram.com/nahmias__/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나미아스</strong></a>, <a href="https://www.instagram.com/droledemonsieur/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">드롤 드 무슈</strong></a>, <a href="https://www.instagram.com/system__1990/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">시스템</strong></a>, 그리고 <a href="https://www.instagram.com/isseymiyakeofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이세이 미야케</strong></a>가 교차한 파리 패션 위크 DAY 3. 침묵은 길어졌고, 움직임은 더 느려졌다. 소리를 키우는 대신 긴장을 눌러 담으며 전진한 하루였다. 과장은 사라지고 제스처는 더욱 선명해졌으며, 달리기보다 멈춤이 강했고 설명보다 태도가 앞섰다. 무엇을 만들었는가보다 어떤 방식으로 공간을 점유했는지가 오래 남는다. 슬라이드를 넘겨 DAY 3의 압축된 순간들을 이어서 확인해볼 것.

<br>
Credit. PAP, ISSEY MIYAKE

</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/3406/news/', 'published'),
('파리패션위크 FW26 DAY 2', '3.PARADIS, 르메르, 디올 옴므, 에곤랩, 월터 반 베이렌동크, 펑첸왕, 송지오, 아미', 'categoryfashion3405news-14', '2026-01-21', 'Fashion', '["PFW","2026","FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6a7252aecd.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_ab3a784b83.png', '<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>
<br>

<p style="text-align:left;">

<a href="https://www.instagram.com/waltervanbeirendonckofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">월터 반 베이렌동크</strong></a>는 바이크를 타고 런웨이를 질주했고, <a href="https://www.instagram.com/3paradis/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">3.PARADIS</strong></a>는 에이미 와인하우스를 부르짖었다. 치열한 파리 패션 위크 DAY 2에는 각자의 태도와 제스처가 충돌하며 하루를 밀어붙였다. 과장과 절제, 속도와 정적이 교차한 그 사이에서 <a href="https://www.instagram.com/lemaire/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">르메르</strong></a>, <a href="https://www.instagram.com/dior/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디올 옴므</strong></a>, <a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>, <a href="https://www.instagram.com/fengchenwang/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">펑첸왕</strong></a>, <a href="https://www.instagram.com/egon_lab/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에곤랩</strong></a>, <a href="https://www.instagram.com/amiparis/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아미</strong></a>까지 서로 다른 선택들이 같은 시간대에 겹쳐졌다. 무엇을 입혔는가보다, 어떻게 등장했는가가 더 또렷했던 날. 슬라이드를 넘겨 DAY 2의 장면들을 이어서 확인해볼 것.

<br>
Credit. PAP, Dior, LEMAIRE, VogueRunway

</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/3405/news/', 'published'),
('파리패션위크 FW26 DAY 1', '오라리, 루이 비통, 에뛰드 스튜디오', 'categoryfashion3402news-15', '2026-01-21', 'Fashion', '["LOUISVUITTON","AURALEE","ETUDESSTUDIO","PFW","parisfashionweek","파리패션위크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_34e26825c6.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_4ad6691f81.png', '<br>

<p style="text-align:left;">

파리 패션위크 DAY 1은 각기 다른 결로 남성복의 현재를 풀어낸 브랜드들이 강한 인상을 남겼다. <a href="https://www.instagram.com/louisvuitton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이 비통</strong></a>은 ‘Timeless’라는 이름 아래 클래식 테일러링에 기술적 기능성을 결합했다. 퍼포레이션 크로커다일, 반사 자카드, 리버서블 아우터 등은 익숙한 실루엣을 유지한 채 실용과 정교함을 동시에 끌어올린다.

<br>
<a href="https://www.instagram.com/auralee_tokyo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오라리</strong></a>는 가볍고 단정한 외형 속에 캐시미어, 울, 알파카 등 텍스타일의 밀도로 겨울의 본질을 드러냈고, <a href="https://www.instagram.com/etudesstudio/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에뛰드 스튜디오</strong></a>는 클래식한 실루엣을 비틀린 비율과 레이어링으로 재해석하며 실험적인 표면 처리로 긴장감을 더했다. 파리 패션위크의 첫날은 소재, 구조, 실루엣을 통해 하우스들이 이야기 하고자 하는 바를 분명히 남기고 있다.

<br>
Credit. PAP, LOUIS VUITTONE, AURALEE, ETUDES STUDIO, VogueRunaway, Stylenotcom, RiveltonAlbinoSilva

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11111_b28f2a9e19.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111_be4985d7df.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0222_a8e9e590a9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0333_55fb691e06.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3402/news/', 'published'),
('밀란패션위크 FW26 DAY 3 & 4', '프라다, 조르지오 아르마니, 사울 내쉬, 피디에프', 'categoryfashion3401news-16', '2026-01-20', 'Fashion', '["PRADA","SAULNASH","GIORGIOARMANI","PDF","MFW","MILANFASHIONWEEK"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1234_b5df9a9793.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_becb438426.png', '<center>

</center>

<br>

<p style="text-align:left;">
을씨년한 겨울 유럽 속 패션위크 3-4일 차에 에디터는 그리운 ‘그린’을 찾았다. <a href="https://www.instagram.com/prada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프라다</strong></a>는 접히고 구겨진 실루엣 위에 절제된 컬러감을 얹으며, 생기와 긴장감이 공존하는 그린을 통해 가을 겨울 컬렉션의 감정선을 드러냈다. <a href="https://www.instagram.com/saul.nash/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">사울 내쉬</strong></a>는 스포츠웨어와 수트 사이를 유영하며 기능성과 정체성을 동시에 탐구했고, 그의 컬렉션 속 그린은 움직임과 자유를 상징하는 색으로 작동했다.

<br>
<a href="https://www.instagram.com/pdf.channel/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">PDF</strong></a>와 <a href="https://www.instagram.com/giorgioarmani/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">조르지오 아르마니</strong></a> 역시 각자의 방식으로 컬러의 깊이를 확장했다. 구조와 서사가 분명한 쇼 구성, 부드러운 테일러링과 차콜·그레이 사이로 스며든 그린은 차분하지만 확실한 존재감을 남긴다. 자연, 균형, 회복의 이미지를 품은 이 컬러는 FW26 시즌 남성복 전반에 하나의 공통된 언어처럼 흐르고 있다.

<br>
Credit. PAP, PRADA, GIORGIO ARMANI, VOGUE RUNWAY

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2wqewrfdg_2c17a4b47f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/202048_f8c3887a73.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0a7d5ab68d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00010_4481e4c0db.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3401/news/', 'published'),
('돌체앤가바나 FW26 자세히 만나보기 ', '소재와 디테일의 밀도를 통해 남성복의 서사를 한층 풍부하게 확장하다', 'categoryfashion3400news-17', '2026-01-20', 'Fashion', '["돌체앤가바나","DOLCEGABBANA","DGFW26"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1010202020_71cab723b5.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/010101_6e1d52fb1a.png', '<br>

<p style="text-align:left;">
<a href="https://www.instagram.com/dolcegabbana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">돌체앤가바나</strong></a> FW26 컬렉션은 소재와 디테일의 밀도를 통해 남성복의 서사를 한층 풍부하게 확장한다. 이번 시즌에는 구조적인 실루엣과 권위적인 무드로 현대적으로 재해석한다. 시계로 제작한 벨트와 브로치는 장식과 기능의 경계를 허물며, 남성 액세서리에 대한 새로운 시각을 제시한다. 여기에 나폴레옹 재킷, 페이크 퍼 아우터 등이 더해져 과장된 존재감과 연극적인 분위기를 동시에 완성한다.

<br>
소재 선택 또한 이번 컬렉션의 핵심이다. 깊고 농도 짙은 벨벳부터 밀도 높은 울, 빛을 흡수하는 매트한 실크, 그리고 현대적으로 재해석된 브로케이드까지 폭넓게 사용되며 룩마다 서로 다른 촉감과 온도를 부여하고 있다.

<br>
Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_379132627f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_00_04d_17_5d68960a8e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_00_01_22_0852aeae4e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_00_04_17_85c616adfb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0456y_48b039cfe9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/030303_86473ed7ef.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0101010_2caa428f7c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/202020_f7b268aacc.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3400/news/', 'published'),
('밀란패션위크 FW26 DAY 2', '프로나운스, 셋추, 돌체앤가바나', 'categoryfashion3396news-18', '2026-01-18', 'Fashion', '["MFW","milanfashionweek","밀라노패션위크","셋추","프로나운스","돌체앤가바나","SETCHU","PRONOUNCE","DOLCEGABBANA"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_00_01_28_158a76f497.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6785_5d1a6ed34f.png', '<br>

<p style="text-align:left;">
밀란패션위크 두번 째 하루가 흘러간 오늘, DAY 2의 키워드는 과감함과 개성이었다. 
<a href="https://www.instagram.com/setchu.official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">세추</strong></a>는 일본식 구조를 현대 테일러링에 녹여 직선·비대칭 실루엣으로, <a href="https://www.instagram.com/_pronounce/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프로나운스</strong></a>는 언컨스트럭티드 테일러링과 레이어링, 패치워크로 그들만의 독창적 무드를 완성했다. <a href="https://www.instagram.com/dolcegabbana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">돌체앤가바나</strong></a>는 미니멀과 조용한 럭셔리를 거부하고, 개인의 개성과 장식성을 극대화한 디자인을 선보였다. 각기 다른 세계관과 디자인 철학을 만날 수 있었던 DAY 2. 슬라이드를 넘겨 자세히 만나보자.

<br>
Credit. PAP, VogueRunway

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0_0_0_01_28_00602f5894.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111111111_b4e0e27abc.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9d4c291cb4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3333_adb72cdf85.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3396/news/', 'published'),
('돌체앤가바나 2026 FW 워치 & 주얼리 컬렉션', '파베 다이아몬드 세팅과 바로크 장식을 중심으로 구성됐다', 'categoryfashion3397news-19', '2026-01-18', 'Fashion', '["돌체앤가바나","DOLCEGABBANA"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/135000_933fb264ca.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675555_d48a8f7a6f.png', '<br>

<p style="text-align:left;">

<a href="https://www.instagram.com/dolcegabbana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">돌체앤가바나</strong></a> 2026 FW 워치 & 주얼리 컬렉션은 파베 다이아몬드 세팅과 바로크 장식을 중심으로 구성됐다. 바게트 컷 다이아몬드와 핸드 인그레이빙 다이얼이 반복적으로 등장하며, 장식성과 공예적 디테일을 전면에 내세운다.

<br>
주얼리는 대비감, 크로스 모티프, 바로크 펄, 루비 톤 스톤을 활용해 시칠리아 헤리티지를 강조했고, 시계 역시 기능성보다 주얼리로서의 존재감에 초점을 맞췄다. 이번 프레젠테이션은 워치 & 주얼리를 단순한 액세서리가 아닌, 돌체앤가바나 하이 주얼리 세계관의 일부로 확장하고 있음을 분명히 보여주고 있다.

<br>
Credit. PAP
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_49ea7278b2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_d095f584f2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_fffcc13684.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_174c90e91e.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_4ad70eeeaa.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_7b12286661.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/EDITORIAL_1_aae10f99cf.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_1f5635de47.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3397/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('쿨한 도시남이라면 토즈 FW 2026/27', '컬러와 레이어링으로 완성한 자연스러운 멋', 'categoryfashion3399news-20', '2026-01-18', 'Fashion', '["tods","토즈","mfw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1340_ba0bf97ef2.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9312fd2b10.png', '<br>

<p style="text-align:left;">
<a href="https://www.instagram.com/tods/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">토즈</strong></a>의 26/27 가을 겨울 컬렉션은 삶의 질, 관계, 함께하는 시간을 통해 재해석한 럭셔리를 선보인다. 따뜻한 컬러와 레이어링, 토즈 아이코닉 슈즈가 어우러져 자연스러운 우아함을 완성하며, 장인정신과 현대적 기능성을 조화롭게 담았다.

<br>
힐에 더해진 시그니처 레드 도트 디테일의 레드 도트 스니커즈는 하루의 움직임 속에서도 편안하게 스며드는 실루엣을, 윈터 고미노 앵클 부츠는 절제된 세련미와 품질, 정교한 취향을 강조한다. 또한 이번 시즌에는 토즈가 독자적으로 개발한 프리미엄 스웨이드 소재가 다양한 아이템에 적용되며 그들만의 고급스러운 감각을 한층 업그레이드하고 있다.

<br>
Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000001_a8e5212355.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000002_45efe058c6.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000003_d6278077d4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00005_a14c0b524c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000006_ab442ebcd2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000007_f2bbbaa3bf.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3399/news/', 'published'),
('가장 마음에 드는 에트로의 동물은?', '에트로 FW26/27 남성 컬렉션', 'categoryfashion3398news-21', '2026-01-18', 'Fashion', '["etro","에트로","MFW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_4b7e6f5d4c.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6754_ed423811dc.png', '<br>

<p style="text-align:left;">
가장 마음에 드는 에트로의 동물은? <a href="https://www.instagram.com/etro/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에트로</strong></a> FW26/27 남성 컬렉션은 1997년 캠페인 ‘Animuomini’를 다시 소환하며 인간과 동물의 경계, 본능과 정체성에 대한 서사를 펼친다. 신화와 의식, 퍼포먼스에서 출발한 이 세계관은 정체성을 하나의 구성된 형식으로 바라보며, 에트로 특유의 상징성과 감각을 현재로 끌어온다.

<br>
특히 이번 동물 마스크는 베네치아의 전통 마스크 제작 스튜디오 카르타루가와의 협업으로 제작되었다고. 에트로는 고전과 유희, 이성과 본능 사이를 오가는 이번 프레젠테이션으로 변주 속에서도 변하지 않는 그들만의 본질을 다시 한 번 분명히 드러내고 있다.

<br>
Credit. PAP

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01010_c87ae4673b.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0101_190dccdbdc.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03030303_ab4b3e6df9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/050505_83e1c23f86.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0202_c67c14c4b9.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3398/news/', 'published'),
('밀란패션위크 FW26 DAY 1', '랄프 로렌, 제냐, 디스퀘어드2', 'categoryfashion3395news-22', '2026-01-16', 'Fashion', '["RALPHLAUREN ","ZEGNA ","DSQUARED2","랄프로렌","제냐","디스퀘어드2","밀라노패션위크","밀란패션위크","MFW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_WESD_8ffcd713d1.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/67_U3_6968d4ebd2.png', '<br>

<p style="text-align:left;">
밀란패션위크 첫째 날은 흐린 하늘과 차가운 공기 속에서 시작됐다. <a href="https://www.instagram.com/ralphlauren/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">랄프 로렌</strong></a>, <a href="https://www.instagram.com/zegna/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제냐</strong></a>, <a href="https://www.instagram.com/dsquared2/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디스퀘어드2</strong></a>의 쇼가 연이어 펼쳐지며 각 브랜드의 개성과 무드를 한눈에 확인할 수 있었다.

<br>
랄프 로렌 쇼에서는 클래식하면서도 세련된 실루엣을, 제냐는 현대적 테일러링과 부드러운 컬러 팔레트로 우아함을 강조했다. 디스퀘어드2는 자유로운 에너지와 위트 있는 디테일로 현장의 활기를 더했다. 어쩌면 당신이 놓친 밀란패션위크의 이야기들, 지금 슬라이드를 넘겨 확인해볼 것.

<br>
Credit. PAP, Zegna, Dsquared2, VogueRunway

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/135055_c5e839bed1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_64e227aafb.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0222_47e8ff4d32.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_9fd54a7d0c.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3395/news/', 'published'),
('써네이가 카페를 만든다면?', '밀란 패션위크에서 그 카페가 실제로 등장하다 ', 'categoryfashionlife3394news-23', '2026-01-16', 'Fashion,Life', '["써네이","sunnei"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13500_e4b811e898.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6755_62c8824ba1.png', '<br>

<p style="text-align:left;">
써네이 카페를 만날 수 있다면? <a href="https://www.instagram.com/sunnei/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">써네이</strong></a>가 커뮤니티를 위한 특별한 카페를 오픈해, &#60;PAP&#62;가 그 오프닝 행사에 방문했다. 이번 카페는 밀라노의 힙한 카페 <a href="https://www.instagram.com/goingsgoingsgone/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">고잉즈</strong></a>와 함께 했으며, 방문객들은 미니멀하고 세련된 공간에서 엄선된 커피 혹은 와인 등 고잉즈만의 메뉴를 즐기며 편안하고 친밀한 시간을 보낼 수 있어 특별하다.

<br>
써네이 카페는 오는 토요일까지 오전 9시부터 오후 5시까지 운영되며, 커피와 음료를 중심으로 다채로운 경험을 제공한다.

<br>
&#60;GOINGS X SUNNEI CAFE&#62;
Tuesday–Saturday, 9 AM–5 PM
Via Privata Pietro Cironi 15, Milan

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_1_ff8fd8cebb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_1b807029c4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_2_70521c8efd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_4538b7846e.PNG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_3_51738441a1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_4_75b7fb4aa5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_5_4fcb138037.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_6_f64bbde6c6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sunnei_goingsgoingsgone_PAP_7_9ca1d23c61.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Life/3394/news/', 'published'),
('발렌시아가의 새로운 26 ‘Body and Being’ 컬렉션', '더보이즈 주연을 비롯해 각기 다른 개성과 배경을 지닌 인물들이 참여했다', 'categoryfashion3393news-24', '2026-01-16', 'Fashion', '["더보이즈","주연","발렌시아가","juyeon","theboyz","Balenciaga"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45_88fc283d65.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_09ca19399a.png', '<br>

<p style="text-align:left;">  <a href="https://www.instagram.com/balenciaga/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">발렌시아가</strong></a> 신체 그 자체에 집중한 가을 26 ‘Body and Being’ 컬렉션을 공개했다. 피에르파올로 피치올리는 크리스토발 발렌시아가의 철학을 바탕으로 스포츠와 테크놀로지를 결합하며, 편안함과 움직임을 새로운 럭셔리로 정의한다. 이번 시즌에는 그의 발렌시아가 첫 남성복도 함께 공개된 것이 특징.

<br>
<a href="https://www.instagram.com/tbzuyeon/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">주연</strong></a>을 비롯해 각기 다른 개성과 배경을 지닌 인물들이 참여했으며, 파리의 거리, 체육관 등 일상 공간에서 촬영된 룩북은 테크웨어와 테일러링, 스트리트와 이브닝의 경계를 허문다. NBA 협업을 포함한 컬렉션은 몸, 삶, 그리고 현대적 태도를 발렌시아가의 언어로 압축하고 있다.

<br>
Courtesy of Brand

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45_78d7e78c3a.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_9_9_9_9_bf3bd30b6d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2222_922275e6e6.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f2b6d31200.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_8_db6e77adb5.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/676767_6ebc6eb109.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45454_5261dd8e80.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_0d916f96d6.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7de0b229cc.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_8_a9be966a06.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_ae162f020c.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3393/news/', 'published'),
('보테가 베네타의 장인 정신을 다시 비추는 ‘보테가 포 보테가스 2025’', '베니스를 넘어 밀라노, 그리고 뉴욕까지', 'categoryfashion3392news-25', '2025-12-09', 'Fashion', '["BOTTEGAVENETA","BOTTEGAFORBOTTEGAS2025","보테가베네타"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_1d0f8c6fbd.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_06a4667f0a.png', '<br>

<p style="text-align:left;">
<a href="https://www.instagram.com/newbottega/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@newbottega</strong></a>

<br>
보테가 베네타가 세 도시의 장인 정신을 다시 비추는 ‘보테가 포 보테가스 2025’를 공개했다. 베니스, 뉴욕, 밀라노에서 활동하는 공방들의 작품을 통해 하우스의 역사적 뿌리와 확장된 문화적 지평을 동시에 조명한다. 실버 도금 글라스, 매듭 디테일의 칵테일 스틱, 베네치아 수제 제본 노트까지, 도시의 숨결이 담긴 오브젝트들이 보테가 특유의 절제된 아름다움 안에서 새롭게 재해석된다.
<br>
1966년 비첸차에서 출발한 보테가 베네타는 베니스와의 깊은 연결을 통해 장인정신을 헤리티지의 중심에 둬 왔다. 이후 뉴욕과 밀라노에서 쌓아온 창의적 네트워크는 하우스의 정체성을 더욱 확장시키며, 이번 컬렉션 역시 아페리티보 문화와 축제 시즌의 무드를 더해 브랜드가 걸어온 길과 앞으로의 방향을 은은하게 제시한다.
<br>
Courtesy of Brand
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_796294cf2f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_6ba1f7714c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_b3fa9c3035.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b0502b3d3b.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_15a9799b10.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_bd20bd31ed.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a3360d5a3c.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3392/news/', 'published'),
('특별한 연말을  위한 단 하나의 케이크', '연말 케이크를 준비한다면 지금 이곳을 주목할 것', 'categoryculture3391news-26', '2025-12-05', 'Culture', '["CUSTOMCAKE ","MISOBAKECAKE","미소바케카케","케이크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_640ad57e0d.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_e4f4a093dc.png', '<br>

<p style="text-align:left;">
<a href="https://www.instagram.com/misobakecake/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">	&#64;misobakecake</strong></a>

<br>
연말 케이크를 준비한다면 지금 이곳을 주목해도 좋다. 홍대에 위치한 미소바케카케는 단순히 예쁜 케이크를 만드는 곳이 아니라, 의뢰인의 기억과 감정을 한 조각의 오브제로 재구성하는 스토리 케이크 스튜디오다. 매장 중심이 아닌 예약 제작 방식으로 운영되며, 모든 디자인은 손규리 디자이너가 직접 사연을 해석해 완성한다.
<br>
케이크 위에 얹힌 감정의 결은 곧 하나의 시각 예술로 확장되고, 기념일이나 선물 같은 특별한 순간을 더욱 의미 있게 만든다. 올해 연말, 마음을 담은 한 조각을 찾고 있다면 미소바케카케가 훌륭한 선택이 될 것.
<br>
Credit. <a href="https://www.instagram.com/misobakecake/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">	&#64;misobakecake</strong></a>

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_bf6b6b34ad.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_5a37f66750.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_c638e8eeab.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_5af99a9be9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_753735dcff.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_d7003fddce.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e98557eae8.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_0307b653b4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_3c7d977751.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_7f4813af6a.png"]'::jsonb, '[]'::jsonb, '/category/Culture/3391/news/', 'published'),
('디올의 아카이브는 지금도 움직인다', '크리스챤 디올과 마리아 그라치아 치우리, 킴 존스까지', 'categoryartfashion3390news-27', '2025-11-18', 'Art,Fashion', '["DIOR","UBSHOUSEOFCRAFT"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Behind_the_Scenes_Image_1_171c4bf946.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0119742725.png', '<br>

<p style="text-align:left;">
뉴욕에서 큰 반향을 남긴 ‘UBS House of Craft x Dior’이 싱가포르에서 아시아 첫 공개를 앞둔다. Carine Roitfeld의 큐레이션, Brigitte Niedermair의 렌즈 위에서 디올의 시간은 다시 정렬된다. 크리스챤 디올에서 마리아 그라치아 치우리 그리고 킴 존스까지. 80년의 아카이브는 과거가 아닌 현재형 움직임으로 제시된다.
</p>
<br>

<br>

<p style="text-align:left;">
이는 브랜드 회고가 아닌, 쿠튀르가 시대 속에서 어떻게 다시 번역되고, 다시 존재를 갱신하는가에 대한 질문. 전시는 11월 21일부터 23일까지 싱가포르 New Art Museum에서 무료 공개되며, 패널 토크와 워크숍 같은 참여형 프로그램이 이어진다. UBS와 Dior이 공유하는 정확성, 장인정신, 그리고 유산을 지금의 감각으로 다시 꿰는 태도가 전시의 근간을 이룬다. 이제, 이어지는 이미지를 넘기며 그 질문의 답을 직접 확인할 차례.
</p>
<br>

<p style="text-align:left;">Courtesy of  <a href="https://www.instagram.com/ubs/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@ubs</strong></a></p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Hero_Image_7_f8449d806a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Behind_the_Scenes_Image_12_05f0c6fd8c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Hero_Image_5_bf87c3362e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Behind_the_Scenes_Image_4_931602ed2e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Hero_Image_3_cfe688d5c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_bf58b6deb1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/UBS_House_of_Craft_x_Dior_Hero_Image_1_e02d4fc0f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_61b915b85f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4e79da6a29.png"]'::jsonb, '[]'::jsonb, '/category/Art,Fashion/3390/news/', 'published'),
('이 선글라스 시도할 수 있는 사람?', '뉴욕기반의 헬캣 아이웨어 ', 'categoryfashion3388news-28', '2025-11-17', 'Fashion', '["HELLCATEYEWEAR","STRAPGLASSES","EYEWEAR"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13500_1463eb0727.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6715_9db2cfe3f7.png', '<br>

<p style="text-align:left;">
뉴욕 기반 헬캣 아이웨어는 기존 선글라스의 틀을 깨는 실험적 디자인으로 패션계에서 점점 주목받고 있다. 트래비스 스콧과 협업한 벨티드 선글라스는 머리에 맞게 조절 가능한 스트랩과 벨트 디테일을 결합해 아방가르드한 시그니처로 자리잡았다. 헬캣 아이웨어는 단순한 액세서리를 넘어, 사용자의 개성을 드러내는 오브제로 재해석된다. 형태와 기능, 아방가르드적 감각을 결합한 디자인은 과감하고 도발적이면서도, 그 안에는 장인 정신과 창의적 실험이 녹아 있다. 이들의 선글라스는 패션과 예술 사이에서 독창적 시선을 제시하며 새로운 아이웨어 경험을 선보인다. 또한 헬캣이 수집하는 독특한 아이웨어 아카이브 역시 눈여겨볼 것.

<br>
Credit.  <a href="https://www.instagram.com/hellcateyewear/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@hellcateyewear</strong></a>

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1_e3e09f1327.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/666_1_8475841a05.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/777_1_3407555902.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/888_1_0163136307.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/44444_3473ec87a0.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/233333_94e2ff9eab.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2221_9a59fadbfd.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3388/news/', 'published'),
('테일즈 프레이가 던지는 뒤섞임 이후의 신체', '몸과 드로잉을 핵으로 삼아 장르의 경계를 끊어뜨리는 예술가', 'categoryartculture3389news-29', '2025-11-17', 'Art,Culture', '["#TALESFREY","#ARTWORK"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8c537c5d8e.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3cd14b3791.png', '<center>

</center>

<p style="text-align:left;">몸과 드로잉을 핵으로 삼아 장르의 경계를 끊어뜨리는 예술가, Tales Frey. 무대와 조형, 이미지와 움직임이 뒤섞이는 그 지점에서 그는 늘 당연해 보이던 규범의 틈을 벌린다. 남성과 여성을 넘어, 사람과 사람 그 틈 사이의 의문에 대한 자신만의 해석을 가감없이 표출하는 것.
형태가 무너진 신체들은 인간관계에 대한 다양한 감상을 제시한다. 사회적으로 강제된 정체성 구조에 대해 의심하는가 하면, 마치 질기고도 질긴 인연의 모습을 닮아있기도 하다. 몸의 존재 방식을 시각 언어를 새로 조립해내는 Frey의 표현은 깔끔히 규정되지 않는다. 서로 얽히고 설켰기에, 더욱 복잡한 우리의 생애처럼. 영상을 통해 그의 예술 세계를 감상해보자.
<br></p>

<center>

</center>
<center>

</center>
<center>

</center>
<center>

</center>

<br>

<p style="text-align:left;">Credit.  <a href="https://www.instagram.com/talesfrey/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@talesfrey</strong></a></p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Art,Culture/3389/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('비행기 셀카? 이 가이드를 따를 것', '0.5배 항공샷, 거울 셀카는 이제 너무 흔하다', 'categoryculture3387news-30', '2025-11-17', 'Culture', '["ADAMPOWELL ","PHOTOGRAPHER ","AIRPLANESELFIE"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13502_ae122fa95d.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6752_bf02126412.png', '<br>

<p style="text-align:left;">

비행기 화장실에서 셀피를 남겨본 적 있는가? 0.5배 항공샷, 거울 셀카는 이제 너무 흔하다. 잊히지 않을 독특한 셀피 구도를 찾는다면, 일상의 평범한 장면도 기발한 시선으로 재해석하는 포토그래퍼 애덤 파월의 콘텐츠를 주목해야 할 것.
<br>
최근 그는 비행기 안에서의 셀카를 독특한 구도로 담아 SNS에 연속 공개하며, 일상과 유머, 다소 불손한 감각을 동시에 선보이고 있다. 변기, 좌석, 세면대가 예상치 못한 장치로 활용되며, 그의 사진 속 비범한 시선과 위트가 한층 돋보인다. 이번 시리즈는 단순한 장난을 넘어, 공공장소라는 제약과 사적인 순간 사이에서 벌어지는 긴장과 웃음을 포착한다. 관객은 그의 사진을 통해 비행이라는 익숙한 경험을 새롭게 바라보며, 예술적 감각과 유머가 결합한 현대적 풍자를 체험할 수 있다.
<br>
Credit. <a href="https://www.instagram.com/a_damp_owl/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@a_damp_owl</strong></a>
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Inflight_entertainment_Q1_2025_1_a3f12e6719.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Bored_on_the_plane_and_I_m_on_the_plane_bored_da69a69aba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Bored_on_the_plane_and_I_m_on_the_plane_bored_3_c0a833dcb2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Bored_on_the_plane_and_I_m_on_the_plane_bored_4_d09f0b90a8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/I_am_delighted_to_announce_that_I_am_in_the_airplane_bathroom_1_efbf54d9a7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/I_am_delighted_to_announce_that_I_am_in_the_airplane_bathroom_a05484977c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/I_am_delighted_to_announce_that_I_am_in_the_airplane_bathroom_2_5a60c16b54.jpg"]'::jsonb, '[]'::jsonb, '/category/Culture/3387/news/', 'published'),
('메이크업을 조형적 언어로 표현하다', '메이크업 아티스트 ''허준 시''', 'categorybeauty3386news-31', '2025-11-17', 'Beauty', '["HEJUNSHI ","MAKEUPARTIST","FASHIONEDITORIAL ","VISUALART"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13503_55c75684fb.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6753_8625cf3ccd.png', '<br>

<p style="text-align:left;">
허준 시는 메이크업을 조형적 언어로 다루는 크리에이터다. 밀라노를 기반으로 활동하며 색과 질감, 라인을 극적으로 배치해 캐릭터의 감정과 세계관을 직관적으로 드러내는 방식은 그를 주목받는 아티스트로 자리매김하게 했다. 그의 작업은 단순히 아름다움을 만드는 차원을 넘어서, 메이크업을 ‘내러티브가 있는 오브제’로 확장시키는 데에 있다. 디지털과 아날로그, 실험적 텍스처와 정교한 테크닉을 교차시키며, 패션과 비주얼 아트 사이의 경계를 유연하게 넘나든다. 지금의 허준 시는 얼굴 위에 이야기를 세우는 창작자로서, 더 큰 무대를 향해 자신만의 미학을 뚜렷하게 구축하는 중이다.

<br>
Credit. <a href="https://www.instagram.com/chicherdrink/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@chicherdrink</strong></a>

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/444_97d6f20f31.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_6e0f0615a3.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33333_5d06621f21.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22222_0639fefa7a.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6666_09f9d9f16e.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5555_0b26355af5.png"]'::jsonb, '[]'::jsonb, '/category/Beauty/3386/news/', 'published'),
('사진과 회화의 경계를 넘나들다', '애더레이드 서덜랜드가 표현하는 아름다움', 'categoryart3385news-32', '2025-11-14', 'Art', '["ARTIST ","CONTEMPORARYART","VISUALSTORY","ADALAIDESUTHERLAND"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/135000000000_185e79c900.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_336c22af38.png', '<br>

<p style="text-align:left;">

애더레이드 서덜랜드는 사진과 회화를 넘나들며, 인간이 지닌 내면적 긴장과 몽환적 서사를 시각적으로 끌어올리는 작가다. 그녀의 작품은 늘 어딘가 불안하지만 아름다운 경계에 서 있으며, 빛과 색을 최소한으로 사용해 감정의 결을 더 분명하게 드러낸다. 최근 인터뷰에서 밝힌 바에 따르면, 그녀는 인물의 주변을 둘러싼 ‘보이지 않는 기류’를 포착하는 데 가장 많은 시간을 들인다고 한다. 이는 실제 갤러리 리뷰에서도 그녀의 작업을 ‘정적이지만 숨을 들이쉬게 만드는 그림’이라 평한 기록이 있다.
<br>
또한 서덜랜드는 작품 속 인물의 표정을 일부러 흐리게 처리하는데, 이는 관람자가 스스로 감정의 구멍을 채워 넣게 하기 위한 장치라고 설명한다. 한 평론가는 2024년 여름호에서 그녀의 작업을 두고 “관객을 위한 감정의 빈 의자를 남겨둔다”고 표현한 바 있다. 이러한 시선은 그녀가 단순한 초상화가가 아니라, 감정의 구조를 해체하는 스토리텔러임을 다시 한번 확인시킨다.
<br>
Credit. <a href="https://www.instagram.com/adalaide_sutherland/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@adalaide_sutherland</strong></a>

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/898989898998_996cde7a80.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/454545454_6a02176c80.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/565656_16b28fec97.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3232323_6304ec6ea4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3434_714ec938eb.png"]'::jsonb, '[]'::jsonb, '/category/Art/3385/news/', 'published'),
('현대인 코어 : 365일 매일 울 것', '우리는 왜 흔히 타인에게 ‘행복한 순간’만을 공유할까', 'categoryart3382news-33', '2025-11-13', 'Art', '["LaurelNakadate","365DaysACatalogueOfTears","PerformanceArt"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_ea7cb13602.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_0e5a9b1883.jpg', '<br>

<p style="text-align:left;">
우리는 왜 흔히 타인에게 ‘행복한 순간’만을 공유할까. 로렐 나카데이트는 2011년 작품, ‘365 Days: A Catalogue of Tears’를 통해 1년 동안 매일 스스로 울고 있는 자신의 모습을 촬영하며 그 질문에 답을 던진다. 뉴욕 아파트에서부터 비행기, 기차, 호텔, 어린 시절 집까지 다양한 장소에서 기록된 울음은 눈물을 일상적 의식으로 재구성하며, 울음 직전, 울고 있는 순간, 그리고 눈물을 흘린 직후까지 담아 연출과 실제 경험의 경계를 허문다.

<br>
사진 속 나카데이트의 모습은 단순한 슬픔을 넘어 인간적 취약성과 내면의 고통을 보여준다. 창가에 앉아 빗방울을 바라보는 장면, 비행기에서 고립감을 느끼는 순간, 심지어 속옷을 드러내고 눈물을 참는 모습까지. 그녀의 사진은 관객이 감정을 재경험하고 공감하도록 만든다. (작가는 어떤 날은 자연스럽게 눈물이 흘렀지만, 또 어떤 날은 반려동물을 떠올리거나 슬픈 노래를 듣기도 했다고 전한다. 이 과정조차 우리가 공감하는 순간이 아닐까 싶다.)

<br>
이 작품은 소셜 미디어가 강요하는 행복한 이미지의 규범에 도전하며, 슬픔과 외로움 또한 인간에게 자연스러운 감정임을 상기시킨다. 365일 동안 기록된 나카데이트의 눈물은 단순한 일상의 기록을 넘어, 인간 경험의 진실을 사진이라는 매체로 담아낸 강렬한 예술적 성취가 아닐까.

<br>
Credit. <a href="https://www.instagram.com/365_tears/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">365_tears</strong></a>

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/67_6767_8b81b8a6cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/54545454_4dc62962f1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3434_fd90597fbf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45454_4ea6a5986b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/676767_495994b949.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3323323_93db49884f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8787878_8b59362507.jpg"]'::jsonb, '[]'::jsonb, '/category/Art/3382/news/', 'published'),
('펜싱의 긴장감이 감돌다. 송지오 X 엘리엇 에밀', '송지오와 엘리엇 에밀의 컬래버레이션 ‘DUEL’ 컬렉션', 'categoryfashion3381news-34', '2025-11-08', 'Fashion', '["송지오","엘리엇 에밀","SONGZIO","HELIOT EMIL"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_5ac31e7211.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4f6bf4d920.png', '<p style="text-align:left;">펜싱의 긴장감이 감돌다. 송지오 X 엘리엇 에밀<br><br>
한국 디자이너 브랜드 <a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>가 덴마크 브랜드 <a href="https://www.instagram.com/heliot_emil/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엘리엇 에밀</strong></a>과 협업해 패션, 스포츠, 예술의 경계를 허무는 ‘DUEL’ 컬렉션을 공개했다.<br><br>
펜싱에서 영감을 받은 이번 컬래버레이션은 두 브랜드의 결투를 상징한다. 해당 컬렉션에서는 펜싱이라는 내러티브를 바탕으로 송지오의 아방가르드 미학과 엘리엇 에밀의 산업적 미니멀리즘이 절묘하게 교차하고 있다.<br><br>
또한 펜싱이 지닌 긴장감과 역동성 역시 느껴진다. 펜싱의 날카로운 선과 순간적인 긴장감을 실루엣에 담아, 정지된 상태에서도 움직임을 암시하는 구조적 디자인을 구현했다. 기능성과 예술성을 동시에 담은 해당 컬렉션은 남성 18종·여성 8종 등 총 26종의 제품으로 지금 바로 만나볼 수 있다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_7b02d1df68.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9da776d7fa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0db72cc3ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_dd64926516.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_09b68a4537.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_6096869120.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_6a9a544336.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_6b17b40e86.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_d06ba969f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_049b07417f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3381/news/', 'published'),
('뭔가 다른 ''하우스 오브 에러''의 캠페인들', '런던 기반 레이블 하우스 오브 에러', 'categoryfashion3380news-35', '2025-11-04', 'Fashion', '["HOUSEOFERRORS","HOUSEOFERRORS_VITESSE"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_519b56ed8a.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_236dd38b4e.png', '<center>

</center>

<br>

<p style="text-align:left;">

런던 기반 레이블 하우스 오브 에러가 2025 가을 컬렉션 3, VITESSE를 공개했다. ‘오류’, ‘결함’, ‘비정상’을 주제로 아이덴티티를 과감하게 드러내는 이들은, 실험적 디자인과 스토리텔링에 위트를 더한 독창적인 캠페인으로 주목받고 있다. 스트리트웨어와 하이패션의 경계를 자유롭게 넘나드는 하우스 오브 에러는 오늘도 젊은 컬처 콘텐츠의 흐름 속에서 눈여겨볼 만한 브랜드로 자리매김하고 있다.

</p>

<br><br>

<center>

</center>

<center>

</center>

<center>

</center>

<center>

</center>

<center>

</center>

<center>

</center>

<br>

<p style="text-align:left;">
Credit. <a href="https://www.instagram.com/houseoferrors/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">houseoferrors</strong></a>

</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/3380/news/', 'published'),
('파리 패션 위크 SS26 스트릿 스타일 Part.2', '<PAP>가 담아온 파리 패션 위크 현장 공개', 'pfw-ss26-street-2-36', '2025-06-30', 'Fashion', '["PARIS FASHION WEEK","파리 패션 위크","SS26","STREET STYLE","스트릿 스타일","pfw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4491_737ec3262f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_12d9fab859.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Paris Fashion Week SS26 Street Style Part.2</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/natashadjanphoto/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">NATASHA</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4552_7a72fba75d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4506_492163445d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4491_0240a35567.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4479_83118eeb36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4417_b5dba0bee3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4397_c86f1e14ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4392_cc33a65b5c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4382_0cfc35aef8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4363_a98a8680ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4327_65892b4fbe.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4301_40402af3fa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4288_ff16c44b36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4266_e89d7c8b6a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4236_5aae251970.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3845_d8d660f4e7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3812_bdfd7f1cff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3775_8e66bfb25d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3769_a8cec780f6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3750_32232ed132.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3630_83548d1ed0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3616_9b824631d1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3588_b375fffeeb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3562_92d87c3ca6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3538_40995b7e27.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3533_d23eeac572.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3514_d77e3f2967.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3458_81ce4cc27e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3413_a3d3d7769b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3400_6d068f2aa0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3312_5f7c1ea9b3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3310_2750e2521b.jpg"]'::jsonb, '[]'::jsonb, 'pfw-ss26-street-2', 'published'),
('드롤 드 므슈 SS26 백스테이지 with 파리 패션 위크', '<PAP>가 드롤 드 므슈 백스테이지 현장을 담아왔다', 'pfw-ss26-droledemonsier-backstage-37', '2025-06-30', 'Fashion', '["드롤 드 므슈","Drôle de Monsieur","Backstage","SS26","Paris Fashion Week","백스테이지","pfw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3905_f0fc79919c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_5ffbe90361.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Drôle de Monsieur SS26 Backstage</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/natashadjanphoto/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">NATASHA</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3876_92bb081a7f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3889_141cf59f5a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3890_d830a8bb30.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3891_7c1b58f074.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3905_0429fd8ac8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3908_d45a0b8e71.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3915_7e113c7fb0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3923_3093ee596a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3973_42bd6c88b0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3974_65d4e41c64.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3995_27b7e43a1f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4006_7ca6dbb1d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4028_41a789adee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4037_a65144b820.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4044_1797609c12.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4054_d7ee5df406.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4058_ce921bf23e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4064_5154b17958.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4070_50ef5b1e10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4076_0c5c3f9997.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4101_d16f4fc873.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4112_3dbaf90241.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4126_9e00b6e656.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4132_f81d549816.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4137_68567c029d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4171_cb67e45a9a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4177_cfef388db2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4195_eeea7bb26e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4204_f1101d2a4c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_4207_f0a73e5e87.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3132_89720b19b7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3133_aafb08a59c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3136_45097f8a00.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3139_68c477d39d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3142_bbaa67f33d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3145_b86fdd3211.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3146_fa428058d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3147_abc59334ec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_3148_2f1ed5ff9a.jpg"]'::jsonb, '[]'::jsonb, 'pfw-ss26-droledemonsier-backstage', 'published'),
('파리 패션 위크 SS26 스트릿 스타일 Part.1', '<PAP>가 담아온 파리 패션 위크 현장 공개', 'pfw-ss26-street-1-38', '2025-06-26', 'Fashion', '["SS26","PARIS FASHION WEEK","STREET STYLE","파리 패션 위크","스트릿 스타일","pfw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e51f4b36ae.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_80d212672e.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Paris Fashion Week SS26 Street Style Part.1</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/natashadjanphoto/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">NATASHA</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2161_3ec4280023.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2168_409597a40d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2192_35f869b2f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2200_3e9baaa707.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2209_31b8027bd1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2220_b2591e4927.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2223_9f657e729c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2232_cd489db529.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2241_accf2d39e6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2251_03b95f3730.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2306_d215a59912.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2312_872571494b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2343_b0acb2a530.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2355_19ee242630.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2366_c329f2827c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2370_0ec5419a1f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2408_f8e29546ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2430_df7bfc2483.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2520_a156c30826.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2608_b1bc57214f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2631_f60c613330.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2670_53eda8a2a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2693_3caf708db6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2722_8045f9f7a1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2728_5f2e0acb8b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2751_46a3486153.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2759_fde77b05f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2772_dbbbf63f9d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2783_f9f74285b6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2788_e75e8cc0ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2804_264e288997.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2824_368ee24f51.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2873_ac0b1809e5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_2877_d0f8060b03.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3099_f03ef27fe2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3102_018b00aa23.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3122_58018bc407.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3146_dc843c03a8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3159_37642b6251.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3179_2804396c5c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3216_1640f0eaf1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSCF_3224_bc8f61d8d4.jpg"]'::jsonb, '[]'::jsonb, 'pfw-ss26-street-1', 'published'),
('발코네와 <PAP>가 꾸는 꿈', '발코네 X PAP의 콜라보레이션 에디토리얼,  ‘Dreamt in Another Language’', 'categoryfashion3360news-39', '2025-05-15', 'Fashion', '["Balcone"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_78f1caaf46.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_98c6576d1e.jpg', '<br>

> <p style="text-align:left;">발코네와 PAP가 꾸는 꿈. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/__balcone/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">발코네</strong></a>와 <PAP>의 콜라보레이션 에디토리얼 ‘Dreamt in Another Language’을 공개합니다. 유럽을 기반으로 지속 가능성에 대한 철학과 신진 디자이너 브랜드를 선별하여 소개하는 큐레이션 기반 이커머스 플랫폼인 발코네! </p>

<br>

<p style="text-align:left;">이번 에디토리얼은 고정된 미학을 거부하고 보다 본능적인 리듬을 따르는 몸짓으로 가득합니다. 날 선 실루엣 속에서도 여유는 흐르고, 형태와 온기가 나란히 프레임을 채우는 방식이죠. </p>

<br>

<p style="text-align:left;">규칙에 얽매이기보다는 뉘앙스에 더욱 민감한 세대를 반영하기도 합니다. 기분과 속도 그리고 맥락에 따라 달라지는 우리의 감각처럼 그 변화무쌍함을 자연스럽게 받아들이고자 했습니다.</p>

<br>

<p style="text-align:left;">발코네와 <PAP>가 함께 한 콜라보레이션 에디토리얼을 지금 바로 슬라이드를 통해 확인해 보세요. </p>

<br>

<p style="text-align:left;">Editor. CHO SEO YOUNG </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Photographer: @hansgoh </p>
<p style="text-align:left;">Creative Director & Fashion Stylist: @nazkisnisci</p>
<p style="text-align:left;">Videographer: @dauntlus </p>
<p style="text-align:left;">Fashion: @__balcone </p>
<p style="text-align:left;">Hair and Makeup: @yiqingmua </p>
<p style="text-align:left;">Model: @natasha.fawz </p>
<p style="text-align:left;">Video Production: @dauntlus.studios </p>
<p style="text-align:left;">Photographer Assistant: @cyi_li </p>
<p style="text-align:left;">Assistant & Backstage: @chvrlxne </p>
<p style="text-align:left;">Agency @now_model_management </p>
<p style="text-align:left;">Special thanks to @enfinite.studio and @kangdm </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_f457069210.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_068706eb60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4f218fee28.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_6478db8df7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_29a33f1bda.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_18160ffb59.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_7958c248bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_9a976b0f9f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_081ecb98b1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_6e784dc213.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_a4a618d982.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_fa62606c36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_7136e541cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_2ff10aca9f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3360/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('떠그맛 아디다스 아조씨가 먼저 입어볼게', '아디다스, 떠그클럽, 그리고 추성훈의 만남', 'categoryfashion3356news-40', '2025-05-09', 'Fashion', '["추성훈","아디다스","떠그클럽"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_2418a94a65.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_21516644b4.jpg', '<br>

<p style="text-align:left;">성훈 아조씨 왜 제 통장 가져가요.</p>

<br>

<p style="text-align:left;">섹시야마 <a href="https://www.instagram.com/akiyamachoo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">추성훈</strong></a>이 등판한 <a href="https://www.instagram.com/originals_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아디다스</strong></a>와 <a href="https://www.instagram.com/thug_club/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">떠그클럽</strong></a>의 협업 컬렉션 이미지가 공개됐습니다. 단순한 협업을 넘어 ‘규칙을 깨고, 경계를 넘어서는 새로운 도약’을 선언한 이번 프로젝트. 정제되지 않은 에너지와 직진하는 야성을 스타일로 풀어냈죠.</p>

<br>

<p style="text-align:left;">전설적인 파이터이자 자신만의 길을 걸어온 추성훈은 두 브랜드가 추구하는 날것 그대로의 미학을 보여줍니다. 이번 협업은 아디다스의 아이코닉한 헤리티지에 떠그클럽 특유의 날카롭고 반항적인 감성이 정면으로 충돌하며 새로운 형태로 재탄생했는데요.</p>

<br>

<p style="text-align:left;">과감한 메탈 디테일 실험이 더해진 떠그맛 아디 레이서와 버건디 컬러의 강렬한 슈퍼스타, 카모 트랙팬츠, 떠그클럽 시그니처 로고가 담긴 트랙탑까지. 해당 협업 제품들은 5월 12일부터 아디다스 컨펌드 앱과 온오프라인 샵에서 만나볼 수 있습니다.</p>

<br><br>

<br>

<p style="text-align:left;">아디다스와 떠그클럽의 협업, ''A New Era of Breakthrough'' 주인공은 추성훈.</p>

<br><br>

<br>

<p style="text-align:left;">추성훈은 그 어떤 트렌드보다 오래 살아남은 남자. 나이를 거스르고, 이미지의 틀을 부수며, 여전히 자신만의 방식으로 싸우는 사람이죠. 아디다스 오리지널스와 떠그클럽은 그런 그를 통해 모든 경계를 허무는 자유의 상징을 새로이 새기려 합니다.</p>

<br><br>

<br>

<p style="text-align:left;">아디 레이서가 이렇게 힙했나? 발을 단단히 감싸는 좁고 슬림한 핏과 삼선에 떠그클럽의 메탈 디테일을 더했다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_b34e1d0286.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_1_c1fae1fc64.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_7_7c18cc480d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_8_fef2eafa08.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_9_2ae75d7ae0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_2_0653ca4635.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_6_22df234b39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2025_05_12_4_c5724940da.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3356/news/', 'published'),
('가구 디자이너 신소작의 시선이 닿은 공간과 순간', '오프아우어에서 만난 가구 디자이너 신소작', 'categorylifeculture3349news-41', '2025-04-12', 'Life,Culture', '["가구 디자이너","소작","팝톡","인터뷰","신소작"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_605d3d7d65.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_587c19ea59.jpg', '<p style="text-align:left;">가구 디자인에 누구보다 진심인 남자, 가구 디자이너 신소작을 합정에 위치한 <a href="https://www.instagram.com/offhour.shop/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오프아우어</strong></a>에서 만나봤습니다. 이곳은 그의 감각이 조용히 머무는 최애 플레이스로, 신소작에게 영감을 주는 아이템들이 모여있는 공간. PAP매거진은 오프아우어에서 그의 조금 다른 시선을 함께 들여다보았는데요. </p>

<br>

<p style="text-align:left;">평소 그의 손끝에서 태어난 가구들은 다양한 공간에 녹아들어 각자 자신만의 이야기를 써내려가는 듯한 존재감을 가집니다. 테이블, 의자, 선반, 화장대에 이르기까지 기능성과 독특한 미학을 가진 이 작품들은 단 하나만으로도 공간 전체의 흐름을 바꾸는 역할을 하죠.</p>

<br>

<p style="text-align:left;">쉽게 지나칠 수 있는 작은 단차도 놓치는 법 없고, 물건의 표면이 만들어내는 오묘한 긴장감 등 사소한 요소에도 귀를 기울이는 그. </p>

<br>

<p style="text-align:left;">과연 가구 디자이너 소작의 시각에서 본 이상적인 가구란 무엇이며, 또 그의 마음을 설레게 한 디자인은 무엇일까요? 슬라이드를 넘겨 디자이너 신소작의 이야기를 만나보세요.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 안녕하세요! 자기소개 짧게 부탁드릴게요.</p>

<br>

<p style="text-align:left;"><strong>A.</strong>  안녕하세요, 저는 가구 디자인 및 제작하고 있는 신소작이라고 합니다.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 가구를 디자인할 때 영감은 어디에서 얻나요?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 예전에는 다양한 곳에서 영감을 얻으려 노력했는데, 요즘은 릴레이식으로 제 예전 작업물들에 파생된 영감으로 저만의 길을 걸어가려고 하는 중입니다. 책이나 회화 작업들을 자주 보면서 영감을 얻기도 하구요.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 지금까지 했던 프로젝트 중에 흥미로웠거나 기억에 남는 작업이 있다면?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 조금 독특했던 경험이 있었죠. 클라이언트가 전달주신 ‘자기소개서’에 맞게 직접 상상해서 디자인한 ‘신한박류’ 라는 테이블 입니다. 자신은 어떤 사람이며, 좋아하는 것은 무엇이고, 심지어는 즐겨보는 유튜브까지 상세히 적어주셔서 그에 맞게 제작했습니다.</p>

<br><br>

<center>

</center>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 그럼 이곳(소품샵)을 좋아하는 이유는 무엇인가요?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 이곳은 소품을 콜렉팅하는 감도도 굉장히 좋고, 제가 요즘 접시나 잔 등에 관심이 많은데, 여기서 빈티지한 식기류를 많이 볼 수 있다는 점에 매력을 느껴 자주 방문하는 것 같아요.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 최근 눈여겨보고 있는 디자인 트렌드는 무엇인가요?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 아무래도 AI이지 않을까 싶은데요. 최근엔 저도 AI를 제 디자인에 어떤 식으로 접목할 수 있을까에 대한 고민을 많이 하고 있어요. 아직 실제로 접목해서 가구를 제작해 본 적은 없는데, 3D 모델링이나 AI는 요즘 가장 핫한 기술이어서 꼭 한 번 시도해보고 싶습니다. </p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 친구가 “야, 내 방 인테리어 좀 해줘” 하면 흔쾌히 해주는 편인가요, 슬쩍 피하는 편인가요?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 맞아요, 이런 의뢰 많이 받죠. 그런데 전 솔직히 말씀드리면 안 해줘요 친구들한텐. (웃음) 선물용으로는 가능한데, 아무래도 의뢰처럼 (금전관계로) 엮이면 끝이 좋지 않거든요. </p>

<br><br>

<center>

</center>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 사람들이 지나치기 쉬운 ‘가구의 디테일’ 중, 당신만이 집착하는 부분이 있다면?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 저는 ‘단차’에 신경을 많이 쓰는 편이에요. 마감할 때 가장 중요한 부분이거든요. (단차가 있으면) 가구를 딱 만졌을 때 손끝에서 느껴지는 느낌이 거슬려요. </p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 여기서 ‘단차’란?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 예를 들어, 상판이 이어지는 부분을 일자 형태로 표현하고 싶은데 여기서 약간 어긋나게 되는 부분이 단차인데요. 저는 보통 자기 만족 때문에 이 부분에 신경을 많이 써요. </p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이 세상에 존재하는 가구 중에서 하나를 ‘내가 했어야 했는데!’라고 생각한 게 있다면?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 제가 영감을 받은 가구 중에 게릿 리트벨트의 ‘지그재그 체어’가 있어요. 예전에 제가 본능적으로 그 가구와 비슷하게 작업하려고 했더라고요. 그 때 이 가구는 내가 원조면 좋았을 거라고 생각했었죠. </p>

<br><br>

<center>

</center>

<br>

<center>

</center>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 지금 나의 디자인과 10년 뒤 나의 디자인을 비교했을 때, 어떤 부분이 가장 다를 것 같나요?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 지금의 디자인은 좀 더 무식하고 패기있는 느낌이지 않을까요? 제가 디자인을 하면서 늘 기록을 해두는데, 5년 전의 작품들만 봐도 “이걸 어떻게 만들었지?” 생각이 드는 작품들이 많아요. 아마 그 당시의 패기나 열정이 디자인에 녹아들어서 그런 게 아닐까 싶어요. 제가 10년, 20년 뒤에 제 작품들을 봐도 똑같이 이런 감정을 느끼지 않을까요? </p>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 오늘 여기서 꼭 사고 싶은 아이템이 있다면?</p>

<br>

<p style="text-align:left;"><strong>A.</strong> 제가 저번에 왔을 때는 빈티지 잔을 하나만 구매했었는데, 잔은 아무래도 둘이 같이 부딪혀야 좋으니까요. 쉐입에 의도하지 않은 자연스러운 멋이 묻어나는 이 작은 컵을 구매하고 싶습니다.(웃음) </p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1_75e042a954.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_7372_b8b361a953.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F4_A3815_A_9_F73_434_F_935_B_DE_38607_EDD_8_E_068a52be3b.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_33613bda23.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_7420_2d34259242.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_FB_5_FB_2_E_1_FC_3_40_CE_87_DB_E00_A34_B4_A27_F_8a585e49ed.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_DB_9_B54_76_E2_4_BB_6_BC_51_67_EB_4_CC_46291_4b2242defd.JPG"]'::jsonb, '[]'::jsonb, '/category/Life,Culture/3349/news/', 'published'),
('누군가를 위해서 요리하는 행위, 그게 너무 좋아요', '크리에이티브 컬리너리 스튜디오 Balbosté의 헤드 셰프 여성준과의 인터뷰', 'categorylife3347news-42', '2025-03-28', 'Life', '["Balboste","Yeosungjun","Chef","Paris","발보스테","여성준","셰프","파리"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/balboste_paris_1724088503_3438226023278205922_4174599829_81d914c9e3.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_450433c73a.png', '<p style="text-align:left;">파리에서 가장 감각적인 크리에이티브 컬리너리 스튜디오 <a href="https://www.instagram.com/balboste_paris/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Balbosté</strong></a>. 그곳의 키친을 이끌고 있는 한국인 헤드 셰프 <a href="https://www.instagram.com/yeosungjun/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">여성준</strong></a>, PAP가 Balbosté의 키친 아뜰리에에 방문하여 직접 만나고 왔습니다!</p>

<br><br>

<p style="text-align:left;">프렌치 미슐랭 레스토랑에서 10년 넘게 경력을 쌓아온 그는, 단순한 요리를 넘어 예술을 결합한 새로운 미식 경험을 만들어가고 있는데요. 특히 <a href="https://www.instagram.com/prada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프라다</strong></a>, <a href="https://www.instagram.com/miumiu/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미우미우</strong></a>, <a href="https://www.instagram.com/louisvuitton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이비통</strong></a> 등 수많은 패션 브랜드와 협업하여 크리에이티브한 요리를 통해 브랜드의 정체성을 표현하는 작업을 이어가고 있죠.</p>

<br><br>

<p style="text-align:left;">Balbosté 팀은 마치 다양한 방향으로 쭉쭉 뻗어가는 큰 나무의 줄기처럼, 각기 다른 국적의 셰프들이 모여 자유롭게 아이디어를 주고받으며, 요리뿐만 아니라 공간, 배치, 색감까지 고려해 하나의 예술적 장면을 완성합니다. 그들은 요리란 즉, ‘스토리를 만들어가는 과정’, 그리고 셰프는 그 이야기를 풀어내는 ‘스토리텔러’라고 말합니다.</p>

<br><br>

<p style="text-align:left;">요리에 대한 열정과 사랑이 고스란히 담긴 여성준 셰프의 철학과, 그의 손끝에서 탄생하는 아름다운 작품들. 그 특별한 이야기를 확인해 보세요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">셰프 여성준과 Balbosté와의 인연은 어떻게 시작됐어요?</strong></a></p>

<br><br>

<p style="text-align:left;">제가 당시에 파리 6구에 제가 컨설팅을 하던 레스토랑이 있어요. 그러던 찰나에 샬롯이 인스타로 처음 연락했어요. Balbosté에서 더 큰 규모의 디너를 하고 싶은데, 혹시 인연이 되면 작업을 해봤으면 좋겠다고요. 때마침 샬롯의 어머니가 저희 레스토랑에 식사를 하러 오셨고, 저를 또 한번 셰프로 추천하게 된 거에요. 미슐랭 레스토랑 주방에서 10년 정도 넘게 일을 하다 보니까 그 이상으로 가고 싶은데 그걸 넘으려면 레스토랑에서 벗어나야겠다는 생각이 들더라고요. 레스토랑 산업에서 크리에이티브를 더한 더 넓은 시선을 갖고 싶었어요. 우연히 발보스테랑 만났을 때 되게 좋은 인연으로 발전됐죠.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">타이밍이 딱 맞아떨어졌네요!</strong></a></p>

<br><br>

<p style="text-align:left;">네, 서로 만난 타이밍이 좋았어요. 샬롯은 자기 키친팀을 꾸려줄 헤드 세프가 필요했고, 저는 레스토랑에서 이미 오래 일한 상태여서, 가스트로노미 미슐랭 레스토랑보다는 한 단계 높은, 또 다른 차원의 크리에이션을 해보고 싶었어요. 생각해 보면 이게 인연인가 싶기도 해요. (웃음)</p>

<br><br><p style="text-align:left;"><strong style="color: black;">Balbosté에서의 첫 프로젝트가 ‘Kenzo’였죠? 엄청나게 떨렸을것 같은데.</strong></a></p>

<br><br>

<p style="text-align:left;">부담이 장난 아니었어요. 실패하면 안 됐거든요. 현장에는 Kenzo의 크리에이티브 디렉터 니고, 디자이너들, CEO들과 VIP들이 전부 와 있는 자리이다 보니까 제 입장에선 책임감이 엄청났죠. 무엇보다도 초청된 분들이 음식을 받았을 때 꿈꿀 수 있는 음식이여야 했어요.</p>

<br><br>

<p style="text-align:left;">기대하는 것과는 다르게 파리 주방은 굉장히 한정적이거든요? 미국이나 영국 주방처럼 삐까번쩍하지 않아요. 근데 제 장점이라면 장점이 상황이 어떻든 흘러가는 대로 흘러가요. 딱히 핀잔을 놓거나 핑계를 대거나 그러지 않아요. 그래서 야외 텐트에서 진행됐던 이벤트였음에도 불구하고 익숙하게 진행했어요. 잘 해내야겠다는 부담감이 엄청났지만, 한편으로는 되게 설레기도 했어요. 왜냐하면 머릿속으로 그렸던 작업을 같이 해나갈 수 있는 팀이 있었으니까요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">셰프님과 Balbosté가 함께한 지도  벌써 2년이 훌쩍 넘어가요. 발보스테에서 진행했던 프로젝트 중에서 가장 열정을 쏟아부었던 프로젝트나 메뉴가 있다면요?</strong></a></p>

<br><br>

<p style="text-align:left;">음, 제가 가장 열정을 쏟았던 프로젝트는 ‘Louis 13’라는 럭셔리 코냑 브랜드와의 프로젝트였어요. 정말 오래된 회사 중의 하나인데, 그 올드한 회사가 트랜디하게 탈바꿈 하기 위해서 저희한테 연락한 거에요. 브랜드를 위해서 컬리너리 가이드 라인을 만들어주고 지상 최고의 다이닝 익스피리언스를 만들어달란 요청을 받았어요. “2024년 새로 탈바꿈한 루이 13은 이거다!”를 음식으로 보여줬어야 했던 거죠.</p>

<br><br>

<p style="text-align:left;">저한테 두 가지 어려움이 있었는데, 첫 번째는 유서 깊은 브랜드의 히스토리를 간직하면서도 트랜디하게 변화시키는 것. 두 번째는 코냑이 제조되는 프로세스를 바탕으로 음식을 만드는 것이었어요. 그래서 저희 팀이 직접 코냑으로 향했고, 코냑이 어떻게 제작 되는지 직접 경험해보고, 장인과 대화도 하고, 맛도 보고, 공부도 하면서 일주일 정도 거기서 지냈죠. 올드한 아이덴티티를 새롭게 탈바꿈하되 Balbosté의 크리에이션을 넣는 과정에서 에너지를 제일 많이 썼던 것 같네요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">전 세계 향신료가 모여있는 Balbosté의 보물창고</strong></a></p>

<br><br>

<p style="text-align:left;"><strong style="color: black;">비프 웰링턴 라비올리</strong></a></p>
<p style="text-align:left;">(탑) 비프 라구</p>
<p style="text-align:left;">(미들) 트러플과 지롤 버섯</p>
<p style="text-align:left;">(바텀) 트러플이 들어간 소고기 안심</p>
<p style="text-align:left;">(겉) 피클된 포도 나무 이파리</p>

<br><br>

<p style="text-align:left;"><strong style="color: black;">해바라기 사워도우</strong></a></p>

<br><br><p style="text-align:left;"><strong style="color: black;">Balbosté는 프랑스의 크리에이티브 컬리너리 스튜디오지만, 헤드 셰프는 한국인이에요. 문화적 차이에서 오는 어려움이 있었을 것 같은데.</strong></a></p>

<br><br>

<p style="text-align:left;">저도 그럴 줄 알았는데, 전혀요. 여기서 재밌는 포인트가 하나 있어요. 저는 요리를 시작하면서부터 줄곧 프렌치만 했어요. 프랑스 요리학교를 나오고, 지금까지 일해온 곳들이 레스토랑들이 프랑스 대사관, 프랑스 가스트로노미 아니면 프랑스 미슐랭 레스토랑이에요. 아이러니하게도 제가 선호하는 요리도 프렌치고, 더 잘하는 요리도 프렌치고요. 오히려 저희 팀에 있는 프랑스 친구들이 저한테 프렌치를 배울 정도에요. (웃음)</p>

<br><br>

<p style="text-align:left;">발보스테의 힘 중의 하나는 프랑스를 베이스로 두고 있지만, 저희 팀원 총 20명의 국적이 10개가 넘어요. 벨기에, 스위스, 독일, 미국, 한국, 일본, 사이프러스, 중국, 이스라엘… 그래서 인터네셔널 프로젝트를 할 때 너무 즐거워요. 어느 나라를 가도 다 할 수 있으니까요. 그러다 보니 헤드 세프가 한국인인 게 크게 상관없는 일이에요!</p>

<br><br>

<p style="text-align:left;">저희 팀이 원하는 건 큰 나무거든요. 나무는 각각 다른 줄기를 가지고 있어야 하잖아요. 다른 방향으로 뻗어야 해요. 한 방향으로만 뻗을 순 없어요. 그게 저희가 원하는 가장 이상적인 방향성인 것 같아요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">그렇다면 세프님이 생각하는 프렌치와 한식의 다른 점은 뭐에요?</strong></a></p>

<br><br>

<p style="text-align:left;">음식을 바라보는 시선! 프렌치는 아름다움을 티 내는 데서 우아함이 드러난다고 해요.“우아함과 섬세한 작은 디테일들이 만나 프랑스 요리의 극치를 만든다.”라는 말도 있고요. 반면 한식은 검소한 음식이에요. 내가 고생한 걸 티 내지 않아야 하죠. 제 한식 스승님이자 ‘온지음’ 조리장님이 가장 강조하시는 게 ‘검이불누 화이불치’에요. “검소하나 누추하지 않고, 화려하나 사치스럽지 않다.”라는 뜻이죠.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">셰프가 되기로 결심한 순간이 있을 것 같아요. 구체적인 스토리가 궁금해요.</strong></a></p>

<br><br>

<p style="text-align:left;">음… 솔직히 말하면 이렇다 할 순간은 없었어요. 눈 떠보니까 계속 요리를 하고 있네요 .(웃음) 사실 처음에는 사진 현상소에서 일을 하고 싶었었어요. 필름 카메라를 찍고 암실에서 사진을 현상하는 그 과정이 너무 좋은 거에요. 내 손으로 뭔가를 직접 결과물을 만들어낸다는 게.</p>

<br><br>

<p style="text-align:left;">요리도 똑같아요. 새벽 시장에 가서 계절을 풍부하게 느낄 수 있는 재료들을 구하고, 그 재료들을 가지고 내 손으로 직접 음식을 만들어요. 그리고 음식을 먹는 누군가는 좋은 기억을 안고 돌아가죠. 결국은 사진 현상과 똑같다고 생각해요. 제가 어릴 때 EBS에서 레스토랑 ‘아르페쥬’의 셰프 알랑 파사르에 대한 다큐멘터리를 본 적이 있어요. 프렌치 요리를 하는 과정이 마치 오케스트라 연주같이 너무 우아한거에요. 그래서 이태원에 있는 프렌치 세프가 하는 프렌치 레스토랑에서 일을 하다가 무작정 23살에 프랑스로 왔어요.</p>

<br><br>

<p style="text-align:left;">돌아보니 그냥 저는 요리를 너무 좋아하는 사람인 거에요. 집에서 요리할 때, 요리 얘기를 할 때, 일할 때까지도 행복하고 늘 피곤하지 않았어요. 누군가를 위해서 요리하는 행위, 그게 너무 좋아요. 요리하면서 어떠한 스토리를 써 나갈 수 있다는 사실이 지금도, 앞으로도 요리를 해야겠단 생각을 하게 만들죠.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">늘 새로운 것을 창작해 내야 하는 것. 예술인들의 중요한 숙제이자 숙명이죠. 주로 어디에서 영감을 받곤 해요? 머릿속에만 존재하던 ‘아름다운 것’을 시각적으로 구현해내기까지의 과정이 궁금해요.</strong></a>
</p>

<br><br>

<p style="text-align:left;">굉장히 고통스러운 과정이에요. 무에서 유를 창조해야 하는데, 요리는 존재하지 않는 걸 만들어내려면 직접 해보는 수밖에 없거든요. 정말 답답할 땐 갤러리나 뮤지엄에 가서 배치 구성도를 봐요. 접시를 테이블에 놨을 때 내 음식이 어떤 것에 잘 어울릴지, 여백은 얼마나 남기면 좋을지, 색깔은 어떻게 구성해야 할지 아이디어를 얻어요. 또는 시장에 가기도 해요. 시장에 가서 재료를 보다 보면 자연스러움 안에서 보이는 쉐입이 있어요. 굳이 자르고, 섞고 하지 않아도 오가닉한 쉐입을 찾을 수 있거든요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">Balbosté의 헤드 세프로서 제일 행복했던 순간은 언제였어요?</strong></a></p>

<br><br>

<p style="text-align:left;">매 순간 행복하지만, 가장 행복할 때는 저희 팀원들이랑 다 같이 만든 메뉴가 최종적으로 아름답게 구현이 됐을 때? 그때가 제일 행복해요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">요리를 통해 "이건 꼭 내가 이뤄내고 말겠어”라고 다짐했던 것들이 있었을거에요. 지금까지 이뤄낸 가장 자랑스러운 성취가 있어요?</strong></a></p>

<br><br>

<p style="text-align:left;">아, 하나 있어요! 옛날부터 존경하던 셰프가 있는데, ‘르네 레드제피’라고 ‘노마''의 총괄 셰프에요. 셰프들의 셰프인데, 그에게 샤라웃을 받은 것. 그가 제 스토리를 리포스팅하고, 저를 팔로잉해 준 것 자체가 제 커리어의 큰 기쁨이었어요. 엄청 뿌듯했고요. “네가 가는 길은 틀리지 않았어”라는걸 증명 받는게 제일 뿌듯하고 보람찬 일이잖아요!</p>

<br><br><p style="text-align:left;"><strong style="color: black;">Balbosté와 셰프 여성준. 2024년 한 해도 쉬지 않고 달려왔어요. 그렇다면 2025년 새해 다짐! 앞으로 이루고 싶은 목표 혹은 도전해 보고 싶은 프로젝트가 있다면요. Balbosté의 헤드 셰프로서, 그리고 사람 여성준으로서 각각 부탁해요.</strong></a></p>

<br><br>

<p style="text-align:left;">헤드 셰프로서는 Balbosté가 요리사의 놀이터가 될 수 있는 환경이 구축됐으면 좋겠어요. 다방면으로 모두에게 인정받는 군단이 돼서 Balbosté를 거쳐가는 셰프들이 프라우드를 느낄 수 있었으면 좋겠어요.</p>

<br><br>

<p style="text-align:left;">또 인간 여성준의 목표는 남들이 하기 싫은 일을 나서서 할 줄 아는, 본받을 수 있는 리더이자, 가족의 행복도 이끌 줄 아는 리더가 됐으면 좋겠어요. 일과 가족, 두 개의 밸런스를 잃지 않으면서 모든 걸 챙길 줄 아는 사람이 되고 싶어요.</p>

<br><br><p style="text-align:left;">Editor. KIM LEE YEON</p>

<br><br>

<p style="text-align:left;">Credit. PAP</p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/yeosungjun_1720998679_3412306702684032966_429258314_e34f3bf7c3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/yeosungjun_1655104076_2859542710353176659_429258314_c2adf8213e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/yeosungjun_1655104076_2859542710571431503_429258314_472134af57.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_f2a3829620.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/dsa_275311dd81.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/das_22f02f4b4e.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/55_ae8eb6d3b0.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/666_cc1d5124f1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/yeosungjun_1717372891_3381891386791520699_429258314_0e947b5dab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/fk_31e341e4ff.png"]'::jsonb, '[]'::jsonb, '/category/Life/3347/news/', 'published'),
('PAP MAGAZINE x VIPERRR — MFW AW25 애프터파티 포토월', '강렬한 룩과 에너지가 어우러진 순간, 그 뜨거운 현장을 지금 공개합니다.', 'papxviperrr-aw25-afterparty-photowall-43', '2025-03-11', 'Fashion,Culture', '["PAP Magazine","fashion week","party","Photowall","팝 매거진","파티","클럽","포토월","패션위크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3df515e936.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f3089959b5.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat; margin: 0px; line-height: inherit;">PAP MAGAZINE x VIPERRR</p>
<p style="text-align:center; font-size: 1.5REM; font-weight:600; font-family: Montserrat; margin: 0px;">MFW AW25 Afterparty Photowall</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_223_b7da08bbf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_240_6e951bee81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_381_97c1ccc8fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_387_cfe35cc4d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_389_bf0eec6668.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_395_d0609842ab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_400_85cec84aa6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_406_7f5c02b03f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_412_15d2665d48.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_376_64a34a0e8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_373_9444508a40.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_362_b74a9310eb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_359_3a3db3f13a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_352_6a8769e342.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_349_5c518085f7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_343_df263ceb39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_340_6532319342.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_334_2107034742.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_331_e6df11174b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_326_f1c0e7526f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_323_08c883c6d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_318_25bd6b553a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_315_cec4fd03a3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_309_a0909663a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_304_b89faa601b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_301_a5ab243a24.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_295_aba4cd3515.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_289_3fc1f8e01a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_285_77d764a3a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_281_6aabd2415d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_277_2d9c4022d9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_275_e846dcd18b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_269_6b98b8b5ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_267_5d1a72dc06.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_264_10bc10a272.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_258_94a70c30aa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_256_aba3f59c7d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_254_52abab10c3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_247_f359a38f57.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_244_c55f5f5932.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_233_b4ed6cf94f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_229_4fbcb43e1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_221_91c664cf1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_218_c7accf41e5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_210_ba90518946.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_207_8223f5368c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_204_39d633fa0b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_197_11c22531f6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_192_096dc262e7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_190_f47c86ba7d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_185_bbadcb5182.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_178_cb7d2fea65.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_172_b91415097f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_159_0d9ee7b805.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_168_9f774b7071.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_166_d7ccd3f328.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_153_5ef8e00554.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_140_27b68a9a53.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_146_fd4ef6a4f7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_149_dcc06adf24.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_127_652367e30d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_137_14c344d78e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_125_b6f6397ea7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_120_1176ff39e2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_117_380e42b820.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_114_d50573dac6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_100_fdfeb7f971.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_102_a30f342912.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_110_f448219ab0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_69_64b0e30ae8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_85_4e772933cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_92_4bda03d3b0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_94_a8df07f023.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_80_7a41480e7a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_64_7bd468358a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_55_8f0bea93e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_60_5a9fdee95b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_39_c2eb101dca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_50_d39aacfe60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_38_584fa008ea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_32_bc787182ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_21_25d78ffcc9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_16_a4cdad249f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_13_f127e742c8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_9_f2041a2aa9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_7_5ea8670743.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_X_VIPER_MFW_AW_25_AFTER_PARTY_PHOTO_WALL_2_6888b08116.jpg"]'::jsonb, '[]'::jsonb, 'papxviperrr-aw25-afterparty-photowall', 'published'),
('PAP MAGAZINE x VIPERRR — MFW AW25 애프터파티의 뜨거운 순간들', '패션과 음악이 하나 된 밤, PAP MAGAZINE x VIPERRR 애프터파티의 생생한 현장을 담았습니다.', 'papxviperrr-aw25-afterparty-44', '2025-03-11', 'Fashion,Culture', '["PAP MAGAZINE","VIPERRR","MFW","AW25","애프터파티","Afterparty","fashion week"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_1fbb1cddab.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_61903f52f8.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat; margin: 0px; line-height: inherit;">PAP MAGAZINE x VIPERRR</p>
<p style="text-align:center; font-size: 1.5REM; font-weight:600; font-family: Montserrat; margin: 0px;">MFW AW25 Afterparty</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/thecobrasnake/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Cobrasnake</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper298_WNY_0170_JPG_7ddd7a8035.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper354_WNY_0583_JPG_d4ad1aea70.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper353_WNY_0574_JPG_f6f2540466.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper351_WNY_0562_JPG_cb956e4b17.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper349_WNY_0554_JPG_be0900e31b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper343_WNY_0495_JPG_3e3b09a687.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper348_WNY_0551_JPG_65ee1f0cf7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper340_WNY_0469_JPG_ad93b22149.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper341_WNY_0479_JPG_c515272bd8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper351_WNY_0562_JPG_839da9d694.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper349_WNY_0554_JPG_55d8643f33.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper348_WNY_0551_JPG_fafbd1407e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper347_WNY_0540_JPG_071218d075.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper345_WNY_0536_JPG_15622ff440.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper344_WNY_0497_JPG_32531e646a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper342_WNY_0485_JPG_36d896a000.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper338_WNY_0453_JPG_16ff94f6ed.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper336_WNY_0447_JPG_ae128d948f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper334_WNY_0443_JPG_e9316e39be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper332_WNY_0428_JPG_12e4567219.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper330_WNY_0423_JPG_d03f2bb790.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper329_WNY_0413_JPG_a43018977b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper323_WNY_0372_JPG_83a8f7e62b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper322_WNY_0356_JPG_2b60fd5d11.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper321_WNY_0348_JPG_1584502926.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper318_WNY_0327_JPG_d9c8d154d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper315_WNY_0310_JPG_52b77bdda8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper313_WNY_0292_JPG_fd8f002e9a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper312_WNY_0290_JPG_8b2b52bb39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper306_WNY_0254_JPG_8eb5ba967a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper305_WNY_0251_JPG_389e1cf3d9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper304_WNY_0244_JPG_1203a1dac5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper303_WNY_0239_JPG_733975fd0c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper302_WNY_0226_JPG_9943e21022.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper301_WNY_0210_JPG_30ef2f3dd0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper300_WNY_0199_JPG_bdc2b7eff7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper297_WNY_0163_JPG_9ffef1c63f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper295_WNY_0104_JPG_14139b545d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper294_WNY_0094_JPG_4c272bfc86.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper293_WNY_0084_JPG_c50c75482c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper291_WNY_0075_JPG_0050763b35.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper290_WNY_0072_JPG_cffeb59bab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper289_WNY_0057_JPG_cb79abab74.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper288_WNY_0053_JPG_5faae41e8a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper287_WNY_0045_JPG_995b2c9d2b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper286_WNY_0040_JPG_ff5f3d057c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper284_WNY_0034_JPG_b9610220af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper282_WNY_0026_JPG_e4a69a7102.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper281_WNY_0024_JPG_ac71e5c4c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper280_WNY_0011_JPG_3014027c99.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper278_WNY_9943_JPG_1678992ab3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper277_WNY_9929_JPG_f41590bd1d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper275_WNY_9890_JPG_9762cc52a8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper273_WNY_9877_JPG_d845380341.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper271_WNY_9866_JPG_a2bf61932b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper270_WNY_9840_JPG_1d2e00e0a7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper269_WNY_9837_JPG_729efd91dc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper267_WNY_9832_JPG_8ef52397e2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper266_WNY_9824_JPG_22d9a35ea5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper264_WNY_9809_JPG_c4cd38ebc6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper263_WNY_9805_JPG_b1e4ce355d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper262_WNY_9794_JPG_fcbf8932fc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper261_WNY_9788_JPG_e2dd192b58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper258_WNY_9775_JPG_c89bc57942.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper257_WNY_9764_JPG_412444dde8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper256_WNY_9756_JPG_25d0af479b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper254_WNY_9748_JPG_58954441da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper252_WNY_9739_JPG_44bce9ce08.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper250_WNY_9730_JPG_b8d59a4a00.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper249_WNY_9725_JPG_339d46dd93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper248_WNY_9723_JPG_55b1b1850d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper247_WNY_9716_JPG_e520fd3b0f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper245_WNY_9707_JPG_b9ae878321.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper244_WNY_9699_JPG_2864636b42.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper241_WNY_9686_JPG_a34e8dd87b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper240_WNY_9684_JPG_38205175bb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper238_WNY_9673_JPG_935e7b0969.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper237_WNY_9669_JPG_0ac4e45dc4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper236_WNY_9662_JPG_f1f8165b13.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper235_WNY_9659_JPG_298f1a1c54.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper234_WNY_9657_JPG_e33f6efba7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper233_WNY_9619_JPG_3db8a82161.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper232_WNY_9616_JPG_b3014351b1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper231_WNY_9612_JPG_fafeaa56a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper229_WNY_9606_JPG_cff89b966c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper228_WNY_9599_JPG_330bc9d457.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper226_WNY_9593_JPG_756e55125b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper224_WNY_9586_JPG_224af3e257.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper223_WNY_9582_JPG_9e0d8d5390.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper220_WNY_9574_JPG_975b950e9f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper219_WNY_9563_JPG_525f244e84.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper217_WNY_9551_JPG_9a6e1be39d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper216_WNY_9544_JPG_3b51f6f555.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper214_WNY_9535_JPG_5eb9e2bfbc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper213_WNY_9526_JPG_e38dd8591a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper207_WNY_9500_JPG_b3794982b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper206_WNY_9494_JPG_8b0ef1cfbc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper195_WNY_9440_JPG_41c8bb67f7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper193_WNY_9422_JPG_026388bdb2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper191_WNY_9411_JPG_c280e854a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper189_WNY_9406_JPG_f88096b71e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper188_WNY_9404_JPG_3d985d8b41.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper187_WNY_9401_JPG_e102c0d50a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper185_WNY_9395_JPG_326a9752df.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper184_WNY_9384_JPG_756c08cf30.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper183_WNY_9383_JPG_a90270db3a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper182_WNY_9378_JPG_07c3c722dc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper181_WNY_9374_JPG_bcab0e7826.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper180_WNY_9360_JPG_536d4ca821.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper179_WNY_9356_JPG_1d94cc888e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper177_WNY_9348_JPG_c804c12f0f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper175_WNY_9342_JPG_1b08e18ac5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper173_WNY_9330_JPG_c920664350.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper172_WNY_9317_JPG_b7b98b1e58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper171_WNY_9304_JPG_4cb366a33b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper166_WNY_9289_JPG_36cfb4a5e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper165_WNY_9285_JPG_4e59015f84.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper164_WNY_9283_JPG_175e45cf4b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper163_WNY_9279_JPG_33b651155e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper162_WNY_9274_JPG_d3abf4e095.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper161_WNY_9270_JPG_b6e4fa8248.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper160_WNY_9267_JPG_1fb1e5cc7c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper159_WNY_9255_JPG_4ea9d67a99.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper157_WNY_9248_JPG_719ae9a274.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper155_WNY_9240_JPG_d3c0f5ed44.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper153_WNY_9235_JPG_00637ccdad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper152_WNY_9234_JPG_7b51bf51f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper150_WNY_9221_JPG_07ee21c2ee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper149_WNY_9219_JPG_47b04c77ab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper148_WNY_9218_JPG_ae7e5ce927.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper147_WNY_9214_JPG_60fb4684cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper146_WNY_9207_JPG_c6a9308150.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper144_WNY_9202_JPG_54cc9064cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper142_WNY_9198_JPG_dba3d96598.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper141_WNY_9194_JPG_2dd1524366.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper140_WNY_9179_JPG_b2c6b16882.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper139_WNY_9166_JPG_da45ad5744.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper138_WNY_9163_JPG_2f1f1f1076.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper137_WNY_9160_JPG_bdfa8f409c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper135_WNY_9146_JPG_b284d93299.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper134_WNY_9142_JPG_3827fc5b4b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper129_WNY_9131_JPG_a49dc8ac4b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper125_WNY_9117_JPG_c703940761.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper121_WNY_9101_JPG_9f8596fa8f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper114_WNY_9080_JPG_963cf7cb52.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper110_WNY_9067_JPG_b211622882.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper109_WNY_9063_JPG_c7c9aad300.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper107_WNY_9050_JPG_b4443ea195.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper106_WNY_9048_JPG_3e53f787de.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper105_WNY_9035_JPG_235f4ac924.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/vippper116_WNY_9086_JPG_4ad9708f60.jpg"]'::jsonb, '[]'::jsonb, 'papxviperrr-aw25-afterparty', 'published'),
('아바바브 FW25 백스테이지 with 밀란 패션 위크', '<PAP>가 아바바브 백스테이지 현장을 담아왔다', 'avavav-fw25-backstage-45', '2025-03-05', 'Fashion', '["AVAVAV","backstage","Milan Fashion Week","백스테이지","아바바브","밀란 패션 위크","FW25"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d1b3f03997.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_52bef7a37e.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">AVAVAV FW25 Backstage</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_1_4cc4653837.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_2_2e6c3dd865.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_4_c8dd27e151.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_5_e6d28f977f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_8_a7ad0df587.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_13_46d4f3fb15.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_15_c746fbda89.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_16_1c857c61a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_19_48f237ab93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_20_e222e6cd29.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_22_e1a667066b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_24_3c63e02afa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_29_761ff054d9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_32_f6a0b84635.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_33_8e481c823b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_34_bb11e2eef1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_36_f16f75cac4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_39_ddf0b497f5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_41_b4c1f2f505.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_45_6ee2a69837.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_46_dd4b8ac8c0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_50_187f464fd5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_52_7fb2a793ad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_55_4f010a08bb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_57_1120c60095.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_60_7566fc5c51.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_61_e4468eb5ab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_65_8e6a94181f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_70_36df5f9551.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_71_b3aacdf8da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_74_f1d4aa7c83.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_75_8082c167db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_77_c5b2746821.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_80_3bcf878189.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_82_de305f935a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_89_2a1f4ee4f4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_91_4182877021.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_95_dd396cd7ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_97_45865891f8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_100_386eaf15e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_103_c1429f5e2b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_108_43d2a8b9a8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_110_da53a391bc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_111_9e2757b99e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_121_6b2bcf9a25.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_122_51a2481b7a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_127_0a979a2a81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_129_da67dcfcfa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_136_9f74df21e9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_146_e1a3960550.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AVAVAV_BACKSTAGE_147_d1c732aea8.jpg"]'::jsonb, '[]'::jsonb, 'avavav-fw25-backstage', 'published'),
('밀란 패션 위크 FW25 스트릿 스타일 Part.2', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-25fw-street-2-46', '2025-03-04', 'Fashion', '["MILAN FASHION WEEK","mfw","25fw","STREET STYLE"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_970fbcfc93.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_adf1a8953f.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Milan Fashion Week Street Style Part.2</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_1_394f3e1a10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_2_ca68087d60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_3_bc97dd4e88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_7_78e8105dfd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_8_562c3f685b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_9_55fd7e6b3b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250227_Street_Style_Part2_13_2be0461a33.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_14_b5beaaa19b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_18_ca514fa030.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_24_43250e849a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_26_f93faaf16c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_29_820bc39a11.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_31_966baf4a40.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_32_ee53118561.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_35_fecbec3b3e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_38_b058544b93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_45_506acfa6d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_47_3f2540b802.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_49_0537db7171.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_52_6039f5ab8a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20250228_Street_Style_Part2_54_bfbcb9a6c6.jpg"]'::jsonb, '[]'::jsonb, 'mfw-25fw-street-2', 'published'),
('아이스버그 FW25 백스테이지 with 밀란 패션 위크', '<PAP>가 아이스버그 백스테이지 현장을 담아왔다', 'iceberg-fw25-backstage-47', '2025-02-27', 'Fashion', '["ICEBERG","Backstage","아이스버그","백스테이지","FW25","밀란 패션 위크","Milan Fashion Week"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_844d8aff54.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_cbf7a334b9.png', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">ICEBERG FW25 Backstage </p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/jessequattro/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Tsai ShihFu</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5306_408bd3ebde.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5299_a375da11a7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5307_44f7021348.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5315_e0b885879d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5317_6504c8b949.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5327_da46d0b34b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5334_551a880128.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5342_f6faf3f027.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5344_38b056b6f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5350_d68615f414.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5353_bcda751049.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5355_2b9e7b9f4d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5361_942df0c810.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5367_78ee37a70b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5368_83c16297c9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5371_1be0307e5b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5375_298b53bad9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5389_22aa578f09.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5401_41c5f03c1e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5406_375da685e2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5410_4c90a10e25.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5422_55faf88d36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5428_46dfa886bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5431_9393b118cd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5436_d093a89e58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5442_e5f3b88c67.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5444_ce1a46d697.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5450_18e49ae0bb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5462_5089b8845e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5467_d1f5dc2ef6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5468_180eb2a4b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5475_abf456a459.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5480_6ec453e6b3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5487_496c04f9f8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5494_3086707548.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5497_b96b8773dc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5504_de8114d50a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5506_9fca9e886c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5508_5563acf654.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5515_58f02c7087.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5530_c27cf9a7d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5533_38bd79bcc5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5538_00608f0862.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5548_fcf22383b0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5551_d8b440381b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5553_840481fbc2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5554_75632bc819.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5561_3ccbe11256.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5566_5a8f299e82.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5573_5c362b8d34.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5577_2ab3da4442.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5582_414bd2e4db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5589_a6867bd902.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5595_b062e50ff0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5597_47f8473244.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/TSF_5600_1bf95584c4.jpg"]'::jsonb, '[]'::jsonb, 'iceberg-fw25-backstage', 'published'),
('밀란 패션 위크 FW25 스트릿 스타일 Part.1', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-fw25-street-1-48', '2025-02-27', 'Fashion', '["mfw","FW25","STREET STYLE","MILAN FASHION WEEK","밀란 패션 위크","스트릿 스타일","구찌","디젤"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5d2a83f22f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_5ee505d5d1.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Milan Fashion Week FW25 Street Style Part.1</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_1_72297e73fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_2_6055bb34b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_3_9f1a087d55.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_4_d326c0997f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_6_4cecd9928c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_7_72142bd336.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_19_d7c17425d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_21_0c8164ff5d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_22_536e045a6e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_23_9a96b3e213.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_25_8e307ea2be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_30_dd3365a59c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_32_4f75653a1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_34_1b21439002.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_35_e2454cdfe7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_38_b572c9373e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_39_ec3593d534.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_50_5ac07276c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_52_d932d428ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_55_d0c8fcc818.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_58_55a30d951c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_60_4e6ceb6850.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_61_d0e2938d9d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_62_290ac28654.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_64_410769d84c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_66_317354cc6d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_68_9a40337a8a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_71_18e160bd64.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_74_f8585fff43.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_75_a9d46c5754.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_76_596ef3def2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_77_133323dd3e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_81_f7a76bfdf9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_82_d0c4c085da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_84_a20d2d7154.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_85_86349e9152.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_88_b11e338246.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_89_edb140885b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_90_6b9a3c23b9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_91_51299e7b6e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_94_50dea79400.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_95_0a0334c1e5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_96_7333bc7dd7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_97_87e68ca3eb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_98_8cf863c929.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_99_218aedd01a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_100_47a62f5ba1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_101_72136f05d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_102_34b652fb38.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MFWSTREETFW_25_WOMENS_8e2c40addc.jpg"]'::jsonb, '[]'::jsonb, 'mfw-fw25-street-1', 'published'),
('세상은 널 필요로 하고 있어', '현 파리내에서 가장 핫한 빈티지 숍 ‘Chez Snow Bunny’ 디렉터이자 창립자 Victoria의 인터뷰', 'categoryfashion3322news-49', '2025-02-20', 'Fashion', '["셰스노우버니","빅토리아","파리","빈티지숍","인터뷰","ChezSnowBunny","Victoria","Paris","VintageShop","Interview"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9593d6f363.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_12_01_05_e51038bebd.png', '<br><br>

<p style="text-align:left;">파리에서 명품을 쟁여오는 일은 이미 촌스러워진 지 오래. 트렌드가 빠르게 변화하는 시대에도 ‘빈티지’만은 꾸준한 사랑을 받고 있죠.</p>

<br><br>

<p style="text-align:left;">파리는 오래된 것의 가치를 새롭게 조명하는 도시이기도 한데요. 특히 파리의 빈티지 숍들은 단순한 ‘중고’가 아닌, 개성과 스토리가 녹아 있는 예술과 같달까요. 단순한 쇼핑 공간만이 아닌, 추억과 시간이 깃든 옷과 액세서리, 가구와 오브제들이 새로운 주인을 기다리는 공간이라고 할 수 있겠네요.</p>

<br><br><p style="text-align:left;">MZ세대 파리지엔느들에게 열렬한 사랑을 받는 한 빈티지 숍이 있습니다. 바로 파리 3구 Temple 역에서 도보로 5분 거리, Dupetit-Thouars 가에 위치한 <a href="https://www.instagram.com/chezsnowbunny/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Chez Snow Bunny</strong></a>.</p>

<br><br>

<p style="text-align:left;">프랑스어로 ‘Snow Bunny의 집’이라는 귀여운 의미를 담고 있는 이 곳은 감각적인 큐레이션과 트랜디한 셀렉 실력으로 현 파리 내에서 가장 Hot하고 Hip한 공간으로 인정받고 있죠.</p>

<br><br>

<p style="text-align:left;">이번 파리 패션 위크 시즌을 맞이하여 PAP에서 Chez Snow Bunny의 중심이자 디렉터를 맡고 있는 <a href="https://www.instagram.com/victoriasapet/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Victoria</strong></a>를 만나봤습니다.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">자기소개 부탁해요.</strong></a></p>
<p style="text-align:left;">안녕하세요. 저는 29살 Victoria에요.</p>

<br><br>

<p style="text-align:left;"><strong style="color: black;">Chez Snow Bunny, 현재 파리지엔느들에게 가장 사랑 받고 있는 빈티지 숍 중 하나에요. 역사적인 그 시작이 궁금해요.</strong></a></p>
<p style="text-align:left;">23살 때 파리에서 시작했어요. 아마도 2017년? 제가 원하는 꿈을 이루기 위해 주말에 셀러로 일하고 있던 공간을 얻어서 Chez Snow Bunny를 시작하게 됐어요. 처음엔 정말 작았어요. 음, 지금 생각해 보면 미친것 같아요. (웃음)</p>

<br><br><p style="text-align:left;">Chez Snow Bunny의 셀렉 피스들을 자세히 들여다보면 한국에서 구하기 어려운 장폴고티에, 존 갈리아노, 마크 바이 마크 제이콥스, 미우미우, 발렌시아가의 2000년대 초반 빈티지 피스들, 그리고 새롭게 떠오르고 있는 Y2K 무드의 런던 디자이너 브랜드 NiiHAi 등의 제품들을 발견할 수 있었습니다.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">맨땅에 헤딩이였네요.</strong></a></p>
<p style="text-align:left;">그래도 마음속에 품고 살던 패션이라는 아름다운 꿈을 이루기 위해선 뭐든 할 수 있었어요.</p>

<br><br>

<p style="text-align:left;"><strong style="color: black;">그런 만큼 처음 시작했던 공간에 대한 애정이 크겠어요.</strong></a></p>
<p style="text-align:left;">시작을 그 작은 공간에서 했었고, 아까 우리가 만났던 곳 있죠? 거기로 매장을 옮긴 지 1년 반 정도 돼가요. 지금은 두 군데 모두 제가 갖게 됐고요. Chez Snow Bunny를 시작했던 공간은 현재 아카이브 창고이자 이벤트나 팝업 행사가 있을 때 렌트를 해주기도 해요. 당장 이번 주 주말에도 클로젯 세일 행사가 잡혀 있는걸요. (웃음)</p>

<br><br>

<p style="text-align:left;"><strong style="color: black;">Chez Snow Bunny는 프랑스어로 ‘Snow Bunny의 집’이라는 귀여운 뜻을 가지고 있어요. 이름은 어떻게 짓게 됐어요?</strong></a></p>
<p style="text-align:left;">2016년에 런던에 사는 사랑하는 제 사촌들이 이 이름을 지어줬어요.</p>

<br><br>

<p style="text-align:left;"><strong style="color: black;">디렉터이자 창립자인 빅토리아의 스타일도 심상치 않아요. 주로 어디에서 영감을 받곤 해요?</strong></a></p>
<p style="text-align:left;">사실 전 원래 메이크업 아티스트였어요. 지금도 여전히 취미로 메이크업을 하고 있고요. 그러다 보니 2000년대 스타일의 아이콘이였던 미국 뮤지션 그웬 스테파니(Gwen Stefani) 그리고 페르기(Fergi)에게서 주로 스타일적 영감을 얻곤 하죠.</p>

<br><br><p style="text-align:left;">Chez Snow Bunny의 시작을 함께했던 애정 깊은 이 공간은 현재 Snow Bunny Collection의 아틀리에 겸 아카이브 창고로 사용되고 있는데요. 공개하지 않았던 귀한 매물들과 빈티지 피스들에 에디터는 마치 Victoria의 보물창고를 들여다보는 기분이였달까요?</p>

<br><br><p style="text-align:left;"><strong style="color: black;">2025년 빅토리아 그리고 Chez Snow Bunny의 계획이 궁금해요.</strong></a></p>
<p style="text-align:left;">Chez Snow Bunny를 더욱 발전시키면서 새로운 매장도 오픈하고 싶어요.</p>

<br><br><p style="text-align:left;"><strong style="color: black;">마지막으로, Chez Snow Bunny를 사랑하는 전 세계의 Diva들에게 짧은 메시지를 전한다면요?</strong></a></p>
<p style="text-align:left;">하고 싶은 것이 있다면 절대 망설이지 말고 시작하세요. "너는 못 할 거야”라는 괜한 말에 휘둘리지 말고요. 돈은 언젠간 돌아오고, 세상은 당신들을 필요로 하고 있으니까요!</p>

<br><br><p style="text-align:left;">Editor. KIM LEE YEON</p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_dc91860979.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_4d4e6a425a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_2_704c030b80.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_efc9efdb03.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_e8d8cdcf69.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_0d8c4ec934.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_1bc83ac40a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_8322170267.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_c9716105c3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_33343b60f7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3322/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('도시 속에서 만나는 여유와 여백, 마르헨제이 스타일 만나보기', '25FW 남성 패션위크 스트릿 현장에서 포착된 ‘마르헨제이’', 'categoryfashion3318news-50', '2025-02-17', 'Fashion', '["MARHENJ","마르헨제이","마르헨제이 가방","여자 가방","ppl","비건브랜드"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_74d1a5b7cc.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_3bf39fae82.jpg', '<p style="text-align:left;">도시 속에서 만나는 여유와 여백, 마르헨제이 
<br><br>
비건 소재에 관심이 높아진 지금. &lt;PAP&gt; 25FW 패션위크 스트릿 현장에서도 국내 비건 패션 브랜드 ''<a href="https://www.instagram.com/marhen.j/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마르헨제이</strong></a>''의 아이템들을 포착했습니다. 
<br><br>
유럽의 거리에서 포착된 로메, 엘리, 사브리나, 안나, 리코 미니 트위드, 트윙클 등 다양한 아이템은 파리지앵 스타일과 자연스럽게 어우러지며 글로벌 감각을 드러냈는데요.
<br><br>
마르헨제이의 시그니처 라인 리코백은 트렌디하면서도 실용적인 디자인으로, 새롭게 선보인 리코 미니 트위드는 클래식한 트위드 텍스처를 더해 세련된 유럽 감성을 담아냈습니다. 여기에 스팽글 디테일과 메탈 장식이 돋보이는 트윙클 백은 유럽 스트릿 패션과 완벽하게 어우러지며 감각적인 스타일을 완성했습니다. 
<br><br>
마르헨제이의 아이덴티티는 단순한 패션을 넘어 비건 패션을 통해 지속 가능한 미래를 제안하는 데 있습니다. 에플레더, 비건레더, 리사이클 나일론 등의 친환경 소재를 활용하며, 스타일과 지속 가능성을 동시에 고려한 디자인을 선보이고 있죠.
<br><br>
이번 파리 패션위크에서 포착된 마르헨제이의 순간들은 단순한 트렌드를 넘어 유럽 패션과의 조화, 지속 가능한 패션의 가능성을 보여주었습니다. 패퍼들도 마르헨제이의 감각적인 아이템들을 <a href="https://www.marhenj.co.kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">공식 웹사이트</strong></a>에서 직접 확인해 보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4edb37a29b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9ff5e7bb93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_af8f57a558.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_2df3aa0e18.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_cf64b45fc1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_eed73e96ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_09c79f965e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_996eac48ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_c5abf6e42e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_bd60a5acf0.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3318/news/', 'published'),
('기다리고 기다리던 송지오의 첫 여성복 컬렉션 런칭', '‘ORCHID(난초)’를 주제로 조기석 작가와 함께 한 이번 우먼 컬렉션 화보', 'categoryfashion3314news-51', '2025-02-14', 'Fashion', '["송지오여성컬렉션","송지오","CHOGISEOK","SONGZIOWOMANCOLLECTION","SONGZIO"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_fc6fca8f0d.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_5fe68d6ea8.png', '<br>

<p style="text-align:left;">송지오의 첫 여성복 브랜드, 드디어 세상에 나오다

<br><br>오늘(14일), 한국을 대표하는 디자이너 브랜드 <a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>가 드디어 첫 여성복 컬렉션을 공개합니다.
<br><br>이번 송지오의 여성 컬렉션 첫 번째 25SS 화보는 세계적인 포토그래퍼 <a href="https://www.instagram.com/chogiseok/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">조기석</strong></a>작가와 협업하여, 글로벌 패션계의 이목을 집중시켰는데요. 
<br><br>이번 화보는 ‘ORCHID’, 즉 ‘난초’를 주제로, 자유롭고 관능적인 여성의 아름다움을 담아낸 작품으로, 단순한 패션 화보를 넘어서 송지오와 조기석의 독특한 세계관을 결합한 예술 작품으로 평가받고 있습니다. 
<br><br>이를 기념해 오는 21일, 송지오의 아트 패션 스페이스 ‘갤러리 느와(GALERIE NOIR)’에서 열릴 런칭 파티에는 국내외 아트신에서 주목받고 있는 현대 미술 작가 <a href="https://www.instagram.com/surin.kim/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">수린</strong></a>의 개인전도 함께 개최돼, 송지오의 디자인 철학인 아트와 패션의 융합을 한눈에 볼 수 있는 기회가 될 예정이라고 하는데요! 
<br><br>송지오의 여성 컬렉션은 서울 플래그십 스토어와 파리 플래그십 스토어, 더현대 서울, 갤러리아 명품관 등 총 4개의 남녀 복합 매장과 7개의 여성 단독 매장에서 만나볼 수 있습니다.
<br><br>패션과 예술의 경계를 허물며 새로운 역사를 써 내려가고 있는 송지오! 그 특별한 여정에 함께 해보세요. 
<br><br>‘송지오 우먼’ 런칭 파티 in GALERIE NOIR
일시 : 2025.02.21 (금) ~ 2025.03.30 (일)
장소 : 갤러리 느와 송지오 (강남구 압구정로 42길 54)

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_161436e1db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_21c57557a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_7bb38232d3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_1166183bb1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1118d1fe10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_35d4265842.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_48ca7740b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_b79c6cc813.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_8326eeec2b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_dc2689b8a8.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3314/news/', 'published'),
('파리의 스트릿을 물들인 캉골 SS25 컬렉션', '파리패션위크 스트릿스타일에 녹아든 캉골의 SS25 라인업', 'categoryfashion3315news-52', '2025-02-14', 'Fashion', '["SS25","캉골"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_58f2e792c7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_df8147c3ee.jpg', '<p style="text-align:left;">캉골이 그린 우리의 일상, 그리고 파리의 거리. 
<br><br>
<a href="https://www.instagram.com/kangolkorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캉골</strong></a>이 선보인 SS25 컬렉션 라인업이 일상은 물론 파리패션위크의 스트릿 스타일까지 물들였습니다. 
<br><br>
특히 라이트한 소재의 ''레트로코어 아노락 파카''와 개성 넘치는 ''레트로코어 바시티 점퍼''는 파리의 스트릿에서도 브랜드만의 정체성을 고스란히 보여주었죠. 여기에 탄탄한 소재감의 ''우먼스 후디드 자켓''과 ''우먼스 플레이드 롱스커트''는 곧 시작될 봄에 간절기 데일리 룩으로 제격. 
<br><br>
백 라인업도 절대 놓칠 수 없는데요. 생활방수와 다양한 수납이 돋보이는 ''레트로코어 스탠다드 스플릿 크로스백''부터 경량 트윌 소재의 ''에센셜 RC 라운드 크로스백'', 귀여운 컬러감의 ''에센셜 RC 플랩 백팩’까지, 실용성과 스타일을 동시에 잡은 아이템들이 파리지앵들의 눈길을 사로잡았습니다. 
<br><br>
현재 캉골 온·오프라인 스토어에서 25SS 가방 20% 쿠폰 프로모션 진행과 함께 2월 28일까지 발렌타인데이를 기념해 온라인 스토어에서 추가 10% 중복 할인 쿠폰도 증정한다고 하니, 다양한 소재감과 사랑스러운 디자인이 담긴 캉골의 룩을 <a href="https://m.kangolkorea.com/category/%EA%B0%80%EB%B0%A9/184/?gad_source=1&gclid=CjwKCAiAh6y9BhBREiwApBLHC_5BzkYJoHG7_p7OL3iSikoPEA14yzZpEeuEG-IAbTEWI-ohU0-jzBoCQogQAvD_BwE#none" style="text-decoration-line:none" target="_blank"><strong style="color: black;">온·오프라인 스토어</strong></a>에서도 만나보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a5eaf02c36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ae722e502a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_c308fd1a73.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_7c299c7a4d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2d9b68040d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_1881ea79da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_145f5e92b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_b4f0c75665.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_da948693ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_001a14b160.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3315/news/', 'published'),
('손나 예쁜 손나은, 데상트의 새 얼굴!', '사복패션 아이콘 ‘손나은’과 프리미엄 스포츠 브랜드 ‘데상트’의 만남', 'categoryfashion3308news-53', '2025-02-05', 'Fashion', '["손나은","데상트","스니커즈"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_edec215695.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6a94a72dfa.jpg', '<br>

<p style="text-align:left;">데상트의 새로운 얼굴, 손나은의 스니커즈 룩! </p>

<br>

<p style="text-align:left;">트렌디한 스타일과 힙한 사복 패션으로 사랑받아온 배우 <a href="https://www.instagram.com/marcellasne_/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">손나은</strong></a>이 <a href="https://www.instagram.com/descente_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">데상트</strong></a>의 새로운 앰버서더로 발탁되었습니다.</p>

<br>

<p style="text-align:left;">특히 이번 시즌 손나은과 데상트가 함께 선보이는 ''엣지코트''와 ''키네틱런'' 스니커즈가 눈길을 사로잡고 있는데요. 클래식한 실루엣의 ''엣지코트''는 어떤 룩에도 자연스럽게 녹아드는 매력을 가졌고, ''키네틱런''은 레이싱 슈즈에서 영감을 받아 편안한 착화감까지 갖췄죠.</p>

<br>

<p style="text-align:left;">손나은의 독보적인 스타일과 브랜드의 스포티한 감성이 만나 새로운 트렌드를 제안할 것이라는 예측!</p>

<br>

<p style="text-align:left;">패퍼들도 그녀의 스타일링을 참고해 데상트 스니커즈로 나만의 룩을 완성해보는 건 어떨까요? </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d1224911b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_317ab4055c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_c16851a03b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4279144f74.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_c733f1e906.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_a9c7e21f1f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e9569e55ec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_513d45cb57.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_5f29489024.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3308/news/', 'published'),
('나나와 만난 르꼬끄는 사랑입니다', '2025년 리브랜딩을 맞이한 르꼬끄의 새로운 앰버서더, 나나', 'categoryfashion3306news-54', '2025-02-03', 'Fashion', '["나나","르꼬끄"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8dab5baf8e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a35feb9560.jpg', '<br>

> <p style="text-align:left;">나나와 만난 르꼬끄는 사랑입니다.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/lecoqkorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">르꼬끄</strong></a>가 2025년 리브랜딩을 맞아 배우 <a href="https://www.instagram.com/jin_a_nana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나나</strong></a>를 새로운 브랜드 앰버서더로 발탁했습니다. </p>

<br>

<p style="text-align:left;">나나와 함께 한 첫 번째 캠페인은 바로 ‘LE BOLD DÉBUT’! 프랑스어로 새로운 시작의 순간을 의미하는데요.</p>

<br>

<p style="text-align:left;">2025년을 여는 ‘헤리티지 선데이 컬렉션’은 이전 대비 스포츠에 뿌리를 둔 헤리티지를 현대적으로 재해석해 스포티함과 개성을 확고하게 드러낼 수 있는 아이템으로 강화한 것이 특징입니다. </p>

<br><br>

<br>

<p style="text-align:left;">세련된 스타일과 당당한 매력으로 2030 여성들의 워너비 아이콘으로 자리 잡은 나나! 그녀의 감각적인 스타일과 르꼬끄의 새로운 비전이 만나 한층 더 생동감 넘치게 완성될 브랜드 아이덴티티가 기대되지 않나요? </p>

<br>

<p style="text-align:left;">르꼬끄의 새로운 컬렉션은 공식 온라인몰과 백화점, 대리점 등 오프라인 매장에서도 만나 볼 수 있다고 하니 절대 놓치지 마세요! </p>

<br>

<p style="text-align:left;">Editor. Cho Seo Young </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Le Coq Sportif </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9330d0245e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_7a3c095271.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_67260b1f79.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_f81dc6c1bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_0a8700c3d8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_204bb55013.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_74d66af45e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_0afa58fcf0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_8b81f36401.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_ccfb28f863.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3306/news/', 'published'),
('포토그래퍼 조기석과 함께 한 송지오의 SS25 ', '‘BRIGHT STAR(성광)’을 주제로 북극성을 쫓는 소년들의 모험을 담아냈다', 'categoryfashion3303news-55', '2025-02-01', 'Fashion', '["송지오","조기석","캠페인","성광"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5e0cb594fb.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b4a5611312.jpg', '<br>

<p style="text-align:left;">포토그래퍼 조기석과 함께 한 송지오의 SS25 캠페인 공개! </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>와 세계적인 포토그래퍼 <a href="https://www.instagram.com/chogiseok/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">조기석</strong></a>이 함께 한 SS25 캠페인이 공개됐습니다. 이번 캠페인은 송지오와 조기석의 세 번째 협업으로, 단순한 패션 화보를 넘어 독창적인 세계관이 결합된 예술 작품으로 완성되었는데요.</p>

<br><br>

<br>

<p style="text-align:left;">‘BRIGHT STAR(성광)’을 주제로 한 이번 캠페인은 별자리 중 가장 밝은 별인 북극성을 쫓는 소년들의 모험을 담아냈습니다. 북극성은 움직이지 않는 영원의 상징이자 희망찬 미래의 원천으로, 소년들의 동경과 순수한 열망을 대변하죠. </p>

<br>

<p style="text-align:left;">송지오의 첫 혼성 컬렉션인 SS25 컬렉션은 지난해 파리 패션 위크를 통해 주목받으며, 남성과 여성의 경계를 허문 독창적 미학을 선보였다는 평을 받은 바 있습니다. 또한, 오는 2월 추가로 여성 화보가 공개될 예정이라고 하네요.</p>

<br><br>

<br>

<p style="text-align:left;">글로벌 패션 시장에서 독보적인 입지를 다지고 있는 송지오의 존재감이 이번 SS25 캠페인을 통해 더욱 분명히 드러나지 않나요? 앞으로 글로벌 패션 하우스로서, 독창적인 비전과 예술성을 바탕으로 송지오가 펼쳐나갈 새로운 가능성이 더욱 기대됩니다!</p>

<br><br>

<br>

<p style="text-align:left;">Credit. SONGZIO</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3100a5cf89.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_18ff1d97bc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_6f18185ce2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8c3a657e19.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_651fde1a0e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2c0d53a9ef.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b1fc97e388.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_aadfd17521.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_835703befd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_75ca14527d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_e2ca724694.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3303/news/', 'published'),
('송지오의 FW25 컬렉션, ‘피카딜’로 완성되다!', 'FW25 파리 패션 위크를 통해 바로크 시대의 미학과 현대적 감각을 결합한 컬렉션을 선보였다', 'categoryfashion3292news-56', '2025-01-27', 'Fashion', '["송지오","songzio","songziowomen","송지오파리","파리패션위크","parisfashionweek"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6267284fa6.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_77f6f5e678.png', '<br>

**<p style="text-align:left;"> 송지오의 FW25 컬렉션, ‘피카딜’로 완성되다! </p>**

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>가 이번 <a href="https://www.instagram.com/parisfashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">파리 패션 위크</strong></a>를 통해 2025 F/W 컬렉션, ‘피카딜’을 선보였습니다. 이번 컬렉션은 화려한 바로크 시대의 미학과 현대적 감각이 결합된 강렬한 서사가 담겼는데요. </p>

<br>

<p style="text-align:left;">이번 컬렉션의 핵심은 바로 ‘피카딜’이라는 역사적인 장식 요소에 있습니다. 계급과 특권의 상징이었던 장식용 옷깃인 피카딜은 송지오의 해석을 통해 현대적 도전과 전위적 정신을 담은 상징으로 다시 태어났죠.</p>

<br><br>

<br>

<p style="text-align:left;">풍성한 볼륨과 과장된 실루엣, 다양한 디테일과 텍스처로 완성된 의상은 정교함과 실험적인 감각이 조화를 이루었으며, 깊이 있는 톤과 강렬한 색감, 핸드페인팅과 자수로 예술성은 한층 더 극대화되었다는 점! </p>

<br>

<p style="text-align:left;">깊이 있고 무게감이 더해진 어두운 장조의 블랙, 그레이, 브라운과 강렬한 생동감을 주는 레드, 버밀리온, 옐로우, 그린 등의 색조로 바로크적 화려함까지 놓치지 않은 모습에서 더욱 눈길이 가지 않나요? </p>

<br><br>

<br>

<p style="text-align:left;">특히 이번 시즌 송지오는 오는 2월 14일 ‘송지오 우먼’ 론칭을 앞두고 남성과 여성 컬렉션을 동시에 선보이며, 패션의 경계를 허무는 새로운 가능성을 제시했습니다.</p>

<br>

<p style="text-align:left;">송지오의 독창적 감성과 예술적 세계관이 담긴 FW25 컬렉션을 통해 전통과 현대가 교차하는 특별한 순간을 느껴보세요. </p>

<br><br>

<br>

<p style="text-align:left;">Credit. SONGZIO </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_657aad50f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_bd9bca2655.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_2977a0ad18.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_6481114c37.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_99ed49ef9d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b7b8caa711.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_3bb56a562d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_8b41fad76b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_9f51fcede2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_58186caa1c.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3292/news/', 'published'),
('푸른 초원 위로 펼쳐진 제냐의 황금빛 컬렉션', '이탈리안 클래식의 진수, 제냐의 25FW 컬렉션 쇼', 'categoryfashion3288news-57', '2025-01-21', 'Fashion', '["밀란패션위크","제냐","25가을겨울","컬렉션","Milanfashionweek","Zegna","25FW","collection"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_e12691aa4c.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_977b42ef6b.png', '<p style="text-align:left;">이탈리안 클래식의 진수, 제냐의 25FW 컬렉션.</p>

<br><br>

<p style="text-align:left;">밀란 패션 위크에서 <a href="https://www.instagram.com/zegna/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제냐</strong></a>의 25FW 컬렉션을 선보였습니다.</p>

<br><br>

<p style="text-align:left;">호주의 푸르른 초원 같은 런웨이 위에서 새로운 ‘벨루스 오리움(Vellus Aureum)’ 라인을 공개했는데요. 신화 속 황금 양털에서 영감을 받은 제냐의 최고급 램스울 컬렉션이죠. 12~13마이크론의 섬세한 양모로 제작된 코트, 슈트, 니트 등은 자연과 장인정신이 완벽하게 어우러진 작품들이었습니다.</p>

<br><br>

<p style="text-align:left;">이번 컬렉션 쇼는 자연과 대지의 색감, 해체와 재구성된 실루엣, 그리고 지속 가능한 소재로 현대 남성복의 새로운 기준을 제시했다고 할 수 있겠습니다.</p>

<br><br>

<p style="text-align:left;">자연스러움 속 세련된 태도를 담아낸 제냐의 고급스러운 25FW 컬렉션. 지금 바로 확인해 보세요.</p>

<br><br><p style="text-align:left;">Editor. KIM LEE YEON</p>

<br><br>

<p style="text-align:left;">Credit. ZEGNA</p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_8ff8059fad.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8059cc42a7.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_e8dbe7aaee.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_ee4341211d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_e470f7a612.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_80d6575ef4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_0c35aa14e1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_64e539c219.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3288/news/', 'published'),
('밀란 패션 위크 FW25 스트릿 스타일', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-fw25-street-58', '2025-01-21', 'Fashion', '["밀란 패션 위크","mfw","fashion","trend","FW25","Milan Fashion Week","2025 fw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7f980f8c70.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4c6f2dfeb8.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">MILAN FASHION WEEK FW25</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0002_9a187e6457.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0003_5efff2ca2d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0054_07401efa3c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0057_15602a262e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0066_753031521b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0075_77dfbf2c45.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0098_a8aa03d681.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0114_3dbb0049ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0119_e619c1e3a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0120_ccb83d58f6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0121_51e5dbfa7f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0125_2_202bc8edf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0135_b84f1b7bce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0155_44d948f752.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0168_9675840566.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0177_2375671d57.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0203_99a55b20e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0222_d3e0f91092.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0244_7456c4e2b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0258_d46dbd5af9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0289_6cfcdb98ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0295_4804efd57c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0300_d3e2ea3287.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0311_854b38dece.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0317_a8e25fb897.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0321_84893d8f22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0367_dbd2f23a5d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0379_cfe7909ddd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0401_dbfe8c2f4e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0406_de49e17dec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0413_14870c220e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0430_4e8bc83900.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0436_9b8a2af6d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0450_048d1510c0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0456_2d5f198800.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0474_3fc65f2d1e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0502_1770ffd2b3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0539_6306ae793d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0542_e222670eac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0553_b49fc18e63.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0560_c66e11ce3f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0574_56124df622.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0589_3a6522acad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0606_14b10077a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0617_78670a4099.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0619_7dd5c409bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0624_911a3854aa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0630_a6f04917d3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0637_d78a2773a5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0653_e825326149.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0656_0ee5446786.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0670_daf4b640fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0676_9bd2bf22d3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0692_58b81b5d80.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0699_f0f6c286ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0709_1a7f469805.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0716_ad602eafc3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0723_8b78e528c6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0732_7200e362d3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0749_c9f7e039e2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0753_2d046ff012.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0759_b3a06a428a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0766_4044b5b2e8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0785_e2fa19c4c1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0818_47838d5db3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0826_e72cf80520.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0828_bb42bdc975.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0833_471c6d8008.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0835_0c3c780d85.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0852_5c8973e0d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0862_75ad83c209.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0868_a703f0507f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0872_3f721ee5c9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0880_7850245e18.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0890_e1cd92c39f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0901_06316f7e3e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0916_15ce7d5350.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0922_3f71297cd8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0923_8a02e307ea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0929_2e69b54241.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0936_c52e507536.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A0948_c9302583b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1184_0ad74e286f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1194_b054922024.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1198_4a6e4b1730.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1209_f4410a2047.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1230_550ca8ad4b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1231_d097025f2a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1236_fe58a66a50.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9609_f182ae5905.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9750_2fda98e9cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9796_397b55eeae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9857_6832c7f364.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9871_68f971ef9f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9885_0e68271bfb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9918_5cf6d308ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9920_36c180f664.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9928_a3015d62c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9943_54ef7bb8c6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9954_b81175aa2a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9958_344cc092cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9962_3bcfdd16e1.jpg"]'::jsonb, '[]'::jsonb, 'mfw-fw25-street', 'published'),
('PRONOUNCE FW25 백스테이지 with 밀란 패션 위크', '<PAP>가 PRONOUNCE 백스테이지 현장을 담아왔다', 'mfw-fw25-backstage-59', '2025-01-20', 'Fashion', '["FW25","Backstage","PRONOUNCE","Milan Fashion Week","백스테이지","밀란 패션 위크","mfw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_829f434538.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_d048663fe9.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">PRONOUNCE</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9278_36e92ff9e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9279_ae9508f2bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9284_cd9096d456.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9290_46cb009537.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9295_e34574f172.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9310_6c764143c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9312_b02bfae6e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9315_b68937c365.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9322_75e0e7bc3d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9329_198a51303a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9335_bfd3a003ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9355_596b4c9fe0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9356_3912745ac2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9362_b8825e8a35.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9372_e9ce961beb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9374_ebb9a31b36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9379_486715f74a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9381_d400327a02.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9383_99c5a1783e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9385_0f43b67021.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9388_9efc325a9c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9393_3779418e7e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9404_a749976b58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9409_b064e7b73c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9411_57355bbc2c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9417_63a1e56526.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9424_aabef4e77f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9425_4bca82c278.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9429_c9f22279ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9434_20e35fed60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9436_27fb49a8bc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9445_fa2444d48d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9449_514de54908.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9452_4b5e8db474.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9453_8e97513033.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9458_733ee713b5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9459_f967d48277.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9461_23752d14dc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9463_f73d48e3b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9464_047fd0a4f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9466_b8128c7076.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9472_14123c7d62.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9481_be0adea6b5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9489_abd3e35fe3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9492_382ea14f2d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9494_e4eabdbb43.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9502_d80f1f0d2b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9504_81974fdb8a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9508_42a4cc9d80.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9511_429f7bc44b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9515_0d97b21031.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9517_ef3813241c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9518_fd5fcf9766.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9537_52407bb97b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9539_3f61eddac8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9542_359c9980bd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9546_d2fa4b0a75.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9550_3571030f5b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9552_e5524b1766.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9554_bfabffa33e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9556_ef375e7060.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9557_2797405436.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9559_f3d2657d07.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9560_7af0808b33.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9562_0f4b410f7c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A9565_f890f849b4.jpg"]'::jsonb, '[]'::jsonb, 'mfw-fw25-backstage', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('젠틀몬스터만의 마법 소녀로 변신한 제니! ', '젠틀몬스터의 새로운 주얼리 컬렉션 팝업 현장에 블랙핑크 제니가 등장했다', 'categoryfashion3283news-60', '2025-01-16', 'Fashion', '["제니","젠틀몬스터","jennie","블랙핑크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3de75b1b30.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6c8ab6d334.jpg', '<a href="https://www.netflix.com/" style="text-decoration-line:none; color: gray;" target="_blank"><p style="text-align:right; font-size: 1rem; color: gray; font-weight:400;">출처 [ Photo_Gentle Monster ]</p></a>
<br>

> <p style="text-align:left;">젠틀몬스터만의 마법 소녀로 변신한 제니! </p>

<br>

<p style="text-align:left;">최근 공개된 <a href="https://www.instagram.com/gentlemonster/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">젠틀몬스터</strong></a>의 새로운 주얼리 컬렉션! 아이웨어와 주얼리를 결합하여 아이웨어의 개념을 확장하고, 새로운 미학적 영역으로 나아가는 시도를 통해 많은 이들의 사랑을 받고 있습니다. </p>

<br>

<p style="text-align:left;">컬렉션 출시를 기념해 전 세계 7개 주요 도시에서 특별한 팝업 공간 또한 마련되었다는 점. 현실과 꿈의 경계를 초월하는 하우스 도산 팝업 공간에 <a href="https://www.instagram.com/blackpinkofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">블랙핑크</strong></a> <a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>가 방문해 더욱 화제를 모았죠. </p>

<br>

<p style="text-align:left;">템플에 주얼리 디테일이 장식된 제품부터 진주 목걸이를 연상시키는 스테이트먼트 피스에 이르기까지 주얼리의 화려함을 통한 젠틀몬스터의 유니크한 미적 감각을 느껴볼 시간입니다. </p>

<br>

<p style="text-align:left;">마치 거대한 보석함 속을 탐험하는 듯한 초현실적 경험을 하고 싶은 패퍼들이라면 지금 바로 하우스 도산으로! </p>

<br><br>

<a href="https://www.netflix.com/" style="text-decoration-line:none; color: gray;" target="_blank"><p style="text-align:right; font-size: 1rem; color: gray; font-weight:400;">출처 [ Photo_Gentle Monster ]</p></a>
<br>

<a href="https://www.netflix.com/" style="text-decoration-line:none; color: gray;" target="_blank"><p style="text-align:right; font-size: 1rem; color: gray; font-weight:400;">출처 [ Photo_Gentle Monster ]</p></a>
<br>

<a href="https://www.netflix.com/" style="text-decoration-line:none; color: gray;" target="_blank"><p style="text-align:right; font-size: 1rem; color: gray; font-weight:400;">출처 [ Photo_Gentle Monster ]</p></a>

<br>

* <p style="text-align:left;">일시 : 2025.01.10 (금) ~ 2025.02.27 (목) </p>
* <p style="text-align:left;">시간 : 11:00AM ~ 9:00PM </p>
* <p style="text-align:left;"> 장소 : 서울시 강남구 압구정로46길 50, 하우스 도산 </p>

<br>

<p style="text-align:left;">Editor. Cho Seo Young </p>

<br><br>

<style>.embed-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; } .embed-container iframe, .embed-container object, .embed-container embed { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }</style><div class=''embed-container''></div>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_2ba7d9620a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_3785666f78.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8c79c1278d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d56f8a3a03.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3283/news/', 'published'),
('2000아카이브스, 뱀처럼 우아하고 강렬하게', '2000아카이브스의 새로운 컬렉션, ''Year of Snake''', 'categoryfashion3272news-61', '2025-01-08', 'Fashion', '["2000아카이브스","뱀","YOS"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0571ec4532.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_78d5e2a040.jpg', '<br>

<p style="text-align:left;">뱀의 해, 새롭게 탈피한 2000아카이브스. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/2000.archives/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">2000아카이브스</strong></a>가 2025년 푸른 뱀의 해를 맞아 ''Year of Snake'' (YOS) 컬렉션을 선보입니다. 이번엔 스페인 포토그래퍼 마리나 벤굿과 미라이모노가 함께해하는 더욱 특별한 캠페인을 준비했죠.</p>

<br>

<p style="text-align:left;">YOS 컬렉션의 주인공은 단연 타투 메쉬 탑과 스타킹입니다. 블랙과 누드 컬러의 메쉬 탑, 3가지 컬러의 타투 스타킹을 만나볼 수 있는데요. 특히 이번 메쉬 탑은 3년 전 가격과 동일하게 출시되어 많은 관심을 받고 있습니다. </p>

<br>

<p style="text-align:left;">칼리 우치스의 앨범 커버로 유명한 마리나 벤굿이 찍은 사진들은 모델을 게임 캐릭터로 표현했다고 하죠. 거침없고 판타지 넘치는 여성들의 모습, 기대되지 않나요?</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/06_1_1884a1d43f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_1_308ed15be1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/08_1_6030b693bb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YOS_03_1080x1350_18d1240ec9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YOS_04_1_1080x1350_e8c6296062.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YOS_06_2_1080x1350_86779277f1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YOS_05_1_1080x1350_b298f412ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YOS_concept_video_Miraimono_Thumbnail_03_3bec00396d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3272/news/', 'published'),
('더우면 ‘툭'' 떼면 돼 모듈형 구스 다운의 등장', '엄브로가 새롭게 선보이는 디태처블 모듈 슛 구스 다운 자켓', 'categoryfashion3254news-62', '2024-12-19', 'Fashion', '["구스 다운","엄브로","umbrokorea","umbro","패딩","down jacket"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_dc370cbac4.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_dc5517f77b.jpg', '> <p style="text-align:left;">Active Detachable Module Short Goose Down Jacket_Green Mustard</p>

<p style="text-align:left;">더우면 ‘툭'' 떼면 돼, 모듈형 구스 다운의 등장
<br><br>
구스다운을 입다가 갑작스러운 기온 변화로 곤란하셨던 적 있으신가요? 입고 있자니 덥고, 벗어 들고있자니 엄청난 부피를 자랑하는 구스다운이 때론 난감하셨을 패퍼들을 위해 <a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>의 모듈형 다운 자켓, 디태쳐블 모듈 숏 구스 다운을 소개합니다.</p>

<br><br>

> <p style="text-align:left;">Active Detachable Module Short Goose Down Jacket_Green Mustard</p>

<p style="text-align:left;">해당 자켓은 기온에 따라 모듈 방식으로 변형이 가능한데요. 후드와 소매를 탈부착해 원하는 스타일을 연출 할 수 있을 뿐만 아니라 2WAY 지퍼 및 생활 방수, 방풍 기능까지 갖춘 똑똑한 구스다운이죠.
<br><br>
리플렉티브 로고를 활용한 야간 안전성과 엄브로만의 HEAT DIAMOND 발열 안감을 적용해 요즘처럼 추운 한파에도 따뜻하고 포근한 착용감을 선사하는 것은 덤!</p>

<br><br>> <p style="text-align:left;">Active Detachable Module Short Goose Down Jacket_Light Grey</p>

<p style="text-align:left;">가실 줄 모르는 추위에 더욱 스마트한 구스다운을 찾고 있다면 지금 엄브로의 디태쳐블 모듈 구스 다운을 엄브로 공식 홈페이지 또는 오프라인 매장을 통해 직접 만나보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_369bba2d4e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_f3dc7fa730.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_ee91f3afcf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_6d97a0358c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_b9ff70d139.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_66fafff854.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_8981454158.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_de8506309f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b7fdde786a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_3f7352eefd.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3254/news/', 'published'),
('뉴진스 다니엘이 오메가의 새로운 앰버서더로 발탁됐다', '앰버서더이자 오메가의 스타 패밀리로 활동할 예정이다', 'categoryfashion3250news-63', '2024-12-17', 'Fashion', '["뉴진스","다니엘","오메가"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5c725a03a2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d38baa0e24.jpg', '<br>

> <p style="text-align:left;">뉴진스 다니엘, 오메가의 새로운 앰버서더로 발탁! </p>

<br>

<p style="text-align:left;">스위스 럭셔리 워치 메이커 브랜드 <a href="https://www.instagram.com/omega/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오메가</strong></a>가 글로벌 그룹 <a href="https://www.instagram.com/newjeans_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">뉴진스</strong></a>의 다니엘을 앰버서더이자 오메가의 스타 패밀리로 맞이합니다. </p>

<br>

<p style="text-align:left;">글로벌 공식 발표 사진에서 스피드마스터 38mm와 컨스텔레이션 타임피스를 착용한 다니엘의 아름다운 모습! </p>

<br>

<p style="text-align:left;">다니엘은 “저에게 오메가는 시간을 상징하는 가장 아름다운 브랜드입니다. 오메가의 시계는 매우 정확할 뿐만 아니라 화려하고 빛이 나며, 저를 저답게 해 주고 다양한 방식으로 제 스타일을 표현할 수 있게 해 줍니다.”라고 앰버서더로 발탁된 소감을 밝혔습니다.</p>

<br>

<p style="text-align:left;">오메가와 다니엘, 앞으로의 여정이 더욱 기대되는 바네요. </p>

<br>

<p style="text-align:left;">Editor. Cho Seo Young </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Omega </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Danielle_Marsh_324_15_38_50_63_001_4_265e39c441.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Danielle_Marsh_324_15_38_50_63_001_05_1438_portrait_V9_4_5_38eec735d8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Danielle_Marsh_131_25_28_60_60_001_06_1662_portrait_5f95a9884d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3250/news/', 'published'),
('아더에러의 10주년 그리고 FUTUORIST', '지난 10년 간의 여정을 담은 새로운 캡슐 컬렉션이 발매된다', 'categoryfashion3246news-64', '2024-12-16', 'Fashion', '["아더에러"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_037f8b4cf1.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_182864c80b.jpg', '<br>

> <p style="text-align:left;">아더에러의 10주년 그리고 FUTUORIST</p>

<br>

<p style="text-align:left;">브랜드 10주년을 맞이한 <a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더에러</strong></a>가 특별한 캡슐 컬렉션, ‘FUTOURIST’를 출시합니다. </p>

<br>

<p style="text-align:left;">이번 캡슐 컬렉션을 통해 스스로를 다양한 차원으로 탐험하는 미래 여행자(FUTOURIST)로 정의하고, 지난 10년 간의 아카이브를 기념함과 동시에 미래를 향한 새로운 비전을 제시할 예정인데요. </p>

<br>

<p style="text-align:left;">미래 여행자가 여정의 시작점에서 짐을 꾸리는 모습에서 영감을 받아 탄생한 이번 캡슐 컬렉션은 어패럴, 슈즈, 백, 헤드웨어까지 총 17피스로 구성되었습니다. </p>

<br><br>

<br>

<p style="text-align:left;">아더에러만의 독창적이고 정교한 디자인 언어를 통해 구현된 패턴과 턱 디테일이 궁금한 패퍼들이라면 추후 업데이트 소식에 주목해 보세요! </p>

<br>

<p style="text-align:left;">한편 아더에러 10주년 캡슐 컬렉션은 오는 18일(수) 리뉴얼 오픈을 앞두고 있는 성수 스페이스에서 단독으로 선 론칭될 예정이며, 이후 아더에러 공식 온라인 스토어를 통해 만나 볼 수 있다고 하네요. </p>

<br>

<p style="text-align:left;">Editor. Cho Seo Young </p>

<br><br>

<br>

<p style="text-align:left;">Credit. ADER ERROR </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_2c34da5f8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0f575100e8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_8ecc440f93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_f3c69efd77.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_ff08203287.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_28141b0bc2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_55d09627c8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_79edf45fa7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_cfd19e53ab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_8149c492d5.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3246/news/', 'published'),
('릭 오웬스 X 컨버스 터보웨폰의 뉴컬러는?!', '릭 오웬스와 컨버스의 콜라보, 터보웨폰의 새로운 컬러를 출시합니다', 'categoryfashion3248news-65', '2024-12-16', 'Fashion', '["릭오웬스","컨버스","터보웨폰","콜라보","Rickowens","converse","TURBOWEAPON","collaboration"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_22bd2d4f40.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b70afe81eb.png', '<p style="text-align:left;">릭 오웬스 X 컨버스 터보웨폰의 뉴 컬러는?!</p>

<br><br>

<p style="text-align:left;"><a href="https://www.instagram.com/rickowensonline/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">릭 오웬스</strong></a> 다크쉐도우와 <a href="https://www.instagram.com/converse_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">컨버스</strong></a>가 함께한 ‘터보웨폰’의 새로운 컬러를 출시합니다.</p>

<br><br>

<p style="text-align:left;">터보웨폰은 컨버스의 제품인 ‘웨폰’을 재해석한 제품이죠. 슈즈의 아웃솔을 오버사이징해 릭 오웬스만의 아방가르드함을 살렸습니다.</p>

<br><br><p style="text-align:left;">특히 이번 협업 컬렉션에서는 어떤 스타일에든 잘 어울리는 클랙식한 화이트 컬러의 재출시할 뿐만 아니라 뉴 컬러, 모던한 오이스터 그레이를 새롭게 선보이는데요.</p>

<br><br>

<p style="text-align:left;">미니멀함, 절제미 속 릭 오웬스의 세심한 디테일이 숨어있는 터보웨폰의 새로운 컬러의 오는 17일부터 국내 릭 오웬스 전 매장과 S.I VILLAGE에서 만나볼 수 있다고 하네요.</p>

<br><br><p style="text-align:left;">Editor. KIM LEE YEON</p>

<br><br>

<p style="text-align:left;">Credit. <a href="https://www.instagram.com/rickowensonline/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Rick Owens</strong></a>, <a href="https://www.instagram.com/converse_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Converse</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_CONVERSE_64_67cad86869.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_CONVERSE_234_6e3c3f6b37.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_CONVERSE_MAN_a4f0632d3d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_CONVERSE_91_5fe3ad3722.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_CONVERSE_151_93aae88047.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3248/news/', 'published'),
('파리에서 만나는 송지오의 첫 글로벌 플래그십 스토어', '한국을 대표하는 브랜드 송지오가 첫 글로벌 플래그십 스토어를 오픈했다', 'categoryfashion3236news-66', '2024-12-06', 'Fashion', '["송지오","송지오 파리","송지오 플래그십","songzio paris flagship"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_b59aab8a27.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1bd77b4640.png', '<div style="padding:125% 0 0 0;position:relative;"></div>

<p style="text-align:left;">파리에서 만나는 송지오의 첫 글로벌 플래그십 스토어!
<br><br>
한국을 대표하는 디자이너 브랜드 <a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>가 지난 달 29일, 프랑스 파리 마레 지구 중심부에 첫 번째 글로벌 플래그십 스토어를 오픈했습니다. 
<br><br>
해당 스토어는 송지오의 창의적 철학과 한국의 현대적 미학이 결합된 공간으로, 패션과 건축, 예술이 어우러진 특별한 장소로 주목받고 있는데요. 송지오의 크리에이티브 디렉터 송재우와 파리의 건축 디자인 스튜디오 <a href="https://www.instagram.com/hypnos_xp/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">힙노스</strong></a>가 협업하여 파리의 고전적인 건축 양식에 현대적 요소를 더해, 고전과 현대의 조화를 보여주는 것이 특징입니다.
<br><br>
스토어에는 남성복 매장, 아뜰리에, 미디어 아트 전시 공간 등 총 4개의 공간으로 구성되어 있으며, 계단 끝마다 배치된 디자이너의 작품들은 송지오의 예술적 감각을 직접 체험할 수 있게 하는데요. 
<br><br>
2025년 여성복 런칭을 앞두고 있는 송지오는 오는 25년 7월 파리 여성 플래그십 스토어 오픈 또한 앞두고 있는 것으로 알려졌는데요. 서울을 넘어 파리에 위치한 송지오의 플래그십 스토어에서 만나볼 수 있는 송지오만의 창조적 철학! 이곳에서 만날 수 있는 송지오만의 패션과 건축, 예술적 감각을 통해 송지오만의 글로벌 존재감을 직접 느껴보시길 바랍니다.
<br><br>
일시: 2024. 11. 29 ~<br>
운영시간 : 매일 11:00 -19:00<br>
장소 : 10 Rue Charlot, 75003 Paris, France</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_e07550c515.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_fde21fdd31.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4f84c63112.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_07b0ca618f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_fafbbed40e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_d970fbd7db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_1cf77ca4d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_447a6cc143.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_1757f22c4f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3236/news/', 'published'),
('엄브로와 엘이이와이의 새로운 도전!', '엄브로가 엘이이와이와 협업 컬렉션을 선보인다', 'categoryfashion3219news-67', '2024-11-19', 'Fashion', '["엄브로","엘이이와이"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9a16682969.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_87cc3b7e89.jpg', '<br>

<p style="text-align:left;">엄브로에 엘이이와이st 레오파드의 등장이라..</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>가 <a href="https://www.instagram.com/l.e.e.y/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엘이이와이</strong></a>와 ‘Hideout in the City’라는 슬로건 아래 협업 컬렉션을 출시합니다. </p>

<br>

<p style="text-align:left;">해당 컬렉션은 엄브로의 스포티한 분위기에 엘이이와이의 트렌디하고 독특한 디자인이 더해져 방과 후 도심을 자유롭게 누비는 크루들의 매력을 시각화했는데요.</p>

<br>

<p style="text-align:left;">엄브로는 이번 컬렉션으로 다양한 패턴과 소재에 도전하며, 레오파드 패딩과 오버사이즈 레더 재킷 등 기존에 선보이지 않은 색다른 무드의 아이템들을 선보인다고 합니다.</p>

<br>

<p style="text-align:left;">엄브로와 엘이이와이를 사랑하는 패퍼들, 11월 20일부터 공식 온라인 스토어와 오프라인 매장에서 이들의 컬렉션을 만나보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_e5ede7b230.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_e4ebfad011.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_79bbee76b1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_1_c2dd54dab1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/05_58e2038769.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3219/news/', 'published'),
('마음까지 따뜻해지는 엄브로 아프레 스키 슈즈 캠페인 공개', '이탈리아 지역의 설원을 배경으로 한 윈터 슈즈 캠페인을 공개했다', 'categoryfashion3216news-68', '2024-11-11', 'Fashion', '["UMBRO","AprèsSki","엄브로"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6177bfd407.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b3f2595fd2.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>가 윈터 시즌을 맞이하여 이탈리아 파쏘 스텔비오 지역의 설원을 배경으로 촬영된 Après Ski 슈즈 캠페인을 공개했습니다. </p>

<br>

<p style="text-align:left;">가벼우면서도 따뜻한 3M 신슐레이트 충전재가 적용된 레슬리 시리즈와 따뜻한 퍼 소재의 안감으로 마무리된 토피 시리즈, 마지막으로 활용성 높은 베이직한 디자인과 다양한 컬러의 티포 시리즈까지. </p>

<br>

<p style="text-align:left;">엄브로의 윈터 슈즈 시리즈는 신고 벗기 편안한 로우탑과 발목까지 포근하게 감싸 주는 부츠, 총 두 가지 쉐입으로 구성되어 있으며 이를 통해 선택의 폭을 넓힘과 동시에 가벼우면서 따뜻한 착화감을 선사합니다. </p>

<br>

<p style="text-align:left;">올 겨울 따뜻한 윈터 슈즈를 찾는다면 지금 바로 엄브로 공식 인스타그램과 온라인 스토어를 통해 Après Ski 캠페인을 만나 보세요! </p>

<br><br>

<br>

<p style="text-align:left;">Credit. UMBRO</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_9745f6ffba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_ce9737a276.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_4e9d692bb6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_b5e9677b8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/05_806c9db7a3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/06_92f38ef89c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/07_c0d97a88e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/08_b745ca4137.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/09_d4364cffe9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_fa61c9aa34.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_42a49f79ad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_e8fc400064.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3216/news/', 'published'),
('유럽 스트릿에 엄브로의 윈터 슈즈가 떴다!', '엄브로의 윈터 슈즈와 함께한 패션위크 스트릿 스타일', 'categoryfashion3215news-69', '2024-11-08', 'Fashion', '["엄브로","윈터 슈즈","스트릿"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0ca5074ae6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f27bad50f6.jpg', '<br>

<p style="text-align:left;">엄브로의 윈터 슈즈, 스트릿을 만나다. </p>

<br>

<p style="text-align:left;">패션위크 스트릿에 요즘 핫한 <a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>의 윈터 슈즈가 떴다! 이 시리즈와 함께한 유럽의 핫한 스트릿 스타일을 &#60;PAP&#62;이 포착했습니다. </p>

<br><br>

<br>

<p style="text-align:left;">가벼우면서도 따뜻한 3M 신슐레이트 충전재가 적용된 레슬리 시리즈와 따뜻한 퍼 소재의 안감으로 마무리된 토피 시리즈, 마지막으로 활용성 높은 베이직한 디자인과 다양한 컬러의 티포 시리즈까지.</p>

<br>

<p style="text-align:left;">시리즈 모두 신고 벗기 편한 로우탑과 발목까지 따뜻하게 감싸줄 부츠까지 두 가지 쉐입으로 구성되어 선택의 폭을 넓혔죠.</p>

<br>

<p style="text-align:left;">윈터 시즌 스타일링에 포인트가 되어줄 엄브로의 윈터 슈즈 시리즈를 슬라이드로 만나보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_e5dedd13fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_98972b3e83.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_5e91de08b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b34843fac9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_d0999c0f0b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_910bf51f45.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_a06f534ec1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_9b84038b84.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_286ab064cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_b542196848.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3215/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('릭 오웬스X몽클레르 또 한 번의 리빙 프로젝트', '릭 오웬스와 몽클레르가 선보이는 산악 은신처', 'categoryfashionculture3211news-70', '2024-11-01', 'Fashion,Culture', '["릭 오웬스","몽클레르"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8bce1f9bcc.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_79e980547a.jpg', '<br>

<p style="text-align:left;">릭 오웬스와 몽클레르의 산악 은신처?</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/rickowensonline/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">릭 오웬스</strong></a>와 <a href="https://www.instagram.com/moncler/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">몽클레르</strong></a>가 독특한 리빙 프로젝트를 선보였습니다. 프랑스 알프스에 있는 미셸 라미 가족의 산속 오두막에서 영감을 받아 해체 가능한 산악 은신처를 설계한 것.</p>

<br>

<p style="text-align:left;">해당 은신처에는 극한 환경 구조물 분야에서 잘 알려진 휴 브라우튼 아키텍츠와 협력해 고립된 장소에서 활용 가능한 첨단 기술이 사용되었다고 하는데요. </p>

<br>

<p style="text-align:left;">온도 유지 기능, 수평 맞춤 기술, 태양광 지붕 패널과 풍력 발전용 터빈이 이용되어 에너지에 대한 부족함 없이 추위를 피할 수 있습니다. 또한 눈을 녹여 물 확보 시스템과 탈착 가능한 폐기물 저장 탱크로 지속 가능한 라이프를 영위할 수 있다고 하죠.</p>

<br>

<p style="text-align:left;">릭 오웬스와 몽클레르의 조립식 산악 은신처 협업을 만나보세요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d0a407c148.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_066ecb8d2f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_2730718ff7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_0ab7dc546d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2bf9c7c7c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_97b340e950.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_da963c26e5.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Culture/3211/news/', 'published'),
('지수가 타미 힐피거의 새로운 앰버서더로 발탁됐다', '지수는 지난 9월 뉴욕에서 열린 타미 힐피거 SS24 쇼에 참석한 바 있다', 'categoryfashion3208news-71', '2024-10-22', 'Fashion', '["지수","타미힐피거","tommyhilfiger"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_57096abf2c.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8340dacf97.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/sooyaaa__/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지수</strong></a>, <a href="https://www.instagram.com/tommyhilfiger/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">타미 힐피거</strong></a>의 새로운 얼굴이 되다! </p>

<br>

<p style="text-align:left;">블랙핑크 지수가 2024년 가을 브랜드 캠페인과 함께 타미 힐피거의 새로운 앰버서더로 발탁됐습니다.</p>

<br>

<p style="text-align:left;">뉴욕의 활기와 에너지를 담은 타미 힐피거의 새로운 캠페인에 등장한 지수. 여성성과 현대적인 감각을 조화롭게 결합한 컬렉션이 깊이 공감되어 이번 파트너십이 더욱 뜻깊다는 소감을 밝히기도 했습니다. </p>

<br>

<p style="text-align:left;">특히 지수는 지난 9월 뉴욕에서 열린 타미 힐피거의 SS24 쇼에 참석한 바 있죠. 타미 힐피거와 지수가 보여 줄 넥스트가 더욱 기대됩니다! </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Tommy Hilfiger</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Gac3d_UV_Ww_A_Aj_WRE_9d7625fc3a.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Gad_Npq_PW_0_AA_Aw_Kz_87b055394d.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Gad_Npq_WWAAEOG_Qx_b2ffd0d788.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3208/news/', 'published'),
('차갑고 거친 도심 속 무한한 아웃도어의 여정', '마무트의 24FW 컬렉션 공개', 'categoryfashion3206news-72', '2024-10-19', 'Fashion', '["마무트","24FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7d06f0e746.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e07b5fdb64.jpg', '<br>

<p style="text-align:left;">마무트의 첫 번째 여정, 24FW 컬렉션 공개! </p>

<br>

<p style="text-align:left;">스위스 프리미엄 아웃도어 브랜드 <a href="https://www.instagram.com/mammut/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마무트</strong></a>가 24FW ‘City to hike’ 캠페인 화보를 공개했습니다. </p>

<br>

<p style="text-align:left;">국내에서 선보이는 이들의 첫 번째 이야기는 차갑고 거친 도심에서도 꺼지지 않는 아웃도어 모먼트를 찾아가는 마무트의 여정을 그리죠.</p>

<br>

<p style="text-align:left;">마무트만의 헤리티지를 담아낸 컬렉션으로 자연에서의 자유로운 모습부터 일상의 여유로움까지, 마무트의 혁신적인 기능과 디자인의 결합으로 어디서나 즐길 수 있는 데일리 아웃도어를 선보였습니다.</p>

<br>

<p style="text-align:left;">‘즐기는 자’를 의미하는 독일어 ‘Geniesse es’가 모티프인 이번 24FW 컬렉션.</p>

<br>

<p style="text-align:left;">동계 백패킹 즐기는 사람들을 위해 재탄생한 ‘구베 IN 후디드 푸퍼’, 빈티지한 아카이브 무드를 간직한 ‘초경량 루프틱 인슐레이션’ 등 마무트만의 아이코닉한 아이템들이 눈길을 끕니다.</p>

<br>

<p style="text-align:left;">패퍼들도 지금 바로 PAP과 함께 마무트의 새로운 24FW 시즌 컬렉션을 만나보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_0442_920982d1ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_0081_c90ca8ed3f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_1544_6703af0f9e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_1894_729f6c9927.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_2157_31d33a15c7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_2605_4eb7bb46d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_3859_be5e950dac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_4701_de3bda8d06.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/mamut_4976_f0b4472933.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3206/news/', 'published'),
('엄브로X버터굿즈, 가을의 스트릿 무드란', '엄브로와 버터굿즈의 첫 협업이 공개됐다', 'categoryfashion3205news-73', '2024-10-18', 'Fashion', '["엄브로","버터굿즈"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4e43042a25.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_20bd8c36d2.jpg', '<br>

<p style="text-align:left;">가을엔 스트릿을, 엄브로와 버터굿즈의 첫 콜라보! </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>가 호주 베이스 스트릿 웨어 브랜드 <a href="https://www.instagram.com/buttergoods/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">버터굿즈</strong></a>와 첫 번째 콜라보레이션 제품을 선보였습니다.</p>

<br>

<p style="text-align:left;">버터굿즈는 스케이트보드 문화를 배경으로 다양한 협업을 전개. 해당 협업은 엄브로의 헤리티지가 담긴 풋볼 컬쳐와 버터굿즈의 스트릿 무드가 섞여 시너지를 일으키는데요.</p>

<br>

<p style="text-align:left;">우븐 재질의 다이아몬드 셋업과 트레이닝 피스테를 포함한 총 8종의 스타일을 공개했으며, 지금 바로 엄브로 공식 온라인 스토어에서 만나보실 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_7ac506741c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_70c481e1ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_c9dbdfeb58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_1_1338bd9566.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3205/news/', 'published'),
('추위와 함께 돌아온 민규의 캘빈클라인 24FW', '세븐틴 민규와 캘빈클라인의 24FW 아우터 캠페인', 'categoryfashion3204news-74', '2024-10-16', 'Fashion', '["민규","캘빈클라인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bf662f1e8c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a98bb245f6.jpg', '<br>

<p style="text-align:left;">인간캘빈 민규가 추위를 이기는 방법!</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/min9yu_k/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">세븐틴 민규</strong></a>의 <a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a> 24FW 아우터 캠페인이 공개됐습니다. 이번 캠페인에 처음으로 등장한 제품은 바로 스탠드 칼라 다운 재킷.</p>

<br>

<p style="text-align:left;">스탠드 칼라와 드롭 숄더핏으로 여유로운 실루엣과 은은한 볼륨감을 제공해 캐주얼하고 따뜻한 분위기를 자아내죠.</p>

<br>

<p style="text-align:left;">또다른 이미지에서 착용한 에비에이터 셰르파 재킷은 묵직한 나일론 새틴 소재와 셰르파 칼라로 텍스처 차이에 포인트를 주어 빈티지한 스타일을 완성했는데요.</p>

<br>

<p style="text-align:left;">이와 함께 마지막으로 리버시블 패딩 재킷과 멜란지 유틸리티 셔츠를 레이어링해 쿨한 가을 스타일링의 정점을 찍었습니다. 민규와 함께 새로운 캘빈클라인 컬렉션을 만나보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F24_MINGYU_PHOTOG_nologo_10_eda87eb006.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F24_MINGYU_PHOTOG_nologo_9_fa60a2dd7b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F24_MINGYU_PHOTOG_nologo_11_a18beca76c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F24_MINGYU_PHOTOG_nologo_16_27fd055d85.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F24_MINGYU_PHOTOG_nologo_14_2ef583bb8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F24_MINGYU_PHOTOG_nologo_15_289329fd7e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3204/news/', 'published'),
('SS25 상하이 패션 위크 자세히 살펴 보기', '마크공, 식스도, 스태프온리', 'categoryfashion3200news-75', '2024-10-14', 'Fashion', '["마크공","식스도","스태프온리","상하이패션위크","MARKGONG","STAFFONLY","SIXDO"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_100168b758.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8bf3b32674.png', '<br>

<p style="text-align:left;">지금 중국에서는 <a href="https://www.instagram.com/shanghai_fashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">상하이 패션 위크</strong></a>가 한창입니다. 2025 봄/여름 시즌을 맞이하여 상하이는 다시 한 번 글로벌 패션 산업의 중심으로 떠오를 준비를 하고 있죠. </p>

<br>

<p style="text-align:left;">상하이 패션 위크는 그 어떤 패션 위크보다 전 세계의 디자이너들의 다양성과 혁신을 보여 주는 장이 되고 있기도 한데요. 지금까지 쇼를 선보인 세 브랜드의 주요 포인트를 모아 봤습니다. </p>

<br><br>

<br>

**<p style="text-align:left;"><a href="https://www.instagram.com/shanghai_fashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">MARKGONG</strong></a></p>**

<br>

<p style="text-align:left;">이번 상하이 패션 위크 첫 오프닝 쇼의 주인공은 마크공이었습니다. 드라마 <섹스 앤 더 시티>의 샬롯 요크 캐릭터에게서 영감을 받은 마크공의 SS25는 샬롯의 클래식한 세련미를 살리면서 마크공만의 위트를 더해 재기발랄한 컬렉션입니다. 특히 드라마에 등장하는 샬롯의 딸 릴리가 빨간 페인트가 묻은 손으로 샬롯의 스커트를 망치는 장면에서 나온 ‘릴리 드레스’에 주목할 것! </p>

<br><br>

<br>

**<p style="text-align:left;"><a href="https://www.instagram.com/shanghai_fashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">STAFFONLY</strong></a></p>**

<br><br>

<br>

<p style="text-align:left;">매시즌 창의적인 컬렉션을 선보이는 스태프온리의 SS25는 KAUKAU 스튜디오와 함께 더 발전된 비주얼 콘셉트와 아트 디렉션을 보여 줬습니다. 런웨이에 선 모델들은 마치 오류처럼 자신의 얼굴 형상을 한 백을 들거나, 얼굴이 커튼처럼 갈라진 형태의 헤드 피스를 착용했습니다. 이 모든 요소들은 디지털 오류가 우리의 현실 인식에 어떤 영향을 미치며, 기술적 정밀함 앞에서 자기 성찰이 필요함을 상징한다고 하네요. </p>

<br><br>

<br>

**<p style="text-align:left;"><a href="https://www.instagram.com/shanghai_fashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">SIXDO</strong></a></p>**

<br><br>

<br>

<p style="text-align:left;">가시가 있지만 우아하고 빛나는 장미를 생각해 보세요. 식스도의 SS25 컬렉션은 만개한 장미의 본질에서 영감을 받아 전개됐습니다. 실용성과 예술성을 강력하게 어우르면서도 섬세한 디테일까지 놓치지 않았죠. 넷플릭스 <에밀리, 파리에 가다>의 릴리 콜린스가 드라마 포스터 촬영 때 착용한 장미빛 드레스 바로 식스도의 컬렉션 피스라는 점! </p>

<br>

<p style="text-align:left;">Credit. @shanghai_fashionweek @markgong_official @staffonlystudio @sixdovn </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3127b71f09.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_ef418a8413.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_190fe30302.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_a5485ac440.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_fdc997b6d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a2832540f3.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_564005d0f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_98aabd2d59.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_674edcf48c.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3200/news/', 'published'),
('엄브로, 100주년 컬렉션의 피날레!', '브랜드 100주년을 기념하는 HBL 컬렉션의 마지막 라인 공개', 'categoryfashion3202news-76', '2024-10-14', 'Fashion', '["엄브로","Umbro"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6508e32a70.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cece756c77.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>가 브랜드 100주년을 기념하는 HBL 컬렉션의 마지막 라인을 선보입니다. </p>

<br>

<p style="text-align:left;">1924년부터 시작되어 현재까지의 역사적 스토리를 현대적인 관점으로 해석한 디자인과 스토리텔링 콘텐츠로 엄브로의 영광스러운 과거와 찬란한 미래를 기대할 수 있는 콘셉트로 담아낸 것이 특징인데요. </p>

<br>

<p style="text-align:left;">가을 시즌에 적합한 니트, 우븐, 패딩 아이템으로 구성된 세 번째 HBL 컬렉션은 엄브로의 과거 아카이브를 복각하고 재해석한 디자인이 포인트라는 점! </p>

<br>

<p style="text-align:left;">엄브로의 HBL 컬렉션을 지금 바로 전국 엄브로 오프라인 매장과 온라인 스토어에서 만나 보세요. HBL에 대한 스토리 콘텐츠는 엄브로 인스타그램에서 확인할 수 있습니다. </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Umbro </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_76113bd3d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_4550fcce3a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_5cecbd9774.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_ffa2a12a9a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/08_238b2fafb4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/07_6b56c8aa1e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/05_64d8772807.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/06_fc06a2c208.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3202/news/', 'published'),
('패션 위크 스트릿에서 포착한 하이드로겐 베스트 모먼트', '일상 속에서 하이드로겐 아이템을 스타일리시하게 착용한 모습을 포착했다', 'categoryfashion3197news-77', '2024-10-11', 'Fashion', '["Hydrogen","하이드로겐","패션 위크 스트릿","Fashion Week Street"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3eed1174b8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f7add91a1b.jpg', '<p style="text-align:left;">로벌 패션 위크 스트릿에서의 하이드로겐 베스트 모먼트! 
<br><br>
SS25 시즌 밀란, 파리 패션 위크는 매시즌 가장 트렌디한 스타일들을 확인할 수 있는 장소입니다. 그중 이번 시즌 특히 주목받은 브랜드가 있다면 바로 <a href="https://www.instagram.com/hydrogen.korea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">하이드로겐</strong></a>이죠.
<br><br>
이번 시즌 하이드로겐은 단순한 아웃도어 그 이상의 면모를 보여 줬는데요. 패션 피플 사이에서 실용성과 패셔너블함을 모두 잡은 바람막이 재킷, 경량 베스트, 플리스 그리고 헤비 아우터로 큰 사랑을 받았습니다.
<br><br>
편안하면서도 감각적인 스타일링을 중시하는 현 트렌드에 맞춰 일상 속에서도 많은 이들이 하이드로겐의 아이템을 착용하고 있는 모습을 볼 수 있었다는 점 또한 주목할 만합니다.
<br><br>
하이드로겐의 FW24 아우터들은 오프라인 매장과 자사몰, <a href="https://www.instagram.com/bucketstore.official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">버킷스토어</strong></a>, <a href="https://www.instagram.com/musinsa.official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">무신사</strong></a>를 통해 구매할 수 있으니 절대 놓치지 마세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d2b7d97dcf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_b65e00dbea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_2f630d2ea4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_ad2d3dd1a1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_527dcc7cd4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_27df124651.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_d5754d241a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_f0307dc7fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_c804614f9e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_5799bbd698.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3197/news/', 'published'),
('패션 위크 스트릿 스타일링은 메트로시티처럼!', '절제된 아름다움이 흘러넘치는 유니크한 실루엣을 카메라에 포착했다', 'categoryfashion3195news-78', '2024-10-09', 'Fashion', '["메트로시티","파리패션위크","밀란패션위크","스트릿스타일","METROCITY","ParisFashionWeek","MilanFashionWeek","StreetStyle"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_51a19cff48.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_2970656d69.png', '<p style="text-align:left;">패션 위크 스트릿에서 가장 하입한 브랜드, 메트로시티. 
<br><br>
밀란, 파리 패션 위크 SS25 우먼즈 위크가 성공적으로 막을 내렸습니다. 이를 기념해 &#60;PAP&#62;가 제안하는 <a href="https://www.instagram.com/metrocity.korea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">메트로시티</strong></a>의 고급스러운 매력을 강조한 스타일링!
<br><br>
이번 시즌 패션 위크 스트릿에 나온 많은 패션 피플들의 선택은 메트로시티로 향했다는 점을 알고 계신가요? 프린지 트위드 자켓, 화이트 포인트 자켓, 와이드 핀턱 팬츠를 비롯해 다양한 크기와 스타일을 지닌 메트로시티의 시그니처 SERRATO 백을 포함한 다채로워진 백 라인업은 모두의 눈길을 사로잡기 충분했습니다.
<br><br>
절제된 아름다움이 흘러넘치는 유니크한 디자인과 고급스러운 소재로 글로벌 패션 위크에서 존재감을 드러냈던 메트로시티의 스타일링을 지금 바로 확인해 보세요.</p>

<br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">프린지 트위드 자켓 M243CJ1101I + SERRATO 숄더백 Medium M243MQ0364Z</p>

<br>

<p style="text-align:left;">메트로시티를 대표하는 시그니처 백인 SERRATO가 빈티지한 무드로 리뉴얼되었습니다. 여기에 트위드 텍스처에서 느껴지는 고급스러운 무드가 특징인 프린지 트위드 자켓으로 심플하면서도 우아한 느낌을 더해 보세요.</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">와이드 핀턱 팬츠 M243CA1102G2 + VICTORIA GIORNO 크로스백 M243MO7093W</p>

<br>

<p style="text-align:left;">클래식하면서도 모던한 스타일을 연출하고 싶을 땐 와이드한 핏의 겹슬릿 팬츠와 심플하고 유려한 곡선미가 돋보이는 안정된 형태의 크로스백 시계의 무브먼트에서 영감을 얻은 VICTORIA GIORNO를 매치해 보세요.</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">SERRATO 토트백 Small M243MQ2371Y</p>

<br>

<p style="text-align:left;">소프트한 터치감으로 포근함을 주는 유니크한 디자인의 스몰 토트백인 SERRATO! 스티치 텍스처 다이아 평면과 볼륨감을 극대화한 상반된 퀄팅으로 양감을 더욱 강조한 디자인이 특징입니다.</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">SERRATO 토트백 Medium M243MQ2370G</p>

<br>

<p style="text-align:left;">스몰 사이즈와 미디엄 사이즈로 여러 상황에서 스타일리시하게 매치할 수 있는 SERRATO 토트백. 밴드 여밈으로 간편한 오픈과 소지품을 안전하게 보관할 수 있다는 점도 놓칠 수 없죠. </p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">화이트 포인트 재킷  + SERRATO 숄더백 Medium M243MQ0364I</p>

<br>

<p style="text-align:left;">대비되는 컬러로 배색감을 더한 화이트 포인트 자켓은 화이트 골드 단추로 룩에 확실한 포인트를 선사합니다. 여기에 크랙 가죽과 매트한 재질이 매력적인 SERRATO 숄더백 미디엄을 더해 주면 완벽!</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">프린지 트위드 자켓 M243CJ1101Z + SERRATO 숄더백 Medium M243MQ9364D</p>

<br>

<p style="text-align:left;">여유로운 실루엣에 수술 디테일이 더해져 심플하면서도 우아한 무드가 매력적인 블랙 컬러의 프린지 트위드 자켓. 화이트 컬러와는 또 다른 매력으로 SERRATO 숄더백 미디엄과 함께 매치해 볼 것을 추천!</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">VICTORIA GIORNO 크로스백 M243MO7093Z</p>

<br>

<p style="text-align:left;">데일리한 아이템으로 활용하기 좋은 메트로시티의 VICTORIA GIORNO 크로스백은 스타일링에 용이하며 이너 플랩으로 실용성까지 챙겼습니다. 세련된 무드의 깊이감 있는 FW24 체리버건디 컬러도 함께 만나 보세요.</p>

<br>

<p style="text-align:left;">Credit. PAP</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_2b34367c49.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_7eed3be25c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_1a3504c892.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_2fb5c48942.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_0877765b90.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_89c7089d86.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_4c0dc400a9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_6c1e5037be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_d3adf25133.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_f7877bff1e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3195/news/', 'published'),
('파리 패션 위크 SS25 스트릿 스타일 Part.3', '<PAP>가 담아온 파리 패션 위크 현장 공개', 'pfw-ss25-street3-79', '2024-10-03', 'Fashion', '["파리 패션 위크","Pfw","스트릿 스타일","SS25","PARIS FASHION WEEK","STREET STYLE"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_0bc00048a6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_eb4eb402bf.jpg', '<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/danielless.photos/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Danielle Sinai Shvadron</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A3288_c3e3a6d8e9.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A3865_9aaf6d41b3.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A3898_5f81e84e9c.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A3905_f7931ffbcb.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4215_c21d352b53.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4223_057d23ad29.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4224_00df6aad58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4261_72e0c413f7.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4281_e4538ee70c.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4291_30c4a63a01.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4298_7fb407bd9e.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4305_e37e904c9e.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4317_aed3804252.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4328_4c591db903.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4335_fc2be7fc7a.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4663_4f0b54d5d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4701_dec9b79325.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4728_7c11d5096d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A4734_047385ad10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5192_41188bb7e6.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5229_9d6fb168f5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5258_a9a867b82a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5744_980630c647.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5784_fe13648504.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5844_42a41f199c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5866_3_c6bc6f7b9c.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5872_3_6628ec4cc4.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5878_3_baab7a7394.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5888_3_7c1017601a.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A5949_3_8232ef2483.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6067_3_d9c9eca910.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6104_4_86313753b5.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6108_3_844cfd40a2.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6117_3_b1d9992ecc.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6122_3_f0a9245088.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6131_3_bc77ab7d0f.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6169_3_31ca905acb.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6176_3_ad6247178e.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A6184_3_59635b1f60.jpeg"]'::jsonb, '[]'::jsonb, 'pfw-ss25-street3', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('메종 김해김 SS25 백스테이지 with 파리 패션 위크', '<PAP>가 메종 김해김 백스테이지 현장을 담아왔다', 'kimhekim-ss25-backstage-80', '2024-09-30', 'Fashion', '["김해김","SS25","백스테이지","파리 패션 위크","Paris Fashion Week","pfw","KIMHĒKIM","KIMHeKIM","backstage"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4a16a9a47e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f9d27a762d.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">KIMHĒKIM</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/ssaintelange/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Stencer Saintelange</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_2_4e30ca28a3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_3_61dcf2fe24.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_5_3182e9006a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_6_07e0a92c78.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_7_3610b08c85.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_8_3b61340588.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_9_ff22a75a5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_10_7a3f793c88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_11_c50d0357c9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_12_deb31e06be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_13_ff537cc198.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_14_c9ce239c5e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_15_65afbdf024.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_16_caacbca43a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_17_281f01fa68.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_23_0cf898ab58.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_34_6a8975a237.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_35_39f769f488.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_37_3169defbe0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_38_c8cfb93ac7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_44_69fa316ea4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_46_3e5e49da6f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_48_aaa089b76c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_54_771d8a5c48.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_55_7e89923480.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_113_a5c09df309.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_123_01220d4984.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_143_e695b76ba4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_163_f3156d95c7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_313_55fda3a4a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_164bd067b4.jpg"]'::jsonb, '[]'::jsonb, 'kimhekim-ss25-backstage', 'published'),
('파리 패션 위크 SS25 스트릿 스타일 Part.2', '<PAP>가 담아온 파리 패션 위크 현장 공개', 'pfw-ss25-street2-81', '2024-09-29', 'Fashion', '["PARIS FASHION WEEK","SS25","STREET STYLE","파리 패션 위크","스트릿 스타일"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_91b255b74c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_5af09f9b61.jpg', '<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/danielless.photos/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Danielle Sinai Shvadron</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2197_56b006e3a3.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2255_68ced7a6ee.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2259_0440bcd94e.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2265_75d264b4af.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2269_74eb048c6d.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2278_7449c5c831.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2296_09d4a9408a.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2313_28c64b8e8c.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2355_be7449da98.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2412_0e629378ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2430_3d8c32b589.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2462_c2259ca203.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2466_919a5074d0.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2474_72b0377a0a.JPEG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2623_f32104aafe.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2630_6c33ac84be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2652_fafb86f05b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2653_0aa27c5503.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2671_e838deccec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2679_7c41f15f6a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2704_589afc809e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2739_62faae75bd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2764_d06a4e1965.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2783_fa6b932eac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2796_3f07badea4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2807_5e8fe80c1f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2862_b779d88cbe.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2883_6918213802.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_05580_c40276ef0b.JPEG"]'::jsonb, '[]'::jsonb, 'pfw-ss25-street2', 'published'),
('파리 패션 위크 SS25 스트릿 스타일 Part.1', '<PAP>가 담아온 파리 패션 위크 현장 공개', 'pfw-ss25-street1-82', '2024-09-26', 'Fashion', '["PARIS FASHION WEEK","pfw","ss25","STREET STYLE","스트릿 스타일","파리 패션 위크","2025 ss"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5a6f1d8d54.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4ab283063f.jpg', '<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/danielless.photos/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Danielle Sinai Shvadron</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1656_5c896987a8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1670_c702ae8504.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1674_6166aed8b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1688_034e01a55b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1697_5fa8a77d1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1710_3fec07e4f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1715_177475679f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1727_b955234e92.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1729_c4947aabfe.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1735_5177567370.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1744_e931faebab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1774_40fc92fa22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1778_0b89f5a5a5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1793_9f15776244.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1796_7067fb2201.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1799_a0808a5f2c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1818_cd001250cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1830_7757ce6a84.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1832_2287202ef5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1839_e60dddcb5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1843_c4bb6ceb82.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1848_978cfca76a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1866_bbb778e5c3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1892_7b34e34d0a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1906_80e56fe641.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1957_7acc898c34.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1975_4b3fd29eec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1990_0b88c121ed.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A1992_93fa04607f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2034_d9c18d250c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2040_89ca24c0b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2069_239d2b21b1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_U0_A2090_269efbde9e.jpg"]'::jsonb, '[]'::jsonb, 'pfw-ss25-street1', 'published'),
('내셔널지오그래픽 ‘헤론’과 함께한 스트릿 스타일', '내셔널지오그래픽 24FW 스테디셀러 경량 다운 ‘헤론’', 'ngo-24fw-heron-83', '2024-09-25', 'Fashion', '["내셔널지오그래픽","National Geographic","24FW","Heron","내셔널지오그래픽어패럴","Street Style","스트릿 스타일"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_49a3dd6fc7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_fbcae11204.jpg', '<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">W’ 헤론 U넥 경량 다운 점퍼 CRYSTAL BEIGE</p>

<br>

<p style="text-align:left;">유럽 스트릿에서 찾은 내셔널지오그래픽! <br><br>
패션위크 스트릿에서 포착한 <a href="https://www.instagram.com/ng_apparel/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">내셔널지오그래픽</strong></a>24FW 스테디셀러 경량 다운 시리즈 ‘헤론’.  
<br><br>
‘RDS’ 인증 유러피안 구스 다운으로 더욱 가볍고 따뜻해진 헤론 컬렉션은 간절기부터 추운 겨울까지 활용도 높은 아이템으로, 다채로운 스타일링이 가능합니다.
<br><br>
스타일리쉬한 연출로 유럽 스트릿을 누빈 헤론 아이템들이 궁금하다면, 지금 바로 내셔널지오그래픽 공식 온라인 스토어에서 만나보세요. </p>

<br><br><p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">W’ 헤론 U넥 경량 다운 점퍼 CARBON BLACK</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">헤론 U넥 경량 다운 점퍼 STONE GREY</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">W’ 헤론 U넥 경량 다운 베스트 LIGHT JADE</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">헤론 U넥 경량 다운 베스트 BEIGE</p>

<br><br><br>

<p style="text-align:center; font-size: 1.2rem; color: gray; font-weight:400;">헤론 U넥 경량 다운 베스트 CARBON BLACK</p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_c8f138acba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_75b2269ffd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_879c123770.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_136c3edc54.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_b598f405ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_15090d2bd6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_c5f65012dd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_5707f8be6e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_0e3522c84b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_e0934a13d0.jpg"]'::jsonb, '[]'::jsonb, 'ngo-24fw-heron', 'published'),
('루이스 데 하비에르 SS25 백스테이지 with 파리 패션 위크', '<PAP>가 루이스 데 하비에르 백스테이지 현장을 담아왔다', 'luisdejavier-ss25-backstage-84', '2024-09-25', 'Fashion', '["루이스 데 하비에르","Luis De Javier","백스테이지","backstage","SS25","Paris Fashion Week","파리 패션 위크","pfw","2025 ss"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_494bde980b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a86578819a.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Luis De Javier</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/ssaintelange/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Stencer Saintelange</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_6_21a5b94c09.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_5_9d8e07e4b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_3_021c3dd5a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_4_a8358b4024.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_2_ee3d452992.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_7_c6ab026f84.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_8_b89b32b4b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_9_805f360e8c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_10_a620c34476.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_11_875a6c4782.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_13_d0fdd19c4a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_15_025f6ec03a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_16_c1feb8c5ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_18_8626f5dab0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_22_d14db2be3e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_23_f64757d517.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_25_51061a2ec4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_30_4f54082d86.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_32_1a3da97e57.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_34_6b1acff230.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_35_1aeaa16591.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_36_6d36f333d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_39_7d9d558284.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_40_2705da1c7c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_41_8a49e0a4d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_42_697ac2ed23.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_43_8e98e484e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_44_3e8c3386ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_3078536e66.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_46_ca0c45559c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_47_282a1f9b4f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sans_titre_48_53415dd5a8.jpg"]'::jsonb, '[]'::jsonb, 'luisdejavier-ss25-backstage', 'published'),
('아니예레코즈 SS25 백스테이지 with 밀란 패션 위크', '<PAP>가 아니예레코즈 백스테이지 현장을 담아왔다', 'aniyerecords-ss25-backstage-85', '2024-09-24', 'Fashion', '["아니예레코즈","SS25","백스테이지","밀란 패션 위크","Aniye Records","Backstage","Milan Fashion Week","mfw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4d0b57c236.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_f91e99e5ad.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Aniye Records</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_e158f78814.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_505b2a5864.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_9807baf8f1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_40457c637f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_6aec3e10fc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_37bb5573a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_fac0a8ff0d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_52d1679e1c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_031d6ce21a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_bd1fd21195.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_e09c96e641.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_39217fc201.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_d0e5b81e95.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_90ae73c403.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_d7ee01377c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_314aacbdcb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_0a4699a7f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_92c585644e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_858539a6c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_e39b54de3a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_c167a3030d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_29f75dd5e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_b2876378c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_1a8a4fee33.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_815c8017b5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_6ef11291ea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_82f132eba2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_0006ff25c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_f51f7dc06f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_e698fd01c9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_9f670ea1a0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_012e5ac837.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_217173cc5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/37_12ac3a4a64.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/38_42eff25ec1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_3a744da054.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/40_90b9e8d3d5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/41_e154ada39f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/42_4f1a7413f1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/43_4a2411a8cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/44_8c6cd93b5b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45_3a29849d69.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/46_e12737a1ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/47_7c20343283.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/48_9cfb8dcb05.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/49_0d9b9407e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/50_3d1eb007d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/51_07f25f1803.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/52_59ce30c018.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/53_5a93056291.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/54_1319fb952b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/60_b1087a6f14.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/61_eab5cda559.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/62_2722c2d9d9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/64_8ad5c3716e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/67_c2923aaec6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/68_a7df3ef777.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/69_e740e69000.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/80_50a7e63b47.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/81_e0adee5d7c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/100_0111c739dd.jpg"]'::jsonb, '[]'::jsonb, 'aniyerecords-ss25-backstage', 'published'),
('밀란 패션 위크 SS25 스트릿 스타일 Part.4', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-25ss-street4-86', '2024-09-24', 'Fashion', '["MILAN FASHION WEEK","SS25","STREET STYLE","diesel","디젤","밀란 패션 위크","스트릿 스타일"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_bbd3e157ba.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_ef088164fd.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">DIESEL</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1d1fcb9f3f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_7b20712cb8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_ea8ed8f45b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_7f128e8269.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_b6d0de995c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_da4329f874.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_600f9c24a1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_84536cfd1e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_4ed7df41e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_3bcde39d14.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_4953866979.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_a026c332c0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_76f94b415e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_f89e5358d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_c6dd346da4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_fa9bf16a01.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_5d793ea60e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_0284f31907.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_ab73988bf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_36b7c80886.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_5ca7a589b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_c785a7a162.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_0a02808f71.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_ebdce4a6ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_089d91b2a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_b4939bc867.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_e6c41dd031.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_16bf287eee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_be678370da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_57a8d46c48.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_352c38bf56.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_a1df5f2ad9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_06b9fede66.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_2c31fd86bc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_21317c57cc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_fb0af48296.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/37_24d1f08bd2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/38_b31e9beca7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_728fc82394.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/40_ac08023292.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/42_d92fb72289.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/43_3826f24b96.jpg"]'::jsonb, '[]'::jsonb, 'mfw-25ss-street4', 'published'),
('아바바브 SS25 백스테이지 with 밀란 패션 위크', '<PAP>가 아바바브 백스테이지 현장을 담아왔다', 'avavav-ss25-backstage-87', '2024-09-23', 'Fashion', '["avavav","ss25","backstage","아바바브","백스테이지","밀란 패션 위크","Milan Fashion Week"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_909020c421.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_35ba0080df.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">AVAVAV</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/jessequattro/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Tsai ShihFu</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_76353f2deb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_8db43f540f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_f031f98458.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_da06ceea51.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_dc6e5bb264.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_aa27e3d2b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_b61ed67ab3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_ed3be80ca9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_4c540dceb7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_0f7ecc21e5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_9f0d088f5a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_8e406c06d4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_6fad16e19c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_37558d1c2e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_e7539c4559.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_78657caefb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_d8ff9f211d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_8483d448f4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_c1124cc8a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_1d4b1dc0f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_25ec8f38bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_23515d8c15.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_862d48965c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_329b911e6a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_01d7a46127.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_8a41ba889e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_dac19f3e07.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_1bc9e95bb2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_8ad0afc4e9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_3d7ec6f2ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_2b0ebd8ff8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_8bf855fb2e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_302f7f669a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_27e0a89d90.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_3a19b205b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_ea8c5f9884.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/38_3a686c597a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_ff5bb1fff9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/40_cd7951a392.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/41_85b9dd9ff0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/42_b25bb99518.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/43_b4c53a490e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/44_0dd17a1b3c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45_a17b66d620.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/46_17c8816bb9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/47_6318335385.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/48_7c206540dc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/49_c93f2f90b5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/50_06dfd21c85.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/51_9e46333d93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/52_e678cff7ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/53_de1f8a5901.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/54_abd1db3faa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/55_2f49f703fb.jpg"]'::jsonb, '[]'::jsonb, 'avavav-ss25-backstage', 'published'),
('밀란 패션 위크 SS25 스트릿 스타일 Part.3', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-25ss-street3-88', '2024-09-21', 'Fashion', '["Milan Fashion Week","밀란 패션 위크","SS25","스트릿 스타일","STREET STYLE","mfw","2025 ss"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b814d9f08a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_fc57503e19.jpg', '<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_158fa0a98a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ccbb1f3431.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_08898f4237.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_903d600327.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_131bbc9052.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_0cea259e96.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_14c838f6d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_ea24c045d5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_017f491682.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_05a354c80c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_5be2c83c1d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_622bc0068b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_b3023cc793.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_cf2ce34a37.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_ac277a3c80.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_055dad65de.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_681a48acf5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_a07a41cf47.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_d2b5777462.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_c300e2a106.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_9e084ab13d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_e1676019ea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_89ba0542f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_4c65c2f1f8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_bf14298972.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_ca064ede86.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_6198cf9d0c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_a64a00b15a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_e8f2b15303.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_454765ecf5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_c8e7796503.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_9bdef36b6a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_90049b26b4.jpg"]'::jsonb, '[]'::jsonb, 'mfw-25ss-street3', 'published'),
('밀란 패션 위크 SS25 스트릿 스타일 Part.2', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-25ss-street2-89', '2024-09-20', 'Fashion', '["Milan Fashion Week","SS25","STREET STYLE","스트릿 스타일","밀란 패션 위크","mfw","prada","프라다"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_6e2da76e0d.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a2ce4ba0b0.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">PRADA</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_8cd5a055d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_8c06f9718c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_f60282e398.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_ff6d7d5f5b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2629b26549.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_455d07f0bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_90f8d5e8af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_0cfd67a2ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_7e4a915b03.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_2f179f79c1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_da2aa184ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_f059ed2cd1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_e786302427.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_8fa39bcbc4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_ba7df94ce6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_344405e65b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_c98aeb2d43.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_92ccc9bd78.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_e20620f344.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_2560da0c5e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_2d01b593de.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_beb59cc45b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_adb1ce45fc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_ebb49173c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_5ecc273161.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_490a8b203f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_3d91fdf00b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_642f8a91ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_f4d1bee25d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_8d251d5c0b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_f9f93fc5f5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_350e38abf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_1d6dd4b3ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_01c3a77a6f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_e1e85f337e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/37_eaf871c588.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/38_c2f56ff76c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_9c1f934e2e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/40_8ec66a2a80.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/41_3e006510dc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/42_287bbdcfa0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/43_a09c0af3f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/44_1b212e8e3d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/45_a42035065f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/46_c0560fcea1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/47_89eebb6443.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/48_9d042d4b22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/49_fcca2c8a5b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/50_d4a4571249.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/51_65dff5676c.jpg"]'::jsonb, '[]'::jsonb, 'mfw-25ss-street2', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('밀란 패션 위크 SS25 스트릿 스타일 Part.1', '<PAP>가 담아온 밀란 패션 위크 현장 공개', 'mfw-ss25-street1-90', '2024-09-18', 'Fashion', '["밀란 패션 위크","ss 2025","Milan Fashion Week","STREET STYLE","fendi","펜디","스트릿 스타일","송혜교"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0000_9d06e29240.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00000_cba17e230a.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">FENDI</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4c2f21e142.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_4a2eefd7b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ed804b254b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_048cb61500.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4b43d236fa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_c264b1a33c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b85175c2c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_87fb35052c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_69772ae9aa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_9d804ce4f1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_faac360004.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_1_f7ce9d3bb1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_4ce2940538.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_3265108463.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_a31daad1f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_51160b77cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_0ea0427182.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_db86efb392.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_b57dfab12e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_dcdc19fd39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_4c54882052.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_2faa613961.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_9000a6734a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_92309997e3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_863fe93236.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_e0e6ae5f81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_e5fd461e4d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_526b2cb63c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_43ec7c2922.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/29_fe7507e65b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_acef8da58f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_bdd1de4319.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_fffc6bde3c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_a2f3416aa0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_924b175b41.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_c07cfc6fb3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_785c35df79.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/37_88e5623e2b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/38_1e748fafde.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_f187c7b18c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/40_57bfb726e7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_fca4353c08.jpg"]'::jsonb, '[]'::jsonb, 'mfw-ss25-street1', 'published'),
('아이스버그 SS25 백스테이지 with 밀란 패션 위크', '<PAP>가 아이스버그 백스테이지 현장을 담아왔다', 'iceberg-ss25-backstage-91', '2024-09-18', 'Fashion', '["backstage","ICEBERG","백스테이지","ss25","2025 ss","밀란 패션 위크","MILAN FASHION WEEK"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_bae35f20d7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_8d920e80b0.jpg', '<p style="text-align:center; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">ICEBERG</p>
<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/claudiok_ph/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CLAUDIO K</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_31b81b2c92.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_da195e110d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_80bf9d3e65.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_6b005daa36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_ffed887999.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_e1511a624b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_b9c353adcc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_e39737e384.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_30193ba847.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_4c33058c72.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_8a21f65045.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_b7734949c6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_7f6ce9cb06.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_18ad0b23ff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_f2d9703830.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_e5179b4944.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_963501a3c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_77241bc74c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_5148479ccb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_1613c3fbf0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/21_d82cd1e5dd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_2c0aae025e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/23_6b7f26ef0c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_396b2fbba2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/25_7401ac75d3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/26_d6f6bafc66.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/27_e0e067ff3e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/28_c441cc73e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/30_cd9e2944e3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31_3ded497bef.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_0aef0b0dea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/33_98dacad03f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/34_bd5e28c689.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/35_bd699dbeba.jpg"]'::jsonb, '[]'::jsonb, 'iceberg-ss25-backstage', 'published'),
('한로로와 엄브로, 엄브로로가 되', '엄브로 필드 플레이어 크루 캠페인에 등장한 한로로!', 'categoryfashion3130news-92', '2024-09-11', 'Fashion', '["한로로","엄브로"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d79a1fa80e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d6d834864e.jpg', '<br>

<p style="text-align:left;">한로로, 엄브로의 키치한 미드필더가 되다. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>가 아티스트 <a href="https://www.instagram.com/hanr0r0/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">한로로</strong></a>와 ‘UMBRO FIELD PLAYER CREW’ 캠페인을 공개했습니다.</p>

<br>

<p style="text-align:left;">이번 캠페인은 각 분야에서 두각을 나타내는 언더독 아티스트들을 엄브로만의 시각으로 새롭게 조명하는 캠페인의 두 번째 챕터인데요.</p>

<br>

<p style="text-align:left;">필드 플레이어 크루 캠페인의 두 번째 주인공 한로로는 청춘을 이야기하는 서정적인 가사와 호소력 짙은 목소리로 페스티벌 관객들을 사로잡고 있습니다. </p>

<br>

<p style="text-align:left;">마치 경기장에서 창의적인 플레이를 펼치는 미드필더처럼 락·인디신에서 자신만의 감성을 표현하고 전파하는 한로로와 그녀만의 방식으로 경기의 흐름을 재치있게 이끌어가는 ‘Witty midfielder’ 컨셉이 더해진 캠페인. </p>

<br>

<p style="text-align:left;">지금 바로 엄브로 공식 온라인스토어에서 컨텐츠를 만나보실 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_e44938bd5a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_fb79bbbc52.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_4b5e5e2221.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_1_2007e3db9a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3130/news/', 'published'),
('미스치프의 아이디어 구프람과 만나다', '미스치프X구프람의 협업 전시 개최', 'categoryculture3129news-93', '2024-09-11', 'Culture', '["미스치프","구프람"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f591c9dfa6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_76a76f233c.jpg', '<br>

<p style="text-align:left;">미스치프의 아이디어, 구프람과 만나다.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/mschf/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미스치프</strong></a> X <a href="https://www.instagram.com/gufram/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">구프람</strong></a>의 혁신적인 협업. 유머러스하고 재치있는 작품으로 사랑받는 이들은 역시나 생각의 틀을 깨트리며 시선을 사로잡았는데요.</p>

<br>

<p style="text-align:left;">이번 협업은 미스치프의 첫 가구 데뷔작이자, 급진적인 디자인과 현대 문화를 대비시키는 요소들로 이루어져 있죠.</p>

<br>

<p style="text-align:left;">구프람의 프라토네 의자의 반 정도를 잘라내어 식물의 피 묻은 단면을 보여준 작품과 선인장 모양의 캑터스 코트랙에 알루미늄 5G 안테나를 부착하여 고속도로를 따라 설치된 안테나를 표현하기도 했습니다.</p>

<br>

<p style="text-align:left;">위트와 그 속에 숨은 디자인 혁신, 사회와 예술의 관련성에 대한 메시지가 빛나는 이들의 협업 작품을 슬라이드를 넘겨 만나보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_833a275025.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_3b0c5867f4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_3ac5df1d12.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_a931d701ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_5489aeff4e.jpg"]'::jsonb, '[]'::jsonb, '/category/Culture/3129/news/', 'published'),
('차은우와 캘빈클라인의 2024 가을 맨즈 캠페인', '차은우와 함께 한 클래식한 테일러링과 세련딘 감각에 주목해 보자', 'categoryfashion3125news-94', '2024-09-10', 'Fashion', '["캘빈클라인","차은우","CalvinKlein","ChaEunwoo"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8796b4d763.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_41a3849e65.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a>이 <a href="https://www.instagram.com/eunwo.o_c/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">차은우</strong></a>와 함께 한 2024년 가을 맨즈 어패럴 캠페인을 공개했습니다. </p>

<br>

<p style="text-align:left;">자연스럽고 따뜻한 분위기 아래 차은우의 그림 같은 순간을 그려내며 맨즈웨어의 클래식한 테일러링에 세련된 감각과 새로운 에너지가 더해진 모습! </p>

<br>

<p style="text-align:left;">2024년 가을 시즌을 맞이하여 캘빈클라인의 맨즈웨어 컬렉션은 아카이브 헤리티지 라인인 ‘캘빈클라인 스튜디오'' 상품들과 더불어 프리미엄 원단과 테일러링을 통해 클래식과 미니멀리즘을 재해석했죠. </p>

<br>

<p style="text-align:left;">차은우가 캠페인에서 착용한 클래식한 로고 티셔츠와 90s 스트레이트 진, 매트 보머 자켓, 코튼 트윌 카 코트 등을 지금 바로 캘빈클라인 공식 온라인 몰 및 전국 캘빈클라인 매장에서 만나 보세요! </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Calvin Klein</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Alternatives_5_d15ae2eeab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_F_CHA_PR_nologo_1_c589a5c7b9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_F_CHA_PR_nologo_2_7c59541e1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_F_CHA_PR_nologo_3_fc60c5cfff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_F_CHA_PR_nologo_4_5b6df355af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/24_F_CHA_PR_nologo_5_ef1551dfff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Alternatives_2_e92af89e0a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Alternatives_3_1e905ec221.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Alternatives_4_c23554bc1e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3125/news/', 'published'),
('나나의 화양연화 뒤에 숨겨진 메이크업에 대한 이야기', '프리랜서 메이크업 아티스트 김채원을 소개한다', 'artist-chaewon-95', '2024-09-10', 'Beauty', '["나나","makeup","artist","Kim Chae-won","behind","Nana","Hwayangyeonhwa","화양연화","메이크업","인터뷰"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_854d00af05.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4d2a81c987.jpg', '<p style="text-align:left;">최근 SNS를 뜨겁게 달군 나나의 에디토리얼. 매거진 화보처럼 보이는 이 에디토리얼은 사실 재능 있는 아티스트들이 모여 만들어낸 값진 결과물이다. 특히 PAP 에디터의 눈길을 끌었던 나나의 메이크업. 그럼 여기서 우리는 의문점이 생긴다. 이러한 메이크업 작업은 어떤 사람이 했으며, 어떤 생각을 가지고 했는지. 그래서 에디터는 그 주인공인 프리랜서 메이크업 아티스트 <a href="https://www.instagram.com/chaewonkeeem/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">김채원</strong></a>과 짧은 이야기를 나눴다.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 자기 소개를 부탁한다.</p>

<p style="text-align:left;"><strong>A.</strong> 프리랜서로 활동하고 있는 메이크업아티스트 김채원입니다. 광고, 룩북, 아티스트, 매거진 등 촬영을 위한 메이크업을 한다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 나나와 함께 한 작업이 엄청난 화제가 됐다. 이번 작업을 하게 된 계기가 있다면?</p>

<p style="text-align:left;"><strong>A.</strong> 나나 님이 포토 실장님께 작업 요청을 했다. 그래서 자주 합을 맞추던 팀이 모여 진행하게 되었다. 나나 님이 스토리가 있는 작업을 원했고, 소통한 내용을 토대로 스탭들이 촬영을 기획하여 제안했다. </p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 나나의 어떤 부분에 중점을 두고 작업을 했는지도 궁금하다.</p>

<p style="text-align:left;"><strong>A.</strong> 느낌을 살리는 것에 중점을 두고 작업했다. 바뀐 착장을 보고 즉흥적으로 작업한 룩도 있다. 왕가위의 영화 화양연화를 현대적으로 해석하며 퇴폐, 몽환적인 무드를 가져가고 싶었다.
<br><br>
나나님의 눈매와 눈빛이 나른하고 몽환적인 매력이 있다. 이번 작업에선 그런 점을 살리면 좋을듯해 또렷한 아이라인, 예쁘게 올라간 인형같은 속눈썹 연출은 생략했다. 대신 언더 아이메이크업과 블러셔에 힘을 줘서 무드를 연출했다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 메이크업 아티스트로서 활동하면서 고충이 있다면?</p>

<p style="text-align:left;"><strong>A.</strong> 큰 고충은 없다. 일을 하며 힘든 점은 당연히 동반 될 수밖에 없고 좋아하는 일을 업으로 삼았으면 그 정도는 감내해야 한다고 생각한다.
<br><br>
굳이 꼽자면 촬영장에는 예상치 못한 변수가 빈번히 발생하는 점이다. 이번 촬영 역시 그랬다. 여러 큰 변수가 작용해 6착장을 헤메 변형 포함 4시간 안에 찍어야했다.
<br><br>
시안은 시안일 뿐, 그날의 촬영에서 가져가야할 무드와 착장에 맞게 어디에 힘을 주고 빼야 할지 빠르게 판단하고 시간 대비 최대한의 예쁨을 끌어내야 했다. 이 외에도 변수는 많지만 보통은 극복하면 된다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 그렇다면 반대로 이 직업의 가장 매력적인 부분은 무엇인가?</p>

<p style="text-align:left;"><strong>A.</strong> 매력적인 점은 너무 많다. 일단 메이크업 자체가 재미있다. 같은 색조도 어디에 어떻게 얼마나 사용하냐에 따라 느낌이 달라지고, 같은 색상도 어떤 질감이냐에 따라 느낌이 달라진다. 피부 타입에 따라서 베이스 연출법도 다 다르다. 새로운 시도로 나만의 루틴을 찾아내는 것도 재미있다.
<br><br>
촬영을 하며 다양한 새로운 사람들을 만나고 그들과 호흡을 맞춰 멋진 결과물을 만들어내는 과정은 언제나 즐겁다. 결과물을 봤을 때도.
<br><br>
클라이언트의 니즈에 공감하고, 내 스타일대로 해석해서 완성한 결과물이 그들의 취향을 저격했을 때 도파민이 돈다. 이미 예쁜 얼굴을 예쁘게 만드는게 뭐가 어렵겠냐만은 같은 사람이라도 어떤 메이크업 룩을 얹느냐에 따라 분위기가 확확 변한다.
<br><br>
단점은 보완하고 장점은 살려 본연의 얼굴에서 매력을 최대로 끌어내는 작업도, 새로운 분위기를 찾아 주는 작업도 재미있다. 보편적으로 단점이라고 생각되는 얼굴의 특징도 때로는 매력 포인트가 되기도 한다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 요즘 푹 빠진 코스메틱 제품이 있다면 무엇인가?</p>

<p style="text-align:left;"><strong>A.</strong> 샤넬 N1 립앤치크밤, 투슬래시포 스트로빙 큐브</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 메이크업을 어려워하는 사람들에게 해 주고 싶은 조언.</p>

<p style="text-align:left;"><strong>A.</strong> 내가 가진 매력이 돋보이는 메이크업 룩을 찾으려면 다양하게 시도해 보는 것을 추천한다. 원래 예뻐지려면 어느 정도의 노력은 필요하다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 마지막으로 메이크업 아티스트로서 생각하는 아름다운 여성상이 있다면?
</p>

<p style="text-align:left;"><strong>A.</strong> 얼굴이 예쁜 사람은 많지만 자신만의 분위기가 있는 사람이 아름답다고 생각한다. 모든 사람은 고유의 매력이 있는데 분위기는 한순간에 생기는것이 아니고 그 매력을 찾아 갈고 닦아야 생기기 때문이다. 자신감 있는 태도와 단단한 내면도 중요하다.</p>

<br><br><br>

<p style="text-align:right; font-family: Montserrat;">Photographer. <a href="https://www.instagram.com/kimmoondog/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@kimmoondog</strong></a><br>
Hair. <a href="https://www.instagram.com/silvergun_96/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@silvergun_96</strong></a><br>
Makeup. <a href="https://www.instagram.com/chaewonkeeem/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@chaewonkeeem</strong></a><br>
Styling. <a href="https://www.instagram.com/sensyal/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@sensyal</strong></a><br>
Art. <a href="https://www.instagram.com/solty_kimyesol/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">@solty_kimyesol</strong></a></p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_5aaff6c3db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1_fd47ca042f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_2_220e36553e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_1_54b2af4a78.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_2_b057162619.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_ddc7bc4792.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_9744c41622.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_ae5640ca6d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2_2e26dfe009.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_a07e275098.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_1_d51793c5d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_2_6e2680b067.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a0eda05176.jpg"]'::jsonb, '[]'::jsonb, 'artist-chaewon', 'published'),
('마크곤잘레스의 하트가 되어 줘', '첫 번째 하트 컬렉션 ‘BE MY HEART’', 'markgonzales-bemyheart-96', '2024-09-09', 'Fashion', '["MARK GONZALES","BE MY HEART","마크곤잘레스","하트 컬렉션"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d9ebf1177a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_b722af4209.jpg', '<br>

<p style="text-align:left;">마크곤잘레스의 하트가 되어 줘! 
<br><br>
세계적인 프로 스케이터이자 유명 아티스트인 마크곤잘레스의 독특한 개성과 열정을 담은 스트릿 패션 브랜드 <a href="https://www.instagram.com/markgonzaleskorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마크곤잘레스</strong></a>!</p>

<br><br>

<p style="text-align:left;">바로 오늘(9일) 마크곤잘레스만의 첫 번째 하트 컬렉션 ‘BE MY HEART’ 컬렉션이 공개됐습니다.
<br><br>
밀란 스트릿에서 포착한 캐주얼하면서도 감각적인 마크곤잘레스만의 무드가 느껴지시나요? 스웨트 셔츠, 후드, 팬츠 그리고 룩의 포인트가 되어 주는 하트 심볼이 돋보이는 볼캡까지!
<br><br>
마크곤잘레스 특유의 자유로운 감성으로 재해석한 다채로운 구성의 하트 컬렉션이 궁금하다면 지금 바로 마크곤잘레스 공식 온라인 스토어에서 확인해 보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_8706a16ae8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_f164fefe1e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_871e1ec9da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_10994fafc3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_f2183b360b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_3f0e7ec8ff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_a31cae68c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_35f2c5bf70.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_1077a6c402.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_9848e91ea1.jpg"]'::jsonb, '[]'::jsonb, 'markgonzales-bemyheart', 'published'),
('포르쉐의 꿈과 기술의 초현실, 캡슐 드림스케이프', '캡슐 드림스케이프 #01 서울에서 꿈의 초현실성을 탐구하다', 'porschexcapsuledreamscapes-97', '2024-09-09', 'Life', '["Porsche","The Art of Dreams ","Dreamscapes","Taycan ","Taycan Turbo K Edition","포르쉐","더 아트 오브 드림","타이칸 터보 K 에디션 "]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c39eb640ff.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_ce066d073a.jpg', '<p style="text-align:left;">캡슐 드림스케이프 #01 서울에서 꿈의 초현실성을 탐구하다. 
<br><br>
혁신적인 큐레이션 플랫폼 <a href="https://www.instagram.com/capsule.global/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캡슐</strong></a>이 <a href="https://www.instagram.com/porsche/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포르쉐</strong></a>를 위해 큐레이팅한 드림스케이프 시리즈의 첫 번째 전시인 ‘캡슐 드림스케이프''의 시작은 바로 한국입니다.</p>

<br><br>

<p style="text-align:left;">국제 또는 국내외에서 선도적인 아티스트들이 참여한 이 프로젝트는 설치, 워크샵, 대화 및 청취 세션의 형태로 현실을 뛰어넘는 꿈의 잠재력과 장인정신의 미래라는 주제를 제시하는데요.</p>

<br><br>

<p style="text-align:left;">미래를 향한 혁신적인 기술과 디자인의 상징인 한정판 전기 스포츠카 모델인 타이칸 터보 K-Edition이 최초로 공개되었다는 점!</p>

<br><br>

<p style="text-align:left;">포르쉐의 혁신적인 디자인과 엔지니어링 요소를 통합하여 꿈의 초현실성을 탐구하는 이번 전시에 &lt;팝 매거진&gt;과 짧은 대화를 나눈 두 팀의 아티스트를 소개합니다. 
<br><br>
미국의 다재다능한 디지털 아티스트 <a href="https://www.instagram.com/ezzzrrra/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에즈라 밀러</strong></a> 그리고 서울을 기반으로 활동하는 디자인 스튜디오 <a href="https://www.instagram.com/niceworkshop_/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나이스워크숍</strong></a>입니다. </p>

<br><br>

<p style="text-align:left; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">Ezra Miller</p>

<p style="text-align:left;">뉴욕에 기반을 둔 다재다능한 디지털 아티스트 에즈라 밀러. 최첨단 그래픽 프로그래밍을 이용해 무한하게 실시간으로 생성되는 작품을 창작하고 있다.
<br><br>
이번 드림스케이프를 통해 그는 포르쉐 타이칸을 타고 차창 밖에서 움직이는 풍경을 포착했다. 영상은 몽환적이고 최면적인 실시간 생성 작업으로 처리했으며, 초현실적인 파노라마는 속도, 형태, 미래주의의 상호 작용을 탐구한다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 자기 소개.</p>

<p style="text-align:left;"><strong>A.</strong> 안녕하세요. 뉴욕에 사는 디지털 아티스트 에즈라 밀러입니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 아트 위크 기간 동안 ‘Dreamscapes’라는 포괄적인 주제 아래에서 작품을 선보였다. 간단하게 이번 ‘Capsule Dreamscapes’에서 선보인 작품 소개를 부탁한다.</p>

<p style="text-align:left;"><strong>A.</strong> 제 작품은 ‘Halving Motion’으로 불리는데요. 저는 포르쉐 타이칸을 타고 밖에 보이는 장면들을 찍은 샷들로 이 작품을 제작했고, AI를 활용해 이를 변형했습니다. 그리고 이 피스에 관한 아이디어는 몽환적 미학을 이용하는 것에 기반해요. AI가 그만의 톤을 가지고 있기 때문에 이 작업을 처리하기에 정말 좋은 매체라고 생각했는데요. 이런 환상적인 퀄리티를 가지고 있기도 하죠. 더불어 자동차에서 포착한 장면들의 움직임이 사실처럼 잘 구현되기도 했어요. </p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이 프로젝트에 참여하게 된 계기가 있다면 무엇인가?</p>

<p style="text-align:left;"><strong>A.</strong> 이 프로젝트에 참여하라고 권유받았고 저는 한 번도 서울에 와본 적이 없었거든요. 여기에서 제 작품을 보여드릴 수 있는 기회를 주셔서, 그리고 이 포르쉐 자동차를 이용한 작품을 선보일 수 있어서 정말 감사했어요. 너무 아름다운 자동차로 지난 달 베를린에서 재미있게 드라이브도 할 수 있어서 정말 좋은 경험이었습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 마지막으로 아티스트로서 이루고 싶은 ‘꿈(Dream)’이 있다면?</p>

<p style="text-align:left;"><strong>A.</strong> 아티스트로서 제가 이루고 싶은 꿈은 남은 제 삶이 다할 때까지 예술작품을 만드는 것인데요. 그리고 별다른 특별한 계획은 없어요. 그저 영감을 받고 보고싶은 작품을 제작하는 거죠. 그게 꿈이고, 그냥 계속 그걸 하고 있을 뿐이에요.</p>

<br><br><p style="text-align:left; font-size: 2.3REM; font-weight:800; font-family: Montserrat;">niceworkshop.</p>

<p style="text-align:left;">서울을 기반으로 활동하는 디자인 스튜디오 나이스워크숍. 현대적 장인 정신의 본질을 구현하며, 다양한 프로젝트를 통해 독특한 디자인 언어를 구축하고 있다.
<br><br>
이번 전시에서는 업사이클 브랜드인 FORMAT과 협업하여 개념 예술과 잠재 의식 사이의 실질적인 연결을 제공하는 맞춤형 환경을 조성한다.</p>

<br><br><p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 자기 소개.</p>

<p style="text-align:left;"><strong>A.</strong> 안녕하세요. 저는 나이스워크숍의 오현석이라고 합니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 아트 위크 기간 동안 ‘Dreamscapes’라는 포괄적인 주제 아래에서 작품을 선보였다. 간단하게 이번 ‘Capsule Dreamscapes’에서 선보인 작품 소개를 부탁한다.</p>

<p style="text-align:left;"><strong>A.</strong> 저희는 이번 전시에서 다양한 재료들을 사용해서 제작한 오브제 컬렉션을 선보이고 있습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이 프로젝트에 참여하게 된 계기가 있다면 무엇인가?</p>

<p style="text-align:left;"><strong>A.</strong> 저희는 ‘메테리얼 이노베이션''이라는 주제로 참여하게 되었는데요. 저희가 지금까지 사용했던 재료들과 그 재료들로 어떤 과정으로 작업을 했는지를 선보이는 전시라고 보시면 되겠습니다.</p>

<br><br><p style="text-align:left;">일시 : 2024.09.04 (수) ~ 2024.09.08 (일)<br>
장소 : 서울시 성동구 연무장길 26, 베이직 스튜디오</p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes1_1649ff5b7d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes2_4543b2d8d8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes3_4aa79fdcdd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes4_b41283de41.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes5_447857c969.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes6_4e8ed1be4c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes7_4a827d40e2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes8_6939cc7a24.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes9_a33bdac2f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes10_a48dc07a1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes11_87cf96225f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes12_6e3ebd3180.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Dreamscapes13_17067d6f36.jpg"]'::jsonb, '[]'::jsonb, 'porschexcapsuledreamscapes', 'published'),
('트와이스 지효와 함께 한 아미 FW24 캠페인', '아미의 프렌드 오브 더 하우스인 트와이스 지효', 'categoryfashion3109news-98', '2024-08-30', 'Fashion', '["지효","아미"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_558af0e026.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_afbab6793a.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/amiparis/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아미</strong></a>가 프렌드 오브 더 하우스인 <a href="https://www.instagram.com/twicetagram/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">트와이스</strong></a> <a href="https://www.instagram.com/_zyozyo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지효</strong></a>와 함께 한 24년 가을-겨울 캠페인이 공개됐습니다. </p>

<br>

<p style="text-align:left;">지난 아미의 SS25 파리 패션 위크 남성복 위크에서도 모습을 드러낸 지효가 이번에는 아미의 캠페인에 등장했는데요. </p>

<br>

<p style="text-align:left;">포인트 토 레이스-업 슈즈, 파리파리 백, 브라운 테일러드 레디 투 웨어와 블랙 드레스 등 재기발랄하면서 시대를 초월한 부르주아적 매력을 선사하는 아미의 에센셜 아이템은 지효를 만나 마침내 완성되었다고 해도 과언이 아니죠. </p>

<br>

<p style="text-align:left;">지금 바로 슬라이드를 통해 확인해 보세요! </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Ami</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_235bfca40b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d46d5f8c4d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_9399e7c6e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_8de900e296.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_6ed97206a2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_ebc97919c5.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3109/news/', 'published'),
(' 에스파의 카리나가 프라다 앰버서더로 발탁됐다', '지난 밀란 패션 위크 쇼 참석 이후 앰버서더 발탁 소식을 알렸다', 'categoryfashion3106news-99', '2024-08-28', 'Fashion', '["카리나","프라다"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_ca90a264d5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d3482a65bc.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/aespa_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에스파</strong></a> <a href="https://www.instagram.com/katarinabluu/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">카리나</strong></a>가 <a href="https://www.instagram.com/prada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프라다</strong></a>의 앰버서더로 발탁됐습니다. </p>

<br>

<p style="text-align:left;">평소 인스타그램을 통해 프라다에 대한 애정을 계속해서 보여 줬던 카리나! 지난 밀란 패션 위크 FW24 쇼 참석에 이어 정식으로 앰버서더 발탁 소식을 알린 것인데요.
</p>

<br>

<p style="text-align:left;">앞으로가 더욱 기대되는 프라다와 카리나의 만남, 이거 정말 귀하네요. </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Prada / @katarinabluu </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_89700dbe88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_1cf606c66a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3c95059a2f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3106/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('SS25 글로벌 패션 위크 스트릿을 사로잡은 캉골', '밀란, 파리 패션 위크 스트릿에서 포착한 캉골', 'categoryfashion3107news-100', '2024-08-28', 'Fashion', '["캉골","KANGOL","후드티","후디","AW24","KANGOLKOREA"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Kakao_Talk_Photo_2024_08_28_18_00_19_001_8786b5cf41.jpeg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Kakao_Talk_Photo_2024_08_28_18_00_19_002_e1aa3dfa43.jpeg', '<p style="text-align:left;">SS25 글로벌 패션 위크 스트릿을 사로잡은 캉골. 
<br><br>
이번 시즌 패션 위크 스트릿을 장악한 브랜드가 있다면 바로 <a href="https://www.instagram.com/kangolkorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캉골</strong></a>입니다.
</p>

<br><br><p style="text-align:left;">특히 주목할 만한 아이템인 트렌디하면서도 캐주얼한 무드의 캉골 24AW 그라데이션 로고 후디. 
<br><br>
오버핏 실루엣에 기모 안감의 스웨트 셔츠로 후로피 그라데이션 기법이 적용된 캉골 심볼이 포인트라고 할 수 있는데요. 패션 위크 스트릿에서 그 어떤 아이템보다 스타일리시하게 연출 가능해 패션 피플들의 많은 사랑을 받았다고 하네요.
<br><br>
챠콜과 핑크 두 가지 컬러의 그라데이션 로고 후디를 지금 바로 캉골 온-오프라인 스토어에서 만나 보세요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_665e75f7af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ce2679cbb1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0e0a6c2aeb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_e00beed91b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_81ee66bcaa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_0288c6b698.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_65a7d5ff68.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_09577e62f1.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3107/news/', 'published'),
('웰던의 꿈과 현실이 충돌하는 새로운 FW24 캠페인', '2024 가을/겨울 캠페인 ‘Tilt, Swivel’', 'categoryfashion3102news-101', '2024-08-21', 'Fashion', '["웰던"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_da44ca4c62.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5eb484dfe5.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/we11done/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">웰던</strong></a>이 새로운 2024 가을/겨울 캠페인 ‘Tilt, Swivel’을 공개했습니다.
</p>

<br>

<p style="text-align:left;">브랜드의 헤리티지를 담은 새로운 컬렉션은 예술과 패션의 새로운 조화를 만든 매혹적인 구성으로 클래식한 미학과 동시대적 감각의 조우를 선보이죠. </p>

<br>

<p style="text-align:left;">이번 캠페인에서 웰던은 LA의 아늑한 교외 주택을 배경으로 일상의 순간을 감각적으로 포착합니다. </p>

<br><br>

<br>

<p style="text-align:left;">컬렉션 아이템은 대부분 클래식한 아이템을 구성되어 있지만 그에 대조되는 정교한 디자인 디테일 또한 돋보인다는 점! </p>

<br>

<p style="text-align:left;">클래식한 실루엣의 세련미를 즐기고 평범함을 넘어서는 것을 두려워하지 않는 이들을 위한 이번 컬렉션을 통해 꿈과 현실이 충돌하는 새로운 경험을 만끽해 보세요. </p>

<br><br>

<br>

<p style="text-align:left;">Credit. We11done</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_59594c52a9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_4786823be9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_1b215efd24.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_623d35a00e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/05_0419010f30.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/06_7ffb71fa38.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/07_4421b9376d.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3102/news/', 'published'),
('레스포색과 헬로키티의 50주년을 축하해!', '두 브랜드의 50주년 기념 특별한 콜라보레이션', 'categoryfashion3100news-102', '2024-08-20', 'Fashion', '["레스포색","헬로키티","산리오"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_922a286f15.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1294996c53.jpg', '<br>

**<p style="text-align:left;">레스포색과 헬로키티의 50주년을 축하해!</p>**

<br>

<p style="text-align:left;">뉴욕 라이프스타일 브랜드 <a href="https://www.instagram.com/lesportsac_korea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">레스포색</strong></a>이 50주년을 맞이하여 특별한 콜라보레이션을 진행합니다.  </p>

<br>

<p style="text-align:left;">콜라보레이션의 주인공은 바로 <a href="https://www.instagram.com/sanrio_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">헬로키티</strong></a>! 레스포색의 기능성과 헬로키티의 귀여움이 만나 탄생한 아이코닉한 매력이 돋보이는 한정판 컬렉션이 될 예정인데요. </p>

<br>

<p style="text-align:left;">이번 만남을 기념하여 오프라인 팝업 스토어 또한 개최됩니다. 팝업 스토어 단독으로 콜라보레이션 전 제품 할인 혜택도 주어진다고 하니 절대 놓치지 마세요! </p>

<br>

<p style="text-align:left;">22일부터는 <a href="https://www.instagram.com/kream.co.kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">크림</strong></a>에서 온라인 단독 프리 오픈도 진행할 예정이라고 하네요. </p>

<br><br>

<br>

* <p style="text-align:left;">단독 프리오픈: 2024.08.22(목)-08.27(화) * KREAM 단독 진행 </p>
* <p style="text-align:left;">공식 발매일: 2024.08.29(목) 레스포색 압구정 플래그십 스토어 및 공식 홈페이지</p>
* <p style="text-align:left;">팝업 스토어: 2024.08.29(목)-09.12(목), 레스포색 압구정 플래그십 스토어 (공식 발매일과 동일) </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/x_50_1_73b9d97349.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_5e5acefe64.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_15ff351ae9.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_a47483c34a.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2434827a3a.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_2543efc179.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_b7f768025d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_13fe4effdf.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_c7a2242ab2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cd07d637b4.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3100/news/', 'published'),
('휴먼메이드 인 코리아!', '휴먼메이드가 국내 첫 오프라인 스토어를 개장한다', 'categoryfashion3090news-103', '2024-08-13', 'Fashion', '["휴먼메이드","성수"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_4cc9d2304f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_99c234434d.jpg', '<br>

<p style="text-align:left;">휴먼메이드가 성수에 상륙한다. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/humanmade/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">휴먼메이드</strong></a>가 한국에 오프라인 스토어를 선보인다는 소식. 이들은 SNS로 서울 오프라인 매장을 성수에서 열겠다고 밝혔는데요.</p>

<br>

<p style="text-align:left;">웍스아웃이 휴먼메이드의 한국 오프라인 스토어를 함께 담당하며, 올 9월 7일 개장 예정.</p>

<br>

<p style="text-align:left;">휴먼메이드의 감성을 일본이 아닌 한국의 샵에서도 마음껏 즐길 수 있게 되었죠. 추후 더 자세한 소식도 PAP매거진에서 만나보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/New_items_from_Season_28_will_be_available_on_Saturday_August_10th_at_HUMAN_MADE_stores_and_humanmade_jp_c10adebbf3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_60cf9f60ff.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3090/news/', 'published'),
('패션 위크에서 만나 더 빛나는 코닥어패럴', '밀란, 파리 패션위크 스트릿에서 만난 코닥어패럴', 'categoryfashion3063news-104', '2024-07-23', 'Fashion', '["Kodak","KodakApparel ","KODAKSTYLE ","코닥","코닥어패럴","코닥스타일","반팔티셔츠","반팔티","데일리룩","여름신상"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b8995df608.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a33a3898a8.jpg', '<br>

**<p style="text-align:left;">#제작협찬 코닥의 분위기, 코닥만의 스타일 </p>**

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/kodakstyle_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">코닥어패럴</strong></a>이 지난 밀란, 파리 패션 위크 스트릿 속에서 아이코닉한 분위기로 시선을 집중시켰습니다. </p>

<br>

<p style="text-align:left;">컬러감이 돋보이는 코닥의 24SS 컬렉션과 우수한 소재와 현대적인 디자인을 담은 코닥의 새로운 프리미엄 라인 코닥 프로페셔널까지 만나볼 수 있어 더욱 특별했는데요. </p>

<br>

<p style="text-align:left;">코닥의 아이코닉한 디자인과 색감으로 올 여름, 나만의 스타일링을 더욱 빛내보는 건 어떨까요? </p>

<br><br>

<a href="https://www.instagram.com/p/C9v53E1Sni9/?img_index=1" style="text-decoration-line:none; color: gray;" target="_blank"><p style="text-align:right; font-size: 1rem; color: gray; font-weight:400;">Credit. PAP</p></a>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b398221784.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_5bfab373ec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e0a0d26a14.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_6ef418d736.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_7f3f89f4f4.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3063/news/', 'published'),
('블랙핑크 리사 루이 비통 글로벌 앰버서더 발탁!', '리사, 루이 비통 하우스의 글로벌 앰버서더로 발탁', 'categoryfashion3065news-105', '2024-07-23', 'Fashion', '["리사","루이비통"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111_a3ec0562a7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0b84a45f60.png', '<br>

<p style="text-align:left;">블랙핑크 리사 루이 비통 글로벌 앰버서더 발탁! </p>

<br>

<p style="text-align:left;">꾸준히 <a href="https://www.instagram.com/louisvuitton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이 비통</strong></a>과의 좋은 관계를 보여 주고 있는 <a href="https://www.instagram.com/blackpinkofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">블랙핑크</strong></a>의 <a href="https://www.instagram.com/lalalalisa_m/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리사</strong></a>가 루이 비통 하우스의 앰버서더로 발탁되었습니다. </p>

<br>

<p style="text-align:left;">지난 FW24 패션쇼에 깜짝 등장해 인간 루이비통 그 자체를 보여 준 리사. 앞으로는 루이 비통과 함께 공식 앰버서더로서의 행보를 보여 줄 예정이라고 하네요. </p>

<br>

<p style="text-align:left;">루이 비통의 아티스틱 디렉터인 <a href="https://www.instagram.com/NicolasGhesquiere/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">니콜라 제스키에르</strong></a> 또한 믿을 수 없을 정도로 매력적이고 대담한 정신과 카리스마를 가지고 있는 리사와 여정에 동행하게 돼서 기쁘다는 소감을 밝혔습니다. </p>

<br>

<p style="text-align:left;">Credit. louis Vuitton </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111_7a34b375d2.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3065/news/', 'published'),
('상상치도 못한 조합!  디네댓 x 미니언즈 콜라보', '미니언즈의 캐릭터와 유니크한 폰트가 새겨진 의류와 악세서리 라인', 'categoryfashion3038news-106', '2024-07-16', 'Fashion', '["디스이즈네버댓","디네댓","미니언즈","thisisneverthat","Minions"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_736db5d713.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_78b868df31.png', '<br>

<p style="text-align:left;">상상치도 못한 만남! 디네댓 X 미니언즈 콜라보 

<br><a href="https://www.instagram.com/thisisneverthat/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디스이즈네버댓</strong></a>과 <a href="https://www.instagram.com/minions/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미니언즈</strong></a>의 새로운 만남이 우리 곁에 찾아옵니다. 

<br>미니언즈의 캐릭터와 귀여운 폰트가 새겨진 바람막이, 티셔츠, 팬츠 등 의류라인과 더불어 모자와 키링 등 악세서리까지!

<br>오는 20일부터 디스이즈네버댓 온라인과 오프라인 매장에서 만나볼 수 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451211868_1143568846936356_9105573394541280677_n_0a6cdf7890.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451434998_700218398921282_3651782870965704102_n_71b5b60cac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451296610_1893193657865715_2277069976360908993_n_5b11fa5eea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451230003_1373313206958325_8412561155708351863_n_6ba0338f83.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451066942_705763065021366_926390867283689719_n_9290211a54.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451230010_705878034998393_2115000653922442651_n_2ffd8f5f8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451008442_807449061528093_5547183094317222200_n_6def382ea4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/451211859_845060167684847_4245219736615221155_n_702668c1b8.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3038/news/', 'published'),
('최고와 최고가 만났다 뮈글러X젠틀몬스터 협업 컬렉션', '뮈글러의 1997년 선글라스 아카이브에서 영감을 받은 협업 컬렉션', 'categoryfashion3018news-107', '2024-07-10', 'Fashion', '["뮈글러","젠틀몬스터","선글라스","Mugler","Gentle Monster","sunglasses"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_53b1c05ed3.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_212c9a70cf.png', '<center>

</center>

<center>

</center>

<center>

</center>

<br>

<p style="text-align:left;">
최고와 최고의 만남, 뮈글러 X 젠틀 몬스터 

<a href="https://www.instagram.com/muglerofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">뮈글러</strong></a>와 <a href="https://www.instagram.com/gentlemonster/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">젠틀몬스터</strong></a>의 혁신적인 만남이 이루어졌습니다. 

<br>뮈글러가 1997년 발표한 Les Insectes 컬렉션 ’Fourmis‘ 선글라스 아카이브에서 영감을 받은 이번 협업 컬렉션은, 뮈글러의 시그니처인 스파이럴 디테일에 젠틀 몬스터만의 감각적인 무드가 더해졌는데요.

<br>기하학적이면서 강렬한 에너지가 표현된 ’Spiral 01‘부터 유기적인 라인 디테일과 크롬 로고 장식의 조화가 돋보이는 ’Spiral 02’, 두 가지 실루엣으로 만나볼 수 있는 이번 뮈글러 X 젠틀 몬스터 협업 컬렉션은 오는 18일 출시될 예정이라고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/x_MUGLER_Campaign_Image_1_V_40cd8c46ee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/x_MUGLER_Campaign_Image_2_V_82cd13ff1c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/x_MUGLER_Campaign_Image_3_V_887ecf068f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/x_MUGLER_Campaign_Image_4_f3f5c6aeb7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Concept_Product_SPIRAL_01_C1_ORANGE_1080_1350_7c3f07ba2e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Concept_Product_SPIRAL_01_CS_1_PINK_1080_1350_64a5a07e55.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Concept_Product_SPIRAL_01_M01_1080_1350_1_0a2306b253.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Concept_Product_SPIRAL_02_CS_1_1080_1350_3_4d595a37b9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Concept_Product_SPIRAL_02_M01_1080_1350_1_fc3652887f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Concept_Product_SPIRAL_02_V1_PURPLE_1080_1350_f7f4a52b60.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3018/news/', 'published'),
('무신사 스탠다드의 팀 코리아 단복이 공개됐다', '2024 제33회 파리하계올림픽 단복 참여', 'categoryfashion3009news-108', '2024-07-09', 'Fashion', '["무신사","올림픽","무신사스탠다드"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d19f66e8a7.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a3256887e4.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/musinsa_standard/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">무신사 스탠다드</strong></a>가 제19회 항저우 아시아경기대회에 이어 대한민국 국가대표의 새로운 유니폼을 공개했습니다. </p>

<br>

<p style="text-align:left;">바로 오는 26일 개최되는 2024 제33회 파리하계올림픽 단복에 참여한 것! </p>

<br>

<p style="text-align:left;">청색을 활용한 벨티드 슈트 셋업으로 구성된 국가대표 단복은 동쪽을 상징하는 청색을 사용해 젊음의 기상과 진취적인 정신을 담고 있습니다. </p>

<br><br>

<br>

<p style="text-align:left;">청색 중에서도 유난히 차분한 느낌을 자아내는 벽청색! 신축성 있는 서머 울 소재를 사용해 편안하고 쾌적한 착용감까지 놓치지 않았다고 하네요. </p>

<br>

<p style="text-align:left;">블레이저 안감은 청화 백자의 아름다운 무늬로 한국적 미를 표현했으며, 관복에 두르던 각대를 재해석한 벨트도 확인할 수 있습니다. </p>

<br>

<p style="text-align:left;">블레이저, 슬랙스, 티셔츠, 벨트, 양말, 스니커즈, 팬던트 목걸이 등 총 7개의 아이템으로 구성된 팀 코리아 국가대표 단복을 지금 바로 확인해 보세요! </p>

<br><br>

<br>

<p style="text-align:left;">Credit. musinsa </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_85a834a5d1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_825006ef9f.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_7b59e356e0.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_9b9303a57d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_6c0d4f219b.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d0068df258.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e5651f142c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_f59b39c108.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/3009/news/', 'published'),
('더 시원해진 슬램잼X푸마 모스트로', '슬램잼이 출시할 예정인 푸마 협업 모스트로', 'categoryfashion3010news-109', '2024-07-09', 'Fashion', '["slamjam","puma","Mostro","슬램잼","푸마","모스트로"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3f49864eaa.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_0d7ad8fb5a.png', '<center>

</center>

<br>

<p style="text-align:left;">

서브컬쳐 스타일의 대명사 격인 이탈리안 편집샵  <a href="https://www.instagram.com/slamjam/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슬램잼</strong></a>이 <a href="https://www.instagram.com/pumasportstyle/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a> 협업 모스트로 출시를 예고했습니다.

<br>푸마가 1999년 출시한 모스트로는 올해 25주년을 맞이 했는데요. 

<br>슬램잼이 공개한 영상에 따르면, 해당 제품은 모스트로 기존 모델의 스프린트 스파이크와 스트랩 디자인은 유지한 아쿠아 슈즈로 발매될 예정으로 보이는데요. 

<br>시원한 메쉬 소재감과 블랙/화이트 컬레웨이는 여름철 해변가를 넘어 다양하게 스타일링 가능할 것으로 보이고 있습니다.

<br>추후 발매될 슬램잼X푸마 모스트로의 앞으로의 소식도 &#60;PAP&#62;를 통해 만나보세요! </p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/3010/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('프레드 첫 글로벌 앰버서더 BTS 진 발탁!', '프랑스 하이엔드 주얼리 프레드', 'categoryfashion3003news-110', '2024-07-08', 'Fashion', '["프레드","진"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_09a4ffb7eb.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1af3efb66c.png', '<br>

<p style="text-align:left;">프랑스 하이주얼리 메종 <a href="https://www.instagram.com/Fredjewelry/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프레드</strong></a>의 글로벌 앰버서더로 BTS <a href="https://www.instagram.com/jin/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">진</strong></a>이 선정됐습니다. </p>

<br>

<p style="text-align:left;">브랜드에서 처음으로 발탁한 글로벌 앰버서더인 만큼 더욱 특별한 프레드와 진의 만남! </p>

<br>

<p style="text-align:left;">프레드는 진의 빛나는 에너지와 예술적 자질, 가치관이 사람들에게 강력한 공명을 주고 있다고 소감을 밝힌 바 있죠. </p>

<br>

<p style="text-align:left;">군 제대 후 다양한 활동 소식을 전하고 있는 진의 다음 행보는 어디일까요? 앞으로가 더욱 기대됩니다. </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Fred </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_87aeff7cda.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_1718de8618.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/3003/news/', 'published'),
('글로벌 패션 위크에서 포착한 ‘프로젝트 프로덕트’', '프로젝트 프로덕트와 함께 한 밀란, 파리 패션 위크 스트릿 스타일', 'categoryfashion2974news-111', '2024-07-01', 'Fashion', '["Paris Fashion Week","Milan Fashion Week","PROJEKT PRODUKT","패션 위크","프로젝트 프로덕트","스트릿 스타일","Street Style","파리 패션 위크","밀란 패션 위크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b2924a3752.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_15dbbd4116.jpg', '<p style="text-align:left;">프로젝트 프로덕트의 지적인 고급스러움 그리고 따뜻한 미니멀리즘.
<br><br>
지난 밀란, 파리 패션 위크 스트릿에서 포착한 <a href="https://www.instagram.com/projektprodukt/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프로젝트 프로덕트</strong></a>의 스타일리시한 모먼트를 공개합니다.</p>

<br><br>

<p style="text-align:left;">안경 광학사의 철학과 디자이너의 감성, 두 축의 견고한 결합으로 매시즌 메인, 캡슐 컬렉션을 이어나가고 있는 프로젝트 프로덕트.</p>

<br><br>

<p style="text-align:left;">브랜드의 시그니처 라인과 2024 시즌 컬렉션으로 이번 SS25 글로벌 패션 위크에서 트렌디한 아이웨어로서의 확실한 존재감을 보여 줬습니다. </p>

<br><br>

<p style="text-align:left;">프로젝트 프로덕트의 아이웨어는 어떤 옷차림과도 무리 없이 어우러지며, 편안함을 유지하는 형태를 가져 국내외로 라이징한 브랜드로 떠오르고 있다는 점!</p>

<br><br>

<p style="text-align:left;">앞으로 글로벌 시장에서 프로젝트 프로덕트가 선보일 감도 높은 디자인과 우수한 기술력이 더욱 기대되는 바네요. </p>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_ac715d3551.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_e5f5675da1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8d7f874b36.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_9970a86047.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_b00b8f0a04.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_41108fbcfe.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_c104efccb7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_9a79dca510.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_83e465abf5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_e4a9abd25a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2974/news/', 'published'),
('태양보다 더 찬란한 민규와 불가리의 캠페인 공개', '세븐틴 민규의 불가리 워치 스타일링 캠페인', 'categoryfashion2966news-112', '2024-06-29', 'Fashion', '["민규","불가리","워치"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_44ea05ffae.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8600864b2b.jpg', '<br>

<p style="text-align:left;">Q. 민규씨 어디 사세요? A : 불가리 17번지요. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/Bvlgari/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">불가리</strong></a>가 앰버서더인 <a href="https://www.instagram.com/min9yu_k/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">세븐틴 민규</strong></a>와 함께한 워치 스타일링 캠페인을 공개했습니다.</p>

<br>

<p style="text-align:left;">옥토피니시모와 옥토로마 그리고 불가리 워치가 더해진 이번 캠페인 속에서 민규는 자연스러운 매력과 다양한 분위기를 연출하며 불가리의 워치 컬렉션들을 소개했는데요.</p>

<br>

<p style="text-align:left;">불가리 타임리스한 디자인과 럭셔리함이 민규의 분위기와 조화롭게 어울리는 모습.</p>

<br>

<p style="text-align:left;">한여름의 태양보다 더욱 찬란한 민규와 불가리의 반짝이는 만남을 PAP 매거진에서 확인하세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3bff3206f6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_a75569ef53.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_903dc6dccd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_1b0a19354e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_724d69b2fe.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2966/news/', 'published'),
('하반기를 함께 달릴 푸마의 새로운 스피드캣 OG', 'F/W 시즌 앞서 ‘스피드캣 OG’ 발매', 'categoryfashion2957news-113', '2024-06-27', 'Fashion', '["Puma","스피드캣","푸마","Speedcat","fw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_6038f948fe.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2fc9519b1e.jpg', '<p style="text-align:left;">올 하반기도 스피드캣과 함께! 
<br><br>
<a href="https://www.instagram.com/PUMA_KR/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>가 F/W 시즌에 앞서 아이코닉 스니커즈 ‘스피드캣 OG’를 출시합니다.
<br><br>
‘LIBERATE YOURSELF WITH SPEEDCAT’이라는 슬로건 아래 깊은 내면 속 숨겨진 ''진정으로 자유로운 나’를 조명하며, 스피드캣과 함게 각양각색의 개성 있는 인물들이 표현한 자유로움을 담아냈는데요.
</p>

<br><br>

<p style="text-align:left;">새롭게 출시되는 스피드캣 OG는 기존 스웨이드보다 향상된 울트라 스웨이드 소재를 활용했으며, 텅과 힐 탭의 금박 로고, 앞 코의 캣 자수 로고가 들어간 것이 특징입니다.</p>

<br><br>

<p style="text-align:left;">블랙과 레드 두 가지 색상의 스피드캣 OGsms 29일부터 푸마 공식 온라인 스토어와 일부 오프라인 스토어, 무신사, 29cm, 엠프티 등에서 만나 볼 수 있다고 하니 놓치지 마세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d26c09638f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_6b9856f095.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_9524e43bbf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_3fbb9e8b11.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_4e80b7bfdc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_586a905c25.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_d323d75802.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2957/news/', 'published'),
('로에베의 새로운 얼굴, 왕이보', '글로벌 스타 왕이보가 로에베의 새로운 얼굴로 발탁됐다', 'categoryfashion2940news-114', '2024-06-23', 'Fashion', '["왕이보","로에베","wangyibo"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_6981_c9276602dc.JPG', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e65b51476b.png', '<br>

<p style="text-align:left;">글로벌 스타 <a href="https://www.instagram.com/yibo.w_85/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">왕이보</strong></a>가 <a href="https://www.instagram.com/loewe/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">로에베</strong></a>의 새로운 앰버서더로 발탁됐습니다. </p>

<br>

<p style="text-align:left;">다재다능한 배우이자 가수, 모터사이클 레이서로 세계 각국에 많은 팬을 보유한 왕이보! 이번 SS25 <a href="https://www.instagram.com/parisfashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">파리 패션 위크</strong></a>에 모습을 드러내며, 앰버서더로서 첫 활동을 전개했습니다. </p>

<br><br>

<br>

<p style="text-align:left;">로에베의 크리에이티브 디렉터 <a href="https://www.instagram.com/jonathan.anderson/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">조나단 앤더슨</strong></a>은 여러 방면에서 창의성을 펼치는 왕이보의 행보를 사랑하며, 로에베 고유의 정체성과도 맞닿아 있다고 소감을 밝힌 바 있죠. 앞으로의 로에베와 왕이보의 행보도 기대됩니다!</p>

<br>

<p style="text-align:left;">Credit. Loewe</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_6981_b901e3b1e8.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_6982_2a426e0ede.JPG"]'::jsonb, '[]'::jsonb, '/category/Fashion/2940/news/', 'published'),
('이번 여름은 멀버리와 함께 춤을!', '여름 시즌에 어울리는 라피아 소재의 멀버리 신상품', 'categoryfashion2912news-115', '2024-06-17', 'Fashion', '["멀버리","mulberry"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_3b243c2880.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_ebb49b2027.png', '<br>

<p style="text-align:left;">
이번 여름은 멀버리와 함께 춤을 

<br>영국 럭셔리 라이프스타일 브랜드 <a href="https://www.instagram.com/mulberryengland/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">멀버리</strong></a>가 여름 시즌에 어울리는 라피아 소재의 신상품을 출시합니다.  

<br>이번 시즌의 라피아는 면과 비스코스를 혼방한 친환경 FSC 인증 소재로, 전통적인 핸드메이드 직조 공예에서 영감을 받아 제작되어 클래식한 바디와 고급스러운 가죽 트리밍이 조화를 이루며 세련미를 더하는 것이 특징인데요. 

<br>뜨거운 햇볕을 막아주면서도 밋밋한 여름 스타일링에 포인트를 줄 수 있는 섬머 라피아 햇 3종도 만나보실 수 있어 더욱 특별하네요. 

<br>해당 제품들은 지금 멀버리 공식 웹사이트를 통해 만나볼 수 있습니다. 

<br><br>

1. Pimlico Satchel | 1,625€

2. Clovelly Tote | 1,375€ (Mini Tote 835€)

3. Raffia Basket Tote | 715€

4. Pimlico Bucket | 1,195€

5. Raffia Sun Hat | 235€

6. Braided Bucket Hat | 210€

7. Summer Boater Hat | 215€

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_f32a31f101.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_c78ccbd80d.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_32aca9a40e.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_6fe7d564c9.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4b9eaeb883.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_513a903ac5.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_1_15e7e0732e.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e1db5eca23.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_4cf8ce073a.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/2912/news/', 'published'),
('살로몬이 준태 킴을 만나면 어떨까?', '준태 킴의 살로몬 커스텀 컬렉션 공개', 'categoryfashion2909news-116', '2024-06-16', 'Fashion', '["준태킴","살로몬"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4f5f6504ce.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_58b39b7d88.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/juuntaekim/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">준태 킴</strong></a>, <a href="https://www.instagram.com/salomonsportstyle/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">살로몬</strong></a> 커스텀 컬렉션 공개! </p>

<br>

<p style="text-align:left;">준태 킴이 SS25 시즌을 맞이하여 특별한 컬렉션을 공개했습니다. 살로몬의 서포트를 받아 완성된 커스텀 컬렉션이 바로 그것! </p>

<br><br>

<br>

<p style="text-align:left;">살로몬의 XT-6, RX MOC 3.0, RX SLIDE 3.0 그리고 SNOWCROSS는 준태 킴을 만나 독보적인 존재감의 슈즈로 재탄생했습니다. </p>

<br>

<p style="text-align:left;">준태 킴만의 아이코닉한 페탈 쉐입, 심실링 테크닉, 슬래시 컷아웃, 게더 디테일이 더해져 크리에이티브한 동시에 실용적인 디자인으로 완성되었죠. </p>

<br><br>

<br>

<p style="text-align:left;">브랜드의 상징적인 요소들은 살로몬의 시그니처 모델들과 만나 총 네 가지의 컬렉션으로 완성되었습니다. 준태 킴만의 미학적 비전을 구현하는 데 집중한 모습도 확인할 수 있는데요. </p>

<br>

<p style="text-align:left;">꽃잎에서 영감을 받은 정교함과 역동적인 슬래싱 기법이 결합된 동시에 야외 스포츠 스타일 신발 디자인의 본질까지 놓치지 않았다고 하네요. </p>

<br><br>

<br>

<p style="text-align:left;">준태 킴의 SS25 컬렉션의 주제는 ''NEW ROMANTICS’입니다. 비비안 웨스트우드의 초기 컬렉션에서 영감을 받은 이 컬렉션은 비비안의 상징적인 뉴 로맨틱 스타일을 재해석하고자 했죠. </p>

<br>

<p style="text-align:left;">비비안의 전설적인 펑크 스타일과 뉴 로맨틱 스타일은 준태 킴의 상징적인 레이저 컷과 모아진 슬래시 등으로 발전되었습니다. 언제나 그랬든 미의 기준을 깨고 새로운 장르를 개측하는 준태 킴, 매시즌 눈여겨볼 만한 브랜드임이 분명하네요. </p>

<br>

<p style="text-align:left;">Credit. JUNTAE KIM </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/FLATSHOT_15_241332b075.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e68c79883a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_263ce1c440.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_a3e3658881.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_c9cec68e98.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/frame_000027_604c385e0e.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/2909/news/', 'published'),
('샹젤리제를 빛내는 새로운 캘빈클라인의 등장', '파리 샹젤리제 거리 위 캘빈클라인 플래그십 스토어 오픈', 'categoryfashion2907news-117', '2024-06-15', 'Fashion', '["캘빈클라인","민규"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8d80f0cee2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e309d36b6a.jpg', '<br>

<p style="text-align:left;">오 샹젤리제~ 캘빈클라인의 파리 플래그십 스토어와 민규의 만남!</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a>의 새로운 플래그십 스토어가 프랑스 파리의 샹젤리제 거리 위에 모습을 드러냈습니다.</p>

<br>

<p style="text-align:left;">‘초크’라는 디자인 컨셉을 가진 이 스토어는 공간을 자연광으로 가득 채워 고객과 행인들로 하여금 정제된 큐레이팅을 마음껏 즐길 수 있도록 하는데요.</p>

<br>

<p style="text-align:left;">유니크한 시즌별 컨셉과 소비자의 참여를 유도하는 고급스러운 환경, 캘빈클라인 파리 커스텀, 그리고 비스포크 컬러 팔레트로 디자인된 익스클루시브 캡슐 컬렉션도 이곳에서 모두 만나볼 수 있다는 사실. </p>

<br>

<p style="text-align:left;">
캘빈클라인이 새롭게 선보인 공간과 파리 패션의 중심지에서 캘빈클라인의 또 다른 시작을 축하하기 위해 참석한 <a href="https://www.instagram.com/min9yu_k/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">세븐틴 민규</strong></a>의 모습까지 지금 바로 영상으로 만나보세요! </p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BFA_Mingyu_bf3531563b.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2907/news/', 'published'),
('2000 아카이브스의 보헤미안이란 이런 것', '2000아카이브스 뉴 컬렉션, ASLEEP AMONG AMARYLLIS', 'categoryfashion2895news-118', '2024-06-12', 'Fashion', '["2000아카이브스","최나랑"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_fddd2f636f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c1a5d97ff9.jpg', '<br>

<p style="text-align:left;">잘 봐, 이번 여름은 보헤미안이다! </p>

<br>

<p style="text-align:left;">포토그래퍼 <a href="https://www.instagram.com/narangchoi/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">최나랑</strong></a>과 함께한 <a href="https://www.instagram.com/2000.archives/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">2000아카이브스</strong></a>의 새로운 ‘ASLEEP AMONG AMARYLLIS’ 컬렉션 이미지가 공개됐습니다.</p>

<br>

<p style="text-align:left;">이번 컬렉션은 메탈, 카모플라쥬, 자카드가 키 포인트. 2년만에 다시 선보이는 스윔웨어 2종과 SS시즌 각광받은 코프코어 무드를 잇는 스트라이프 슬리브리스와 언발란스 스커트를 만나볼 수 있는데요. </p>

<br>

<p style="text-align:left;">메탈 스탬핑 테크닉의 슬리브리스와 데님 워시드팬츠, 그리고 웨딩에 사용되는 기법을 그대로 작용한 핸드메이드 비즈 자카드 탑으로 반짝이는 컬렉션 완성.</p>

<br>

<p style="text-align:left;">전통적인 보헤미안 스타일을 현대적으로 재해석한 이 컬렉션과 포토그래퍼 최나랑의 감각적인 시선이 어우러진 컬렉션 이미지들을 슬라이드를 넘겨 확인하세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_6d0362b603.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/06_2a942b0836.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_7da2a34856.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_ec95782956.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_831b79e30b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/05_5fd429f2f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/08_e4233ffdec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/09_0af587f1e7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_7ef8d25fb5.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2895/news/', 'published'),
('샌디 리앙의 상상은 현실이 된다', '샌디 리앙 2025 리조트 컬렉션', 'categoryfashion2898news-119', '2024-06-12', 'Fashion', '["샌디 리앙","Sandy Liang","2025"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_eeebf12239.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_de7ee6d38d.jpg', '<p style="text-align:left;">소녀의 옷장을 공개합니다! 어디서? 오피스에서.
<br><br>
<a href="https://www.instagram.com/sandyliang/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">샌디 리앙</strong></a>의 2025 리조트 컬렉션이 공개됐습니다. 이번 컬렉션 룩북이 더욱 특별한 점은 오피스에서 촬영되었다는 것인데요.
<br><br>
컬렉션의 시작은 신혼여행을 위해 일본을 향하던 중 비행기 안 승무원들의 유니폼을 자신만의 스타일로 바꾸고 싶다는 생각이었습니다.
</p>

<br><br>

<p style="text-align:left;">그리고 이 유니폼들은 오피스를 배경으로 카메라 앞에 섰습니다. 이는 브랜드 특유의 무드를 효과적으로 보여 주는 장치가 되었죠.
</p>

<br><br>

<p style="text-align:left;">샌디 리앙의 유니폼은 오피스를 만나 또 다른 의미의 오피스 룩이 되었습니다. 탱크 탑이 내장된 오픈 니트 가디건과 뒤에서 단추를 잠굴 수 있는 끈이 달린 버튼업 셔츠가 바로 그것.
<br><br>
하지만 이 오피스 룩이 컬렉션의 전부는 아닙니다. 샌디 리앙의 감각적인 색 조합이나 하트 장식 벨트 그리고 세일러문 리본과 같은 디테일 또한 여전히 남아 있으니까요.
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_27586e1746.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_928dc886b3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_d19e7e9b7c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d1e7e85eba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_9291f5f17f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_34e53bdf39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_40577c37c8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_62507921af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_b8e1df13d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_f70f863598.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2898/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('깜짝 놀랄 비주얼과 디자인, 릭 오웬스 다크쉐도우X컨버스', '컨버스의 척 70에서 영감을 받은 이번 콜라보레이션 슈즈', 'categoryfashion2893news-120', '2024-06-11', 'Fashion', '["릭 오웬스","다크쉐도우","컨버스","척 70","Rick Owens","DRKSHDW","Converse"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_03d88f88c9.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_517d1bb786.jpg', '<p style="text-align:left;">깜짝 놀랄 비주얼과 디자인, 릭 오웬스 다크쉐도우X컨버스
<br><br>
<a href="https://www.instagram.com/rickowens_drkshdw/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">릭 오웬스 다크쉐도우</strong></a>와 <a href="https://www.instagram.com/converse/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">컨버스</strong></a>가 척 70에서 영감을 받은 실루엣의 협업 제품을 새롭게 선보입니다.
<br><br>
새로운 오버다이드 콘크리트 컬러와 블론드 컬러 총 2종으로 만나볼 수 있는 이번 협업 제품 DBL 다크스타는 이중 밑창 디테일과 더불어 고급스럽고 아이코닉한 스타일을 더한 것이 특징!
<br><br>
해당 제품은 오늘 11일(화) 부터 국내 릭 오웬스 오프라인 매장 등에서 만나볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_a6d8a3ca0f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_891609594b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/04_64bae207ef.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/05_3cdc60f20d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/06_882e0e68df.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/07_d7788aaf62.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/08_b5e4d215ff.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/09_90eb46dc04.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_b65bbb2b63.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2893/news/', 'published'),
('제니와 클롯 X 아디다스의 뉴트럴한 만남', '에디슨 첸의 클롯과 아디다스의 새로운 가젤', 'categoryfashion2888news-121', '2024-06-10', 'Fashion', '["Jennie","제니","클롯","Clot","아디다스","Adidas"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c5e159f488.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1c4432b3a4.jpg', '<p style="text-align:left;">오늘만 두 번째 <a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a> 소식, 이번엔 아디다스다! 
<a href="https://www.instagram.com/edisonchen/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에디슨 첸</strong></a>의 <a href="https://www.instagram.com/clot/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">클롯</strong></a>과 <a href="https://www.instagram.com/edisonchen/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에디슨 첸</strong></a>의 <a href="https://www.instagram.com/originals_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아디다스</strong></a>가 새로운 ‘가젤 인도어 바이 에디슨 첸’을 출시합니다.
<br><br>
프랑스와 스페인에서 인기를 끈 슬립온 슈즈인 &#42; <u>에스파드리유</u>에서 영감을 받아 베이지 캔버스 어퍼와 에스파드리유 솔(sole)로 대담한 디자인이 완성한 모습.</p>
<br>
<p style="text-align:left; color:orange;">&#42; 에스파드리유: 끈을 발목에 감고 신는 캔버스화를 뜻함.</p>

<br><br>

<p style="text-align:left;">여기에 제니는 메쉬 소재 원피스를 착용하여 더욱 뉴트럴한 실루엣을 강조하고 있네요. 
<br><br>
두 브랜드와 제니의 보테니컬한 만남으로 탄생한 스니커즈는 6월 14일 아디다스 컨펌드 앱에서 공개될 예정입니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_91114c64da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_b127073522.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_f4043d1762.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_ec2a081ed2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_6a458ba61d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2888/news/', 'published'),
('캘빈클라인과 함께 피어난 무지개', '캘빈클라인 2024 This Is Love 프라이드 캠페인', 'categoryfashion2860news-122', '2024-06-04', 'Fashion', '["캘빈클라인","무지개","2024","프라이드","캠페인","카라 델레바인","제레미 포프","Kara Delevine","Jeremy Pope","Calvin Klein"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7a769db23f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a35bb30928.jpg', '<p style="text-align:left;">캘빈클라인 2024 This Is Love 프라이드 캠페인. </p>

<br><br>

<div style="padding:125% 0 0 0;position:relative;"></div>

<p style="text-align:left;"><a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a>이 글로벌 스타 <a href="https://www.instagram.com/caradelevingne/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">카라 델레바인</strong></a>과 <a href="https://www.instagram.com/jeremypope/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제레미 포프</strong></a>와 함께 한 2024 프라이드 캠페인을 공개했습니다.</p>

<br><br>

<p style="text-align:left;">자신의 성 정체성을 커밍아웃하며, 누구보다 자유로운 모습으로 활동을 이어나가고 있는 두 배우.</p>

<br><br>

<p style="text-align:left;">뛰어난 표현력과 자신감을 여과없이 드러냄으로써 이번 컬렉션이 추구하는 행복과 다양성을 향한 프라이드 정신의 가치를 선보이는 모습을 담아냈다고 합니다.</p>

<br><br>

<p style="text-align:left;">이번 캘빈클라인 프라이드 캠페인은 기존의 캘빈클라인 언더웨어 및 어패럴에 새로운 애너지가 더해진 것이 특징으로 무지개 색상의 로고 밴드를 통해 더욱 컬러풀한 스타일을 만나 볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_051c144da5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_d9e431222b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d4e0aae716.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_dde54e709f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_d114b2ddd9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_6de8676c06.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_cccac72b70.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_9b0a7106bf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_f4dd780001.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2860/news/', 'published'),
('가지고 싶다 부쉐론, 가질 수 있다 부쉐론 타투!', '타투이스트 미래의 부쉐론 팝업 아트워크 현장', 'categoryfashionart2844news-123', '2024-05-31', 'Fashion,Art', '["부쉐론","Boucheron","타투","Tattoos","미래","타투이스트","tattooist"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0000_42f76f2f5d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_c907241796.png', '<p style="text-align:left;">마법의 소라고동님, 부쉐론의 ‘미래’가 궁금해요. 
<br><br>
<a href="https://www.instagram.com/boucheron/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">부쉐론</strong></a> 콰트로 팝업 부티크에서 만난 팔방미인 아티스트, <a href="https://www.instagram.com/rrrrro_o/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미래</strong></a>!</p>

<br><br>

<div style="padding:125% 0 0 0;position:relative;"></div>

<p style="text-align:left;">타투이스트이자 다양한 브랜드의 아트 디자이너로 활동하는 그녀가 이번 부쉐론 행사에서도 아트워크에 참여해 매력적인 타투와 도안들을 선보였습니다.
<br><br>
부쉐론의 패턴과 아티스트 미래의 아이덴티티가 어우러진 일회성 타투는 2주간 부쉐론 팝업 현장에서 만나볼 수 있는데요.</p>

<br><br>

<p style="text-align:left;">패퍼들도 이번 주말 성수동에서 그녀의 타투, 부쉐론의 반짝임과 함께 럭셔리한 하루를 보내보는 건 어떨까요?</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_432a4b425c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_6f2430e812.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_b29b951d78.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_ea9e127332.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4e04da9747.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_cdef4305cb.png"]'::jsonb, '[]'::jsonb, '/category/Fashion,Art/2844/news/', 'published'),
('가을·겨울 룩의 정석, 로에베의 24FW 프리 컬렉션', '조나단 앤더슨만의 자연스러운 멋이 묻어난 이번 컬렉션', 'categoryfashion2840news-124', '2024-05-30', 'Fashion', '["로에베","loewe"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_fb1b68c0d1.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_5c5cd14337.png', '<br>

<p style="text-align:left;">레이어드의 정석, 로에베의 24FW 프리 컬렉션 

<br>
<a href="https://www.instagram.com/loewe/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">로에베</strong></a>가 2024 가을겨울 프리 컬렉션을 공개했습니다.

<br>
이번 로에베 컬렉션은 <a href="https://www.instagram.com/jonathan.anderson/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">조나단 앤더슨만</strong></a>의 편안하고 자연스러운 무드가 가득 느껴졌는데요.  

<br>
빅 숄더 블레이저와 숄더와 3웨이 버튼으로 멋을 살린 레더 자켓, 커다란 네크라인의 스웨터, 세련된 체크무늬의 버튼업 셔츠 등으로 레이어드의 정석을 보여주고 있습니다.

<br>
해당 컬렉션은 오늘 30일부터 로에베 온라인과 오프라인 매장을 통해 만나볼 수 있습니다.

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_25a6839c3c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_1cb29cb1a9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_e00b90f55a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_acd7884a5a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_f7631a9ae4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_19175ed00b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8393d39969.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_89f97faea8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b1c4c3caef.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2840/news/', 'published'),
('‘키스 서울’ 우리 같이 구경할래요?', '오는 31일에 성수동에 오픈되는 키스 서울', 'categoryfashion2842news-125', '2024-05-30', 'Fashion', '["kith","kith seoul","키스","키스 서울"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_3d903ecad1.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_f229a62a3a.png', '<center>

</center>

<br>

<p style="text-align:left;">‘키스 서울’ 같이 구경할래요? 

<br>브랜드 <a href="https://www.instagram.com/kith/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">키스</strong></a>가 오는 30일 오픈한 ‘키스 서울(Kith Seoul)’의 전경을 공개했습니다. 

<br>해당 플래그십 스토어는 4층으로 이루어져 있으며, 이는 지금껏 오픈된 키스 스토어 중 가장 큰 규모라고 하는데요. 

<br>그 중 3층과 옥상 테라스는 미국 인기레스토랑 중 하나인 <a href="https://www.instagram.com/sadelleskith/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">사델스</strong></a>와 함께하는 키스 레스토랑이, 지하 1층에는 꽃집 키오스크와 스페셜 메뉴를 제공하는 키스 트리츠 바가 위치하고 있는 것이 특징. 

<br>오직 서울 플래그십 스토어에서만 만날 수 있는 키스 서울 캡슐 컬렉션 또한 놓칠 수 없겠네요. 이번 주 성수동을 방문할 예정이라면 패퍼들도 키스 서울을 꼭 방문해보세요! 

<br>장소 &#58; 서울 성동구 연무장길 70

<br>Videocredit. kith</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/2842/news/', 'published'),
('슈프림이 두카티를 만나 일으킨 붉은 시너지', '슈프림과 두카티가 협업 컬렉션을 공개했다', 'categoryfashion2830news-126', '2024-05-29', 'Fashion', '["Supreme","Ducati","슈프림","두카티"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_6bfc23502f.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_f13626ecfc.png', '<center>

</center>

<br>

<p style="text-align:left;">두카티, 슈프림과 만나 강렬함을 뽐내다 

<br>
<a href="https://www.instagram.com/supremenewyork/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슈프림</strong></a>과 모터사이클 전문업체 <a href="https://www.instagram.com/ducati/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">두카티</strong></a>가 퍼모먼스 컬렉션을 공개했습니다.

<br>
선공개된 첫번째 파트인 바이크와 레이싱 수트, 헬멧, 글러브에 이어 공개된 두번째 파트에서는 트랙 재킷, 후드 워크 재킷, 축구 저지, 트랙 팬츠, 2 종류의 티셔츠와 볼캡 등 다양한 라인업으로 만나볼 수 있는 것이 특징. 

<br>
슈프림 X 두카티 퍼모먼스 컬렉션은 오는 6월 1일, 슈프림 서울 매장과 브랜드 웹사이트를 통해 만나볼 수 있다고 하네요.
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme14_8a78a9dcd8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme5_76d49e40fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme6_96052e28c7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme3_c9251a7c15.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme4_bffd3987e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme2_c870e8379d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme13_3c0f8bbe22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme12_2441c0d90b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme11_942dfdb29c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme10_8e04a823c8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme9_150a561ff9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme8_2d893cec8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme7_666190b537.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2830/news/', 'published'),
('리사와 키스 우먼의 2024 여름 캠페인 ', '쿨한 팔레트의 컬러웨이를 가진 제품군으로 가득한 컬렉션이 공개됐다', 'categoryfashion2832news-127', '2024-05-29', 'Fashion', '["리사","lisa","kith","kithwoman","키스우먼"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cb59069927.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_324175bd6e.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/kithwomen/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">키스 우먼</strong></a>의 2024 여름 캠페인에 등장한 블랙핑크 <a href="https://www.instagram.com/lalalalisa_m/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리사</strong></a>. 시즌 셋업, 스윔 웨어, 스타일리시한 액세서리 등과 함께 캠페인 이미지가 공개됐습니다. </p>

<br>

<p style="text-align:left;">쿨한 팔레트의 컬러웨이를 가진 제품군으로 가득한 이번 키스 우먼의 여름 시즌과 아이코닉함의 대명사 리사가 만나 여름의 본질을 포착했다고 하네요. </p>

<br>

<p style="text-align:left;">리사와 키스 우먼의 새로운 2024 여름 컬렉션을 오는 31일부터 키스 온, 오프라인 스토어를 통해 만나 보세요!</p>

<br><br>

<br>

<p style="text-align:left;">Credit. @kithwomen </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_87cdd58e_3fa2_4132_bbe4_b5e70e9b6fd4_afeba68152.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ed4d03ac_ca66_4fb4_b5ee_302276ff8f91_5c1ecafa49.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_2bda6b5f_1a69_4698_923f_150efe80fbf1_bcb19203d5.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_7e7d99be_969b_43cb_981f_d720f82a2600_98a3b585f5.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_7cee9088_138d_4910_bfb9_8ebabdb2aaaf_cc2d1bd0f9.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_590bc950_069c_4446_b23e_7ad7bf999a40_be4d45edbc.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_3d751c33_c1de_42f5_9425_3756bb85f788_6d808d5609.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_37c93c60_8b96_4e1a_ad0c_cd2e082263e5_f52384d575.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_7a78ac92_cce2_413d_a712_cfd28f0cee7c_d4238fcdfb.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_5f5eb3ef_1b43_4e32_8e72_485405eb9312_53d9106d49.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/2832/news/', 'published'),
('새롭게 태어난 푸마와 LMC의 ‘GV 스페셜’', '스포츠 헤리티지에서 영감을 받은 ‘PUMA X LMC''', 'categoryfashion2819news-128', '2024-05-27', 'Fashion', '["푸마","puma","lmc","엘엠씨"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_32710ca534.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_ef8df16c44.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/puma_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>의 유서 깊은 풋웨어인 ‘GV 스페셜’이 <a href="https://www.instagram.com/lostmanagementcities/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">LMC</strong></a>와의 협업을 통해 새롭게 태어납니다. </p>

<br>

<p style="text-align:left;">이번 GV 스페셜 제품은 1980년대 푸마 캘리포니아라는 타이틀로 선보였던 테니스 실루엣 디자인으로 실내외에서 모두 착용할 수 있는 실용성과 특유의 안창이 특징인데요. </p>

<br><br>

<br>

<p style="text-align:left;">LMC와의 협업을 통해 클래식 스포츠웨어에 대한 존경을 바탕으로 80년대 테니스화 실루엣을 재해석해 경쾌한 컬러웨이의 GV 스페셜이 완성되었습니다. </p>

<br>

<p style="text-align:left;">블루와 크림 톤을 활용한 원단의 거친 마감 처리와 지그재그 형태의 스티치 등 수작업 디테일 또한 확인해 볼 것. 지금 바로 케이스스터디, 카시나, LMC에서 푸마와 LMC의 GV 스페셜을 만나 보세요! </p>

<br><br>

<br>

<p style="text-align:left;">Credit. Puma Korea </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_79f0f95296.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_39450983f8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_cd12dce088.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_fb4fcccb43.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b77ff90d22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_001908228a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b70435816e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_1af8542390.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_c6238a8812.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_17bc2204f4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_1c222a6663.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_60c6ac9472.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_278f3b1e8e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_ab47442e56.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2819/news/', 'published'),
('제니 X 캘빈 클라인, 깨끗하고 클래식한 만남', '캘빈 클라인 2024 썸머 화보 속 제니', 'categoryfashion2807news-129', '2024-05-24', 'Fashion', '["제니","캘빈 클라인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d6cc25a30c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9265bf7306.jpg', '<br>

<p style="text-align:left;">여름엔 역시 제니 X 캘빈 클라인!</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>의 <a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈 클라인</strong></a> 2024 썸머 컬렉션 화보가 공개됐습니다. 이번 컬렉션은 곧 다가오는 여름을 맞아 지난 15일 런칭된 ‘모노크로매틱 썸머’ 컬렉션.</p>

<br>

<p style="text-align:left;">화보 속 제니는 화이트 톤온톤 룩을 통해 심플하면서도 센슈얼한 캘빈 클라인의 아이덴티티를 담아냈습니다.</p>

<br>

<p style="text-align:left;">브랜드만의 클래식하면서도 소프트한 테일러링, 여름에 어울리는 라이트한 텍스처와 자연스러운 실루엣으로 편안한 에너지를 발산하는 제니의 모습을 &#60;PAP&#62;에서 만나보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/S24_JENNIE_DIGI_nologo_1080x1350_1_27863c0103.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/S24_JENNIE_DIGI_nologo_1080x1350_2_a938027f81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/S24_JENNIE_DIGI_nologo_1080x1350_3_0219c37abb.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2807/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('얼마나 멋지길래! 써네이X 캠퍼 협업 슈즈 6월 출시', '지난 24FW 밀란 패션위크에서 살짝 공개 되었던 협업 슈즈', 'categoryfashion2804news-130', '2024-05-23', 'Fashion', '["sunnei","camper","써네이","캠퍼"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_83759c064e.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_82ec321559.png', '<center>

</center>

<br>

<p style="text-align:left;">얼마나 멋지길래! 써네이X 캠퍼 협업 슈즈 6월 출시 

<br>
지난 24FW 밀라노패션위크 속 <a href="https://www.instagram.com/sunnei/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">써네이</strong></a> 쇼에서 살짝 공개 되었던 써네이와 <a href="https://www.instagram.com/camper/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캠퍼</strong></a>의 협업이 공식적으로 예고됐습니다.

<br>
당시 써네이 쇼에서 일부 모델들은 ‘SUNNEI CAMPER, JUNE 2024’라는 문구가 쓰여진 컬러풀한 커버에 담긴 신발을 들고 런웨이를 걸었는데요. 

<br>
협업 슈즈 발매가 오는 6월 18일로 알려짐에 따라 해당 슈즈를 직접 보는 사람들의 리액션을 담은 영상을 게시했는데요. 여전히 신발의 자세한 모양은 블러 처리되어 있어 더욱 궁금증을 유발하네요.

<br>
곧 찾아올 써네이와 캠퍼의 협업 슈즈! 추후 소식도 &#60;PAP&#62;에서 만나보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_4cc394ba_12ed_4622_afc7_609c99e188f4_952463c39a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_cb1bea2e_3078_48d9_9c31_a015c5df0c82_e01a15c398.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_bb955b6a_0425_48d3_927f_a9ab51a47855_96dc206f09.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_5163d83f_24cf_4ab0_955e_33fc6d7b04ff_1a7f45765c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_85e3664c_ebc7_422b_8ee6_48896ed1c121_4a9c906a99.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_c01d78ff_f610_4d57_b2b7_1e42c1bc7878_cc9144375e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_19ce6bdf_9d7b_447a_b12c_56ab4f7e6d82_35dc483bc1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1739bcb6_92fc_4c04_b1aa_fd53eeb621db_65e540da63.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_b62d559a_679b_4c92_9340_bfdf71600622_e08d72362c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_6040d8ee_9dd2_4aa4_91a3_ee92b8d75b14_9d786a033a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2804/news/', 'published'),
('보테가 베네타와 함께 ‘가자!’ 파라슈트', '보테가 베네타의 새로운 안디아모 파라슈트 백', 'categoryfashion2775news-131', '2024-05-16', 'Fashion', '["보테가 베네타","안디아모 파라슈트"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9070f25c88.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_32bb89761c.jpg', '<br>

<p style="text-align:left;">안디아모가 더 새로워진다, 안디아모 파라슈트. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/newbottega/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">보테가 베네타</strong></a>에 새로운 실루엣이 등장합니다. 바로 하우스의 시그니처인 안디아모 백의 쉐입을 확장한 ‘안디아모 파라슈트’인데요.</p>

<br>

<p style="text-align:left;">이탈리아어로 ‘가자(Let’s go)’라는 의미의 안디아모백은 23 여름 컬렉션 이후 하우스의 상징적인 백으로 자리잡아왔습니다.</p>

<br>

<p style="text-align:left;">이번 시즌은 보테가 베네타의 아카이브 백인 ‘파라슈트 토트’에서 영감 받은 제품으로, 이름에서 연상할 수 있듯 낙하산 쉐입의 유연한 실루엣을 강조했는데요.</p>

<br>

<p style="text-align:left;">안디아모 파라슈트는 하우스만의 인트레치아토 수공 기법으로 완성해 독보적인 장인 정신을 고스란히 담고 있으며, 메탈 ‘놋(knot)’ 디테일과 브레이드 스트랩 디테일도 만나볼 수 있습니다.</p>

<br>

<p style="text-align:left;">보테가 베네타의 뉴 시즌 안디아모 파라슈트 백을 지금 &#60;PAP&#62;에서 확인하세요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BV_PF_24_Adv_s_RGB_4x5_full_B07_efa64cdf2f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Large_Fondant_7cb45f57e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Small_Green_Oasis_05a8879aa3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BV_PF_24_Adv_s_RGB_4x5_full_B04_f0945d615f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BV_PF_24_Adv_s_RGB_4x5_full_B20_6078a790ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BV_PF_24_Adv_s_RGB_4x5_full_B11_0c0faebd1a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BV_PF_24_Adv_s_RGB_4x5_full_B22_bdc62c450a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/BV_PF_24_Adv_s_RGB_4x5_full_C01_22113c974a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2775/news/', 'published'),
('릭 오웬스와 챔피온, 새로운 협업 공개', '릭 오웬스의 다크 모더니즘 미학을 담은 챔피온과의 협업', 'categoryfashion2737news-132', '2024-05-08', 'Fashion', '["릭 오웬스","챔피온"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f7799ab355.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_dec9366028.jpg', '<br>

<p style="text-align:left;">스포츠 챔피언이 된 릭 오웬스? </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/rickowensonline/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">릭 오웬스</strong></a>의 아방가르드한 무드와 <a href="https://www.instagram.com/champion/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">챔피온</strong></a>의 스포츠 헤리티지가 만나 새로운 협업이 출시될 예정이라고 하는데요.</p>

<br>

<p style="text-align:left;">무채색을 기반으로 한 릭 오웬스만의 아이코닉한 다크 모더니즘 감성과 챔피온의 유서 깊은 애슬레틱 레거시에 대한 오마주, 그리고 지속가능성을 완벽히 담았다는 이번 협업.</p>

<br>

<p style="text-align:left;">유기농 코튼부터 재활용 나일론에 이르기까지 모든 원단을 독점적으로 사용, 재활용 종이를 활용하여 제작한 라벨과 택으로 친환경 큐레이션에 대한 관심을 반영했습니다.</p>

<br>

<p style="text-align:left;">강렬한 모노크롬 컬러에 스웻 셔츠, 스웻 팬츠, 티셔츠 등 편안함을 중점으로 한 제품군들을 선보이며, 이번엔 혁신과 기능성을 한 번에 느낄 수 있는 점보 윈드브레이커가 새롭게 출시된다고 하는데요.</p>

<br>

<p style="text-align:left;">벌써부터 뜨거운 관심을 받는 이들의 협업 컬렉션은 오는 9일부터 국내 릭 오웬스 오프라인 4개 매장과 온라인에서 만나볼 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/CHAMPION_X_RO_SS_24_44429_32f81cad8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/CHAMPION_X_RO_SS_24_44479_09e02a77ed.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/CHAMPION_RICK_OWENS_LOGO_1_283274d066.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/2737/news/', 'published'),
('제니와 젠틀몬스터 세번째 만남 ‘젠틀살롱’ 티저 공개', '매력적인 참과 함께하는 이번 아이웨어 컬렉션 젠틀 살롱', 'categoryfashion2670news-133', '2024-04-19', 'Fashion', '["제니","젠틀몬스터","Gentle Monster","Jennie"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_6c6e299c90.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_b0151c3be2.png', '<center>

</center>

<br>

<p style="text-align:left;">카피바라 모두 여길 봐라 제니X젠틀몬스터! 
<br><br>
<a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>와 <a href="https://www.instagram.com/gentlemonster/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">젠틀몬스터</strong></a>가 함께하는 세번째 컬렉션 ‘젠틀살롱(JENTLE SALON)’이 새롭게 런칭합니다. 
<br><br>
공개된 티저 속에는 귀여움 가득한 카피바라 참(Charm)이 시선을 사로잡고 있는데요. 오는 5월 1일 공개되는 해당 컬렉션은 우리의 상상력마저 자극하는 제니와 젠틀몬스터 아이웨어를 아이코닉한 디자인의 참과 함께 더욱 다채롭게 즐겨볼 수 있다고 하네요.</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/2670/news/', 'published'),
('조형물과 만난 엄브로의 뉴 클로그 시리즈!', '조형 작가 김영균과의 협업을 선보여 화제다', 'categoryfashion2638news-134', '2024-04-12', 'Fashion', '["엄브로","UMBRO"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8678e6ffec.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5df43155e9.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>가 자연의 유기적인 움직임에서 얻은 영감으로 완성한 24년도 뉴 클로그 시리즈를 선보입니다.</p>

<br>

<p style="text-align:left;">이번 SS24 클로그 슈즈 론칭에서 가장 특별한 점은 바로 조형 작가 김영균과의 협업이라고 할 수 있는데요. 영감의 원천을 가시적으로 표현하기 위한 새로운 시도라고 합니다.</p>

<br><br>

<br>

<p style="text-align:left;">엄브로와 김영균 작가의 토피 컬렉션과 조형물은 성수동 엄브로 콘셉트 스토어에서 전시 형태로 관람 가능한데요.</p>

<br>

<p style="text-align:left;">세월의 오랜 흐름을 통해 완성되는 유니크한 자연의 형태를 표현한 ''토피 피셔맨’, 바다와 하늘의 유기적인 공존을 담은 ‘토피’ 그리고 토양의 단단함과 아름다운 변화에 초점을 맞춘 ‘GT클로그’까지 각 제품과 오브제를 만나 볼 수 있는 기회 놓치지 마세요!</p>

<br><br>

<br>

<p style="text-align:left;">일시: 2024.04.11 (목) ~ 2024.04.26 (금)</p>
<p style="text-align:left;">시간: 11:00 AM ~ 8:00 PM</p>
<p style="text-align:left;">장소: 서울특별시 성동구 연무장길 88</p>

<br>

<p style="text-align:left;">Credit. UMBRO</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9dbc8c572d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d28bd14245.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e125bb4041.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_c7308f624b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_842f3184d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_e222164433.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2638/news/', 'published'),
('에스티 로더의 새로운 뮤즈 아이유', '한국인 최초 글로벌 앰버서더 발탁 아이유는 브랜드 캠페인을 통해 첫 행보를 선보인다', 'categorybeauty2636news-135', '2024-04-12', 'Beauty', '["아이유","에스티로더","iu","EsteeLauder"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a87d6fd64f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_07f570002b.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/esteelauder/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">에스티 로더</strong></a>의 새로운 뮤즈 <a href="https://www.instagram.com/dlwlrma/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아이유</strong></a>.</p>

<br>

<p style="text-align:left;">아이유가 한국인 최초 에스티 로더의 글로벌 브랜드 앰버서더로 발탁됐습니다.</p>

<br>

<p style="text-align:left;">앰버서더로서의 첫 행보는 브랜드의 대표 프랜차이즈인 어드밴스드 나이트 리페어, 더블웨어 캠페인! </p>

<br>

<p style="text-align:left;">에스티 로더는 아이유는 커리어의 모든 측면에서 선구자 역할을 하는 아티스트로서 브랜드의 핵심 가치와 깊이 연결되어 있다고 소감을 밝혔습니다. 앞으로가 더욱 기대되네요.</p>

<br><br>

<style>.embed-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; } .embed-container iframe, .embed-container object, .embed-container embed { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }</style><div class=''embed-container''></div>

<br>

<p style="text-align:left;">Credit. Estée Lauder</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9cdc50a811.jpg"]'::jsonb, '[]'::jsonb, '/category/Beauty/2636/news/', 'published'),
('‘백꾸’ 트렌드를 만난 펜디의 뉴 캠페인', '펜디가 새롭게 공개한 ‘Make Up Your Peekaboo’ 캠페인', 'categoryfashion2632news-136', '2024-04-11', 'Fashion', '["Fendi","펜디"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_cefa1db0aa.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_412eb4df55.png', '<center>

</center>

<br>

<p style="text-align:left;">‘백꾸’ 트렌드를 만난 펜디의 뉴 캠페인
<br><br>
<a href="https://www.instagram.com/fendi/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">펜디</strong></a>가 ‘Make Up Your Peekaboo’ 캠페인을 공개했습니다.
<br><br>
해당 캠페인은 펜디의 피카부 셀러리아 백을 다양한 액세서리로 꾸미며 일명 ‘백꾸(Bag 꾸미기)’ 를 경험 할 수 있는데요. 새롭게 출시되는 백 참과 핸들, 스트랩을 매치하면 무려 200가지 이상의 조합을 만들 수 있다는 사실! 
<br><br>
뉴 피카부 백 뿐만 아니라 기존 펜디 가방에도 부착해 나만의 피카부 백으로 재탄생 시킬 수 있습니다. 해당 백 액세서리 셀렉션부터 최신 피카부 백 컬렉션은 지금 바로 펜디 공식 웹사이트에서 만날 수 있다고 하네요. </p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/2632/news/', 'published'),
('겐조와 베르디의 두 번째 만남!', '원색적인 컬러 블로킹에서 영감을 받은 협업 컬렉션을 선보인다', 'categoryfashion2633news-137', '2024-04-11', 'Fashion', '["겐조","베르디"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_15053fcf3f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0c83356348.jpg', '<br>

<p style="text-align:left;">동서양의 완벽한 만남. 그 두 번째 이야기!</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/kenzo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">겐조</strong></a>가 비주얼 아티스트 <a href="https://www.instagram.com/VERDY/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">베르디</strong></a>와의 2024 봄/여름 컬렉션을 위한 스페셜 그래픽이 담긴 두 번째 협업 컬렉션을 공개했습니다. </p>

<br>

<p style="text-align:left;">이번 컬렉션은 ‘COLORS’라는 제목으로 대담하고 원색적인 컬러 블로킹에서 영감을 받았다고 하는데요.</p>

<br><br>

<br>

<p style="text-align:left;">그래픽 아티스트 베르디는 위트 있는 디자인과 생동감 넘치는 색상으로 이번 시즌에도 겐조와의 만남을 통해 일본과 서양의 스트리트 웨어를 완벽히 융합했습니다.</p>

<br>

<p style="text-align:left;">동서양의 만남이 담긴 볼드한 로고 플레이 또한 감각적으로 구현됐죠. 지금 바로 겐조와 베르디의 협업 컬렉션을 전국 겐조 매장에서 만나 보세요!</p>

<br><br>

<br>

<p style="text-align:left;">Credit. KENZO</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_c93c0c0a3d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d7e63abd8b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8b2d441504.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_3bf83e98d8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_10a6e06502.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b161f60981.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2633/news/', 'published'),
('드디어 찾아왔다, 032c  서울 스토어 오픈 소식!', '‘032c 갤러리 서울’이라는 이름으로 오픈되는 서울 스토어', 'categoryfashion2634news-138', '2024-04-11', 'Fashion', '["032c","032c gallery seoul"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_68d888f9d7.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_a4583f5bff.png', '<br>

<p style="text-align:left;">

드디어 찾아온 032c 서울 스토어 오픈 소식! 
<br><br>
베일에 쌓여있던 <a href="https://www.instagram.com/032c/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">032c</strong></a>의 서울 스토어가 공식적으로 오픈 소식을 알렸습니다. ‘032c 갤러리 서울’이라는 이름의 해당 스토어는 성수동에서 오는 19일 프리 오프닝 데이를 시작으로 일반 대중에게는 20일부터 공개되는데요. 
<br><br>
‘032c 갤러리 서울’의 디자인은 독일 베를린의 건축 회사 <a href="https://www.instagram.com/gonzalezhaase_aas/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">AAS</strong></a>가 맡았다고 하네요. 
<br><br>
더 자세한 이야기는 새롭게 개설된 <a href="https://www.instagram.com/032c.gallery.seoul/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">‘032c 갤러리 서울’</strong></a> 계정을 통해 만나보세요!

</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/032c3_15f60e7c6b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/032c2_0fa3e3b577.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/032c1_a2ba2b4553.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2634/news/', 'published'),
('슈프림 또 일냈다!  슈프림 2024 SS 티셔츠 발매', '여덟가지 라인업으로 만나는 이번 24 봄 여름 티셔츠 컬렉션', 'categoryfashion2626news-139', '2024-04-10', 'Fashion', '["슈프림","supreme"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_9d7925098b.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_4b9dc9872c.png', '<br>

<p style="text-align:left;">슈프림 또 일냈다! 슈프림 2024 봄 여름 티셔츠 발매 
<br><br>
<a href="https://www.instagram.com/supremenewyork/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슈프림</strong></a>이 2024 봄여름 티셔츠 컬렉션이 공개 했습니다. 이번 컬렉션은 총 여덟 가지 라인업으로 만나볼 수 있는데요. 
<br><br>
특히 중국의 아티스트, 루양의 ‘Electromagnetic Brainology’에서 모티브를 얻은 블랙 티셔츠가 발매 전 부터 가장 큰 호응을 얻고 있습니다. 해당 제품 뒷면에 새겨진 원작의 제목을 패러디한 ‘Supreme Brainology’프린팅이 포인트라는 점!
<br><br>
또한 UGK의 상징적인 로고가 새겨진 UGK 협업 티셔츠도 컬렉션과 함께 지난 2022년 작고한 아티스트 마가릿 킨의 작품이 그려진 티셔츠와 슈프림 레코즈 그래픽 티셔츠, 터널 이미지 티셔츠도 만나볼 수 있습니다.
<br><br>
해당 컬렉션은 오는 오는 13일 슈프림 공식 웹사이트와 서울 오프라인 스토어에서 발매된다고 하니 절대 놓치지 마세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme8_d2370fc909.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme7_907c7431cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme6_a61a43c91f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme5_eebcd8b22f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme4_cd8fe9b665.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme3_ff0e757854.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme2_2457e432d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/supreme1_56ef33d926.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2626/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('패션위크 스트릿에서 마주한 엄브로 슈즈 스타일링', '엄브로 토피, 토피 피셔맨이 SS24 시즌 가장 트렌디한 슈즈로 자리매김했다', 'categoryfashion2623news-140', '2024-04-09', 'Fashion', '["PARISFASHIONWEEK","PFW","파리 패션 위크","엄브로","UMBRO","토피피셔맨","TOPI"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_0e5907d3b7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_ba74a2f7be.jpg', '<p style="text-align:left;">글로벌 패션위크 스트릿에서 포착한 엄브로 토피, 토피 피셔맨 슈즈 스타일링.
<br><br>
지난 SS24 파리 패션 위크가 성황리에 막을 내리며 스트릿 스타일에서 가장 주목할 만한 브랜드를 소개합니다. 바로 <a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>!</p>

<br>

<br>

<p style="text-align:left;">그 중에서도 계절감에 적합한 통기성과 유니크한 쉐입을 가진 토피 피셔맨, 엄브로의 대표 클로그 슈즈인 토피는 이번 시즌 가장 트렌디한 슈즈로 자리매김했는데요.
<br><br>
어떤 스타일링에도 활용도 높은 디자인과 편안한 착화감으로 가벼운 발걸음에 스타일리시함까지 더해 보세요!</p>

<br>

<br>

<p style="text-align:left;">엄브로의 토피, 토피 피셔맨 슈즈는 지금 바로 엄브로 공식 홈페이지에서 확인하실 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1f352a1987.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_565b3ca08e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_9970e828d2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_5400c269e9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_93419957bc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_b2735619db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_93d7dfe109.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_8a2cf0c114.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_7ef18a2cbb.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2623/news/', 'published'),
('골프도 영하고 힙할 수 있지, 하입골프 첫 글로벌 론칭', '포스트 아카이브 팩션(파프) 설립자와 함께한 이번 컬렉션', 'categoryfashion2624news-141', '2024-04-09', 'Fashion', '["하입골프","hypegolf"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_0be905852d.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_6ce1e36114.png', '<br>

<p style="text-align:left;">골프웨어도 힙할 수 있어! 하입골프 첫 글로벌 론칭 
<br><br>
<a href="https://www.instagram.com/hypegolflabel/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">하입골프</strong></a>가 <a href="https://www.instagram.com/postarchivefaction/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포스트 아카이브 팩션 (파프)</strong></a>설립자 <a href="https://www.instagram.com/limdongjoon/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">임동준</strong></a>과 함께 첫 글로벌 브랜드를 론칭 합니다. 
<br><br>
이번 24 봄여름 캡슐은 디자이너 임동준의 섬세하고 테크니컬한 디자인 언어에 기반해 전통적 골프웨어에 현대적인 미학을 더한 것이 특징인데요.
<br><br>
다이내믹한 골프 스윙과 공의 움직임 등에서 영감을 받은 비대칭 곡선의 절개선을 컬렉션 전반에 걸쳐 만나볼 수 있습니다. 
<br><br>
해당 컬렉션은 에센셜 골프웨어부터 액세서리까지 총 11개 아이템으로 만나볼 수 있으며, 오는 10일 서울 갤러이아 백화점 웨스트 2층 팝업을 시작으로 18일 HBX 홍콩 매장과 웹사이트를 통해 글로벌 출시 된다고 하네요. </p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_02_c680579e4f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_01_07cc18bea3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_05_5f1885b7b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_08_17ae856ab8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_07_7acc036394.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_06_94a1865c67.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_11_087b457084.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_10_f0cddf85f9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_09_14375618d1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_12_bdd0dea86b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_14_3fcdc9eae4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_13_89961ce926.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_16_0e7f6aa041.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_15_21644c54fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_03_987a76435f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Hypegolf_Label_by_Dongjoon_Lim_of_POST_ARCHIVE_FACTION_PAF_Campaign_4x5_04_6bf8b339c4.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2624/news/', 'published'),
('내 눈을 바라봐 넌 스투시 해지고!', '스투시의 2024 봄 선글라스 컬렉션이 발매됐다', 'categoryfashion2594news-142', '2024-04-05', 'Fashion', '["스투시","stussy","선글라스","Sunglasses"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_8c31c6e62b.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_f3c191e9b1.png', '<br>

<p style="text-align:left;">내 눈을 바라봐 넌 스투시 해지고! 
<br><br>
<a href="https://www.instagram.com/stussy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">스투시</strong></a>의 2024 봄 선글라스 컬렉션이 오늘(5일) 공식 출시 됐습니다. 스트릿 브랜드의 대표격 브랜드 스투시가 선보이는 이번 아이웨어 컬렉션은 총 5종의 쉐입으로 만나볼 수 있는데요. 
<br><br>
각자 다른 컬러감으로 베리에이션되어 더욱 스타일리쉬하게 만나볼 수 있는 것이 특징. 스투시의 아이웨어는 특히 출시가 잦지 않은 탓에 출시가 보다 더욱 높은 가격으로 빈티지 시장에서 거래되고 있기도 합니다. 그런 의미에서 이번 2024 봄 선글라스 컬렉션은 더욱 경쟁이 치열할 것으로 예상되네요.
<br><br>
레트로한 무드의 스투시 선글라스를 지금 바로 공식 홈페이지를 통해 만나보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_db7cc2e59b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_1045aee949.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_cdfc6d8418.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_41a6d3d0e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_72d9086449.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_bd21ad1b2a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_3510d77b62.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_570c49990b.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_5c4133fd6d.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_01beffd7cf.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d5128fce9b.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0c811343c0.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9af7cb4caf.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a250a41586.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/2594/news/', 'published'),
('방 안에 숨은 푸른빛 색다른 감각', '아더에러와 뱅앤올룹슨의 베오사운드 A1아더에러 에디션', 'categoryfashionculture2589news-143', '2024-04-04', 'Fashion,Culture', '["아더에러","뱅앤올룹슨"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5d9c688dd1.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_59dbf41ea8.jpg', '<br>

<p style="text-align:left;">패션과 음악을 창의적인 시각으로 결합하다. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더에러</strong></a>와 <a href="https://www.instagram.com/bangolufsen/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">뱅앤올룹슨</strong></a>이 글로벌 협업을 공개합니다. 이번 협업은 혁신 정신을 바탕으로 새로운 문화를 제안하는 두 브랜드의 가치를 공유하며 시작되었는데요.</p>

<br>

<p style="text-align:left;">컬렉션은 베오사운드 A1 스피커와 스피커 스탠드, 스피커 백 총 3가지 제품으로 구성.</p>

<br>

<p style="text-align:left;">다자인에 능통한 브랜드들 답게 이번 베오사운드 A1아더에러 에디션이 단순한 전자기기를 넘어 그 자체로도 시각적 즐거움을 선사하는 오브제로 역할을 할 수 있도록 고안되었다고 하는데요.</p>

<br>

<p style="text-align:left;">익숙한 것을 해체해 그 속에서 새로움을 느낄 수 있도록 제작된 아더에러와 뱅앤올룹슨의 컬렉션. 오는 10일부터 5일간 팝업에서 만나보실 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/ADER_ERROR_X_B_and_O_The_Blueism_1_81817ce43b.JPG","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/ADER_ERROR_X_B_and_O_The_Blueism_2_2a8c3db641.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Culture/2589/news/', 'published'),
('낭만주의로 물든 비비안 웨스트우드 24AW', '비비안 웨스트우드가 24AW 디지털 컬렉션을 공개했다', 'categoryfashion2576news-144', '2024-04-02', 'Fashion', '["비비안 웨스트우드"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3d5e510823.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b8d505ccc7.jpg', '<br>

<p style="text-align:left;">가을의 낭만을 담다.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/viviennewestwood/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">비비안 웨스트우드</strong></a>의 24AW 디지털 컬렉션이 공개됐습니다.</p>

<br>

<p style="text-align:left;">이들은 19세기 초 나폴레옹 시대의 미학, 화려한 부유의 로마 제국을 보여주는 엠파이어 스타일에 기초하여 고대 로마와 군복에 영감을 받은 컬렉션을 전개했는데요.</p>

<br>

<p style="text-align:left;">브랜드의 시그니처 드레이프 아이템부터 승마용 광택 액세서리와 무용 신발까지 고전적 정취가 녹여진 여러 디자인 요소들을 선보였습니다.</p>

<br>

<p style="text-align:left;">캠페인은 낭만주의적인 장면을 담아내고자 영국의 한 농장에서 전원의 목가적인 풍경과 정물화 형태의 촬영을 진행. 이번 컬렉션으로 비비안 웨스트우드는 클래식 펑크라는 또 다른 컨셉을 제시했습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_10_003_GRAIN_4x5_aeda82da41.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_01_023_GRAIN_4x5_684af9489f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_04_207_GRAIN_4x5_502444f221.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_08_034_GRAIN_4x5_a29ebb8848.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_24_132_GRAIN_4x5_5dff0803de.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_31_028_Grain_4x5_9f3e52b98f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_34_061_Grain_4x5_07d35cbc6c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_36_001_Grain_4x5_dfc0b4c25b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_42_178_Grain_4x5_80df029016.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/230320_VW_AW_24_25_LB_46_085_Grain_4x5_ea66815fa0.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2576/news/', 'published'),
('제니와 캘빈클라인의 센슈얼한 만남', '캘빈클라인과 제니의 2024 봄 캠페인', 'categoryfashion2577news-145', '2024-04-02', 'Fashion', '["제니","캘빈클라인","Jennie","CalvinKlein"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c116d09a97.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1a9a09dc8e.jpg', '<br>

<p style="text-align:left;">제니와 캘빈클라인의 센슈얼한 만남!</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a>이 <a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>와 함께 한 데님 캠페인을 공개했습니다. 타임리스 모노톤부터 세련된 쿨톤에 이르는 다양한 데님룩과 함께 한 제니!</p>

<br><br>

<br>

<p style="text-align:left;">시대를 초월하는 편안한 실루엣과 캐주얼한 관능미를 담고 있는 데님룩을 소화한 제니는 하이웨이스트 릴렉스핏의 90s 루즈핏 데님과 코튼 컨투어 립 탱크 탑을 착용했는데요.</p>

<br>

<p style="text-align:left;">또 클래식 트러커 재킷과 와이드 핏 데님 팬츠를 비대칭으로 매칭한 룩도 눈여겨 볼 만합니다.</p>

<br>

<p style="text-align:left;">제니가 착용한 캠페인 속 제품들을 지금 바로 캘빈클라인 공식 온라인 몰 및 전국 캘빈클라인 매장에서 만나 보세요!</p>

<br><br>

<br>

<p style="text-align:left;">Image Credit: Calvin Klein</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_90_S_FIT_JN_1_e224fa28f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_90_S_FIT_JN_3_5960dd6329.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_90_S_FIT_JN_4_96459b0821.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_MN_SKRT_1_a75e66e489.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_MN_SKRT_3_09293bb096.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_BRRL_JN_1_44e8e80abf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_BRRL_JN_3_c5dec3c228.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_HR_WDLG_JN_1_3219fd157d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_HR_WDLG_JN_2_5033bd04a7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_SCLPT_DRSS_1_4492689f2f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/sp24_organic_no_logo_1080x1350_JENNIE_DIGI_SCLPT_DRSS_2_514f7601ab.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2577/news/', 'published'),
('메종 키츠네의 새로운 아기 여우는?', '메종 키츠네의 새로운 뮤즈 제니', 'categoryfashion2550news-146', '2024-03-28', 'Fashion', '["메종 키츠네","제니"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_aa9cec4f4b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_05e81f87c1.jpg', '<br>

<p style="text-align:left;">메종 키츠네의 베이비 폭스 컬렉션 뮤즈는?</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>가 <a href="https://www.instagram.com/maisonkitsune/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">메종 키츠네</strong></a> 새로운 캠페인의 얼굴이 되었다는 소식인데요.</p>

<br>

<p style="text-align:left;">2024 봄 시즌을 맞아 대담하고 여성스러운 스타일이 돋보이는 메종 키츠네의 여성 컬렉션 ‘베이비 폭스’. 이 컬렉션은 팝한 파스텔 컬러와 서울의 독특한 정체성을 담아냈습니다.</p>

<br>

<p style="text-align:left;">귀여운 로고, 산뜻한 컬러감, 톤온톤 코디를 위트있게 풀어낸 이번 컬렉션. 제니와 함께한 사랑스러운 캠페인을 지금 만나보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MK_BABY_FOX_4_5_1_d88be2dc09.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MK_BABY_FOX_4_5_2_a91a045064.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MK_BABY_FOX_4_5_3_6f93ba7c27.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MK_BABY_FOX_4_5_4_c0763d3ceb.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2550/news/', 'published'),
('힙스터라면 잠깐 주목! 2000아카이브스 X 제이디드런던', '육상에서 영감을 받은 이번 협업 컬렉션', 'categoryfashion2547news-147', '2024-03-27', 'Fashion', '["2000아카이브스","제이디드런던","2000 Archives","Jaded London"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_110816efa1.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_9a24307333.png', '<center>

</center>

<br>

<p style="text-align:left;">힙스터 필수템! 2000아카이브스와 제이디드 런던의 만남 
<br><br>
<a href="https://www.instagram.com/2000.archives/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">2000아카이브스</strong></a>가 런던 베이스 브랜드 <a href="https://www.instagram.com/jadedldn/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제이디드 런던</strong></a>과 함께한 캡슐 컬렉션을 공개했습니다.
<br><br>
해당 컬렉션은 두 브랜드의 그래픽과 컬러웨이 뿐만 아니라 실루엣, 제작 방식을 통합하여 재해석한 아이템들을 선보인다고 하는데요. 
<br><br>
육상에서 영감을 받은 컬렉션답게 육상 트랙을 배경으로 선보여지는 이번 제품군에는 에어브러쉬드 진, 로우 라이즈 벨루어 트랙 수트, 블록코어 아이템 등이 눈에 띄고 있습니다.
<br><br>
2000아카이브스 x 제이디드 런던 컬렉션은 오는 28일부터 <a href="https://www.instagram.com/empty.seoul.kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엠프티</strong></a> 웹사이트 및 팝업 스토어에서 단독으로 공개될 예정이라고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111121_f70527eb7b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111125_b37adda479.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111124_e7cc6b88be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111123_44b88e1bd4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111122_f0d63f5e60.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2547/news/', 'published'),
('협업 맛집 아워레가시 워크숍이 만난 EVAC', '아워레가시 워크숍과 EVAC의 협업 컬렉션이 공개됐다', 'categoryfashion2531news-148', '2024-03-25', 'Fashion', '["ourlegacyworkshop","EVAC","ourlegacy"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13500_2d29ae81eb.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/67555_c5c9bdf810.png', '<center>

</center>

<br>

<p style="text-align:left;">늦으면 빈자리는 없어요! 아워레가시 워크숍 X EVAC 컬렉션
<br><br>
<a href="https://www.instagram.com/ourlegacyworkshop/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아워레가시 워크숍</strong></a>이 <a href="https://www.instagram.com/external_vacancy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">EVAC</strong></a>와 만났습니다.
<br><br>
<a href="https://www.instagram.com/ourlegacy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아워레가시</strong></a>는 아워레가시 워크숍과 EVAC이 함께한 캠페인 영상을 공개했는데요. 고지대 설산속 아웃도어의 거친 매력이 돋보이는 캠페인 영상을 통해 ‘WORKSHOP EVAC’ 컬렉션의 제품군이 비춰졌습니다. 
<br><br>
이번 협업 컬렉션에는 아워레가시 워크숍의 시그니처 텍스트 로고가 프린팅된 블랙 재킷과 기능성 반팔 및 재킷류가 눈에 띄는데요. 
<br><br>
해당 컬렉션은 오는 27일 아워레가시 공식스토어를 통해 만나볼 수 있다고 하네요.</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/2531/news/', 'published'),
('전설들의 만남 슈프림과 MM6의 협업 발매', '지난 2월부터 루머로 전해지던 두 브랜드의 협업소식', 'categoryfashion2533news-149', '2024-03-25', 'Fashion', '["supreme","maisonmargiela","MM6","슈프림","마르지엘라"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_ba7ebd4e17.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6755_d37d83033d.png', '<br>

<p style="text-align:left;">슈프림과 MM6 메종 마르지엘라 협업, 루머아니고 진짜였다고? 
<br><br>
지난 2월부터 루머로 돌던 <a href="https://www.instagram.com/supremenewyork/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슈프림</strong></a>과 <a href="https://www.instagram.com/mm6maisonmargiela/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">메종 마르지엘라</strong></a>의 협업이 공개됐습니다. 
<br><br>
해당 컬렉션은 인조 모피 코트, 바시티 재킷, 워크 재킷, 워시드 코튼 슈트 및 베스트, 셔츠, S/S 티 두 개, 후드 스웻셔츠 두 개, 페인터 팬트, 쇼트, 캠프 모자, 하네스® 탱크탑과 크루 양말, 가발, 지갑, 크립토나이트® 체인 + 디스크 잠금 및 스케이트보드로 구성되어 있다고 하네요.
<br><br>
해당 협업은 오는 28일 글로벌 발매를 거쳐 30일 아시아 전역에서 만나볼 수 있다고 합니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111113_43b414d507.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111112_681cf76947.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111111_53ca423d19.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111113_8b0403ffa4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111112_889b917b81.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111111_a4d00cf031.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1111110_60299bd448.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111119_5fb9d83472.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111118_c0e8d7a12c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111117_f053e16b04.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111116_c24d213345.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/111115_fefc7100b6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2533/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('의료 대란으로 메디컬 드라마 편성 연기', '고윤정 주연의 ‘슬기로울 전공의생활’의 편성이 연기됐다', 'categoryculture2522news-150', '2024-03-24', 'Culture', '["고윤정","슬기로울전공의생활","GoYounJung","ResidentPlaybook"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/t_b0f4dcf12e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f5d91fa702.jpg', '<br>

<p style="text-align:left;">의료대란에 ‘슬기로울 전공의생활’ 편성 연기. </p>

<br>

<p style="text-align:left;">배우 <a href="https://www.instagram.com/goyounjung/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">고윤정</strong></a> 주연의 <a href="https://www.instagram.com/tvn_drama/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">TvN</strong></a> 드라마 ‘언젠가는 슬기로울 전공의생활’의 편성이 연기됐습니다.
</p>

<br>

<p style="text-align:left;">정부의 의과대학 증원 방침에 반발한 의사들의 집단 사직 이슈와 맞물리게 된 것인데요.</p>

<br>

<p style="text-align:left;">실제로 지난달 8일 15초 분량의 드라마 티저 영상에 전공의들의 집단 행동에 대한 비판 댓글이 달리기도 했습니다. 드라마가 의사를 미화하는 것 아니냐는 의견이 주를 이룬 것이죠.</p>

<br>

<p style="text-align:left;">TvN 측은 상반기 방영 예정이었던 드라마 언젠가는 슬기로울 전공의생활을 하반기로 편성을 변경했으며, 편성 시기는 미정이라고 입장을 밝혔습니다.</p>

<br>

<p style="text-align:left;">한편 언젠가는 슬기로울 전공의생활은 ‘슬기로운 의사 생활’ 시리즈의 스핀오프로 전 시리즈와 같은 세계관을 공유한다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d3c14bac8b.jpg"]'::jsonb, '[]'::jsonb, '/category/Culture/2522/news/', 'published'),
('디테일 장인 포터와 토가, 여섯 번째 협업 출시', '포터와 토가가 또 한 번 협업 컬렉션을 출시했다', 'categoryfashion2519news-151', '2024-03-23', 'Fashion', '["포터","토가"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_aacd41e449.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e3b06c73bb.jpg', '<br>

<p style="text-align:left;">디테일이 아름다운 포터와 토가의 여섯 번째 만남.</p>

<br>

<p style="text-align:left;">‘일침입혼’을 모토로 전개해 나아가는 브랜드 <a href="https://www.instagram.com/porter_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포터</strong></a>와 디자이너 후루타 야스코의 브랜드 <a href="https://www.instagram.com/togaarchives/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">토가</strong></a>가 또 한 번 손을 잡았습니다.</p>

<br>

<p style="text-align:left;">숄더 파우치, 토트백, 백팩 총 3종으로 구성된 이번 컬렉션은 손잡이에 바이 컬러의 스카프를 감싼 디테일이 특징인데요.</p>

<br>

<p style="text-align:left;">포터 특유의 나일론 본딩 패브릭 원단을 사용하여 광택감과 부드러운 촉감을 느낄 수 있으며, 토가의 아이코닉한 장식을 더한 스페셜한 컬렉션입니다.</p>

<br>

<p style="text-align:left;">특히 아이언 블루 컬러는 숄더 파우치에서만 볼 수 있으며, 포터 스토어에서만 한정 판매하고 있다고 하는데요. </p>

<br>

<p style="text-align:left;">이번 시즌 컬렉션은 현재 오프라인 포터 압구정점, 온라인 포터 서울 공식 홈페이지에서 한정 수량으로 만나볼 수 있다고 하니, 두 브랜드를 사랑하는 패퍼들은 서둘러주세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b9d8bf0bd3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9c34737be4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_6e30edd984.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4da22f2768.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_ebd5129841.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_7bce5355f9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e42817c5b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_d3d2fe315d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2519/news/', 'published'),
('너와 나의 닥터마틴 세계로', '닥터마틴 협업 컬렉션들을 만나보자', 'categoryfashion2520news-152', '2024-03-23', 'Fashion', '["닥터마틴"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e6f315b90d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f665e033b0.jpg', '<br>

<p style="text-align:left;">닥터마틴, 어디까지 신어봤니?</p>

<br>

<p style="text-align:left;">올타임 스테디셀러 슈즈 <a href="https://www.instagram.com/drmartensofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">닥터마틴</strong></a>. 1960년대 군화 제작에서부터 시작해 펑크 헤리티지를 가진 클래식한 슈즈 브랜드로 변화하며 자리 잡았는데요.</p>

<br>

<p style="text-align:left;">딱딱한 첫인상과는 달리 계속 신다보면 아주 편한 착화감과 아이코닉한 옐로우 라인 디테일에 빠져들게 됩니다.</p>

<br>

<p style="text-align:left;">굉장히 많은 종류의 닥터마틴 세계 속에서도 가장 유니크한 실루엣과 디자인을 찾고 싶다면, 닥터마틴 협업 컬렉션을 확인해보는 건 어떨까요?</p>

<br>

<p style="text-align:left;">닥터마틴 매니아들도, 닥터마틴 입문자도 모두 사랑할 특별한 닥터마틴을 소개합니다.</p>

<br><br>

<br>

<p style="text-align:left;">닥터마틴 X MM6</p>

<br>

<p style="text-align:left;">이들의 첫 협업이 갑작스레 공개됐습니다. 24FW 밀라노 패션위크에서 MM6의 쇼 아이템으로 등장한 것. 마치 프랑켄슈타인 같은 슈즈. 닥터마틴 1461 더비 슈즈에 하이탑 발목 부분을 덧대 제작되었습니다.</p>

<br><br>

<br>

<p style="text-align:left;">닥터마틴 X 릭 오웬스</p>

<br>

<p style="text-align:left;">아주아주 긴 끈이 있다면 닥터마틴과 릭 오웬스의 부츠 실루엣을 만들 수 있습니다. 빈티지한 컬러감의 메가 슈 레이스를 러프하게 휘감은 것이 특징. 무엇이든 오버사이징을 선호하는 릭 오웬스의 아이덴티티가 묻어나는 디자인이네요.</p>

<br><br>

<br>

<p style="text-align:left;">닥터마틴 X 센트럴 세인트 마틴스</p>

<br>

<p style="text-align:left;">패션계 유망주들이 모인 센트럴 세인트 마틴스의 MA 과정 학생들이 닥터마틴 디자인에 도전했습니다. 닥터마틴의 오리지널 1460 실루엣을 창의적이고 신선한 감각으로 재탄생. 일반 브랜드와의 콜라보레이션보다 더 독특한 느낌이 듭니다.</p>

<br><br>

<br>

<p style="text-align:left;">닥터마틴 X 걸스 돈 크라이</p>

<br>

<p style="text-align:left;">베르디와 닥터마틴의 만남은 사랑스러운 실루엣으로 표현되었습니다. 가죽 패널과 헤어리한 앞코, 레이스 중앙엔 하트 참이 자리하고 있는데요. 베르디의 아내가 가장 좋아하던 실루엣으로 알려져 있으며, 따뜻하면서도 귀여운 무드가 가득한 컬렉션.</p>

<br><br>

<br>

<p style="text-align:left;">닥터마틴 X 슈프림</p>

<br>

<p style="text-align:left;">가장 최근에 발매된 닥터마틴과 슈프림 협업 컬렉션. 이번엔 신을수록 어퍼가 닳으면서 새로운 컬러가 등장하는 디테일이 담겼는데요. 힐 측면과 밑창 안쪽에 새겨진 슈프림 로고가 눈길을 사로잡네요. </p>

<br><br>

<br>

<p style="text-align:left;">여러 세대를 거쳐 다양한 디테일을 가진 슈즈들이 쏟아져나오고 있는데요. 특히나 미스치프처럼 유니크한 실루엣을 지속적으로 선보이는 브랜드들이 점차 늘어나며 대중들이 일반 소재의 슈즈보다는 조금 더 튀는 소재, 바이럴 요소가 많은 디자인에 눈길을 돌릴 수밖에 없습니다.</p>

<br>

<p style="text-align:left;">이번 닥터마틴과 슈프림의 소재는 걸을 때마다 밑창이 닳으면서 새로운 색상이 드러나는 미스치프의 Gobstomper 시리즈와 유사한데요. 조금 더 새로운 실루엣을 선보이고자 하는 이들의 도전, 어떻게 바라보시나요?</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d3d764fa84.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/MM_6_da8a4f8d55.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Rick_Owens_x_Dr_Martens_400cecb001.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2024_02_central_saint_martins_dr_martens_bursary_winner_announcement_9_00852e9d6e.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/GIRLS_DON_T_CR_Ycollab_ca9819c2e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f5b90070a9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DM_s_x_SUPREME_Another_chapter_lands_soon_Be_ready_Sign_up_via_the_link_in_bio_c2064c7f59.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2520/news/', 'published'),
('록의 손길이 닿은 H&M은?', '브랜드 록과 H&M이 협업 캡슐 컬렉션을 발매한다', 'categoryfashion2521news-153', '2024-03-23', 'Fashion', '["H&M","록"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a1578faa45.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_2440472588.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/rokhofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">록</strong></a>과 <a href="https://www.instagram.com/rokhofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">H&M</strong></a>, 이들의 협업은 어떤 느낌?!</p>

<br>

<p style="text-align:left;">최근 파리 패션위크를 뒤집은 한국 디자이너 황록의 브랜드 록과 SPA 브랜드 강자 H&M이 만났습니다.</p>

<br>

<p style="text-align:left;">이들의 컬렉션은 4월 18일 도착이라는 멘션과 함께 티저가 공개됐는데요. 클래식한 실루엣과 플라워 패턴, 아방가르드한 디테일과 레이어링 기술 등이 눈길을 사로잡습니다.</p>

<br>

<p style="text-align:left;">이번 한정판 캡슐 컬렉션의 추후 발매 소식도 &#60;PAP&#62;에서 만나보세요! </p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/2521/news/', 'published'),
('미스치프와 헬리녹스의 로즈 브라운빛 만남', '미스치프와 헬리녹스의 협업 컬렉션 출시', 'categoryfashion2512news-154', '2024-03-22', 'Fashion', '["MSCHF","helinox","미스치프","헬리녹스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_d17423f27d.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_8b8abd1d05.png', '<center>

</center>

<br>

<p style="text-align:left;">미스치프와 헬리녹스의 장미빛 만남
<br><br>
<a href="https://www.instagram.com/mschfhouse/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미스치프</strong></a>가 글로벌 아웃도어 브랜드 <a href="https://www.instagram.com/helinox_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">헬리녹스</strong></a>와 협업 컬렉션을 새롭게 선보입니다. 
<br><br>
미스치프의 키 컬러인 로즈 브라운을 중심으로 아웃도어의 강자 헬리녹스의 체어, 테이블 등의 아웃도어 퍼니처와 함께 아웃도어 스타일이 감미된 어패럴 라인까지 함께 만나볼 수 있는데요. 
<br><br>
퍼플 그레이, 올리브, 라이트 베이지 등의 산뜻한 컬러웨이로, 다가올 봄 캠핑시즌은 물론 일상에서의 스타일링까지 폭넓게 활용 가능하다는 점.
<br><br>
해당 컬렉션은 오는 30일(토) 헬리녹스 부산 크리에이티브 센터에서 가장 먼저 발매되며, 미스치프, 헬리녹스 온라인 및 오프라인 스토어에서는 4월 1일(월)부터 만나볼 수 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_90a4a63107.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_909e1ca939.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_51c20b5e26.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_a22c1b1ee1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_c04f40d64f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_417fffdf72.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_5bddba75c9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_2352e8e184.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_1b1315226f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_255a7c1951.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_1469721c2a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_c16595beac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_6af069d642.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_111dc2abf1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_3ba96c032b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_71bbeff3af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/19_b7c05981fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20_d0532c157a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2512/news/', 'published'),
('프레데릭 말과 협업한 아크네 스튜디오의 첫 향수', '깨끗한 세탁물과 들판, 프루티향의 조화', 'categorybeauty2513news-155', '2024-03-22', 'Beauty', '["acne studios","frederic malle","아크네 스튜디오","프레데릭 말","향수"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_1c00d568e2.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_db0e69563a.png', '<br>

<p style="text-align:left;">

내 첫 향기가 되어줄래? 아크네 스튜디오 첫 향수 출시
<br><br>
<a href="https://www.instagram.com/acnestudios/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아크네 스튜디오</strong></a>가 <a href="https://www.instagram.com/fredericmalle/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프레데릭 말</strong></a>과 손을 잡고 브랜드의 첫 번째 향수를 출시합니다.
<br><br>
해당 제품인 ‘아크네 스튜디오 파 프레데릭 말’은 깨끗한 세탁물과 들판, 그리고 약간의 프루티한 향이 담겨있는데요.
<br><br>
톱 노트는 핑크 알데하이드, 바이올렛, 오렌지 플라워 등으로, 미들 노트는 바닐라와 복숭아로 구성되어 산뜻함이 특징.  한편, 베이스 노트는 상대적으로 무거운 샌달우드와 인센스, 그리고 머스크 노트의 조합으로 완성되어 해당 제품만의 유니크한 향기가 기대되고 있습니다. 
<br><br>
‘아크네 스튜디오 파 프레데릭 말’의 가격은 한화 약 39만원으로 출시될 예정이며, 오는 4월 17일, 유럽 지역의 아크네 스튜디오와 프레데릭 말 매장, 온라인 스토어에서 발매된다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_035503e1ae.png"]'::jsonb, '[]'::jsonb, '/category/Beauty/2513/news/', 'published'),
('베를린 기반의 브랜드 032c, 한국 스토어 오픈?!', '032c가 다음 달 서울에 스토어를 오픈할 예정이다', 'categoryfashion2507news-156', '2024-03-20', 'Fashion', '["032c"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_317a89de37.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_86d6e04577.jpg', '<br>

<p style="text-align:left;">032c 드디어 한국에 상륙하다! </p>

<br>

<p style="text-align:left;">베를린 기반의 브랜드 <a href="https://www.instagram.com/032c/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">032c</strong></a>가 서울에 새로운 스토어를 오픈한다는 소식입니다.</p>

<br>

<p style="text-align:left;">032c는 2000년에 시작된 매거진이자 2018년부터는 첫 컬렉션을 선보이는 등의 다양한 방면에서 활발한 활동을 보여 주고 있는데요.</p>

<br>

<p style="text-align:left;">서울 스토어 오픈 소식 또한 인스타그램 대댓글을 통해 공개됐습니다. 한 누리꾼의 “Why We live in Seoul?”이라는 댓글을 통해 다음 달 032c 스토어가 서울에서 오픈한다고 깜짝 스포일러를 날린 것이죠.</p>

<br>

<p style="text-align:left;">아직 자세한 사항은 공개되지 않았지만 벌써부터 많은 이들의 이목이 집중되고 있는 것 같네요.</p>

<br><br>

<br>

<p style="text-align:left;">Image Credit: 032c</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_65f3bd8d52.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_09319428f0.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2507/news/', 'published'),
('세븐틴의 민규가 불가리의 새로운 로컬 앰버서더로 발탁됐다', '앞으로 민규는 불가리와 함께 다양한 활동을 보여 줄 예정이다', 'categoryfashion2500news-157', '2024-03-19', 'Fashion', '["세븐틴","민규","불가리","MinGyu","Bulgari"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9a15e0084e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_03926a347e.jpg', '<br>

**<p style="text-align:left;">불가리의 새로운 로컬 앰버서더, 민규!</p>**

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/saythename_17/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">세븐틴</strong></a>의 <a href="https://www.instagram.com/min9yu_k/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">민규</strong></a>가 이탈리아 럭셔리 주얼리 브랜드인 <a href="https://www.instagram.com/bulgari/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">불가리</strong></a>의 로컬 앰버서더로 발탁됐습니다. </p>

<br><br>

<br>

<p style="text-align:left;">이번 파트너십은 불가리의 글로벌 확장 및 아시아 시장에서의 브랜드 인식 증대를 위한 중요한 발걸음이 될 예정인데요.</p>

<br>

<p style="text-align:left;">앞으로 민규는 불가리와 함께 다양한 활동을 보여 줄 예정이라고 합니다.</p>

<br>

<p style="text-align:left;">한편 민규는 최근 서울에서 열린 불가리 스튜디오 글로벌 이벤트에서 불가리의 아이코닉 컬렉션인 비제로원을 착용하고 완벽한 스타일링을 보여 줘 화제가 됐습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_2604ace01b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_34476ab8c3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_4a6435b857.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2500/news/', 'published'),
('아일릿이 이끌린 아크네 스튜디오 월드', '아크네 스튜디오 SS24 캠페인에 등장한 아일릿', 'categoryfashionmusic2484news-158', '2024-03-16', 'Fashion,Music', '["아일릿","아크네 스튜디오"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8117a5103b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d48d9170af.jpg', '<br>

<p style="text-align:left;">하이브의 유망주, <a href="https://www.instagram.com/illit_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아일릿</strong></a>이 아크네 스튜디오와 함께한 첫 캠페인.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/acnestudios/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아크네 스튜디오</strong></a>의 SS24 캠페인에 하이브의 신인 걸그룹 아일릿이 등장해 대중을 놀라게 했습니다. 멤버들은 모두 이번 파리패션위크 아크네 스튜디오 쇼에 참석한 바 있는데요.</p>

<br>

<p style="text-align:left;">이 쇼에서는 SS24 컬렉션 피스와 멀티포켓 백을 착용하며 남다른 소화력을 보여주었습니다.</p>

<br>

<p style="text-align:left;">청순한 매력을 가진 그룹이지만 아크네 스튜디오의 아이코닉한 레더와 데님룩을 힙한 매력으로 살린 이들.</p>

<br>

<p style="text-align:left;">특히 이번 캠페인에서 아직 발매 전인 아일릿의 데뷔 앨범 수록곡 ‘My World’가 짧게 선보여져 더욱 주목을 받고 있습니다.</p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_011aba2f27.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_7171cddf18.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b7d6887f7e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_aa989d7c78.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_759b11b05e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_cb946f2fd8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_7b78bc5046.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Music/2484/news/', 'published'),
('풍경을 자유롭게 넘나드는 오스트리야 X 로아의 SS24', '오스트리야와 로아의 협업 제품 국내 출시', 'categoryfashion2479news-159', '2024-03-15', 'Fashion', '["오스트리야","로아"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4bfdf2ddc4.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d8b20c180d.jpg', '<br>

<center>

</center>

<br>

<p style="text-align:left;">아웃도어를 동경하고 진화하는 마음을 가진 두 브랜드의 협업. </p>

<br>

<p style="text-align:left;">아웃도어 브랜드 <a href="https://www.instagram.com/ostryaequipment_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오스트리야</strong></a>가 풋 웨어 브랜드 <a href="https://www.instagram.com/roahiking/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">로아</strong></a>와의 협업 컬렉션을 선보였습니다.</p>

<br>

<p style="text-align:left;">이번 컬렉션은 형태와 기능, 자연환경과 도시 주거 사이의 연결을 강조하는 두 브랜드의 비전을 공통점으로 하여 시작되었는데요.</p>

<br>

<p style="text-align:left;">모던한 느낌을 가미한 클래식한 투톤 하이킹 팬츠와 봄의 태양과 활기찬 풍경을 모티브로 한 옐로우 컬러웨이의 카타리나 슈즈.</p>

<br>

<p style="text-align:left;">이 두 제품군은 현재 오스트리야의 공식 홈페이지에서 만나보실 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_13_2eae5e26b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_1_158121af60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_2_b024e0251a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_10_56954f9482.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_11_699e306488.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_3_030ca65f1b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_4_f91df4eb2b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_5_faa0ed6a82.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_8_272c892515.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Roa_Ostrya_9_2384f47ad9.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2479/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('와이 프로젝트와 글렌 마틴스의 10주년 스페셜', '글렌 마틴스의 와이 프로젝트 10주년 기념 룩북', 'categoryfashion2469news-160', '2024-03-13', 'Fashion', '["글렌 마틴스","와이 프로젝트"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_098bedfc18.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_679aae3ccc.jpg', '<br>

<p style="text-align:left;">와이 프로젝트와 함께한 글렌 마틴스의 10주년. </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/glennmartens/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">글렌 마틴스</strong></a>가 이끄는 <a href="https://www.instagram.com/yproject_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">와이 프로젝트</strong></a>의 10주년 기념 FW24 룩북이 공개됐습니다.</p>

<br>

<p style="text-align:left;">해체주의를 근간으로 다양한 실루엣의 베리에이션과 특히 데님 소재와 컷팅, 셔링 등의 무한한 디테일들을 선보이는 와이 프로젝트.</p>

<br>

<p style="text-align:left;">이번에는 데님 팬츠를 절개해 나일론 소재를 비치게 연출하는 방식, 단추로 셔링과 길이를 조정할 수 있는 팬츠와 같이 한층 더 독특한 디자인을 전개했는데요.</p>

<br>

<p style="text-align:left;">지금 슬라이드를 넘겨 이들의 새로운 룩북을 확인하세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_10_318bc54408.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_32_fae77b7b64.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_23_2b4fbe0a59.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_18_341714bc66.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_16_16a0d497ed.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_14_7c9f7dded6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_8_34ac8ac3fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_5_d31d8f1ec0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_2_d4ad26de51.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/YPFW_24_LOOK_1_bcb42db24d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2469/news/', 'published'),
('배우 안효섭이 라코스테의 앰버서더로 발탁됐다', '앞으로 배우 안효섭과 다양한 파트너십 활동을 선보일 예정이다', 'categoryfashion2470news-161', '2024-03-13', 'Fashion', '["라코스테","안효섭","Lacoste","AhnHyoSeop"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b2865fbebd.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_413fa06b9b.jpg', '<br>

<p style="text-align:left;">배우 <a href="https://www.instagram.com/imhyoseop/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">안효섭</strong></a>이 <a href="https://www.instagram.com/lacoste/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">라코스테</strong></a>의 새로운 얼굴이 됐다.</p>

<br>

<p style="text-align:left;">프렌치 패션 스포츠를 대표하는 브랜드인 라코스테의 새로운 앰버서더의 주인공은 바로 배우 안효섭입니다.</p>

<br><br>

<br>

<p style="text-align:left;">안효섭은 현지 시간으로 지난 5일 <a href="https://www.instagram.com/parisfashionweek/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">파리 패션 위크</strong></a> 라코스테의 FW24 패션쇼 참석을 기점으로 올해부터 하우스의 앰버서더로 합류하게 되었습니다. </p>

<br>

<p style="text-align:left;">앞으로 안효섭과 라코스테는 다양한 파트너십 활동을 선보이며 계속해서 새로운 모습으로 찾아올 예정이라고 하니 더욱 기대되는 바네요.</p>

<br>

<p style="text-align:left;">Image Credit: X - ThePresent_twt</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/GINI_7d_Nb_EA_Aupzc_3d3ccd2fcb.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/GINI_7d_Lag_AAA_e6_0177c46059.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/GINI_7d_Nbg_AE_Ux_RW_53e6b3aefb.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2470/news/', 'published'),
('고샤 루브친스키가 돌아왔다! 이지 새 라인업 ‘고샤’ 공개', '현재 이지 사이트에서 20달러에 구매할 수 있다', 'categoryfashion2464news-162', '2024-03-11', 'Fashion', '["고샤루브친스키","고샤","칸예","이지","yzy","yeezy","gosharubchinskiy","gosha"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_b4f8fd11e6.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_3265f0a72d.png', '<br>

<p style="text-align:left;">전부 20달러에 팔아요. 고샤의 디자인도 예외는 없어요 
<br><br>
<a href="https://www.instagram.com/gosharubchinskiy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">고샤 루브친스키</strong></a>가 <a href="https://www.instagram.com/ye/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">칸예</strong></a>의 브랜드 <a href="https://www.instagram.com/yzy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이지</strong></a>의 새로운 라인업 ‘고샤’를 새롭게 선보입니다. 
<br><br>
고샤 루브친스키는 지난 해 말 이지의 새로운 크리에이티브 디렉터로 임명되었는데요. 
<br><br>
당시 ‘논란의 디자이너’라는 타이틀을 가진 그를 임명한 것만으로도 이지가 앞으로 보일 행보에 대해 많은 이들의 관심이 집중 되었습니다. 
<br><br>
그가 침묵을 깨고 발표한 이번 이지의 새로운 캡슐 ‘고샤’는 회색 후디, 티셔츠, 스웨트 팬츠 등 편안한 일상복으로 발표되었는데요.
<br><br>
의류의 앞면에는 루브친스키의 국적인 러시아어로 ‘BLACK DOG’라는 문구가 새겨져있습니다.
<br><br>
해당 상품은 이지의 사이트에서 개당 20달러&#40;한화 약 2만 7천원&#41;으로 구입 가능하다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d4c64f3101.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_44e19c3765.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9626ea9e67.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_c7efdff665.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d5d114f15c.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/2464/news/', 'published'),
('LEEY와 마주한 새로운 클래식 라인', '데일리한 아이템들을 최상의 품질로 선보이며 소장 가치를 높였다', 'categoryfashion2458news-163', '2024-03-10', 'Fashion', '["LEEY"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bc5faa69ab.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5bd4959408.jpg', '<br>

<p style="text-align:left;">LEEY와 클래식이 만나다. </p>

<br>

<p style="text-align:left;">다양한 영감의 범주에서 매시즌 새로운 컬렉션을 선보이는 브랜드 <a href="https://www.instagram.com/l.e.e.y/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">LEEY</strong></a>가 새로운 클래식 라인을 발매합니다. </p>

<br><br>

<br>

<p style="text-align:left;">이번 컬렉션의 제목은 ‘Black Hearts’로 최상의 품질로 클래식한 디자인을 아우르는 콘셉트인데요.</p>

<br>

<p style="text-align:left;">실버 또는 아이론 디테일로 하드웨어를 통한 다크함과 동시에 다채로운 컬러감을 통해 키치한 매력까지 더한 것을 확인할 수 있습니다.</p>

<br>

<p style="text-align:left;">LEEY의 새로운 SS24 클래식 라인 컬렉션은 오는 18일과 27일에 순차적으로 공개될 예정이라고 하니 놓치지 마세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243392_fcb3c57141.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243508_e2e7dd836c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243529_a3d3abc55f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243584_b9772ac6ef.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243628_bd052c938b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243669_987c66f1ed.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20243719_b0c7043d22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20244118_aa23bc84e8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20244231_3485d23695.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20244295_193f067146.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20244380_bd73974a3f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LEEY_20244435_8da172567e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2458/news/', 'published'),
('사랑과 팀버랜드는 다시 돌아오는거야!', '다시 트렌드로 떠오른 신발 브랜드 ‘팀버랜드’', 'categoryfashion2441news-164', '2024-03-07', 'Fashion', '["timberland","팀버랜드"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_76224a24f9.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_c0152da22e.png', '<br>

<p style="text-align:left;">떴다 팀버랜드! 또 다시 찾아온 6인치 부츠 열풍 
<br><br>
요즘 여기저기 다시 눈에 보이고 있는 브랜드, <a href="https://www.instagram.com/timberland/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">팀버랜드</strong></a>가 최근 <a href="https://www.instagram.com/pharrell/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">퍼렐</strong></a>과 함께 <a href="https://www.instagram.com/louisvuitton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이비통</strong></a> 24 가을 겨울 쇼에서 콜라보를 이루어내며 큰 화제를 불러일으켰는데요.
<br><br>
&#60;피에이피&#62;가 평범한 팀버랜드는 싫은 패퍼들을 위해 다양한 팀버랜드 컬렉션을 소개합니다. 
<br><br>
슬라이드를 넘겨 내 취향에 맞는 팀버랜드는 어떤 스타일인지 찾아보는 건 어떨까요? 팀버랜드 뉴스타일의 A-Z를 지금 만나보세요! </p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_83ba5e2ef1.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_ba42856e3e.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ccda1a52e2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_6844423652.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_16b46cbb8c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_31d4a20adc.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_1e34fe3653.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_fb0d6c637d.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_88e36c25ec.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_f6c1dcb9ab.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_2e2465ba1d.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/2441/news/', 'published'),
('축구를 사랑하는 마음을 담은 엄브로와 팔라스의 만남', '영국 축구 문화와 프리미어에서 영감을 얻었다', 'categoryfashion2434news-165', '2024-03-06', 'Fashion', '["엄브로","팔라스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5f302ca672.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bbf1a25708.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>의 100주년 그리고 첫 번째 콜라보레이션의 주인공!</p>

<br>

<p style="text-align:left;">엄브로와 <a href="https://www.instagram.com/palaceskateboards/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">팔라스</strong></a>가 영국 축구 문화와 프리미어 리그에서 영감을 얻은 Spring ’24 캡슐 컬렉션을 발매합니다. </p>

<br><br>

<br>

<p style="text-align:left;">이번 협업 컬렉션은 엄브로의 과거 아카이브에서 다양한 요소를 채택하여 트랙 셋업과 저지, 양말 및 모자 등과 같은 다채로운 라인업을 선보일 예정인데요.</p>

<br>

<p style="text-align:left;">사이키델릭한 아이콘과 뒤틀린 그래픽 그리고 엄브로 특유의 레트로함이 가득 담겨 발매 전부터 큰 주목을 받고 있습니다.</p>

<br>

<p style="text-align:left;">엄브로와 팔라스의 협업 캡슐 컬렉션은 오는 9일 팔라스 서울 오프라인 매장에서 래플을 통해 만나 볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_80801890c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d791c46429.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_fef6d1dd76.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_9d8e52f714.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_5f9e48e0aa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_8a9329a63b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_818aa64c6f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_40c7db47f9.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2434/news/', 'published'),
('내셔널지오그래픽의 24SS 고프코어 룩', '내셔널지오그래픽의 24SS 고어텍스 & 바람막이 캡슐 컬렉션이 공개됐다', 'categoryfashion2385news-166', '2024-02-25', 'Fashion', '["내셔널지오그래픽"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3879231c14.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1ca87e3296.jpg', '<br>

<p style="text-align:left;">질풍 속에서 마주한 고요함.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ng_apparel/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">내셔널지오그래픽 어패럴</strong></a>의 24SS 고어텍스 & 바람막이 컬렉션이 공개됐습니다.
</p>

<br>

<p style="text-align:left;">‘CALM AMIDST THE GALE’을 테마로 브랜드 아이덴티티를 담은 유틸리티 캐주얼 웨어들을 선보인 내셔널지오그래픽 어패럴. </p>

<br><br>

<br>

<p style="text-align:left;">시즌 메인 상품인 고어텍스 자켓과 오거스틴 바람막이 라인업도 인상적이죠.</p>

<br>

<p style="text-align:left;">그 중 ''어반시티 방수 3L 맥코트’는 프리미엄 고어텍스사 3L 소재를 사용해 생활 방수는 물론 방풍, 투습 기능을 높인 것이 특징이라고 합니다.</p>

<br>

<p style="text-align:left;">함께 선보인 ‘어반시티 2L 방수자켓’과 ‘오거스틴 블록킹 점퍼’ 또한 우수한 방풍성과 쾌적한 착용감을 가진다고 하네요.</p>

<br>

<p style="text-align:left;">기능성과 스타일을 겸비한 내셔널지오그래픽 24SS를 지금 바로 엔스테이션몰에서 만나 보세요!</p>

<br><br>

<br>

<p style="text-align:left;">Image Credit: National Geographic Apparel</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9305eca837.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_519f873baa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_d666330a5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_135c434dcb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_f4a019cab8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_82ba7dd5b6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_8743000005.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_6dce1784ae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_d4dd48bf85.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_26b2cf3e88.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2385/news/', 'published'),
('자연을 탐험하는 모든 순간에 하이드로겐과 함께 하는 4가지 방법', '이탈리안 액티브 아웃도어 브랜드 하이드로겐의 슈즈 캠페인', 'categoryfashion2378news-167', '2024-02-22', 'Fashion', '["하이드로겐","Hydrogen"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy4_11be1c1f1e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_21d46b654f.png', '<br>

<p style="text-align:left;">모험을 떠나는 ‘마운틴 하이커’를 위한 하이드로겐
<br><br>
이탈리아의 헤리티지를 담은 이탈리안 액티브 아웃도어 브랜드 <a href="https://www.instagram.com/hydrogen.korea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">하이드로겐</strong></a>이 마운틴 하이커를 위한 슈즈 캠페인을 새롭게 공개합니다. </p>

<br><br>

<br>

<p style="text-align:left;">트레일러닝에 적합한 크롬24, 비브람 아웃솔과 다이얼로 미끄럼 방지에 탁월한 알비37, 본 디테일과 45mm 키높이효과를 가진 클로그 디자인의 시논54, 쿠셔닝으로 발의 피로도를 줄이는 피비82.
<br><br>
총 4가지 라인으로 공개된 이번 캠페인은 익사이팅을 사랑한다면 남녀노소 자주 손이 갈 만한 아이템들로 구성되었는데요.
<br><br>
모델 <a href="https://www.instagram.com/czonsuxx/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">채종석</strong></a>과 함께 한 이번 하이드로겐 캠페인을 스크롤을 당겨 더욱 자세히 만나보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy4_0e3e9683ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy3_b4f59a635c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy2_1159e2f546.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy1_cb17dd46a9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy6_95d6986aa0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy7_6ddae93175.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy5_6c88153276.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy11_58245fcaf2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy10_02a9f36dbc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy9_35df614216.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/hy8_69bad385bf.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2378/news/', 'published'),
('가장 아름다울 그의 커스텀 팀버랜드', '마티아스 골린의 커스텀 팀버랜드 디자인 공개', 'categoryfashion2375news-168', '2024-02-21', 'Fashion', '["팀버랜드","커스텀","퍼렐"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_58edff3f48.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_416dd6de76.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/pharrell/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">퍼렐</strong></a>이 가장 사랑할 <a href="https://www.instagram.com/timberland/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">팀버랜드</strong></a>?</p>

<br>

<p style="text-align:left;">신발 커스텀 디자이너 <a href="https://www.instagram.com/mattias_gollin/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마티아스 골린</strong></a>이 선보인 ‘The Timbs’ 디자인이 화제입니다.</p>

<br>

<p style="text-align:left;">그는 팀버랜드의 50주년을 기념하여 퍼렐의 데뷔 컬렉션에 영감을 받은 업사이클링 컬렉션을 공개했는데요.</p>

<br>

<p style="text-align:left;">진주와 크리스탈, 그리고 나무 모양의 탈부착식 팀버랜드 로고 슈즈 케이지가 한층 달라진 팀버랜드의 느낌을 선사합니다.</p>

<br><br>

<br>

<center>

</center>

<br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_7c33d54f1a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e32102cc5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_1057fe7fb0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_8bdf6fa92a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2375/news/', 'published'),
('청춘이 가득 담긴 푸마와 노아의 협업', '푸마와 노아의 네 번째 협업 컬렉션', 'categoryfashion2376news-169', '2024-02-21', 'Fashion', '["푸마","노아"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0cb6a680ad.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d1f6da44a7.jpg', '<br>

<p style="text-align:left;">Do it for yourself! </p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/puma_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>와 <a href="https://www.instagram.com/noahclothing/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">노아</strong></a>의 네 번째 협업 컬렉션이 런칭됐습니다. 이번 컬렉션에선 오프 듀티 선수의 정신을 표현했는데요. </p>

<br>

<p style="text-align:left;">방과 후 활동, 라커룸, 체육관 등을 배경으로 해 청춘의 주체성이 담겨 있는 것이 중점.</p>

<br>

<p style="text-align:left;">아메리칸 스포츠웨어를 집약적으로 선보이며, 서스펜더 팬츠부터 스웻 셋업까지 노스탤직한 감성으로 똘똘 뭉친 디자인을 전개했습니다.</p>

<br>

<p style="text-align:left;">풋웨어에서는 복고풍에서 영감 받은 레슬링 부츠를 포함, 푸마 아리조나 제품을 새롭게 선보이는데요. 이번 컬렉션은 현재 노아 시티하우스 외 다양한 홈페이지에서 만나보실 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_8cec309fa2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_dd0154b7fc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e8fd9a8e00.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_38ce0db141.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_4b1a758a6e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2376/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('정국이 말아주는 매력 가득 캘빈클라인 캠페인 영상 공개', '캘빈클라인 캠페인에 모습을 드러낸 BTS 정국', 'categoryfashion2347news-170', '2024-02-15', 'Fashion', '["bts","Jungkook","calvinklein","캘린클라인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_f956ccdbc9.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/576_5194518fb2.png', '<center>

</center>

<br>

<p style="text-align:left;">선생님.. 캘빈클라인X정국 영상이 안끝나요.. 
<br><br>
BTS 정국이 <a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘린클라인</strong></a>과 함께한 캠페인 비디오에서 모습을 드러냈습니다. 
<br><br>
뉴욕의 그랜드 센트럴 터미널을 배경으로 탈의한 상의에 가벼운 셔츠만 걸친 채 가벼운 정국의 춤선을 보여주는 짧은 영상이지만 팬들의 마음을 사로잡기엔 충분해 보이네요. 
<br><br>
도무지 끝나지 않는 이번 캘빈클라인 캠페인 영상을 통해 정국의 마력을 느껴보세요!</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/2347/news/', 'published'),
('슈프림과 마르지엘라, 슈프림 30주년 기념 콜라보', '슈프림과 메종 마르지엘라의 특별한 협업 소식', 'categoryfashion2318news-171', '2024-02-09', 'Fashion', '["슈프림","마르지엘라"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_daa4421f64.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_426cd629b5.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/supremenewyork/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슈프림</strong></a>과 <a href="https://www.instagram.com/maisonmargiela/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">메종 마르지엘라</strong></a>, 스트릿과 오뜨꾸뛰르의 아주 특별한 만남.</p>

<br>

<p style="text-align:left;">슈프림의 30주년을 맞이해 독특한 협업이 찾아온다는 소식입니다. 24SS 시즌에 출시되는 것으로 예상되는 이번 협업.</p>

<br>

<p style="text-align:left;">이 컬렉션에서는 슈프림의 시그니처 박스 로고 후디를 포함한 다양한 패션 아이템이 자리할 예정이라고 하는데요. 추후 정확한 발매 정보도 &#60;피에이피&#62;와 함께 하세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme_x_Maison_Margiela_OTW_Credit_themacint0sh_kaasvision_supreme_supremeleaks_maisonmargiela_margiela_supremenyc_supremenewyork_226beb62d5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Supreme_x_Maison_Margiela_OTW_Credit_themacint0sh_kaasvision_supreme_supremeleaks_maisonmargiela_margiela_supremenyc_supremenewyork_1_6511f6cff6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2318/news/', 'published'),
('오스트리야와 Mmlg, 스페셜 오더 컬렉션 공개', '오스트리야와 Mmlg의 국내 첫 스페셜 오더 컬렉션 공개', 'categoryfashion2265news-172', '2024-01-26', 'Fashion', '["오스트리야","Mmlg"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7e4abd7466.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4c128d475f.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ostryaequipment_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오스트리야</strong></a>가 <a href="https://www.instagram.com/official_mmlg/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Mmlg</strong></a>와의 스페셜 오더 컬렉션을 공개했습니다. 몬트리올 기반의 하이 퍼포먼스 기어 웨어 브랜드인 오스트리야.</p>

<br>

<p style="text-align:left;">Mmlg의 슬로건 ‘Chat Play Casually’를 모토로 제작된 유쾌한 마운티니어링 제품들을 공개했는데요. 일상부터 아웃도어까지 아우르는 롱 슬리브, 티셔츠, 니트 캡, 초크 백으로 구성.</p>

<br>

<p style="text-align:left;">오스트리야의 국내에서 처음 선보이는 스페셜 오더 컬렉션, 지금 바로 87MM 온라인 스토어에서 만나보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bf7d0ce814.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/87mm_0066_cbb545819f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/87mm_0145_64cbbfe5b7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/CAM_2_0604_5f47d43279.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/CAM_2_0563_44be22f777.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2265/news/', 'published'),
('썬번키즈의 CHAN, 4번째 챕터가 공개됐다', '컬렉션 발매를 앞두고 <피에이피>와 짧은 대화를 나눴다', 'categoryfashionmusic2268news-173', '2024-01-26', 'Fashion,Music', '["썬번키즈","CHAN","interview","인터뷰"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_f6af92855d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_5bb999c9fe.jpg', '<br>

<p style="text-align:left;">디렉터 <a href="https://www.instagram.com/sunburnkids/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">썬번키즈</strong></a>의 브랜드 <a href="https://www.instagram.com/chapterofchan/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">CHAN</strong></a>의 4번째 컬렉션이 공개됩니다.
<br><br>
브랜드 CHAN은 그가 유년 시절부터 느낀 다양한 이야기들을 동화적으로 풀어내는 하나의 다이어리인데요.
<br><br>
이번 컬렉션의 제목은 ‘BABY BEETHOVEN’으로 그가 순수를 기억하는 방식으로 자주 듣던 베토벤의 악보와 피아노, 그림, 벽돌 등을 통해 표현되었다고 합니다.
<br><br>
컬렉션 발매를 앞두고 썬번키즈와 짧은 대화를 나눴습니다. 썬번키즈와 함께 한 인터뷰 전문을 지금 바로 확인해 보세요.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> &#60;피에이피&#62; 구독자분들을 위한 자기 소개 부탁드려요.</p>

<p style="text-align:left;"><strong>A.</strong> 안녕하세요. 저는 chapterofchan의 디렉터이자 최근 첫 믹스 테이프를 발표한 sunburn입니다.</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 브랜드 ‘CHAN’이 4번째 드롭을 앞두고 있습니다. 그동안의 근황과 컬렉션 드롭을 앞두고 있는 심정은 어떠신가요?</p>

<p style="text-align:left;"><strong>A.</strong> 그동안 다양한 것들을 제 삶에서 정리하고 선택하면서 제 안의 숨은 감정들이 문을 열게 된 것 같아요.
<p style="text-align:left;">그 속에서 제 이성 뒤에 숨은 부끄러운 것들까지도 기도하며, 끄집어내다보니 사실 요즘은 그분의 뜻이 무엇인지만 갈구하고 있어요. 이제는 저에게 있어 발매와 같은 것들이 테스트로 다가오는 것 같습니다.</p></p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 컬렉션을 은찬 님의 유년 시절을 담은 하나의 다이어리에 비유하셨죠. 어떤 내용이 보는 이들에게 가장 와닿았으면 하나요?</p>

<p style="text-align:left;"><strong>A.</strong> 이번 컬렉션은 저의 유년기로 가득해요. 제가 사랑하는 쉐입이었던 벽돌 무늬와 울타리도 있고요. 전 제 자신을 목장의 외톨이인 염소라고 생각하고 살았거든요. 또 오랫 동안 들었던 베토벤의 concerto in d major, opus 61도 악보로서 등장해요.
<p style="text-align:left;">전 이런 것들을 통해 제 초심을 기억하고 싶었어요. 요즘 전 정말 많은 지친 사람들을 만나거든요. 앞만 보고 달리기에 모두 감정이 메말라 있었어요. 누군가 그들을 봤을 땐 화려하고 반짝여 보이기에 부러워하기도 하지만 자세히 들여다보면 사실 그렇지도 않더라고요.</p>
<p style="text-align:left;">그런 와중 전 베토벤의 생애가 떠올랐습니다. 모든 사람이 부러워할 만한 음표를 이해하는 방식, 물론 유명세 등 모든 명예를 가졌지만 결국 귀울음 증세로 유서까지 썼던 그의 생애를 보며, 아이 때의 베토벤의 그 초심과 순수를 이야기하고 또 저에게 대입해 보기도 했어요.</p></p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 작년 10월 뮤지션으로 데뷔한 후의 이야기가 궁금해요. 전과 달라진 게 있나요?</p>

<p style="text-align:left;"><strong>A.</strong> 어떤 분께서 저희 아이가 음악을 너무 잘 듣고 있다고 하셔서 사실 부담감이 커졌어요. 내가 이 아이에게 솔직해지려면 내 삶 작은 부분까지도 솔직해져야겠구나, 또한 내가 어떤 책임감으로 가사를 써야 하는지에 대한 고민들로 더욱 다음 앨범을 고심하며 만들어가고 있습니다.
<p style="text-align:left;">
다른 영상 혹은 그림보다 음악은 결국 삶을 이야기하는 직설적인 대화이기 때문에 더 매력적이기도 하면서 무서운 것 같아요. 그래서 더욱 제 삶을 잘 가꾸어 나가는 것이 중요하고요.</p></p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 주로 어디에서 영감을 얻어요?</p>

<p style="text-align:left;"><strong>A.</strong> 제가 쓰는 글들?</p>

<br><br>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 앞으로의 행보는요? 스포해 주세요.</p>

<p style="text-align:left;"><strong>A.</strong> 다음 앨범에 집중하고 있고, chapterofchan에서의 이야기들, 아이들이 바른 기준 안에서 자랄 수 있는 학교를 세우는 것을 마음에 새기고 기도하고 있습니다.</p>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 마지막으로 &#60;피에이피&#62; 구독자에게 전하고 싶은 메시지가 있다면.</p>

<p style="text-align:left;"><strong>A.</strong> 다들 망각하기 위해 살아가십니까? </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_cb39c61b1e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ceda910d14.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_1a37c2c973.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_3476673558.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_c24d8106da.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_7ce6a9b622.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_98006edb8b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_f37d874616.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_cb2bb0c59e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_dedf0fc64d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Music/2268/news/', 'published'),
('파리를 사로잡은 송지오의 24FW 컬렉션 ‘NIGHT THIEVES’', '송지오의 24FW 컬렉션이 파리패션위크에서 공개됐다', 'categoryfashion2263news-174', '2024-01-24', 'Fashion', '["송지오","NIGHT THIEVES","24FW","SONGZIO","파리패션위크","parisfashionweek","리복","REBOK"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_8467e4009b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_7b20d37327.jpg', '<p style="text-align:left;">질서와 무질서 안에 공존하는 동양과 서양의 미학, <a href="https://www.instagram.com/songzio_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">송지오</strong></a>의 24FW 컬렉션. </p>

<br><br>

<br>

<p style="text-align:left;">한국을 대표하는 디자이너 브랜드 송지오가 지난 19일 파리패션위크에서 24FW 컬렉션 ‘NIGHT THIEVES’를 공개했는데요.
<br><br>
지난 시즌에 이어 현대 미술 전시관 팔레 드 도쿄(Palais de Tokyo)의 ‘ORBE NY ET TROIS CONVERSATIONS’관에서 선보인 이번 컬렉션. 매 시즌 극적인 연출과 압도적인 스케일을 선보인 송지오는 강렬한 분위기의 컬렉션으로 파리의 어두운 밤을 사로잡았습니다. </p>

<br><br>

<br>

<p style="text-align:left;">‘NIGHT THIEVES’ 라는 타이틀로 선보인 이번 컬렉션은 송지오의 안티히어로인 밤의 도둑들을 그려냈는데요. 신이 감추어둔 불을 훔쳐 인간에게 내어준 죄로 천벌을 받고 있는 프로메테우스를 묘사하는 그림에서 영감을 받은 디자인. </p>

<br><br>

<br>

<p style="text-align:left;">송지오 고유의 동양적인 실루엣을 강조하여 입체적이고 우아한 실루엣과 볼륨이 특징입니다. 여러 겹의 원단을 레어어링한 의상들이 정적일 때는 마치 갑옷처럼, 동적일 때에는 역동적으로 휘날리는 부분이 인상적.</p>

<br><br>

<br>

<p style="text-align:left;">송지오의 아방가르드 디자인과 <a href="https://www.instagram.com/reebokkorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리복</strong></a>의 역동적인 스타일을 결합해 선보이는 이번 콜라보레이션 슈즈는 24년 6월 출시될 예정.
<br><br>
올해 서울과 파리 플래그십 스토어 동시 오픈을 알리며 공격적인 활동을 예고하는 송지오의 24FW 컬렉션을 &#60;피에이피&#62;에서 만나보세요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d2b83dbedf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9f9d825015.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_1423bff5db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_53afe04b89.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_ef82d560d8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_48daf50ea9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_148a5d444a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_ea434a6eb2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_2902b6effc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_3ac03f7eb7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2263/news/', 'published'),
('우리가 다시 사랑하게 될 구찌의 24SS 앙코라 컬렉션', '시대를 초월한 아름다움과 개인적 표현을 주제로 전개했다', 'categoryfashion2213news-175', '2024-01-10', 'Fashion', '["구찌"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/417751408_18213584782274035_3030050008490493977_n_301532b8f7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0000cfe8c3.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/gucci/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">구찌</strong></a>의 2024 봄, 여름 ‘앙코라(ancora)’ 캠페인.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/sabatods/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">사바토 데 사르노</strong></a>의 데뷔 컬렉션인 24SS는 시대를 초월한 아름다움과 개인적 표현을 주제로 전개합니다. </p>

<br><br>

<br>

<p style="text-align:left;">밀라노 패션 위크에서 새롭게 재탄생한 구찌는 사바토 데 사르노가 사랑하는 패션에 대한 이야기가 가득하다고 할 수 있는데요.</p>

<br>

<p style="text-align:left;">테일러 코트, 타이트한 핏의 탱크탑, 구찌 하면 빠질 수 없는 버건디 컬러의 레더 제품들까지.</p>

<br>

<p style="text-align:left;">90년대 신발과 70년대 주얼리를 동시에 볼 수 있는 컬렉션에서 현대적인 대담함을 느껴 보세요. 어느새 다시 구찌와 사랑에 빠진 자신을 발견할 수 있을 것.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Diary_Article_Single_Gucci_Spring_Summer24_Dec23_04_001_Default_74cfb36d9c.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Diary_Article_Single_Gucci_Spring_Summer24_Dec23_01_001_Default_da45fbdc20.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Diary_Article_Single_Gucci_Spring_Summer24_Dec23_05_001_Default_2d13d91cca.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Diary_Article_Single_Gucci_Spring_Summer24_Dec23_02_001_Default_3018231dea.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/417751408_18213584782274035_3030050008490493977_n_8c1f8f9211.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/417825752_18213584812274035_1910499897159351293_n_0edb71cf60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Diary_Article_Single_Gucci_Spring_Summer24_Dec23_08_001_Default_fc68412783.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Diary_Article_Single_Gucci_Spring_Summer24_Dec23_09_001_Default_512b0f464c.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/2213/news/', 'published'),
('헤라와 제니의 ‘루즈 클래시’ 캠페인', '감각적 디자인으로 시대와 트렌드를 아우르는 헤라의 대표 립스틱이다', 'categorybeauty2203news-176', '2024-01-08', 'Beauty', '["제니","헤라"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9458b2b9b5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_51e7383561.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/herabeauty_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">헤라</strong></a>의 새로운 루즈 클래시 캠페인.</p>

<br>

<p style="text-align:left;">헤라가 <a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>와 함께 한 새로운 캠페인을 공개했습니다. </p>

<br><br>

<br>

<p style="text-align:left;">화려함보다 본질적인 멋을 담아낸 시그니처 서울레드 컬러는 열정의 상징인 레드 컬러를 보다 우아하고 품위있게 표현한 컬러라고 하는데요.</p>

<br>

<p style="text-align:left;">소장하고 싶은 감각적인 디자인으로 시대와 트렌드를 아우르는 헤라의 대표 립스틱인 루즈 클래시와 함께 한 제니, 지금 바로 확인해 보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/417135518_1417274975863342_7857700015331205127_n_e033fa8528.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/417385524_344796711678441_5400161836272838121_n_0080f3bd00.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_99f4b8bc51.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Meet_Hera_s_signature_lipstick_with_a_classic_sensualdesign_that_serves_justice_to_various_eras_and_trends_NE_5dbffcb62c.jpg"]'::jsonb, '[]'::jsonb, '/category/Beauty/2203/news/', 'published'),
('한국의 7번째 애플 스토어인 ‘애플 홍대’가 오픈한다', '오는 20일 오전 10시 오픈 예정이다', 'categorylife2204news-177', '2024-01-08', 'Life', '["애플"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e1b191465e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bac6e01d40.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/apple/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">애플</strong></a>의 7번째 한국 애플스토어가 홍대에 오픈합니다. </p>

<br>

<p style="text-align:left;">새롭게 개장하는 애플 홍대는 아시아, 태평양 지역의 100번째 애플 스토어인데요.</p>

<br>

<p style="text-align:left;">기존의 애플스토어와 마찬가지로 최고의 제품을 구매 및 체험할 수 있도록 하는 공간이 될 예정이라고 합니다.</p>

<br>

<p style="text-align:left;">오는 20일 오전 10시에 오픈 예정이라고 하니 참고하세요!</p>

<br>

<p style="text-align:left;">장소: 서울특별시 마포구 양화로 140</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5df05571_db28_3987_b6bb_f5601c571821_Apple_Jamsil_large_2x_bdd924bb0c.png"]'::jsonb, '[]'::jsonb, '/category/Life/2204/news/', 'published'),
('푸마 X 플레져스 협업, 스케이트 기반의 스웨이드 XL', '푸마와 플레져스의 협업 슈즈가 공개됐다', 'categoryfashion2195news-178', '2024-01-06', 'Fashion', '["푸마","플레져스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3a7d999d73.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8c8cc5e209.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/pumasportstyle/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>와 <a href="https://www.instagram.com/pleasures/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">플레져스</strong></a>가 협업한 플레져스 X 푸마 스웨이드 XL이 공개됐습니다.</p>

<br>

<p style="text-align:left;">90년대와 2000년대 초반 스케이트 신발의 미학을 기반으로 한 이번 협업 슈즈. 과장된 실루엣과 청키한 밑창, 그리고 와이드한 끈이 XL 라는 이름에 걸맞는 모습입니다.</p>

<br>

<p style="text-align:left;">지금 슬라이드를 넘겨 푸마와 플레져스의 새로운 협업 슈즈를 확인해보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/414920206_18391180117064383_8777991752044883925_n_26bfeabcdd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Skate_inspired_vibes_meet_perfection_PUM_Ax_PLEASURES_Suede_XL_drops_tomorrow_1_7897d654fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Skate_inspired_vibes_meet_perfection_PUM_Ax_PLEASURES_Suede_XL_drops_tomorrow_2_8589cd9089.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Skate_inspired_vibes_meet_perfection_PUM_Ax_PLEASURES_Suede_XL_drops_tomorrow_3_c58e2b29d1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Skate_inspired_vibes_meet_perfection_PUM_Ax_PLEASURES_Suede_XL_drops_tomorrow_a69af60904.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/415924995_18391180108064383_8433085785787892912_n_6bd150e66b.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2195/news/', 'published'),
('웨스턴 무드가 가득한 떠그클럽 SS24', '떠그클럽이 SS24 컬렉션을 공개했다', 'categoryfashion2180news-179', '2024-01-03', 'Fashion', '["떠그클럽","카우보이"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e6a19921d8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b9325519a3.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/thug_club/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">떠그클럽</strong></a>이 SS24 컬렉션을 공개했습니다. 컬렉션 명은 ‘HYBRID COWBOY’. </p>

<br>

<p style="text-align:left;">떠그클럽의 아이코닉 로고와 빈티지한 디스트레스드 포인트가 브랜드의 아이덴티티를 지켰는데요.</p>

<br>

<p style="text-align:left;">특히 이번 컬렉션에서 인상적인 부분은 떠그클럽과 휠라가 협업했던 슈즈와 셔링이 잔뜩 잡힌 셋업입니다. 떠그클럽의 새로운 디자인을 &#60;피에이피&#62;에서 만나보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1df3cf0d63.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_1493e520fa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_1ca86257b5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b35947ba46.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_7f4f78b746.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_db02d5a9a3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_ec11a4a1ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_18380264dd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_13a3382b8b.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2180/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('플레저스 X 무스 너클, 겨울의 마무리가 될 힙한 콜라보', '럭셔리한 아우터웨어와 엣지있는 실루엣의 한정판 캡슐 컬렉션', 'categoryfashion2135news-180', '2023-12-26', 'Fashion', '["플레저스","무스 너클","pleasures","mooseknuckles"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_430119687f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_a8445a9f07.jpg', '<br>

<p style="text-align:left;">플레저스 X 무스 너클, 세상을 놀래킬 콜라보
<br><br>
<a href="https://www.instagram.com/pleasures/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">플레저스</strong></a>와 <a href="https://www.instagram.com/mooseknucklescanada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">무스 너클</strong></a>이 럭셔리한 아우터웨어와 엣지있는 실루엣의 한정판 캡슐 컬렉션을 발표합니다. 
<br><br>
해당 컬렉션은 화이트와 대비되는 블랙 스켈레톤 자수가를 중심으로 실용적인 의류라인으로 전개되는데요. 
<br><br>
스카치 소재의 두 브랜드의 로고로 장식된 크롭 패딩과 프리미엄 코튼 후디, 로고 스웻 팬츠 와 그래픽 티셔츠 외에도 니트 바라클라바와 비니, 장갑 등 다양한 겨울 아이템으로 만나볼 수 있습니다.
<br><br>
해당 컬렉션은 오는 1월 16일부터 플레저스와 무스너클 공식 웹사이트를 통해 만나볼 수 있다고 하네요.</p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/412891999_18389185255064383_3500757895859786027_n_e68987a306.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_12_pleasures_moose_knuckles_capsule_collection_release_info_03_17ea921240.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_12_pleasures_moose_knuckles_capsule_collection_release_info_02_2bcd291fc1.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/2135/news/', 'published'),
('서울의 색을 담은 앤더슨벨의 24SS 컬렉션 룩북', '특히 화병에서 영감을 얻은 바소 백의 스타일리시함을 주목해 볼 것', 'categoryfashion2125news-181', '2023-12-24', 'Fashion', '["앤더슨벨"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/412278782_18403303198044347_1762986990056085653_n_59a54df504.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_18b4961e4b.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/adsb_anderssonbell/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">앤더슨벨</strong></a>이 2024 봄, 여름 컬렉션 룩북을 공개했습니다. </p>

<br>

<p style="text-align:left;">서울을 배경으로 한 따뜻한 색감이 눈에 띄는 앤더슨벨의 이번 시즌 컬렉션 룩북.</p>

<br><br>

<br>

<p style="text-align:left;">창립 10주년을 맞아 지난 24SS 밀라노 패션 위크를 통해 성공적인 데뷔 쇼를 선보인 후라 더욱 반가운 아이템들이 이목을 끄는 모습입니다.</p>

<br>

<p style="text-align:left;">특히 화병에서 영감을 받은 글로벌 백 라인인 바소 백(VASO BAG)의 스타일리시함도 주목해 볼 것.</p>

<br>

<p style="text-align:left;">조금 이른 봄을 맞이한 앤더슨벨의 24SS 룩북을 지금 바로 확인해 보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/410755079_18210930280274035_2323856603113680273_n_dbfe398df1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/410816372_18210930262274035_2893977783140549844_n_fb9540f611.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/410831395_18210930316274035_8259405221562229208_n_bbaa18e1ab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/410840983_18210930271274035_4516059135591823990_n_1_17a8674f72.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/410929946_18210930334274035_6063402227078669137_n_e8f48f3cba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/411252248_18403303207044347_4602755253943193883_n_196144cc89.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/411287962_18403303234044347_772795751486805563_n_1ae201d5a5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/412278782_18403303198044347_1762986990056085653_n_401fa5e0b8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/412318171_18403303231044347_6448674375237505150_n_d8093b8fa6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/412324081_18403303216044347_2973761933948232019_n_15919e70a7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2125/news/', 'published'),
('아더에러의 블루, 그 9번째 조각을 맞추다', '아더에러의 9주년 기념 컬렉션 발표', 'categoryfashion2085news-182', '2023-12-15', 'Fashion', '["아더에러","블루"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_654c7cbe6a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_ad77cb536b.jpg', '<br>

<p style="text-align:left;">아더에러가 남긴 파란색의 마지막 조각이 있다면.</p>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더에러</strong></a>가 창립 9주년을 기념해 출시하는 ''The Last Piece of Blue’. 이 컬렉션에는 아더에러의 과거와 현재, 그리고 미래가 모두 담겨있는데요.</p>

<br>

<p style="text-align:left;">탄생과 축하의 의미, 그리고 숫자 9에서 영감을 받은 특별한 그래픽 아트워크와 시그니처 로고가 포인트입니다. 의류와 모자, 달걀 오브제까지 총 14피스의 익스클루시브 제품으로 구성.</p>

<br>

<p style="text-align:left;">이번 컬렉션은 오는 18일 아더에러 공식 홈페이지에서 프리 오더로 선론칭되는데요. 올 겨울을 파랗게 물들일 아더에러의 뉴 실루엣을 <피에이피>와 함께 기대해보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_The_Last_Piece_of_Blue_600c670ca0.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2085/news/', 'published'),
('자라의 The Jacket, 식지 않은 그들의 분노', '자라가 공개한 캠페인으로 팔레스타인 활동가들이 항의에 나섰다', 'categoryfashionlife2080news-183', '2023-12-14', 'Fashion,Life', '["자라","논란"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_09253099b9.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_fe41fcb59a.jpg', '<center>

</center>

<br>

<p style="text-align:left;">최근 <a href="https://www.instagram.com/zara/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">자라</strong></a>가 공개한 새로운 캠페인 ‘The jacket’이 가자지구 대량 학살을 연상케 해 논란이 되었는데요. 팔레스타인 활동가들이 이러한 논란에 직접 자라에서 항의를 하는 사건이 발생했습니다.</p>

<br>

<p style="text-align:left;">팔다리가 없는 마네킹과 잔해 더미 등 캠페인에 등장한 요소들의 일부를 매장에 가져와 시위를 펼친 것. 그들은 자라가 가자지구에서의 죽음을 조롱했다고 주장하고 있습니다.</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion,Life/2080/news/', 'published'),
('이토록 스타일리시한 K-EYEWEAR', '패셔너블한 디자인과 국내 제조로 품질을 갖춘 10개의 안경 브랜드가 함께 했다', 'categoryfashion2040news-184', '2023-12-05', 'Fashion', '["EYEWEAR","서울쇼룸","paris","디자이너브랜드","닥터그램","디자인샤우어","마치","트루스아이웨어","나인어코드","노운"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_99eff441da.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a08126a2bb.jpg', '<p style="text-align:left;">지난 파리 패션 위크 기간 동안 패션의 고장 프랑스 파리에서 ‘K-EYEWEAR 프레젠테이션’이 개최되었습니다.
<br><br>
이번 K-EYEWEAR 프레젠테이션은 세계 최대 패션 수주회인 트라노이 전시회와 파리 패션의 중심지인 마레의 로메오 쇼룸에서 개최되었는데요.</p>

<br><br>

<br>

<p style="text-align:left;">K-Pop, K-Fashion을 잇는 독창적인 브랜드 아이덴티티와 패셔너블한 디자인 그리고 국내 제조로 품질까지 고루 갖춘 10개의 안경 브랜드가 함께 한 모습을 볼 수 있었습니다.
<br><br>
<a href="https://www.instagram.com/_dr.gram/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">닥터그램</strong></a>, <a href="https://www.instagram.com/designshower_atelier/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디자인샤우어</strong></a>, <a href="https://www.instagram.com/marcheyewear_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마치</strong></a>, <a href="https://www.instagram.com/truth_eyewear/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">트루스아이웨어</strong></a>, <a href="https://www.instagram.com/9accord_style/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나인어코드</strong></a>, <a href="https://www.instagram.com/knouun.official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">노운</strong></a>, <a href="https://www.instagram.com/yun.seoul/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">윤</strong></a>, <a href="https://www.instagram.com/useful_atelier/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">유즈풀 아뜰리에</strong></a>, <a href="https://www.instagram.com/accrue_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">어크루</strong></a> 그리고 <a href="https://www.instagram.com/korea_abba/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아바</strong></a>까지.
<br><br>
글로벌 패션 관계자들의 호평, 적극적 수주 상담과 다양한 콜라보레이션 문의 등 성공적으로 막을 내린 K-EYEWEAR 프레젠테이션. 앞으로 K-EYEWEAR의 프랑스를 포함한 글로벌 진출이 더욱 기대됩니다!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_9b81fff640.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_db23cfe291.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_404a83d950.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_81d689d134.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_021c17ebde.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_e6818ceefc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e7c8637af6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_2b34ee2c5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_7b18a020cc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_929488e606.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_3d89c47f6b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_2babced57f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_a64921f136.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_eaf6507445.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_23c63d1792.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/2040/news/', 'published'),
('새로운 겨울 트렌드로 뭉친 어그와 팔라스의 두번째 만남', '타스만 슬리퍼, 벙어리 장갑, ‘P’ 이니셜 양가죽 러그 라인업', 'categoryfashion1995news-185', '2023-11-28', 'Fashion', '["ugg","팔라스","어그","palace"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_9477a19d36.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_426d572dfe.jpg', '<center>

</center>

<br>

<p style="text-align:left;">추워진 요즘 가장 사랑받는 브랜드 <a href="https://www.instagram.com/ugg/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">어그</strong></a>와 <a href="https://www.instagram.com/palaceskateboards/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">팔라스</strong></a>가 새로운 트렌드로 다시 한번 뭉쳤습니다. 
<br><br>
이번 라인업은 23년도 겨울, 새롭게 급부상하고 있는 어그의 타스만 슬리퍼 콜라보 버전과 신발과 어울리는 벙어리 장갑, 팔라스의 ‘P’ 이니셜로 제작된 흰색 양가죽 러그인데요.
<br><br>
귀여운 아기 악마, 폭탄을 들고있는 오리 등 만화 캐릭터와 상징적인 팔라스 레터링 등이 패크워크 스타일로 새겨져있는 것이 특징. 
<br><br>
해당 콜라보 제품들은 오는 12월 1일부터 2일에 걸쳐 브랜드 웹스토어에서 만나볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_8aae24d924.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_4c2ab42889.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_509be4bf60.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_90ecdac2b7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_0daab7a6c5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_de3cb5291d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_891ef5db46.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_38c0ed70c1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_197153d2fe.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1995/news/', 'published'),
('배우 문가영이 돌체앤가바나의 글로벌 앰버서더로 발탁됐다', '향후 브랜드 글로벌 캠페인 및 이벤트에서 활발한 활동을 선보일 예정이다', 'categoryfashion1988news-186', '2023-11-27', 'Fashion', '["문가영","돌체앤가바나"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b603d7996c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d9bebb9049.jpg', '<br>

<p style="text-align:left;">배우 <a href="https://www.instagram.com/m_kayoung/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">문가영</strong></a>이 이탈리안 럭셔리 패션 하우스 <a href="https://www.instagram.com/dolcegabbana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">돌체앤가바나</strong></a>의 글로벌 앰버서더로 발탁됐습니다.</p>

<br><br>

<br>

<p style="text-align:left;">다양한 작품 활동을 보여 주고 있는 문가영은 감각적인 스타일과 소화력으로 많은 이들의 주목을 받고 있는데요. 특히 지난 9월 밀란에서 열린 돌체앤가바나 컬렉션 쇼에 참석해 더욱 화제가 됐죠.</p>

<br>

<p style="text-align:left;">앞으로 문가영은 향후 브랜드 글로벌 캠페인 및 이벤트에 참석해 활발한 활동을 펼칠 예정이라고 합니다!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F_5v09_Hb_MAAHR_2_Y_d31ed299b9.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/F_5v09_Ga_EA_Aq_KOU_62a2e67c0d.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1988/news/', 'published'),
('부르르 떠는 순간에도 기품있게, 디올의 홀리데이 컬렉션', '‘DiorAlps’라는 이름으로 전개되는 해당 컬렉션', 'categoryfashion1945news-187', '2023-11-17', 'Fashion', '["dior","디올"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_36269571d0.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_b04ecbc2ce.jpg', '<center>

</center>

<br>

<p style="text-align:left;">겨울 시즌이 본격적으로 시작됨에 따라 <a href="https://www.instagram.com/dior/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디올</strong></a>이 홀리데이 컬렉션을 선보입니다. ‘DiorAlps’라는 이름으로 전개되는 해당 컬렉션은 ‘산의 마법과 겨울의 찬란함’에 대해 이야기 하고 있습니다. 
<br><br>
컬렉션 전반에 걸친 디올 오블리크 시그니처가 돋보이는 다운 재킷과 디올 스타 모티프가 새겨진 코트 라인 등이 눈에 띄는데요. 또한 스노우 부츠와 스니커즈, 토트백, 휴대폰 홀더, 지갑 등 다양한 라인으로도 만나볼 수 있습니다.
<br><br>
가격은 한화 약 65만원에서 920만원까지. 지금 바로 브랜드 공식 웹스토어에서 만나볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_dior_dioralps_winter_capsule_collection_campaign_2_1c9f24cc4d.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_dior_dioralps_winter_capsule_collection_campaign_4_21fd0c4550.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_dior_dioralps_winter_capsule_collection_campaign_1_7ee23ed6a5.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_dior_dioralps_winter_capsule_collection_campaign_3_04dd7e0e37.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402638223_657788926533769_6876093245231996034_n_c74ddb6e11.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402630163_657788929867102_648148652953171817_n_c065e7d423.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1945/news/', 'published'),
('떠그클럽과 휠라의 예측불허 협업 공개', '떠그클럽과 휠라가 신발 협업 이미지를 공개했다', 'categoryfashion1942news-188', '2023-11-16', 'Fashion', '["떠그클럽","휠라"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cc8fa74af2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_41483ff959.jpg', '<br>

<p style="text-align:left;">현재 온라인을 뜨겁게 달구고 있는 <a href="https://www.instagram.com/thug_club/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">떠그클럽</strong></a>과 <a href="https://www.instagram.com/fila_korea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">휠라</strong></a>의 협업. 동물의 발 모양을 거꾸로 디자인한 듯한 부츠와 떠그클럽의 감성이 가득 담긴 실버 스니커즈가 공개돼 이목을 집중시켰는데요.</p>

<br>

<p style="text-align:left;">떠그클럽과 휠라의 협업이 의외라는 반응이 다수. 하지만 독보적인 디자인에 대중은 긍정적인 모습을 보이는데요. 예측불허한 이들의 협업 정확한 발매 정보도 추후 &#60;피에이피&#62; 기사에서 확인하세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/401405785_868643564922009_4631415393320404803_n_424ff1ab72.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402522251_725332176113728_5272276161166093009_n_b3ddd0f9ec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402281070_983025636817635_6726669670085165482_n_48deaaefa1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402183655_862126965692930_5530683626601037657_n_ffc5038b53.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402416019_1043936906655891_6871581855526064373_n_209cd9e8cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402156168_1357898408162892_7545696114286111048_n_3348edf959.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/402474153_1327570764794872_3677486078592115291_n_041a1410b6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1942/news/', 'published'),
('봄날의 추억을 깨워 줄 보테가베네타의 24 프리-스프링', '마티유 블라지가 집으로의 여행으로부터 영감을 받은 이번 컬렉션', 'categoryfashion1888news-189', '2023-11-07', 'Fashion', '["보테가베네타","BottegaVeneta","마티유블라지"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_51a21521eb.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_e3651c8a34.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/matthieu_blazy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마티유 블라지</strong></a>가 <a href="https://www.instagram.com/newbottega/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">보테가 베네타</strong></a>의 프리-스프링(Pre-Spring) 2024 컬렉션을 공개했습니다. 
<br><br>
이 컬렉션은 마티유 블라지가 어린 시절 옷장에서 자신을 발견했던 집으로의 여행에서 영감을 받았다고 하는데요. 여동생이 한대 입었던 프린트 드레스에서 따온 유쾌한 느낌을 스웨터와 스커트로 재해석 했으며, 테일러드 베스트에 오버사이즈 라벨을 꿰매어 내는 디테일이나, 봄과 어울리는 컬러감의 직물을 대조적으로 사용한 덕에 더욱 산뜻한 느낌을 주네요. 슬라이드를 넘겨 위 컬렉션을 더욱 주목해보세요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_017_7105e438df.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_006_80ee467215.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_009_e582be9499.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_005_85ff151e41.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_007_27de5bdf54.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_011_eb64098ecf.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_015_0df17d6007.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_020_be724ac5e4.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_002_3c9852ea16.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_001_04d99b3edb.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_003_c5659480b8.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_004_c7246bcd7f.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_010_19dedc0c02.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_012_b82f3ccfdb.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_013_5f2ddde422.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_018_ff90e9e96a.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_bottega_veneta_pre_spring_2024_resort_matthieu_blazy_collection_019_38b7fef341.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/1888/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('LMC와 푸마의 덩크슛을 위하여', 'LMC와 푸마의 두 번째 협업 컬렉션 공개', 'categoryfashion1889news-190', '2023-11-07', 'Fashion', '["엘엠씨","푸마"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_38bd662ed2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3d9d22cb14.jpg', '<br>

<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/lostmanagementcities/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">LMC</strong></a>와 <a href="https://www.instagram.com/puma/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>의 두 번째 협업 컬렉션이 곧 발매됩니다. 농구 컨셉으로 꾸며진 이들의 티저 영상과 이미지에서는 맨투맨, 후드티, 져지 셋업, 스니커즈 등의 협업 제품을 확인할 수 있었는데요. LMC의 무드에 푸마의 스포티함이 더해져 감탄을 자아냅니다. 이 컬렉션은 오는 9일 11시에 만나보실 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399960614_820674203395382_7154731599727597974_n_4462619c85.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399889521_820674310062038_5955240245093091711_n_9d8d57f907.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399927249_820674240062045_3211729640086867663_n_5bbb2efd86.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/400073454_820674276728708_8554416556136628577_n_08b97a9408.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399884490_820674346728701_4034323911753358497_n_8e591efb3f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1889/news/', 'published'),
('칼하트 WIP 낯설게 보기 2023 가을 겨울 캠페인 공개', '일상 생활에서 낯선 사람들이 함께 앉아있는 모습 포착', 'categoryfashion1890news-191', '2023-11-07', 'Fashion', '["칼하트WIP"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_900f7eea08.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_7e57b665ca.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/carharttwip/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">칼하트 WIP</strong></a>이 2023 가을 겨울 시즌을 맞이해 새로운 캠페인을 선보입니다. 일상 생활에서 낯선 사람들이 함께 앉아있는 모습으로 포착된 이번 캠페인은 칼하트 WIP이 추구하던 실용성과 기능성에 초점을 맞추던 이전 캠페인과는 조금 다른 분위기인데요. 
<br><br>
클래식한 무드와 현대적인 핏이 돋보이는 이번 캠페인은 칼하트 WIP의 원형에 충실하면서도 새롭게 해석되어 더욱 다양한 실루엣으로 만나볼 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/400170613_726988948814557_7927476837095588260_n_9b1681d502.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399431792_3622691291384466_4887669738532211902_n_4616dc8418.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398930529_220544551054568_127879048172883280_n_efcd0272b1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399533611_305765832315037_2636130310735087108_n_a23a74e0f8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399086891_1070998314250843_6963288244188533990_n_29f5109011.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398916232_910145927188296_3566277603631122277_n_51d15b2188.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399085467_7051382414909618_7105505404960125595_n_4d7780704e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399945167_3573214056299746_527927198737579649_n_18db459b48.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399896269_1278215362726656_7077083749420202266_n_dbccd6a63f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398995610_357044413379668_7744010890241232270_n_752c13da8e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_carhartt_wip_fall_winter_2023_collection_014_dfa326eb03.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_carhartt_wip_fall_winter_2023_collection_007_5ab447adf2.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_carhartt_wip_fall_winter_2023_collection_006_d2ca1232c3.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_carhartt_wip_fall_winter_2023_collection_005_32bb919107.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_11_carhartt_wip_fall_winter_2023_collection_001_dc9808e1ba.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/1890/news/', 'published'),
('스트레이 키즈 현진과 함께 한 베르사체 홀리데이 캠페인', '바로코 기성복과 하이 윈터 코트, 재킷 그리고 이브닝 웨어로 이루어졌다', 'categoryfashion1880news-192', '2023-11-06', 'Fashion', '["베르사체","현진","스트레이키즈"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398857092_18396257461036015_1804681238910399457_n_c06e3a0324.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b73ef3cb98.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/versace/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">베르사체</strong></a>가 <a href="https://www.instagram.com/realstraykids/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">스트레이 키즈</strong></a>의 <a href="https://www.instagram.com/hynjinnnn/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">현진</strong></a>과 함께 한 홀리데이 캠페인을 공개했습니다. 바로코 기성복과 하이 윈터 코트, 재킷 그리고 완벽한 이브닝 웨어까지 연말 시즌을 맞아 선물하기 좋은 제품으로 이루어진 홀리데이 컬렉션. </p>

<br><br>

<div style="padding:177.78% 0 0 0;position:relative;"></div>

<br>

<p style="text-align:left;">베르사체 하우스의 시그니처 바로코를 담은 아이템들을 만나 볼 수 있는 이번 컬렉션은 반항적인 클래식함과 팝 컬처의 유쾌함, 화려함이 독특하게 어우러진 바로코 무늬를 통해 홀리데이 시즌의 정신을 완벽하게 담아냈다고 합니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398857092_18396257461036015_1804681238910399457_n_6ba9d0f918.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398885724_18396257482036015_8135008083083266540_n_e6dae31218.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399790781_18396257500036015_2505259537951995925_n_662c3949d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/398882231_18396257491036015_4518802455133805134_n_454bc111a7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/399809117_18396257509036015_517109025014670421_n_dfdd56a360.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1880/news/', 'published'),
('도시에서 도시로의 여행, 팬암과 함께!', '이번 시즌 본격적으로 도심형 ''저니 웨어''를 전개한다', 'categoryfashion1881news-193', '2023-11-06', 'Fashion', '["팬암","panam","panamkorea","lifejourneyware","23AW","파리 패션 위크","Paris Fashion Week Street"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_2ef0362293.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4e781a4168.jpg', '<p style="text-align:left;"><a href="https://www.instagram.com/panam_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">팬암</strong></a>이 상반기에 이어 23AW 시즌 ‘BORN TO JOURNEY’ 캠페인을 공개했습니다. 팬암은 이번 시즌 본격적으로 도시에서 도시로의 여행을 다루는 도심형 ''저니 웨어’를 전개하며, 여행시 이동에 용이한 제품들을 보여 주는 동시에 항공사 헤리티지를 가진 팬암의 정체성을 담은 아이템을 출시했는데요.</p>

<br><br>

<br>

<p style="text-align:left;">이번 시즌 밀라노, 파리 패션 위크 스트릿에서 만난 팬암은 일상에 영감을 불러일으키는 신선한 여행의 감각을 선사하고 있었습니다. 팬암의 스타일리시한 아이템으로 완성된 룩은 패션 위크 스트릿에서 더욱더 그 진가를 드러냈죠.
<br><br>
여행 수요가 증가하면서 편의성이 돋보이는 팬암의 제품들이 계속해서 주목받고 있습니다. 한층 더 다채로워진 팬암의 23AW 컬렉션을 TV 광고에서도 만나 보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_e3827ba212.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_fc3e88d6fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_df4bffb81e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_e178fbf1dd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_e716186be4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_69822cd950.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e1d5425f7a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_a275d56c92.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_e8a6279a8d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_3157490a0f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1881/news/', 'published'),
('포스트아카이브팩션의 5.1 컬렉션 다운 재킷 라인업', '여러 소재감과 컬러감의 레프트, 라이트, 센터 라인', 'categoryfashion1876news-194', '2023-11-05', 'Fashion', '["포스트아카이브팩션","postarchivefaction"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_b4f672b2af.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_d16629e23e.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/postarchivefaction/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포스트아카이브팩션</strong></a>이 5.1 컬렉션 다운 재킷 라인업이 공개되었습니다. 여러 재질감과 컬러감으로 공개된 이번 컬렉션은 레프트, 라이트, 센터 라인으로 만나볼 수 있으며, 테크니컬, 드레스, 후드, 트라우저, 재킷, 셔츠, 코트 등 다양한 아이템으로 만나볼 수 있습니다. 지금 바로 포스트아카이브팩션 공식 웹사이트를 방문해보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_DOWN_in_motion_05e0f956d5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_DOWN_in_motion_3_85358cc560.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_DOWN_in_motion_1_7eae67f9f6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_DOWN_in_motion_2_488a290cf8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_DOWN_in_motion_6_089a1ea075.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_1_DOWN_in_motion_5_32a81b16de.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1876/news/', 'published'),
('암 어 ‘스노우배’디, 아이브의 푸마 스노우배 캠페인', '아이브와 함께한 푸마 스노우배 캠페인 공개', 'categoryfashion1872news-195', '2023-11-04', 'Fashion', '["아이브","푸마","스노우배"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_dda1be4727.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_fca2ed738e.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/puma_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>가 <a href="https://www.instagram.com/ivestarship/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아이브</strong></a>와 함께한 스노우배(Snowbae) 캠페인을 공개했습니다. 스노우배 부츠는 겨울에 가장 필요한 패딩 부츠 컬렉션으로, 스타일리시하면서도 내구성이 좋은 소재로 디자인되어 보온성과 실용성을 두루 갖추었는데요.</p>

<br>

<p style="text-align:left;">아이브는 이번 캠페인에서 귀여운 푸마의 패딩 룩과 함께 스노우배를 매치해 포인트를 주었습니다. 이번 스노우배 부츠 컬렉션과 다운 재킷, 베스트는 푸마 공식 온라인몰과 오프라인 스토어에서 만나보실 수 있습니다.</p>

<br><br>

<br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_3_2413cf5f7c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_2_f1b0227620.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1872/news/', 'published'),
('세실리에 반센 x 아식스가 불어올 두번째 콜라보 돌풍', '일상의 꾸뛰르에 영감을 주는 일본 문화에서 착안한 디자인', 'categoryfashion1857news-196', '2023-11-01', 'Fashion', '["세실리에반센","ceciliebahnsen","아식스","asics"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_0135b4e505.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_3dd751a545.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ceciliebahnsen/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">세실리에 반센</strong></a>이 <a href="https://www.instagram.com/asics/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아식스</strong></a>와 두번째 협업으로 돌아왔습니다.
<br><br>
올여름 초 아식스와 함께 했던 첫 콜라보레이션이 엄청나게 히트를 몰고 왔었는데요. 이번 협업은 ‘일상의 꾸뛰르’에 종종 영감을 주는 일본 문화에서 그 디자인을 착안했다고 하며, 도쿄의 단독 팝업으로 컬렉션을 런칭할 예정이라고 밝혔습니다. 핑크와 블루, 두가지 컬러웨이로 전과 비슷한 메리제인 아웃라인으로 만나볼 수 있으며, 오는 15일 세실리에 반센 웹사이트를 통해서도 만나볼 수 있다고 하네요. 가격은 한화 약 31만 5천원.
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cecilie_bahnsen_japan_asics_gt_2160_collaboration_release_info_1_056c677ab8.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cecilie_bahnsen_japan_asics_gt_2160_collaboration_release_info_2_fbff7877de.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cecilie_bahnsen_japan_asics_gt_2160_collaboration_release_info_3_f9d613f4c6.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cecilie_bahnsen_japan_asics_gt_2160_collaboration_release_info_4_ac8467a37a.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/1857/news/', 'published'),
('셀린느 새로운 캠페인 속 인간 셀린느 리사의 모습 공개', '셀린느의 23 윈터 시즌 아이템을 완벽하게 소화한 리사', 'categoryfashion1854news-197', '2023-10-31', 'Fashion', '["셀린느","celine","블랙핑크","blackpink","리사","lisa"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_d7292bc2d8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_3d290248ab.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/celine/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">셀린느</strong></a>가 공개한 새로운 캠페인 속 익숙한 얼굴이 보여 화제입니다. 바로 <a href="https://www.instagram.com/blackpinkofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">블랙핑크</strong></a>의 멤버 <a href="https://www.instagram.com/lalalalisa_m/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리사</strong></a> 인데요. 아이보리 컬러의 클래식 샤세르 재킷과 아바 트로옹프백 등 23 윈터 시즌 아이템을 무심한 듯 아름답게 걸치고 있는 모습이 셀린느를 인간화한 듯한 모습이네요! 아름다운 그녀의 모습을 이미지를 통해 더욱 자세히 만나보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_0470c48718.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/22_1177e57d3b.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1854/news/', 'published'),
('영국에 대한 니고의 사랑을 담아, 겐조 x 헌터 부츠 캡슐 컬렉션', '1960년대 오리사냥 부츠에서 영감을 받은 해당 컬렉션', 'categoryfashion1845news-198', '2023-10-30', 'Fashion', '["니고","nigo","겐조","kenzo","헌터","hunter","hunterboot"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d1f1aa2fa9.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6755_09544d82ff.jpg', '<center>

</center>

<center>

</center>

<br>

<p style="text-align:left;">영국에 대한 <a href="https://www.instagram.com/nigo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">니고</strong></a>의 사랑에서 영감을 받아 <a href="https://www.instagram.com/kenzo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">겐조</strong></a>가 영국의 헤리티지 부츠 브랜드 <a href="https://www.instagram.com/hunterboot/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">헌터</strong></a>와 콜라보 캡슐 컬렉션을 선보입니다. 
<br><br>
1960년대 오리 사냥 부츠에서 영감을 받은 해당 컬렉션은 다양한 하이탑과 미드탑 실루엣을 통해 전개되는데요. 헌터의 시그니처 컬러인 아미 그린과 블랙 컬러 팔레트에 겐조의 시그니처인 레드 컬러와 보케 플라워가 조화롭게 믹스된 모습이네요. 해당 아이템은 현재 전 세계 겐조 매장과 겐조, 헌터 웹 스토어를 통해 독점 판매되고 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_12_0a6571ad5f.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_6_918c0ecb61.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_9_4ab12138a1.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_2_07951c0b9c.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_7_31bf8e9230.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_8_374c3ae9ff.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_5_0dc2eedb58.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_11_8948564734.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_4_699913423b.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_10_6906a3831e.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_1_50db539e2a.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_kenzo_hunter_collaboration_release_info_3_0cd0fd320e.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/1845/news/', 'published'),
('오렌지 캬라멜 맛 자크뮈스와 나이키', '자크뮈스와 나이키의 새로운 오렌지 컬러 슈즈', 'categoryfashion1823news-199', '2023-10-27', 'Fashion', '["자크뮈스","나이키","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4c99be726e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_58d4107379.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/jacquemus/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">자크뮈스</strong></a>가 <a href="https://www.instagram.com/nike/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나이키</strong></a>와의 새로운 협업 제품을 공개했습니다. 오렌지빛 상큼한 컬러웨이가 눈길을 사로잡는 슈즈. 밑창부분에 실을 꿰맨 듯한 화이트 포인트를 더해 위트있는 디자인을 완성했습니다. 함께 공개된 오렌지 로고 그래픽 티셔츠와 데님 자켓, 팬츠도 협업 슈즈와 매칭하기 쉽도록 제작된 모습인데요. 이번 협업 컬렉션은 지금 자크뮈스 홈페이지에서 단독으로 만나보실 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/NIKE_JACQUEMUS_NEW_DROP_nike_Exclusively_on_JACQUEMUS_com_e597079358.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/NIKE_JACQUEMUS_NEW_DROP_nike_Exclusively_on_JACQUEMUS_com_1_5570801dea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/NIKE_JACQUEMUS_NEW_DROP_nike_Exclusively_on_JACQUEMUS_com_2_0498b41bd4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/NIKE_JACQUEMUS_NEW_DROP_nike_Exclusively_on_JACQUEMUS_com_3_2466b2c8ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/NIKE_JACQUEMUS_NEW_DROP_nike_Exclusively_on_JACQUEMUS_com_4_4bbc880d64.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1823/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('겨울 스포츠도 멋스럽게, 발렌시아가의 스키웨어 컬렉션', '오는 11월 15일 출시되는 겨울 스포츠 웨어 컬렉션', 'categoryfashion1824news-200', '2023-10-27', 'Fashion', '["발렌시아가","balenciaga"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_1003b52fc7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_7b31d374fc.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/balenciaga/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">발렌시아가</strong></a>가 스키웨어 컬렉션을 선보입니다.  11월 15일 출시되는 해당 스키복 라인에는 다양한 겨울 스포츠 의류, 액세서리, 장비 등이 포함 되는데요. 스노우보드, 스키, 겨울 하이킹 등 다양한 겨울 스포츠에 실용적인 아이템으로 만나볼 수 있다고 합니다.

해당 제품은 현재 브랜드 웹스토어에서 사전 주문이 가능하다고 하니 겨울 스포츠를 준비 중인 패퍼라면 지금 바로 발렌시아가 공식 웹사이트를 방문해보세요! 
</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_1_c5eda8e2ad.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_2_0d34c0f044.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_50_b4189b400b.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_49_98a265a1cc.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_54_5ae7b9d521.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_8_ebe232ddbe.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_12_0b0619f984.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_24_a81245ac6a.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_15_24aa93a2af.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_57_02e6f72ab8.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_56_95b19d81f6.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_48_4f66d7ee42.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_47_81cc3f45f7.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_4_27abecda24.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_5_460305e088.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_10_balenciaga_first_skiwear_ski_collection_campaign_release_info_46_8abc244944.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/1824/news/', 'published'),
('찰스 제프리 러버보이의 ‘풋 페티쉬가 아닌’ 신발 캠페인', '23AW 밀란 패션 위크의 모카신 모기스(Moccasin Moggies) 출시', 'categoryfashion1826news-201', '2023-10-27', 'Fashion', '["찰스제프리러버보이","charlesjeffreyloverboy"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_d29270455c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_b011a43d2a.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/charlesjeffreyloverboy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">찰스 제프리 러버보이</strong></a>가 새로운 신발 캠페인을 선보입니다. ''NOT FOR…이라는 이름으로 공개된 해당 캠페인은 찰스 제프리가 생각하는 풋 페티쉬를 가감없이 드러냅니다. 그런 동시에 이번 23AW 밀란 패션 위크에서 선보였던 모카신 모기스(Moccasin Moggies)를 출시하는 것인데요. 해당 아이템은 브랜드 웹사이트를 통해 지금 바로 구매할 수 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d67a9efb7b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_1ec9c22c36.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_ca58c016bc.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_7820a07173.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/1826/news/', 'published'),
('우주를 가득 머금은 프라다 2023 홀리데이 캠페인', '''프라이빗스피어(Privatesphere)'' 라는 이름으로 공개된 해당 캠페인', 'categoryfashion1820news-202', '2023-10-26', 'Fashion', '["프라다","prada"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_1cb20deeb6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_d872a0c6b4.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/prada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프라다</strong></a>가 2023 홀리데이 캠페인 ‘프라이빗스피어(Privatesphere)’를 공개했습니다. 별이 가득한 은하계를 연상하게 하는 해당 캠페인 속 배경은 프라다의 1913년 밀라노 부티크를 연상시키도 하는데요. 반가운 얼굴인 배우 <a href="https://www.instagram.com/kimtaeri_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">김태리</strong></a>, 에놀라 홈즈로 익숙한 <a href="https://www.instagram.com/louispartridge_/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이스 파트리지</strong></a>, 미국 배우 <a href="https://www.instagram.com/maya_hawke/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마야 호크</strong></a>, 영국 배우 <a href="https://www.instagram.com/damsonidris/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">댐슨 이드리스</strong></a>등이 함께한 모습이네요. 오묘한 분위기의 홀리데이 캠페인을 스크롤을 넘겨 확인해보세요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cq5dam_web_2560_2560_d26235a2f5.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/prada_holiday_2023_privatesphere_campaign_info_3_08709e6120.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cq5dam_web_2560_2560_1_e279a1fda3.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cq5dam_web_2560_2560_c5837c1ed8.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/1820/news/', 'published'),
('후세인 샬라얀 X 코오롱 스포츠 그들의 뒷 이야기', '후세인 샬라얀이 코오롱 스포츠와의 협업 비하인드를 이야기했다', 'categoryfashion1808news-203', '2023-10-25', 'Fashion', '["코오롱스포츠","후세인샬라얀"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f8914702a0.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c1745af283.jpg', '<br>

<p style="text-align:left;">얼마 전 <a href="https://www.instagram.com/_kolonsport/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">코오롱 스포츠</strong></a>의 50주년 기념 협업 상대로 화제를 모았던 <a href="https://www.instagram.com/husseinchalayanofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">후세인 샬라얀</strong></a>. 그가 &#60;피에이피&#62;와의 인터뷰에서 코오롱 스포츠와의 협업에 대한 이야기를 전했습니다.</p>

<br>

<p style="text-align:left;">그가 언급한 이번 협업 디자인에서 가장 중요한 부분은 시간의 역행을 상징하는 우주인을 모티브로 했다는 점. 이 우주인이 바다에 떨어지게 되어 한국의 전통 의복을 집은 후 본인에 옷에 적용하기 시작했다는 흥미로운 스토리가 숨겨져 있었는데요. 물과 관련된 라이프 재킷에 한국적인 디테일들을 섞어 이런 여정을 표현했다고 하네요.</p>

<br>

<p style="text-align:left;">푸마에 재직 당시 테크니컬 의류에 관심이 생겨 코오롱 스포츠와 협업을 원했다는 후세인 샬라얀. 그는 작업에 대한 높은 기준과 테크니컬 의류도 창의적이고 기능적일 수 있다는 믿음이 코오롱 스포츠와 같다고 말했습니다. 이번 협업의 좋은 퀄리티와 한국에 대해 더 알게될 기회를 얻어 기쁘다는 그, 다른 한국 브랜드와도 멋진 협업을 보여주길 기대합니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_81436c75c6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1808/news/', 'published'),
('런던의 색감과 분위기를 담은 엄브로 브리티시팝 컬렉션', '런던을 배경으로 활동하는 아티스트들과 함께한 이번 컬렉션', 'categoryfashion1806news-204', '2023-10-24', 'Fashion', '["런던","엄브로","브리티시팝","umbro"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4c4c852ceb.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_896d0b6317.jpg', '<center>

</center>

<br>

<p style="text-align:left;">100년 가까운 역사를 가진 축구 스포츠 브랜드 <a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엄브로</strong></a>에서 영국 특유의 색감을 모티브로한 겨울 다운 컬렉션인 브리티시팝 컬렉션을 선보입니다. 이번 엄브로 브리티시팝 컬렉션은 런던을 배경으로 활동하는 아티스트, 브랜드 디렉터, 바리스타, 포토그래퍼 등 다양한 인물들이 참여해 더욱 화제인데요. 
<br><br>
파인 아트계에서 새로운 신드롬을 일으키고 있는 아티스트 <a href="https://www.instagram.com/_teoni/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">TEONI</strong></a>, 스트릿 컬쳐 브랜드 디렉터이자 스케이트보더 <a href="https://www.instagram.com/paolottahoes/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">OBIEKWE</strong></a>, 런던 이스트 문화를 기반으로 한 뮤직 프로듀서 겸 래퍼 <a href="https://www.instagram.com/zaccv/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">ZAC</strong></a>, 빈티지 콜렉터이자 브랜드를 운영중인 패션모델 <a href="https://www.instagram.com/_pukes_/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">LUCAS</strong></a>, 전세계를 베이스로 활동하는 모델이자 여행 인플루언서 <a href="https://www.instagram.com/jaydon.harvey/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">JAYDON</strong></a>, 자신만의 특별한 카페 공간을 운영하는 모델 <a href="https://www.instagram.com/jshfrn/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">JACOB</strong></a> 등 런던을 베이스로 활동하는 인물들이 모델로 참여하여 브리티시팝 다운 컬렉션 특유의 컬러감을 보여주었습니다. 또한 영국 쇼디치의 얼굴이라고 평가 받는 포토그래퍼 <a href="https://www.instagram.com/finflint/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">KAY</strong></a>와 엄브로가 함께하여 런던만의 분위기를 담아내었습니다.</p>

<br><br>

<br>

<p style="text-align:left;">해당 컬렉션은 다운자켓과 베스트 그리고 퀄팅 셋업으로 구성되어 있으며, 브리티시팝 다운 자켓은 19일(목)부터 엄브로 온라인몰과 오프라인 매장을 통해 만나볼 수 있다고 하네요. 이번 FW 시즌, 베이직 하지만 리버시블 디자인으로 두가지 스타일링이 가능한 필수 아이템을 찾고있다면 엄브로몰 혹은 가까운 엄브로 오프라인 매장을 방문해보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a9136af958.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_e9eb3227fc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0b780bb607.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4bfa6c824b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_7fc3e3e059.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_d4192dc4ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_fb52825e24.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_0a1cb519e6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_6acc04b7ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_a60cb5c1b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_4177e15c1a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_7ed704635e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_6aed67c256.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_e457ebf543.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_b5f1e176e8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_b71c9b474f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_aef911e484.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_3510eb480d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1806/news/', 'published'),
('빔즈 x 폴로 랄프로렌 젊음을 담은 니트웨어 컬렉션', '1990년대 일본 학교 교복에서 영감을 받은 컬렉션', 'categoryfashion1793news-205', '2023-10-23', 'Fashion', '["빔즈","폴로 랄프로렌","poloralphlauren","beams"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_684c3c140f.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_241b76b602.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/beams_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">빔즈</strong></a>와 <a href="https://www.instagram.com/poloralphlauren/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">폴로 랄프로렌</strong></a>이 젊음을 담아낸 새로운 니트 웨어 컬렉션을 출시합니다. 1990년대 일본 학교 교복에서 영감을 받은 해당 컬렉션은 가디건과 스웨터 조끼, 점퍼와 치노팬츠 등 다양한 아이템으로 만나볼 수 있는데요. 대부분의 컬러에이는 오프 화이트나 네이비 등 뉴트럴한 컬러로 출시되며, 교복 바지를 연상하게 하는 블랙 스트레이컷 치노 팬츠를 특별하게 만나볼 수 있습니다. 해당 캡슐은 오는 28일 빔즈 공식 온라인 스토어를 통해 만나볼 수 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_133e936541.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_c003cefc3d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d61c96cc9a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3996d24ae7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_4dc885136e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_4e45537552.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_251d15c0f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_1dde5eb4d5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_94f0e406b7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1793/news/', 'published'),
('메리제인에서 영감을 받은 닥터마틴 X 헤븐 바이 마크제이콥스', '벨벳소재와 머리가 두개인 테디베어 포인트가 눈길을 사로잡는다', 'categoryfashion1781news-206', '2023-10-20', 'Fashion', '["marcjacobs","heaven","heavnbymarcjacobs","마크제이콥스","헤븐","닥터마틴","drmartens"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_5e26a10697.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_28216daca1.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/marcjacobs/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마크 제이콥스</strong></a>의 하위 레이블로 다양한 비주얼을 이끌어내며 매번 화제를 모으고 있는 <a href="https://www.instagram.com/heavn/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">헤븐</strong></a>이 이번에는 <a href="https://www.instagram.com/drmartensofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">닥터마틴</strong></a>과 손을 맞잡습니다. 메리제인에서 영감을 받은 해당 콜라보레이션 아이템은 가죽 대신 벨벳소재를 사용했으며 머리가 두개인 테디베어 핀이 포인트인데요. 블랙과 버건디, 두가지 컬러웨이로 출시될 예정. 해당 신발은 오늘(20일) 출시된다고 하니 특별한 가을겨울 슈즈를 찾고있던 패퍼라면 이 콜라보레이션을 주목해보는 건 어떨까요? </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/393508008_1043255263760100_1021799414008458694_n_2e3941a158.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/394044605_1414268539301420_5213486536923330156_n_ffefd412d9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/392938888_199554906496708_8806654429855310608_n_f730500ed9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/393556195_714055523608314_8638426610737725249_n_f18f62151f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/heaven_x_dr_martens_plush_red_velvet_available_tomorrow_3_5f704c032a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1781/news/', 'published'),
('‘돌가프린스’ 도영, 글로벌 앰배서더로 승격', '돌체앤가바나 글로벌 앰배서더가 된 NCT 도영', 'categoryfashionmusic1783news-207', '2023-10-20', 'Fashion,Music', '["도영","엔시티","돌체앤가바나"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cfdea20e97.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_aa51450eff.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/do0_nct/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">NCT 도영</strong></a>이 <a href="https://www.instagram.com/dolcegabbana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">돌체앤가바나</strong></a>의 글로벌 앰배서더로 발탁되었습니다. 기존 돌체앤가바나의 한일 앰배서더였던 그. 2023/24 FW 남성 캠페인의 주인공으로 활약하며 미디어 가치를 2596% 상승시켜 글로벌 앰배서더로 승격되었다고 전해지는데요. 도영이 가진 매력과 카리스마가 돌체앤가바나 뿐만 아니라 전 세계를 사로잡은 모습입니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_f20ceb2017.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Music/1783/news/', 'published'),
('지미추와 장 폴 고티에가 협업 슈즈 컬렉션을 공개했다', '다양하고 유니크한 아이템 라인업이 준비되어 있다', 'categoryfashion1772news-208', '2023-10-19', 'Fashion', '["장폴고티에","지미추"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Introducing_Jimmy_Choo_Jean_Paul_Gaultier_as_showcased_by_kylieminogue_Jimmy_Choox_JPG_1f4abae672.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_309da46468.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/jimmychoo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지미추</strong></a>와 <a href="https://www.instagram.com/jeanpaulgaultier/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">장 폴 고티에</strong></a>가 협업 슈즈 컬렉션을 공개했습니다. 두 브랜드의 아이덴티티를 융합한 새로운 컬렉션은 자기 결정력, 개성, 강한 여성 형상을 축하하는 공유된 가치로 통일된 그들의 미학을 느낄 수 있는데요. 에펠탑이 레이저로 새겨진 웨지힐과 장 폴 고티에의 컬렉션을 재해석한 타투 패턴의 부츠와 펌프스까지. 다양하고 유니크한 아이템들이 인상적이네요. </p>

<br><br>

<div style="padding:177.78% 0 0 0;position:relative;"></div>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Introducing_Jimmy_Choo_Jean_Paul_Gaultier_as_showcased_by_kylieminogue_Jimmy_Choox_JPG_93ce5b5970.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/391617452_18391850743009713_8926621139781592625_n_cbafe80b25.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/391623596_18391850725009713_9060720580843443100_n_3f3135aa33.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/391638724_18391850734009713_4508684929891608310_n_28ceea8f0c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/391664778_18391850716009713_8913169750663793740_n_7dd05aaee2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_f4a20f5c97.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1772/news/', 'published'),
('앰부쉬X코카콜라, 톡 쏘는 Y3000 협업 컬렉션 공개', '앰부쉬가 코카콜라 Y3000을 모티브로 한 컬렉션을 선보였다', 'categoryfashion1773news-209', '2023-10-19', 'Fashion', '["앰부쉬","코카콜라","Y3000"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f2ff7982c2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3bca90e02d.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/CocaCola/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">코카콜라</strong></a> Y3000과 <a href="https://www.instagram.com/ambush_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">앰부쉬</strong></a>가 만났습니다. ???? 최근 AI가 레시피를 만든 코카콜라의 Y3000이 발매됐었는데요. 앰부쉬와 손잡은 이들은 인간의 창의성과 기술력의 결합이 끝없는 가능성으로 변모하는 모습을 이번 협업 컬렉션으로 나타냅니다. 제품은 메탈릭한 실버와 미래지향적인 디자인을 담은 반팔 티셔츠와 목걸이 등. 지금 앰부쉬 홈페이지에서 마법같은 디자인을 확인해보세요!</p>

<br><br>

<br>

<center>

</center>

<br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/393264417_18392313457011369_2648003652910570923_n_21e5de9ba1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/393356929_18392313448011369_1508305442873847753_n_1d9d4a60ad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/391667998_18392313472011369_8956758717724664388_n_f2855d0e49.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/393317963_18392313496011369_791480499014821576_n_42fb802658.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1773/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('혼가먼트 23FW ‘PLAYERS CLUB’에 초대합니다', '팀웨어를 콘셉트로 고기능 소재를 이용한 클래식 스포츠 의류를 제안한다', 'categoryfashion1776news-210', '2023-10-19', 'Fashion', '["혼가먼트","23FW","PLAYERS CLUB"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_3668a707bd.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_ce1deff17b.jpg', '<center>

</center>

<br>

<p style="text-align:left;">자유로운 라이프 스타일을 표현하는 골프 & 스포츠 브랜드인 <a href="https://www.instagram.com/horn_garment_korea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">혼가먼트</strong></a>가 23FW 컬렉션을 출시했습니다. 소재 선택부터 마감에 이르기까지 장인 정신에 기반하는 이번 시즌 컬렉션은 ‘PLAYERS CLUB’으로 팀웨어를 콘셉트로 고기능 소재를 이용한 클래식 스포츠 의류를 제안하는데요.</p>

<br><br>

<br>

<p style="text-align:left;">골프복이 골프 공간에만 한정되어 착용되는 것이 아닌 다양한 공간 및 일상에서의 자유로운 스타일을 시도할 수 있다는 것을 보여 주는 혼가먼트의 23FW 컬렉션을 지금 바로 혼가먼트 공식 홈페이지에서 만나 보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_4d6d5578cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_24f9a0c64d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_44ca202911.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_a2fa7fcf6b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_4ef59b4d40.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_4018327c54.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_0c309e522d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_5fc2db8047.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_9772e35ccf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_1536ef4638.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_b32dd2cf32.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_0e1b803304.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_57404a18df.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_f25060eae8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_acf57b0ce7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1776/news/', 'published'),
('슈프림x디키즈, 워크웨어로  선보이는 시그니처 컬렉션', '레더 조끼, 봄버 재킷, 저지, 진, 비니 등 다양한 아이템 구성', 'categoryfashion1777news-211', '2023-10-19', 'Fashion', '["슈프림","디키즈","supreme","dickies"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_03abc666f8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_974db36064.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/supremenewyork/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슈프림</strong></a>과 <a href="https://www.instagram.com/dickies/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디키즈</strong></a>가 가을 2023 콜라보레이션 컬렉션을 위해 힘을 합쳤습니다. 이번 컬렉션은 디키즈의 시그니처 제품군을 탐구하는 워크웨어 스타일링을 기반으로, 레더 조끼, 봄버 재킷, 저지, 진, 비니 등 다양한 제품군으로 만나볼 수 있었는데요. 해당 컬렉션은 한국에서 오는 21일(토) 오전 11시에 공개된다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_9559459fe1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_69f29019c1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_306a194e68.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_744cc1b14e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_763c5ce63e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_39ff4644b4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_03babd62de.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_a3950611fa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_e1d42dc8a8.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1777/news/', 'published'),
('푸마와 발란사가 두 번째 협업 컬렉션을 선보인다', '테니스에서 받은 영감을 담은 스니커즈와 어패럴이 준비되었다', 'categoryfashion1747news-212', '2023-10-15', 'Fashion', '["푸마","발란사"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_430da6afa7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e79289c23b.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/puma_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>와 <a href="https://www.instagram.com/soundshop_balansa/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">발란사</strong></a>가 두 번째 협업 컬렉션을 선보입니다. 테니스에서 받은 영감을 담은 스니커즈와 어패럴은 테니스 공의 컬러와 독특한 질감을 디자인과 소재의 모티브로 사용해 위트와 트렌디함이 갖춰진 라인업을 완성시켰죠. </p>

<br><br>

<br>

<p style="text-align:left;">협업 컬렉션은 클라이드, 푸마-180 및 후디, 스웻팬츠, 그래픽 티셔츠로 구성되었으며, 지금 바로 푸마 공식 온라인 스토어 및 일부 푸마 매장을 비롯해 발란사 온라인 스토어와 무신사에서 만나 볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_1_6ace09d210.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_2_fcf45238a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_3_2e1aac4c88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_X_1_58578ae799.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_X_2_631da20b06.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1747/news/', 'published'),
('이 가을에 꽃 향기를 남긴 퍽스앤미니와 푸마의 협업', '푸마와 퍽스앤미니 세 번째 협업이 공개됐다', 'categoryfashion1724news-213', '2023-10-11', 'Fashion', '["푸마","퍽스앤미니","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8d0c70a094.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_2ee612c3f0.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/puma_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>와 <a href="https://www.instagram.com/perksandmini/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">퍽스앤미니</strong></a>의 세 번째 협업 컬렉션이 공개됐습니다. 축구에서 영감을 받아 탄생한 이번 컬렉션은 푸마의 테크니컬 스포츠웨어와 퍽스앤미니 특유의 유니크한 매력을 한데 녹여냈는데요. 게임화된 그래픽과 휘장, 그리고 20%의 높은 재활용 소재 사용이 인상적입니다. 그래픽 프린트, 사이키델릭 무드가 느껴지는 플로럴 패턴이 어우러진 어패럴과 풋볼 헤리티지를 살린 슈즈까지. 다양하게 구성된 이들의 협업 컬렉션은 푸마 온라인 스토어와 오프라인 매장 등에서 지금 만나볼 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_6488df13d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_x_1_07eed6ec97.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_x_2_5fb5e4cd0d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_x_3_316601ee5c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_x_4_2219f128cb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_x_5_4113ff514c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_x_6_5faa7a5b24.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1724/news/', 'published'),
('환경과 디자인, 두 마리 토끼 다 잡은 오스트리야', '오스트리야의 23FW 컬렉션 공개', 'categoryfashion1710news-214', '2023-10-09', 'Fashion', '["오스트리야","fw23"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_e45fa02b32.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_4bb5363712.jpg', '<br>

<p style="text-align:left;">컬러풀하고 심플한 디자인에 기능성을 겸비한 의류를 전개하는 <a href="https://www.instagram.com/ostryaequipment_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오스트리야</strong></a>. 이번엔 가을을 맞아 FW23 컬렉션을 선보였는데요. 오가닉 코튼과 리사이클 패브릭, RDS 구스 다운을 사용해 환경과 디자인 모두를 생각하는 패션을 추구하는 점이 돋보였습니다. 팝한 컬러감과 함께 빈티지한 패턴의 모자, 그리고 가벼움과 따뜻함이 공존하는 다운 재킷 등 다양한 제품으로 구성된 오스트리야의 FW23 컬렉션. 이 아이템들은 국내 공식 홈페이지와 온오프라인 아웃도어샵에서 만나볼 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20230914_OSTRYA_8420_b233d61e31.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20230914_OSTRYA_9167_d50a90d20b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20230914_OSTRYA_9408_8787e25b9e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20230914_OSTRYA_9298_25e244a0b9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20230914_OSTRYA_8337_ac4dd5d56a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/20230914_OSTRYA_7982_2e00d4767a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_8059_0bdcceebf7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/DSC_7991_97473fcce8.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1710/news/', 'published'),
('어둠의 아름다움이란 이런 것, 아크네 스튜디오 23FW 캠페인', '아크네 스큐디오와 세계적인 모델 아노크 아이의 만남', 'categoryfashion1698news-215', '2023-10-07', 'Fashion', '["아크네스튜디오"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_e2c02e8cd7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_5fff598087.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/acnestudios/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아크네 스튜디오</strong></a>가 2023 가을 겨울 캠페인을 위해 세계적인 모델 <a href="https://www.instagram.com/anokyai/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아노크 아이</strong></a>와 힘을 합쳤습니다. 아크네는 이번 컬렉션에서 ‘어둠의 아룸다움’에 집중했다고 하는데요. 크리에이티브 디렉터 <a href="https://www.instagram.com/johnnyjohansson/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">조니 요한슨</strong></a>은 이번 컬렉션을 통해 ‘도시가 갑자기 끝나고 소나무 숲이 시작되는 낮이 짧은 스웨덴의 겨울을 표현하고 싶었다’고 밝혔습니다. 해당 캠페인 피스들은 지금 바로 아크네 매장과 온라인 웹사이트에서 만나볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/386299441_887925459636635_1476725618625897747_n_1_c44bc2f76a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/386344659_283831151160455_8814221234613871015_n_a166b54f09.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/385895318_6638815479533969_6482821949827670803_n_87901e0edb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/386248536_274035035607381_2226073121467546254_n_8586ed6a51.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/386363511_280505748136319_4730827638283775945_n_c2c1a5361b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/385920629_2451109331730058_899394920917641085_n_69d820be98.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1698/news/', 'published'),
('크록스가 가을을 맞아 선보이는 카우보이 부츠 버전 크록스', '오는 23일 대한민국, 일본, 유럽 등의 국가에서 발매된다', 'categoryfashion1694news-216', '2023-10-06', 'Fashion', '["crocskorea","crocs"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_25ee792888.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_f32fac2b48.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/crocs/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">크록스</strong></a>가 오는 23일 우디의 카우보이 부츠를 재연한 신발을 선보일 예정입니다. 악어가죽 질감으로 이루어진 해당 제품은 별 모양의 비지츠와 백카운트에 달린 스퍼스를 포인트로 하는 것이 특징. 해당 제품은 <a href="https://www.instagram.com/crocskorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">크록스 코리아</strong></a>를 통해서도 만나볼 수 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/386198378_1052986792374472_293156449921462827_n_4439ae9d32.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1694/news/', 'published'),
('시에라디자인의 23 가을, 겨울 컬렉션 룩북이 공개됐다', '로사 소프트쉘 자켓, 겟다운 경량 구스 다운 자켓 등이 시즌 주요 아이템이다', 'categoryfashion1695news-217', '2023-10-06', 'Fashion', '["시에라디자인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b9d03cbae6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_77b7589f84.jpg', '<br>

<p style="text-align:left;">마운틴 아웃도어 브랜드인 <a href="https://www.instagram.com/sierradesigns_kor/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">시에라디자인</strong></a>이 23 가을, 겨울 컬렉션 룩북을 공개했습니다. ‘From the archives’라는 키워드로 시에라디자인의 경험과 도전이 녹아든 아카이브 침낭, 텐트 등을 복각한 아노락 셋업, 구스 다운을 선보이게 될 예정이라고 합니다.
<br><br>
특히 주목할 만한 것은 시에라디자인의 아카이브인 ‘로사 소프트쉘 자켓’과 시그니처 아이템인 ‘겟다운 경량 구스 다운 자켓’. 이외에도 브랜드의 클래식으로 회자되는 오리지널 60/40 클래식 마운틴 파카와 3레이어 소재 경량 백팩 등 다양한 제품들로 구성되었습니다.
<br><br>
모험의 여정을 즐기는 이들을 위한 시에라디자인의 23가을, 겨울 컬렉션 제품은 더현대 서울, 롯데백화점 잠실점과 공식 온라인 스토어에서 만나 볼 수 있습니다. 특히 공식 온라인 스토어에서는 개인의 아웃도어 필드 레벨에 맞는 기능과 스타일의 제품도 제안 중이니 놓치지 마세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_41aaf455aa.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_944f1e68be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_ce10dbcbf2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_5c122dcf3d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_b0e91108cc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_39be54ef6c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_b844dbfa6d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_271073ae67.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_dcf26a3042.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_eeb9f05b10.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_8aa793dfba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_d4dc0e36e2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_29b9b9cda2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_9f74eea4d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_f2ccd5ab0a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/16_55bb021027.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1695/news/', 'published'),
('스투시 x 클락스 오리지널, 카드를 테마로 한 슈즈 실루엣', '블랙 스웨이드 위에 얹어진 클럽, 다이아몬드, 스페이드 및 하트', 'categoryfashion1655news-218', '2023-09-27', 'Fashion', '["clarksoriginals","stussy"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_f767564cd5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_2fe2bb63a9.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/stussy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">스투시</strong></a>와 <a href="https://www.instagram.com/clarksoriginals/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">클락스 오리지널스</strong></a>가 다시 한번 만나 그들만의 아이코닉한 실루엣을 탄생시켜 화제입니다. 검은색 스웨이드에 빨강과 화이트 포인트로 이루어진 4개의 카드 기호 클럽, 다이아몬드, 스페이드 및 하트 스티치가 눈에 띄는데요. 해당 제품은 현지 시간으로 9월 29일 오전 10시부터 일부 챕터 매장과 스투시 공식 웹사이트에서 만나볼 수 있다고 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/382532748_291628733630545_7681256530365640327_n_9bb9fa5051.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/382961668_724184586212654_6286249249815776769_n_21877f7986.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/381280868_782894490510836_3333524891902943749_n_a8a2aebb20.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/383807861_328947159802734_2052413359490598620_n_ce0394b270.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1655/news/', 'published'),
('나랏말ㅆ·미 듕귁에 달아.. 나이키 ‘한글날 코르테즈’의 등장', '가을에 어울리는 소재와 디자인으로 만나볼 수 있다', 'categoryfashion1656news-219', '2023-09-27', 'Fashion', '["nike","한글날"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_2d08086b6d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_d63a04273b.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/nike/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나이키</strong></a>가 대한민국의 자랑스러운 국경일인 한글날을 기념하는 ‘한글날 기념 코르테즈’를 선보입니다. 어두운 브라운 톤으로 발매되는 해당 제품의 힐 탭과 밑창에 한글로 새겨진 나이키 로고와 끈에 매달린 화이트톤의 나이키 키링이 포인트인데요. 가을에 어울리는 톤과 재질, 스티치 디자인이 구매욕구를 불러일으키네요. ???? 해당 제품은 10월 아시아 선 발매될 예정으로, 아직 구체적인 발매 정보는 알려지지 않았다고 합니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11111_757a06e560.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_e0aa117ec1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/123_c1761a424d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e67f08f21a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_b663e64f7f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_7245592713.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1656/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('23FW 캐나다구스x로크x맷 맥코믹 콜라보레이션 컬렉션이 펼쳐진 성수의 사막', '캐나다구스 2023FW를 위해 함께 뭉친 두 브랜드와 한 명의 아티스트', 'categoryfashion1610news-220', '2023-09-19', 'Fashion', '["캐나다구스","로크","23FW","맷 맥코믹"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_06e3f39c7d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_73d44a3cb3.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/CanadaGoose/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캐나다구스</strong></a>가 패션 브랜드 <a href="https://www.instagram.com/rokhofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">''로크(Rokh)''</strong></a>, 그리고 아티스트 <a href="https://www.instagram.com/mattrmccormick/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">맷 맥코믹</strong></a>과 함께 손을 잡고 2023FW 컬렉션을 화려하게 선보였습니다. 성수동의 코사이어티에 펼쳐진 사막의 공간에서 진행된 이번 런칭 행사는 캐나다구스만의 아이코닉한 분위기가 더욱 잘 느껴졌는데요. 배우 정해인, 배우 겸 가수 강민혁, 보이그룹 몬스타엑스 셔누, 걸그룹 있지(ITZY), 모델 아이린 등 다양한 셀럽들이 방문해 더욱 열기를 더했다고 하네요. 그 화려했던 런칭 행사 현장을 영상을 통해 지금 바로 생생하게 느껴보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_8ab9867bbb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_540b13214e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_fede52a2eb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_2f354b9824.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1610/news/', 'published'),
('세븐틴 도겸이 발리의 글로벌 앰버서더로 발탁됐다', '도겸은 24SS 캠페인 참여를 시작으로 활발한 활동을 전개할 예정이다', 'categoryfashion1611news-221', '2023-09-19', 'Fashion', '["도겸","발리"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/379595375_1495995387870164_7181338567505798105_n_66cfa16b67.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_555b5627f4.jpg', '<br>

<p style="text-align:left;">세븐틴의 <a href="https://www.instagram.com/dk_is_dokyeom/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">도겸</strong></a>이 스위스 럭셔리 브랜드 <a href="https://www.instagram.com/bally/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">발리</strong></a>의 새로운 글로벌 앰버서더로 발탁됐습니다. 발리 측은 도겸의 트렌디한 스타일과 따뜻한 성품이 발리의 가치관과 완벽하게 일치한다며 앰버서더 발탁 소감을 밝혔는데요. 도겸은 발리의 24SS 캠페인 참여를 시작으로 브랜드 활동에 참여할 예정이라고 합니다. 앞으로의 발리와 도겸은 어떤 시너지를 보여 줄까요? </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/379595375_1495995387870164_7181338567505798105_n_78834f3263.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/379162481_699122478754369_7782117568946659030_n_549355b785.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1611/news/', 'published'),
('모두가 사랑할 펜티 X 푸마 아반티 출시', '리한나와 푸마의 새로운 협업 스니커즈 출시', 'categoryfashion1584news-222', '2023-09-15', 'Fashion', '["리한나","푸마","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6717530881.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_80432d1f10.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/badgalriri/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리한나</strong></a>와 <a href="https://www.instagram.com/puma/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>의 새로운 협업, ‘펜티 X 푸마 아반티’를 출시했습니다. 리한나는 푸마와의 여러 협업을 같이 해왔고, 푸마의 스포츠 헤리티지에 리한나의 음악적 아이콘으로서의 위상이 더해져 시너지를 일으키는데요. 이번 파트너십은 축구 트렌드를 패션으로 재해석했으며, 푸마를 상징하는 ‘푸마 킹’과 ‘이지 라이더의 결합. ‘푸마킹’ 축구화의 디자인에 푸마의 헤리티지를 느낄 수 있는 ‘이지 라이더’의 아웃솔이 매력적인 조합입니다. 특히 리한나는 이 컬렉션을 온 가족이 함께 즐길 수 있는 제품으로 출시하고자 했는데요. 모두가 사랑하는 아이코닉한 그들의 협업 제품은 오늘(15일)부터 온•오프라인에서 만나보실 수 있습니다!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_4_072f163828.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_3_794523fe39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_2_f5d9b7d2a7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1584/news/', 'published'),
('느린 향기의 여정 르 라보 온 휠 세 번째 이야기', '르 라보 온 휠 세 번째 여정은 서울 문래동에서 쓰여진다', 'categorybeauty1579news-223', '2023-09-14', 'Beauty', '["르라보","르라보온휠","문래동"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_286e3069d1.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_5fd8a63c7a.jpg', '<br>

<p style="text-align:left;">시간과 정성을 들여 만든 영혼이 가득한 향수, 그리고 이 향을 전달하는 <a href="https://www.instagram.com/lelabofragrances/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">르 라보</strong></a>의 느린 여정. ‘르 라보 온 휠’ 세 번째 이야기가 서울 문래동에서 쓰입니다. ‘르 라보 온 휠’은 ‘무빙 슬로우 퍼퓨머리’를 테마로 바퀴 위에 구현된 자유로운 향수 놀이터이자 르 라보의 자유로운 철학을 상징하는데요. </p>
<br>
<p style="text-align:left;">폐공장과 예술의 조화가 어우러진 문래동은 보이는 그대로의 아름다움을 중시하는 르 라보의 와비사비 정신과 닮아 있습니다. 이번 팝업 스토에서는 향수, 홈 컬렉션, 바디-헤어-페이스 등 르 라보의 베스트셀러를 만날 수 있으며, 기간은 10월 6일부터 19일까지. 르 라보의 향기 여행에 함께 동참해보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_75a933d494.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/LE_LABO_10_6bd12cc109.jpeg"]'::jsonb, '[]'::jsonb, '/category/Beauty/1579/news/', 'published'),
('아더에러가 쌓아온 독보적 결정체 2023 가을 겨울 캠페인 공개', '더욱 탄탄해진 디자인과 독자적인 원단, 디테일로 돌아왔다', 'categoryfashion1565news-224', '2023-09-12', 'Fashion', '["아더에러","adererror"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_74f840df5c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_d5179a799b.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더에러</strong></a>가 2023 가을 겨울 컬렉션인 ‘Oblique Hints’를 출시했습니다. 이번 컬렉션은 그간 아더에러가 쌓아온 아이덴티티의 응집력을 보여주듯 더욱 탄탄해진 디자인과 독자적인 원단, 디테일이 특징이라고 하는데요. </p>

<br><br>

<br>

<p style="text-align:left;">해당 캠페인은 간절기에서 착용할 수 있는 맨투맨부터 한 겨울에 좋을 헤비 아우터까지 다양한 라인업으로 만나볼 수 있으며, 신발과 백, 액세서리까지 확장된 카테고리로 준비되어 있다고 합니다. 또한 아더에러가 오랫동안 고수하던 A1~A3 사이즈 표기법을 벗어나 XS~XL사이즈로 사이즈 표기법을 변경하여 다양한 체형을 커버할 수 있게 되었다는 소식까지. 해당 제품들은 오는 13일(수) 아더에러 공식 온라인 스토어에서 먼저 만나볼 수 있으며, 14일(목)부터 전국 오프라인 스토어에서 만나볼 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_cf7ad90abc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_aedd423f47.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_acdeb4e357.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_49f35010d7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_14b5c70734.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_c44a60f21a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_61bda89820.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_cae94c25f2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_3affcd70c6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1565/news/', 'published'),
('포스트 아카이브 팩션 (파프)의 5.1 컬렉션이 온라인에서 발매된다', '지금까지의 아카이브를 응축한 결과물이다', 'categoryfashion1536news-225', '2023-09-07', 'Fashion', '["포스트아카이브팩션","파프"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7a7b53867d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_158970ab00.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/postarchivefaction/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포스트 아카이브 팩션 (파프)</strong></a>의 5.1 컬렉션이 온라인에서 발매된다는 소식. ????????  5.1 컬렉션은 파프의 1.0부터 5.0+ 컬렉션까지 이어지는 아카이브를 응축하여 만들어진 결과물인데요. 과거의 출시되었던 파프의 대표 모델들은 5.1 컬렉션에서 더 진보한 제품으로 재탄생하였으며, 완성도 높은 컬렉션의 모습을 갖추게 되었다고 하네요. 포스트 아카이브 팩션 (파프)의 5.1 컬렉션은 잠시 후 1시부터 구매 가능합니다! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8122_5d0b2760a0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8118_91b7d756e1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8142_3a3dad95a1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8083_f02509ec39.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8072_d4b26cc942.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_6370_6e8984051b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8148_9411dd37d8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8174_331d7281a9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8176_fa9456994a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8183_131c44c4b6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_8188_5191a077a6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1536/news/', 'published'),
('데님 티어스와 리바이스의 바이커 협업 컬렉션', '데님 티어스와 리바이스의 협업 컬렉션 공개', 'categoryfashion1539news-226', '2023-09-07', 'Fashion', '["데님티어스","리바이스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cdd3e56b13.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_685d2e0302.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/denimtears/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">데님 티어스</strong></a>와 <a href="https://www.instagram.com/levis/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리바이스</strong></a>의 새로운 협업 컬렉션이 공개됐습니다. 뉴욕시의 흑인 바이커를 표현한 사진작가 마틴 딕슨의 포토북에서 영감을 얻은 이번 컬렉션. 두 브랜드의 아이덴티티가 드러나는 데님 셔츠부터 티셔츠, 모자, 벨트에 이르기까지 다양한 제품군이 준비되어있는 모습입니다. 협업 컬렉션 제품은 9월 9일 열리는 뉴욕 팝업과 9월 12일 오전 9시부터 데님 티어스의 홈페이지에서 구매가능하다고 하니 참고하세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/373313972_17998901438086790_7938171739740416193_n_e6e87b6bb3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/375471497_17999401466086790_4925827726755589125_n_6111316f3a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/375656390_17999401502086790_1274078345434696315_n_c27cced5cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/375601719_17999401499086790_2900064581785510209_n_279bdfece2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/375603614_17999401511086790_898149214812577931_n_c7caa61e16.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/375823735_17999401445086790_5400858854921319332_n_526fb503c9.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1539/news/', 'published'),
('하루의 시작과 끝을 담은 빈티지헐리우드의 23 가을 주얼리 컬렉션', '여성 주얼리 라인인 포르트와 남성 주얼리 라인인 원을 출시한다', 'categoryfashion1530news-227', '2023-09-06', 'Fashion', '["빈티지헐리우드","주얼리"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/tpfh_cc0f229546.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/jpg_0c38fc41cd.jpg', '<br>

<p style="text-align:left;">MZ세대의 마음을 훔친 악세서리 브랜드 <a href="https://www.instagram.com/vintagehollywood2008/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">빈티지헐리우드</strong></a>가 23 가을 주얼리 라인인 ‘포르트’와 ‘원’ 컬렉션을 선보였습니다. ‘포르트’는 하루의 시작과 끝을 문이 열고 닫히는 모습에 비유하여 우리의 일상을 녹여낸 컬렉션이며, ‘원’은 남성 주얼리의 첫 시작을 알리는 컬렉션이라는 의미인데요. 이번 주얼리 라인들은 이전 빈티지 헐리우드의 아이템들보다 클래식한 무드로, 온•오프라인에서 동시에 만나보실 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_4_cd5a66de97.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_2_d099c4b62b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_3_31c38537b7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_1_7bf4d74bd3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_5_5f35d923dc.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1530/news/', 'published'),
('맥퀸의 튜더 로즈 문장에서 영감을 얻은 새로운 앰블럼 백', '23FW 컬렉션을 통해 씰 백을 선보인다', 'categoryfashion1531news-228', '2023-09-06', 'Fashion', '["알렉산더맥퀸"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/374715044_212046731858528_7310379283608751705_n_aa88010b6b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_09fafaeff1.jpg', '<div style="padding:177.78% 0 0 0;position:relative;"></div>

<br>

<p style="text-align:left;">영국 자연의 상징인 튜더 로즈 문장에서 영감을 얻은 <a href="https://www.instagram.com/alexandermcqueen/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">맥퀸</strong></a> 하우스의 새로운 앰블럼을 소개합니다. 그 이름은 바로 ‘씰(Seal)’. 알렉산더 맥퀸이 이번 23FW 컬렉션을 통해 메탈 씰 클로저가 포인트인 씰 백을 선보이는데요. 시그니처 메탈 하드웨어와 조절 가능한 체인까지 지금 바로 영상으로 확인해 보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/374715044_212046731858528_7310379283608751705_n_8f074e37b6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1531/news/', 'published'),
('서울 패션 위크 BLR 백스테이지 현장은?!', '<피에이피>가 BLR 백스테이지 현장을 카메라에 포착했다', 'categoryfashion1533news-229', '2023-09-06', 'Fashion', '["BLR","서울패션위크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_77efd2abce.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/R_9aa7ee7ea5.jpg', '<br>

<p style="text-align:left;">데님의 본질을 재정의하며, 브랜드 특유의 데님 스타일에 거칠고 불투명한 무드를 제공하는 새로운 데님 베이스 브랜드 <a href="https://www.instagram.com/blrbluer_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">BLR</strong></a>. 이번 서울 패션 위크(@seoulfashionweek_official)를 통해 동적인 무드로 역동적 쇼를 보여 준 BLR의 백스테이지 현장을 <피에이피>가 카메라에 담아왔습니다. 스크롤을 내려 확인해 보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2103_b3676cee61.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1896_34affe2bdf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1909_e12647e6be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1910_896a1126af.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2006_53c4fc98c4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2034_140a4682ad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2040_ce2c138adc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2057_9f7462071c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2378_c959865cbe.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2403_c19d32c7f5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1820_39376015a6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1848_88890c7d46.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1877_772be728fb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1903_190e5aad70.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1931_b120574941.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A1986_d6629cf318.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2004_d6bbb349ba.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2016_a48f89b3b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2028_e79442cd89.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2048_18a75ec197.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2059_55a1f3a422.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2074_405e159d46.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2095_f1c8bb5a74.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2097_c1a8805f17.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2116_80352dca29.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2122_65852b2180.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2301_faeb13044e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/AS_4_A2338_a51b83f34e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/R_66c824ff83.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1533/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('당신의 아더 에러를 마음껏 그려보세요!', '창의적인 아티스트를 조명하는 아더에러의 ‘Draw your line’ 프로젝트', 'categoryfashionart1509news-230', '2023-09-02', 'Fashion,Art', '["아더에러","drawyourline","오재훈"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_87cb7c54e9.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_73bee3695b.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더 에러</strong></a>가 여러 창의적인 아티스트들의 작업을 조명하는 ‘Draw your line’ 프로젝트를 공개했습니다. 최근 아더 에러는 새로운 스니커즈 Log 컬렉션의 발매를 앞두고 있다고 예고했었는데요. 이 컬렉션의 제품에 사용된 소재들을 이용하여 제작된 아티스트의 오브제들을 ‘Draw your line’ 프로젝트에서 확인할 수 있습니다. 프로젝트의 첫 번째 주자는 <a href="https://www.instagram.com/jaehunfive/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오재훈</strong></a> 작가의 아더 성수 스페이스를 닮은 우주선 단램프 ‘ADER Space Lamp’. Log 컬렉션 추후 발매 일정은 &#60;피에이피&#62; 후속 기사를 참고해주세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/373308656_1648230122355145_9177472958878872355_n_99311337ac.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/372974251_849530833208223_1762057238399505026_n_2af41331e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/372881590_1534050640461488_7409093675057108049_n_c45e52d7c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/372875406_1987704698269723_5871238611595097815_n_312fdaf01a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/372885238_260917670153267_3971757769596835573_n_205b1f337f.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Art/1509/news/', 'published'),
('지구를 넘어 우주를 지키는 비비안웨스트우드와 이스트팩 협업', '비비안웨스트우드와 이스트팩의 가방 협업 공개', 'categoryfashion1506news-231', '2023-09-01', 'Fashion', '["비비안웨스트우드","이스트팩","가방"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_29a6e7e43c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_01b9646f71.jpg', '<br>

<p style="text-align:left;">환경을 생각하는 브랜드로 유명한 <a href="https://www.instagram.com/viviennewestwood/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">비비안 웨스트우드</strong></a>. 최근 공개한 <a href="https://www.instagram.com/eastpak/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이스트팩</strong></a>과의 협업 컬렉션도 역시 지구와 사회를 위한 서포트의 일부인데요. 이번 컬렉션을 통해 멸종 위기 우림 보호, 지구 온난화와 생태계 지원 및 지역민 고용 지원 등을 지지하는 모습입니다. 비비안 웨스트우드의 펑키한 무드가 묻어나는 커스텀 플래닛 그래픽과 중요한 변화의 시기를 나타내는 ‘토성의 귀환’을 컨셉으로 한 디자인을 선보였습니다. 비비안 웨스트우드와 이스트팩의 가방 라인 협업을 &#60;피에이피&#62;에서 확인해보세요.</p>

<br><br>

<center>

</center>

<br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371390373_1256624048385785_686084502525613550_n_0100f607f0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371175557_283042481023646_3619913359429408938_n_24b117d101.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371232937_1361704331371238_4055057490125906405_n_5b3970e035.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1506/news/', 'published'),
('가수 권은비가 캘빈클라인 언더웨어 화보를 공개했다', '가수 권은비가 캘빈클라인 언더웨어 화보를 공개했다', 'categoryfashion1482news-232', '2023-08-29', 'Fashion', '["권은비","캘빈클라인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371158555_286889407422719_1847906725502711963_n_c4a4fbc45c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0d7bdc374a.jpg', '<br>

<p style="text-align:left;">가수 <a href="https://www.instagram.com/silver_rain.__/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">권은비</strong></a>가 인스타그램을 통해 <a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a> 언더웨어 화보를 공개했습니다. 권은비의 독보적인 분위기와 캘빈클라인의 언더웨어가 잘 어우러진 감각적인 화보컷이 인상적이네요. 권은비는 최근 워터밤으로 주목받은 바 있지만, 아이즈원으로 데뷔 후 솔로 활동까지 계속해서 꾸준히 좋은 모습을 보여 주고 있습니다. 최근 발매한 [The Flash]로는 음악 방송 1위도 차지했죠.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371158555_286889407422719_1847906725502711963_n_b3ba769700.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371311603_198606779892177_657952536662457149_n_ce5e6df5bc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/370695490_846114073594864_3558617153205897760_n_409de03691.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371188283_833569948177907_1607492439566722564_n_9c6c4cb163.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/370994246_282585014487958_998250370428334623_n_ecd4a2a2db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/371050132_3533799876907684_5126891979837584000_n_8d76748e35.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1482/news/', 'published'),
('슈가의 유포리아, NBA와의 협업 캡슐 컬렉션 공개', 'BTS의 슈가가 NBA와의 협업 캡슐 컬렉션 티셔츠를 공개했다', 'categoryfashion1457news-233', '2023-08-25', 'Fashion', '["슈가","nba","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_6e0834848b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_96ebd0c914.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/nba/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">NBA</strong></a>의 앰배서더로 활동 중인 BTS의 <a href="https://www.instagram.com/agustd/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">슈가</strong></a>. 그들의 협업 캡슐 컬렉션이 공개되었습니다. 이번 캡슐 컬렉션은 스포츠웨어 브랜드인 <a href="https://www.instagram.com/mitchellandness/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미첼앤네스</strong></a>를 통해 이루어졌으며, 어렸을 적부터 농구를 사랑했던 슈가의 꿈이기도 했는데요. 농구공과 같이 프린팅된 슈가의 래퍼명 ‘Agust D’가 포인트. 그들의 협업 발매 소식은 추후 이어질 &#60;피에이피&#62; 기사에서 확인하세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369770055_774471781119383_8780188187566456010_n_46d0caa5a0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/370304838_1017594319259855_866842589614762979_n_1577c5d2d1.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1457/news/', 'published'),
('키스(KITH)가 2023 가을 컬렉션을 공개했다', '세련된 가을 레이어링에 계절감에 맞는 소재들로 구성된 컬렉션을 선보인다', 'categoryfashion1440news-234', '2023-08-24', 'Fashion', '["kith","키스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_78701b6498.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_be4ad6afb7.jpg', '<br>

<p style="text-align:left;">패션 브랜드 <a href="https://www.instagram.com/kith/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">키스</strong></a>가 2023 가을 컬렉션을 출시합니다. 세련된 가을 레이어링에 이상적이고 계절감에 맞는 무거운 소재로 제작된 실루엣들. 더 다양해진 제품군도 인상적인데요. 아우터 웨어, 테일러 셔츠, 시즌 니트웨어, 코어 바지 및 반바지 그리고 다양한 악세서리까지. 한편 키스는 내년 상반기 첫 한국 매장 오픈을 앞두고 있죠. 바로 내일 공개되는 키스의 컬렉션도 놓치지 마세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/44_5bce1414_abda_434a_9ecf_d89f591ac002_20089aa87d.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/37_9e76d7c0_70cc_4dc7_9806_161b1467e017_09d6057320.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/36_b2ecbf77_0348_4b95_b179_39e0e7bfa9bc_2631b7a52d.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/18_2bdcbbb2_0d87_483b_a6a2_4fefbf124629_afdb74d09d.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_69bd1838_3068_4669_baa5_863fa989dabd_e3d4c7c003.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_f111cad4_cd53_4039_9302_ae5baa898434_26aeecd3bc.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_3a154d62_5be7_4297_9d13_29bdc248a8ba_82c65a02e3.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_0e476a6b_16a5_4a6a_8069_b6a5f3445cfd_95203f4e6f.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_51d95725_afa0_433f_8c28_3e82b2ae825e_9eca2e1669.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_ebe31cfb5f.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/1440/news/', 'published'),
('사카이 X 칼하트윕, 콜라보 강자들의 만남', '사카이와 칼하트윕의 협업 제품이 9월 8일 런칭된다', 'categoryfashion1444news-235', '2023-08-24', 'Fashion', '["사카이","칼하트윕","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_58a142694c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_d178a18d25.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/sacaiofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">사카이</strong></a>와 <a href="https://www.instagram.com/carharttwip/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">칼하트 WIP</strong></a>의 협업 컬렉션이 오는 9월 8일 발매됩니다. 그들이 셀렉한 아이템의 일부는 9월 6일에 선런칭되며, 나머지는 8일에 온라인 스토어와 리테일샵에서 구매가능하다고 하는데요. 이들의 협업 소식은 파리패션위크를 통해 한 차례 알려진 바. 이번 컬렉션 아이템들은 칼하트 고유의 디자인에 사카이만의 유니크한 소재 사용을 더해 두 브랜드의 아이덴티티를 나타내고 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369665127_689939375863822_2854413505049434979_n_84d80f608d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369987895_901589101674741_5280615933335760104_n_8f78adf243.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369551124_1455199511932099_362128364789898830_n_09c88ebeee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369841202_614786290836095_628411623827568641_n_4816441e43.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369770444_804221091409217_1865927135709752973_n_c41d88dbf3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/370607123_283630647622389_3064934605112999332_n_0e077dc553.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369555500_688071123187820_1983119850551742773_n_a6ebcc32d9.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1444/news/', 'published'),
('오픈 YY의 새로운 가을을 만나봐', '오픈 YY가 브랜드 리뉴얼 이후 첫 FW 컬렉션을 공개한다', 'categoryfashion1436news-236', '2023-08-23', 'Fashion', '["오픈yy","더오픈프로덕트","fw"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_017a49cc76.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_476d3f00eb.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/openyy_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오픈 YY</strong></a>가 브랜드를 리뉴얼한 후 첫 FW 컬렉션을 발표합니다. 이번컬렉션의 공개된 이미지에는 기존 브랜드였던 더오픈프로덕트만의 독창성과 더불어 더 깊어진 감성이 드러나는데요. 특히 블랙과 데님의 조화, 그중에서도 데님의 패치워크와 워싱, 색감이 모던시크에 섞인 빈티지 무드를 표현하는 포인트. 새로워진 오픈 YY의 컬렉션은 8월 30일 홈페이지에서 확인 가능합니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368146496_768549298289900_8841194087056082485_n_706a88ea6a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368651654_1016126066190491_990501052155112435_n_26ee344e71.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369922811_318414133933904_838336067526561845_n_062d2ae939.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368689717_1698641330577967_6808426719196435423_n_1f4f59dc11.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369413985_1375997443263250_4525856193465578549_n_ab4d597ee7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1436/news/', 'published'),
('앤더슨벨 23FW, 오프라인에 이어 온라인에서도 출시', '오는 25일 10시에 발매될 예정이다', 'categoryfashion1438news-237', '2023-08-23', 'Fashion', '["앤더슨벨"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366952980_18378640282044347_4353877989064839156_n_466f154435.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_9b4d16f004.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/anderssonbell/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">앤더슨벨</strong></a>이 오프라인에서 23FW Early 컬렉션과 함께 1차 드롭 제품을 선보인 것에 이어 온라인 스토어에서도 컬렉션을 만나 볼 수 있게 되었습니다. 패션 필름도 함께 공개되었는데요. 앤더슨벨의 컬렉션 제품과 수많은 풍선이 어우러져 마치 동화 같은 분위기가 연출되었네요. 오는 25일 10시에 발매될 앤더슨벨의 23FW 1차 드롭 제품들, 놓치지 마세요! </p>

<br><br>

<div style="padding:177.78% 0 0 0;position:relative;"></div>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366713767_18378640243044347_1360107562631330377_n_28adec2200.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/364807119_18378640252044347_4337528695144300524_n_143a3d9d68.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/364793041_18378640261044347_68499078578314781_n_ae035b39a3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366952980_18378640282044347_4353877989064839156_n_997efa6de1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/365155922_18378640294044347_4458336920520278786_n_26d74b9c9d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/364795271_18378640273044347_4861568304550158892_n_73c1070716.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1438/news/', 'published'),
('래퍼 이영지가 코치의 글로벌 앰버서더로 발탁됐다', '이영지는 2023 가을 캠페인을 통해 본격적인 활동을 선보일 예정이다', 'categoryfashion1417news-238', '2023-08-22', 'Fashion', '["이영지","코치"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/247531424_949107285684667_7932083779902709211_n_519b6bd653.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_982bf8cac3.jpg', '<br>

<p style="text-align:left;">래퍼 <a href="https://www.instagram.com/youngji_02/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이영지</strong></a>가 럭셔리 브랜드 <a href="https://www.instagram.com/coach/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">코치</strong></a>의 글로벌 앰버서더로 발탁되었습니다. 코치 측은 브랜드 메시지인 ‘진정한 나 자신이 될 용기’와 코치의 럭셔리 스타일을 완벽하게 구현해낼 것으로 기대된다며 소감을 밝혔는데요. 이영지는 코치의 글로벌 앰버서더로서 코치 2023 가을 캠페인인 #WearYourShine 캠페인을 통해 본격적인 활동을 시작할 것이라고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/247531424_949107285684667_7932083779902709211_n_1274003231.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1417/news/', 'published'),
('프라다의 한층 더 새로워진 아르케 백', '23FW 캠페인 룩북도 함께 공개됐다', 'categoryfashion1418news-239', '2023-08-22', 'Fashion', '["프라다","아르케"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368562341_831534538580304_2508748215959393453_n_e32a6ea79e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_10f0660be8.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/prada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프라다</strong></a>의 새로운 실루엣 백인 ‘프라다 아르케’가 출시됩니다. 함께 공개된 룩북에는 프라다의 23FW 캠페인 주제인 ‘꽃’이 특히 눈에 들어오는데요. 아르케 백의 아카이브 볼륨과 부드러운 라인에서 오는 모던한 디자인. 나파 가죽 라이닝과 메탈 하드웨어가 특징인 아르케 백의 색상은 블랙, 화이트, 꼬냑 총 3가지로 출시된다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368562341_831534538580304_2508748215959393453_n_a63c92b776.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_540e4acefc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_86d047e8d1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368545660_604420131870646_4297127853962148690_n_864c73a2b1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368674663_987171012545374_7261605876396297718_n_0d3189d48b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369559262_1626248681195307_5868711774533179909_n_70e343b452.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369565308_249477864709657_1931879107075975742_n_1_27ca0d29ec.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1418/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('지방시와 언더커버 베어는 빨간 맛', '지방시와 언더커버 협업 티셔츠 26일 발매 예고', 'categoryfashion1419news-240', '2023-08-22', 'Fashion', '["지방시","언더커버","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3e7716c2f6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_ad50ab4dcc.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/givenchy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지방시</strong></a>와 <a href="https://www.instagram.com/undercover_lab/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">언더커버</strong></a>의 협업 티셔츠가 오는 26일 발매됩니다. <a href="https://www.instagram.com/matthewmwilliams/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">매튜 윌리엄스</strong></a>는 <a href="https://www.instagram.com/joniotakahashi/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">준 타카하시</strong></a>가 패션이나 예술적인 부분에서 많은 영감을 준 사람이라고 언급하며 이미지를 공개했는데요. 지방시의 로고와 언더커버만의 시그니처 베어 디자인이 결합된 강렬한 협업 디자인. 언더커버와 지방시의 만남이 명품 패션계에 어떤 영향을 미칠지 귀추가 주목됩니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368559511_682186466634387_8597059104314103174_n_0b6341a760.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1419/news/', 'published'),
('캡틴만의 23FW 캘빈클라인', '손흥민은 이제 캘빈클라인 진과 언더웨어의 얼굴로서 활동할 예정이다', 'categoryfashion1420news-241', '2023-08-22', 'Fashion', '["손흥민","캘빈클라인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368890276_1396156894300692_1702529547831481937_n_a476711506.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_16173c2142.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/hm_son7/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">손흥민</strong></a>과 <a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a>의 23FW 캠페인 화보가 공개되었습니다.  손흥민이 착용한 CK 블랙 언더웨어는 업그레이드된 디테일에 실용성을 더한 제품이라고 하는데요. 캘빈클라인 진의 얼굴로 활동하던 손흥민은 이제 캘빈클라인 언더웨어까지 영역을 넓힐 예정이라고 하네요. 캘빈클라인 진과 언더웨어 컬렉션을 전국 오프라인 매장과 온라인 스토어에서 만나 보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368563139_1024468068732733_5905404719825776299_n_6fb60c6f28.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368569210_836068467912187_6883096477972275755_n_6bab6f65c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368890276_1396156894300692_1702529547831481937_n_87af2ede01.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368752202_1323908951556884_1447283699381138268_n_e91d577d2d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369165670_609176878045666_4351859996194237188_n_5fdef62bb0.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1420/news/', 'published'),
('돌체앤가바나와 NCT 도영, 23FW 남성 컬렉션 화보 공개', '컬렉션을 이끌어가는 블랙 컬러가 돋보이는 캠페인을 공개했다', 'categoryfashion1410news-242', '2023-08-21', 'Fashion', '["도영","엔시티","NCT","돌체앤가바나"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369592591_18375752890011200_7946515308964854156_n_db80e4464a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/r_35e3ef975a.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/dolcegabbana/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">돌체앤가바나</strong></a>가 앰버서더 <a href="https://www.instagram.com/do0_nct/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">NCT 도영</strong></a>과 함께 한 캠페인 화보를 공개했습니다. 브랜드의 정수를 표현한 이번 2023 가을-겨울 남성 컬렉션을 착용한 도영은 에센자(ESSENZA)와 DG 에센셜 아이템을 완벽하게 소화한 모습. 특히 눈에 띄는 블랙 컬러는 컬렉션을 이끌어가는 컬러라고 합니다. 새로운 컬렉션은 돌체앤가바나 청담 플래그십 스토어와 온라인 스토어에서 만나 볼 수 있습니다! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369592591_18375752890011200_7946515308964854156_n_e162792c93.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369595557_18375752815011200_3086318687995520014_n_f159095c94.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369608484_18375752824011200_4030916325588449572_n_dbe2f9d8a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369634013_18375752881011200_4079079547477115119_n_12ec646f55.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369645189_18375752848011200_6986156548039335748_n_509860482a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369677716_18375752839011200_6955423931928088695_n_a853433d9d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369688996_18375752860011200_2704973933416027529_n_ad25433c49.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1410/news/', 'published'),
('아이브의 이서가 노스페이스의 새 얼굴로 발탁됐다', '추후 이서와 함께 한 23FW 화보를 순차적으로 공개할 예정이다', 'categoryfashion1412news-243', '2023-08-21', 'Fashion', '["이서","노스페이스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7a68e80e86.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f12d0053c4.jpg', '<br>

<p style="text-align:left;">그룹 <a href="https://www.instagram.com/ivestarship/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아이브의 이서</strong></a>가 <a href="https://www.instagram.com/thenorthface/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">노스페이스</strong></a>의 새로운 얼굴로 발탁되었습니다. 노스페이스는 잘파세대의 워너비이자 나날이 성장하는 모습을 보여 주고 있는 이서의 젊고 건강한 에너지가 브랜드 이미지와 잘 어울려 발탁하게 되었다고 밝혔는데요. 이서가 착용한 플리스 보머인 ‘울리 플리스 보머’ 화보뿐만 아니라 23FW 화보를 순차적으로 공개할 예정이라고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_67e5486586.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1412/news/', 'published'),
('스칸디나비아의 식탁 위 음식처럼, 란라 x 살로몬 두번째 친환경 협업', '새로운 크로스 프로 모델 ‘베터(better)’ 공개', 'categoryfashion1414news-244', '2023-08-21', 'Fashion', '["란라","살로몬","베터","ranra_studio","salomon","Better"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_1557bdfef3.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_10235ca6a5.jpg', '<br>

<p style="text-align:left;">런던과 레이캬비크 기반의 디자인 스튜디오 <a href="https://www.instagram.com/ranra_studio/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">란라</strong></a>와 <a href="https://www.instagram.com/salomonsportstyle/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">살로몬</strong></a>이 다시 한번 협업으로 만나 새로운 크로스 프로 모델 ‘베터(Better)’를 공개했습니다. 공개된 스틸컷에는 스칸디나비아의 식탁 위에서 음식들과 조화를 이룬 베터의 모습이 보이는데요. 이를 통해 친환경성과 지속가능성을 강조했으며, 천연 염색으로 완성한 베이지와 핑크 컬러웨이를 더욱 눈에 띄게 보여주고 있습니다. 해당 스니커즈는 오는 24일 부터 각 브랜드의 공식 웹사이트를 통해 만나볼 수 있다고 하네요.</p>

<br><br>

<center>

</center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367993520_2527870130715938_8386239251441380989_n_17414e87ee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367974277_619200100327064_3505367504746806551_n_78a70fadd2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367987358_961246851647941_2923391075208496465_n_aba63066bb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368401069_842671470553081_3358555930057703907_n_cb1ab0ea05.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368575710_1447324336000248_2508797459585647523_n_0b080a9126.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368831911_715055437124470_4190532509984531035_n_78c2332bec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369537546_17966619860556897_4220639928135469862_n_7b021c421e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/369547045_17966619872556897_7933328556116134364_n_3b7d09da0d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1414/news/', 'published'),
('디스이즈네버댓 X 뉴발란스의 협업 컬렉션이 모두 베일을 벗었다', '90년대 신발에서 느낄 수 있는 빈티지 무드가 특징이다', 'categoryfashion1409news-245', '2023-08-20', 'Fashion', '["뉴발란스","디스이즈네버댓"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368008382_247170344942590_952441246317965327_n_59ba2e888d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_7b78d1131d.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/thisisneverthat/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디스이즈네버댓</strong></a>과 <a href="https://www.instagram.com/newbalance/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">뉴발란스</strong></a>의 협업 컬렉션이 베일을 벗었습니다. 먼저 선공개된 뉴발란스 클래식 모델 550 브라운 컬러에 이어 라벤더와 그린 컬러가 공개된 것인데요. 90년대 스케이트보드 및 하이킹 신발에서 느낄 수 있는 빈티지 무드를 느낄 수 있는 것이 특징. 특히 라벤더 컬러는 디스이즈네버댓 익스클루시브 제품이라고 하네요. 두 브랜드의 협업 컬렉션은 오는 24일 공개 예정입니다! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368008382_247170344942590_952441246317965327_n_f04957ca22.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367502038_1356541901929752_3124932806165432690_n_32ab58bc68.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/368068652_1617620705414415_7619848443963642704_n_9f0022fe9a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367515363_995174368347601_4324929191700990756_n_938cea3cbb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367908238_3886738148220325_5790465147869178024_n_18e54a455a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367511410_1000468384550863_3781026988414339549_n_2382047489.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367628277_286019504130324_8303529129570940990_n_94db054a5f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367531979_595852879411333_2020822212907093843_n_7a19e950f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367536425_1067772794596102_7007148927843814118_n_d6c401889f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367508864_597117202355658_3757571459008063599_n_be9b9593df.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1409/news/', 'published'),
('클래식은 영원, 피터 도 X 바나나 리퍼블릭 10월 공개', '피터 도와 바나나 리퍼블릭, 두 브랜드 모두의 소비자층이 넓어지는 순간', 'categoryfashion1397news-246', '2023-08-19', 'Fashion', '["피터도","바나나리퍼블릭","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0dd2bd8e85.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_37ee016cc1.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/the.peterdo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">피터 도</strong></a>가 <a href="https://www.instagram.com/bananarepublic/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">바나나 리퍼블릭</strong></a>과의 협업 소식을 알렸습니다. 평소 바나나 리퍼블릭은 클래식하고 베이직한 분위기의 아이템들이 주를 이루기에 피터 도와의 협업이 놀랍다는 반응들이 많은데요. 피터 도의 깔끔한 절개와 테일러링, 그리고 바나나 리퍼블릭의 클래식함이 만나 어떤 디자인과 합리적인 가격을 선보일지 궁금증을 자아냅니다. 이번 캡슐 컬렉션은 10월에 공개될 예정. 올 가을이 기대되는 이유 중 하나가 되겠네요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_cd8b3ea7e0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367367874_154798964316205_2206713775336754226_n_dccc821d38.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367435483_683950673066113_8879035587608075421_n_548efe43bd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367079991_999755514674187_6830970404356925744_n_afcfec8e9e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1397/news/', 'published'),
('젠틀몬스터 X 디바 젠틀 토끼 에디션 팩 출시', '젠틀몬스터와 오버워치2의 협업 아이템과 이벤트 공개', 'categoryfashion1398news-247', '2023-08-19', 'Fashion', '["젠틀몬스터","오버워치","디바","젠틀토끼"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bbb8cf2112.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_acdc5fe6b4.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/gentlemonster/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">젠틀몬스터</strong></a>가 오버워치2 침공 출시를 기념해 인기 캐릭터 디바를 뮤즈로 한 ‘GENTLE TOKKI’ 에디션 팩을 선보였습니다. 두 가지로 선보이는 컬러웨이의 틴티드 선글라스와 젠틀몬스터의 아이덴티티가 반영된 리미티드 게임 스킨으로 구성된 패키지.</p>
<br>
<p style="text-align:left;">8월 31일 자정까지 인스타그램을 통해서 진행되는 필터 챌린지 이벤트를 통해서 당첨자에게 증정되는데요. 이벤트 기간은 오는 31일까지이며, 당첨자들은 젠틀몬스터 오피셜 계정을 통해 9월 4일 개별 DM으로 공지 예정이라고 합니다. 이벤트의 자세한 응모방법은 하단을 참고해주세요!</p>
<br><br>
<p style="text-align:left;">참여방법</p>
<p style="text-align:left;">1. 필터를 사용한 영상/ 이미지를 본인 계정 포스트 혹은 릴스로 업로드</p>
<br>
<p style="text-align:left;">2. 해당 게시물/릴스에 #GENTLEMONSTERXOVERWATCH #GENTLEMONSTER #OVERWATCH2 해시태그 필수</p>
<br>
<p style="text-align:left;">3. 해당 게시물/릴스에 @gentlemonster @playoverwatch 계정 태그 필수</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_7961_2_3e283e71ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_7963_2_35a0bc3cc6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_7964_2_199bfe2124.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/IMG_7960_2_ff1afbd240.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1398/news/', 'published'),
('제니와 정국이 함께 한 캘빈클라인의 2023 가을 캠페인', '독특한 연출과 사운드 트랙을 통해 자신만의 세계관을 표현했다', 'categoryfashion1375news-248', '2023-08-15', 'Fashion', '["제니","정국","캘빈클라인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366581649_704622558161007_216386783052008801_n_3129b40bd3.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a8d8d15c78.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/calvinklein/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">캘빈클라인</strong></a>의 새로운 캠페인에 <a href="https://www.instagram.com/bts.bighitofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">정국</strong></a>과 <a href="https://www.instagram.com/jennierubyjane/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">제니</strong></a>가 모습을 드러냈습니다. 독특한 연출과 사운드 트랙을 통해서 자신만의 세계관을 표현한 모습. 이번 컬렉션은 캘빈클라인의 더 미니멀 하고, 모던하며, 감각적이기까지 한 캘빈클라인의 무드를 느낄 수 있어 더욱 눈길을 끄네요. 캘빈클라인의 2023 가을 컬렉션은 지금 바로 공식 온라인 스토어에서 만나 볼 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366581649_704622558161007_216386783052008801_n_a2a53e1763.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366941009_601157635507166_7063137889541224892_n_6d83b05bde.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367371820_309945971539369_6861985455584173461_n_6d57862fd9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367373128_3210101425954163_4444284873691436126_n_f4277173e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367555786_271030202346010_5308806429963207359_n_719b5fd168.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367385916_188409497580834_2422013007624885001_n_2d1935adcc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367399486_677496157570322_7328821114922651171_n_523673f171.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367412529_112713925236726_7068580123028103661_n_c7c8b435ee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/367367705_869304104624145_1993894020971161251_n_13086df611.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1375/news/', 'published'),
('진짜 이거 맞아? 확실해? 라코스테 x 꼼데가르송 협업 컬렉션', '시그니처 악어를 이용한 귀엽고 키치한 로고 배리에이션이 돋보인다', 'categoryfashion1328news-249', '2023-08-08', 'Fashion', '["라코스테","꼼데가르송","lacoste","comme des garcons"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_9d795347cc.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_239d032693.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/lacoste/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">라코스테</strong></a>와 <a href="https://www.instagram.com/commedesgarcons/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">꼼데가르송</strong></a>이 만나 아이코닉한 디자인으로 등장했습니다. 언뜻보면 정갈해보이는 이번 컬렉션에는 재미난 요소들이 많이 숨어있는데요. 먼저 컬렉션을 전체적으로 살펴보면 어딘가 삐뚤어진 듯 보이는 비대칭 디테일이 돋보이고 있습니다. 이 외에도 전체적으로 새겨진 악어 프린트 버트 다운 셔츠와 점진적으로 커지는  악어 로고 셔츠, 흑백의 확대된 스크린 인쇄 악어 등으로 귀엽고 키치한 무드를 가득 담고 있네요.</p>

<br><br>

<br>

<p style="text-align:left;">자연스럽게 귀여움을 어필하고 싶다면 라코스테와 꼼데가르송의 이번 컬렉션 제품을 시도해보는 건 어떨까요? 해당 제품은 <a href="https://www.instagram.com/doverstreetmarketlondon/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">도버 스트리트 마켓</strong></a>온라인샵에서 바로 구매하실 수 있습니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366697189_18380681677034349_4549618690922421854_n_a0536901f8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363441419_18380681605034349_5190177637027823988_n_ab804d594f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366513560_18380681596034349_4140932238454514717_n_e8392d0977.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366672353_18380681614034349_9072436995970842140_n_481fa0c2ec.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366518523_18380681641034349_7527207901541345104_n_0580325c87.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366688466_18380681632034349_8098696723273912106_n_547c717fa5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366373563_18380681650034349_1232942069016354648_n_96c19aa9fd.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363446994_18380681623034349_3309959476152053137_n_b46f6c6028.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/366374705_18380681668034349_5094892950471482188_n_6e635b64f6.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1328/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('패션 위크에서 포착한 노티카의 스트리트 스타일링', '노티카는 아메리칸 캐주얼 웨어 브랜드로서 스트릿 패션계를 이끌고 있다', 'categoryfashion1319news-250', '2023-08-07', 'Fashion', '["노티카","패션 위크","스트리트 스타일링","nautica","FashionWeek","MFW","PFW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_02884943ae.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3b1574455d.jpg', '<p style="text-align:left;">지난 파리, 밀라노 패션 위크를 통해 확실한 존재감을 증명한 아메리칸 캐주얼 웨어 브랜드 <a href="https://www.instagram.com/nautica.kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">노티카</strong></a>. 2023 F/W 시즌 선공개 상품부터 작년 제품 및 빈티지 제품까지 다양한 제품으로 노티카만의 분위기를 연출했는데요.
<br><br>
노티카는 프레피 문화와 바다에서 얻은 영감을 바탕으로 현재 뉴욕과 도쿄에서 선보이는 시티보이 콘셉트를 통해 스트릿 패션계를 이끌고 있습니다. 스크롤을 내려 파리, 밀라노 패션 위크 스트리트에서 포착한 노티카만의 무드를 느껴 보세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_e3e5236eae.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ef067cc72a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_d9e4110167.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4a36b2ae32.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_236f939168.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_ee5e2b2e5e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_c8a486b4ad.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_5b6c24681c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_bdd6ce4888.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_0c3d20380e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1319/news/', 'published'),
('퀸카는 지미추를 입는다, 미연 지미추 글로벌 앰배서더 발탁', '아이들의 미연이 지미추의 글로벌 앰배서더로 선정됐다', 'categoryfashion1275news-251', '2023-08-01', 'Fashion', '["미연","지미추","앰배서더"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_97ca195bdb.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_91196c1550.jpg', '<br>

<p style="text-align:left;">아이들의 <a href="https://www.instagram.com/noodle.zip/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미연</strong></a>이 <a href="https://www.instagram.com/jimmychoo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지미추</strong></a> 글로벌 앰배서더로 선정되었습니다. 지미추는 대담하고 화려한 미학을 바탕으로 브랜드를 전개해나가고 있어 미연의 이미지와 무척 잘 어울리는데요. 최근 미연은 지미추 컬렉션 쇼에 참석, 지미추의 아이템을 자주 착용하는 모습을 보여주어 앰배서더에 대한 암시가 아니냐는 추측이 있었습니다. 그녀는 8월 중 런칭하는 지미추의 23 가을 컬렉션부터 활동할 것으로 알려졌는데요. 지미추와 미연의 화려한 만남이 어떤 식으로 표현될지, 벌써 아름다운 이미지가 눈앞에 그려지는 듯합니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/c0df6e73_ace8_477d_8fd8_b229f1e90055_3c5b78d673.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1275/news/', 'published'),
('포스트 아카이브 팩션의 다음 정착지, 더현대 팝업 스토어 오픈', '오는 8월 한 달 동안 팝업 스토어를 오픈할 예정이다', 'categoryfashion1263news-252', '2023-07-31', 'Fashion', '["파프","포스트아카이브팩션"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/359310334_18293548102119135_2699543184005857837_n_1c8598e973.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_b4a58912c6.jpg', '<br>

<p style="text-align:left;">최근 룸스케이프 청음회를 성공적으로 마친 <a href="https://www.instagram.com/postarchivefaction/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포스트 아카이브 팩션</strong></a>이 오는 8월도 숨가쁘게 달릴 예정입니다. 더현대 서울에서 팝업 스토어를 오픈하는 것인데요. 파프 아카이브 컬렉션부터 룸스케이프 기념 MP3와 티셔츠까지. 일부 품목은 할인 이벤트도 예정 중에 있다고 하네요. 소량 발매 예정이라고 하니 서둘러 방문하시는 것을 추천드립니다. </p>

<br>

<p style="text-align:left;">일시: 2023.08.01 (화) ~ 2023.08.31 (목)</p>
<p style="text-align:left;">시간: 10:30 AM ~ 8:00 PM (월-목) / 10:30 AM ~ 8:30 PM (금-일)</p>
<p style="text-align:left;">장소: 서울특별시 영등포구 여의대로108, 더현대 서울 2층</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363451843_18296139196119135_5200131946453029581_n_9978c0b3b9.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1263/news/', 'published'),
('데님 걸작과 애니 걸작의 만남, 리바이스 x 모노노케 히메 컬렉션', '리바이스가 스튜디오 지브리의 모노노케 히메에게 바치는 찬사', 'categoryfashion1246news-253', '2023-07-28', 'Fashion', '["리바이스","levis","모노노케 히메","원령공주"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_2a0638cce8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_dce00235df.jpg', '<center>

</center>

<br>

<p style="text-align:left;">패퍼들이 가장 좋아하는 <a href="https://www.instagram.com/ghibliusa/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">스튜디오 지브리</strong></a>의 애니메이션은 무엇인가요? <a href="https://www.instagram.com/levis/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">리바이스</strong></a>의 대답은 ‘모노노케 히메’인지도 모르겠습니다. 그들은 이 애니메이션의 매혹적인 테마에서 영감을 받은 협업 컬렉션을 만들어냈는데요. 산&울프 트러커 자켓, 아시타카 진, 산&모로 쇼츠 등의 데님 라인 뿐만 아니라 나이트워커 데님 기모노 자켓과 고다마 데님 오버롤 등 일본 특유의 오래된 디자인에 어두운 인디고 컬러를 입힌 제품들은 영화의 분위기를 더욱 느낄 수 있게 하죠. 또한 그래픽 티셔츠와 후드티는 캐릭터의 이미지와 대사를 입혀 해당 애니메이션에 대한 영감과 경의를 느낄 수 있다고 합니다. 해당 컬렉션은 오는 8월 10일 리바이스 공식 웹사이트와 전세계 일부 리바이스 매장에서 만나볼 수 있다고 하네요. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_1_1_7d830c7547.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_4_e551eb01b4.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_3_5334707e20.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_1_032bd74b78.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_1_2_a44d936bee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_1_fdefafd421.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_10_22f41c8339.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_2_d9e7c781f9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_83dd6d06ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_5_88858b1715.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_6_f3bd162009.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_7_bc9b0d38f4.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_8_3b165c9d89.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_12_b6b4c6dcf4.avif","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_image_2023_07_levis_studio_ghibli_princess_mononoke_collaboration_collection_release_info_11_f50165f3e2.avif"]'::jsonb, '[]'::jsonb, '/category/Fashion/1246/news/', 'published'),
('앰부쉬와 나이키의 WWC 헌정 컬렉션', '메탈릭한 볼과 축구 저지가 이번 컬렉션을 빛낸다', 'categoryfashion1220news-254', '2023-07-26', 'Fashion', '["앰부쉬","나이키","wwc"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_f394ade3cc.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8b45b2abe4.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/nike/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나이키</strong></a>와 <a href="https://www.instagram.com/ambush_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">앰부쉬</strong></a>의 WWC 2023 컬렉션이 오는 8월 4일 런칭됩니다. 앰부쉬는 공식 인스타그램을 통해 이번 컬렉션에 포함된 아이템으로 유니섹스 축구 저지 탑과 축구공을 공개했는데요. 강인한 여성상과 어울리는 디자인으로 눈길을 끌었습니다. 앰부쉬가 나이키의 스포티함을 입어 더욱 트렌디해진 모습이네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363367777_18376349827011369_5461308800456461771_n_d8ab8f783e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363388167_18376291351011369_6238850284692562088_n_618a08ad2a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1220/news/', 'published'),
('치즈를 닮은 빅 옐로우 부츠, 8월 9일 정식 발매', '토미 캐시와 패리스 힐튼의 뒤를 이을 주인공은 누구?', 'categoryfashion1218news-255', '2023-07-25', 'Fashion', '["미스치프","빅옐로우부츠","패리스힐튼"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a3fc94f3b5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_750d66d4c3.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/tommycashworld/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">토미 캐시</strong></a>의 노란 부츠로 눈길을 끌었던 <a href="https://www.instagram.com/mschf/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미스치프</strong></a>와 <a href="https://www.instagram.com/crocs/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">크록스</strong></a>의 빅 옐로우 부츠가 8월 9일 출시를 확정지었습니다. 통통 튀는 이미지에 <a href="https://www.instagram.com/parishilton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">패리스 힐튼</strong></a>이 노란색 바디수트로 부츠와 룩을 맞춘 모습이 인상적. 과연 이번 발매 이후 토미 캐시와 패리스 힐튼보다 더 눈에 띄는 부츠의 임자가 나타날까요?</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/362681436_18391525897047688_1887588531382388183_n_e5b635f164.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/362680105_18391525879047688_5110660257544927910_n_d68301185b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/362294124_18391525870047688_1569684566109271067_n_82ca7581f1.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363355559_18391525888047688_5818017499989989785_n_eefc3e3b04.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/363367726_18391525861047688_8007527734953405583_n_5a1abdb603.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1218/news/', 'published'),
('프라다의 소셜 클럽인 ‘프라다 모드’가 한국에서 처음으로 개최된다', '세계적인 예술가와 문화인들이 모여 예술과 문화를 공유하는 축제이다', 'categoryculture1217news-256', '2023-07-25', 'Culture', '["프라다모드","프라다"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c2da437491.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_62d23d1261.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/prada/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">프라다</strong></a>가 오는 9월 5-6일, 프리즈 서울 기간에 맞춰 문화 공간 <a href="https://www.instagram.com/kote.kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">코트(KOTE)</strong></a>에서 제 10회 프라다 모드를 개최하고, ‘다중과 평행’전을 선보입니다. 영화계에서 존경받는 세 감독의 저마다 독특한 시선으로 현대 사회에 대한 영화적 비전을 제시하며, 코트의 전시 공간을 배경으로 구상한 설치 작품을 감상할 수 있는 좋은 기회가 될 것 같은데요.</p>

<br>

<p style="text-align:left;">프라다 모드는 프라다가 전 세계를 돌며, 특정 도시의 예술 문화를 다루는 소셜 클럽입니다. 세계적인 예술가와 디자이너, 문화인들이 모여 예술과 문화를 공유하는 축제로 알려져 있죠.</p>

<br>

<p style="text-align:left;">프라다 모드 서울의 무대가 되는 코트 또한 다양한 세계관을 탐험할 수 있는 다차원적 공간으로 탈바꿈할 예정이라고 하네요. 미식 문화, 부재, 죽음에 대한 질문이 담긴 각자의 비전을 코트의 여러 건물들을 넘나들며 구현할 것이라고 합니다. 프라다 모드 서울을 통해 복합 문화 공간인 코트의 깊이와 다채로움을 경험해 보세요!</p>

<br>

<p style="text-align:left;">일시: 2023.09.05 (화) ~ 2023.09.06 (수)</p>
<p style="text-align:left;">시간: 10:00 AM ~ 7:00 PM</p>
<p style="text-align:left;">장소: 서울특별시 종로구 인사동길7, 인사동 코트</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Prada_Mode_Seoul_Key_Visual_30e2e94bf8.png"]'::jsonb, '[]'::jsonb, '/category/Culture/1217/news/', 'published'),
('푸마, 맨체스터 시티 FC 방한 기념 ‘푸마 시티’ 팝업 스토어 오픈', '28일부터 30일까지 잠실 롯데월드몰에서 팝업 스토어를 만나 볼 수 있다', 'categoryculture1214news-257', '2023-07-25', 'Culture', '["푸마","맨시티","맨체스터시티"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_bc6d6a6206.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_1_dcc6a49cac.png', '<br>

<p style="text-align:left;">글로벌 스포츠 브랜드 <a href="https://www.instagram.com/puma_kr/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">푸마</strong></a>가 오는 28일부터 30일까지 잠실 롯데월드몰에서 <a href="https://www.instagram.com/mancity/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">맨체스터 시티</strong></a> 콘셉트의 ‘푸마 시티(PUMA CITY)’ 팝업 스토어를 오픈합니다. 또한 국내 맨시티 팬과 소비자들을 위한 다채로운 이벤트도 준비되어 있는데요. </p>

<br><br>

<br>

<p style="text-align:left;">오는 29일(토)에 잭 그릴리쉬, 에데르송 모라에스, 마누엘 아칸지 등 맨시티의 대표 선수들과 맨체스터 시티 FC 위민 소속인 라이아 알레익산드리 그리고 맨체스터 시티 FC U-23 팀인 EDS의 유망주인 오스카르 보브로 구성된 선수단이 팝업 스토어에 방문 예정이라고 합니다. 다음 날인 30일(일)에는 맨시티의 전설적 선수인 졸리언 레스콧과 션 라이트 필립스가 방문한다고 하네요.</p>

<br><br>

<br>

<p style="text-align:left;">푸마는 팝업 운영 기간 중 축구 크리에이터 모임인 CFC와 개발한 폰트가 마킹된 ‘스페셜 폰트 저지''를 한정 수량으로 선보인다고 하니 이또한 놓치지 마세요!</p>

<br>

<p style="text-align:left;">일시: 2023.07.28 (금) ~ 2023.07.30 (일)</p>
<p style="text-align:left;">시간: 10:30 AM ~ 10:00 PM</p>
<p style="text-align:left;">장소: 서울특별시 송파구 올림픽로300, 롯데월드몰</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_1_5e1c9ddd85.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_2_237534ff20.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/Node_3_c8312564a5.png"]'::jsonb, '[]'::jsonb, '/category/Culture/1214/news/', 'published'),
('데님 러버들 주목! EB데님 23 프리폴 컬렉션 공개', '몽환적인 무드와 빈티지한 색감이 어우러진 컬렉션', 'categoryfashion1154news-258', '2023-07-15', 'Fashion', '["eb데님","프리폴","컬렉션"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_761b12404c.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_43d2e077d9.jpg', '<br>

<p style="text-align:left;">빈티지한 데님의 매력을 추구하는 <a href="https://www.instagram.com/ebdenim/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">EB데님</strong></a>이 23 프리폴 컬렉션을 공개했습니다. 몽환적인 무드가 가득한 이번 컬렉션에는 절개 라인과 빈티지한 색감이 특히 잘 드러나 보였는데요. 이에 더해 로우라이즈와 레이스업 디테일이 더해진 팬츠가 눈에 띄는 포인트. 컬렉션 이미지는 전반적으로 로맨틱하면서도 신비로운 분위기를 연출했습니다. 이 제품들은 현재 EB데님의 홈페이지에서 만나볼 수 있으니, 데님 러버 걸들은 지금 바로 접속하세요!</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_wp_content_blogs_dir_6_files_2023_07_eb_denim_pre_fall_collection_lookbook_where_to_buy_07_304374c701.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_wp_content_blogs_dir_6_files_2023_07_eb_denim_pre_fall_collection_lookbook_where_to_buy_01_c7c7b7354b.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_wp_content_blogs_dir_6_files_2023_07_eb_denim_pre_fall_collection_lookbook_where_to_buy_02_55a5b33aa6.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_wp_content_blogs_dir_6_files_2023_07_eb_denim_pre_fall_collection_lookbook_where_to_buy_04_98c54e0f78.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/https_hypebeast_com_wp_content_blogs_dir_6_files_2023_07_eb_denim_pre_fall_collection_lookbook_where_to_buy_05_01615b6f73.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1154/news/', 'published'),
('마음과 소재가 만나다, 강혁과 크록스 협업', '레드 스티치와 익스클루시브 지비츠가 포인트', 'categoryfashion1136news-259', '2023-07-11', 'Fashion', '["강혁","크록스","협업"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_0b139a9047.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_01c455541f.jpg', '<br>

<p style="text-align:left;">습하고 더운 여름 날씨에 제격인 <a href="https://www.instagram.com/crocs/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">크록스</strong></a>가 브랜드 <a href="https://www.instagram.com/_kanghyuk/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">강혁</strong></a>과의 협업 소식을 알렸습니다. 강혁 특유의 에어백을 닮은 디자인 아이덴티티와 크록스의 편안한 착용감이 만나 실용성과 디자인을 모두 잡은 이번 협업 제품. 레드 스티치 포인트와 단독 발매되는 지비츠로 분더샵 청담점에서 19일까지 유니크한 크록스를 만나볼 수 있습니다. 휴가철 물놀이 필수템 크록스, 강혁의 디자인으로 도전해보는 건 어떨까요?</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/f34c84db_a6ae_49e3_ba39_44ce644a2261_232_425e22c9c9.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/31024961_5785_470f_b702_12f0d30c2c40_229_10287146e2.jpeg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1136/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('웍스아웃이 20주년을 맞아 오픈 YY와 특별한 만남을 가진다', '키 아이템은 타이포 그래픽과 브랜드 로고가 포인트인 저지 반팔 티셔츠다', 'categoryfashion1137news-260', '2023-07-11', 'Fashion', '["웍스아웃","오픈와이와이","오픈YY"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/359021796_1312296499637232_5365186097571292020_n_61f6305f60.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_1166992ad2.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/worksout_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">웍스아웃</strong></a>이 브랜드 창립 20주년을 기념하여 <a href="https://www.instagram.com/openyy_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오픈 YY</strong></a>와 협업 제품을 발매합니다. 키 아이템이 될 20주년을 표현한 타이포 그래픽과 브랜드 로고가 포인트인 저지 반팔 티셔츠는 총 2가지 사이즈와 컬러로 출시될 예정이라고 하네요. 웍스아웃과 오픈 와이와이의 협업 제품은 오는 12일 부산 신세계 백화점을 시작으로 홍대, 압구정 라이즈 스토어, 온라인 스토어까지 순차적으로 발매될 예정이라고 하니 놓치지 마세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/359021796_1312296499637232_5365186097571292020_n_dc0c38f4e9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/359205259_6492169660897806_7593146346873386554_n_1fa1b60ef3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/358519052_1313668096242777_3018948187192837458_n_0074b54c8e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/358769913_1347629372849085_5682231348124012136_n_cf9634c739.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/358793861_575801418054507_1342329986474188776_n_7c45de414f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/358344392_197238923315349_1361117250935474218_n_8a8fc86ebf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/359475996_3272563012982927_979595087307622684_n_72adf580ab.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/359184035_960383448582640_1434588578057673789_n_403e01b4d0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/358536464_2138733999658912_6672844603998214768_n_25e3502385.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1137/news/', 'published'),
('마르디 메크르디, 롯데월드몰에 첫 번째 꽃을 피우다', '마르디의 컬렉션과 포켓몬 협업도 만나볼 수 있다', 'categoryfashion1083news-261', '2023-06-28', 'Fashion', '["마르디메크르디","잠실","롯데월드몰","오픈"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_fe621cef36.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_a4d41042a8.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/mardi_mercredi_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">마르디 메크르디</strong></a>의 꽃이 롯데월드몰에 활짝 피어났습니다. 마르디 메크르디가 롯데월드몰점에 첫 매장을 오픈해 오프라인으로 더 쉽게 만나볼 수 있게 되었는데요. 이 스토어에서는 매일 780개, 총 2340개의 선물을 증정하는 3일간의 스페셜 이벤트도 준비되어 있다고 합니다. 마르디 메크르디의 시그니처 플라워가 잔뜩 수놓아진 상품들과 귀여운 포켓몬 협업까지, 여름과 잘 어울리는 마르디 메크르디의 다양한 상품들을 가까이에서 만나보세요!</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/1083/news/', 'published'),
('파리패션위크와 함께한 송지오의 30주년 기념 컬렉션', '30주년 기념 리복과 함께 선보이는 ‘클럽C 레거시 컬렉션 슈즈’도 공개됐다', 'categoryfashion1084news-262', '2023-06-28', 'Fashion', '["파리패션위크","송지오","30주년","리복"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_552c49e2eb.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_40ecbff861.jpg', '<p style="text-align:left;">한국을 대표하는 디자이너 브랜드인 송지오가 지난 23일 파리 패션 위크에서 브랜드 30주년을 맞아 24SS 컬렉션을 공개했습니다. ‘PURE REBEL’이라는 주제로 선보인 이번 컬렉션은 하우스의 다채로운 테크니컬 디자인을 더한 아트 패션이라고 할 수 있는데요. 특히 가로 세로로 커팅된 여러 겹의 원단을 교차로 이어 만든 아트 피스들이 시선을 사로잡습니다. 소년의 꿈, 연인과 사랑, 예술가의 고뇌가 담긴 이번 시즌.</p>

<br><br>

<br>

<p style="text-align:left;">이 컬렉션에서는 무겁고 질감이 강한 원단과 매우 가볍고 부드러운 원단을 함께 활용하여 다채로운 실루엣과 볼륨을 확인할 수 있는데요. 브랜드만의 정체성인 블랙과 함께 베이지, 아이보리, 크림 등 소프트한 컬러와 시그니처 포인트 컬러인 페일 라임과 살몬 핑크를 조화롭게 사용하여 화사하면서도 우아한 색조가 돋보입니다.</p>

<br><br>

<br>

<p style="text-align:left;">함께 착용한 악세서리에서도 플레이팅 디테일과 꾸뛰르 메이킹을 선보이며, 여러 겹의 가죽을 커팅하여 디자인한 숄더백과 파우치, 플레이팅 더비와 리본 로퍼 등이 송지오만의 미학을 더욱 견고하게 해주는 듯합니다. 특히 30주년을 기념하여 리복과 함께 선보이는 ‘클럽C 레거시 컬렉션 슈즈’는 윙 슈즈라는 타이틀로 디자인되었으며, 송지오의 입체적인 시그니처 윙 디자인과 멀티 플레이팅 디자인을 결합하여 의미를 더하였습니다.</p>

<br><br>

<br>

<p style="text-align:left;">또한, 이번 파리 패션 위크에 송지오의 오랜 뮤즈인 배우 겸 모델 배정남이 참석해 브랜드의 역사적인 순간을 함께 했는데요. 뿐만 아니라 유명 인플루언서와 현지 셀럽, 해외 바이어를 포함한 500명이 넘는 게스트들이 대거 참석해 자리를 빛내 주었다고 합니다. K-패션의 위상을 떨치고 있는 송지오의 30주년, 앞으로도 국내외로 패션계를 사로잡을 브랜드임이 확실한 것 같습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_0d02fb82ca.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_98c4fcd9f4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_bafea81c91.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_48217b2201.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_6cb15c7c7f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_cbbea565b2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_002ac59b91.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_7b045a63d3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_b670f0a74a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_6751acb0a0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/11_7803dedb75.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_98b2560705.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/13_9815cdebea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_0d11dc0c06.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1084/news/', 'published'),
('부쉐론의 최초 한국인 앰버서더로 한소희가 발탁됐다', '한소희는 7월 파리에서 열리는 메종 부쉐론 프레젠테이션에 참석 예정이다', 'categoryfashion1075news-263', '2023-06-27', 'Fashion', '["한소희","부쉐론"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/355819216_1110373276587551_4721950981298529179_n_437999603b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_c47cf2875d.jpg', '<br>

<p style="text-align:left;">배우 <a href="https://www.instagram.com/xeesoxee/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">한소희</strong></a>가 <a href="https://www.instagram.com/boucheron/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">부쉐론</strong></a>의 새 얼굴이 됐습니다. 스타일리시한 프랑스 하이 주얼리 브랜드인 부쉐론의 최초 한국인 앰버서더로 발탁된 것인데요. 부쉐론은 한소회가 늘 독창적이면서 대담하고, 부쉐론이 추구하는 자유로운 가치 정신과 맞닿은 인물이라고 소감을 전했습니다. </p>

<br>

<p style="text-align:left;">한소희는 오는 7월 파리에서 열리는 메종 부쉐론 프레젠테이션에 참여할 예정이라고 하네요. 한소희는 올 하반기에 넷플릭스 시리즈인 ‘경성크리처’ 공개를 앞두고 있는데요. 앞으로가 더욱 기대되는 배우인 것 같습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/355819216_1110373276587551_4721950981298529179_n_6878cda2e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/355824879_222883230565924_629469861070592311_n_78d6e877c1.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1075/news/', 'published'),
('포스트 아카이브 팩션, 6.0 컬렉션 공개', '형태와 기능의 관계를 탐구하고 한계를 실험하는 과정', 'categoryfashion1041news-264', '2023-06-20', 'Fashion', '["파프","포스트아카이브팩션","컬렉션","패션위크"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_8e2b9a3c30.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_aab840a7f4.jpg', '<br>

<p style="text-align:left;">아카이브의 진화, 그리고 구조와 해체에 초점을 맞추어 컬렉션을 선보이는 <a href="https://www.instagram.com/postarchivefaction/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포스트 아카이브 팩션 (파프)</strong></a>. 24S/S 시즌을 맞아 6.0 컬렉션을 공개했는데요. 이번 컬렉션은 형태와 기능의 관계를 탐구하고 한계를 실험하는 과정으로 제작됐습니다.</p>
<br>
<p style="text-align:left;">조형성과 기능성에 있어서도 이전 컬렉션들보다 발전된 모습을 보여주는데요. 테크니컬 의류 외에도 드레스와 악세서리 등을 새롭게 구성해 이목을 집중시킵니다. 이는 밀라노 패션위크와 파리 패션위크에 초대된 인원에게만 특별 공개된다고 하며, 특히 파리에서는 스포츠 브랜드와의 협업 제품도 만나볼 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_36e1185ece.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_2898938cbc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/14_af604e497c.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/15_022c3a983a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/39_48986396c9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/17_6b0a4bc3b7.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/32_f85032ed3b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/62_57186ef12d.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/1041/news/', 'published'),
('오프화이트 2024 리조트 컬렉션 ‘홈커밍’ 공개', '이번 컬렉션의 핵심은 오프화이트의 기본으로 돌아가는 것', 'categoryfashion998news-265', '2023-06-12', 'Fashion', '["오프화이트","컬렉션","24SS","24FW"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1350_2ff440e268.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/675_6d8e2e8d06.jpg', '<br>

<p style="text-align:left;">스트리트 문화의 영감을 재해석한 이탈리안 패션 브랜드 <a href="https://www.instagram.com/off____white/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">오프화이트</strong></a>가  새로운 2024 컬렉션을 공개했습니다. 디렉터 <a href="https://www.instagram.com/ibkamara/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이브라힘 카마라</strong></a>는 ‘홈커밍’이라는 이름으로 공개된 이번 컬렉션의 핵심은 오프화이트의 기본으로 돌아가는 것이었다고 하는데요. 21세기 세계화의 힘, 디지털 디아스포라 등을 표현하고 싶었다고 덧붙였습니다.</p> 

<br> <br>

<br>

<p style="text-align:left;">버팔로 핀 스트라이프가 새겨진 웨스턴 테일러링, 리브 저지와 레이스 소재의 조끼, 마이클 조던의 등번호 23이 새거진 스포티한 그로그랭 스트라이프 테일러링 등 장난기 가득하면서도 아이코닉한 룩을 만나볼 수 있는데요. 이번 컬렉션을 살펴보니 창립자 <a href="https://www.instagram.com/virgilabloh/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">버질 아블로</strong></a>가 추구하는 기본에 충실하면서도 더 넓은 문화를 담고자한 그의 의도가 가득 묻어있는 듯 하네요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_56fc123244.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_4bbdf691ae.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_8939848ef8.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_29922c9a34.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_2f71c9896e.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_a5f47954b8.webp","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_aa746e6a14.webp"]'::jsonb, '[]'::jsonb, '/category/Fashion/998/news/', 'published'),
('피에이피X엄브로의 클로그 프로젝트  ‘A PIECE OF CLOG’', '신발이 먹음직스러운 케이크로 변하는 재밌는 상상을 해본 적 있나요?', 'categoryfashion905news-266', '2023-05-22', 'Fashion', '["엄브로","그린","김뜻돌","오메가사피엔"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_2a01537513.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_035e1b4f11.jpg', '<p style="text-align:left;">어느 날, 신발이 먹음직스러운 케이크로 변하는 재밌는 상상을 해본 적 있나요? </p>

<br><br>

<center>

</center>

<br>

<p style="text-align:left;">덩그러니 놓인 이상한 물체와 갑작스레 마주한 야생의 오메가 사피엔. 
<br><br>
생전 처음 보는 듯한 물체를 본 그의 반응이 예사롭지 않은데…
<br><br>
&#60;피에이피&#62;와 엄브로 코리아가 함께 펼쳐낸 클로그 시리즈를 지금 영상으로 확인하세요.</p>

<br><br><center>

</center>

<br>

<p style="text-align:left;">음악적 영감을 찾기 위해 더 넓은 세계로 떠난 김뜻돌이 만난 클로그 케이크. 
<br><br>
케이크를 맛본 그녀는 자신만의 솔직하고도 용감한 세계를 펼쳐내기 시작하는데…
<br><br>
&#60;피에이피&#62;와 엄브로 코리아가 함께 펼쳐낸 클로그 시리즈를 지금 영상으로 확인하세요.</p>

<br><br><center>

</center>

<br>

<p style="text-align:left;">포크, 나이프와 함께 테이블 위에 뜬금없이 올려진 클로그 케이크.
<br><br>
성큼성큼 걸어온 그린이 동그란(?) 주문을 걸자 케이크가 서서히 변하기 시작하는데…
<br><br>
&#60;피에이피&#62;와 엄브로 코리아가 함께 펼쳐낸 클로그 시리즈를 지금 영상으로 확인하세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_712174791f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_ed8ee2c3e4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e695f073f3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_2f1c230f6f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_3f350e5fc8.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_f1fdfe3443.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_f83e95b760.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_e56f7221d8.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_6696ed6df5.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_cad13a9ea3.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_e3bb5dac79.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_89dbe9e094.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_af350212ee.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_ba724a9f9e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_429f4dd39a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_5cf02e3a77.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_be6462564e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/905/news/', 'published'),
('요지 야마모토X아디다스의 AJATU 하이탑 재출시', '두툼한 고무 아웃솔과 과감한 지퍼 라인, 신발 혀의 Y-3 로고가 포인트', 'categoryfashion893news-267', '2023-05-15', 'Fashion', '["요지 야마모토","아디다스","하이탑"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_d7b0e6b913.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_1134b75245.jpg', '<br>

<p style="text-align:left;">첫 발매 20주년이 지난 지금까지도 많은 사랑을 받고 있는 요지 야마모토와 아디다스의 협업 컬렉션 Y-3. 그중에서도 AJATU 하이탑을 재발매했습니다. 요지 야마모토가 추구하는 특유의 아방가르드함과 캐주얼하고 청키한 무드가 섞인 것이 포인트인데요. 
<br><br>
두툼한 고무로 이루어진 아웃솔과 신발에 둘러진 지퍼, 신발 혀에 있는 Y-3 로고가 빈티지함을 더해 눈길을 끕니다. 그동안 큰 인기를 끌었던만큼 이번 재발매도 아디다스에 호황을 가져올 것으로 기대됩니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d7d636c981.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/893/news/', 'published'),
('더욱 더 다채로워진 라인업, 엘엠씨와 카카오 프렌즈의 두 번째 만남', '4월 14일, 엘엠씨와 카카오 프렌즈 공식 온라인 스토어에서 공개된다', 'categoryfashion760news-268', '2023-04-11', 'Fashion', '["엘엠씨","카카오 프렌즈"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_23ae0524d2.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_a511711314.png', '<br>

<p style="text-align:left;">엘엠씨와 카카오 프렌즈가 두 번째 협업을 예고했습니다. 첫 번째 협업에서는 두 브랜드를 대표하는 캐릭터인 ‘LMC 베어’와 카카오 프렌즈의 ‘춘식이’, ‘라이언’의 만남으로 캐릭터의 중점을 둔 비주얼을 보여 줬다면 이번에는 더욱 다채로워진 라인업을 선보일 예정. S/S를 맞이하여 반팔 티셔츠, 러기지 태그, 여권 케이스, 피규어 키링, 휴대폰 케이스까지 나들이와 여행이 많은 계절인 만큼 선택의 폭이 한층 넓어졌습니다. 엘엠씨와 카카오 프렌즈의 두 번째 협업 제품은 오는 4월 14일 오후 1시부터 엘엠씨, 카카오 프렌즈 공식 온라인 스토어를 통해 구매 가능합니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_3464fa5efb.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/760/news/', 'published'),
('반스, 하리보 100주년 기념 협업 컬렉션 출시 예정', '“하리보의 팬들이 달콤한 사탕 가게에 온 것 같은 느낌을 줄 것이다.”', 'categoryfashion702news-269', '2023-03-07', 'Fashion', '["반스","하리보"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000000000000_e8f80f9567.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000000_43b1b328b6.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/vans/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">반스</strong></a>가 <a href="https://www.instagram.com/haribousa/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">하리보</strong></a>의 100주년을 기념해 협업 컬렉션을 선보입니다.
<br><br>
이번 컬렉션은 클래식 슬립온, 스냅백 등의 키즈 제품들과 페이턴트 가죽으로 된 벨크로 올드스쿨, 스케이트 하이 등의 아이템으로 구성되어 남녀노소 모든 연령대가 즐길 수 있도록 한 모습. 하리보의 글로벌 마케팅 부사장인 안드레 쿤데(Andreas Kuhnle)는 "하리보는 어린아이 같은 행복함의 순간이다. 이번 협업은 하리보의 팬들이 달콤한 사탕 가게에 온 것 같은 느낌을 줄 것이다."라고 소감을 전했습니다. 두 브랜드의 협업은 다가오는 4월 6일에 발매될 예정.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_df80804f96.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_117c27c25c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_a60b7ed27e.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_ed2955adc2.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_a08fa5824b.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/702/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('<달의 요정 세일러문> 창간 30주년 기념, 지미 추와 협업 컬렉션 발매', '세일러문 부츠, 시그니처 지미추 킥-힐, 초승달 실루엣의 크리스탈 보석 등', 'categoryfashion642news-270', '2023-02-07', 'Fashion', '["세일러문","지미 추"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_d359b5c345.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_6d36cb07f0.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/jimmychoo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지미추</strong></a>가 &#60;달의 요정 세일러문&#62;과 만납니다. &#60;달의 요정 세일러문&#62; 창간 30주년을 기념해 지미추의 크리에이티브 디렉터 산드라 초이와 세일러문의 작가 나오코 타케우치가 협력해 대담한 개성, 시대정신을 정의하는 이미지를 보여주는 컬렉션을 꾸린 것인데요. <달의 요정 세일러문>의 핵심인 소녀만화의 여성성과 파워가 전체적으로 녹아들었으며, 에너지틱한 모습을 선보였습니다.

만화의 핵심 캐릭터인 ‘달의 요정’을 주제로 한 신발과 악세서리 등으로 구성된 이번 컬렉션은 익스클루시브 제품으로 주문 제작된 한정판 세일러문 부츠, 시그니처 지미추 킥-힐, 초승달 모양의 세일러 크리스탈 보석 등이 등장했으며 아트워크와 사운드 트랙 또한 포함됩니다.

오는 2월 14, 15일에 도쿄와 영국부터 발매가 시작될 예정입니다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a046e2a9bb.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_7f181ad419.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_e2b4cf8728.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_15ba1b600e.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_07804cf49e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/642/news/', 'published'),
('스투시x테클라, 세 번째 협업 컬렉션 선보인다', '한층 두터워진 관계로 공유된 문화적 관심에 대한 약속을 탐구한다', 'categoryfashionlife613news-271', '2023-01-25', 'Fashion,Life', '["스투시","테클라"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_ec176e0a8b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_41d4bf8b94.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/stussy/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">스투시</strong></a>와 <a href="https://www.instagram.com/teklafabrics/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">테클라</strong></a>의 세 번째 협업이 공개됩니다. 이번 협업은 가정과 해변을 위한 잠옷, 침구 등으로 이루어져 있으며, 그들은 한층 두터워진 관계를 통해 공유된 문화적 관심과 품질에 대한 약속을 더욱 탐구할 것이라고 전했습니다. 수채화 효과가 있는 생동감 넘치는 베리 색상의 잠옷과 침구는 물론 블랙・내추럴 스트라이프의 후드 목욕 가운, 핸드메이드 프린팅 모티프의 한정 상품의 재발매도 포함된 모습. 1월 27일 금요일부터 스투시와 테클라 공식 웹사이트, 스투시 챕터 매장 및 일부 도버 스트릿 마켓에서 독점 판매됩니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_5de94b6e97.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Life/613/news/', 'published'),
('방탄소년단 지민, 디올 새로운 앰버서더 선정', '평소에도 디올 제품을 즐겨입었던 지민을 놓치지 않았다', 'categoryfashion584news-272', '2023-01-16', 'Fashion', '["지민","디올","방탄소년단"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3a87e37472.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_30db1e3456.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/bts.bighitofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">방탄소년단</strong></a>의  <a href="l/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">지민</strong></a>이 <a href="https://www.instagram.com/dior/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">디올</strong></a>의 새로운 앰버서더로 선정됐습니다. 평소에도 디올 제품을 즐겨 입었던 지민인 만큼 둘의 조합이 더욱 기대되는데요. 추후 지민과 디올이 선보일 소식들은 <피에이피>에서 확인해보세요! </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/_3ea1346e91.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/584/news/', 'published'),
('살레헤 벰버리x클락스 ‘머드 모스 러거’ 출시', '팔팔 끓는 냄비 속에서 탄생한 그들의 스니커즈?', 'categoryfashion563news-273', '2023-01-10', 'Fashion', '["살레헤 벰버리","클락스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_aee5bbaca0.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_97eec70060.jpg', '<p style="text-align:left;">스니커즈 디자이너 살레헤 벰버리와 클락스의 협업 아이템, ‘머드 모스 러거’가 등장했습니다. 끓는 냄비 속에서 탄생한 스니커즈의 모습을 위트 있는 영상과 함께 업로드하며 더욱 아이코닉한 모습을 선보였는데요. </p>

<br><br>

<br>

<p style="text-align:left;">오렌지, 그린, 그레이 3가지 색상으로 구성되었으며 독특한 질감의 스웨이드 소재를 더해 살레헤 벰버리와 클락스의 아이덴티티를 모두 녹여냈습니다. 
1월 20일 출시 예정. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_4bd8a94166.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_4239deae2f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_07c05e7f76.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/563/news/', 'published'),
('엠부쉬x리바이스 두 번째 협업 컬렉션 출시', '패널 디테일의 배기진, 워싱 데님 패치 포인트의 데님 재킷, 스터드 벨트 등', 'categoryfashion552news-274', '2023-01-06', 'Fashion', '["엠부쉬","리바이스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b46f062fd7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_4726d3bf9a.jpg', '<br>

<p style="text-align:left;">엠부쉬와 리바이스의 두 번째 협업 컬렉션이 출시됩니다. 지난 9월 재킷과 청바지로 구성된 첫 번째 협업에 이어 더욱 아이코닉한 모습이 보이는데요. 패널 디테일의 배기진은 물론 데님 패치를 포인트로 한 데님 재킷, 스터드 벨트 등으로 예상됩니다.
<br><br>
1월 12일 글로벌 출시되며, 국내에는 리바이스 현대판교점에서 단독 판매됩니다.  </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a275e699e6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_b0ad2c1a40.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_28feffe146.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_71d765bca7.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/552/news/', 'published'),
('마르니, ‘2023 토끼의 해’ 기념 캡슐 컬렉션 출시', '이탈리아 아티스트 플라미니아 베로네시와의 협업으로 탄생한', 'categoryfashion531news-275', '2022-12-29', 'Fashion', '["마르니","2023"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_d4a8894f6c.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b37bee8221.png', '<br>

<p style="text-align:left;">마르니가 2023년 토끼의 해를 기념한 특별한 컬렉션으로 돌아왔습니다. 이탈리아 아티스트 플라미니아 베로네시와 협업으로 탄생한 이번 컬렉션에는 이곳저곳 토끼가 등장하는데요. 토끼 모양의 펜던트부터 토끼 그래픽을 활용한 티셔츠와 팬츠 등 아이코닉한 마르니 컬렉션을 감상해보세요.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5c836f862b.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_33239f27d3.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_7dcaf7581c.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_a5aae3a675.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_a2b1001d61.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_d9dedeb318.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_0df1f140f4.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_9413fe6dd0.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/531/news/', 'published'),
('아더 에러x컨버스 협업 컬렉션 공식 출시 정보', '컨버스 척 70에 아더 에러의 감성을 한 스푼 넣으면? ', 'categoryfashion526news-276', '2022-12-28', 'Fashion', '["아더 에러","컨버스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/12_12_57_28_e29478da75.jpeg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_12_57_32_0548636664.jpg', '<br>

<p style="text-align:left;">아더 에러와 컨버스의 협업 컬렉션이 베일을 벗었습니다. 컨버스의 헤리티지 제품인 ‘컨버스 척 70’에 아더 에러의 감성이 듬뿍 담겼으며, 남녀 공용으로 이루어진 의류 컬렉션 또한 눈길을 사로잡았습니다. 척 70은 베이지 컬러의 스웨이드에 아더 에러의 메인 컬러인 블루 색상을 포인트로 더했으머, 두 브랜드의 로고를 앞쪽 텅에 담아낸 모습. 의류 컬렉션은 후디와 티셔츠, 팬츠 등은 물론 겨울에도 착용할 수 있는 바시티 재킷까지 포함했습니다. 특히 바시티 재킷은 블루 컬러를 메인으로 손목과 목 주변의 스트라이프 패턴으로 매력적인 실루엣을 완성했습니다.  </p>

<br><br>

<br>

<p style="text-align:left;">오는 1월 9일부터 아더 에러 온라인 스토어, 10일부터는 일부 오프라인 스토어에서 구매 가능하며, 컨버스 온・오프라인 스토어에서는 1월 12일부터 구매할 수 있습니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_cafe6b7164.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_f4ccb4421f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_cbbfbd5925.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_7dff0912d6.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_819d6b2787.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_c7a8d2c06a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_d60ebafe97.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_cec0074bbf.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/526/news/', 'published'),
('루이 비통 X 쿠사마 야요이 협업 컬렉션 정식 발매', '그녀의 시그니처인 물방물무늬와 무한의 모티브를 루이 비통이 담아냈다', 'categoryfashion505news-277', '2022-12-20', 'Fashion', '["루이 비통","쿠사마 야요이"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3ab451f55e.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a3093e41c4.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/louisvuitton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이 비통</strong></a>과 글로벌 아티스트 쿠사마 야요이의 협업 컬렉션이 정식 발매되었습니다. 야요이의 시그니처인 물방울무늬와 무한의 모티브를 담아낸 이번 컬렉션은 남성복과 여성복은 물론 향수, 액세서리 등 폭넓은 구성군을 뽐낸 모습. 특히 2012년 첫 번째 협업 이후 10년 만에 성사된 이번 기념비적 협업은, 마치 쿠사마 야요이가 직접 찍어낸 듯한 핸드 페인팅 기법이 포인트로 들어가 있습니다. 중국과 일본에서는 오는 1월 1일 출시될 예정이며, 글로벌 릴리즈는 1월 6일 루이 비통 온라인 스토어와 오프라인 매장에서 선보입니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7bb52aabf4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_9b8ed9853b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_40603c7a59.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_dd2da834c2.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_5cbe3d382f.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_15bd950333.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_4d07081984.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_e2cb7fb988.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_88a4b904fc.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_0b34d1c808.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_4d1b24932a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_2e7877e940.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/505/news/', 'published'),
('아페쎄 X 아식스, 협업 스니커즈 ‘젤-소노마 15-50’ 출시', '파리의 번화가와 피트니스, 웰빙 등을 테마로 탄생됐다', 'categoryfashion473news-278', '2022-12-08', 'Fashion', '["아페쎄","아식스"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_05d29adfcc.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_237bcaa598.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/apc_paris/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아페쎄</strong></a>와 <a href="https://www.instagram.com/asics/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아식스</strong></a>의 협업이 확정됐습니다. 실용성과 기능성에 초점을 맞춘 이번 풋웨어 라인은, 혁신적인 소재와 세련된 디테일로 각 브랜드를 재해석했으며, 피트니스와 웰빙, 파리의 번화가에서 영감을 얻었다고 하네요.
<br><br>
아페쎄 공식 홈페이지에 12월 9일 릴리즈 예정이며, 16일부터는 모든 아식스 매장에서 만나볼 수 있을 예정입니다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_d96e467ebc.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_00330b2ce0.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_fa0588be7a.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_9fc9c3ba20.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_291ac370cf.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_e199b81d13.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/473/news/', 'published'),
('박보검, 셀린느 글로벌 앰버서더 공식 발탁', '지난 6월 파리 셀린느 쇼에 참석했던 그', 'categoryfashion436news-279', '2022-11-25', 'Fashion', '["박보검","셀린느","앰버서더"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1591020299.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_4e8f958690.jpg', '<br>

<p style="text-align:left;">배우 박보검이 <a href="https://www.instagram.com/celine/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">셀린느</strong></a> 하우스의 글로벌 앰버서더로 발탁됐다. 그는 지난 6월 셀린느 파리 쇼에 참석해 글로벌 앰버서더로서 첫 시작을 알렸으며, 국내 남자배우 최초로 선정된 만큼 어떤 다채로운 모습을 선보일지 국내외적으로 기대가 모아지고 있다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_63be8edd91.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_c5fdb38c88.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_5451250d2c.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/436/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('루이비통, 세기의 라이벌 메시와 호날두를 등장시킨 캠페인 공개', '‘승리는 마음의 상태를 반영한다’라는 제목 아래 두 사람이 경쟁한다', 'categoryfashion421news-280', '2022-11-21', 'Fashion', '["루이비통","메시","호날두"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_51cf1941bd.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_68a3abd2b3.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/louisvuitton/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">루이비통</strong></a>이라서 가능한 캠페인 광고 아닐까? 현존하는 최고의 축구선수이자 세기의 라이벌인 리오넬 메시와 크리스티아누 호날두를 한 광고에 등장시켰다. 
<br><br>
‘승리는 마음의 상태를 반영한다’라는 제목 아래 두 선수가 체스를 함께 두고 있는 모습. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_59817be26a.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/421/news/', 'published'),
('미우미우, 배우 이유미와 함께한 홀리데이 캠페인 공개', '올해 1월 글로벌 모델 선정에 이어 미우미우의 뮤즈로 거듭나는 그녀', 'categoryfashion380news-281', '2022-11-08', 'Fashion', '["미우미우","이유미","홀리데이"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_721b9052a7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b3ebfd9b6c.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/miumiu/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미우미우</strong></a> 홀리데이 캠페인에 등장한 배우 <a href="https://www.instagram.com/leeyoum262/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">이유미</strong></a>. 올해 1월 글로벌 모델로도 발탁된 데 이어 이번에도 미우미우의 뮤즈로 활약했다. 캠페인 속 그녀는 홀리데이를 맞이해 특유의 사랑스러운 비주얼과 표정으로 위트 있는 매력을 뽐냈다.</p>

<br><br>

<center><style>.embed-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; } .embed-container iframe, .embed-container object, .embed-container embed { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }</style><div class=''embed-container''></div></center>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_4a06569303.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_0724171a87.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/380/news/', 'published'),
('탬버린즈, 향을 듬뿍 담아낸 크림 향수 ‘퍼퓸 쉘 엑스’ 정식 출시', '지난 9월 출시한 열 개의 향기 중에 가장 인기있는 세 개를 담아냈다', 'categorybeauty376news-282', '2022-11-07', 'Beauty', '["탬버린즈","블랙핑크","제니"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_de7ba2ee5a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_ba5255aae4.jpg', '<br>

<p style="text-align:left;">규정되지 않은 아름다움을 탐구하는 향 브랜드, <a href="https://www.instagram.com/tamburinsofficial/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">탬버린즈</strong></a>가 ‘퍼퓸 쉘 엑스’를 출시했다. 퍼퓸 쉘이란 향수처럼 사용할 수 있는 크림 타입의 퍼퓸으로, 실용성은 물론 매력적인 패키징으로 큰 사랑을 받았다. 이번 출시된 ‘퍼퓸 쉘 엑스’는 지난 9월 탬버린즈가 출시한 퍼퓸 컬렉션 중 3종을 선정해 만든 제품. 카모, 버가샌달, 라레 향으로 구성되었으며 패키징 또한 모래에서 건져낸 듯한 디자인으로 각 향마다 다르게 디테일을 더했다. 현재 탬버린즈 공식 홈페이지에서 구매 가능하다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_cf2745caa4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/pc_main_Hero_right_v4_ce624d0797.jpeg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_63017a5663.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_1a3762c7d9.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_6185359d46.jpg"]'::jsonb, '[]'::jsonb, '/category/Beauty/376/news/', 'published'),
('키코 코스타디노브 x 히스테릭 글래머 협업 컬렉션 공개', '80년대 하라주쿠의 서브컬처를 그들의 느낌으로 다시 한 번 재구현했다', 'categoryfashion364news-283', '2022-10-27', 'Fashion', '["키코","키코 코스타디노브","히스테릭 글래머"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_8ff76183f1.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_88fad1efe0.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/kikokostadinov/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">키코 코스타디노브</strong></a>와 <a href="https://www.instagram.com/hystericglamour_tokyo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">히스테릭 글래머</strong></a>의 협업 컬렉션이 베일을 벗었다. 80년대 하라주쿠의 하위문화를 영감으로 시작된 이번 컬렉션은, 히스테릭 글래머 특유의 아이코닉하고 빈티지한 콘셉트를 베이스로 키코 코스타디노브의 실용성과 디테일을 가감 없이 녹여낸 모습. 또한 일본을 넘어 전 세계적인 글로벌 모델 <a href="https://www.instagram.com/i_am_kiko/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">미즈하라 키코</strong></a>가 등장해 길거리에서 파파라치에게 찍힌듯한 컷들로 룩북을 완성시켰다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_51bdbd609d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_f8241d12ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_2380db5b21.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/6_1c989e52be.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_5c46fd4983.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_0693ef26e5.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_e8181b067b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/8_5366575187.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/9_273df6b851.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/10_16851d6e7c.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/364/news/', 'published'),
('플라스틱아크 x LMC, 100% 재활용 화분 ‘더티팟’ 협업 컬렉션 출시', '10월 30일, 홍대 엘엠씨 플래그십 스토어에서 특별한 팝업으로 이를 기념한다', 'categoryfashionlife367news-284', '2022-10-27', 'Fashion,Life', '["플라스틱아크","LMC","플래그십 스토어"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_f8c78fad7d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_10f9595fb5.jpg', '<br>

<p style="text-align:left;">스트리트 브랜드 <a href="https://www.instagram.com/lostmanagementcities/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엘엠씨</strong></a>가 라이프 스타일을 제공하는 친환경 컬쳐 브랜드 <a href="https://www.instagram.com/plasticark_/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">플라스틱아크</strong></a>와의 첫 협업 컬렉션을 출시한다. 해당 컬렉션은 다용도 용기로 쓰일 수 있는 화분 형태의 제품으로 구성되었고, 100% 재활용 폴리프로필렌으로 제작되어 각 개체마다 개성있는 색과 패턴을 지니고 있다. 이번 협업건은 핑크, 스카이 블루, 옐로우 총 3색상으로 구성되었으며, 기존의 더티팟 형태의 모형에서 엘엠씨만의 재치가 돋보이는 아트웍이 결합된 모습.</p>

<br><br>

<br>

<p style="text-align:left;">협업 제품 발매는 온라인으로 오는 10월 28일에 출시되며, 이를 기념하여 10월 30일 단 하루 <a href="https://www.instagram.com/lil__farm/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">릴팜</strong></a>이 주최하는 팝업 스토어를 홍대 엘엠씨 플래그쉽 스토어에서 개최한다. 이외에도 공예품 라이프스타일 브랜드 <a href="https://www.instagram.com/anu_seoul/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아누</strong></a>, 희귀식물 분양을 겸하는 <a href="https://www.instagram.com/yume_green_/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">유메그린</strong></a> 또한 참석해 시각적인 전시에 국한되지 않는 다양한 경험을 제공할 예정.</p>

<br><br>

<br>

<p style="text-align:left;">또한 이 날, 약 150여개의 소/대형 식물들로 전체적인 디스플레이가 이루어지는 것은 물론, 야외 공간을 구성해 줄 수제버거 전문 버거보이의 푸드트럭도 마련된다. 약 6시간 동안 진행될 신세하, 미써니사이드업, y2k92, 스포츠 킴, 워크맨이 전개하는 디제이 라이브 퍼포먼스도 함께 즐길 수 있다. </p>

<br><br>

<br>

<p style="text-align:left;">이번 협업에서 플라스틱아크만의 특색있는 제품은 물론 엘엠씨의 FW22 정규 컬렉션 제품들도 볼 수 있기에, 이번 하루 동안만 진행되는 진귀한 이 팝업을 놓치지 말고 방문해 보자. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_1bd47f783d.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/01_ef1cc472a4.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/02_095cf321ce.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/03_cbd3efed0e.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Life/367/news/', 'published'),
('몽클레르 설립 70주년 기념, 톰 브라운과 ‘마야 70 재킷'' 출시', '몽클레르의 패딩과 톰 브라운의 그레이 슈트가 하나로 합쳐졌다 ', 'categoryfashion359news-285', '2022-10-25', 'Fashion', '["몽클레르","70주년","톰 브라운"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_6c1f1d53e6.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_b60d392f2c.png', '<center><style>.embed-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; } .embed-container iframe, .embed-container object, .embed-container embed { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }</style><div class=''embed-container''></div></center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/moncler/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">몽클레르</strong></a>가 설립 70주년을 맞아 <a href="https://www.instagram.com/thombrowne/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">톰 브라운</strong></a>과 펼쳐낸 새로운 ‘마야 70 재킷’. 두 브랜드의 정체성이 완벽히 합쳐진 이번 재킷은, 몽클레르의 패딩과 톰 브라운의 슈트가 합쳐져 마치 톰 브라운이 몽클레르를 껴안고 있는 듯한 실루엣을 뽐낸다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_2df67488e3.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_190d9139f0.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_1ed62eb673.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0000_74281cf9cd.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/359/news/', 'published'),
('스와로브스키, 벨라 하디드와 함께한 2022 홀리데이 캠페인', '컬러풀한 앙상블과 함께 별 모양 보석 컬렉션 ‘스텔라’를 선보였다', 'categoryfashion339news-286', '2022-10-18', 'Fashion', '["스와로브스키","벨라 하디드"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_bba6d261a8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d78c85d8c7.png', '<center><style>.embed-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; } .embed-container iframe, .embed-container object, .embed-container embed { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }</style><div class=''embed-container''></div></center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/bellahadid/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">벨라 하디드</strong></a>가 등장한 <a href="https://www.instagram.com/swarovski/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">스와로브스키</strong></a> 2022 홀리데이 캠페인. 컬러풀한 앙상블과 함께 별 모양 보석 컬렉션 ‘스텔라’를 선보이며 신비롭고 세련된 무드를 뽐냈다.  </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_09c24e1a9b.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/339/news/', 'published'),
('‘달의 해변''을 배경으로 펼쳐진 엠부쉬 2022 F/W 캠페인', '“out of this world, on earth.”를 모토로 달의 실루엣을 초현실적으로 담아냈다', 'categoryfashion303news-287', '2022-09-30', 'Fashion', '["엠부쉬","22fw","fw","2022"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_bf3cd07b41.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_22582ede1b.png', '<br>

<p style="text-align:left;">달의 해변을 배경으로 펼쳐진 <a href="https://www.instagram.com/ambush_official/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">엠부쉬</strong></a>의 2022 F/W 캠페인. “out of this world, on earth.”를 모토로 펼쳐진 이번 캠페인은 달의 광대한 실루엣을 메인으로 초현실적인 분위기를 뽐냈다. </p>

<br><br>

<br>

<p style="text-align:left;">마치 물리적 공간과 시간이 멈춰버린 듯한 느낌을 선사하며 레트로 퓨처리즘의 정석을 보여준 모습. 벨트 초크, 트위스트 이어링, 글로시한 블랙 레더 하트 백 등 아이코닉한 제품들 또한 엠부쉬 세계관에 고스란히 녹아들었다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_c7df9afcab.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00000_30d52dfaea.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_494b7c1ad0.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00000000_8c103c824c.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/303/news/', 'published'),
('포스트 아카이브 팩션 5.0+ 컬렉션 룩북 릴리즈', '‘테크니컬 바캉스’를 메인 테마로 이전 5.0 시리즈에서 한층 혁신적으로 나아갔다', 'categoryfashion286news-288', '2022-09-23', 'Fashion', '["포스트 아카이브 팩션"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_8d808196b3.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_3ccad63b94.png', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/postarchivefaction/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">포스트 아카이브 팩션</strong></a>이 5.0+ 컬렉션 룩북을 공개했다. ‘테크니컬 바캉스’를 메인 테마로 이전 5.0 시리즈에서 한층 나아가 시어서커, 라이오셀 등의 스포티한 소재에 실크나 레이스 등의 색다른 소재를 결합시켜 더욱 아이코닉하고 실험적인 모습을 선보였다. 2023년 3월 정식 출시 예정. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/000_59b6d347ed.png","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0000_a7addb89a4.png"]'::jsonb, '[]'::jsonb, '/category/Fashion/286/news/', 'published'),
('알릭스9SM X 나이키 협업 스니커즈, 9월 9일 발매 예정 ', '뒷축이 제거된 뮬 실루엣에 조그마한 펀치홀 디테일이 돋보인다 ', 'categoryfashion240news-289', '2022-09-06', 'Fashion', '["알릭스9SM","나이키"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_3d8326bc9f.jpeg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_5a24246ebf.jpg', '<br>

<p style="text-align:left;">매튜 윌리엄스가 전개하는 <a href="https://www.instagram.com/alyxstudio/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">1017 알릭스 9SM</strong></a>과 <a href="https://www.instagram.com/nike/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">나이키</strong></a>의 협업 모델이 베일을 벗었다. 뒷축은 제거된 뮬 실루엣의 슬립온 스타일로, 제품명은 ''슬라이드 005''. 오는 9월 9일 글로벌 웹사이트를 통해 발매를 시작한다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_cc946919fc.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/240/news/', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('아더에러, 국내 한정판 쇼퍼백 발매', '사전 예약 시스템을 통해서만 구매할 수 있다?', 'categoryfashionculture150news-290', '2022-07-21', 'Fashion,Culture', '["아더에러","adererror"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_b8a6af43d9.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_2fedcd0d83.jpg', '<center>

</center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더에러</strong></a>의 시그니처 쇼퍼백이 곧 공개된다. 국내 한정판으로 선보이는 이번 패브릭 쇼퍼백은 새롭게 도입되는 아더의 사전 예약 시스템인 스탠드바이에 등록 후 발송되는 링크를 통해 구매 가능하다고. 오는 금요일 오전 10시부터 오후 2시까지 4시간 동안 열리는 스탠드바이 링크를 통해 구매권을 등록할 수 있다. </p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion,Culture/150/news/', 'published'),
('김해김의 2023 봄 컬렉션 ‘데님 러브’', '저번 시즌의 머리카락에 이어, 이번 시즌은 데님이다', 'categoryfashion108news-291', '2022-07-11', 'Fashion', '["김해김","2023","봄 컬렉션","데님 러브","kimhekim"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_3be73dd6f1.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_38ca3b1e0a.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/maison_kimhekim/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">김해김</strong></a>의 오는 2023 봄 컬렉션, ‘데님 러브’. 머리카락을 주 소재로 사용했던 저번 시즌에 이어, 이번엔 데님을 이용해 모든 컬렉션을 구성하며 독보적인 아이디어를 펼쳤다. </p>

<br><br>

<center>

</center>

<br>

<p style="text-align:left; ">평범한 청재킷과 청바지를 찢고 잘라내면 어느덧 드레스와 비너스 슈트로 깜짝 변신한다.</p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_3569b145ec.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion/108/news/', 'published'),
('아크네, 새로운 무스비 백 캠페인 공개', '인체를 탐구하며 친밀감을 듬뿍 담아냈다 ', 'categoryfashionculture111news-292', '2022-07-11', 'Fashion,Culture', '["아크네 스튜디오","무스비 백","캠페인"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_d6e03420a5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/3_6db5ab58c3.jpg', '<br>

<p style="text-align:left;"><a href="https://www.instagram.com/acnestudio/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아크네 스튜디오</strong></a>가 새롭게 공개한 2022 캠페인. 포토그래퍼 <a href="https://www.instagram.com/taliachetrit/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">탈리아 셰트리</strong></a>와 함께한 이번 캠페인은 남성 댄서들의 바디와 무수비 백을 대비시켜 섹슈얼한 무드뿐만 아니라 친밀감, 취약성 등을 동시에 탐구했다.</p>

<br><br>

<center>

</center>

<br>

<p style="text-align:left; ">일본 전통의상인 기모노의 허리띠라고 할 수 있는 ‘오비’에서 영감을 받은 이번 무수비 백은 소가죽을 이용해 부드러운 질감이 특징. 마이크로, 미니, 미디움과 맥시멈 사이즈로 구성됐다. </p>

<br><br>', '["https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/7_f42f141a13.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/4_58eb09eb4b.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_57644644db.jpg","https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/5_dbcfb8200c.jpg"]'::jsonb, '[]'::jsonb, '/category/Fashion,Culture/111/news/', 'published'),
('아더에러, 2022 S/S 컬렉션 버추얼 에디토리얼 공개', '컬렉션 명 ‘애프터 블루’', 'categoryfashion95news-293', '2022-07-08', 'Fashion', '["아더에러","2022 ss","애프터 블루","adererror"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/2_7dadc93802.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/1_a3e5e81ce5.jpg', '<center><style>.embed-container { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; } .embed-container iframe, .embed-container object, .embed-container embed { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }</style><div class=''embed-container''></div></center>

<br>

<p style="text-align:left;"><a href="https://www.instagram.com/ader_error/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">아더에러</strong></a>가 2022 S/S ‘애프터 블루’ 컬렉션 드롭을 맞아 선보인 버추얼 에디토리얼.  20세기 초반의 시대적 배경을 기반으로 아더의 ‘재편집’ 이념에서 비롯된 비정형의 건물 양식을 화면 전반에 녹여냈다. 현실을 초월한 영역에서도 문화를 개척해 나가는 아더에러의 정체성을 감상할 수 있다.</p>

<br><br>', '[]'::jsonb, '[]'::jsonb, '/category/Fashion/95/news/', 'published'),
('피렌체 핏티워모 FW26 DAY 2 & 3', '', '피렌체-핏티워모-fw26-day-2-3-294', '2026-01-16', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_24680e3c1b.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_24680e3c1b.jpg', '<p>피렌체 핏티워모 FW26 DAY 2 & 3</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('피렌체 핏티워모 FW26 DAY 1', '', '피렌체-핏티워모-fw26-day-1-295', '2026-01-15', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7c51e2e23a.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7c51e2e23a.jpg', '<p>피렌체 핏티워모 FW26 DAY 1</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('밀란패션위크 FW26 프리뷰', '', '밀란패션위크-fw26-프리뷰-296', '2026-01-14', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e1e8aae0b5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e1e8aae0b5.jpg', '<p>밀란패션위크 FW26 프리뷰</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('''삶의 여백''을 발견하다, 에이클로젯의 새 시작', '', '삶의-여백을-발견하다-에이클로젯의-새-시작-297', '2026-01-13', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5db3cb9e21.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5db3cb9e21.jpg', '<p>''삶의 여백''을 발견하다, 에이클로젯의 새 시작</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('파리패션위크 FW26 프리뷰', '', '파리패션위크-fw26-프리뷰-298', '2026-01-13', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_26dd80d71d.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_26dd80d71d.jpg', '<p>파리패션위크 FW26 프리뷰</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('서울패션위크 FW25 스트릿 패션', '', '서울패션위크-fw25-스트릿-패션-299', '2025-10-15', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e9d3fb3b70.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e9d3fb3b70.jpg', '<p>서울패션위크 FW25 스트릿 패션</p>', '[]'::jsonb, '[]'::jsonb, '', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('에버레인 X 디자이너 피터 도', '', '에버레인-x-디자이너-피터-도-300', '2025-09-29', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_bed2e93076.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_bed2e93076.jpg', '<p>에버레인 X 디자이너 피터 도</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('르메르는 어떻게 파리지앵이 사랑하는 브랜드가 됐을까?', '', '르메르는-어떻게-파리지앵이-사랑하는-브랜드가-됐을까-301', '2025-09-15', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c6fccb6ddf.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c6fccb6ddf.jpg', '<p>르메르는 어떻게 파리지앵이 사랑하는 브랜드가 됐을까?</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('밀란 패션 위크 SS26 스트릿 스타일', '', '밀란-패션-위크-ss26-스트릿-스타일-302', '2025-09-01', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c31d25b5b2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c31d25b5b2.jpg', '<p>밀란 패션 위크 SS26 스트릿 스타일</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('파리 핏티 이마지네 가든파티 2025', '', '파리-핏티-이마지네-가든파티-2025-303', '2025-07-01', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7f51441b91.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_7f51441b91.jpg', '<p>파리 핏티 이마지네 가든파티 2025</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('밀란 디자인 위크 2025 하이라이트', '', '밀란-디자인-위크-2025-하이라이트-304', '2025-06-15', 'Fashion,Culture', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a3b7c2d4e5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a3b7c2d4e5.jpg', '<p>밀란 디자인 위크 2025 하이라이트</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('서울패션위크 SS26 스트릿 패션', '', '서울패션위크-ss26-스트릿-패션-305', '2025-06-01', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b8c9d0e1f2.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b8c9d0e1f2.jpg', '<p>서울패션위크 SS26 스트릿 패션</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('보테가 베네타가 사랑받는 이유', '', '보테가-베네타가-사랑받는-이유-306', '2025-05-20', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c1d2e3f4a5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c1d2e3f4a5.jpg', '<p>보테가 베네타가 사랑받는 이유</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('코펜하겐 패션 위크 SS26', '', '코펜하겐-패션-위크-ss26-307', '2025-03-15', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_f1e2d3c4b5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_f1e2d3c4b5.jpg', '<p>코펜하겐 패션 위크 SS26</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('우리 동네 편집숍이 사라진 이유', '', '우리-동네-편집숍이-사라진-이유-308', '2025-03-01', 'Fashion,Culture', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a1b2c3d4e5.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a1b2c3d4e5.jpg', '<p>우리 동네 편집숍이 사라진 이유</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('지방시의 새 크리에이티브 디렉터, 사라 버튼', '', '지방시의-새-크리에이티브-디렉터-사라-버튼-309', '2025-02-15', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b2c3d4e5f6.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_b2c3d4e5f6.jpg', '<p>지방시의 새 크리에이티브 디렉터, 사라 버튼</p>', '[]'::jsonb, '[]'::jsonb, '', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.articles (title, subtitle, slug, published_date, category, tags, thumbnail_url, hero_image_url, content, gallery, credits, custom_url, status) VALUES
('겐조 니고의 세 번째 컬렉션', '', '겐조-니고의-세-번째-컬렉션-310', '2025-02-01', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c3d4e5f6a7.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_c3d4e5f6a7.jpg', '<p>겐조 니고의 세 번째 컬렉션</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('파리 오뜨 꾸뛰르 FW25 하이라이트', '', '파리-오뜨-꾸뛰르-fw25-하이라이트-311', '2025-01-15', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d4e5f6a7b8.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_d4e5f6a7b8.jpg', '<p>파리 오뜨 꾸뛰르 FW25 하이라이트</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('런던패션위크 FW25 스트릿 스타일', '', '런던패션위크-fw25-스트릿-스타일-312', '2025-01-05', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e5f6a7b8c9.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_e5f6a7b8c9.jpg', '<p>런던패션위크 FW25 스트릿 스타일</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('뉴욕패션위크 FW25 스트릿 스타일', '', '뉴욕패션위크-fw25-스트릿-스타일-313', '2024-12-20', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_f6a7b8c9d0.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_f6a7b8c9d0.jpg', '<p>뉴욕패션위크 FW25 스트릿 스타일</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('하이더 아커만의 톰포드', '', '하이더-아커만의-톰포드-314', '2024-12-10', 'Fashion', '[]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a7b8c9d0e1.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_a7b8c9d0e1.jpg', '<p>하이더 아커만의 톰포드</p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('‘Sound Of Movement’ : The Man Who Steals Souls', '아티스트 최원빈과 만난 엄브로 타슬란', 'sound-of-movement-the-man-who-steals-souls-315', '2024-06-05', 'Fashion,Music', '["Sound Of Movement","최원빈","Umbro","Taslan","엄브로","타슬란"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_45f4726e45.png', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_19ae127c45.png', '<div style="padding:177.78% 0 0 0;position:relative;"><iframe src="https://player.vimeo.com/video/953865555?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; clipboard-write" style="position:absolute;top:0;left:0;width:100%;height:100%;" title="‘Sound Of Movement’ : The Man Who Steals Souls"></iframe></div><script src="https://player.vimeo.com/api/player.js"></script>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 자기 소개.</p>

<p style="text-align:left;"><strong>A.</strong> 안녕하세요! 최원빈이라고 합니당.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 요즘 어떻게 지내고 있어요?</p>

<p style="text-align:left;"><strong>A.</strong> 해 떠 있을 때는 비타민 D 흡수하며 자전거 타고 서대문 문화체육회관으로 가서 저보다 더 건강하신 할머니들과 신나게 수영을 해요. 해가 지면 앨범 작업하고 책을 읽고, 주말에는 스네이크치킨스프 공연을 하거나 가끔 파티 가서 열심히 엉덩이 흔들며 살고 있습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 촬영에서의 에피소드, TMI가 있다면?</p>

<p style="text-align:left;"><strong>A.</strong> 웨터 초창기 같이 작업했던 분이 해당 촬영장에 패션 에디터로 계셔서 오랜만에 인사를 나눴어요. 옛날 생각도 나고 감회가 새로웠습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 촬영에서 ‘다른 이들의 영혼을 훔치는 일을 즐기는 악동 캐릭터’를 연기하셨죠. 실제로 원빈 님이 가장 악동스러워지는 순간은 언제일까요?</p>

<p style="text-align:left;"><strong>A.</strong> 악동 아닌 척 너무 오래 했을 때.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 촬영 캐릭터처럼 누군가의 어떠한 재능을 자유자재로 훔칠 수 있다면 어떤 재능이 가장 탐날 것 같아요?</p>

<p style="text-align:left;"><strong>A.</strong> 도파민 수용체 자유자재 조절능력.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 평소 원빈 님의 추구미가 궁금해요. 원빈 님의 패션 철학에 가장 레퍼런스가 되어 주는 것은 무엇인가요?</p>

<p style="text-align:left;"><strong>A.</strong> 어찌 됐든 저찌 됐든 ‘록(Rock)’스러운가?</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 촬영장에 울려퍼진 노래 ‘Hate is all around’에는 “내 머리에 박힌 돌을 꺼내”라는 가사가 있죠. 요즘 원빈 님의 머릿속은 어때요? 아직 박힌 돌이 빠지지 않았나요?</p>

<p style="text-align:left;"><strong>A.</strong> 저 가사를 쓸 당시 박혀 있던 돌은 빠진 것 같은데, 그것마저 확신은 없고 현재는 새로운 돌이 껴 있네요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 평소 책을 즐겨 읽어요? 인스타그램 피드에서 우연히 쌓아 놓은 책 사진을 보았어요.</p>

<p style="text-align:left;"><strong>A.</strong> 네, 책 좋아해요. 저는 책을 즐겁게 읽기 위해 책 읽기 전에는 그보다 더 자극적인 일을 하지 않으려고 하는데, 그게 잘 안 될 때가 많아요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 원빈 님이 궁금해하던 것이 책에 나와 있던가요?</p>

<p style="text-align:left;"><strong>A.</strong> 처음에는 답을 얻으려고 책을 읽은 것이 맞지만 그런 의도가 있는 책 읽기는 오래 가지 못했어요. 그런 방식은 제가 원하는 답을 얻지 못할 시 그 시간들이 무가치하게 느껴져서요. 저는 운동도 그렇고 책 읽기도 마찬가지로 어떤 목적 없이 그 행위 자체에서 주는 건강함을 사랑합니다. 요즘은 어떤 답을 얻으려고 책을 읽기보다는 오히려 어떤 질문을 하며 살아가야 하는지를 X되는 작가, 형, 누나, 동생들에게 배우고 있는 중이에요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 제가 원빈 님을 처음 알게 된 것은 밴드 ‘웨터’의 최원빈이였어요. 오늘도 웨터 인스타그램 댓글창을 확인했는데, 돌아올 때까지 기다린다는 팬들의 댓글이 실시간으로 달리고 있더군요. 원빈 님에게 웨터는 어떤 의미를 가지나요?</p>

<p style="text-align:left;"><strong>A.</strong> 웨터는 저의 20대인 것 같아요. 여러 가지로 부족해서 여러 가지로 채우다보니 매일매일 어제보다 더 세고 자극적인 것을 찾아야 했던 시기였어요. 그 속에는 허영심과 과잉된 자의식, 과장된 반항심 같은 것들이 있었습니다. 그러면서 수익이 없어도 아랑곳하지 않고 계속해서 앨범을 만들고 공연했던 순수한 열정도 떠오르네요.
<br><br>
그 맛은 20대가 아니라면 절대 할 수 없는 에너지였다고 생각합니다. 웨터의 30대는 어떨지 궁금하기도 하면서 추억으로 남겨두고 싶기도 하고, 어디로 흘러 갈진 아직 저도 모르겠습니다. 무책임하게 들리겠지만 진짜 모르겠어요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 솔로 최원빈과 밴드 웨터의 최원빈, 차이점이 있다면요?</p>

<p style="text-align:left;"><strong>A.</strong> 지금 시점에서 돌아보면 웨터는 저를 포함한 멤버들이 좋아하는 록밴드들의 문화와 사운드를 계승하고 배우고 한국말로 바꾸는 작업이었다고 느껴져요. 솔로 작업들은 특정 문화와 사운드를 계승해 봤으니 “이제 그들도 못하는 나만 할 수 있는 것을 해 볼까?” 하는 태도의 차이점이 있는 것 같고요. 그래도 둘 다 여전히 록이라는 공통점이 있습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 최근 밴드 붐이라고 해도 과언이 아닐 정도로 많은 밴드들이 대중들의 사랑을 받고 있어요. 대중들이 이토록 밴드에 열광 하는 이유는 무엇일까요?</p>

<p style="text-align:left;"><strong>A.</strong> 우선 저는 중고등학생 때부터 록 밴드를 좋아하다보니 자연스럽게 국내 밴드 신에 대해 집중하고 있었던 사람으로서 지금이 이례적으로 밴드 붐이 왔다는 것에는 동의하지 않아요. 특정 밴드들이 붐을 일으키는 일은 계속 있어 왔었지만 ‘힙합’처럼 장르 자체가 주류에 속해졌다고는 생각하지 않기 때문입니다.<br><br>
케이팝 이외에 주류 음악으로 올라왔던 힙합이 5년 내내 같은 말을 반복하고 다른 말 하는 애들 찾다보니 얻어걸린 것은 아닐지 몰라도 전 세계적으로 음악과 패션 등 돌고 도는 흐름 속에 지금이 밴드의 흐름인가 정도로 생각하고 있어요.
<br><br>
힙합이 주는 뜨거움이 말 그대로 이제 너무 뜨거워져서 록 음악이 주는 차가움으로 열을 식힐 때인 것 같다고 혼자 자위하고 있어요. 아직 한국에는 록스타 자리가 공석이라는 소문이 있어서 그 자리에 노크를 한번 해 볼까 생각 중입니다. </p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 정말 다양한 활동을 보여 주고 있잖아요. 최근 개인적으로 가장 심장 뛰었던 일이 있다면요?</p>

<p style="text-align:left;"><strong>A.</strong> 요즘 수영에 빠져서 동네 문화 회관에서 수영하고 있는데, 거기서 친해진 저보다 훨씬 건강하시고 건장하신 이순 할머님이 계속 젊은 놈이 자기보다 체력 없다고 놀리셔서 욱하는 마음에 안 쉬고 레일을 돌았는데 심장이 터져서 죽을 뻔했습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 음악 말고도 도전해 보고 싶은 또 다른 영역이 있어요?</p>

<p style="text-align:left;"><strong>A.</strong> 말로 어떻게 표현해야 할지 알 수 없는 생각들을 머릿속에 품고 있는 것이 너무 괴로워서 음악을 만들 때가 있어요. 그런데 음악에 있어서 기술적으로 부족한 탓인지 미처 다 표현하지 못한 말들을 모아서 책을 써 보고 싶기도 해요.
<br><br>
“뭘 그렇게 다 표현 하고 싶어 해~” 하면서 그냥 입 꾹 닫고 돈 주는 곳 아무 데나 가서 살아지는 대로 살기 등이 도전해 보고 싶은 또 다른 영역이네요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 조금 더 사적인 영역의 질문을 해 볼게요. 인간 최원빈은 어떤 사람인 것 같아요?</p>

<p style="text-align:left;"><strong>A.</strong> 아직 잘 모르겠어요. 아이유 님은 25살 때 자신을 이제야 알 것 같다고 가사에 썼는데 저는 아직도 모르겠네요. 모른다기보다는 계속 바뀌어서 어제는 알았는데 오늘은 모르겠어요. 아이유 님도 그럴걸요? 가사를 쓰던 그날 자기를 이제 알 것 같다고 느꼈을 뿐. 그래도 답변을 해 본다면 계속해서 자기 자신을 알아보려고 하는 사람인 것 같아요. </p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 원빈 님의 팬들은 어떤 사람이에요?</p>

<p style="text-align:left;"><strong>A.</strong> 사랑 그 잡채!</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이 자리를 빌어 팬들에게 하고 싶은 말이 있다면.</p>

<p style="text-align:left;"><strong>A.</strong> 사랑해요, 잡채들. 곧 좋은 소식 들려드릴게요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 다음 행보에 대한 스포일러를 안 들어볼 수 없죠. 어떤 것들을 준비 중에 있어요?</p>

<p style="text-align:left;"><strong>A.</strong> 저의 첫 솔로 정규 앨범을 준비하고 있습니다. 15곡으로 구성되어 있고, 다양한 장르의 친구들이 함께 하다보니 제 나름 “한국말로 된 이런 앨범은 들어본 적이 없다”라는 귀여운 자신감 정도 있어요.
<br><br>
덧붙여 웨터의 처음을 함께 했던 친구들과 다시 만나 작업하고 있어요. 웨터의 처음을 기점으로 시간이 꽤 흘렀는데 각자 자기 포지션에서 월등히 업그레이드 되어있는 상태라 결과물이 무척 기대됩니다. 저희의 창작물을 제지하고 컨펌 하는 회사가 없는 상태라, 이번에 처음으로 완전한 자율성을 가진 상태인데 이게 득이 될지 실이 될지는 나와 봐야 알 것 같네요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 마지막으로 원빈 님이 살면서 꼭 지키고 싶은 것이 있다면 무엇일까요?</p>

<p style="text-align:left;"><strong>A.</strong> 지키고 싶었던 것이 파괴되고 박살나더라도 내일 다시 침대에서 일어나 새로 지키고 싶은 것을 찾는 힘을 꼭 지키고 싶어요.</p>

<br><br><br><br>

<p style="text-align:right; font-family: Montserrat;font-size: 1rem;">
Brand. <a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Umbro</strong></a><br><br>
Videographer. <a href="https://www.instagram.com/kyungh0/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Kyungho</strong></a> & <a href="https://www.instagram.com/yoooniseo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Yoon Iseo</strong></a> <br>Assisted by. <strong>Jung Jiwoo</strong> & <strong>Choi Hongjun</strong> & <strong>Oh Sumin</strong><br>
Video Edit. <a href="https://www.instagram.com/kyungh0/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Kyungho</strong></a><br>
Editor. <a href="https://www.instagram.com/kimim0o/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Jinju</strong></a> & <a href="https://www.instagram.com/luvchexxymotion/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Cho Seoyoung</strong></a> & <a href="https://www.instagram.com/2.93km/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Minkyeong</strong></a> <br>Assisted by. <strong>Jeong Subin</strong><br>
Hair. <a href="https://www.instagram.com/brogyu/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Ahn Hyunggyu</strong></a> <br>Assisted by.  <strong>Jang Chaerin</strong><br>
Makeup. <a href="https://www.instagram.com/jungdaeun.___/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Jung Daeun</strong></a><br>
Project Manager. <a href="https://www.instagram.com/johnyinseoul/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Johny Lee</strong></a><br><br>
Starring. <a href="https://www.instagram.com/chwvin/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Choi Wonvin</strong></a></p>', '[]'::jsonb, '[]'::jsonb, '', 'published'),
('‘Sound Of Movement’ : Don’t Steal My Soul', '아티스트 미란이와 만난 엄브로 타슬란', 'sound-of-movement-dont-steal-my-soul-316', '2024-06-04', 'Fashion,Music', '["MIRANI","Umbro","타슬란","Taslan","Don’t Steal My Soul","Sound Of Movement"]'::jsonb, 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/0_5a5146e098.jpg', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/00_be93ab0fa3.jpg', '<div style="padding:177.78% 0 0 0;position:relative;"><iframe src="https://player.vimeo.com/video/953451952?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; clipboard-write" style="position:absolute;top:0;left:0;width:100%;height:100%;" title="‘Sound Of Movement’ : Don’t Steal My Soul"></iframe></div><script src="https://player.vimeo.com/api/player.js"></script>

<br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 자기 소개.</p>

<p style="text-align:left;"><strong>A.</strong> 안녕하세요, 미란이입니다! 반갑습니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 평소 본업 잘하는 건 알고 있었지만 촬영장에서도 흘러넘치는 매력에 감탄을 금치 못했어요. 이번 촬영은 어땠나요?</p>

<p style="text-align:left;"><strong>A.</strong> 재미있었어요. 촬영은 늘 그렇듯 재미있어야 결과물도 잘 나오는 것 같아요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 촬영에서 ‘누구에게도 뺏길 수 없는 자신의 영혼인 마이크’를 지키기 위해 고군분투하는 모습을 보여 주셨죠. 실제로 미란이 님에게 뺏길 수 없는 영혼 같은 존재는 무엇인가요?</p>

<p style="text-align:left;"><strong>A.</strong> 건강한 생각들이요. 살아갈 때 가장 필요한 존재인 것 같아요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> CCTV는 그런 존재를 빼앗기지 않기 위한 하나의 장치로 보이더군요. 영혼과 같은 존재를 내 안에서 지키고자 했던 경험 있어요?</p>

<p style="text-align:left;"><strong>A.</strong> 지키기 위해 노력했던 경험은 너무 많아요. 건강한 생각을 지키기 어려운 세상이잖아요. 제가 조금 흔들릴 때면 제가 사랑하는 사람들을 찾아가기도 하고, 가장 좋아하는 드라마를 보기도 하고 그러다보면 또 어느샌가 지켜지고 있더라고요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이번 촬영에서 소화한 스타일링이 평소 스타일과 비슷했는지도 궁금해요. 다른 점이 있다면 어떤 것이 달랐어요?</p>

<p style="text-align:left;"><strong>A.</strong> 스포티한 매력의 엄브로의 룩에 페미닌한 스커트나 신발을 매치하는 스타일링은 제 평소 스타일이랑 잘 맞았던 것 같아요. 다른 점은 자주 시도하지 않았던 라인이 들아간 옷을 입었을 때 신선하다고 느꼈습니다!</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 인스타그램 피드를 보고 있으면 패션에 대한 애정이 남다르다고 느껴져요. 의류학과를 졸업했다는 것도 놀라웠고요. 패션과 음악, 미란이에게 어떤 의미를 가지나요?</p>

<p style="text-align:left;"><strong>A.</strong> 패션과 음악은 참 비슷한 점이 많은 것 같아요. 그래서 둘 다 사랑하는 거 같고요. 나에게 잘 어울리는 것을 찾는 게 중요하죠. 그래서인지 두 분야를 탐구할수록 결국은 제 모습이 되어 가는 걸 보면 너무 재미있어요. 저의 음악과 패션은 그냥 제 자신 그 자체예요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 활동명인 미란이는 ‘명탐정 코난’에서 따온 것으로 알고 있어요. 여전히 만화를 좋아하고 있나요? 최근 관심사는 어떤 거예요?</p>

<p style="text-align:left;"><strong>A.</strong> 애니메이션은 여전히 좋아해서 자주 봐요. 코난은 요즘 안 보지만요. 요즘은 ‘웰빙’에 관심이 많아요. 어떻게 하면 건강하고 재미있게 살 수 있을까에 대한 방법을 찾고 있어요. 그래서 저번주에는 런닝머신 대신 한강을 뛰었어요. 완전히 색다르더라고요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 음악적인 영감도 관심사에서 비롯되는 경우가 많나요? 곡 작업을 할 때 가장 영향을 받는 것이 있다면요?</p>

<p style="text-align:left;"><strong>A.</strong>  영감을 많이 받고 있어요. 어떤 것에 관심이 있느냐에 따라 생각이 바뀌거든요. 그래서 요즘에는 센 전자 음악은 잘 안 들어요. 재지하고 컴한 노래들을 자주 듣죠. 결국 이런 것들이 모여서 제 음악에 영향을 주는 것 같아요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 아티스트로서 미란이는 세상에 어느 정도 보여진 것 같아요?</p>

<p style="text-align:left;"><strong>A.</strong>  10%! 아직 보여드리고 싶은 게 너무 많아요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 수많은 발매곡 중 가장 애착이 가는 곡과 그 이유도 궁금해요.</p>

<p style="text-align:left;"><strong>A.</strong>  ‘Daisy’요. 제가 쓴 가사지만 다시 봐도 참 잘 썼다 생각해요. 많은  분들에게 이 노래가 힘이 되었다는 이야기를 많이 들었어요. 노래를 만드는 사람으로서 이만큼 좋은 칭찬이 있을까요? 이런 말을 들을 때마다 항상 감사하죠. Daisy는 제게도 듣는 분들에게도 뭉클한 마음을 주는 곡인 것 같아 참 애착이 가요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 미란이를 사랑해 주는 사람은 어떤 사람들인가요?</p>

<p style="text-align:left;"><strong>A.</strong>  따뜻한 사람들이요. 저를 사랑해 주시는 분들의 메시지나 응원을 들으면 어쩜 이렇게 따뜻할 수가 있을까 늘 생각했거든요. 그래서인지 좋은 노래로 늘 보답해드리고 싶어요. 제가 더 겸손해지고 열심히 하는 이유죠.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 이 자리를 빌어 사랑하는 사람들에게 한 마디해 주세요.</p>

<p style="text-align:left;"><strong>A.</strong>  여러분들 덕분에 좋은 음악을 내고 싶고, 좋은 사람이 되고 싶어요. 저의 원동력이랍니다. 부끄럽지만 너무 감사해요. 그리구 사랑합니다.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 요즘 가장 많이 하는 생각이 있다면요?</p>

<p style="text-align:left;"><strong>A.</strong>  어떤 앨범을 만들까에 대한 것이 최대의 고민이에요. 앨범 작업을 하는 중인데 여전히 어렵네요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 평소 스트레스를 어떻게 극복해요?</p>

<p style="text-align:left;"><strong>A.</strong>  가장 친한 친구들을 만나요. 중학교 때부터 친구들인데요. 가만히 있어도 너무 재미있어요. 제 보물들이에요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 다가오는 여름에 대한 계획이 있나요? 어떤 여름을 보낼 계획이에요?</p>

<p style="text-align:left;"><strong>A.</strong>  여름 휴가 계획은 없지만 앨범 계획이 있어서 엄청 바빠질 것 같아요. 뜨거운 여름이 됐으면 좋겠네요.</p>

<br><br>

<p style="text-align:left; color: #908f8f;"><strong>Q.</strong> 마지막으로 미란이가 아닌 김윤진으로서 끝까지 지키고 싶은 신념이 있어요?</p>

<p style="text-align:left;"><strong>A.</strong>  늘 저 자신에게 떳떳한 사람이 되고 싶어요. 핑계 없이 내가 선택한 것에 후회 없이 그냥 잘 살기! 가장 어렵지만 꼭 지키고 싶은 제 신념입니다.</p>

<br><br><br><br>

<p style="text-align:right; font-family: Montserrat;font-size: 1rem;">
Brand. <a href="https://www.instagram.com/umbrokorea/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Umbro</strong></a><br><br>
Videographer. <a href="https://www.instagram.com/kyungh0/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Kyungho</strong></a> & <a href="https://www.instagram.com/yoooniseo/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Yoon Iseo</strong></a> <br>Assisted by. <strong>Jung Jiwoo</strong> & <strong>Choi Hongjun</strong> & <strong>Oh Sumin</strong><br>
Video Edit. <a href="https://www.instagram.com/kyungh0/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Kyungho</strong></a><br>
Editor. <a href="https://www.instagram.com/kimim0o/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Jinju</strong></a> & <a href="https://www.instagram.com/luvchexxymotion/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Cho Seoyoung</strong></a> & <a href="https://www.instagram.com/2.93km/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Kim Minkyeong</strong></a> <br>Assisted by. <strong>Jeong Subin</strong><br>
Hair. <a href="https://www.instagram.com/brogyu/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Ahn Hyunggyu</strong></a> <br>Assisted by.  <strong>Jang Chaerin</strong><br>
Makeup. <a href="https://www.instagram.com/jungdaeun.___/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Jung Daeun</strong></a><br>
Project Manager. <a href="https://www.instagram.com/johnyinseoul/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">Johny Lee</strong></a><br><br>
Starring. <a href="https://www.instagram.com/mirannnnnnni/" style="text-decoration-line:none" target="_blank"><strong style="color: black;">MIRANI</strong></a></p>', '[]'::jsonb, '[]'::jsonb, '', 'published')
ON CONFLICT (slug) DO NOTHING;

-- =============================================
-- Migration complete!
-- Films: 141
-- Articles: 317
-- =============================================