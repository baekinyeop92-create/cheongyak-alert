#!/usr/bin/env node
// 배포와 요약 이슈가 모두 성공한 뒤에만 호출한다. 이 표시가 있어야
//  - 다음 요약이 이번 신규를 다시 알리지 않고
//  - 12시 재시도 슬롯이 건너뛴다.
import path from 'node:path';
import * as L from './lib.mjs';

const runAt = (process.argv[2] || '').trim();
if (!/^\d{4}-\d{2}-\d{2}T/.test(runAt)) {
  console.error(`runAt 형식 오류: "${runAt}"`);
  process.exit(1);
}
await L.writeJson(path.join(L.DATA_DIR, 'delivery.json'), { lastDeliveredRunAt: runAt, deliveredAt: new Date().toISOString() });
console.log(`✓ 전달 완료 표시: ${runAt}`);
