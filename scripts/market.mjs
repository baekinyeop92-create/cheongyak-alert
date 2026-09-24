#!/usr/bin/env node
// 주변 실거래 시세(참고 데이터): 국토부 아파트 매매 실거래가 API 로
// 공고가 있는 시군구의 최근 6개월 중위 ㎡당가를 계산해 meta.market 에 싣는다.
//
// 원칙
//  1) 부가 데이터다 — 어떤 실패도 주간 갱신을 막지 않는다(항상 exit 0, 경고는 meta.market 안에만).
//  2) fetch 와 같은 흐름 — data/next/meta.json 에만 쓰고, 승격은 validate 가 한다.
//  3) 실패한 주는 직전 주의 시세를 stale 로 유지한다(공고 데이터와 같은 태도).
//  4) 표본이 적으면(밴드 5건 미만) 화면이 표시하지 않는다 — 억지로 채우지 않는다.
import path from 'node:path';
import * as L from './lib.mjs';

const KEY = (process.env.RTMS_API_KEY || process.env.APPLYHOME_API_KEY || '').trim();
const BASE = (process.env.RTMS_API_BASE || 'https://apis.data.go.kr/1613000').replace(/\/+$/, '');
const ENABLED = (process.env.MARKET_ENABLED || 'true') !== 'false';
const MONTHS_N = Math.min(12, Math.max(1, Number(process.env.MARKET_MONTHS || 6)));
const ROWS = Number(process.env.MARKET_PAGE_SIZE || 999);
const TODAY = process.env.TODAY || L.kstToday();
const WINDOW_DAYS = 45;   // fetch 와 같은 기준 — 이 기간 안에 마감(예정)인 공고의 시군구만 조회

// 법정동코드 앞 5자리(시군구). 구가 있는 시는 구 코드를 모두 합산한다.
// 부천은 2016 구 폐지·2024 재설치를 거쳤으므로 신·구 코드를 모두 시도한다(없는 코드는 0건으로 무해).
export const LAWD = {
  서울: {
    종로구: ['11110'], 중구: ['11140'], 용산구: ['11170'], 성동구: ['11200'], 광진구: ['11215'],
    동대문구: ['11230'], 중랑구: ['11260'], 성북구: ['11290'], 강북구: ['11305'], 도봉구: ['11320'],
    노원구: ['11350'], 은평구: ['11380'], 서대문구: ['11410'], 마포구: ['11440'], 양천구: ['11470'],
    강서구: ['11500'], 구로구: ['11530'], 금천구: ['11545'], 영등포구: ['11560'], 동작구: ['11590'],
    관악구: ['11620'], 서초구: ['11650'], 강남구: ['11680'], 송파구: ['11710'], 강동구: ['11740'],
  },
  경기: {
    수원시: ['41111', '41113', '41115', '41117'],
    성남시: ['41131', '41133', '41135'],
    의정부시: ['41150'],
    안양시: ['41171', '41173'],
    부천시: ['41190', '41192', '41194', '41196'],
    광명시: ['41210'], 평택시: ['41220'], 동두천시: ['41250'],
    안산시: ['41271', '41273'],
    고양시: ['41281', '41285', '41287'],
    과천시: ['41290'], 구리시: ['41310'], 남양주시: ['41360'], 오산시: ['41370'], 시흥시: ['41390'],
    군포시: ['41410'], 의왕시: ['41430'], 하남시: ['41450'],
    용인시: ['41461', '41463', '41465'],
    파주시: ['41480'], 이천시: ['41500'], 안성시: ['41550'], 김포시: ['41570'], 화성시: ['41590'],
    광주시: ['41610'], 양주시: ['41630'], 포천시: ['41650'], 여주시: ['41670'],
    연천군: ['41800'], 가평군: ['41820'], 양평군: ['41830'],
  },
};

/** TODAY 직전의 '완결된' 달 N개: 2026-09-24 → ['202603', …, '202608'] */
export function recentMonths(todayIso, n = MONTHS_N) {
  const [y, m] = todayIso.split('-').map(Number);
  const out = [];
  for (let i = n; i >= 1; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const unesc = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

/** RTMS XML → [{tag: value}] (item 단위 평면 구조만 가정 — 실측 응답 기준) */
export function parseTradeXml(text) {
  const items = [];
  for (const [, body] of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const row = {};
    for (const [, tag, v] of body.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) row[tag] = unesc(v).trim();
    items.push(row);
  }
  const total = text.match(/<totalCount>(\d+)<\/totalCount>/);
  const code = text.match(/<resultCode>\s*(\w+)\s*<\/resultCode>/);
  return { items, totalCount: total ? Number(total[1]) : null, resultCode: code ? code[1] : null };
}

async function getXml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.HTTP_TIMEOUT_MS || 30000));
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'cheongyak-alert/2.0' } });
  } catch (e) {
    throw new L.ApiError(`네트워크 실패: ${e.cause?.code || e.name || e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED|PERMISSION_DENIED|DEADLINE_HAS_EXPIRED|SERVICE_KEY_IS_NULL/.test(text)) {
    throw new L.ApiError('실거래가 API 활용신청이 안 된 키입니다', { kind: 'auth', fatal: true });
  }
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) throw new L.ApiError('호출 한도 초과', { kind: 'quota' });
  if (!res.ok) throw new L.ApiError(`HTTP ${res.status}`, { fatal: [401, 403, 404].includes(res.status) });
  const parsed = parseTradeXml(text);
  if (parsed.resultCode && !/^0+$/.test(parsed.resultCode)) {
    throw new L.ApiError(`실거래가 API 오류 resultCode=${parsed.resultCode}`);
  }
  return parsed;
}

async function fetchMonth(lawd, ym) {
  const rows = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?${L.qs({ LAWD_CD: lawd, DEAL_YMD: ym, pageNo: page, numOfRows: ROWS }, 'serviceKey', KEY)}`;
    const r = await L.withRetry(`실거래 ${lawd}/${ym} p${page}`, () => getXml(url), { attempts: 2 });
    rows.push(...r.items);
    const total = r.totalCount ?? rows.length;
    if (r.items.length === 0 || rows.length >= total || page >= 10) return { rows, total };
    page += 1;
  }
}

/** 취소(해제)·토지임대부·값 없는 행을 거른 유효 거래만 */
export function usableTrades(items) {
  return items.map((r) => ({
    amount: L.manwon(r.dealAmount),
    area: L.num(r.excluUseAr),
    canceled: L.str(r.cdealType) === 'O',
    landLease: L.str(r.landLeaseholdGbn) === 'Y',
  })).filter((t) => !t.canceled && !t.landLease && t.amount > 0 && t.area > 0);
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const bandOf = (area) => (area < 60 ? 's' : area <= 85 ? 'm' : 'l');

/** 밴드별 중위 ㎡당가(만원, 정수). 표본 수가 함께 간다 — 화면이 5건 미만은 쓰지 않는다. */
export function areaStats(trades) {
  const bands = { s: [], m: [], l: [] };
  for (const t of trades) bands[bandOf(t.area)].push(t.amount / t.area);
  const all = [...bands.s, ...bands.m, ...bands.l];
  const pack = (arr) => (arr.length ? { n: arr.length, m2: Math.round(median(arr)) } : null);
  const out = { n: all.length, bands: {} };
  for (const [k, arr] of Object.entries({ ...bands, all })) {
    const p = pack(arr);
    if (p) out.bands[k] = p;
  }
  return out;
}

async function main() {
  const metaPath = path.join(L.NEXT_DIR, 'meta.json');
  let meta;
  try {
    meta = await L.readJson(metaPath);
  } catch {
    console.error('market: data/next/meta.json 이 없습니다 — fetch.mjs 먼저 실행하세요 (건너뜀)');
    return;
  }
  const prev = (await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {})).market ?? null;
  const hasPrev = prev?.areas && Object.keys(prev.areas).length > 0;
  const keepPrev = (status, note) => {
    meta.market = hasPrev
      ? { ...prev, status: 'stale', staleSince: prev.staleSince ?? TODAY, note }
      : { status, asOf: TODAY, areas: {}, note };
  };

  if (!ENABLED) {
    meta.market = { status: 'disabled', asOf: TODAY, areas: {} };
    await L.writeJson(metaPath, meta);
    return;
  }
  if (!KEY) {
    keepPrev('not-enabled', '인증키 없음');
    await L.writeJson(metaPath, meta);
    console.error('market: 인증키가 없어 건너뜀');
    return;
  }

  const { notices } = await L.readStore(L.NEXT_DIR);
  const cutoff = L.addDays(TODAY, -WINDOW_DAYS);
  const targets = new Map();   // '서울|강서구' → [codes]
  for (const n of Object.values(notices)) {
    if (n.dupOf || !n.sigungu || !LAWD[n.region]) continue;
    if (n.end && n.end < cutoff) continue;
    targets.set(`${n.region}|${n.sigungu}`, LAWD[n.region][n.sigungu] ?? null);
  }

  const months = recentMonths(TODAY);
  console.log(`── 주변 실거래 시세 (${months[0]}~${months.at(-1)}, 시군구 ${targets.size}곳) ──`);
  const areas = {};
  const missing = [];
  const failed = [];
  let streak = 0;   // 시군구 연속 실패 — 2곳 연속이면 전면 장애로 보고 지난 시세를 유지한다
  try {
    for (const [key, codes] of targets) {
      if (!codes) {
        missing.push(key);
        console.warn(`  · ${key}: 법정동코드 미등록 — 표시 생략`);
        continue;
      }
      try {
        const items = [];
        for (const code of codes) {
          for (const ym of months) {
            const r = await fetchMonth(code, ym);
            items.push(...r.rows);
            await L.sleep(Number(process.env.CALL_GAP_MS ?? 120));
          }
        }
        const usable = usableTrades(items);
        const stat = areaStats(usable);
        areas[key] = stat;
        streak = 0;
        console.log(`  ✓ ${key}: 거래 ${usable.length}건 (밴드 ${Object.entries(stat.bands).filter(([k]) => k !== 'all').map(([k, v]) => `${k}:${v.n}`).join(' ') || '없음'})`);
      } catch (e) {
        if (e.kind === 'auth' || e.kind === 'quota') throw e;   // 전체에 해당하는 실패만 위로
        streak += 1;
        failed.push(key);
        console.warn(`  ✗ ${key}: ${L.redact(e.message)} — 이 시군구만 생략`);
        if (streak >= 2) throw new L.ApiError(`시군구 ${streak}곳 연속 실패(${L.redact(e.message)}) — 전면 장애로 판단`);
      }
    }
    meta.market = {
      status: failed.length ? 'partial' : 'ok',
      asOf: TODAY, from: months[0], to: months.at(-1), monthsN: months.length,
      areas, missing, failed,
    };
  } catch (e) {
    // 인증·한도·네트워크 — 어떤 경우에도 주간 갱신은 계속된다
    const note = L.redact(e.message);
    if (e.kind === 'auth') keepPrev('not-enabled', note);
    else keepPrev('error', note);
    console.error(`  ✗ 실거래 조회 중단: ${note}${prev?.areas ? ' — 지난 시세를 유지합니다' : ''}`);
  }
  await L.writeJson(metaPath, meta);
  const a = meta.market.areas ?? {};
  console.log(`  시세 보관: ${Object.keys(a).length}곳 [${meta.market.status}]`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // 마지막 안전망 — 부가 데이터가 파이프라인을 죽이지 않는다
    console.error(`market 실패(무시하고 계속): ${L.redact(e.stack || e.message)}`);
  });
}
