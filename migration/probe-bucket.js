#!/usr/bin/env node
/**
 * S3 버킷 크기/파일 수 조사 스크립트
 * 실행: node probe-bucket.js
 */
import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.S3_BUCKET || 'pap-korea-bucket';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

async function probe() {
  console.log(`📊 Probing bucket: ${BUCKET}\n`);

  let totalCount = 0;
  let totalSize = 0;
  const extensions = {};
  let continuationToken = undefined;

  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken
    }));

    for (const obj of (res.Contents || [])) {
      totalCount++;
      totalSize += obj.Size || 0;
      const ext = (obj.Key.split('.').pop() || 'none').toLowerCase();
      extensions[ext] = (extensions[ext] || 0) + 1;
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    if (totalCount % 1000 === 0 || !continuationToken) {
      process.stdout.write(`\r   ... counted ${totalCount.toLocaleString()} objects`);
    }
  } while (continuationToken);

  console.log(`\n\n✅ Bucket summary:`);
  console.log(`   Total objects:  ${totalCount.toLocaleString()}`);
  console.log(`   Total size:     ${formatBytes(totalSize)}`);
  console.log(`\n📁 File types (top 10):`);
  Object.entries(extensions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([ext, count]) => {
      console.log(`   .${ext.padEnd(8)} ${count.toLocaleString()}`);
    });

  console.log(`\n💡 Supabase Plan 추천:`);
  if (totalSize < 1024 ** 3) {
    console.log(`   ✅ Free (1GB) 플랜으로 충분 (현재: ${formatBytes(totalSize)})`);
  } else if (totalSize < 100 * 1024 ** 3) {
    console.log(`   ⚠️  Pro ($25/월, 100GB) 플랜 필요 (현재: ${formatBytes(totalSize)})`);
  } else {
    console.log(`   ⚠️  Pro + Add-on 필요 (100GB 초과분: $0.021/GB)`);
    const overGB = (totalSize / (1024 ** 3)) - 100;
    console.log(`   예상 추가 비용: $${(overGB * 0.021).toFixed(2)}/월`);
  }

  console.log(`\n⏱️  예상 이전 시간:`);
  const avgSeconds = totalCount * 0.5; // 0.5초/파일 (동시 10개 병렬)
  const hours = Math.floor(avgSeconds / 3600);
  const minutes = Math.floor((avgSeconds % 3600) / 60);
  console.log(`   약 ${hours}시간 ${minutes}분 (병렬 처리 기준)`);
}

probe().catch(err => {
  console.error('\n❌ Probe 실패:', err.message);
  if (err.Code === 'InvalidAccessKeyId') {
    console.error('   → AWS Access Key가 잘못되었습니다. .env 파일 확인하세요.');
  } else if (err.Code === 'SignatureDoesNotMatch') {
    console.error('   → AWS Secret Key가 잘못되었습니다. .env 파일 확인하세요.');
  }
  process.exit(1);
});
