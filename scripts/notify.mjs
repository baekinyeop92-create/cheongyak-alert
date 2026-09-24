#!/usr/bin/env node
// 주간 요약: 아직 알리지 않은 신규 공고 → _out/digest.md (GitHub 이슈 본문) + 선택: 텔레그램
// '아직 알리지 않은' = 마지막으로 배포·이슈까지 성공한 실행(data/delivery.json) 이후 처음 잡힌 공고.
// 배포나 이슈가 실패한 주의 신규 공고는 다음 실행 요약에 그대로 넘어간다.
// 이슈는 워크플로가 gh CLI 로 올린다. 저장소 주인이 @멘션되므로 GitHub 알림 메일이 간다.
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { evaluate, statusOf, priceSummary, span, SOURCE_LABEL, DEFAULT_CAP, eok } from '../site/core.js';
import * as L from './lib.mjs';

const OUT = path.resolve(process.env.DIGEST_DIR || path.join(L.ROOT, '_out'));

function row(n, today) {
  const p = priceSummary(n);
  const st = statusOf(n, today);
  const where = [n.region, n.sigungu].filter(Boolean).join(' ');
  const price = p.ev.bucket === 'unknown' ? '가격 미확인' : `${p.range}${p.area ? ` (${p.area})` : ''}`;
  const link = n.url || n.lhUrl;
  const name = String(n.name).replace(/\|/g, '/').replace(/([[\]])/g, '\\$1');
  return `| ${st.label} | ${where} | ${link ? `[${name}](${link})` : name} | ${SOURCE_LABEL[n.source]} | ${price} | ${span(n.start, n.end) || '—'} |`;
}

const HEAD = '| 상태 | 지역 | 공고 | 유형 | 분양가 | 접수 |\n|---|---|---|---|---|---|';

async function main() {
  const store = await L.readStore(L.DATA_DIR);
  const meta = await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {});
  const today = meta.today ?? L.kstToday();
  const site = L.siteUrl();
  const all = Object.values(store.notices).filter((n) => !n.dupOf);
  const delivery = await L.readJson(path.join(L.DATA_DIR, 'delivery.json'), {});
  const since = delivery.lastDeliveredRunAt ?? null;
  const isNew = (n) => !since || (n.firstSeenAt ?? '') > since;
  const MAX = 60;
  const table = (list) => `${HEAD}\n${list.slice(0, MAX).map((n) => row(n, today)).join('\n')}${list.length > MAX ? `\n\n외 ${list.length - MAX}건 — 사이트에서 확인` : ''}\n`;
  const by = (b) => all.filter((n) => isNew(n) && evaluate(n).bucket === b).sort((a, c) => statusOf(a, today).order - statusOf(c, today).order);
  const pass = by('pass');
  const border = by('border');
  const unknown = by('unknown');
  const closing = all.filter((n) => !isNew(n) && evaluate(n).bucket === 'pass' && ['closing', 'open'].includes(statusOf(n, today).key) && n.end && n.end <= L.addDays(today, 7));

  const owner = (process.env.GITHUB_REPOSITORY || '').split('/')[0];
  const lines = [];
  if (owner) lines.push(`@${owner} 이번 주 서울·경기 청약 공고입니다.\n`);
  lines.push(`**기준** 주택형 최고 분양가 ${eok(DEFAULT_CAP)} 이하 · 갱신 ${String(meta.runAt ?? '').slice(0, 16).replace('T', ' ')} UTC · 점검 ${meta.status === 'ok' ? '정상' : `⚠ ${meta.status}`}\n`);
  if (!since) lines.push('_첫 요약이라 현재 보관 중인 공고 전체를 신규로 표시합니다._\n');
  if (pass.length) lines.push(`### 신규 · ${eok(DEFAULT_CAP)} 이하 ${pass.length}건\n${table(pass)}`);
  if (border.length) lines.push(`### 신규 · 경계(상한 초과 10% 이내 — 일부 세대는 상한 이하일 수 있음) ${border.length}건\n${table(border)}`);
  if (unknown.length) lines.push(`### 신규 · 가격 미확인(공고문 확인 필요) ${unknown.length}건\n${table(unknown)}`);
  if (closing.length) lines.push(`### 7일 안에 마감 (기존 공고) ${closing.length}건\n${table(closing)}`);
  if (meta.validation?.warnings?.length) lines.push(`### ⚠ 점검 경고\n${meta.validation.warnings.map((w) => `- ${w}`).join('\n')}\n`);
  if (site) lines.push(`---\n전체 목록·필터: ${site}  ·  RSS: ${site}feed.xml`);

  const count = pass.length + border.length + unknown.length;
  const title = `청약 알림 ${today} — 신규 ${count}건 (${eok(DEFAULT_CAP)} 이하 ${pass.length})`;
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'digest.md'), `${lines.join('\n')}\n`);
  await writeFile(path.join(OUT, 'digest-title.txt'), title);
  await writeFile(path.join(OUT, 'run-at.txt'), String(meta.runAt ?? ''));
  console.log(`✓ 요약: ${title}`);
  await L.setOutput({ digest_count: count });

  // 선택: 텔레그램 (Secrets 에 TG_TOKEN·TG_CHAT_ID 가 있을 때만)
  const token = process.env.TG_TOKEN;
  const chat = process.env.TG_CHAT_ID;
  if (token && chat && count) {
    const text = [title, ...[...pass, ...border, ...unknown].slice(0, 15).map((n) => {
      const p = priceSummary(n);
      return `• ${[n.region, n.sigungu].filter(Boolean).join(' ')} ${n.name} — ${p.ev.bucket === 'unknown' ? '가격 미확인' : p.range} · ${statusOf(n, today).label}`;
    }), site].filter(Boolean).join('\n');
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      });
      console.log(res.ok ? '✓ 텔레그램 전송' : `! 텔레그램 실패 HTTP ${res.status}`);
    } catch (e) {
      console.warn(`! 텔레그램 실패: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(`요약 실패: ${e.stack || e.message}`);
  process.exit(1);
});
