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
const _canonByKey = {};
CANONICAL_ITEM_TYPES.forEach((t) => { _canonByKey[_key(t)] = t; });

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

module.exports = { CANONICAL_ITEM_TYPES, ITEM_ALIASES, normalizeItemType, hasCjk };
