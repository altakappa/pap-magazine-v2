#!/usr/bin/env node
/**
 * 데이터 파일(JSON, HTML, JS)의 S3 URL을 Supabase URL로 일괄 변환
 *
 * 실행:
 *   node update-data-urls.js          # dry-run (변경 없이 미리보기)
 *   node update-data-urls.js --apply  # 실제 적용
 *
 * 백업:
 *   --apply 실행 시 각 파일의 .bak 복사본을 생성합니다.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'media';
const S3_BUCKET = process.env.S3_BUCKET || 'pap-korea-bucket';
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-2';

if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL이 설정되지 않았습니다. .env 파일 확인하세요.');
  process.exit(1);
}

const apply = process.argv.includes('--apply');

// S3 → Supabase URL 패턴
// From: https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/KEY
// To:   https://SUPABASE_URL/storage/v1/object/public/editorials/KEY
const PATTERNS = [
  // 정규 S3 URL
  {
    from: new RegExp(`https?://${S3_BUCKET}\\.s3\\.${AWS_REGION}\\.amazonaws\\.com/`, 'g'),
    to: `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/`
  },
  // 경로 스타일 S3 URL (혹시 있을 경우)
  {
    from: new RegExp(`https?://s3\\.${AWS_REGION}\\.amazonaws\\.com/${S3_BUCKET}/`, 'g'),
    to: `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/`
  },
  // 리전 없는 S3 URL
  {
    from: new RegExp(`https?://${S3_BUCKET}\\.s3\\.amazonaws\\.com/`, 'g'),
    to: `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/`
  }
];

// 프로젝트 루트 기준 대상 디렉토리
const ROOT = path.resolve(process.cwd(), '..');
const TARGET_DIRS = [
  path.join(ROOT, 'frontend'),
  path.join(ROOT, 'frontend', 'data')
];
const TARGET_EXTS = ['.json', '.html', '.js'];

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkDir(full, files);
    } else if (TARGET_EXTS.includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function countMatches(content) {
  let total = 0;
  for (const { from } of PATTERNS) {
    from.lastIndex = 0;
    const m = content.match(from);
    if (m) total += m.length;
  }
  return total;
}

function replaceAll(content) {
  let out = content;
  let replaced = 0;
  for (const { from, to } of PATTERNS) {
    from.lastIndex = 0;
    out = out.replace(from, (match) => {
      replaced++;
      return to;
    });
  }
  return { out, replaced };
}

async function main() {
  console.log(`🔍 URL 변환 ${apply ? '실행' : '미리보기 (dry-run)'}\n`);
  console.log(`   S3:       ${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`);
  console.log(`   Supabase: ${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}`);
  console.log(`   대상:     ${TARGET_DIRS.map(d => path.relative(ROOT, d)).join(', ')}\n`);

  const allFiles = [];
  for (const dir of TARGET_DIRS) allFiles.push(...walkDir(dir));

  let totalMatches = 0;
  let totalFiles = 0;
  const fileResults = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = countMatches(content);
    if (matches === 0) continue;

    fileResults.push({ file, matches });
    totalMatches += matches;
    totalFiles++;

    if (apply) {
      fs.writeFileSync(file + '.bak', content); // backup
      const { out } = replaceAll(content);
      fs.writeFileSync(file, out);
    }
  }

  // Print summary
  fileResults.sort((a, b) => b.matches - a.matches);
  for (const { file, matches } of fileResults.slice(0, 30)) {
    const rel = path.relative(ROOT, file);
    console.log(`   ${matches.toString().padStart(6)} × ${rel}`);
  }
  if (fileResults.length > 30) {
    console.log(`   ... and ${fileResults.length - 30} more files`);
  }

  console.log(`\n📊 요약:`);
  console.log(`   변경 대상 파일:  ${totalFiles}개`);
  console.log(`   총 URL 치환:     ${totalMatches.toLocaleString()}개`);

  if (apply) {
    console.log(`\n✅ 변경 완료. 백업: 각 파일의 .bak 파일 참조`);
    console.log(`\n다음 단계:`);
    console.log(`   1. git diff 로 변경사항 확인`);
    console.log(`   2. 로컬 테스트`);
    console.log(`   3. git add & commit & push\n`);
  } else {
    console.log(`\n💡 실제 적용하려면: node update-data-urls.js --apply`);
  }
}

main().catch(err => {
  console.error('❌ 에러:', err);
  process.exit(1);
});
