// 공유 — 공유 문구·링크 조립과 시스템 공유 시트/복사 폴백. 화면 표시 전용 모듈.
// 공유 문구에는 공고 정보만 담는다 — 거주지 프로필 같은 이 기기의 개인 정보는 넣지 않는다.

/** 공고 하나로 바로 가는 링크. 받은 쪽에서 app.js 가 #n= 을 읽어 그 카드로 스크롤·강조한다. */
export function noticeUrl(base, id) {
  return `${base}#n=${encodeURIComponent(id)}`;
}

/**
 * 공유 문구(최대 3줄). 가격·일정은 화면과 같은 계산을 거친 값을 받는다 — 여기서 판정하지 않는다.
 *   [청약 알림] 광명 시티프라디움 에듀하임
 *   경기 광명시 · 아파트 · 426세대
 *   분양가 8.77억 ~ 11.98억 (59~84㎡) · 접수 9/29~10/2
 */
export function noticeShareText(n, { sourceLabel, range, area, when } = {}) {
  const line2 = [
    [n.region, n.sigungu].filter(Boolean).join(' '),
    sourceLabel,
    n.units > 0 ? `${n.units.toLocaleString('ko-KR')}세대` : null,
  ].filter(Boolean).join(' · ');
  const price = range && range !== '—' ? `분양가 ${range}${area ? ` (${area})` : ''}` : null;
  const line3 = [price, when].filter(Boolean).join(' · ');
  return [`[청약 알림] ${n.name}`, line2, line3].filter(Boolean).join('\n');
}

/**
 * 시스템 공유 시트(Web Share) → 안 되면 클립보드 복사 → 그것도 안 되면 직접 복사 창.
 * 반환: 'shared' | 'cancelled' | 'copied' | 'manual'
 * nav·doc·ask 는 테스트에서 바꿔 끼우는 용도(기본은 브라우저 전역).
 * navigator.share 는 클릭 직후에만 허용되므로, 이 함수 앞에서 await 하지 않는다.
 */
export async function shareOrCopy(data, { nav = globalThis.navigator, doc = globalThis.document, ask = globalThis.prompt } = {}) {
  if (typeof nav?.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';   // 사용자가 공유 시트를 닫음 — 복사로 넘기지 않는다
    }
  }
  const body = [data.text, data.url].filter(Boolean).join('\n');
  if (await copyText(body, { nav, doc })) return 'copied';
  ask?.('아래 내용을 복사해 보내세요', body);
  return 'manual';
}

export async function copyText(s, { nav = globalThis.navigator, doc = globalThis.document } = {}) {
  try {
    if (typeof nav?.clipboard?.writeText === 'function') {
      await nav.clipboard.writeText(s);
      return true;
    }
  } catch { /* 권한 거부 등 — 아래 방식으로 */ }
  try {
    if (!doc?.body) return false;
    const ta = doc.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
