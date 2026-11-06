// 📥 수집함 패널(2026-11-06) — 인스타 운영실·유튜브 운영실이 같이 쓰는 읽기 전용 목록.
// <div class="collect-panel" data-platform="instagram"></div> 자리에 그린다. 데이터는 /api/collect(collectHub.js) 하나뿐이라
// 운영실 저장(ops.json rev)과 부딪히지 않는다. 담기는 📥 북마클릿(레퍼런스 보드 상단에서 설치), 정리는 자동.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const css = `.cp-hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.cp-list{max-height:420px;overflow-y:auto}
.cp-it{display:flex;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07)}.cp-it img{width:64px;height:64px;object-fit:cover;border-radius:6px;background:#000;flex:none}
.cp-t{font-size:13px;font-weight:600}.cp-s{font-size:12px;opacity:.8;margin-top:2px}.cp-c{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(167,139,250,.15);color:#c4b5fd;margin:4px 4px 0 0}
.cp-k{background:rgba(233,196,106,.13);color:#e9c46a}`
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
  for (const el of document.querySelectorAll('.collect-panel')) {
    const plat = el.dataset.platform
    el.innerHTML = `<div class="cp-hd"><button class="btn" data-run>🔄 지금 가져오기·정리</button>
      <a class="btn" href="/downloads/_shared/references/library/index.html" target="_blank" style="text-decoration:none">📥 담기 버튼 설치·레퍼런스 보드</a>
      <span class="muted" data-st style="font-size:12px"></span></div><div class="card cp-list" data-list>불러오는 중…</div>`
    const load = () => fetch('/api/collect?platform=' + plat).then((r) => r.json()).then((d) => {
      const items = d.items || []
      const last = d.status?.last
      el.querySelector('[data-st]').textContent = `${items.length}건` + (last ? ` · 마지막 정리 ${last.at.slice(5, 16).replace('T', ' ')}` : '') +
        (plat === 'youtube' && !(d.status?.sources?.youtube || []).length ? ' · 유튜브 "벤치마킹 영상" 재생목록 화면에서 📥 담기를 한 번 누르면 이후 자동으로 들어옵니다(일부공개)' : '') +
        (plat === 'instagram' ? ' · 인스타는 저장 컬렉션 화면에서 📥 담기를 누를 때만 들어옵니다(로그인 필요)' : '')
      el.querySelector('[data-list]').innerHTML = items.length ? items.map((e) => `<div class="cp-it">
          ${e.thumb ? `<img src="${esc(e.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<img alt="">'}
          <div style="min-width:0;flex:1"><div class="cp-t"><a href="${esc(e.url)}" target="_blank" style="color:inherit">${esc(e.title || e.url)}</a></div>
          <div class="cp-s">${e.status === 'new' ? '정리 대기 중…' : '📄 ' + esc(e.summary || '')}${e.idea ? '<br>💡 ' + esc(e.idea) : ''}</div>
          <div>${[e.usage, e.technique && e.technique + (e.techDetail ? ' › ' + e.techDetail : '')].filter(Boolean).map((c) => `<span class="cp-c">${esc(c)}</span>`).join('')}${(e.keywords || []).map((k) => `<span class="cp-c cp-k">#${esc(k)}</span>`).join('')}${e.storyId ? '<span class="cp-c">🔎 연출기법 아카이브에 추가됨</span>' : ''}</div></div></div>`).join('')
        : '<p class="muted">아직 수집된 자료가 없습니다.</p>'
    }).catch(() => { el.querySelector('[data-list]').textContent = '수집함을 불러오지 못했습니다' })
    el.querySelector('[data-run]').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = '가져오는 중…(1~2분)'
      await fetch('/api/collect/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
      b.disabled = false; b.textContent = '🔄 지금 가져오기·정리'; load()
    }
    load()
  }
})()
