#!/usr/bin/env node
// 수집: 청약홈 분양정보 4종 + LH 분양·신혼희망타운 공고 → data/next/
//
// data/store.json 은 여기서 건드리지 않는다. validate.mjs 가 검사를 통과한 결과만 승격한다.
// 원칙
//  1) 전량 수집 — 페이지를 끝까지 돌고, 받은 건수가 API 가 말한 총건수와 다르면 그 소스는 실패로 본다
//  2) 삭제 금지 — 한 번 저장된 공고는 API 에서 사라져도 지우지 않고 missingSince 로 표시만 한다
//  3) 공백 메우기 — 소스별 마지막 성공일 이후 기간은 자동으로 다시 훑는다
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { countBuckets, REGIONS } from '../site/core.js';
import * as L from './lib.mjs';

const KEY = (process.env.APPLYHOME_API_KEY || '').trim();
const LH_KEY = (process.env.LH_API_KEY || KEY).trim();
const APPLY_BASE = (process.env.APPLYHOME_API_BASE || 'https://api.odcloud.kr/api').replace(/\/+$/, '');
const LH_BASE = (process.env.LH_API_BASE || 'https://apis.data.go.kr/B552555').replace(/\/+$/, '');
const LH_ENABLED = (process.env.LH_ENABLED || 'true') !== 'false';
const PER_PAGE = Number(process.env.PER_PAGE || 500);
const LH_PAGE = Number(process.env.LH_PAGE_SIZE || 100);
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 45);
const MAX_CATCHUP_DAYS = 400;
const TODAY = process.env.TODAY || L.kstToday();
const RUN_AT = process.env.RUN_AT || new Date().toISOString();
const SERVICE = 'ApplyhomeInfoDetailSvc/v1';

// 오퍼레이션 이름은 문서·구현마다 대소문자가 갈린다(getOPT… / getOpt…). 후보를 순서대로 시도한다.
const SOURCES = [
  { key: 'apt', label: '아파트', ops: ['getAPTLttotPblancDetail'], mdl: ['getAPTLttotPblancMdl'] },
  { key: 'remndr', label: '무순위·잔여', ops: ['getRemndrLttotPblancDetail'], mdl: ['getRemndrLttotPblancMdl'] },
  { key: 'opt', label: '임의공급', ops: ['getOPTLttotPblancDetail', 'getOptLttotPblancDetail'], mdl: ['getOPTLttotPblancMdl', 'getOptLttotPblancMdl'] },
  { key: 'urbty', label: '오피스텔·도시형', ops: ['getUrbtyOfctlLttotPblancDetail'], mdl: ['getUrbtyOfctlLttotPblancMdl'] },
];
// 범위 밖: 임대(분양가 개념 없음)·생활숙박시설(주택 아님). 버리지 않고 건수는 점검표에 남긴다.
const EXCLUDED_KIND = /민간임대|생활숙박/;

// 무순위·임의공급 ↔ 본청약(원공고) 연결용 이름 정규화.
// 재공급 수식어만 걷어내고 차수 "(2차)" 같은 구분은 남긴다 — 다른 차수를 같은 단지로 합치지 않기 위해.
const RESUPPLY_WORDS = '무순위|잔여\\s*세대|임의공급|계약\\s*취소|취소\\s*후\\s*재공급|재공급|사후\\s*접수|선착순|불법\\s*행위';
const RESUPPLY_RE = new RegExp(RESUPPLY_WORDS, 'g');
const RESUPPLY_TEST = new RegExp(`${RESUPPLY_WORDS}|공고|접수`);
function complexKey(name) {
  let s = String(name ?? '').replace(/\[.*?\]/g, ' ');
  s = s.replace(/\(([^()]*)\)/g, (m, inner) => (RESUPPLY_TEST.test(inner) ? ' ' : m));
  s = s.replace(RESUPPLY_RE, ' ').replace(/입주자\s*모집\s*공고|모집\s*공고|정정\s*공고|공고/g, ' ');
  return s.replace(/\s+/g, '').toUpperCase();
}

/**
 * 무순위·임의공급 공고에 본청약의 공급규모(단지 세대수)를 연결한다.
 * 청약홈 APT·오피스텔 목록은 매주 전량(2019~) 내려받으므로 원공고가 그 안에 있다.
 * 이름(차수 포함)·지역이 정확히 같고, 원공고가 더 크고 더 과거일 때만 — 애매하면 붙이지 않는다.
 * 이번 주 목록을 못 받았으면(origins 비어 있음) 기존 값을 지우지 않고 그대로 둔다.
 */
function annotateComplex(store, origins) {
  if (!origins.length) return { linked: 0, total: 0 };
  const byKey = new Map();
  for (const o of origins) {
    if (!o.key) continue;
    const k = `${o.region}|${o.key}`;
    byKey.set(k, [...(byKey.get(k) ?? []), o]);
  }
  let linked = 0;
  let total = 0;
  const lookup = (n, name) => (byKey.get(`${n.region}|${complexKey(name)}`) ?? []).filter((o) =>
    o.units >= (n.units ?? 0) && (!o.noticeDate || !n.noticeDate || o.noticeDate <= n.noticeDate));
  for (const n of Object.values(store)) {
    if (!['remndr', 'opt'].includes(n.source)) continue;
    total += 1;
    // "○○(2차)" 의 (2차)는 대개 '무순위 2차'라는 뜻 — 차수 포함 정확 일치를 먼저, 실패하면 차수를 떼고 재시도
    let cands = lookup(n, n.name);
    if (!cands.length && /\(\s*\d+\s*차\s*\)/.test(n.name)) {
      cands = lookup(n, n.name.replace(/\(\s*\d+\s*차\s*\)/g, ' '));
    }
    if (!cands.length) continue;
    const best = cands.sort((a, b) => (b.noticeDate ?? '').localeCompare(a.noticeDate ?? ''))[0];
    n.complexUnits = best.units;
    if (best.url) n.complexUrl = best.url;
    linked += 1;
  }
  return { linked, total };
}

const LH_REGION = { 11: '서울', 41: '경기' };
const LH_TYPES = { '05': '분양주택', 39: '신혼희망타운' };

// ---------- 청약홈 ----------

async function fetchPages(op, cond = {}, retries = 4) {
  const rows = [];
  let expected = null;
  let page = 1;
  for (;;) {
    const url = `${APPLY_BASE}/${SERVICE}/${op}?${L.qs({ page, perPage: PER_PAGE, ...cond }, 'serviceKey', KEY)}`;
    const json = await L.withRetry(`${op} p${page}`, () => L.getJson(url), { attempts: retries });
    if (!Array.isArray(json.data)) throw new L.ApiError(`${op} p${page}: data 배열 없음`);
    const exp = Number(json.matchCount ?? json.totalCount);
    if (expected == null && Number.isFinite(exp)) expected = exp;
    rows.push(...json.data);
    if (json.data.length === 0 || json.data.length < PER_PAGE || (expected != null && rows.length >= expected)) break;
    page += 1;
    if (page > 80) throw new L.ApiError(`${op}: 페이지 상한(80) 초과`, { fatal: true });
  }
  return { rows, expected: expected ?? rows.length, pages: page };
}

const rowId = (r) => `${L.str(r.HOUSE_MANAGE_NO) ?? ''}:${L.str(r.PBLANC_NO) ?? ''}`;

/**
 * 오퍼레이션 후보 순회 + 전량 검증(건수 일치·중복 없음). 불일치면 소스 전체를 다시 받는다.
 * 수집 도중 새 공고가 끼어들면 페이지 경계가 밀려 한 건은 두 번, 한 건은 0번 받게 된다 — 중복 검사가 그걸 잡는다.
 */
async function fetchComplete(ops, cond, cache, cacheKey, { unique: checkUnique = true, outer = 3, retries = 4 } = {}) {
  const order = cache[cacheKey] ? [cache[cacheKey], ...ops.filter((o) => o !== cache[cacheKey])] : ops;
  let lastErr;
  for (const op of order) {
    for (let attempt = 1; attempt <= outer; attempt += 1) {
      try {
        const res = await fetchPages(op, cond, retries);
        const unique = new Set(res.rows.map(rowId)).size;
        if (res.rows.length !== res.expected) {
          throw new L.ApiError(`${op}: 기대 ${res.expected}건 ≠ 수집 ${res.rows.length}건`, { kind: 'incomplete' });
        }
        if (checkUnique && unique !== res.rows.length) {
          throw new L.ApiError(`${op}: 중복 ${res.rows.length - unique}건 (수집 중 목록이 바뀐 것으로 보임)`, { kind: 'incomplete' });
        }
        cache[cacheKey] = op;
        return { ...res, op };
      } catch (e) {
        lastErr = e;
        if (e.kind === 'no-operation') break;           // 다음 이름 후보로
        if (e.fatal) throw e;                           // 인증 등은 바로 중단
        if (attempt < outer) {
          console.warn(`  ↻ ${op} 전량 재수집(${attempt}/${outer}): ${e.message}`);
          await L.sleep(Number(process.env.RETRY_BASE_MS ?? 3000));
        }
      }
    }
    if (lastErr?.kind !== 'no-operation') throw lastErr;
  }
  throw lastErr;
}

function phase(row, label, a, b) {
  const start = L.toIso(row[a]);
  const end = L.toIso(row[b]) ?? start;
  return start || end ? { label, start: start ?? end, end } : null;
}

function mergePhases(label, list) {
  const p = list.filter(Boolean);
  if (!p.length) return null;
  const starts = p.map((x) => x.start).filter(Boolean).sort();
  const ends = p.map((x) => x.end).filter(Boolean).sort();
  return { label, start: starts[0] ?? null, end: ends.at(-1) ?? null };
}

function schedule(row, src) {
  let list;
  if (src.key === 'apt') {
    const r1 = mergePhases('1순위', [
      phase(row, '', 'GNRL_RNK1_CRSPAREA_RCPTDE', 'GNRL_RNK1_CRSPAREA_ENDDE'),
      phase(row, '', 'GNRL_RNK1_ETC_GG_RCPTDE', 'GNRL_RNK1_ETC_GG_ENDDE'),
      phase(row, '', 'GNRL_RNK1_ETC_AREA_RCPTDE', 'GNRL_RNK1_ETC_AREA_ENDDE'),
    ]);
    const r2 = mergePhases('2순위', [
      phase(row, '', 'GNRL_RNK2_CRSPAREA_RCPTDE', 'GNRL_RNK2_CRSPAREA_ENDDE'),
      phase(row, '', 'GNRL_RNK2_ETC_GG_RCPTDE', 'GNRL_RNK2_ETC_GG_ENDDE'),
      phase(row, '', 'GNRL_RNK2_ETC_AREA_RCPTDE', 'GNRL_RNK2_ETC_AREA_ENDDE'),
    ]);
    list = [phase(row, '특별공급', 'SPSPLY_RCEPT_BGNDE', 'SPSPLY_RCEPT_ENDDE'), r1, r2].filter(Boolean);
    const all = phase(row, '청약접수', 'RCEPT_BGNDE', 'RCEPT_ENDDE');
    if (!list.length && all) list = [all];
    else if (all) list.push({ ...all, hidden: true });   // 전체 범위는 계산에만 쓴다
  } else {
    list = [
      phase(row, '특별공급', 'SPSPLY_RCEPT_BGNDE', 'SPSPLY_RCEPT_ENDDE'),
      phase(row, '일반공급', 'GNRL_RCEPT_BGNDE', 'GNRL_RCEPT_ENDDE'),
    ].filter(Boolean);
    const all = phase(row, '청약접수', 'SUBSCRPT_RCEPT_BGNDE', 'SUBSCRPT_RCEPT_ENDDE');
    if (!list.length && all) list = [all];
    else if (all) list.push({ ...all, hidden: true });
  }
  return list;
}

function normalizeApply(row, src) {
  const pblancNo = L.str(row.PBLANC_NO);
  const houseManageNo = L.str(row.HOUSE_MANAGE_NO);
  const name = L.str(row.HOUSE_NM);
  if (!name || (!pblancNo && !houseManageNo)) return null;
  const address = L.str(row.HSSPLY_ADRES);
  const sched = schedule(row, src);
  const starts = sched.map((p) => p.start).filter(Boolean).sort();
  const ends = sched.map((p) => p.end).filter(Boolean).sort();
  const secd = L.str(row.HOUSE_SECD_NM);
  const dtl = L.str(row.HOUSE_DTL_SECD_NM);
  const kind = src.key === 'apt' ? (secd && secd !== 'APT' ? secd : dtl ?? secd) : src.key === 'urbty' ? dtl ?? secd : secd ?? dtl;
  const flags = [];
  if (row.PARCPRC_ULS_AT === 'Y') flags.push('분양가상한제');
  if (row.SPECLT_RDN_EARTH_AT === 'Y') flags.push('투기과열지구');
  if (row.MDAT_TRGET_AREA_SECD === 'Y') flags.push('조정대상지역');
  if (row.PUBLIC_HOUSE_EARTH_AT === 'Y') flags.push('공공택지');
  let url = L.str(row.PBLANC_URL);
  if (!/^https?:\/\//.test(url ?? '')) {
    url = src.key === 'apt' && houseManageNo && pblancNo
      ? `https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=${houseManageNo}&pblancNo=${pblancNo}`
      : null;
  }
  let homepage = L.str(row.HMPG_ADRES);
  if (homepage && !/^https?:\/\//.test(homepage)) homepage = `http://${homepage}`;
  return {
    id: `${src.key}:${houseManageNo ?? ''}:${pblancNo ?? ''}`,
    source: src.key,
    houseManageNo,
    pblancNo,
    name,
    kind,
    detailKind: dtl,
    region: L.regionOf(row.SUBSCRPT_AREA_CODE_NM, address),
    sigungu: L.sigunguOf(address),
    address,
    units: L.int(row.TOT_SUPLY_HSHLDCO),
    noticeDate: L.toIso(row.RCRIT_PBLANC_DE),
    schedule: sched,
    start: starts[0] ?? null,
    end: ends.at(-1) ?? null,
    winnerDate: L.toIso(row.PRZWNER_PRESNATN_DE),
    contract: phase(row, '계약', 'CNTRCT_CNCLS_BGNDE', 'CNTRCT_CNCLS_ENDDE'),
    moveIn: L.toYm(row.MVN_PREARNGE_YM),
    builder: L.str(row.CNSTRCT_ENTRPS_NM),
    developer: L.str(row.BSNS_MBY_NM),
    tel: L.str(row.MDHS_TELNO),
    flags,
    url,
    homepage,
  };
}

// 특별공급 유형별 세대수(APT 주택형 API). 자격 '조건' 자체는 API 에 없다 — 유형별 물량만 온다.
const SP_FIELDS = {
  newly: 'NWWDS_HSHLDCO', first: 'LFE_FRST_HSHLDCO', multi: 'MNYCH_HSHLDCO',
  young: 'YGMN_HSHLDCO', newborn: 'NWBB_HSHLDCO', old: 'OLD_PARNTS_SUPORT_HSHLDCO',
  org: 'INSTT_RECOMEND_HSHLDCO', transfer: 'TRANSR_INSTT_ENFSN_HSHLDCO', etc: 'ETC_HSHLDCO',
};

function parseType(r) {
  const label = L.str(r.HOUSE_TY) ?? L.str(r.TP) ?? L.str(r.HOUSE_TY_NM) ?? L.str(r.MODEL_NO);
  const area = L.num(r.EXCLUSE_AR) ?? L.num(r.EXCLU_AR) ?? L.areaFromType(label);
  const price = L.manwon(r.LTTOT_TOP_AMOUNT ?? r.SUPLY_AMOUNT);
  const general = L.int(r.SUPLY_HSHLDCO);
  const special = L.int(r.SPSPLY_HSHLDCO);
  const units = general == null && special == null ? null : (general ?? 0) + (special ?? 0);
  if (!label && area == null && price == null) return null;
  const sp = {};
  for (const [k, f] of Object.entries(SP_FIELDS)) {
    const v = L.int(r[f]);
    if (v > 0) sp[k] = v;
  }
  const t = { type: label, area, supplyArea: L.num(r.SUPLY_AR), units, general, special, price };
  if (Object.keys(sp).length) t.sp = sp;
  return t;
}

async function fetchTypes(src, n, ctx) {
  // 주택형 행은 공고번호가 모두 같으므로 중복 검사는 끄고 건수 일치만 본다.
  // 공고 수십 건에 대해 부르므로 재시도는 짧게(2×3회) — 장애 시 전체 작업이 시간 초과로 죽지 않게.
  const res = await fetchComplete(src.mdl, { 'cond[PBLANC_NO::EQ]': n.pblancNo }, ctx.opCache, `${src.key}:mdl`, { unique: false, outer: 2, retries: 3 });
  let rows = res.rows;
  if (n.houseManageNo && rows.some((r) => L.str(r.HOUSE_MANAGE_NO))) {
    rows = rows.filter((r) => L.str(r.HOUSE_MANAGE_NO) === n.houseManageNo);
  }
  const fill = ctx.priceFill[src.key] ??= { rows: 0, priced: 0 };
  fill.rows += rows.length;
  fill.priced += rows.filter((r) => L.manwon(r.LTTOT_TOP_AMOUNT ?? r.SUPLY_AMOUNT) != null).length;
  return rows
    .map(parseType)
    .filter(Boolean)
    .sort((a, b) => (a.area ?? 0) - (b.area ?? 0) || (a.price ?? 0) - (b.price ?? 0));
}

function inWindow(n, windowStart) {
  if (n.end) return n.end >= windowStart;
  if (n.noticeDate) return n.noticeDate >= L.addDays(TODAY, -180);
  return true;   // 날짜를 전혀 모르면 판단 불가 → 버리지 않는다
}

function sourceWindow(prevSource) {
  const base = L.addDays(TODAY, -WINDOW_DAYS);
  const last = prevSource?.lastOkToday;
  if (!last) return base;
  const catchup = L.addDays(last, -7);
  const floor = L.addDays(TODAY, -MAX_CATCHUP_DAYS);
  const w = catchup < base ? catchup : base;
  return w < floor ? floor : w;
}

function merge(store, n, types, ctx) {
  const prev = store[n.id];
  const next = { ...(prev ?? {}), ...n };
  if (types && !types.length && prev?.types?.length) {
    // 정정·API 누락으로 주택형이 비어 돌아와도 이전 분양가를 지우지 않는다(경고만)
    next.types = prev.types;
    next.priceStatus = 'stale';
    ctx.meta.warnings.push(`${n.name}: 주택형 목록이 비어 돌아옴 — 직전 분양가 유지, 공고문 확인 필요`);
  } else if (types) {
    next.types = types;
    next.priceStatus = types.length ? 'ok' : 'empty';
  } else {
    next.types = prev?.types ?? [];
    next.priceStatus = prev?.types?.length ? 'stale' : n.source === 'lh' ? 'lh' : 'error';
  }
  next.firstSeenAt = prev?.firstSeenAt ?? RUN_AT;
  next.lastSeenAt = RUN_AT;
  delete next.missingSince;
  const sig = L.signature(next);
  next.updatedAt = !prev || prev.sig !== sig ? RUN_AT : prev.updatedAt;
  next.sig = sig;
  if (!prev) ctx.meta.newIds.push(n.id);
  store[n.id] = next;
}

function markMissing(store, sourceKey, returned, windowStart) {
  let missing = 0;
  for (const s of Object.values(store)) {
    if (s.source !== sourceKey || returned.has(s.id)) continue;
    if ((s.end ?? s.noticeDate ?? '9999') >= windowStart) {
      if (!s.missingSince) s.missingSince = TODAY;
      missing += 1;
    }
  }
  return missing;
}

async function runApplySource(src, ctx) {
  const prev = ctx.prevMeta.sources?.[src.key];
  const windowStart = sourceWindow(prev);
  const st = {
    label: src.label, status: 'ok', operation: null, expected: 0, fetched: 0, pages: 0,
    inRegion: 0, excluded: 0, inWindow: 0, missing: 0, windowStart,
    lastOkToday: prev?.lastOkToday ?? null, error: null,
  };
  ctx.meta.sources[src.key] = st;
  console.log(`▶ ${src.label} (기간 ${windowStart} ~)`);

  let res;
  try {
    res = await fetchComplete(src.ops, {}, ctx.opCache, src.key);
  } catch (e) {
    st.status = e.kind === 'auth' ? 'auth' : 'error';
    st.error = L.redact(e.message);
    console.error(`  ✗ ${src.label}: ${st.error}`);
    return;
  }
  Object.assign(st, { operation: res.op, expected: res.expected, fetched: res.rows.length, pages: res.pages });

  // 필드명이 바뀌면 에러 없이 0건이 된다. 채움률로 잡는다.
  if (res.rows.length >= 20) {
    const fill = {
      HOUSE_NM: L.fillRate(res.rows, 'HOUSE_NM'),
      PBLANC_NO: L.fillRate(res.rows, 'PBLANC_NO'),
      region: res.rows.filter((r) => L.str(r.SUBSCRPT_AREA_CODE_NM) || L.str(r.HSSPLY_ADRES)).length / res.rows.length,
    };
    st.fill = fill;
    const bad = Object.entries(fill).filter(([, v]) => v < 0.8).map(([k, v]) => `${k} ${Math.round(v * 100)}%`);
    if (bad.length) {
      st.status = 'schema';
      st.error = `필드 채움률 낮음(필드명 변경 의심): ${bad.join(', ')}`;
      console.error(`  ✗ ${src.label}: ${st.error}`);
      return;
    }
  }

  const returned = new Set();
  const targets = [];
  const regionUnknown = [];
  for (const row of res.rows) {
    const n = normalizeApply(row, src);
    if (!n) continue;
    if (!REGIONS.includes(n.region)) {
      // 시·도를 아예 못 읽은 행은 서울·경기일 수도 있으므로 조용히 버리지 않고 경고로 남긴다
      if (!L.knownSido(row.SUBSCRPT_AREA_CODE_NM, n.address) && inWindow(n, windowStart)) regionUnknown.push(n.name);
      continue;
    }
    st.inRegion += 1;
    // 본청약(원공고) 색인 — 기간 필터 '앞'에서 모은다(무순위의 원공고는 수년 전일 수 있음)
    if ((src.key === 'apt' || src.key === 'urbty') && n.units > 0) {
      ctx.origins.push({ key: complexKey(n.name), region: n.region, units: n.units, noticeDate: n.noticeDate, url: n.url });
    }
    // 세부유형이 있을 때만 제외한다. 없으면 묶음 이름("도시형/오피스텔/생활숙박시설/민간임대")에 걸려 전부 빠지므로 남긴다.
    if (src.key === 'urbty' && EXCLUDED_KIND.test(n.detailKind ?? '')) {
      st.excluded += 1;
      continue;
    }
    if (!inWindow(n, windowStart) && !ctx.store[n.id]) continue;
    returned.add(n.id);
    targets.push(n);
  }
  st.inWindow = targets.length;
  if (regionUnknown.length) {
    st.regionUnknown = regionUnknown.length;
    ctx.meta.warnings.push(`${src.label}: 시·도를 읽지 못한 공고 ${regionUnknown.length}건(서울·경기 여부 확인 필요) — ${regionUnknown.slice(0, 3).join(', ')}`);
  }

  // 주택형 조회. 연속 3회 실패하면 장애로 보고 나머지는 건너뛴다(직전 분양가 유지, 경고) — 작업 시간 초과 방지
  let streak = 0;
  let skipped = 0;
  for (const n of targets) {
    const prevN = ctx.store[n.id];
    const needPrice = !prevN || !prevN.types?.length || !n.end || n.end >= L.addDays(TODAY, -7) || prevN.noticeDate !== n.noticeDate;
    let types = null;
    if (needPrice && n.pblancNo && streak >= 3) {
      skipped += 1;
      ctx.meta.price.errors += 1;
    } else if (needPrice && n.pblancNo) {
      try {
        types = await fetchTypes(src, n, ctx);
        ctx.meta.price.calls += 1;
        if (!types.length) ctx.meta.price.empty += 1;
        streak = 0;
      } catch (e) {
        streak += 1;
        ctx.meta.price.errors += 1;
        ctx.meta.warnings.push(`${src.label} · ${n.name}: 주택형 조회 실패 — ${L.redact(e.message)}`);
      }
      await L.sleep(Number(process.env.CALL_GAP_MS ?? 120));
    }
    merge(ctx.store, n, types, ctx);
  }
  if (skipped) ctx.meta.warnings.push(`${src.label}: 주택형 API 연속 실패로 ${skipped}건 조회 생략 — 다음 실행에서 다시 조회`);
  const fill = ctx.priceFill[src.key];
  if (fill && fill.rows >= 5 && fill.priced / fill.rows < 0.5) {
    ctx.meta.warnings.push(`${src.label}: 주택형 ${fill.rows}행 중 분양가 있는 행 ${fill.priced}개 — 금액 필드명 변경 의심`);
  }
  st.missing = markMissing(ctx.store, src.key, returned, windowStart);
  st.lastOkToday = TODAY;
  console.log(`  ✓ ${st.fetched}/${st.expected}건 (${st.pages}p) → 서울·경기 ${st.inRegion} → 기간 내 ${st.inWindow}${st.missing ? ` · API에서 사라짐 ${st.missing}` : ''}`);
}

// ---------- LH ----------

function lhRows(json) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if ('PAN_ID' in v) out.push(v);
      else Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return out;
}

function lhFailed(json) {
  let bad = null;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (v.SS_CODE && v.SS_CODE !== 'Y') bad = v.SS_CODE;
      Object.values(v).forEach(walk);
    }
  };
  walk(json);
  return bad;
}

const dot = (iso) => iso.replaceAll('-', '.');

async function runLh(ctx) {
  const prev = ctx.prevMeta.sources?.lh;
  const windowStart = sourceWindow(prev);
  const st = {
    label: 'LH 공고', status: 'ok', operation: 'lhLeaseNoticeInfo1', expected: 0, fetched: 0, pages: 0,
    inRegion: 0, excluded: 0, inWindow: 0, missing: 0, windowStart,
    lastOkToday: prev?.lastOkToday ?? null, error: null,
  };
  ctx.meta.sources.lh = st;
  if (!LH_ENABLED) {
    st.status = 'disabled';
    return;
  }
  console.log(`▶ LH 공고 (기간 ${windowStart} ~)`);
  const returned = new Set();
  try {
    for (const [cnp, region] of Object.entries(LH_REGION)) {
      for (const upp of Object.keys(LH_TYPES)) {
        const code = upp.padStart(2, '0');
        let page = 1;
        let expected = null;
        const got = new Map();
        for (;;) {
          const params = {
            PG_SZ: LH_PAGE, PAGE: page, UPP_AIS_TP_CD: code, CNP_CD: cnp,
            PAN_NT_ST_DT: dot(L.addDays(windowStart, -120)), CLSG_DT: dot(L.addDays(TODAY, 730)),
          };
          const url = `${LH_BASE}/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1?${L.qs(params, 'serviceKey', LH_KEY)}`;
          const json = await L.withRetry(`LH ${region}/${code} p${page}`, () => L.getJson(url));
          const bad = lhFailed(json);
          if (bad) throw new L.ApiError(`LH 결과코드 ${bad}`);
          const rows = lhRows(json);
          if (expected == null) {
            const c = rows.map((r) => Number(r.ALL_CNT)).find(Number.isFinite);
            expected = c ?? 0;
          }
          rows.forEach((r) => got.set(String(r.PAN_ID), r));
          st.pages += 1;
          if (rows.length < LH_PAGE || got.size >= expected) break;
          page += 1;
          if (page > 50) throw new L.ApiError('LH 페이지 상한 초과');
        }
        if (got.size !== expected) throw new L.ApiError(`LH ${region}/${code}: 기대 ${expected}건 ≠ 수집 ${got.size}건`, { kind: 'incomplete' });
        st.expected += expected;
        st.fetched += got.size;
        for (const r of got.values()) {
          st.inRegion += 1;
          const end = L.toIso(r.CLSG_DT);
          const noticeDate = L.toIso(r.PAN_NT_ST_DT);
          const n = {
            id: `lh:${r.PAN_ID}`,
            source: 'lh',
            lhId: String(r.PAN_ID),
            name: L.str(r.PAN_NM) ?? `LH 공고 ${r.PAN_ID}`,
            kind: L.str(r.AIS_TP_CD_NM) ?? L.str(r.UPP_AIS_TP_NM) ?? LH_TYPES[upp],
            region,
            sigungu: null,
            address: null,
            units: null,
            noticeDate,
            schedule: noticeDate || end ? [{ label: '공고 게시~마감', start: noticeDate, end }] : [],
            start: null,
            end,
            lhStatus: L.str(r.PAN_SS),
            flags: [],
            url: /^https?:\/\//.test(L.str(r.DTL_URL) ?? '') ? L.str(r.DTL_URL) : null,
          };
          if (!inWindow(n, windowStart) && !ctx.store[n.id]) continue;
          st.inWindow += 1;
          returned.add(n.id);
          merge(ctx.store, n, null, ctx);
        }
        await L.sleep(Number(process.env.CALL_GAP_MS ?? 120));
      }
    }
  } catch (e) {
    // 한 번도 성공한 적 없으면 '미연결(선택)', 되다가 인증 오류면 키 만료 등으로 보고 경고
    st.status = e.kind === 'auth' ? (prev?.lastOkToday ? 'auth' : 'not-enabled') : 'error';
    st.error = st.status === 'not-enabled'
      ? 'LH 분양임대공고문 API 활용신청이 안 된 키입니다(선택 소스 — 청약홈 수집에는 영향 없음)'
      : L.redact(e.message);
    console.error(`  ✗ LH: ${st.error}`);
    return;
  }
  st.missing = markMissing(ctx.store, 'lh', returned, windowStart);
  st.lastOkToday = TODAY;
  if (st.expected === 0 && (prev?.expected ?? 0) > 0) {
    ctx.meta.warnings.push(`LH 공고: 총건수가 ${prev.expected} → 0 — 응답 형식 변경 의심`);
  }
  console.log(`  ✓ ${st.fetched}/${st.expected}건 → 기간 내 ${st.inWindow}`);
}

/**
 * LH 공고가 청약홈에도 올라온 경우(신혼희망타운 등) 청약홈 쪽 한 건으로 합치고 LH 링크를 붙인다.
 * 이름이 확실히 같을 때만 합친다(lib.nameMatch). 한 청약홈 공고에 LH 공고가 여러 건 붙어도 링크를 모두 남긴다.
 */
function dedupeLh(store) {
  const all = Object.values(store);
  const apply = all.filter((n) => n.source !== 'lh');
  for (const n of all) {
    if (n.source === 'lh') delete n.dupOf;
    else {
      delete n.lhUrl;
      delete n.lhUrls;
    }
  }
  let dup = 0;
  const near = (a, b) => !a || !b || Math.abs(Date.parse(a) - Date.parse(b)) <= 30 * 86400000;
  for (const lh of all.filter((n) => n.source === 'lh')) {
    const m = apply.find((a) => a.region === lh.region && near(a.noticeDate, lh.noticeDate) && L.nameMatch(a.name, lh.name));
    if (!m) continue;
    lh.dupOf = m.id;
    if (lh.url) {
      m.lhUrls = [...(m.lhUrls ?? []), lh.url];
      m.lhUrl = m.lhUrls[0];
    }
    dup += 1;
  }
  return dup;
}

async function main() {
  if (!KEY) {
    console.error('APPLYHOME_API_KEY 가 없습니다. 저장소 Settings → Secrets and variables → Actions 에 등록하세요.');
    process.exit(2);
  }
  const old = await L.readStore(L.DATA_DIR);
  const prevMeta = await L.readJson(path.join(L.DATA_DIR, 'meta.json'), {});
  const store = structuredClone(old.notices);
  const meta = {
    version: 2, runAt: RUN_AT, today: TODAY, prevRunAt: prevMeta.runAt ?? null,
    firstRunAt: prevMeta.firstRunAt ?? (Object.keys(old.notices).length ? null : RUN_AT),
    lastSuccessAt: prevMeta.lastSuccessAt ?? null, lastSuccessToday: prevMeta.lastSuccessToday ?? null,
    sources: {}, price: { calls: 0, empty: 0, errors: 0 }, warnings: [], newIds: [],
  };
  const ctx = { store, meta, prevMeta, opCache: { ...(prevMeta.opCache ?? {}) }, priceFill: {}, origins: [] };

  for (const src of SOURCES) await runApplySource(src, ctx);
  await runLh(ctx);
  const cx = annotateComplex(store, ctx.origins);
  if (cx.total) console.log(`단지 연결(본청약): ${cx.linked}/${cx.total} (무순위·임의공급)`);
  const dup = dedupeLh(store);

  meta.opCache = ctx.opCache;
  meta.windowStart = Object.values(meta.sources).map((s) => s.windowStart).sort()[0];
  meta.counts = countBuckets(Object.values(store), TODAY);
  meta.counts.dup = dup;

  await rm(L.NEXT_DIR, { recursive: true, force: true });
  await L.writeStore(L.NEXT_DIR, store);
  await L.writeJson(path.join(L.NEXT_DIR, 'meta.json'), meta);
  const c = meta.counts;
  console.log(`\n저장(next): 보관 ${c.stored} · 표시 ${c.visible} = 상한 이하 ${c.pass} + 경계 ${c.border} + 미확인 ${c.unknown} + 초과 ${c.over} · 신규 ${meta.newIds.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`수집 중단: ${L.redact(e.stack || e.message)}`);
    process.exit(1);
  });
}
