// 청약 알림 — 판정 로직 (브라우저·Node 공용)
//
// 화면·주간 알림·무결성 검사가 모두 이 파일 하나를 쓴다. 기준이 두 군데로 갈리면
// "화면엔 있는데 알림엔 없는" 누락이 생기므로 판정 코드는 여기에만 둔다.

export const DEFAULT_CAP = 130000;   // 만원 단위 (= 13억)
export const BORDER_RATIO = 1.1;     // 상한 초과 10% 이내 → '경계' (저층 등 일부 세대는 상한 이하일 수 있음)
export const REGIONS = ['서울', '경기'];
export const SOURCE_LABEL = {
  apt: '아파트',
  remndr: '무순위·잔여',
  opt: '임의공급',
  urbty: '오피스텔·도시형',
  lh: 'LH 공고',
};
export const BUCKET_LABEL = {
  pass: '상한 이하',
  border: '경계',
  unknown: '가격 미확인',
  over: '상한 초과',
};

const isPrice = (p) => Number.isFinite(p) && p > 0;

/** 상한 × 1.1 이내인가. 정수 연산으로 비교한다 — 130000 * 1.1 = 143000.00000000003 같은 부동소수 오차로 경계선이 흔들리지 않게. */
export const withinBorder = (price, cap) => price * 10 <= cap * Math.round(BORDER_RATIO * 10);

/**
 * 공고 하나를 네 칸 중 하나로 보낸다. 어느 칸에도 안 들어가는 경우는 없다(누락 방지).
 *  pass    — 주택형 중 하나라도 최고 분양가가 상한 이하
 *  border  — 가장 싼 주택형이 상한 초과 10% 이내
 *  unknown — 분양가를 모르는 주택형이 있어 판정 불가 (조용히 빼지 않고 따로 보여준다)
 *  over    — 모든 주택형이 상한 × 1.1 초과, 또는 전용면적 조건 밖
 *
 * 기준 값은 청약홈 LTTOT_TOP_AMOUNT(주택형별 '최고' 공급금액)이다.
 * 최고가가 상한 이하이면 그 주택형의 모든 세대가 상한 이하라는 뜻이라 보수적이다.
 */
export function evaluate(n, { cap = DEFAULT_CAP, minArea = 0 } = {}) {
  const types = Array.isArray(n?.types) ? n.types : [];
  if (!types.length) {
    return { bucket: 'unknown', reason: n?.source === 'lh' ? 'lh' : 'no-types', under: [], considered: [] };
  }
  // 면적을 모르는 주택형은 면적 조건에서 빼지 않는다 — 잘못 숨기는 쪽이 더 위험하다
  const considered = minArea ? types.filter((t) => t.area == null || t.area >= minArea) : types;
  if (!considered.length) return { bucket: 'over', reason: 'area', under: [], considered };

  const under = considered.filter((t) => isPrice(t.price) && t.price <= cap);
  if (under.length) return { bucket: 'pass', reason: 'price', under, considered };
  if (considered.some((t) => !isPrice(t.price))) {
    return { bucket: 'unknown', reason: 'partial-price', under, considered };
  }
  const min = Math.min(...considered.map((t) => t.price));
  return { bucket: withinBorder(min, cap) ? 'border' : 'over', reason: 'price', under, considered, min };
}

// ---------- 날짜 ----------

/** 한국 날짜 "YYYY-MM-DD". formatToParts 로 조립 — 로캘 출력 형식이 바뀌어도 깨지지 않는다. */
export function kstToday(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export function dayDiff(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

const LH_STATUS = {
  접수중: 'open',
  공고중: 'upcoming',
  정정공고중: 'upcoming',
  상담요청: 'open',
  접수마감: 'closed',
};

/** 접속 시점 기준 상태. 저장하지 않고 매번 계산한다(저장하면 하루만 지나도 틀린다). */
export function statusOf(n, today) {
  const { start, end } = n;
  if (end && end < today) return { key: 'closed', label: '마감', order: 4 };
  if (n.source === 'lh' && n.lhStatus && LH_STATUS[n.lhStatus] && !start) {
    const key = LH_STATUS[n.lhStatus];
    if (key === 'closed') return { key, label: '마감', order: 4 };
    const d = end ? dayDiff(today, end) : null;
    if (key === 'open' && d != null && d <= 2) return { key: 'closing', label: d === 0 ? '오늘 마감' : `마감 D-${d}`, order: 0, d };
    return { key, label: n.lhStatus + (d != null ? ` · 마감 D-${d}` : ''), order: key === 'open' ? 1 : 2, d };
  }
  if (start && start > today) {
    const d = dayDiff(today, start);
    // 무순위는 하루짜리 접수가 많다 — 놓치지 않게 문구로 드러낸다
    const oneDay = end && end === start;
    return { key: 'upcoming', label: oneDay ? `D-${d} 하루 접수` : `접수 D-${d}`, order: 2, d };
  }
  if (end) {
    const d = dayDiff(today, end);
    if (d <= 2) return { key: 'closing', label: d === 0 ? '오늘 마감' : `마감 D-${d}`, order: 0, d };
    return { key: 'open', label: `접수중 · D-${d}`, order: 1, d };
  }
  if (start) return { key: 'open', label: '접수중(상시)', order: 1 };
  return { key: 'tbd', label: '일정 확인', order: 3 };
}

// ---------- 표기 ----------

/** 만원 → "8.9억" / "13.04억" / "8,500만". 소수 둘째 자리까지(상한 근처 값이 반올림으로 뭉개지지 않게). */
export function eok(m) {
  if (!isPrice(m)) return '—';
  if (m < 10000) return `${m.toLocaleString('ko-KR')}만`;
  const v = Math.round((m / 10000) * 100) / 100;
  return `${v}억`;
}

/** 만원 → "12억 4,000만" (표에서 정확한 값) */
export function eokExact(m) {
  if (!isPrice(m)) return '—';
  const e = Math.floor(m / 10000);
  const r = m % 10000;
  if (!e) return `${r.toLocaleString('ko-KR')}만`;
  return r ? `${e}억 ${r.toLocaleString('ko-KR')}만` : `${e}억`;
}

export function priceRange(prices) {
  const p = prices.filter(isPrice);
  if (!p.length) return '—';
  const lo = Math.min(...p);
  const hi = Math.max(...p);
  return eok(lo) === eok(hi) ? eok(lo) : `${eok(lo)} ~ ${eok(hi)}`;
}

/** 전용면적 표기 관행대로 절사: 84.97 → 84 */
export function areaText(a) {
  return Number.isFinite(a) ? `${Math.floor(a)}㎡` : '—';
}

export function areaRange(areas) {
  const a = areas.filter(Number.isFinite).map(Math.floor);
  if (!a.length) return '';
  const lo = Math.min(...a);
  const hi = Math.max(...a);
  return lo === hi ? `${lo}㎡` : `${lo}~${hi}㎡`;
}

export function md(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function span(start, end) {
  if (start && end && start !== end) return `${md(start)}~${md(end)}`;
  return md(start || end);
}

/** 칸별 건수. 수집(meta)·검증·화면 점검표가 같은 함수로 센다. */
export function countBuckets(notices, today, opts) {
  const c = { stored: 0, dup: 0, visible: 0, active: 0, pass: 0, border: 0, unknown: 0, over: 0, activePass: 0 };
  for (const n of notices) {
    c.stored += 1;
    if (n.dupOf) {
      c.dup += 1;
      continue;
    }
    c.visible += 1;
    const b = evaluate(n, opts).bucket;
    c[b] += 1;
    if (statusOf(n, today).key !== 'closed') {
      c.active += 1;
      if (b === 'pass') c.activePass += 1;
    }
  }
  return c;
}

/** 판정 요약 (카드·RSS·이슈 본문 공용) */
export function priceSummary(n, opts) {
  const ev = evaluate(n, opts);
  const pool = ev.under.length ? ev.under : ev.considered;
  return {
    ev,
    range: priceRange(pool.map((t) => t.price)),
    area: areaRange(pool.map((t) => t.area)),
    count: `${ev.under.length}/${(n.types || []).length}`,
  };
}
