#!/usr/bin/env node
/**
 * 구 S3(pap-korea-bucket) 이미지 목록 만들기 — AWS 해지 3단계 (2026-11-27)
 *
 * 배포되는 정적 파일(frontend/ 아래 git 추적 파일)에 박혀 있는 구 S3 이미지 주소를
 * 전부 모아, 파일 이름(키)만 api/_data/s3-legacy-keys.json 에 적는다.
 * 이관 크론(api/cron/migrate-external-images.js)의 3단계가 이 목록을 보고
 * 같은 이름으로 Supabase media 버킷 s3/ 폴더에 사본을 만든다.
 *
 * 왜 같은 이름인가: 사본이 다 만들어지면 정적 파일의 주소는 "앞부분(호스트)만"
 * 바꾸면 된다. 키마다 새 이름을 만들면 수천 개짜리 대응표가 또 필요해진다.
 *
 * 다시 만들기: node scripts/build-s3-legacy-keys.js
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'api', '_data', 's3-legacy-keys.json');
const RE = /https?:\/\/pap-korea-bucket\.s3[.a-z0-9-]*amazonaws\.com\/([A-Za-z0-9._\-]+)/g;

function collect() {
  const files = execSync('git ls-files frontend', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const keys = new Set();
  for (const f of files) {
    let s;
    try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(s))) keys.add(m[1]);
  }
  return [...keys].sort();
}

if (require.main === module) {
  const keys = collect();
  fs.writeFileSync(OUT, JSON.stringify(keys) + '\n');
  console.log('s3-legacy-keys:', keys.length, '→', path.relative(ROOT, OUT));
}
module.exports = { collect, RE };
