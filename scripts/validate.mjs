#!/usr/bin/env node
// 무결성 검사: data/next/ 를 기존 data/ 와 비교해 통과할 때만 승격한다.
//
// 차단(exit 1, 기존 데이터·사이트 그대로 유지)
//   - 기존 공고 삭제 / 주택형(분양가) 소실 / 형식 오류 / 청약홈 4개 소스 전부 실패 / 칸 합계 불일치
// 경고(승격·배포는 하되 status=degraded → 워크플로가 실패로 끝나 메일·이슈 발송)
//   - 일부 소스 실패, 주택형 조회 실패, 필드명 변경 의심, 진행 중 공고 급감
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { countBuckets, REGIONS } from '../site/core.js';
import * as L from './lib.mjs';

const CORE = ['apt', 'remndr', 'opt', 'urbty'];
const SOURCES = [...CORE, 'lh'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function checkNotice(n, id, errors) {
  const bad = (m) => errors.push(`형식 오류 ${id}: ${m}`);
  if (n.id !== id) bad('id 불일치');
  if (!SOURCES.includes(n.source)) bad(`source=${n.source}`);
  if (!n.name) bad('이름 없음');
  if (!REGIONS.includes(n.region)) bad(`region=${n.region}`);
  for (const k of ['noticeDate', 'start', 'end', 'winnerDate']) {
    if (n[k] != null && !ISO.test(n[k])) bad(`${k}=${n[k]}`);
  }
  if (!Array.isArray(n.types)) bad('types 배열 아님');
  else {
    for (const t of n.types) {
      if (t.price != null && !(Number.isInteger(t.price) && t.price > 0)) bad(`price=${t.price}`);
      if (t.area != null && !Number.isFinite(t.area)) bad(`area=${t.area}`);
    }
  }
  if (!n.firstSeenAt || !n.lastSeenAt) bad('firstSeenAt/lastSeenAt 없음');
}

async function main() {
  const oldStore = await L.readStore(L.DATA_DIR);
  const prevMeta = await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {});
  const next = await L.readStore(L.NEXT_DIR);
  const meta = await L.readJson(path.join(L.NEXT_DIR, 'meta.json'));
  const errors = [];
  const warns = [];

  // 1) 형식
  for (const [id, n] of Object.entries(next.notices)) checkNotice(n, id, errors);

  // 2) 삭제 금지 · 분양가 소실 금지
  for (const [id, o] of Object.entries(oldStore.notices)) {
    const n = next.notices[id];
    if (!n) {
      errors.push(`삭제됨: ${id} (${o.name})`);
      continue;
    }
    if (o.types?.length && !n.types?.length) errors.push(`주택형 소실: ${id} (${o.name})`);
    if (o.firstSeenAt && n.firstSeenAt !== o.firstSeenAt) errors.push(`firstSeenAt 변경: ${id}`);
  }

  // 3) 소스 상태
  const src = meta.sources ?? {};
  const coreOk = CORE.filter((k) => src[k]?.status === 'ok');
  if (!coreOk.length) errors.push('청약홈 4개 소스가 모두 실패 — 게시할 새 데이터가 없습니다');
  for (const k of SOURCES) {
    const s = src[k];
    if (!s) {
      errors.push(`소스 기록 없음: ${k}`);
      continue;
    }
    if (['ok', 'disabled', 'not-enabled'].includes(s.status)) continue;
    warns.push(`${s.label} 수집 실패(${s.status}): ${s.error} — 이 소스의 이번 주 신규 공고가 빠졌을 수 있음. 다음 실행이 ${s.windowStart} 이후를 다시 훑습니다.`);
  }
  for (const k of CORE) {
    const s = src[k];
    if (s?.status === 'ok' && s.fetched !== s.expected) errors.push(`${s.label}: 기대 ${s.expected} ≠ 수집 ${s.fetched}`);
  }

  // 4) 칸 합계 — 어느 칸에도 안 들어간 공고가 없어야 한다
  const c = countBuckets(Object.values(next.notices), meta.today);
  if (c.pass + c.border + c.unknown + c.over !== c.visible) errors.push(`칸 합계 불일치: ${JSON.stringify(c)}`);
  for (const k of ['stored', 'visible', 'pass', 'border', 'unknown', 'over']) {
    if (meta.counts?.[k] !== c[k]) errors.push(`meta.counts.${k}=${meta.counts?.[k]} ≠ 재계산 ${c[k]}`);
  }

  // 5) 경고성 점검
  for (const k of SOURCES) {
    const s = src[k];
    const p = prevMeta.sources?.[k];
    if (s?.status === 'ok' && (p?.expected ?? 0) >= 20 && s.expected < p.expected * 0.5) {
      warns.push(`${s.label}: API 총건수 ${p.expected} → ${s.expected} 급감 — 응답 이상 여부 확인`);
    }
  }
  if (meta.price?.errors) warns.push(`주택형(분양가) 조회 실패 ${meta.price.errors}건 — 해당 공고는 '가격 미확인' 칸에 표시됨`);
  for (const w of meta.warnings ?? []) if (!warns.includes(w)) warns.push(w);
  const prevActive = prevMeta.counts?.active ?? 0;
  if (prevActive >= 5 && c.active === 0) warns.push(`진행 중 공고가 ${prevActive} → 0건으로 급감 — API 응답 이상 여부 확인 필요`);

  if (errors.length) {
    console.error(`✗ 무결성 검사 실패 (${errors.length}건) — 기존 데이터·사이트를 유지합니다`);
    errors.slice(0, 50).forEach((e) => console.error(`  - ${e}`));
    await L.setOutput({ status: 'failed' });
    process.exit(1);
  }

  const status = warns.length ? 'degraded' : 'ok';
  meta.status = status;
  meta.validation = { checkedAt: new Date().toISOString(), warnings: warns };
  if (status === 'ok') {
    meta.lastSuccessAt = meta.runAt;
    meta.lastSuccessToday = meta.today;
  }
  await L.writeStore(L.DATA_DIR, next.notices);
  await L.writeJson(path.join(L.DATA_DIR, 'meta.json'), meta);
  await rm(L.NEXT_DIR, { recursive: true, force: true });

  console.log(`✓ 무결성 검사 통과 [${status}] 보관 ${c.stored} (기존 ${Object.keys(oldStore.notices).length}) · 신규 ${meta.newIds.length}`);
  warns.forEach((w) => console.warn(`  ! ${w}`));
  await L.setOutput({ status, new_count: meta.newIds.length });
}

main().catch(async (e) => {
  console.error(`검사 중단: ${e.stack || e.message}`);
  await L.setOutput({ status: 'failed' });
  process.exit(1);
});
