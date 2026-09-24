#!/usr/bin/env node
// 로컬 미리보기: 인증키·네트워크 없이 스텁 API 로 두 주치 수집을 돌려 _demo/site 를 만든다.
//   npm run demo  →  python3 -m http.server 8080 -d _demo/site  →  http://localhost:8080
// 화면의 공고명은 전부 "[예시]" 가상 데이터다.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { startMockServer, makeFixtures } from '../test/mock-server.mjs';
import { kstToday } from '../site/core.js';
import { addDays, ROOT } from './lib.mjs';

const DEMO = path.join(ROOT, '_demo');
const today = process.env.TODAY || kstToday();
const state = { fx: makeFixtures(today), fail: new Set(), shortPage: new Set(), lhAuthError: false };
const mock = await startMockServer(state);

const env = (extra) => ({
  ...process.env,
  APPLYHOME_API_KEY: 'demo',
  APPLYHOME_API_BASE: `http://127.0.0.1:${mock.port}/api`,
  LH_API_BASE: `http://127.0.0.1:${mock.port}/B552555`,
  DATA_DIR: path.join(DEMO, 'data'),
  OUT_DIR: path.join(DEMO, 'site'),
  DIGEST_DIR: path.join(DEMO, 'out'),
  RETRY_BASE_MS: '1',
  CALL_GAP_MS: '0',
  GITHUB_OUTPUT: '',
  ...extra,
});
const run = (script, extra = {}, args = []) => new Promise((resolve, reject) => {
  execFile(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env: env(extra) }, (err, stdout, stderr) => {
    process.stdout.write(stdout);
    if (err) reject(new Error(`${script}: ${stderr}`));
    else resolve();
  });
});

await rm(DEMO, { recursive: true, force: true });
await mkdir(path.join(DEMO, 'data'), { recursive: true });
await writeFile(path.join(DEMO, 'data', 'store.json'), '{"version":2,"notices":{\n\n}}\n');

// 지난주 실행 — 일부 공고는 아직 없던 상태
const lastWeek = addDays(today, -7);
const full = makeFixtures(today);
state.fx = { ...full, apt: full.apt.filter((r) => r.PBLANC_NO !== '2026000901'), urbty: full.urbty.slice(1) };
const prevRun = new Date(Date.parse(`${lastWeek}T06:00:00+09:00`)).toISOString();
await run('fetch.mjs', { TODAY: lastWeek, RUN_AT: prevRun });
await run('validate.mjs', { TODAY: lastWeek });
await run('record-run.mjs', {}, ['ok']);
await run('mark-delivered.mjs', {}, [prevRun]);

// 이번 주 실행
state.fx = full;
const thisRun = new Date(Date.parse(`${today}T06:00:00+09:00`)).toISOString();
await run('fetch.mjs', { TODAY: today, RUN_AT: thisRun });
await run('validate.mjs', { TODAY: today });
await run('record-run.mjs', {}, ['ok']);
await run('build.mjs');
await run('notify.mjs');
mock.server.close();
console.log(`\n미리보기: python3 -m http.server 8080 -d _demo/site  →  http://localhost:8080`);
