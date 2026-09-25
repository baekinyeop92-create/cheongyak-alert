// 수집 → 검증 → 빌드 → 요약을 스텁 API 에 대고 실제로 돌려 본다.
// "누락 없음"의 근거가 되는 시나리오(삭제 금지·총건수 불일치·전면 실패·오퍼레이션 이름 폴백)를 여기서 고정한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockServer, makeFixtures } from './mock-server.mjs';
import { evaluate } from '../site/core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const TODAY = '2026-09-28';
const state = { fx: makeFixtures(TODAY), fail: new Set(), shortPage: new Set(), lhAuthError: false, rtmsFail: false, rtmsAuthError: false };
let mock;

before(async () => {
  mock = await startMockServer(state);
});
after(() => mock.server.close());

function reset() {
  state.fx = makeFixtures(TODAY);
  state.fail = new Set();
  state.shortPage = new Set();
  state.lhAuthError = false;
  state.rtmsFail = false;
  state.rtmsAuthError = false;
}
const pass1 = async (dir) => {
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  return run('validate.mjs', dir);
};

// 저장소의 실제 data/ 가 아니라 빈 데이터로 시작한다 — 실데이터가 쌓여도 테스트 결과가 바뀌지 않게
async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cya-'));
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'data', 'store.json'), '{"version":2,"notices":{\n\n}}\n');
  for (const [f, v] of [['meta.json', '{}'], ['runs.json', '[]'], ['delivery.json', '{}']]) await writeFile(path.join(dir, 'data', f), v);
  return dir;
}

function run(script, dir, env = {}, args = []) {
  const out = path.join(dir, `out-${Math.random().toString(36).slice(2)}.txt`);
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
      env: {
        ...process.env,
        APPLYHOME_API_KEY: 'test-key/with+special=',
        APPLYHOME_API_BASE: `http://127.0.0.1:${mock.port}/api`,
        LH_API_BASE: `http://127.0.0.1:${mock.port}/B552555`,
        RTMS_API_BASE: `http://127.0.0.1:${mock.port}/1613000`,
        DATA_DIR: path.join(dir, 'data'),
        OUT_DIR: path.join(dir, '_site'),
        DIGEST_DIR: path.join(dir, '_out'),
        GITHUB_OUTPUT: out,
        GITHUB_REPOSITORY: 'tester/cheongyak-alert',
        PER_PAGE: '3',
        LH_PAGE_SIZE: '1',
        RETRY_BASE_MS: '1',
        CALL_GAP_MS: '0',
        TODAY,
        ...env,
      },
    }, async (err, stdout, stderr) => {
      let output = {};
      try {
        output = Object.fromEntries((await readFile(out, 'utf8')).trim().split('\n').map((l) => l.split('=')));
      } catch { /* 출력 없음 */ }
      resolve({ code: err ? err.code : 0, stdout, stderr, output });
    });
  });
}

const load = async (dir, f) => JSON.parse(await readFile(path.join(dir, 'data', f), 'utf8'));

test('정상 수집: 범위·칸 분류·폴백·페이지네이션', async () => {
  reset();
  const dir = await sandbox();
  const f = await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  assert.equal(f.code, 0, f.stderr);
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.output.status, 'ok', v.stdout + v.stderr);

  const { notices } = await load(dir, 'store.json');
  const meta = await load(dir, 'meta.json');
  const ids = Object.keys(notices);
  const bucket = (id) => evaluate(notices[id]).bucket;

  assert.ok(!ids.some((i) => i.includes('2026000905')), '부산 제외');
  assert.ok(!ids.some((i) => i.includes('2026000907')), '100일 전 마감은 기간 밖');
  assert.ok(!ids.some((i) => i.includes('2026930002')), '민간임대 제외');
  assert.equal(meta.sources.urbty.excluded, 1, '제외 건수는 점검표에 남는다');

  assert.equal(bucket('apt:2026000901:2026000901'), 'pass');
  assert.equal(bucket('apt:2026000902:2026000902'), 'over');
  assert.equal(bucket('apt:2026000903:2026000903'), 'border');
  assert.equal(bucket('apt:2026000904:2026000904'), 'unknown', '주택형 0건 → 미확인');
  assert.equal(bucket('apt:2026000906:2026000906'), 'pass', '20일 전 마감도 보관');
  assert.equal(bucket('opt:2026920001:2026920001'), 'pass');
  assert.equal(notices['opt:2026920001:2026920001'].types[0].price, 27600, '쉼표 금액');
  assert.equal(notices['opt:2026920001:2026920001'].end, '2026-10-08', '8자리 날짜');
  assert.equal(notices['urbty:2026930001:2026930001'].types[1].area, 49.52, '오피스텔 EXCLUSE_AR');
  assert.equal(meta.sources.opt.operation, 'getOptLttotPblancDetail', '오퍼레이션 이름 폴백');
  assert.equal(meta.sources.apt.pages, 3, 'perPage 3 → 7건 = 3페이지');
  assert.equal(meta.sources.apt.fetched, meta.sources.apt.expected);

  assert.equal(notices['lh:0000061001'].dupOf, 'apt:2026000906:2026000906', 'LH ↔ 청약홈 중복 제거');
  assert.equal(notices['apt:2026000906:2026000906'].lhUrl, 'https://apply.lh.or.kr/x?61001');
  assert.equal(bucket('lh:0000061002'), 'unknown', 'LH 단독 공고는 가격 미확인 칸');

  const c = meta.counts;
  assert.equal(c.pass + c.border + c.unknown + c.over, c.visible);

  const b = await run('build.mjs', dir);
  assert.equal(b.code, 0, b.stderr);
  const site = JSON.parse(await readFile(path.join(dir, '_site', 'data.json'), 'utf8'));
  assert.equal(site.notices.length, c.visible, '사이트에는 중복 제외 전부');
  const html = await readFile(path.join(dir, '_site', 'index.html'), 'utf8');
  assert.ok(!html.includes('__BUILD__'), '캐시 버전 치환');
  const feed = await readFile(path.join(dir, '_site', 'feed.xml'), 'utf8');
  assert.ok(feed.includes('강서 리버뷰') && !feed.includes('서초 하이엔드'), 'RSS 는 상한 이하·경계·미확인만');

  const n = await run('notify.mjs', dir);
  assert.equal(n.code, 0, n.stderr);
  const digest = await readFile(path.join(dir, '_out', 'digest.md'), 'utf8');
  assert.ok(digest.startsWith('@tester'), '저장소 주인 멘션 → 알림 메일');
  assert.ok(digest.includes('강서 리버뷰') && digest.includes('가격 미확인'));
  assert.ok(Number(n.output.digest_count) >= 7);
  await rm(dir, { recursive: true, force: true });
});

test('다음 주: API 에서 사라진 공고는 지우지 않고 표시, 신규만 new', async () => {
  reset();
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  await run('validate.mjs', dir);
  const first = (await load(dir, 'store.json')).notices;

  const T2 = '2026-10-05';
  state.fx = makeFixtures(TODAY);
  state.fx.apt = state.fx.apt.filter((r) => r.PBLANC_NO !== '2026000901');   // 취소·정정으로 사라짐
  state.fx.apt.push({ ...state.fx.apt[1], HOUSE_MANAGE_NO: '2026000908', PBLANC_NO: '2026000908', HOUSE_NM: '[예시] 신규 단지', RCRIT_PBLANC_DE: T2 });
  state.fx.aptMdl['2026000908'] = [{ HOUSE_TY: '059.9900A', LTTOT_TOP_AMOUNT: '70000' }];
  const f = await run('fetch.mjs', dir, { TODAY: T2, RUN_AT: '2026-10-04T21:00:00.000Z' });
  assert.equal(f.code, 0, f.stderr);
  const v = await run('validate.mjs', dir, { TODAY: T2 });
  assert.equal(v.code, 0, v.stderr);
  const { notices } = await load(dir, 'store.json');
  const meta = await load(dir, 'meta.json');
  assert.ok(notices['apt:2026000901:2026000901'], '사라진 공고도 보관');
  assert.equal(notices['apt:2026000901:2026000901'].missingSince, T2);
  assert.deepEqual(meta.newIds, ['apt:2026000908:2026000908']);
  assert.equal(notices['apt:2026000902:2026000902'].firstSeenAt, first['apt:2026000902:2026000902'].firstSeenAt);
  await rm(dir, { recursive: true, force: true });
});

test('총건수 불일치(페이지 누락) → 그 소스는 실패, 기존 공고 유지, degraded', async () => {
  reset();
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  await run('validate.mjs', dir);
  const before = Object.keys((await load(dir, 'store.json')).notices).length;

  state.shortPage = new Set(['getAPTLttotPblancDetail']);
  const f = await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  assert.equal(f.code, 0);
  assert.match(f.stderr, /기대 \d+건 ≠ 수집 \d+건/);
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.output.status, 'degraded');
  const meta = await load(dir, 'meta.json');
  assert.equal(meta.sources.apt.status, 'error');
  assert.equal(Object.keys((await load(dir, 'store.json')).notices).length, before, '아파트 공고가 지워지지 않음');
  await rm(dir, { recursive: true, force: true });
});

test('청약홈 전면 실패 → 검증 차단, 기존 데이터 그대로', async () => {
  reset();
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  await run('validate.mjs', dir);
  const snapshot = await readFile(path.join(dir, 'data', 'store.json'), 'utf8');

  state.fail = new Set(['getAPTLttotPblancDetail', 'getRemndrLttotPblancDetail', 'getOPTLttotPblancDetail', 'getOptLttotPblancDetail', 'getUrbtyOfctlLttotPblancDetail']);
  await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 1);
  assert.equal(v.output.status, 'failed');
  assert.equal(await readFile(path.join(dir, 'data', 'store.json'), 'utf8'), snapshot, '바이트 단위로 동일');
  await rm(dir, { recursive: true, force: true });
});

test('다음 결과에서 공고가 빠지면 검증이 막는다', async () => {
  reset();
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  await run('validate.mjs', dir);
  await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  const file = path.join(dir, 'data', 'next', 'store.json');
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => !l.includes('2026000902'));
  await writeFile(file, lines.join('\n').replace(/,\n\}\}/, '\n}}'));
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 1);
  assert.match(v.stderr, /삭제됨: apt:2026000902/);
  await rm(dir, { recursive: true, force: true });
});

test('LH 활용신청 안 된 키 → LH 만 미연결, 전체는 정상', async () => {
  reset();
  state.lhAuthError = true;
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.output.status, 'ok');
  assert.equal((await load(dir, 'meta.json')).sources.lh.status, 'not-enabled');
  await rm(dir, { recursive: true, force: true });
});

test('인증키 없으면 수집하지 않고 멈춘다', async () => {
  const dir = await sandbox();
  const f = await run('fetch.mjs', dir, { APPLYHOME_API_KEY: '' });
  assert.equal(f.code, 2);
  assert.match(f.stderr, /APPLYHOME_API_KEY/);
  await rm(dir, { recursive: true, force: true });
});

test('재시도 슬롯: 06시 실행이 수집·배포·알림까지 끝났을 때만 12시는 건너뜀', async () => {
  const dir = await sandbox();
  const runAt = new Date().toISOString();
  await writeFile(path.join(dir, 'data', 'meta.json'), JSON.stringify({ status: 'ok', runAt }));
  const undelivered = await run('should-run.mjs', dir, { EVENT_NAME: 'schedule', EVENT_SCHEDULE: '0 3 * * 1' });
  assert.equal(undelivered.output.run, 'true', '배포·알림 전이면 재시도');
  await run('mark-delivered.mjs', dir, {}, [runAt]);
  const skip = await run('should-run.mjs', dir, { EVENT_NAME: 'schedule', EVENT_SCHEDULE: '0 3 * * 1' });
  assert.equal(skip.output.run, 'false');
  const main = await run('should-run.mjs', dir, { EVENT_NAME: 'schedule', EVENT_SCHEDULE: '0 21 * * 0' });
  assert.equal(main.output.run, 'true');
  await writeFile(path.join(dir, 'data', 'meta.json'), JSON.stringify({ status: 'degraded', runAt: new Date().toISOString() }));
  const retry = await run('should-run.mjs', dir, { EVENT_NAME: 'schedule', EVENT_SCHEDULE: '0 3 * * 1' });
  assert.equal(retry.output.run, 'true');
  await rm(dir, { recursive: true, force: true });
});

test('분양가가 있던 공고의 주택형이 비어 돌아와도 차단하지 않고 직전 값 유지(경고)', async () => {
  reset();
  const dir = await sandbox();
  await pass1(dir);
  state.fx.aptMdl['2026000901'] = [];
  await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.output.status, 'degraded');
  const n = (await load(dir, 'store.json')).notices['apt:2026000901:2026000901'];
  assert.equal(n.types.length, 4);
  assert.equal(n.priceStatus, 'stale');
  await rm(dir, { recursive: true, force: true });
});

test('주택형 API 장애: 연속 3회 실패 후 나머지는 건너뛰고 끝까지 완주', async () => {
  reset();
  state.fail = new Set(['getAPTLttotPblancMdl']);
  const dir = await sandbox();
  const t0 = Date.now();
  const f = await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  assert.equal(f.code, 0, f.stderr);
  const meta = JSON.parse(await readFile(path.join(dir, 'data', 'next', 'meta.json'), 'utf8'));
  assert.ok(meta.warnings.some((w) => /연속 실패로 2건/.test(w)), meta.warnings.join('\n'));
  const v = await run('validate.mjs', dir);
  assert.equal(v.output.status, 'degraded');
  const { notices } = await load(dir, 'store.json');
  assert.equal(evaluate(notices['apt:2026000901:2026000901']).bucket, 'unknown', '가격 모르면 미확인 칸 — 버리지 않음');
  assert.ok(Date.now() - t0 < 20000);
  await rm(dir, { recursive: true, force: true });
});

test('오피스텔 세부유형이 비어 있으면 제외하지 않는다', async () => {
  reset();
  delete state.fx.urbty[0].HOUSE_DTL_SECD_NM;
  const dir = await sandbox();
  await pass1(dir);
  const { notices } = await load(dir, 'store.json');
  assert.ok(notices['urbty:2026930001:2026930001'], '묶음 이름만 있는 행도 보관');
  await rm(dir, { recursive: true, force: true });
});

test('시·도를 못 읽은 공고는 경고로 드러난다', async () => {
  reset();
  state.fx.apt.push({ ...state.fx.apt[0], HOUSE_MANAGE_NO: '2026000999', PBLANC_NO: '2026000999', HOUSE_NM: '[예시] 지역 미상', SUBSCRPT_AREA_CODE_NM: '', HSSPLY_ADRES: '신도시 A-1블록' });
  const dir = await sandbox();
  const v = await pass1(dir);
  assert.equal(v.output.status, 'degraded');
  assert.match((await load(dir, 'meta.json')).validation.warnings.join(' '), /시·도를 읽지 못한 공고 1건/);
  await rm(dir, { recursive: true, force: true });
});

test('LH 가 되다가 인증 오류로 바뀌면 경고', async () => {
  reset();
  const dir = await sandbox();
  await pass1(dir);
  state.lhAuthError = true;
  await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  const v = await run('validate.mjs', dir);
  assert.equal(v.output.status, 'degraded');
  assert.equal((await load(dir, 'meta.json')).sources.lh.status, 'auth');
  await rm(dir, { recursive: true, force: true });
});

test('무순위에 본청약 단지 세대수 연결 — 이름·지역 일치할 때만', async () => {
  reset();
  const dir = await sandbox();
  const v = await pass1(dir);
  assert.equal(v.output.status, 'ok', v.stderr);
  const { notices } = await load(dir, 'store.json');
  const rem = notices['remndr:2026910002:2026910002'];
  assert.equal(rem.complexUnits, 1450, '"잔여세대" 수식어를 걷어내고 원공고와 매칭');
  assert.equal(rem.complexUrl, 'https://www.applyhome.co.kr/x?origin777');
  assert.ok(!notices['apt:2020000777:2020000777'], '원공고 자체는 기간 밖 — 저장하지 않는다');
  assert.equal(notices['remndr:2026910001:2026910001'].complexUnits, undefined, '원공고가 없으면 붙이지 않는다');
  assert.equal(notices['apt:2026000901:2026000901'].complexUnits, undefined, '신규 분양에는 붙이지 않는다');
  assert.equal(notices['remndr:2026910003:2026910003'].complexUnits, 120, '무순위 차수 "(2차)" 를 떼고 본청약과 연결');
  await rm(dir, { recursive: true, force: true });
});

test('순위별 지역 접수일(ranks)·대규모 택지 플래그 수집 — APT 전용', async () => {
  reset();
  const dir = await sandbox();
  await pass1(dir);
  const { notices } = await load(dir, 'store.json');
  const seoul = notices['apt:2026000901:2026000901'];
  assert.equal(seoul.ranks.r1.local, seoul.schedule.find((p) => p.label === '1순위').start, '해당지역 접수일');
  assert.ok(seoul.ranks.r1.etc, '서울 공고: 기타지역 접수일 존재');
  assert.equal(seoul.ranks.r1.gg, null, '서울 공고: 기타경기 없음');
  const dongtan = notices['apt:2026000904:2026000904'];
  assert.ok(dongtan.ranks.r1.local && dongtan.ranks.r1.gg && dongtan.ranks.r1.etc, '대규모 택지: 3단 접수');
  assert.ok(dongtan.flags.includes('대규모 택지'));
  assert.equal(notices['remndr:2026910002:2026910002'].ranks, null, '무순위에는 지역 구분 접수일이 없다');
  await rm(dir, { recursive: true, force: true });
});

test('주택형 세대 구성: 일반·특공 분리와 특공 유형(신혼부부 등) 수집', async () => {
  reset();
  const dir = await sandbox();
  const v = await pass1(dir);
  assert.equal(v.output.status, 'ok', v.stderr);
  const { notices } = await load(dir, 'store.json');
  const apt = notices['apt:2026000901:2026000901'].types;
  assert.equal(apt[0].general, 80);
  assert.equal(apt[0].special, 60);
  assert.deepEqual(apt[0].sp, { newly: 20, first: 12, multi: 10, newborn: 7, old: 3, org: 8 }, '0건(청년)은 넣지 않는다');
  assert.equal(apt[3].special, 0);
  assert.equal(apt[3].sp, undefined, '특공 0 이면 유형 없음');
  const rem = notices['remndr:2026910002:2026910002'].types[0];
  assert.equal(rem.general, 2, '무순위도 일반 세대수 분리');
  assert.equal(rem.special, null, '무순위 특공 필드가 없으면 null — 0 으로 지어내지 않는다');
  const opt = notices['opt:2026920001:2026920001'].types[0];
  assert.equal(opt.units, 12);
  await rm(dir, { recursive: true, force: true });
});

test('실거래 시세: 시군구·밴드별 중위 ㎡당가 — 해제 제외, 검증 상태에 영향 없음', async () => {
  reset();
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  const m = await run('market.mjs', dir);
  assert.equal(m.code, 0, m.stderr);
  const v = await run('validate.mjs', dir);
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.output.status, 'ok', '시세는 참고 데이터 — 검증 상태를 바꾸지 않는다');

  const mk = (await load(dir, 'meta.json')).market;
  assert.equal(mk.status, 'ok');
  const gs = mk.areas['서울|강서구'];
  assert.equal(gs.n, 11, '해제 1건·토지임대부 1건 제외 후 11건');
  assert.equal(gs.bands.s.n, 5);
  assert.equal(gs.bands.m.n, 6);
  assert.ok(gs.bands.m.m2 > 1500 && gs.bands.m.m2 < 1650, `84급 중위 ㎡당가 ${gs.bands.m.m2}`);
  const gm = mk.areas['경기|광명시'];
  assert.equal(gm.bands.s.n, 4, '표본 부족 밴드도 수치는 보관(화면이 5건 미만을 숨긴다)');
  assert.equal(gm.bands.all.n, 9);
  assert.equal(mk.areas['경기|평택시'].n, 3);
  assert.ok(mk.areas['경기|화성시'], '거래 없는 시군구도 0건으로 기록');

  const b = await run('build.mjs', dir);
  assert.equal(b.code, 0, b.stderr);
  const site = JSON.parse(await readFile(path.join(dir, '_site', 'data.json'), 'utf8'));
  assert.equal(site.meta.market.areas['서울|강서구'].bands.m.n, 6, 'data.json 에 실림');
  await rm(dir, { recursive: true, force: true });
});

test('실거래 API 실패·미신청 — 주간 갱신은 계속, 지난 시세 유지', async () => {
  reset();
  const dir = await sandbox();
  await run('fetch.mjs', dir, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  await run('market.mjs', dir);
  await run('validate.mjs', dir);

  // 다음 주: RTMS 500 → 지난 시세를 stale 로 유지, 검증은 여전히 ok
  state.rtmsFail = true;
  await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  const m2 = await run('market.mjs', dir);
  assert.equal(m2.code, 0, '실패해도 exit 0');
  const v = await run('validate.mjs', dir);
  assert.equal(v.output.status, 'ok', v.stdout + v.stderr);
  const mk = (await load(dir, 'meta.json')).market;
  assert.equal(mk.status, 'stale');
  assert.equal(mk.areas['서울|강서구'].bands.m.n, 6, '지난 주 시세 그대로');
  await rm(dir, { recursive: true, force: true });

  // 처음부터 활용신청이 안 된 키 → not-enabled, 나머지는 정상
  state.rtmsFail = false;
  state.rtmsAuthError = true;
  const dir2 = await sandbox();
  await run('fetch.mjs', dir2, { RUN_AT: '2026-09-27T21:00:00.000Z' });
  const m3 = await run('market.mjs', dir2);
  assert.equal(m3.code, 0);
  const v2 = await run('validate.mjs', dir2);
  assert.equal(v2.output.status, 'ok');
  assert.equal((await load(dir2, 'meta.json')).market.status, 'not-enabled');
  await rm(dir2, { recursive: true, force: true });
});

test('요약은 마지막 전달 이후 신규만 — 배포·알림 실패한 주의 신규는 다음 주로 넘어간다', async () => {
  reset();
  const dir = await sandbox();
  await pass1(dir);
  let n = await run('notify.mjs', dir);
  const firstCount = Number(n.output.digest_count);
  assert.ok(firstCount >= 7);
  // 이번 주는 배포 실패 → 전달 표시 없음. 다음 주에 신규 1건 추가
  state.fx.apt.push({ ...state.fx.apt[1], HOUSE_MANAGE_NO: '2026000908', PBLANC_NO: '2026000908', HOUSE_NM: '[예시] 신규 단지', RCRIT_PBLANC_DE: TODAY });
  state.fx.aptMdl['2026000908'] = [{ HOUSE_TY: '059.9900A', LTTOT_TOP_AMOUNT: '70000' }];
  await run('fetch.mjs', dir, { RUN_AT: '2026-10-04T21:00:00.000Z' });
  await run('validate.mjs', dir);
  n = await run('notify.mjs', dir);
  assert.equal(Number(n.output.digest_count), firstCount + 1, '지난주 미전달분 + 이번 주 신규');
  // 전달 완료 후에는 다시 알리지 않는다
  const meta = await load(dir, 'meta.json');
  await run('mark-delivered.mjs', dir, {}, [meta.runAt]);
  n = await run('notify.mjs', dir);
  assert.equal(Number(n.output.digest_count), 0);
  await rm(dir, { recursive: true, force: true });
});
