# 배포 — 약 15분, 한 번만

결과 주소: `https://<GitHub계정>.github.io/cheongyak-alert/` (소문자 계정명)

## 1. 인증키 (공공데이터포털, 자동승인)

1. [data.go.kr](https://www.data.go.kr) 로그인 → 아래 두 서비스에서 **활용신청**
   - [한국부동산원_청약홈 분양정보 조회 서비스](https://www.data.go.kr/data/15098547/openapi.do) — **필수**
   - [한국토지주택공사_분양임대공고문 조회 서비스](https://www.data.go.kr/data/15058530/openapi.do) — 선택(LH 공고 보강)
2. 마이페이지 → 개발계정 → **일반 인증키(Decoding)** 복사. 두 서비스 모두 같은 키를 씁니다.
   - 신청 직후 1~2시간은 "등록되지 않은 인증키" 가 날 수 있습니다.

## 2. 저장소

1. GitHub → New repository → 이름 **`cheongyak-alert`** · **Public** (무료 Pages 조건) → Create
2. 이 폴더 전체를 올립니다.
   - 웹: 저장소 첫 화면 **uploading an existing file** → 폴더 안 파일 전부 드래그 (`.github` 폴더 포함 확인)
   - 또는 터미널:
     ```bash
     cd cheongyak-alert
     git init -b main && git add -A && git commit -m "청약 알림 v2"
     git remote add origin https://github.com/<계정>/cheongyak-alert.git
     git push -u origin main
     ```

## 3. 설정 2곳

| 위치 | 값 |
|---|---|
| Settings → Secrets and variables → Actions → **Secrets** → New | `APPLYHOME_API_KEY` = 1단계 Decoding 키 |
| Settings → **Pages** → Build and deployment → Source | **GitHub Actions** |

선택: Secrets `TG_TOKEN`·`TG_CHAT_ID`(텔레그램), `LH_API_KEY`(LH 키가 다를 때) · Variables `LH_ENABLED=false`(LH 끄기), `SITE_URL`(커스텀 도메인 쓸 때)

## 4. 첫 실행

Actions 탭 → (처음이면 "I understand… enable" 클릭) → **weekly-update** → **Run workflow** → 3~5분

확인:
- [ ] update·deploy·notify 세 칸 모두 초록
- [ ] 사이트 하단 **수집 점검** 표: 청약홈 4줄 모두 "정상", 받은 건수 = 총건수
- [ ] Issues 탭에 "청약 알림 YYYY-MM-DD — 신규 N건" 이슈 (첫 실행은 전부 신규)

## 5. 알림 받기

- 이슈 본문이 저장소 주인을 @멘션하므로 GitHub 알림 메일이 옵니다. 휴대폰 푸시는 GitHub 앱 → 알림 켜기.
- 사이트를 휴대폰에서 열고 **공유 → 홈 화면에 추가**하면 앱 아이콘으로 열립니다.
- RSS 리더: `https://<계정>.github.io/cheongyak-alert/feed.xml`

## 주소가 바뀌지 않게 — 하지 말 것

- 저장소 **이름 변경·소유자 이전** (주소가 바뀝니다)
- Pages Source 를 "Deploy from a branch" 로 되돌리기
- 커스텀 도메인을 쓰려면 Settings → Pages → Custom domain 에서 한 번만 지정하고 Variables `SITE_URL` 도 같은 값으로. 워크플로는 도메인 설정을 건드리지 않습니다.

## 문제가 생기면

| 증상 | 원인·조치 |
|---|---|
| 이슈 "⚠ 주간 갱신 실패" | 로그 링크 확인. 대부분 인증키 만료(1~2년)·미등록 → 키 재발급 후 Secret 교체 → Run workflow |
| 점검표 "형식 이상" | 청약홈 필드명 변경 의심. 이 폴더를 Claude Code 로 열고 아래 프롬프트 사용 |
| 사이트 상단 빨간 배너(8일 초과) | Actions 탭에서 weekly-update 가 꺼졌는지 확인 → Enable workflow |
| deploy 실패 "Get Pages site failed" | 3단계 Pages Source 를 GitHub Actions 로 |

## Claude Code 로 배포할 때 (권장)

준비(사람이 할 일): ① 1단계 인증키 발급 ② 이 폴더 안에 `.env.local` 파일을 만들고 `APPLYHOME_API_KEY=<Decoding 키>` 한 줄 ③ [GitHub CLI](https://cli.github.com) 설치 후 `gh auth login`
그다음 이 폴더에서 `claude` 를 실행하고 아래를 첫 메시지로 붙여 넣습니다.

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
