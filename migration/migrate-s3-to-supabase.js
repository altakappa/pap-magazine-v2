#!/usr/bin/env node
/**
 * S3 → Supabase Storage 마이그레이션 스크립트
 *
 * 기능:
 *  - S3 버킷 전체 순회하며 Supabase Storage로 복사
 *  - 병렬 처리 (기본 10개 동시)
 *  - 진행상황 파일 저장 (중단 후 재개 가능)
 *  - 재시도 로직 (일시 네트워크 에러 대응)
 *  - 이미 업로드된 파일은 건너뜀
 *
 * 실행:
 *   node migrate-s3-to-supabase.js           # 처음부터
 *   node migrate-s3-to-supabase.js --resume  # 이어서
 */
import 'dotenv/config';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import fs from 'fs';
import path from 'path';

// --- Config ---
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-2';
const S3_BUCKET = process.env.S3_BUCKET || 'pap-korea-bucket';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'media';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

const PROGRESS_FILE = path.join(process.cwd(), 'migration-progress.json');
const FAILED_FILE = path.join(process.cwd(), 'migration-failed.json');

// --- Argument parsing ---
const resumeMode = process.argv.includes('--resume');

// --- Validation ---
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('❌ AWS 자격 증명이 없습니다. .env 파일을 확인하세요.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase 설정이 없습니다. .env 파일을 확인하세요.');
  process.exit(1);
}

// --- Clients ---
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// --- Progress tracking ---
let progress = { completed: {}, totalSeen: 0, lastKey: null };
if (resumeMode && fs.existsSync(PROGRESS_FILE)) {
  progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  console.log(`📂 이어서 시작: ${Object.keys(progress.completed).length.toLocaleString()}개 이미 완료됨`);
}

let failed = [];
if (fs.existsSync(FAILED_FILE)) {
  failed = JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8'));
}

function saveProgress() {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}
function saveFailed() {
  fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
}

// --- Helpers ---
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function guessContentType(key) {
  const ext = (key.split('.').pop() || '').toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    pdf: 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

async function migrateOne(key, size) {
  if (progress.completed[key]) {
    return 'skipped';
  }

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      // Download from S3
      const getRes = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key
      }));
      const body = await streamToBuffer(getRes.Body);

      // Upload to Supabase
      const contentType = getRes.ContentType || guessContentType(key);
      const { error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(key, body, {
          contentType,
          upsert: true,
          cacheControl: '2592000' // 30일
        });

      if (error) throw error;

      progress.completed[key] = { size, uploadedAt: new Date().toISOString() };
      return 'uploaded';
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES) {
        failed.push({ key, error: err.message || String(err), timestamp: new Date().toISOString() });
        saveFailed();
        return 'failed';
      }
      await new Promise(r => setTimeout(r, 1000 * attempt)); // exponential backoff
    }
  }
}

// --- Main ---
async function main() {
  console.log(`🚀 S3 → Supabase Storage 마이그레이션 시작\n`);
  console.log(`   S3 버킷:       ${S3_BUCKET}`);
  console.log(`   Supabase 버킷: ${SUPABASE_BUCKET}`);
  console.log(`   동시 처리:     ${CONCURRENCY}개`);
  console.log(`   재시도:        최대 ${MAX_RETRIES}회\n`);

  const limit = pLimit(CONCURRENCY);
  let continuationToken = undefined;
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalSeen = 0;
  const startTime = Date.now();

  // Save progress every N files
  const saveInterval = setInterval(() => {
    saveProgress();
    const rate = totalUploaded / ((Date.now() - startTime) / 1000);
    const pct = totalSeen > 0 ? ((totalUploaded + totalSkipped) / totalSeen * 100).toFixed(1) : 0;
    process.stdout.write(
      `\r   진행: ${(totalUploaded + totalSkipped).toLocaleString()}/${totalSeen.toLocaleString()} (${pct}%) | ` +
      `업로드 ${totalUploaded} | 건너뜀 ${totalSkipped} | 실패 ${totalFailed} | ${rate.toFixed(1)} files/s   `
    );
  }, 2000);

  try {
    do {
      const listRes = await s3.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        ContinuationToken: continuationToken
      }));

      const objects = listRes.Contents || [];
      totalSeen += objects.length;

      await Promise.all(objects.map(obj =>
        limit(async () => {
          const result = await migrateOne(obj.Key, obj.Size);
          if (result === 'uploaded') totalUploaded++;
          else if (result === 'skipped') totalSkipped++;
          else if (result === 'failed') totalFailed++;
        })
      ));

      continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      progress.lastKey = objects.length ? objects[objects.length - 1].Key : progress.lastKey;
      progress.totalSeen = totalSeen;
      saveProgress();
    } while (continuationToken);
  } finally {
    clearInterval(saveInterval);
    saveProgress();
    saveFailed();
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);

  console.log(`\n\n✅ 마이그레이션 완료\n`);
  console.log(`   총 파일:       ${totalSeen.toLocaleString()}개`);
  console.log(`   새로 업로드:   ${totalUploaded.toLocaleString()}개`);
  console.log(`   건너뜀(기존):  ${totalSkipped.toLocaleString()}개`);
  console.log(`   실패:          ${totalFailed.toLocaleString()}개`);
  console.log(`   소요 시간:     ${minutes}분 ${seconds}초`);

  if (totalFailed > 0) {
    console.log(`\n⚠️  실패한 파일 목록: ${FAILED_FILE}`);
    console.log(`   --resume 옵션으로 재시도 가능합니다.`);
  } else {
    console.log(`\n🎉 모든 파일 이전 완료! 다음 단계: npm run update-urls`);
  }
}

main().catch(err => {
  console.error('\n❌ 치명적 에러:', err);
  saveProgress();
  saveFailed();
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⚠️  중단됨. 진행 상황 저장 중...');
  saveProgress();
  saveFailed();
  console.log('   다음 실행 시 --resume 옵션으로 이어서 진행하세요.');
  process.exit(0);
});
