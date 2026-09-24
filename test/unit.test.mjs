import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../scripts/lib.mjs';
import { evaluate, statusOf, eok, eokExact, areaRange, countBuckets, kstToday } from '../site/core.js';

test('날짜: 소스마다 다른 표기를 ISO 로 맞춘다', () => {
  assert.equal(L.toIso('20260813'), '2026-08-13');     // 임의공급
  assert.equal(L.toIso('2026-08-13'), '2026-08-13');   // APT·무순위
  assert.equal(L.toIso('2026.08.13'), '2026-08-13');   // LH
  assert.equal(L.toIso('2026-02-30'), null);           // 달력에 없는 날
  assert.equal(L.toIso(''), null);
  assert.ok(L.toIso('20260813') > '2026-08-12', '변환 후에는 문자열 비교가 맞는다');
});

test('금액: 쉼표 · 원 단위 · 0 처리', () => {
  assert.equal(L.manwon('27,600'), 27600);           // 임의공급 쉼표
  assert.equal(L.manwon(124000), 124000);
  assert.equal(L.manwon('1240000000'), 124000);      // 원 단위로 온 경우
  assert.equal(L.manwon('0'), null);
  assert.equal(L.manwon('미정'), null);
});

test('지역·시군구', () => {
  assert.equal(L.regionOf('서울', ''), '서울');
  assert.equal(L.regionOf('경기', '경기도 성남시'), '경기');
  assert.equal(L.regionOf('인천', '경기도 어딘가'), null, '시·도 필드가 있으면 그게 우선');
  assert.equal(L.regionOf('', '서울특별시 강서구'), '서울', '필드가 비면 주소로');
  assert.equal(L.sigunguOf('경기도 성남시 수정구 신흥동'), '성남시');
  assert.equal(L.sigunguOf('서울특별시 강서구 마곡동'), '강서구');
  assert.equal(L.sigunguOf('세종특별자치시 다솜동'), null);
});

test('주택형 코드에서 전용면적', () => {
  assert.equal(L.areaFromType('084.9800A'), 84.98);
  assert.equal(L.areaFromType('29A'), 29);
  assert.equal(L.areaFromType('A'), null);
});

test('판정: 네 칸 중 정확히 하나', () => {
  const t = (price, area = 84) => ({ price, area });
  assert.equal(evaluate({ types: [t(89000, 59), t(168000)] }).bucket, 'pass', '하나라도 이하면 포함');
  assert.equal(evaluate({ types: [t(130000)] }).bucket, 'pass', '13억 정확히는 이하');
  assert.equal(evaluate({ types: [t(130001)] }).bucket, 'border');
  assert.equal(evaluate({ types: [t(143000)] }).bucket, 'border', '10% 이내');
  assert.equal(evaluate({ types: [t(143100)] }).bucket, 'over');
  assert.equal(evaluate({ types: [] }).bucket, 'unknown', '주택형 없음');
  assert.equal(evaluate({ types: [t(null), t(200000)] }).bucket, 'unknown', '값 모르는 주택형이 있으면 초과로 단정하지 않는다');
  assert.equal(evaluate({ types: [t(89000, 39), t(200000, 84)] }, { minArea: 59 }).bucket, 'over', '전용 조건 밖');
  assert.equal(evaluate({ types: [t(89000, null)] }, { minArea: 59 }).bucket, 'pass', '면적 모르면 숨기지 않는다');
  assert.equal(evaluate({ types: [t(99000)] }, { cap: 90000 }).bucket, 'border', '상한 변경 반영 (정확히 +10%)');
  assert.equal(evaluate({ types: [t(100000)] }, { cap: 90000 }).bucket, 'over', '+11.1% 는 초과');
});

test('상태: 접속일 기준 계산', () => {
  const today = '2026-09-28';
  assert.equal(statusOf({ start: '2026-10-01', end: '2026-10-03' }, today).key, 'upcoming');
  assert.equal(statusOf({ start: '2026-09-27', end: '2026-09-28' }, today).label, '오늘 마감');
  assert.equal(statusOf({ start: '2026-09-27', end: '2026-09-30' }, today).key, 'closing');
  assert.equal(statusOf({ start: '2026-09-20', end: '2026-10-10' }, today).key, 'open');
  assert.equal(statusOf({ start: '2026-09-01', end: '2026-09-27' }, today).key, 'closed');
  assert.equal(statusOf({ source: 'lh', lhStatus: '공고중', end: '2026-10-10' }, today).key, 'upcoming');
});

test('표기', () => {
  assert.equal(eok(124000), '12.4억');
  assert.equal(eok(130400), '13.04억', '상한 근처 값이 13억으로 뭉개지지 않는다');
  assert.equal(eok(8500), '8,500만');
  assert.equal(eokExact(124000), '12억 4,000만');
  assert.equal(eokExact(130000), '13억');
  assert.equal(areaRange([59.98, 84.97]), '59~84㎡');
});

test('LH ↔ 청약홈 이름 매칭', () => {
  assert.ok(L.nameMatch('시흥거모 A-5블록 신혼희망타운(공공분양)(본청약)', '시흥거모 A-5블록 신혼희망타운(공공분양) 입주자모집공고'));
  assert.ok(!L.nameMatch('시흥거모 A-5블록 신혼희망타운', '시흥거모 A-6블록 신혼희망타운'), '블록이 다르면 다른 공고');
  assert.ok(!L.nameMatch('서울대방 A1블록 공공분양주택', '[예시] 강서 리버뷰 1단지'));
  // 애매하면 합치지 않는다(합치면 한쪽이 화면에서 사라짐)
  assert.ok(!L.nameMatch('구리갈매역세권 대방디에트르', '구리갈매역세권 A-1블록 공공분양'), '블록이 한쪽에만 있으면 다른 공고');
  assert.ok(!L.nameMatch('[공공분양] 화성동탄2', '화성동탄2 A-62블록 신혼희망타운'));
  assert.ok(!L.nameMatch('구리갈매역세권 대방디에트르', '구리갈매역세권 행복주택'));
});

test('KST 날짜 형식은 로캘 출력과 무관하게 YYYY-MM-DD', () => {
  assert.equal(kstToday(new Date('2026-09-27T15:30:00Z')), '2026-09-28', 'UTC 15:30 = KST 다음 날 00:30');
  assert.match(kstToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test('칸 합계 = 표시 건수', () => {
  const ns = [
    { types: [{ price: 50000 }] }, { types: [{ price: 135000 }] }, { types: [] },
    { types: [{ price: 300000 }] }, { dupOf: 'x', types: [] },
  ];
  const c = countBuckets(ns, '2026-09-28');
  assert.equal(c.pass + c.border + c.unknown + c.over, c.visible);
  assert.equal(c.dup, 1);
});

test('인증키 가리기', () => {
  assert.equal(L.redact('https://a/b?serviceKey=abc%2F123&page=1'), 'https://a/b?serviceKey=***&page=1');
});
