# 청약 알림 v2 — 작업 규칙

서울·경기 청약 공고 중 주택형 최고 분양가 13억 이하를 매일 모으는 정적 사이트. 의존성 0, Node 22.

- 실행: 매일 06:00 KST + 12:00 재시도(weekly.yml 두 cron = should-run.mjs RETRY_CRON). 수동 실행은 **00~01시 금지** — 청약홈 API 가 하루치를 갱신하며 아파트·무순위·오피스텔을 0건으로 응답한다(fetch 는 직전 정상 건수가 있는데 0 이 오면 그 소스만 건너뛴다).

## 불변 조건 (바꾸면 validate.mjs 나 테스트가 깨져야 정상)

1. **판정은 site/core.js 한 곳.** 화면(app.js)·요약(notify)·검증(validate)이 모두 import 한다. 복사하지 말 것.
2. **삭제 금지.** data/store.json 의 공고는 추가·갱신만. API 에서 사라지면 `missingSince` 만 단다.
3. **전량 수집.** 소스별 fetched === expected(matchCount) 가 아니면 그 소스는 실패. 부분 데이터로 "정상" 표시 금지.
4. **네 칸 합계 = 표시 건수.** pass+border+unknown+over === visible. 판정 불가는 unknown 으로, 버리지 않는다.
5. **승격은 validate 만.** fetch 는 data/next/ 에만 쓴다. 차단 시 기존 data/·사이트 유지.
6. **주소 고정.** 워크플로·스크립트는 Pages 설정·CNAME·저장소 이름을 건드리지 않는다.
7. 상태·D-day 는 저장하지 않고 접속 시점에 계산한다(statusOf).
8. **저장 → 배포 → 전달 순서.** push 성공 전 배포 금지(scripts/push.sh 는 실패 시 exit 1). data/delivery.json 은 배포·이슈 성공 뒤에만 갱신 — 요약은 그 이후 신규만 알린다.
9. LH↔청약홈 병합은 확실할 때만(lib.nameMatch). 애매하면 둘 다 보여준다.

## 수정 후

```bash
npm test          # 25개 통과
npm run demo && python3 -m http.server 8080 -d _demo/site   # 화면 확인, 콘솔 에러 0
npm run live-check   # 실제 API 점검(.env.local 의 키 사용, 저장소 data/ 는 안 건드림) — 배포 전·필드 수정 후
```

## API 메모

- 청약홈 odcloud: `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/<op>?serviceKey=&page=&perPage=&cond[PBLANC_NO::EQ]=`
- 날짜: APT·무순위 `YYYY-MM-DD`, 임의공급 `YYYYMMDD`, LH `YYYY.MM.DD` → lib.toIso
- 금액: 만원. 임의공급은 쉼표 포함 → lib.manwon
- 오피스텔 주택형: `TP`·`EXCLUSE_AR`·`SUPLY_AMOUNT`
- 임의공급 오퍼레이션 대소문자(getOPT…/getOpt…) 구현마다 다름 → 후보 순회, 성공한 이름은 meta.opCache
- LH: `apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1`, PG_SZ·PAGE·UPP_AIS_TP_CD(05·39)·CNP_CD(11·41), 응답은 중첩 배열 → PAN_ID 가진 객체를 재귀로 수집
  - 기간: 실제 서버는 공고게시일 `PAN_ST_DT~PAN_ED_DT`(YYYYMMDD)만 받는다. 명세의 `PAN_NT_ST_DT·CLSG_DT` 만 보내면 무시되고 최근 2개월 기본값 → 둘 다 보낸다(응답 dsSch 로 확인 가능)
  - 39(신혼희망타운)에 '행복주택(신혼희망)'(AIS_TP_CD 42, 임대)이 섞여 온다 → 제외. LH 공고엔 분양가가 없어 '가격 미확인' 칸(공급정보 API 15056765 는 별도 활용신청 필요)
  - LH 서버는 GitHub 러너에서 간헐적 접속 실패 → 마지막 성공 2일 안의 실패는 경고하지 않음(validate)
