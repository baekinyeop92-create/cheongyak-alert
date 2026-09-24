// 수집·검증·빌드 공용 도구. 외부 라이브러리 없음(Node 22 내장만).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { kstToday } from '../site/core.js';

export { kstToday };
export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const NEXT_DIR = path.join(DATA_DIR, 'next');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2026-08-13" · "20260813" · "2026.08.13" → "2026-08-13". 달력에 없는 날짜는 null. */
export function toIso(v) {
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, '');
  if (digits.length < 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(iso) ? iso : null;
}

/** "202711" → "2027-11" */
export function toYm(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : null;
}

export function str(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' || s === 'null' ? null : s;
}

/** 쉼표·공백을 떼고 숫자로. 임의공급은 "27,600" 처럼 쉼표를 넣어 준다. */
export function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/**
 * 금액을 만원 단위 정수로. 청약홈 LTTOT_TOP_AMOUNT 는 만원 단위다.
 * 5,000,000 이상이면 원 단위로 본다 — 만원 단위로 500억 이상인 주택은 없으므로 오판 여지가 없다.
 */
export function manwon(v) {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n >= 5_000_000 ? Math.round(n / 10000) : Math.round(n);
}

/** 주택형 코드 "084.9800A" 의 앞자리가 전용면적(㎡) */
export function areaFromType(t) {
  const m = String(t ?? '').match(/^0*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]);
  return a > 5 && a < 1000 ? a : null;
}

/** 시·도. 청약홈은 "서울"·"경기" 짧은 표기를 준다. 비어 있으면 주소 앞머리로 판단. */
export function regionOf(areaName, address) {
  const a = str(areaName);
  if (a) {
    if (a.includes('서울')) return '서울';
    if (a.includes('경기')) return '경기';
    return null;
  }
  const ad = str(address) || '';
  if (/^서울/.test(ad)) return '서울';
  if (/^경기/.test(ad)) return '경기';
  return null;
}

const SIDO = /서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주/;
/** 시·도를 하나라도 읽을 수 있는가(서울·경기가 아니어도). 못 읽으면 판정 불가 → 경고 대상 */
export function knownSido(areaName, address) {
  return SIDO.test(str(areaName) ?? '') || SIDO.test((str(address) ?? '').slice(0, 8));
}

/** "경기도 성남시 수정구 …" → "성남시", "서울특별시 강서구 …" → "강서구" */
export function sigunguOf(address) {
  const t = (str(address) || '').split(' ');
  return t.length >= 2 && /.+[시군구]$/.test(t[1]) ? t[1] : null;
}

export function fillRate(rows, field) {
  if (!rows.length) return 1;
  return rows.filter((r) => str(r[field]) != null).length / rows.length;
}

// ---------- 이름 매칭 (LH ↔ 청약홈 중복 제거) ----------

const normName = (s) =>
  String(s ?? '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/입주자\s*모집\s*공고|모집\s*공고|정정\s*공고|공고|본청약|사전청약/g, ' ')
    .replace(/\s+/g, '')
    .toUpperCase();

const blockOf = (s) => {
  const m = String(s ?? '').toUpperCase().match(/([A-Z]{1,3})-?(\d+(?:-\d+)?)\s*(?=블록|BL)/);
  return m ? m[1] + m[2] : null;
};

export function nameMatch(a, b) {
  const A = normName(a);
  const B = normName(b);
  if (!A || !B) return false;
  const ba = blockOf(a);
  const bb = blockOf(b);
  // 합치면 한쪽이 화면에서 사라지므로 확실할 때만 합친다(애매하면 둘 다 보여준다)
  if (ba || bb) return !!ba && ba === bb && A.slice(0, 2) === B.slice(0, 2);
  const strip = (s) => s.replace(/신혼희망타운|공공분양주택|공공분양|분양주택|아파트/g, '');
  return strip(A).length >= 4 && strip(A) === strip(B);
}

// ---------- HTTP ----------

export class ApiError extends Error {
  constructor(message, { kind = 'error', fatal = false } = {}) {
    super(message);
    this.kind = kind;     // error | auth | no-operation | incomplete | quota
    this.fatal = fatal;   // true 면 재시도하지 않는다
  }
}

/** 인증키 노출 방지: 로그·오류 메시지에서 serviceKey 값을 가린다 */
export const redact = (s) => String(s).replace(/(serviceKey=)[^&\s]+/gi, '$1***');

export async function getJson(url, { timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 30000) } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'cheongyak-alert/2.0', Accept: 'application/json' },
    });
  } catch (e) {
    throw new ApiError(`네트워크 실패: ${e.cause?.code || e.name || e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED|PERMISSION_DENIED|DEADLINE_HAS_EXPIRED|SERVICE_KEY_IS_NULL/.test(text)) {
    throw new ApiError('인증키 미등록 또는 활용신청 미승인', { kind: 'auth', fatal: true });
  }
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) throw new ApiError('호출 한도 초과', { kind: 'quota' });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const fatal404 = res.status === 404;
    throw new ApiError(`JSON 아님 (HTTP ${res.status}): ${redact(text.slice(0, 160))}`, {
      kind: fatal404 ? 'no-operation' : 'error',
      fatal: fatal404,
    });
  }
  if (typeof json?.code === 'number' && json.code < 0) {
    const msg = `API 오류 ${json.code}: ${json.msg ?? ''}`.trim();
    if (json.code === -3 || /등록되지 않은 서비스/.test(json.msg ?? '')) throw new ApiError(msg, { kind: 'no-operation', fatal: true });
    if (json.code === -4 || /인증키/.test(json.msg ?? '')) throw new ApiError(msg, { kind: 'auth', fatal: true });
    throw new ApiError(msg);
  }
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, {
      kind: res.status === 404 ? 'no-operation' : res.status === 401 || res.status === 403 ? 'auth' : 'error',
      fatal: [401, 403, 404].includes(res.status),
    });
  }
  return json;
}

export async function withRetry(label, fn, { attempts = 4, baseMs = Number(process.env.RETRY_BASE_MS ?? 3000) } = {}) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e.fatal || i === attempts) break;
      const wait = baseMs * 3 ** (i - 1);
      console.warn(`  ↻ ${label} 실패(${i}/${attempts}) ${wait}ms 후 재시도: ${redact(e.message)}`);
      await sleep(wait);
    }
  }
  throw last;
}

/** 쿼리 문자열. 인증키가 이미 인코딩된(Encoding 키, %가 들어 있음) 경우 두 번 인코딩하지 않는다. */
export function qs(params, keyName, key) {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const k = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
  return `${keyName}=${k}&${parts.join('&')}`;
}

// ---------- 저장소 파일 ----------

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`${path.relative(ROOT, file)} 읽기 실패: ${e.message}`);
  }
}

export async function readStore(dir) {
  const s = await readJson(path.join(dir, 'store.json'), { version: 2, notices: {} });
  if (!s || typeof s.notices !== 'object' || Array.isArray(s.notices)) throw new Error('store.json 형식 오류');
  return s;
}

/** 공고 1건 = 1줄. git diff 에서 무엇이 바뀌었는지 바로 보이게 한다. */
export async function writeStore(dir, notices) {
  await mkdir(dir, { recursive: true });
  const ids = Object.keys(notices).sort();
  const body = ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(notices[id])}`).join(',\n');
  await writeFile(path.join(dir, 'store.json'), `{"version":2,"notices":{\n${body}\n}}\n`);
}

export async function writeJson(file, obj) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(obj, null, 2)}\n`);
}

/** 내용 서명 — 본 날짜(firstSeen/lastSeen)나 파생 필드(lhUrl 등)는 빼고 공고 내용만 */
export function signature(n) {
  const pick = {
    name: n.name, kind: n.kind, region: n.region, address: n.address, units: n.units,
    noticeDate: n.noticeDate, start: n.start, end: n.end, schedule: n.schedule,
    winnerDate: n.winnerDate, url: n.url, types: n.types, lhStatus: n.lhStatus,
  };
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 12);
}

export async function setOutput(obj) {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
  if (file) await writeFile(file, `${lines}\n`, { flag: 'a' });
  else console.log(`[output] ${lines.replace(/\n/g, ' ')}`);
}

export function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/?$/, '/');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return '';
  const [owner, name] = repo.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
}
