#!/usr/bin/env node
/* 영상 디자인 굽기 실물 확인 — 도메니코가 맥 터미널에서 직접 실행한다.
   Claude 작업 VM 은 리눅스라 맥용 ffmpeg 바이너리를 못 돌린다.
   사용: node burn-test.js [영상경로]
   결과: ~/Desktop/PAP-굽기테스트.mp4  (없으면 실패 이유를 출력) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const vo = require('./api/_lib/videoOverlay');
const th = require('./api/_lib/celebThumb');
const { mp4Dimensions } = require('./api/_lib/mp4Mute');

const KO = '일주일 뒤 만날 제니의 새 앨범, Fallen Angel';
const EN = "Jennie's New EP 'Fallen Angel' Drops Next Week";

const DEFAULT_SRC = path.join(os.homedir(),
  'Documents/문서/PAP-Vault/_assets_tmp/pepperit_kit/Outro.mp4');

(async () => {
  const src = process.argv[2] || DEFAULT_SRC;
  if (!fs.existsSync(src)) {
    console.error('영상을 못 찾음: ' + src);
    console.error('사용법: node burn-test.js /경로/영상.mp4');
    process.exit(1);
  }
  console.log('ffmpeg :', vo.ffmpegPath() || '없음');
  const inBuf = fs.readFileSync(src);
  console.log('원본   :', JSON.stringify(mp4Dimensions(inBuf)), (inBuf.length / 1048576).toFixed(2) + 'MB');

  const ov = await th.renderOverlay(KO, EN, { variant: 'reels' });
  const ovPath = path.join(os.homedir(), 'Desktop', 'PAP-오버레이.png');
  fs.writeFileSync(ovPath, ov);
  console.log('오버레이:', (ov.length / 1024).toFixed(0) + 'KB →', ovPath);

  console.log('\n굽는 중… (시간이 좀 걸립니다)');
  const t0 = Date.now();
  const out = await vo.burnIntro(inBuf, ov);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!out) { console.error('\n❌ 굽기 실패 — 위 오류 메시지 확인'); process.exit(1); }

  const dst = path.join(os.homedir(), 'Desktop', 'PAP-굽기테스트.mp4');
  fs.writeFileSync(dst, out);
  console.log('\n✅ 완료');
  console.log('   결과  :', JSON.stringify(mp4Dimensions(out)), (out.length / 1048576).toFixed(2) + 'MB');
  console.log('   인코딩:', secs + '초');
  console.log('   파일  :', dst);
  console.log('\n바탕화면의 PAP-굽기테스트.mp4 를 열어서 앞 3초에 디자인이 뜨는지 봐주세요.');
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
