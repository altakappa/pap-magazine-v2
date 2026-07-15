#!/usr/bin/env node
/**
 * PAP Magazine — 로컬 배치 임베딩 생성 스크립트.
 *
 * 기존 /api/admin/backfill-embeddings 는 Vercel 함수(60초 제한)라
 * 2,349편의 legacy 에디토리얼을 처리하기엔 부족.
 * 이 스크립트는 로컬에서 직접 Supabase + OpenAI API를 호출해
 * embedding=null인 모든 published 에디토리얼에 벡터를 생성·저장한다.
 *
 * 사용법:
 *   node scripts/batch-embeddings.js
 *   node scripts/batch-embeddings.js --force    # 기존 임베딩도 재생성
 *   node scripts/batch-embeddings.js --dry      # API 호출 없이 대상만 확인
 *
 * 환경변수 (Vercel에서 복사 또는 .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
 *
 * 비용 추정: 2,349편 × ~100토큰 × $0.02/1M = ~$5
 * 소요 시간: ~20분 (RPM 제한 고려, 배치 10개씩)
 */

const OPENAI_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const MAX_INPUT_CHARS = 8000;
const BATCH_SIZE = 20;   // OpenAI embedding API 배치 입력 개수
const DELAY_MS = 200;    // 배치 간 대기 (3000 RPM 여유)
const PAGE_SIZE = 500;   // Supabase 페이지네이션 단위

// ── 환경변수 로드 ────────────────────────────────────────────────────
// .env.local이 있으면 로드 (dotenv 선택적)
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
} catch (_) {
  // dotenv 미설치 시 환경변수 직접 설정 필요
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수를 설정해 주세요.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY 환경변수를 설정해 주세요.');
  process.exit(1);
}

const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');

// ── Supabase REST 직접 호출 (SDK 없이) ───────────────────────────────
async function supabaseGet(table, select, filters, range) {
  const params = new URLSearchParams();
  params.set('select', select);
  for (const [k, v] of Object.entries(filters || {})) params.set(k, v);
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact',
  };
  if (range) headers['Range'] = range;
  const res = await fetch(url, { headers });
  const total = res.headers.get('content-range');
  const data = await res.json();
  return { data, total };
}

async function supabaseUpdate(table, id, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DB update failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ── Embedding 텍스트 구성 (api/_lib/embeddings.js와 동일) ─────────────
function editorialEmbeddingText(ed) {
  const tagsStr = Array.isArray(ed.tags) ? ed.tags.join(', ') : '';
  const descStr = (ed.description || '').toString().trim();
  const titleStr = (ed.title || '').toString().trim();
  return [titleStr, descStr, tagsStr ? 'Tags: ' + tagsStr : ''].filter(Boolean).join('. ');
}

// ── OpenAI 배치 임베딩 호출 ──────────────────────────────────────────
async function embedBatch(texts) {
  const cleaned = texts.map(t => String(t || '').trim().slice(0, MAX_INPUT_CHARS));
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: cleaned }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    // Rate limit → 대기 후 재시도
    if (resp.status === 429) {
      const retry = parseInt(resp.headers.get('retry-after') || '10', 10);
      console.log(`  ⏳ Rate limit — ${retry}초 대기...`);
      await sleep(retry * 1000);
      return embedBatch(texts); // 재귀 1회
    }
    throw new Error(`OpenAI API ${resp.status}: ${body.slice(0, 300)}`);
  }
  const json = await resp.json();
  return json.data.map(d => d.embedding);
}

function toPgVectorString(vec) {
  return '[' + vec.join(',') + ']';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 embedding=null인 에디토리얼 조회 중...\n');

  // 1) 전체 대상 조회 (페이지네이션)
  const allRows = [];
  let offset = 0;
  while (true) {
    const embFilter = force ? {} : { 'embedding': 'is.null' };
    const { data } = await supabaseGet(
      'editorials',
      'id,title,description,tags,embedding',
      { 'status': 'eq.published', ...embFilter },
      `${offset}-${offset + PAGE_SIZE - 1}`
    );
    if (!data || !data.length) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`📊 대상: ${allRows.length}편 (force=${force})\n`);

  if (dry) {
    console.log('🏁 dry 모드 — API 호출 없이 종료.');
    const sample = allRows.slice(0, 5).map(r => `  • ${r.title} (${r.id.slice(0,8)})`).join('\n');
    if (sample) console.log('샘플:\n' + sample);
    process.exit(0);
  }

  if (!allRows.length) {
    console.log('✅ 임베딩이 필요한 에디토리얼이 없습니다.');
    process.exit(0);
  }

  // 2) 배치 처리
  let processed = 0, failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(editorialEmbeddingText);
    const nonEmpty = texts.filter(t => t.trim());

    if (!nonEmpty.length) {
      batch.forEach(() => failed++);
      continue;
    }

    try {
      const vectors = await embedBatch(texts);

      // DB에 각각 저장
      for (let j = 0; j < batch.length; j++) {
        if (!vectors[j] || !Array.isArray(vectors[j])) {
          failed++;
          continue;
        }
        try {
          await supabaseUpdate('editorials', batch[j].id, {
            embedding: toPgVectorString(vectors[j]),
          });
          processed++;
        } catch (e) {
          console.warn(`  ⚠ DB 저장 실패: ${batch[j].id} — ${e.message}`);
          failed++;
        }
      }

      // 진행률 표시
      const pct = Math.round(((i + batch.length) / allRows.length) * 100);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = processed > 0 ? (processed / (elapsed / 60)).toFixed(0) : '?';
      process.stdout.write(
        `\r  ✅ ${processed}/${allRows.length} (${pct}%) | 실패 ${failed} | ${elapsed}s | ${rate}/min`
      );

    } catch (e) {
      console.error(`\n  ❌ 배치 오류 (${i}~${i+batch.length}): ${e.message}`);
      batch.forEach(() => failed++);
    }

    if (i + BATCH_SIZE < allRows.length) await sleep(DELAY_MS);
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n🏁 완료! 처리: ${processed} | 실패: ${failed} | 시간: ${totalSec}초`);

  // 비용 추정 출력
  const estTokens = processed * 100; // 에디토리얼당 ~100토큰 추정
  const estCost = (estTokens / 1_000_000 * 0.02).toFixed(4);
  console.log(`💰 추정 비용: ~$${estCost} (${estTokens.toLocaleString()} tokens × $0.02/1M)`);
}

main().catch(e => {
  console.error('\n💥 치명적 오류:', e);
  process.exit(1);
});
