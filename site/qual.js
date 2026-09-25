// 청약 자격·선정 기준 — 화면 표시 전용 모듈. 분양가 판정(core.js)과 분리한다.
//
// 원칙
//  1) 데이터가 말해주는 것(순위별 지역 접수일, 규제 플래그, 유형)만 판정하고, 나머지는 '현행 제도 일반론'으로
//     기준일(AS_OF)을 달아 안내한다. 개별 공고를 단정하지 않는다 — 최종 판단은 항상 모집공고문.
//  2) 제도는 자주 바뀐다(규제지역 목록·무순위 요건 등). 수치·규칙은 이 파일 한 곳에만 두고 기준일을 명시한다.
//  3) 거주지 프로필은 이 기기(localStorage)에만 저장한다 — 공개 저장소·서버에 개인 정보를 두지 않는다.

// 아래 제도 문구를 실제로 검증한 시점. 미래 날짜를 적지 않는다(그 사이 개정까지 반영된 것처럼 읽힌다).
// 반영된 주요 개정: 2025.10.16 규제지역 확대, 2025.6.10 무순위 무주택 요건, 2023.4 가점·추첨 비율.
export const AS_OF = '2026.9';

const isReg = (n) => (n.flags ?? []).some((f) => f === '투기과열지구' || f === '조정대상지역');
const isSpec = (n) => (n.flags ?? []).includes('투기과열지구');

/** 유형별 '기본 자격' 일반론 (개별 공고 아님 — 공고문 확인 전제) */
export function baseQual(n) {
  if (n.source === 'apt') {
    const reg = isReg(n);
    const kind = n.detailKind === '국민' ? '국민' : n.detailKind === '민영' ? '민영' : null;
    const rows = [];
    if (kind !== '국민') {
      rows.push(`민영 1순위: 청약통장 ${reg ? '가입 2년 + 세대주 + 5년 내 세대 당첨 없음 + 2주택 미만 세대' : '가입 1년(수도권)'} + 지역·면적별 예치금`);
    }
    if (kind !== '민영') {
      rows.push(`국민 1순위: 무주택세대구성원 + 통장 ${reg ? '2년·24회 이상 + 세대주 + 5년 내 세대 당첨 없음' : '1년·12회 이상(수도권)'}`);
    }
    if (reg) rows.push('규제지역: 재당첨 제한 기간 중인 세대는 당첨(입주자 선정) 불가 — 신청 전 확인');
    return rows;
  }
  if (n.source === 'remndr') {
    return [
      '무순위: 무주택세대구성원만 신청 가능(2025.6 개정) · 청약통장 불필요',
      '거주지역 요건은 공고마다 다름(지자체 결정) — 공고문 확인 필수',
    ];
  }
  if (n.source === 'opt') {
    return ['임의공급: 통상 성년(19세 이상)이면 신청 가능 — 청약통장·무주택·거주지역·재당첨 제한 없음 · 세부 조건은 공고문'];
  }
  if (n.source === 'urbty') {
    return ['오피스텔·도시형: 통상 성년(19세 이상)이면 신청 가능 — 청약통장 불필요, 주택 수·거주지역 무관 · 세부 조건은 공고문'];
  }
  return ['LH 공고문 기준 — 유형별 자격이 달라 원문 확인 필요'];
}

/** 세부 선정 기준 일반론 (민영 가점/추첨 비율은 규제 플래그 + 면적으로 분기 — 지역 목록을 하드코딩하지 않는다) */
export function selectionRule(n) {
  if (n.source !== 'apt') {
    if (n.source === 'remndr') return ['선정: 무작위 추첨(신청 자격 충족자 대상)'];
    if (n.source === 'opt') return ['선정: 선착순 또는 추첨(공고문 기준)'];
    if (n.source === 'urbty') return ['선정: 추첨(신청금 예치 여부·금액은 공고문 기준)'];
    return [];
  }
  if (n.detailKind === '국민') {
    return ['국민주택 일반공급: 가점제가 아닌 순위·순차제(40㎡ 초과 저축총액 순 · 40㎡ 이하 납입횟수 순, 3년 이상 무주택 우선)', '특별공급: 유형별 소득·자산·무주택 기준 별도(공고문 확인)'];
  }
  const spec = isSpec(n);
  const reg = isReg(n);
  const ratio = spec
    ? '가점:추첨 = 60㎡ 이하 40:60 · 60~85㎡ 70:30 · 85㎡ 초과 80:20'
    : reg
      ? '가점:추첨 = 60㎡ 이하 40:60 · 60~85㎡ 70:30 · 85㎡ 초과 50:50'
      : '85㎡ 이하 가점 최대 40%(지자체 재량)+추첨 · 85㎡ 초과 100% 추첨';
  const out = [`민영 일반공급 ${spec ? '(투기과열지구)' : reg ? '(조정대상지역)' : '(비규제)'}: ${ratio}`, '가점 만점 84점 = 무주택기간 32 + 부양가족 35 + 통장기간 17'];
  if (reg) out.push('추첨제 물량의 75%는 무주택 세대 우선');
  out.push('특별공급: 유형별 소득·자산·무주택 기준 별도(공고문 확인)');
  return out;
}

/** 순위별 지역 접수 표 (APT 전용 — ranks 데이터가 있을 때만) */
export function rankRows(n) {
  const R = n.ranks;
  if (!R) return [];
  const label = {
    local: `해당지역(${n.region === '경기' ? (n.sigungu ?? '공고문 확인') : n.region})`,
    gg: '기타경기', etc: '기타지역(수도권)',
  };
  const out = [];
  for (const [rk, name] of [['r1', '1순위'], ['r2', '2순위']]) {
    for (const k of ['local', 'gg', 'etc']) {
      const d = R[rk]?.[k];
      if (d) out.push({ rank: name, area: label[k], date: d });
    }
  }
  return out;
}

/**
 * 거주지 프로필 1건에 대한 이 공고 신청 가능성(추정).
 * 반환: { grade: 'ok'|'warn'|'info', text } 또는 null(프로필 미설정).
 * 서울·경기 거주만 지원한다(이 사이트의 수집 범위). '해당지역'은 서울=시 전체, 경기=해당 시·군.
 */
const normSgg = (s) => String(s ?? '').replace(/[시군]$/, '');   // '광명' 과 '광명시' 를 같게 본다

export function eligibility(n, p) {
  if (!p || !p.region) return null;
  const md = (iso) => (iso ? `${Number(iso.split('-')[1])}/${Number(iso.split('-')[2])}` : '');
  // 어느 '순위'에서 얻은 날짜인지와 함께 — 2순위 날짜에 1순위 라벨을 붙이지 않는다
  const pick = (R, k) => (R?.r1?.[k] ? { rank: '1순위', d: R.r1[k] } : R?.r2?.[k] ? { rank: '2순위', d: R.r2[k] } : null);

  if (n.source === 'remndr') {
    return { grade: 'warn', text: '무주택 세대면 신청 검토 가능 · 거주요건 공고문 확인' };
  }
  if (n.source === 'opt') return { grade: 'ok', text: '신청 제한 없음(통상) · 공고문 확인' };
  if (n.source === 'urbty') return { grade: 'ok', text: '통장 불필요 · 통상 성년 누구나' };
  if (n.source === 'lh') return { grade: 'info', text: 'LH 공고문 확인' };

  // APT — 순위별 지역 접수일 데이터 기반
  // 특별공급만 있는 공고(일반 0세대)에는 순위 안내를 하지 않는다
  const ts = Array.isArray(n.types) ? n.types : [];
  if (ts.length && ts.every((t) => t.general != null) && ts.reduce((a, t) => a + t.general, 0) === 0) {
    return { grade: 'warn', text: '특별공급만 — 유형별 자격 공고문 확인' };
  }
  const R = n.ranks;
  const needs2y = isSpec(n) || (n.flags ?? []).includes('대규모 택지');
  const y2 = needs2y && !p.years2 ? ' · 2년 거주 요건 확인' : '';
  if (p.region === '경기' && n.region === '경기' && !p.sigungu) {
    return { grade: 'info', text: '프로필에 시·군을 입력하면 해당지역 여부를 판정합니다' };
  }
  const local = p.region === n.region
    && (n.region === '서울' || (!!p.sigungu && !!n.sigungu && normSgg(p.sigungu) === normSgg(n.sigungu)));
  if (!R) {
    return { grade: 'info', text: local ? `해당지역 거주${y2} · 접수 구분 공고문 확인` : '공고문에서 접수 지역 확인' };
  }
  if (local) {
    const g = pick(R, 'local');
    if (!g) return { grade: 'info', text: `해당지역 거주${y2} · 접수 구분 공고문 확인` };
    // 2년 거주 요건이 확인 안 된 해당지역은 초록으로 단정하지 않는다
    return { grade: y2 ? 'warn' : 'ok', text: `${g.rank} 해당지역 ${md(g.d)}${y2}` };
  }
  if (p.region === '경기' && n.region === '경기') {
    const gg = pick(R, 'gg');
    if (gg) return { grade: 'ok', text: `${gg.rank} 기타경기로 신청 가능 ${md(gg.d)}` };
  }
  const etc = pick(R, 'etc');
  if (etc) return { grade: 'ok', text: `${etc.rank} 기타지역(수도권)으로 신청 가능 ${md(etc.d)}` };
  return { grade: 'warn', text: '해당지역만 접수로 보임 — 공고문 확인' };
}

// ---------- 거주지 프로필 (이 기기에만 저장) ----------

const KEY = 'cheongyak-profiles-v1';

export function loadProfiles() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(p)) return [p[0] ?? {}, p[1] ?? {}].map((x) => ({ label: '', region: '', sigungu: '', years2: false, ...x }));
  } catch { /* 저장 안 됨·차단 환경 */ }
  return [
    { label: '', region: '', sigungu: '', years2: false },
    { label: '', region: '', sigungu: '', years2: false },
  ];
}

export function saveProfiles(profiles) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profiles));
  } catch { /* 프라이빗 모드 등 — 이번 접속에서만 유지 */ }
}
