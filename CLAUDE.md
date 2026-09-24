# 청약 알림 v2 — 작업 규칙

서울·경기 청약 공고 중 주택형 최고 분양가 13억 이하를 매주 모으는 정적 사이트. 의존성 0, Node 22.

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
- LH: `apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1`, PG_SZ·PAGE·UPP_AIS_TP_CD(05·39)·CNP_CD(11·41)·PAN_NT_ST_DT·CLSG_DT, 응답은 중첩 배열 → PAN_ID 가진 객체를 재귀로 수집
