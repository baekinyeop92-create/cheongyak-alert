# Claude Code 인계 — 청약 알림 v2

## 넘기기 전 사람이 할 일 (3가지)

1. **인증키 발급** — [공공데이터포털 청약홈 분양정보 조회 서비스](https://www.data.go.kr/data/15098547/openapi.do) → 활용신청(자동승인) → 마이페이지 → 개발계정 → **일반 인증키(Decoding)** 복사
   - 발급 직후 1~2시간은 "등록되지 않은 인증키" 오류가 날 수 있음
2. **`.env.local` 파일 만들기** — 이 폴더(cheongyak-alert) 안에 새 파일, 내용은 한 줄:
   ```
   APPLYHOME_API_KEY=여기에_Decoding_키
   ```
   (.gitignore 처리돼 있어 GitHub 에 올라가지 않음)
3. **GitHub CLI 로그인** — https://cli.github.com 에서 설치 → 터미널에서 `gh auth login`

## 시작

터미널에서 이 폴더로 이동 → `claude` 실행 → 아래 프롬프트를 **첫 메시지로 그대로 붙여 넣기**

```
이 폴더는 '청약 알림 v2'다. 서울·경기 청약 공고 중 주택형 최고 분양가 13억 이하만 매주 모아
GitHub Pages 에 올리는 정적 사이트다. 코드는 완성·테스트된 상태이고, 네 일은 실제 API 확인과 배포다.
먼저 CLAUDE.md 와 DEPLOY.md 를 읽어라.

[규칙]
- site/core.js 판정 기준과 CLAUDE.md 불변 조건 1~9 는 바꾸지 마라. 바꿔야 한다고 판단되면 멈추고 이유부터 보고.
- 인증키는 .env.local 에만 있다. 키 값을 출력·로그·커밋하지 마라.
- 저장소 이름은 cheongyak-alert 로 고정(사이트 주소가 이 이름으로 정해진다).
- 각 단계가 끝날 때마다 결과를 한 줄로 보고.

[순서]
1. node -v(20.11 이상), gh auth status 확인. 안 되어 있으면 나에게 요청.
2. npm test → 25/25 통과.
3. .env.local 확인(없으면 나에게 요청) 후 npm run live-check.
   - 통과 조건: 청약홈 4개 소스 모두 ✓, 받은 건수 = 총건수.
   - 실패 시 원인을 인증(키 미승인·발급 직후 1~2시간) / 오퍼레이션명 / 필드명 변경 / 네트워크 중 하나로 분류해 보고.
   - 필드명이 실제 응답과 다르면 raw 응답 1페이지(perPage=3)의 필드명을 보여 주고, 필드 후보를 '추가'하는
     방식으로만 고쳐라(기존 후보 삭제 금지). test/mock-server.mjs 에도 같은 형태를 넣고 npm test 재통과.
   - 표본 5건 중 2건은 청약홈 공고 링크를 열어 분양가가 맞는지 대조.
4. git init -b main → 첫 커밋 → gh repo create cheongyak-alert --public --source=. --push
5. gh secret set APPLYHOME_API_KEY --body "$(grep '^APPLYHOME_API_KEY=' .env.local | cut -d= -f2-)"
6. Pages 활성화: gh api -X POST repos/{owner}/cheongyak-alert/pages -f build_type=workflow (이미 있으면 -X PUT)
7. gh workflow run weekly.yml → gh run watch 로 끝까지 지켜보기. update·deploy·notify 모두 success.
8. 배포된 사이트의 data.json 을 받아 meta.status, 청약홈 4개 소스 status=ok·fetched==expected, counts 확인.
   Issues 탭에 digest 이슈가 생겼는지 확인.
9. 최종 보고: 사이트 주소 / 13억 이하 진행 중 건수 / 경고 목록 / 내가 해야 할 남은 일.
```

## 끝났을 때 확인할 것

- [ ] Claude Code 최종 보고에 사이트 주소 `https://<계정>.github.io/cheongyak-alert/` 가 있음
- [ ] 사이트 하단 **수집 점검** 표: 청약홈 4줄 모두 "정상", 받은 건수 = 총건수
- [ ] GitHub Issues 탭에 "청약 알림 YYYY-MM-DD — 신규 N건" 이슈
- [ ] 휴대폰에서 사이트 열고 **공유 → 홈 화면에 추가**
