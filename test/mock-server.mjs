// 청약홈(odcloud)·LH(data.go.kr) 응답을 흉내내는 스텁 서버.
// 필드명·날짜·금액 표기는 공개 구현 3곳(Jung-Yunho/cheongyak-alert, kyhsa93/housing-subsidy-radar,
// naver-estate-web PR#558)이 실측으로 확인한 형식을 따른다:
//   - APT·무순위는 "2026-08-13", 임의공급은 "20260813"
//   - 임의공급 LTTOT_TOP_AMOUNT 는 "27,600" 처럼 쉼표
//   - 오피스텔 주택형은 TP·EXCLUSE_AR·SUPLY_AMOUNT
//   - 임의공급 오퍼레이션 이름 대소문자가 구현마다 다름 → 여기선 getOpt… 만 받아 폴백을 시험한다
import http from 'node:http';

const add = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const compact = (iso) => iso.replaceAll('-', '');

export function makeFixtures(today) {
  const T = (n) => add(today, n);
  const apt = [
    {
      HOUSE_MANAGE_NO: '2026000901', PBLANC_NO: '2026000901', HOUSE_NM: '[예시] 강서 리버뷰 1단지',
      HOUSE_SECD: '01', HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD_NM: '민영', SUBSCRPT_AREA_CODE_NM: '서울',
      HSSPLY_ADRES: '서울특별시 강서구 마곡동 123-4번지 일원', TOT_SUPLY_HSHLDCO: 412, RCRIT_PBLANC_DE: T(-4),
      SPSPLY_RCEPT_BGNDE: T(3), SPSPLY_RCEPT_ENDDE: T(3), GNRL_RNK1_CRSPAREA_RCPTDE: T(4), GNRL_RNK1_CRSPAREA_ENDDE: T(4),
      GNRL_RNK1_ETC_AREA_RCPTDE: T(5), GNRL_RNK1_ETC_AREA_ENDDE: T(5), GNRL_RNK2_CRSPAREA_RCPTDE: T(6), GNRL_RNK2_CRSPAREA_ENDDE: T(6),
      RCEPT_BGNDE: T(3), RCEPT_ENDDE: T(6), PRZWNER_PRESNATN_DE: T(12), CNTRCT_CNCLS_BGNDE: T(24), CNTRCT_CNCLS_ENDDE: T(26),
      MVN_PREARNGE_YM: '202903', CNSTRCT_ENTRPS_NM: '예시건설(주)', PARCPRC_ULS_AT: 'Y', SPECLT_RDN_EARTH_AT: 'N',
      PBLANC_URL: 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2026000901&pblancNo=2026000901',
      HMPG_ADRES: 'www.example.com',
    },
    {
      HOUSE_MANAGE_NO: '2026000902', PBLANC_NO: '2026000902', HOUSE_NM: '[예시] 서초 하이엔드',
      HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD_NM: '민영', SUBSCRPT_AREA_CODE_NM: '서울',
      HSSPLY_ADRES: '서울특별시 서초구 반포동 1-1', TOT_SUPLY_HSHLDCO: 120, RCRIT_PBLANC_DE: T(-2),
      RCEPT_BGNDE: T(8), RCEPT_ENDDE: T(10), PBLANC_URL: 'https://www.applyhome.co.kr/x?2',
    },
    {
      HOUSE_MANAGE_NO: '2026000903', PBLANC_NO: '2026000903', HOUSE_NM: '[예시] 성남 센트럴',
      HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD_NM: '민영', SUBSCRPT_AREA_CODE_NM: '경기',
      HSSPLY_ADRES: '경기도 성남시 수정구 신흥동 81-8', TOT_SUPLY_HSHLDCO: 540, RCRIT_PBLANC_DE: T(-6),
      SPSPLY_RCEPT_BGNDE: T(0), SPSPLY_RCEPT_ENDDE: T(0), GNRL_RNK1_CRSPAREA_RCPTDE: T(1), GNRL_RNK1_CRSPAREA_ENDDE: T(1),
      RCEPT_BGNDE: T(0), RCEPT_ENDDE: T(2), PBLANC_URL: 'https://www.applyhome.co.kr/x?3',
    },
    {
      HOUSE_MANAGE_NO: '2026000904', PBLANC_NO: '2026000904', HOUSE_NM: '[예시] 동탄 파크',
      HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD_NM: '민영', SUBSCRPT_AREA_CODE_NM: '경기',
      HSSPLY_ADRES: '경기도 화성시 오산동 100', TOT_SUPLY_HSHLDCO: 300, RCRIT_PBLANC_DE: T(-1),
      LRSCL_BLDLND_AT: 'Y',   // 대규모 택지 — 해당/기타경기/기타지역 3단 접수
      GNRL_RNK1_CRSPAREA_RCPTDE: T(9), GNRL_RNK1_CRSPAREA_ENDDE: T(9),
      GNRL_RNK1_ETC_GG_RCPTDE: T(9), GNRL_RNK1_ETC_GG_ENDDE: T(9),
      GNRL_RNK1_ETC_AREA_RCPTDE: T(9), GNRL_RNK1_ETC_AREA_ENDDE: T(9),
      RCEPT_BGNDE: T(9), RCEPT_ENDDE: T(11), PBLANC_URL: 'https://www.applyhome.co.kr/x?4',
    },
    {
      HOUSE_MANAGE_NO: '2026000905', PBLANC_NO: '2026000905', HOUSE_NM: '[예시] 부산 오션',
      HOUSE_SECD_NM: 'APT', SUBSCRPT_AREA_CODE_NM: '부산', HSSPLY_ADRES: '부산광역시 해운대구 우동 1',
      RCRIT_PBLANC_DE: T(-3), RCEPT_BGNDE: T(5), RCEPT_ENDDE: T(7),
    },
    {
      HOUSE_MANAGE_NO: '2026000906', PBLANC_NO: '2026000906', HOUSE_NM: '[예시] 시흥거모 A-5블록 신혼희망타운(공공분양)(본청약)',
      HOUSE_SECD_NM: '신혼희망타운', HOUSE_DTL_SECD_NM: '국민', SUBSCRPT_AREA_CODE_NM: '경기',
      HSSPLY_ADRES: '경기도 시흥시 거모동, 군자동 시흥거모 공공주택지구 내 A-5블록', TOT_SUPLY_HSHLDCO: 650,
      RCRIT_PBLANC_DE: T(-35), RCEPT_BGNDE: T(-22), RCEPT_ENDDE: T(-20), PBLANC_URL: 'https://www.applyhome.co.kr/x?6',
    },
    {
      HOUSE_MANAGE_NO: '2026000907', PBLANC_NO: '2026000907', HOUSE_NM: '[예시] 오래된 마감 단지',
      HOUSE_SECD_NM: 'APT', SUBSCRPT_AREA_CODE_NM: '서울', HSSPLY_ADRES: '서울특별시 노원구 월계동 1',
      RCRIT_PBLANC_DE: T(-120), RCEPT_BGNDE: T(-105), RCEPT_ENDDE: T(-100),
    },
    {
      // 광명 센트럴 무순위(2026910002)의 본청약 원공고 — 수집 기간 밖이지만 단지 연결 색인에는 쓰인다
      HOUSE_MANAGE_NO: '2020000777', PBLANC_NO: '2020000777', HOUSE_NM: '[예시] 광명 센트럴',
      HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD_NM: '민영', SUBSCRPT_AREA_CODE_NM: '경기',
      HSSPLY_ADRES: '경기도 광명시 광명동 12', TOT_SUPLY_HSHLDCO: 1450,
      RCRIT_PBLANC_DE: T(-700), RCEPT_BGNDE: T(-690), RCEPT_ENDDE: T(-688),
      PBLANC_URL: 'https://www.applyhome.co.kr/x?origin777',
    },
  ];
  const aptMdl = {
    2026000901: [
      { HOUSE_TY: '059.9800A', SUPLY_AR: '84.1', SUPLY_HSHLDCO: 80, SPSPLY_HSHLDCO: 60, LTTOT_TOP_AMOUNT: '89000',
        NWWDS_HSHLDCO: 20, LFE_FRST_HSHLDCO: 12, MNYCH_HSHLDCO: 10, OLD_PARNTS_SUPORT_HSHLDCO: 3, INSTT_RECOMEND_HSHLDCO: 8, NWBB_HSHLDCO: 7, YGMN_HSHLDCO: 0 },
      { HOUSE_TY: '084.9700A', SUPLY_AR: '112.3', SUPLY_HSHLDCO: 90, SPSPLY_HSHLDCO: 70, LTTOT_TOP_AMOUNT: '124000',
        NWWDS_HSHLDCO: 22, LFE_FRST_HSHLDCO: 14, MNYCH_HSHLDCO: 12, OLD_PARNTS_SUPORT_HSHLDCO: 4, INSTT_RECOMEND_HSHLDCO: 9, NWBB_HSHLDCO: 9 },
      { HOUSE_TY: '084.9500B', SUPLY_AR: '111.9', SUPLY_HSHLDCO: 40, SPSPLY_HSHLDCO: 20, LTTOT_TOP_AMOUNT: '129800',
        NWWDS_HSHLDCO: 7, LFE_FRST_HSHLDCO: 4, MNYCH_HSHLDCO: 3, OLD_PARNTS_SUPORT_HSHLDCO: 1, INSTT_RECOMEND_HSHLDCO: 3, NWBB_HSHLDCO: 2 },
      { HOUSE_TY: '114.8600A', SUPLY_AR: '148.0', SUPLY_HSHLDCO: 52, SPSPLY_HSHLDCO: 0, LTTOT_TOP_AMOUNT: '168000' },
    ],
    2026000902: [
      { HOUSE_TY: '084.9900A', SUPLY_HSHLDCO: 60, LTTOT_TOP_AMOUNT: '210000' },
      { HOUSE_TY: '114.9900A', SUPLY_HSHLDCO: 60, LTTOT_TOP_AMOUNT: '280000' },
    ],
    2026000903: [
      { HOUSE_TY: '084.9800A', SUPLY_HSHLDCO: 300, SPSPLY_HSHLDCO: 100, LTTOT_TOP_AMOUNT: '136000' },
      { HOUSE_TY: '101.9900A', SUPLY_HSHLDCO: 140, LTTOT_TOP_AMOUNT: '150000' },
    ],
    2026000904: [],
    2026000906: [
      { HOUSE_TY: '055.9800A', SUPLY_HSHLDCO: 400, LTTOT_TOP_AMOUNT: '44812' },
      { HOUSE_TY: '059.9700A', SUPLY_HSHLDCO: 250, LTTOT_TOP_AMOUNT: '47900' },
    ],
  };
  const remndr = [
    {
      HOUSE_MANAGE_NO: '2026910001', PBLANC_NO: '2026910001', HOUSE_NM: '[예시] 송파 레이크 무순위',
      HOUSE_SECD_NM: '무순위/잔여세대', SUBSCRPT_AREA_CODE_NM: '서울', HSSPLY_ADRES: '서울특별시 송파구 거여동 181, 202번지 일원',
      TOT_SUPLY_HSHLDCO: 3, RCRIT_PBLANC_DE: T(-6), SUBSCRPT_RCEPT_BGNDE: T(-2), SUBSCRPT_RCEPT_ENDDE: T(-2),
      PRZWNER_PRESNATN_DE: T(1), PBLANC_URL: 'https://www.applyhome.co.kr/r?1',
    },
    {
      HOUSE_MANAGE_NO: '2026910002', PBLANC_NO: '2026910002', HOUSE_NM: '[예시] 광명 센트럴 잔여세대',
      HOUSE_SECD_NM: '무순위/잔여세대', SUBSCRPT_AREA_CODE_NM: '경기', HSSPLY_ADRES: '경기도 광명시 광명동 12',
      TOT_SUPLY_HSHLDCO: 5, RCRIT_PBLANC_DE: T(-3), GNRL_RCEPT_BGNDE: T(1), GNRL_RCEPT_ENDDE: T(1),
      PBLANC_URL: 'https://www.applyhome.co.kr/r?2',
    },
    {
      // '(2차)' 가 무순위 차수인 경우 — 차수를 떼고 본청약(서초 하이엔드)과 연결돼야 한다
      HOUSE_MANAGE_NO: '2026910003', PBLANC_NO: '2026910003', HOUSE_NM: '[예시] 서초 하이엔드(2차)',
      HOUSE_SECD_NM: '무순위/잔여세대', SUBSCRPT_AREA_CODE_NM: '서울', HSSPLY_ADRES: '서울특별시 서초구 반포동 1-1',
      TOT_SUPLY_HSHLDCO: 2, RCRIT_PBLANC_DE: T(-1), GNRL_RCEPT_BGNDE: T(2), GNRL_RCEPT_ENDDE: T(2),
      PBLANC_URL: 'https://www.applyhome.co.kr/r?3',
    },
  ];
  const remndrMdl = {
    2026910001: [{ HOUSE_TY: '084.9800A', SUPLY_HSHLDCO: 3, LTTOT_TOP_AMOUNT: '98000' }],
    2026910002: [
      { HOUSE_TY: '059.9900A', SUPLY_HSHLDCO: 2, LTTOT_TOP_AMOUNT: '81000' },
      { HOUSE_TY: '084.9900A', SUPLY_HSHLDCO: 3, LTTOT_TOP_AMOUNT: '110000' },
    ],
    2026910003: [{ HOUSE_TY: '084.9900A', SUPLY_HSHLDCO: 2, LTTOT_TOP_AMOUNT: '205000' }],
  };
  const opt = [
    {
      HOUSE_MANAGE_NO: '2026920001', PBLANC_NO: '2026920001', HOUSE_NM: '[예시] 평택 브릿지 임의공급',
      HOUSE_SECD_NM: '임의공급', SUBSCRPT_AREA_CODE_NM: '경기', HSSPLY_ADRES: '경기도 평택시 고덕동 5',
      TOT_SUPLY_HSHLDCO: 12, RCRIT_PBLANC_DE: compact(T(-1)), SUBSCRPT_RCEPT_BGNDE: compact(T(2)), SUBSCRPT_RCEPT_ENDDE: compact(T(10)),
      PBLANC_URL: 'https://www.applyhome.co.kr/o?1',
    },
  ];
  const optMdl = { 2026920001: [{ HOUSE_TY: '074.9800A', SUPLY_HSHLDCO: 12, LTTOT_TOP_AMOUNT: '27,600' }] };
  const urbty = [
    {
      HOUSE_MANAGE_NO: '2026930001', PBLANC_NO: '2026930001', HOUSE_NM: '[예시] 영등포 스테이 오피스텔',
      HOUSE_SECD_NM: '도시형/오피스텔/생활숙박시설/민간임대', HOUSE_DTL_SECD_NM: '오피스텔', SUBSCRPT_AREA_CODE_NM: '서울',
      HSSPLY_ADRES: '서울특별시 영등포구 여의도동 22', TOT_SUPLY_HSHLDCO: 280, RCRIT_PBLANC_DE: T(-2),
      SUBSCRPT_RCEPT_BGNDE: T(5), SUBSCRPT_RCEPT_ENDDE: T(6), PBLANC_URL: 'https://www.applyhome.co.kr/u?1',
    },
    {
      HOUSE_MANAGE_NO: '2026930002', PBLANC_NO: '2026930002', HOUSE_NM: '[예시] 수원 민간임대',
      HOUSE_SECD_NM: '도시형/오피스텔/생활숙박시설/민간임대', HOUSE_DTL_SECD_NM: '민간임대', SUBSCRPT_AREA_CODE_NM: '경기',
      HSSPLY_ADRES: '경기도 수원시 영통구 1', RCRIT_PBLANC_DE: T(-2), SUBSCRPT_RCEPT_BGNDE: T(5), SUBSCRPT_RCEPT_ENDDE: T(6),
    },
  ];
  const urbtyMdl = {
    2026930001: [
      { TP: '29A', EXCLUSE_AR: '29.84', SUPLY_HSHLDCO: 200, SUPLY_AMOUNT: '38500', SUBSCRPT_REQST_AMOUNT: '300' },
      { TP: '49A', EXCLUSE_AR: '49.52', SUPLY_HSHLDCO: 80, SUPLY_AMOUNT: '65000', SUBSCRPT_REQST_AMOUNT: '500' },
    ],
  };
  const lh = {
    '41-39': [
      { PAN_ID: '0000061001', PAN_NM: '시흥거모 A-5블록 신혼희망타운(공공분양) 입주자모집공고', UPP_AIS_TP_NM: '분양주택', AIS_TP_CD_NM: '신혼희망타운', CNP_CD_NM: '경기도', PAN_SS: '접수마감', PAN_NT_ST_DT: T(-35).replaceAll('-', '.'), CLSG_DT: T(-20).replaceAll('-', '.'), DTL_URL: 'https://apply.lh.or.kr/x?61001' },
    ],
    '11-05': [
      { PAN_ID: '0000061002', PAN_NM: '서울대방 A1블록 공공분양주택 입주자모집공고', UPP_AIS_TP_NM: '분양주택', AIS_TP_CD_NM: '공공분양', CNP_CD_NM: '서울특별시', PAN_SS: '공고중', PAN_NT_ST_DT: T(-3).replaceAll('-', '.'), CLSG_DT: T(12).replaceAll('-', '.'), DTL_URL: 'https://apply.lh.or.kr/x?61002' },
    ],
  };

  // 국토부 실거래(RTMS). 실측 응답 형식(dealAmount 쉼표, cdealType 'O'=해제) 그대로.
  // market.mjs 가 TODAY 직전 6개 '완결 월'을 물으므로 가장 최근 완결 월에만 거래를 둔다.
  const [ty, tm] = today.split('-').map(Number);
  const lastD = new Date(Date.UTC(ty, tm - 2, 1));
  const lastYm = `${lastD.getUTCFullYear()}${String(lastD.getUTCMonth() + 1).padStart(2, '0')}`;
  const tr = (aptNm, dealAmount, excluUseAr, extra = {}) => ({
    aptNm, dealAmount, excluUseAr, dealYear: String(lastD.getUTCFullYear()), dealMonth: String(lastD.getUTCMonth() + 1),
    dealDay: '15', cdealType: ' ', landLeaseholdGbn: 'N', umdNm: '예시동', buildYear: '2015', floor: '10', ...extra,
  });
  const trades = {
    // 강서구: 59급 5건 + 84급 6건 (+ 해제 1·토지임대부 1은 제외 대상)
    11500: { [lastYm]: [
      tr('예시래미안', '95,000', '59.98'), tr('예시자이', '96,500', '59.92'), tr('예시힐스', '93,800', '59.95'),
      tr('예시푸르지오', '97,200', '59.99'), tr('예시아이파크', '94,600', '59.90'),
      tr('예시래미안', '132,000', '84.98'), tr('예시자이', '135,500', '84.92'), tr('예시힐스', '128,000', '84.95'),
      tr('예시센트럴', '138,000', '84.99'), tr('예시더샵', '130,500', '84.90'), tr('예시포레', '133,700', '84.93'),
      tr('예시해제건', '999,000', '84.99', { cdealType: 'O', cdealDay: '26.09.10' }),
      tr('예시토지임대', '45,000', '84.99', { landLeaseholdGbn: 'Y' }),
    ] },
    // 광명시: 84급 5건, 59급 4건(밴드 표본 부족 → 화면은 '전체 면적'으로 폴백)
    41210: { [lastYm]: [
      tr('광명예시1', '118,000', '84.97'), tr('광명예시2', '121,000', '84.99'), tr('광명예시3', '115,500', '84.90'),
      tr('광명예시4', '119,800', '84.95'), tr('광명예시5', '117,200', '84.93'),
      tr('광명예시6', '82,000', '59.97'), tr('광명예시7', '84,500', '59.90'), tr('광명예시8', '80,700', '59.95'), tr('광명예시9', '83,100', '59.92'),
    ] },
    // 평택시: 3건뿐 → 표본 부족으로 표시하지 않는 경로
    41220: { [lastYm]: [tr('평택예시1', '38,000', '74.98'), tr('평택예시2', '39,500', '74.90'), tr('평택예시3', '36,800', '74.95')] },
  };
  return { apt, aptMdl, remndr, remndrMdl, opt, optMdl, urbty, urbtyMdl, lh, trades };
}

/**
 * state 를 바꿔 가며 시나리오를 만든다.
 *   state.fx            — makeFixtures() 결과
 *   state.fail          — Set(op) : 해당 오퍼레이션 HTTP 500
 *   state.shortPage     — Set(op) : 마지막 페이지에서 1건 누락(총건수 불일치)
 *   state.lhAuthError   — LH 가 미등록 키 XML 을 준다
 *   state.rtmsFail      — 실거래(RTMS) 가 HTTP 500
 *   state.rtmsAuthError — 실거래가 미등록 키 XML 을 준다
 */
export function startMockServer(state) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(u.pathname);
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const fx = state.fx;
    if (!u.searchParams.get('serviceKey')) return send(401, { code: -4, msg: '등록되지 않은 인증키 입니다.' });

    if (u.pathname.startsWith('/B552555/lhLeaseNoticeInfo1/')) {
      if (state.lhAuthError) {
        return send(200, '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>', 'text/xml');
      }
      const key = `${u.searchParams.get('CNP_CD')}-${u.searchParams.get('UPP_AIS_TP_CD')}`;
      const all = fx.lh[key] ?? [];
      const size = Number(u.searchParams.get('PG_SZ'));
      const page = Number(u.searchParams.get('PAGE'));
      const rows = all.slice((page - 1) * size, page * size).map((r, i) => ({ ...r, ALL_CNT: String(all.length), RNUM: String((page - 1) * size + i + 1) }));
      return send(200, [{ dsSch: [{ PG_SZ: String(size) }] }, { dsList: rows, resHeader: [{ SS_CODE: 'Y', RS_DTTM: '20260928060000' }] }]);
    }

    if (u.pathname === '/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade') {
      if (state.rtmsAuthError) {
        return send(200, '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>', 'text/xml');
      }
      if (state.rtmsFail) return send(500, 'server error', 'text/plain');
      const all = fx.trades?.[u.searchParams.get('LAWD_CD')]?.[u.searchParams.get('DEAL_YMD')] ?? [];
      const rows = Number(u.searchParams.get('numOfRows') || 10);
      const page = Number(u.searchParams.get('pageNo') || 1);
      const slice = all.slice((page - 1) * rows, page * rows);
      const items = slice.map((r) => `<item>${Object.entries(r).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`).join('');
      return send(200, `<?xml version="1.0" encoding="utf-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items}</items><numOfRows>${rows}</numOfRows><pageNo>${page}</pageNo><totalCount>${all.length}</totalCount></body></response>`, 'text/xml');
    }

    const m = u.pathname.match(/^\/api\/ApplyhomeInfoDetailSvc\/v1\/(\w+)$/);
    if (!m) return send(404, 'not found', 'text/plain');
    const op = m[1];
    if (state.fail?.has(op)) return send(500, { code: -1, msg: '시스템 에러' });
    const table = {
      getAPTLttotPblancDetail: fx.apt,
      getRemndrLttotPblancDetail: fx.remndr,
      getOptLttotPblancDetail: fx.opt,
      getUrbtyOfctlLttotPblancDetail: fx.urbty,
    };
    const mdl = {
      getAPTLttotPblancMdl: fx.aptMdl,
      getRemndrLttotPblancMdl: fx.remndrMdl,
      getOptLttotPblancMdl: fx.optMdl,
      getUrbtyOfctlLttotPblancMdl: fx.urbtyMdl,
    };
    let all;
    if (table[op]) all = table[op];
    else if (mdl[op]) {
      const pn = u.searchParams.get('cond[PBLANC_NO::EQ]');
      all = (mdl[op][pn] ?? []).map((r) => ({ HOUSE_MANAGE_NO: pn, PBLANC_NO: pn, ...r }));
    } else return send(200, { code: -3, msg: '등록되지 않은 서비스 입니다.' });

    const page = Number(u.searchParams.get('page') || 1);
    const per = Number(u.searchParams.get('perPage') || 10);
    let data = all.slice((page - 1) * per, page * per);
    if (state.shortPage?.has(op) && page * per >= all.length && data.length) data = data.slice(0, -1);
    return send(200, { currentCount: data.length, data, matchCount: all.length, page, perPage: per, totalCount: all.length });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls }));
  });
}
