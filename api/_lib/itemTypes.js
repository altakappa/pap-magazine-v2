/**
 * PAP Magazine — 착장 품목(item type) 단일 진실원
 * ═══════════════════════════════════════════════════════════════════
 * 2026-09-05 신설 (Modern Teddy 서브미션 사고)
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────────
 * 서브미션 폼의 품목 <select> 는 value 없이 <option>Jacket</option> 만 있었다.
 * 제출자가 Chrome 자동번역을 켜면 option 글자가 '裤子' 로 바뀌고,
 * select.value 는 (value 속성이 없으니) 그 번역문을 돌려준다. 그게 그대로
 * submissions.description.looks[].items[].type → editorials.fashion.imageCredits
 * ("@has2sons_ 裤子") → 에디토리얼 상세 페이지 캡션까지 흘러갔다.
 *
 * 프론트는 option 에 value 를 명시해서 막았다(submission.html itemOptions).
 * 이 파일은 서버쪽 2차 방어다: 저장(submissions/index.js)과 승인
 * (submissions/[id]/review.js) 양쪽에서 품목을 영어 표준값으로 되돌린다.
 *
 * ── 원칙 ───────────────────────────────────────────────────────────
 * · 표준 목록은 폼의 24개 옵션과 같다(tests/submission-translate-guard.test.js 가 대조).
 * · 별칭은 번역기가 내는 대표 표기만. 모르는 값은 원본 유지(자유입력 보존).
 */

const CANONICAL_ITEM_TYPES = [
  'Jacket', 'Top', 'Shirt', 'Sweater', 'Dress', 'Pants', 'Skirt', 'Bodysuit',
  'Costume', 'Coat', 'Shoes', 'Boots', 'Bag', 'Glasses', 'Sunglasses', 'Hat',
  'Belt', 'Ring', 'Necklace', 'Earrings', 'Watch', 'Scarf', 'Gloves', 'Other',
];

/* 뷰티 에디토리얼의 품목 (2026-11-24 도메니코)
 * ──────────────────────────────────────────────────────────────────────
 * "뷰티 에디토리얼은 패션 크레딧을 쓸 수 없다. 만약 패션 크레딧을 쓰고자 한다면
 *  그것은 패션 에디토리얼이다."
 *
 * 그전까지 폼의 품목 드롭다운은 장르와 무관하게 의상 24개 하나뿐이었다. 뷰티만
 * 고른 사람에게 줄 수 있는 단어가 Jacket·Dress·Pants 밖에 없었다는 뜻이다.
 * 그런데 BEAUTY 만 고른 제출물이 의상 브랜드를 하나라도 적으면 패션으로
 * 재분류된다(genreModeOf, 2026-09-12 꼼수 차단). 즉 폼이 시키는 대로 채우면
 * 무료 뷰티가 유료 패션이 되는 함정이었다. 실측 두 건:
 *   · 「je t'aime mon amour」 BEAUTY 만 · 품목 Dress 2개 → fashion ·
 *     paid_few_looks(€380). 11/02 제출, 심사 대기 중.
 *   · 「Beautifully Unhinged」 BEAUTY 만 · 품목 16개 중 10개가 'Other' —
 *     맞는 단어가 없어 전부 기타로 밀어 넣은 흔적.
 *
 * 이제 드롭다운 자체가 규칙이다. 뷰티만 고르면 의상 품목이 아예 나오지 않고,
 * 의상을 적고 싶으면 FASHION 을 고르는 순간 패션 에디토리얼이 된다.
 * genreModeOf 의 재분류 규칙은 그대로 둔다 — 폼을 거치지 않는 조작의 방어선이고,
 * 이제는 함정이 아니라 도메니코가 말한 정의를 그대로 집행하는 것이다. */
const BEAUTY_ITEM_TYPES = [
  'Foundation', 'Concealer', 'Powder', 'Blush', 'Bronzer', 'Highlighter',
  'Eyeshadow', 'Eyeliner', 'Mascara', 'Brows', 'Lipstick', 'Lip Gloss',
  'Nails', 'Skincare', 'Serum', 'Mask', 'Sunscreen', 'Fragrance',
  'Hair Color', 'Hair Styling', 'Wig', 'Lashes', 'Tools', 'Other',
];

const ITEM_ALIASES = {
  // 영어 흔들림
  'trousers': 'Pants', 'pant': 'Pants', 'jeans': 'Pants',
  'shoe': 'Shoes', 'boot': 'Boots', 'earring': 'Earrings', 'glove': 'Gloves',
  'sunglass': 'Sunglasses', 'eyewear': 'Glasses', 'tee': 'Top', 't shirt': 'Top',
  'outerwear': 'Coat', 'jumper': 'Sweater', 'knit': 'Sweater',
  // 중국어(간체/번체) — Chrome 번역이 폼 옵션에 내는 표기
  '夹克': 'Jacket', '夾克': 'Jacket', '外套': 'Jacket',
  '上衣': 'Top', '上装': 'Top', '顶部': 'Top', '頂部': 'Top', '有': 'Top',
  '衬衫': 'Shirt', '襯衫': 'Shirt',
  '毛衣': 'Sweater', '针织衫': 'Sweater',
  '连衣裙': 'Dress', '連衣裙': 'Dress', '裙子': 'Skirt', '半身裙': 'Skirt', '短裙': 'Skirt',
  '裤子': 'Pants', '褲子': 'Pants', '长裤': 'Pants', '長褲': 'Pants',
  '紧身衣': 'Bodysuit', '緊身衣': 'Bodysuit', '连体衣': 'Bodysuit',
  '服装': 'Costume', '服裝': 'Costume', '戏服': 'Costume',
  '大衣': 'Coat', '外衣': 'Coat',
  '鞋': 'Shoes', '鞋子': 'Shoes', '靴子': 'Boots', '靴': 'Boots',
  '包': 'Bag', '包包': 'Bag', '袋': 'Bag', '手袋': 'Bag',
  '眼镜': 'Glasses', '眼鏡': 'Glasses', '太阳镜': 'Sunglasses', '太陽鏡': 'Sunglasses', '墨镜': 'Sunglasses',
  '帽子': 'Hat', '帽': 'Hat', '腰带': 'Belt', '腰帶': 'Belt', '皮带': 'Belt',
  '戒指': 'Ring', '项链': 'Necklace', '項鏈': 'Necklace', '耳环': 'Earrings', '耳環': 'Earrings',
  '手表': 'Watch', '手錶': 'Watch', '围巾': 'Scarf', '圍巾': 'Scarf', '手套': 'Gloves',
  '其他': 'Other', '其它': 'Other',
  // ── 뷰티 품목 (2026-11-24). 자동번역이 내는 대표 표기만 — 모르는 값은 원본 유지.
  'base': 'Foundation', 'base makeup': 'Foundation', 'cushion': 'Foundation',
  'lip': 'Lipstick', 'lips': 'Lipstick', 'lip tint': 'Lipstick', 'tint': 'Lipstick',
  'gloss': 'Lip Gloss', 'nail': 'Nails', 'nail art': 'Nails', 'manicure': 'Nails',
  'brow': 'Brows', 'eyebrow': 'Brows', 'eyebrows': 'Brows', 'lash': 'Lashes', 'eyelashes': 'Lashes',
  'perfume': 'Fragrance', 'skin care': 'Skincare', 'skin': 'Skincare', 'essence': 'Serum',
  'moisturizer': 'Skincare', 'cleanser': 'Skincare', 'toner': 'Skincare',
  'sun cream': 'Sunscreen', 'spf': 'Sunscreen', 'hair': 'Hair Styling',
  'hair dye': 'Hair Color', 'extensions': 'Wig', 'brush': 'Tools', 'brushes': 'Tools',
  '파운데이션': 'Foundation', '베이스': 'Foundation', '쿠션': 'Foundation',
  '컨실러': 'Concealer', '파우더': 'Powder', '블러셔': 'Blush', '블러쉬': 'Blush',
  '브론저': 'Bronzer', '하이라이터': 'Highlighter', '아이섀도': 'Eyeshadow', '아이섀도우': 'Eyeshadow',
  '아이라이너': 'Eyeliner', '마스카라': 'Mascara', '눈썹': 'Brows', '아이브로우': 'Brows',
  '립스틱': 'Lipstick', '립': 'Lipstick', '립틴트': 'Lipstick', '립글로스': 'Lip Gloss',
  '네일': 'Nails', '스킨케어': 'Skincare', '세럼': 'Serum', '마스크': 'Mask', '팩': 'Mask',
  '선크림': 'Sunscreen', '자외선차단제': 'Sunscreen', '향수': 'Fragrance',
  '헤어컬러': 'Hair Color', '염색': 'Hair Color', '헤어스타일링': 'Hair Styling', '헤어': 'Hair Styling',
  '가발': 'Wig', '속눈썹': 'Lashes', '브러시': 'Tools', '도구': 'Tools',
  'ファンデーション': 'Foundation', 'コンシーラー': 'Concealer', 'パウダー': 'Powder',
  'チーク': 'Blush', 'ハイライター': 'Highlighter', 'アイシャドウ': 'Eyeshadow',
  'アイライナー': 'Eyeliner', 'マスカラ': 'Mascara', '眉': 'Brows', 'リップ': 'Lipstick',
  'ネイル': 'Nails', 'スキンケア': 'Skincare', '美容液': 'Serum', '日焼け止め': 'Sunscreen',
  '香水': 'Fragrance', 'ヘアカラー': 'Hair Color', 'まつげ': 'Lashes',
  '粉底': 'Foundation', '遮瑕': 'Concealer', '蜜粉': 'Powder', '腮红': 'Blush',
  '眼影': 'Eyeshadow', '眼线': 'Eyeliner', '睫毛膏': 'Mascara', '眉毛': 'Brows',
  '口红': 'Lipstick', '唇彩': 'Lip Gloss', '美甲': 'Nails', '护肤': 'Skincare',
  '精华': 'Serum', '面膜': 'Mask', '防晒': 'Sunscreen', '香水 ': 'Fragrance',
  '染发': 'Hair Color', '假发': 'Wig', '睫毛': 'Lashes',
  // 한국어
  '재킷': 'Jacket', '자켓': 'Jacket', '상의': 'Top', '탑': 'Top', '셔츠': 'Shirt', '스웨터': 'Sweater',
  '드레스': 'Dress', '원피스': 'Dress', '바지': 'Pants', '팬츠': 'Pants', '치마': 'Skirt', '스커트': 'Skirt',
  '바디수트': 'Bodysuit', '코스튬': 'Costume', '의상': 'Costume', '코트': 'Coat',
  '신발': 'Shoes', '구두': 'Shoes', '부츠': 'Boots', '가방': 'Bag', '안경': 'Glasses', '선글라스': 'Sunglasses',
  '모자': 'Hat', '벨트': 'Belt', '반지': 'Ring', '목걸이': 'Necklace', '귀걸이': 'Earrings',
  '시계': 'Watch', '스카프': 'Scarf', '장갑': 'Gloves', '기타': 'Other',
  // 일본어
  'ジャケット': 'Jacket', 'トップス': 'Top', 'シャツ': 'Shirt', 'セーター': 'Sweater', 'ドレス': 'Dress',
  'パンツ': 'Pants', 'ズボン': 'Pants', 'スカート': 'Skirt', 'ボディスーツ': 'Bodysuit', 'コスチューム': 'Costume',
  'コート': 'Coat', '靴': 'Shoes', 'シューズ': 'Shoes', 'ブーツ': 'Boots', 'バッグ': 'Bag', 'メガネ': 'Glasses', '眼鏡': 'Glasses',
  'サングラス': 'Sunglasses', '帽子': 'Hat', 'ベルト': 'Belt', '指輪': 'Ring', 'リング': 'Ring', 'ネックレス': 'Necklace',
  'イヤリング': 'Earrings', '時計': 'Watch', 'スカーフ': 'Scarf', '手袋': 'Gloves', 'その他': 'Other',
};

function _key(raw) {
  return String(raw || '').toLowerCase().replace(/[.&/,_-]/g, ' ').replace(/\s+/g, ' ').trim();
}
/* 두 목록을 함께 표준으로 인정한다. 'Other' 는 양쪽에 있고 같은 값이라 겹쳐도 무해하다. */
const ALL_ITEM_TYPES = CANONICAL_ITEM_TYPES.concat(
  BEAUTY_ITEM_TYPES.filter((t) => CANONICAL_ITEM_TYPES.indexOf(t) === -1)
);
const _canonByKey = {};
ALL_ITEM_TYPES.forEach((t) => { _canonByKey[_key(t)] = t; });

/** 품목 문자열 → 표준 영어값. 모르는 값은 trim 만 해서 원본 유지. 빈 값은 ''. */
function normalizeItemType(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  const k = _key(str);
  if (_canonByKey[k]) return _canonByKey[k];
  if (ITEM_ALIASES[k]) return ITEM_ALIASES[k];
  return str;
}

/** CJK(한·중·일) 글자가 들어 있는가 — 자유입력이 영어 규칙을 어겼는지 볼 때 쓴다 */
function hasCjk(str) {
  return /[぀-ヿ㐀-䶿一-鿿가-힯]/.test(String(str || ''));
}

module.exports = { CANONICAL_ITEM_TYPES, BEAUTY_ITEM_TYPES, ALL_ITEM_TYPES, ITEM_ALIASES, normalizeItemType, hasCjk };
