#!/usr/bin/env node
// 실행 기록을 data/runs.json 에 남긴다(최근 104회 = 약 2년).
// 실패한 주에도 기록 커밋이 생기므로 저장소 활동이 끊기지 않는다
// → 공개 저장소의 '60일 무활동 시 예약 실행 자동 중지' 규칙에 걸리지 않는다.
import path from 'node:path';
import * as L from './lib.mjs';

const status = process.argv[2] || 'failed';
const file = path.join(L.DATA_DIR, 'runs.json');
const runs = await L.readJson(file, []);
const meta = await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {});
const promoted = ['ok', 'degraded'].includes(status);
const rec = {
  at: promoted && meta.runAt ? meta.runAt : new Date().toISOString(),
  status,
  event: process.env.EVENT_NAME || 'local',
  run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
};
if (promoted) {
  rec.new = meta.newIds?.length ?? 0;
  rec.counts = { visible: meta.counts?.visible, pass: meta.counts?.pass, active: meta.counts?.active };
  rec.sources = Object.fromEntries(Object.entries(meta.sources ?? {}).map(([k, s]) => [k, s.status]));
}
runs.push(rec);
await L.writeJson(file, runs.slice(-104));
console.log(`✓ 실행 기록: ${status}`);
