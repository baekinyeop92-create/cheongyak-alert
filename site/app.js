// 청약 알림 — 화면. 판정·상태 계산은 core.js(수집·검증과 같은 코드)를 그대로 쓴다.
import {
  evaluate, statusOf, kstToday, eok, eokExact, priceRange, areaText, areaRange, span,
  countBuckets, withinBorder, DEFAULT_CAP, SOURCE_LABEL,
} from './core.js?v=__BUILD__';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : null;
  } catch {
    return null;
  }
};

const CAPS = [130000, 120000, 110000, 100000, 90000, 80000, 70000, 60000, 50000];
const KINDS = ['apt', 'remndr', 'opt', 'urbty', 'lh'];
const DOWNS = [10, 15, 20];   // 계약금 비율 '가정'(%) — 실제 비율은 API 에 없어 공고문으로만 확인 가능
let today = kstToday();
let loadedAt = 0;
const state = { region: '', sigungu: '', kinds: new Set(KINDS), cap: DEFAULT_CAP, minArea: 0, sort: 'urgent', closed: false, q: '', st: '', down: 10 };
let DATA = null;

// ---------- URL 상태 (북마크·공유용) ----------

function readHash() {
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.has('r')) state.region = ['서울', '경기'].includes(p.get('r')) ? p.get('r') : '';
    if (p.has('g')) state.sigungu = p.get('g');
    if (p.has('k')) state.kinds = new Set(p.get('k').split(',').filter((k) => KINDS.includes(k)));
    if (p.has('cap') && CAPS.includes(Number(p.get('cap')))) state.cap = Number(p.get('cap'));
    if (p.has('a')) state.minArea = [0, 40, 59, 84].includes(Number(p.get('a'))) ? Number(p.get('a')) : 0;
    if (p.has('s')) state.sort = ['urgent', 'new', 'price'].includes(p.get('s')) ? p.get('s') : 'urgent';
    if (p.has('d')) state.down = DOWNS.includes(Number(p.get('d'))) ? Number(p.get('d')) : 10;
    if (p.has('c')) state.closed = p.get('c') === '1';
    if (p.has('q')) state.q = p.get('q');
    if (p.has('st')) state.st = p.get('st');
  } catch { /* 잘못된 주소는 기본값 */ }
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.region) p.set('r', state.region);
  if (state.sigungu) p.set('g', state.sigungu);
  if (state.kinds.size !== KINDS.length) p.set('k', [...state.kinds].join(','));
  if (state.cap !== DEFAULT_CAP) p.set('cap', state.cap);
  if (state.minArea) p.set('a', state.minArea);
  if (state.sort !== 'urgent') p.set('s', state.sort);
  if (state.down !== 10) p.set('d', state.down);
  if (state.closed) p.set('c', '1');
  if (state.q) p.set('q', state.q);
  if (state.st) p.set('st', state.st);
  const h = p.toString();
  try {
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  } catch { /* 미리보기 등 */ }
}

// ---------- 표기 도우미 ----------

const kst = (iso, withTime = true) => {
  if (!iso) return '—';
  const o = { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' };
  if (withTime) Object.assign(o, { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Intl.DateTimeFormat('ko-KR', o).format(new Date(iso));
};

/**
 * 이번 주(최근 갱신 기준 6.5일 안)에 처음 잡힌 공고. 12시 재시도·수동 실행이 있어도 주 단위로 유지된다.
 * 첫 수집 때 한꺼번에 잡힌 공고는 '신규'가 아니므로 NEW 를 달지 않는다.
 */
function isNew(n) {
  const m = DATA.meta;
  if (!m.runAt || !n.firstSeenAt) return false;
  if (m.firstRunAt ? n.firstSeenAt <= m.firstRunAt : !m.prevRunAt) return false;
  return Date.parse(n.firstSeenAt) > Date.parse(m.runAt) - 6.5 * 86400000;
}

/** 공급 주소 → 지도 검색어. 블록 코드·'일원' 같은 표기는 지도가 못 읽으므로 걷어낸다. */
function mapQuery(addr) {
  let s = String(addr).trim();
  const inner = s.match(/\(([^()]*(?:번지|[로길]\s?\d)[^()]*)\)/);
  s = inner ? inner[1] : s.replace(/\([^()]*\)/g, '');
  s = s.replace(/\s*\(?[A-Za-z]{1,3}-?\d+(?:-\d+)?\s*(?:BL|블록)\)?/g, '')
    .replace(/\s*(일원|일대)\s*/g, ' ')
    .replace(/(\d+)\s*,\s*\d+(\s*번지)/g, '$1$2')
    .replace(/\s+내\s*$/, '')
    .replace(/\s+/g, ' ').trim();
  if (/번지|(?<![A-Za-z])\d+-\d+(?![A-Za-z])|[로길]\s?\d/.test(s)) return s;
  const out = [];
  for (const raw of s.split(' ')) {
    const t = raw.replace(/[,.()]+$/, '');
    if (/.+[시도군구]$/.test(t)) { out.push(t); continue; }
    if (/.+[읍면동리]$/.test(t)) out.push(t);
    break;
  }
  return out.join(' ') || s;
}
const mapUrl = (addr) => `https://map.naver.com/p/search/${encodeURIComponent(mapQuery(addr))}`;

const where = (n) => [n.region, n.sigungu].filter(Boolean).join(' ');

// ---------- 공급 대상 (주택형 API 의 일반·특별공급 세대수 — 자격 '조건'은 공고문에만) ----------

const SP_LABEL = {
  newly: '신혼부부', first: '생애최초', multi: '다자녀', young: '청년', newborn: '신생아',
  old: '노부모', org: '기관추천', transfer: '이전기관', etc: '기타 특공',
};

function qualChips(n) {
  const ts = n.types ?? [];
  let general = null;
  let special = null;
  const sp = {};
  for (const t of ts) {
    if (t.general != null) general = (general ?? 0) + t.general;
    if (t.special != null) special = (special ?? 0) + t.special;
    for (const [k, v] of Object.entries(t.sp ?? {})) sp[k] = (sp[k] ?? 0) + v;
  }
  if (general == null && special == null) return '';   // 세대 구성을 안 주는 소스(LH 등)는 표시하지 않는다
  const chips = [];
  chips.push(general > 0
    ? `<span class="q-c">일반 ${general.toLocaleString('ko-KR')}</span>`
    : '<span class="q-c q-none">일반공급 없음</span>');
  const keys = Object.keys(SP_LABEL).filter((k) => sp[k] > 0);
  if (keys.length) chips.push(...keys.map((k) => `<span class="q-c">${SP_LABEL[k]} ${sp[k].toLocaleString('ko-KR')}</span>`));
  else if (special > 0) chips.push(`<span class="q-c">특별공급 ${special.toLocaleString('ko-KR')}</span>`);
  return `<p class="qual"><span class="q-t">공급 대상</span>${chips.join('')}<span class="q-note">· 자격 요건은 공고문</span></p>`;
}

// ---------- 주변 실거래 시세 (meta.market — 참고용 추정) ----------

const BAND_LABEL = { s: '60㎡ 미만', m: '60~85㎡', l: '85㎡ 초과', all: '전체 면적' };
const MIN_SAMPLE = 5;   // 표본이 이보다 적은 밴드는 쓰지 않는다 — 억지 추정 금지

/** 공고의 시군구 × 전용면적에 맞는 중위 ㎡당가. 같은 면적대 표본이 부족하면 전체 면적으로 폴백. */
function marketOf(n, area) {
  const M = DATA?.meta?.market;
  if (!M || !Number.isFinite(area)) return null;
  const a = M.areas?.[`${n.region}|${n.sigungu}`];
  if (!a) return null;
  const key = area < 60 ? 's' : area <= 85 ? 'm' : 'l';
  for (const k of [key, 'all']) {
    const b = a.bands?.[k];
    if (b && b.n >= MIN_SAMPLE) return { m2: b.m2, n: b.n, label: BAND_LABEL[k] };
  }
  return null;
}

// ---------- 필터 ----------

function inScope(x) {
  const n = x.n;
  if (!state.kinds.has(n.source)) return false;
  if (state.region && n.region !== state.region) return false;
  if (state.sigungu) {
    const [r, g] = state.sigungu.split('|');
    if (n.region !== r) return false;
    if (n.sigungu && n.sigungu !== g) return false;   // 시·군·구를 모르는 공고(LH 등)는 숨기지 않는다
  }
  if (state.q) {
    const hay = `${n.name} ${n.address ?? ''} ${n.sigungu ?? ''} ${n.builder ?? ''} ${n.kind ?? ''}`.toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function stMatch(x) {
  const k = x.st.key;
  if (!state.closed && k === 'closed') return false;
  switch (state.st) {
    case 'open': return k === 'open' || k === 'closing';
    case 'closing': return k === 'closing';
    case 'upcoming': return k === 'upcoming';
    case 'new': return isNew(x.n);
    case 'closed': return k === 'closed';
    default: return true;
  }
}

const minUnder = (x) => Math.min(...(x.ev.under.length ? x.ev.under : x.ev.considered).map((t) => t.price).filter((p) => p > 0), Infinity);
const SORTS = {
  urgent: (a, b) => {
    if (a.st.order !== b.st.order) return a.st.order - b.st.order;
    if (a.st.key === 'closed') return (b.n.end ?? '').localeCompare(a.n.end ?? '');
    const k = (x) => (x.st.key === 'upcoming' ? x.n.start : x.n.end) ?? '9999';
    return k(a).localeCompare(k(b));
  },
  new: (a, b) => (b.n.noticeDate ?? '').localeCompare(a.n.noticeDate ?? '') || (b.n.firstSeenAt ?? '').localeCompare(a.n.firstSeenAt ?? ''),
  price: (a, b) => minUnder(a) - minUnder(b),
};

// ---------- 그리기 ----------

function card(x) {
  const { n, ev, st } = x;
  const pool = ev.under;
  const url = safeUrl(n.url);
  const lhs = (n.lhUrls ?? (n.lhUrl ? [n.lhUrl] : [])).map(safeUrl).filter(Boolean);
  const home = safeUrl(n.homepage);
  const meta = [where(n), n.kind && n.kind !== SOURCE_LABEL[n.source] ? n.kind : null, ...(n.flags ?? []), n.units ? `${n.units.toLocaleString('ko-KR')}세대` : null, n.moveIn ? `입주 ${n.moveIn.replace('-', '.')}` : null].filter(Boolean);
  const sched = (n.schedule ?? []).filter((p) => !p.hidden);
  if (n.winnerDate) sched.push({ label: '당첨 발표', start: n.winnerDate, end: n.winnerDate });
  // '최소 현금'은 가장 싼 상한 이하 주택형의 최고 분양가 × 계약금 비율 가정 — 실제 비율은 공고문 확인
  const underPrices = pool.map((t) => t.price).filter((p) => p > 0);
  const minCash = underPrices.length ? Math.round(Math.min(...underPrices) * state.down / 100) : null;
  // 시세차익(추정): 가장 싼 상한 이하 주택형 vs 같은 시군구·면적대 최근 실거래 중위 ㎡당가
  let mkline = '';
  const cheap = pool.filter((t) => t.price > 0).sort((a, b) => a.price - b.price)[0];
  const mk = cheap ? marketOf(n, cheap.area) : null;
  if (mk) {
    const est = Math.round(mk.m2 * cheap.area);
    const diff = est - cheap.price;
    const M = DATA.meta.market;
    mkline = `<p class="mkline">주변 실거래 대비 <b class="${diff >= 0 ? 'mk-cheap' : 'mk-exp'}">약 ${eok(Math.abs(diff))} ${diff >= 0 ? '저렴' : '비쌈'}</b>
      <span>· ${esc(n.sigungu)} 최근 ${M.monthsN ?? 6}개월 ${mk.label} ${mk.n}건 중위 ㎡당 ${mk.m2.toLocaleString('ko-KR')}만 기준${M.status === 'stale' ? ' · 지난 주 시세' : ''} · 추정치</span></p>`;
  }
  const typeRows = (n.types ?? []).map((t) => {
    const inArea = !state.minArea || t.area == null || t.area >= state.minArea;
    let v = ['v-unknown', '미확인'];
    if (!inArea) v = ['v-area', '면적 밖'];
    else if (t.price > 0 && t.price <= state.cap) v = ['v-pass', '상한 이하'];
    else if (t.price > 0 && withinBorder(t.price, state.cap)) v = ['v-border', '경계'];
    else if (t.price > 0) v = ['v-over', '초과'];
    const tm = t.price > 0 ? marketOf(n, t.area) : null;
    const dv = tm ? Math.round(tm.m2 * t.area) - t.price : null;
    const dvCell = dv == null ? '—' : `<span class="${dv >= 0 ? 'mk-cheap' : 'mk-exp'}">${dv >= 0 ? '+' : '-'}${eok(Math.abs(dv))}</span>`;
    const unitCell = t.units == null ? '—' : t.special > 0 ? `${t.units} <span class="u-split">(${t.general ?? 0}+${t.special})</span>` : String(t.units);
    return `<tr><td>${esc(t.type ?? '—')}</td><td class="num">${areaText(t.area)}</td><td class="num">${unitCell}</td><td class="num">${eokExact(t.price)}</td><td class="num">${t.price > 0 ? eokExact(Math.round(t.price * state.down / 100)) : '—'}</td><td class="num">${dvCell}</td><td class="${v[0]}">${v[1]}</td></tr>`;
  }).join('');
  return `<article class="card ${st.key === 'closed' ? 'is-closed' : ''}">
    <div class="badges">
      <span class="badge st-${st.key}">${esc(st.label)}</span>
      ${isNew(n) ? '<span class="badge new">NEW</span>' : ''}
      <span class="badge">${esc(SOURCE_LABEL[n.source])}</span>
      ${n.missingSince ? `<span class="badge gone" title="${esc(n.missingSince)} 수집부터 API 목록에 없음">API에서 사라짐 · 취소·정정 확인</span>` : ''}
    </div>
    <h3 class="name">${esc(n.name)}</h3>
    <p class="where">${esc(meta.join(' · '))}</p>
    ${qualChips(n)}
    <div class="key">
      <div class="price"><span>${eok(state.cap)} 이하 분양가</span><strong>${priceRange(pool.map((t) => t.price))}</strong></div>
      <div><span>해당 주택형</span><strong>${pool.length}/${(n.types ?? []).length} · ${areaRange(pool.map((t) => t.area)) || '—'}</strong></div>
      <div><span>청약 접수</span><strong>${span(n.start, n.end) || '—'}</strong></div>
      <div class="cash"><span>최소 현금 · 계약금 ${state.down}% 가정</span><strong>${minCash ? `약 ${eok(minCash)}` : '—'}</strong></div>
    </div>
    ${mkline}
    ${sched.length ? `<ul class="sched">${sched.map((p) => `<li class="${(p.end ?? p.start) < today ? 'past' : ''}"><span>${esc(p.label)}</span>${span(p.start, p.end)}</li>`).join('')}</ul>` : ''}
    <div class="actions">
      ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">공고 보기</a>` : ''}
      ${lhs.map((u, i) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">LH 공고${lhs.length > 1 ? ` ${i + 1}` : ''}</a>`).join('')}
      ${n.address ? `<a class="btn" href="${esc(mapUrl(n.address))}" target="_blank" rel="noopener" title="${esc(n.address)}">지도</a>` : ''}
      ${home ? `<a class="btn" href="${esc(home)}" target="_blank" rel="noopener">분양 홈페이지</a>` : ''}
    </div>
    ${typeRows ? `<details class="types"><summary>주택형 ${(n.types ?? []).length}개 · 분양가 표</summary><div class="tbl-wrap"><table>
      <thead><tr><th>주택형</th><th class="num">전용</th><th class="num">공급 세대</th><th class="num">최고 분양가</th><th class="num">계약금 ${state.down}%</th><th class="num">실거래 대비</th><th>판정</th></tr></thead>
      <tbody>${typeRows}</tbody></table></div></details>` : ''}
  </article>`;
}

function row(x, kind) {
  const { n, ev, st } = x;
  const url = safeUrl(n.url) || safeUrl(n.lhUrl);
  let price = priceRange(ev.considered.map((t) => t.price));
  if (kind === 'border' && ev.min) price = `최저 ${eok(ev.min)} (+${((ev.min / state.cap - 1) * 100).toFixed(1)}%)`;
  if (kind === 'unknown') price = ev.reason === 'lh' ? 'LH 공고문 확인' : ev.reason === 'partial-price' ? '일부 주택형 미정' : '주택형 정보 없음';
  if (kind === 'over' && ev.reason === 'area') price = `전용 ${state.minArea}㎡ 미만만`;
  const meta = [where(n), SOURCE_LABEL[n.source], n.kind !== SOURCE_LABEL[n.source] ? n.kind : null, n.units ? `${n.units}세대` : null].filter(Boolean).join(' · ');
  return `<div class="r">
    <div class="t">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(n.name)}</a>` : esc(n.name)}</div>
    <div class="p">${esc(price)}</div>
    <div class="m">${esc(meta)}</div>
    <div class="s">${esc(st.label)}${n.start || n.end ? ` · ${span(n.start, n.end)}` : ''}</div>
  </div>`;
}

function section(title, note, items, kind, open = false) {
  if (!items.length) return '';
  return `<details class="more"${open ? ' open' : ''}><summary>${esc(title)} <small>${items.length}건</small></summary>
    <div class="note">${note}</div><div class="rows">${items.map((x) => row(x, kind)).join('')}</div></details>`;
}

function banners() {
  const m = DATA.meta;
  const out = [];
  if (m.runAt) {
    const days = Math.floor((Date.now() - Date.parse(m.runAt)) / 86400000);
    if (days > 8) {
      out.push(`<div class="banner b-bad"><b>마지막 갱신이 ${days}일 전입니다.</b> 자동 수집이 멈췄을 수 있습니다. 저장소 Actions 탭에서 weekly-update 실행 기록을 확인하세요. 아래 목록은 ${kst(m.runAt)} 기준입니다.</div>`);
    }
  }
  if (m.status === 'degraded' && m.warnings?.length) {
    out.push(`<div class="banner b-warn"><b>이번 갱신에서 일부 항목을 확인하지 못했습니다.</b> 다음 실행이 빠진 기간을 자동으로 다시 훑습니다.<ul>${m.warnings.slice(0, 4).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  }
  $('#banners').innerHTML = out.join('');
}

function health() {
  const m = DATA.meta;
  const el = $('#health');
  let cls = '';
  let text = '첫 수집 전';
  if (m.runAt) {
    const days = (Date.now() - Date.parse(m.runAt)) / 86400000;
    if (days > 8) {
      cls = 'h-bad';
      text = `${Math.floor(days)}일 전 갱신 · 확인 필요`;
    } else if (m.status === 'degraded') {
      cls = 'h-warn';
      text = `${kst(m.runAt)} 갱신 · 일부 실패`;
    } else {
      cls = 'h-ok';
      text = `${kst(m.runAt)} 갱신 · 정상`;
    }
  }
  el.className = `health ${cls}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
}

const SRC_STATUS = {
  ok: ['s-ok', '정상'], error: ['s-bad', '실패'], schema: ['s-bad', '형식 이상'], auth: ['s-bad', '인증 오류'],
  'not-enabled': ['s-idle', '미연결(선택)'], disabled: ['s-idle', '꺼짐'],
};

function nextRun(runAt) {
  if (!runAt) return '—';
  // 다음 월요일 06:00 KST
  const kstNow = new Date(Date.parse(runAt) + 9 * 3600000);
  const d = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
  const add = ((1 - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(월) 06:00`;
}

function audit() {
  const m = DATA.meta;
  const opts = { cap: state.cap, minArea: state.minArea };
  const c = countBuckets(DATA.notices, today, opts);
  const sumOk = c.pass + c.border + c.unknown + c.over === c.visible;
  const src = ['apt', 'remndr', 'opt', 'urbty', 'lh'].map((k) => {
    const s = m.sources?.[k];
    if (!s) return '';
    const [cls, label] = SRC_STATUS[s.status] ?? ['s-warn', s.status];
    const got = s.status === 'ok' ? `${s.fetched.toLocaleString('ko-KR')} / ${s.expected.toLocaleString('ko-KR')}` : '—';
    return `<tr><td>${esc(s.label)}</td><td class="${cls}">${esc(label)}</td><td class="num">${got}</td><td class="num">${s.inRegion ?? '—'}</td><td class="num">${s.inWindow ?? '—'}${s.excluded ? ` <span class="s-idle">(임대·생숙 ${s.excluded} 제외)</span>` : ''}</td><td>${esc(s.error ?? (s.missing ? `API 목록에서 사라진 공고 ${s.missing}건 보관 중` : ''))}</td></tr>`;
  }).join('');
  const runs = (DATA.runs ?? []).slice(-8).map((r) => {
    const label = { ok: '정상', degraded: '일부 실패', failed: '실패·차단', skipped: '건너뜀' }[r.status] ?? r.status;
    const inner = `${kst(r.at, false)} ${label}${r.new ? ` · 신규 ${r.new}` : ''}`;
    const href = safeUrl(r.run);
    return href ? `<a class="run ${esc(r.status)}" href="${esc(href)}" target="_blank" rel="noopener">${esc(inner)}</a>` : `<span class="run ${esc(r.status)}">${esc(inner)}</span>`;
  }).join('');

  $('#audit').innerHTML = `
    <h2>수집 점검</h2>
    <div class="panel">
      <p class="eq">표시 대상 <b>${c.visible}</b> = ${eok(state.cap)} 이하 <b>${c.pass}</b> + 경계 <b>${c.border}</b> + 가격 미확인 <b>${c.unknown}</b> + 초과·면적 밖 <b>${c.over}</b>
        ${sumOk ? '<span class="ok-mark">✓ 빠진 공고 없음</span>' : '<span class="bad-mark">✗ 합계 불일치</span>'}
        ${m.counts?.dup ? `<br><span class="fine">LH·청약홈 양쪽에 올라온 공고 ${m.counts.dup}건은 하나로 합쳐 표시</span>` : ''}</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>소스</th><th>상태</th><th class="num">받은 건수 / 총건수</th><th class="num">서울·경기</th><th class="num">기간 내</th><th>비고</th></tr></thead>
        <tbody>${src || '<tr><td colspan="6">아직 수집 기록이 없습니다.</td></tr>'}</tbody>
      </table></div>
      <p class="fine" style="margin-top:10px">마지막 갱신 ${kst(m.runAt)} · 다음 예정 ${nextRun(m.runAt)} · 수집 기간 ${esc(m.windowStart ?? '—')} 이후 마감분 · 주택형 조회 ${m.price?.calls ?? 0}건${m.price?.errors ? ` <span class="s-bad">(실패 ${m.price.errors})</span>` : ''}${(() => {
        const mk = m.market;
        if (!mk) return '';
        const cnt = Object.keys(mk.areas ?? {}).length;
        if (mk.status === 'ok' || mk.status === 'partial') return ` · 주변 실거래 ${cnt}개 시군구${mk.status === 'partial' ? ' <span class="s-warn">(일부 실패)</span>' : ''}`;
        if (mk.status === 'stale') return ` · 주변 실거래 ${cnt}개 시군구 <span class="s-warn">(이번 주 조회 실패 — 지난 값)</span>`;
        return ` · <span class="s-idle">주변 실거래 미연결</span>`;
      })()}</p>
      ${runs ? `<div class="runs">${runs}</div>` : ''}
    </div>
    <div class="panel fine">
      <p><b>판정 기준</b> 청약홈 주택형별 최고 공급금액(LTTOT_TOP_AMOUNT·오피스텔 SUPLY_AMOUNT)이 상한 이하인 주택형이 1개라도 있으면 목록에 올립니다. 최고가 기준이라 그 주택형은 모든 세대가 상한 이하입니다. 상한 초과 10% 이내는 저층 등 일부 세대가 상한 이하일 수 있어 ‘경계’로, 분양가를 모르는 공고는 ‘가격 미확인’으로 따로 보여줍니다 — 조용히 빼지 않습니다.</p>
      <p><b>돈 준비(참고)</b> 카드의 ‘최소 현금’은 가장 싼 상한 이하 주택형의 최고 분양가 × 선택한 계약금 비율(기본 10%)로 계산한 <b>가정치</b>입니다. 실제 계약금·중도금·잔금 비율과 발코니 확장비·유상 옵션·취득세는 공고마다 달라 청약홈 API가 제공하지 않습니다 — 통상 계약금 10~20% · 중도금 60% · 잔금 20~30% 구조가 많지만, 반드시 모집공고문에서 확인하세요.</p>
      <p><b>시세차익(참고)</b> ‘주변 실거래 대비’는 국토교통부 실거래가 공개 데이터에서 같은 시군구·최근 6개월·비슷한 면적대(60㎡ 미만 / 60~85 / 85 초과) 아파트 매매의 <b>중위 ㎡당가</b>로 추정한 값입니다. 해제 신고된 거래와 토지임대부는 제외하며, 표본이 5건 미만이면 표시하지 않습니다. 신축 프리미엄·법정동(동네)·연식·층·브랜드 차이는 반영되지 않으므로 투자 판단이 아닌 참고 지표로만 쓰세요.</p>
      <p><b>공급 대상(참고)</b> 카드의 ‘공급 대상’ 칩과 분양가 표의 세대수 분해(일반+특공)는 주택형 API의 일반·특별공급 세대수를 합산한 것입니다(아파트는 신혼부부·생애최초·다자녀 등 유형별 제공). 소득·자산·무주택·거주지역 같은 <b>세부 자격 요건과 무순위·임의공급의 신청 자격, 단지 ‘전체’ 세대수(무순위의 본청약 규모)는 API가 제공하지 않습니다</b> — 모집공고문에서 확인하세요.</p>
      <p><b>수집 범위</b> 청약홈 APT·무순위/잔여세대·임의공급·오피스텔/도시형생활주택(민간임대·생활숙박시설 제외) + LH 분양주택·신혼희망타운 공고. 받은 건수가 API 총건수와 다르면 그 주는 실패로 기록하고 다음 실행이 빠진 기간을 다시 훑습니다. 한 번 올라온 공고는 API에서 사라져도 지우지 않습니다.</p>
      <p><b>한계</b> SH·GH가 자체 청약시스템에만 올리는 공고는 공개 API가 없어 자동 수집 대상이 아닙니다. 무순위는 접수가 하루인 경우가 많아 주 1회 갱신으로는 접수 전에 못 볼 수 있습니다. 최종 기준은 항상 입주자모집공고 원문입니다.</p>
      <div class="links">
        <a href="https://www.applyhome.co.kr/ai/aib/selectSubscrptCalenderView.do" target="_blank" rel="noopener">청약홈 캘린더</a>
        <a href="https://apply.lh.or.kr/" target="_blank" rel="noopener">LH청약플러스</a>
        <a href="https://www.i-sh.co.kr/app/index.do" target="_blank" rel="noopener">SH 인터넷청약</a>
        <a href="https://apply.gh.or.kr/" target="_blank" rel="noopener">GH 청약센터</a>
        <a href="feed.xml">RSS 구독</a>
      </div>
    </div>`;
}

function render() {
  if (!DATA) return;
  today = kstToday();   // 홈 화면 앱을 다음 날 다시 열어도 D-day 가 맞게
  const opts = { cap: state.cap, minArea: state.minArea };
  const all = DATA.notices.map((n) => ({ n, ev: evaluate(n, opts), st: statusOf(n, today) }));
  const scoped = all.filter(inScope);
  const pass = scoped.filter((x) => x.ev.bucket === 'pass');

  // 상태 칩 — 지금 필터(지역·유형·검색) 안에서의 건수
  const active = pass.filter((x) => x.st.key !== 'closed');
  const chips = [
    ['', '진행 중', active.length, ''],
    ['open', '접수중', active.filter((x) => ['open', 'closing'].includes(x.st.key)).length, 'open'],
    ['closing', '마감 임박', active.filter((x) => x.st.key === 'closing').length, 'closing'],
    ['upcoming', '접수 예정', active.filter((x) => x.st.key === 'upcoming').length, 'upcoming'],
    ['new', '이번 주 신규', pass.filter((x) => isNew(x.n) && (state.closed || x.st.key !== 'closed')).length, 'new'],
  ];
  if (state.closed) chips.push(['closed', '마감', pass.filter((x) => x.st.key === 'closed').length, '']);
  $('#stats').innerHTML = chips.map(([k, label, n, cls]) => `<button type="button" class="stat ${cls} ${state.st === k ? 'on' : ''}" data-st="${k}" ${k && !n ? 'disabled' : ''}><b>${n}</b><span>${label}</span></button>`).join('');
  $$('#stats .stat').forEach((b) => {
    b.onclick = () => {
      state.st = state.st === b.dataset.st ? '' : b.dataset.st;
      render();
    };
  });

  const main = pass.filter(stMatch).sort(SORTS[state.sort]);
  $('#count').textContent = `${main.length}건`;
  $('#capText').textContent = eok(state.cap);

  if (!DATA.meta.runAt) {
    $('#main').innerHTML = '<div class="empty"><b>첫 수집 전입니다</b><p>저장소 Actions 탭 → weekly-update → Run workflow 를 한 번 실행하면 목록이 채워집니다.</p></div>';
  } else if (!main.length) {
    const hint = state.st || state.q || state.sigungu || state.minArea || state.cap !== DEFAULT_CAP || state.kinds.size !== KINDS.length
      ? '필터를 넓혀 보세요.' : '이번 주에는 조건에 맞는 진행 중 공고가 없습니다. 아래 ‘경계’·‘가격 미확인’ 칸도 확인하세요.';
    $('#main').innerHTML = `<div class="sec-h"><h2>${eok(state.cap)} 이하</h2><span>0건</span></div><div class="empty"><b>조건에 맞는 공고가 없습니다</b><p>${hint}</p></div>`;
  } else {
    $('#main').innerHTML = `<div class="sec-h"><h2>${eok(state.cap)} 이하</h2><span>${main.length}건${state.minArea ? ` · 전용 ${state.minArea}㎡ 이상` : ''}</span></div><div class="list">${main.map(card).join('')}</div>`;
  }

  const rest = (b) => scoped.filter((x) => x.ev.bucket === b).filter(stMatch).sort(SORTS.urgent);
  $('#extra').innerHTML = [
    section('경계 — 상한 초과 10% 이내', `가장 싼 주택형의 <b>최고가</b>가 ${eok(state.cap)}보다 조금 높습니다. 저층·비선호 동은 ${eok(state.cap)} 이하일 수 있으니 공고문의 층·동별 분양가를 확인하세요.`, rest('border'), 'border'),
    section('가격 미확인', '분양가를 API에서 받지 못한 공고입니다(LH 단독 공고·주택형 미등록 등). 빠뜨리지 않도록 따로 모았습니다 — 공고문에서 직접 확인하세요.', rest('unknown'), 'unknown'),
    section(`${eok(state.cap)} 초과 — 참고`, '모든 주택형이 상한의 110%를 넘거나 전용면적 조건 밖인 공고입니다.', rest('over'), 'over'),
  ].join('');

  banners();
  health();
  audit();
  writeHash();
}

// ---------- 컨트롤 ----------

function initControls() {
  $('#cap').innerHTML = CAPS.map((c) => `<option value="${c}">${eok(c)} 이하</option>`).join('');
  $('#kinds').innerHTML = KINDS.map((k) => `<button type="button" class="chip" data-k="${k}">${SOURCE_LABEL[k]}</button>`).join('');

  const groups = {};
  for (const n of DATA.notices) if (n.sigungu) (groups[n.region] ??= new Set()).add(n.sigungu);
  const sg = $('#sigungu');
  sg.innerHTML = '<option value="">시·군·구 전체</option>' + ['서울', '경기'].filter((r) => groups[r]).map((r) =>
    `<optgroup label="${r}">${[...groups[r]].sort((a, b) => a.localeCompare(b, 'ko')).map((g) => `<option value="${esc(`${r}|${g}`)}">${esc(g)}</option>`).join('')}</optgroup>`).join('');
  if (state.sigungu && !sg.querySelector(`option[value="${CSS.escape(state.sigungu)}"]`)) state.sigungu = '';

  const sync = () => {
    $$('#region button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.region));
    $$('#kinds .chip').forEach((b) => b.classList.toggle('on', state.kinds.has(b.dataset.k)));
    $$('#sigungu optgroup').forEach((g) => { g.hidden = !!state.region && g.label !== state.region; });
    sg.value = state.sigungu;
    $('#cap').value = String(state.cap);
    $('#area').value = String(state.minArea);
    $('#sort').value = state.sort;
    $('#down').value = String(state.down);
    $('#closed').checked = state.closed;
    $('#q').value = state.q;
  };

  $$('#region button').forEach((b) => {
    b.onclick = () => {
      state.region = b.dataset.v;
      if (state.sigungu && !state.sigungu.startsWith(`${state.region}|`)) state.sigungu = '';   // 시·도가 바뀌면 시·군·구 초기화
      sync();
      render();
    };
  });
  sg.onchange = () => {
    state.sigungu = sg.value;
    if (state.sigungu) state.region = state.sigungu.split('|')[0];
    sync();
    render();
  };
  $$('#kinds .chip').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      if (state.kinds.has(k) && state.kinds.size > 1) state.kinds.delete(k);
      else state.kinds.add(k);
      sync();
      render();
    };
  });
  $('#cap').onchange = (e) => { state.cap = Number(e.target.value); render(); };
  $('#area').onchange = (e) => { state.minArea = Number(e.target.value); render(); };
  $('#sort').onchange = (e) => { state.sort = e.target.value; render(); };
  $('#down').onchange = (e) => { state.down = Number(e.target.value); render(); };
  $('#closed').onchange = (e) => {
    state.closed = e.target.checked;
    if (!state.closed && state.st === 'closed') state.st = '';
    render();
  };
  let t;
  $('#q').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150);
  };
  sync();
}

async function fetchData() {
  const res = await fetch('data.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  DATA = await res.json();
  loadedAt = Date.now();
}

async function load() {
  readHash();
  try {
    await fetchData();
  } catch (e) {
    $('#main').innerHTML = `<div class="empty"><b>데이터를 불러오지 못했습니다</b><p>${esc(e.message)} — 잠시 뒤 새로고침하세요.</p></div>`;
    return;
  }
  initControls();
  render();
}

// 앱을 오래 열어 둔 뒤 돌아오면 날짜·데이터를 새로 맞춘다
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !DATA) return;
  if (Date.now() - loadedAt > 30 * 60 * 1000) {
    try {
      const before = DATA.meta.runAt;
      await fetchData();
      if (DATA.meta.runAt !== before) initControls();
    } catch { /* 네트워크 없으면 기존 데이터로 */ }
  }
  render();
});

load();
