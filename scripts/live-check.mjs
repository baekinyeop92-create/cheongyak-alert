#!/usr/bin/env node
// 실제 API 사전 점검 — 배포 전에 로컬 PC 에서 한 번 돌린다.
//   1) .env.local 에 APPLYHOME_API_KEY=<Decoding 키> 한 줄 (git 에 안 올라감)
//   2) npm run live-check
// 저장소의 data/ 는 건드리지 않고 _live/ 에 따로 수집·검증·빌드한다.
// 청약홈 4개 소스가 모두 '정상'이고 받은 건수 = 총건수여야 통과(exit 0).
import path from 'node:path';
import { execFile } from 'node:child_process';
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { evaluate, priceSummary, statusOf, SOURCE_LABEL } from '../site/core.js';
import { ROOT } from './lib.mjs';

const LIVE = path.join(ROOT, '_live');
if (!process.env.APPLYHOME_API_KEY) {
  console.error('APPLYHOME_API_KEY 가 없습니다. .env.local 에 APPLYHOME_API_KEY=<Decoding 키> 를 넣고 npm run live-check 로 실행하세요.');
  process.exit(2);
}

await rm(LIVE, { recursive: true, force: true });
await mkdir(path.join(LIVE, 'data'), { recursive: true });
await writeFile(path.join(LIVE, 'data', 'store.json'), '{"version":2,"notices":{\n\n}}\n');
for (const f of ['meta.json', 'delivery.json']) await writeFile(path.join(LIVE, 'data', f), '{}');
await writeFile(path.join(LIVE, 'data', 'runs.json'), '[]');

const env = { ...process.env, DATA_DIR: path.join(LIVE, 'data'), OUT_DIR: path.join(LIVE, 'site'), DIGEST_DIR: path.join(LIVE, 'out'), GITHUB_OUTPUT: '' };
const run = (script) => new Promise((resolve) => {
  const child = execFile(process.execPath, [path.join(ROOT, 'scripts', script)], { env, maxBuffer: 20 * 1024 * 1024 }, (err) => resolve(err ? err.code ?? 1 : 0));
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
});

console.log('── 실제 API 수집 ──');
const f = await run('fetch.mjs');
if (f !== 0) process.exit(f);
const v = await run('validate.mjs');
if (v === 0) await run('build.mjs');

const meta = JSON.parse(await readFile(path.join(LIVE, 'data', v === 0 ? 'meta.json' : 'next/meta.json'), 'utf8'));
const store = JSON.parse(await readFile(path.join(LIVE, 'data', v === 0 ? 'store.json' : 'next/store.json'), 'utf8')).notices;

console.log('\n── 소스 점검 ──');
let ok = true;
for (const [k, s] of Object.entries(meta.sources)) {
  const core = k !== 'lh';
  const good = s.status === 'ok' && s.fetched === s.expected;
  if (core && !good) ok = false;
  console.log(`${good ? '✓' : core ? '✗' : '·'} ${s.label.padEnd(10)} ${String(s.status).padEnd(12)} 받음 ${s.fetched}/${s.expected}  서울·경기 ${s.inRegion}  기간 내 ${s.inWindow}${s.operation ? `  [${s.operation}]` : ''}${s.error ? `\n    ${s.error}` : ''}`);
}
const c = meta.counts;
console.log(`\n표시 ${c.visible} = 13억 이하 ${c.pass} + 경계 ${c.border} + 가격 미확인 ${c.unknown} + 초과 ${c.over}  (주택형 조회 ${meta.price.calls}건, 실패 ${meta.price.errors})`);
if (meta.warnings?.length) console.log(`경고:\n${meta.warnings.slice(0, 10).map((w) => `  - ${w}`).join('\n')}`);

console.log('\n── 13억 이하 표본 (공고문과 대조해 보세요) ──');
const today = meta.today;
Object.values(store)
  .filter((n) => !n.dupOf && evaluate(n).bucket === 'pass')
  .sort((a, b) => statusOf(a, today).order - statusOf(b, today).order)
  .slice(0, 5)
  .forEach((n) => {
    const p = priceSummary(n);
    console.log(`  ${[n.region, n.sigungu].filter(Boolean).join(' ')} · ${n.name} · ${SOURCE_LABEL[n.source]} · ${p.range} (${p.area}) · ${statusOf(n, today).label}\n    ${n.url ?? ''}`);
  });

console.log(`\n${ok && v === 0 ? '✓ 통과 — 배포해도 됩니다' : '✗ 실패 — 위 ✗ 항목을 먼저 고치세요'}${v === 0 ? '  (미리보기: python3 -m http.server 8080 -d _live/site)' : ''}`);
process.exit(ok && v === 0 ? 0 : 1);
