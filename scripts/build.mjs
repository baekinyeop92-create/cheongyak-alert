#!/usr/bin/env node
// 사이트 빌드: site/ + data/ → _site/ (GitHub Pages 가 그대로 서빙)
// 주소(도메인)는 저장소 이름으로 고정된다. 이 스크립트는 Pages 설정·CNAME 을 바꾸지 않는다.
import path from 'node:path';
import { cp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluate, statusOf, priceSummary, span, SOURCE_LABEL } from '../site/core.js';
import * as L from './lib.mjs';

const OUT = path.resolve(process.env.OUT_DIR || path.join(L.ROOT, '_site'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function feed(notices, meta, site) {
  const items = notices
    .filter((n) => ['pass', 'border', 'unknown'].includes(evaluate(n).bucket))
    .sort((a, b) => (b.firstSeenAt ?? '').localeCompare(a.firstSeenAt ?? ''))
    .slice(0, 100)
    .map((n) => {
      const p = priceSummary(n);
      const where = [n.region, n.sigungu].filter(Boolean).join(' ');
      const tag = p.ev.bucket === 'pass' ? p.range : p.ev.bucket === 'border' ? `경계 ${p.range}` : '가격 미확인';
      const s = n.start || n.end ? ` · 접수 ${span(n.start, n.end)}` : '';
      const title = `[${where}] ${n.name} — ${tag}${s}`;
      const link = n.url || n.lhUrl || site;
      const desc = `${SOURCE_LABEL[n.source]}${n.kind ? ` · ${n.kind}` : ''} · ${statusOf(n, meta.today).label}${n.units ? ` · ${n.units}세대` : ''}`;
      return `<item><title>${esc(title)}</title><link>${esc(link)}</link><guid isPermaLink="false">${esc(n.id)}</guid><pubDate>${new Date(n.firstSeenAt).toUTCString()}</pubDate><description>${esc(desc)}</description></item>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>청약 알림 — 서울·경기 분양가 13억 이하</title>
<link>${esc(site || './')}</link>
<description>청약홈·LH 공고 중 서울·경기, 주택형 최고 분양가 13억 이하(경계·가격 미확인 포함). 매주 갱신.</description>
<lastBuildDate>${new Date(meta.runAt ?? Date.now()).toUTCString()}</lastBuildDate>
${items.join('\n')}
</channel></rss>
`;
}

async function main() {
  const store = await L.readStore(L.DATA_DIR);
  const meta = await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {});
  const runs = await L.readJson(path.join(L.DATA_DIR, 'runs.json'), []);
  const notices = Object.values(store.notices);
  const site = L.siteUrl();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(path.join(L.ROOT, 'site'), OUT, { recursive: true });

  const pub = {
    generatedAt: new Date().toISOString(),
    meta: {
      runAt: meta.runAt ?? null, prevRunAt: meta.prevRunAt ?? null, firstRunAt: meta.firstRunAt ?? null, today: meta.today ?? null, status: meta.status ?? 'none',
      windowStart: meta.windowStart ?? null, lastSuccessAt: meta.lastSuccessAt ?? null,
      sources: meta.sources ?? {}, price: meta.price ?? {}, counts: meta.counts ?? {},
      warnings: meta.validation?.warnings ?? [], newIds: meta.newIds ?? [],
    },
    runs: runs.slice(-12),
    notices: notices
      .filter((n) => !n.dupOf)
      .map(({ sig, houseManageNo, ...rest }) => rest),
  };
  await writeFile(path.join(OUT, 'data.json'), JSON.stringify(pub));
  await writeFile(path.join(OUT, 'feed.xml'), feed(pub.notices, { ...meta, today: meta.today ?? L.kstToday() }, site));

  // 캐시 무효화: 데이터가 바뀌면 app.js·core.js 주소가 바뀌어 브라우저가 옛 코드를 쓰지 않는다
  const build = createHash('sha1').update(`${meta.runAt}|${Date.now()}`).digest('hex').slice(0, 8);
  for (const f of ['index.html', 'app.js']) {
    const p = path.join(OUT, f);
    await writeFile(p, (await readFile(p, 'utf8')).replaceAll('__BUILD__', build));
  }
  console.log(`✓ 빌드 ${path.relative(L.ROOT, OUT) || OUT}: 공고 ${pub.notices.length}건 · build ${build}${site ? ` · ${site}` : ''}`);
}

main().catch((e) => {
  console.error(`빌드 실패: ${e.stack || e.message}`);
  process.exit(1);
});
