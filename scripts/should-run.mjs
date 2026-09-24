#!/usr/bin/env node
// 월 12:00 KST 예약 실행은 '재시도 슬롯'이다. 06:00 실행이 정상으로 끝났으면 건너뛴다.
// 06:00 실행이 실패·지연됐으면 이 슬롯이 같은 주 안에 다시 수집한다.
import path from 'node:path';
import * as L from './lib.mjs';

const RETRY_CRON = '0 3 * * 1';

const meta = await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {});
const delivery = await L.readJson(path.join(L.DATA_DIR, 'delivery.json'), {});
let run = true;
let reason = '정규 실행';
if (process.env.EVENT_NAME === 'workflow_dispatch') reason = '수동 실행';
if (process.env.EVENT_NAME === 'schedule' && (process.env.EVENT_SCHEDULE || '').trim() === RETRY_CRON) {
  const age = Date.now() - Date.parse(meta.runAt ?? 0);
  // 수집 정상 + 배포·알림까지 끝난(delivery) 경우에만 건너뛴다
  if (meta.status === 'ok' && delivery.lastDeliveredRunAt === meta.runAt && age < 20 * 3600 * 1000) {
    run = false;
    reason = `건너뜀 — ${meta.runAt} 실행이 수집·배포·알림까지 정상 완료`;
  } else {
    reason = '재시도 실행 (직전 실행 실패·경고·배포 미완료)';
  }
}
console.log(`${run ? '▶' : '⏭'} ${reason}`);
await L.setOutput({ run });
