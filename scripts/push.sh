#!/usr/bin/env bash
# 커밋을 원격에 올린다. 3번 모두 실패하면 exit 1 — 저장되지 않은 데이터로 배포가 이어지지 않게 한다.
set -u
branch="${GITHUB_REF_NAME:-main}"
for i in 1 2 3; do
  if git pull --rebase origin "$branch" && git push origin "HEAD:$branch"; then
    echo "✓ push 완료 ($i회차)"
    exit 0
  fi
  git rebase --abort >/dev/null 2>&1 || true
  echo "push 실패 ($i/3) — 5초 후 재시도"
  sleep 5
done
echo "::error::데이터 커밋 push 3회 실패 — 배포를 중단합니다(브랜치 보호 규칙·동시 실행 확인)"
exit 1
