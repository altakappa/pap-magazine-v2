'use strict';
/** pap-magazine.com/ig (인스타 프로필 링크 페이지) 문구 9개 언어 (2026-09-25). 틀 문구는 weeklyNewsCopy 와 공유. */
const IG_PAGE = {
  ko: { title: 'PAP 매거진', newsletter: '매주 월요일 뉴스레터 받기', newsletterSub: '화보 5편 + 트렌드 브리핑 10개, 무료', submit: '내 화보를 PAP에 보내기', submitSub: '전 세계 크리에이터가 PAP에 게재됩니다', member: '멤버십 알아보기', memberSub: '풀레터 · 전체 아카이브 · 우선 심사', all: '모든 화보 보기', empty: '이번 주 새 화보를 준비하고 있습니다.' },
  en: { title: 'PAP Magazine', newsletter: 'Get the Monday newsletter', newsletterSub: '5 editorials + 10 trend briefs, free', submit: 'Submit your editorial to PAP', submitSub: 'Creators from around the world are published on PAP', member: 'Explore membership', memberSub: 'Pull-Letter · full archive · priority review', all: 'See all editorials', empty: 'New editorials are on their way this week.' },
  it: { title: 'PAP Magazine', newsletter: 'Ricevi la newsletter del lunedì', newsletterSub: '5 editoriali + 10 tendenze, gratis', submit: 'Invia il tuo editoriale a PAP', submitSub: 'Creativi da tutto il mondo pubblicati su PAP', member: 'Scopri la membership', memberSub: 'Pull-Letter · archivio completo · revisione prioritaria', all: 'Tutti gli editoriali', empty: 'Nuovi editoriali in arrivo questa settimana.' },
  fr: { title: 'PAP Magazine', newsletter: 'Recevoir la newsletter du lundi', newsletterSub: '5 éditoriaux + 10 tendances, gratuit', submit: 'Soumettre votre éditorial à PAP', submitSub: 'Des créateurs du monde entier publiés sur PAP', member: 'Découvrir l’abonnement', memberSub: 'Pull-Letter · archives complètes · examen prioritaire', all: 'Tous les éditoriaux', empty: 'De nouveaux éditoriaux arrivent cette semaine.' },
  es: { title: 'PAP Magazine', newsletter: 'Recibe la newsletter de los lunes', newsletterSub: '5 editoriales + 10 tendencias, gratis', submit: 'Envía tu editorial a PAP', submitSub: 'Creativos de todo el mundo publicados en PAP', member: 'Descubre la membresía', memberSub: 'Pull-Letter · archivo completo · revisión prioritaria', all: 'Ver todos los editoriales', empty: 'Nuevos editoriales llegan esta semana.' },
  ja: { title: 'PAPマガジン', newsletter: '毎週月曜のニュースレターを受け取る', newsletterSub: 'エディトリアル5本 + トレンド10本、無料', submit: 'あなたのエディトリアルを PAP へ', submitSub: '世界中のクリエイターが PAP に掲載されています', member: 'メンバーシップを見る', memberSub: 'Pull-Letter · 全アーカイブ · 優先審査', all: 'すべてのエディトリアル', empty: '今週の新しいエディトリアルを準備しています。' },
  zh: { title: 'PAP 杂志', newsletter: '订阅每周一新闻简报', newsletterSub: '5 组大片 + 10 条趋势,免费', submit: '把你的大片投给 PAP', submitSub: '来自全球的创作者都在 PAP 发表作品', member: '了解会员', memberSub: 'Pull-Letter · 完整档案 · 优先审核', all: '查看全部大片', empty: '本周新大片正在准备中。' },
  ru: { title: 'PAP Magazine', newsletter: 'Получать рассылку по понедельникам', newsletterSub: '5 съёмок + 10 трендов, бесплатно', submit: 'Отправить свою съёмку в PAP', submitSub: 'Авторы со всего мира публикуются в PAP', member: 'О подписке', memberSub: 'Pull-Letter · полный архив · приоритетная проверка', all: 'Все съёмки', empty: 'Новые съёмки выходят на этой неделе.' },
  de: { title: 'PAP Magazine', newsletter: 'Montags-Newsletter erhalten', newsletterSub: '5 Editorials + 10 Trends, kostenlos', submit: 'Dein Editorial bei PAP einreichen', submitSub: 'Kreative aus aller Welt erscheinen bei PAP', member: 'Mitgliedschaft entdecken', memberSub: 'Pull-Letter · komplettes Archiv · bevorzugte Prüfung', all: 'Alle Editorials', empty: 'Neue Editorials erscheinen diese Woche.' },
};
const LANGS = Object.keys(IG_PAGE);
/** ?lang= 우선, 없으면 Accept-Language 첫 지원 언어, 그다음 영어 */
function pickLang(qLang, acceptLanguage) {
  const n = (v) => String(v || '').trim().toLowerCase().slice(0, 2);
  if (IG_PAGE[n(qLang)]) return n(qLang);
  const hit = String(acceptLanguage || '').split(',').map(n).find((x) => IG_PAGE[x]);
  return hit || 'en';
}
module.exports = { IG_PAGE, LANGS, pickLang };
