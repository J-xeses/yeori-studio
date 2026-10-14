import { useState } from 'react'
import { glossParts, spUnregistered, lookUnregistered, registerCode } from '../lib/codeRef'

// 코드 입력칸 바로 아래에 붙는 한글 풀이 한 줄 — 예: SH_MCU(미디엄 클로즈업) → SH_CU(클로즈업).
// 코드북에 없는 코드는 "(?)" + 주황색으로 표시한다.
//
// sp/ch/lookId 는 추가로 클릭 가능 — 누르면 바로 아래 등록 창이 펼쳐지고, 그 컷의 공간설명(한글)·
// 캐릭터설명(한글)(defaultLabel)이 기본값으로 이미 채워져 있어 대부분은 그대로 "신규 등록"만 누르면
// 된다(2026-10-14). 처음엔 전체목록에 "에피소드마다 새로 한글 이름을 입력하는" 패널을 뒀는데, 성준님
// 피드백: "에피소드 신규기획 할때마다 새로 이름짓는 과정을 필수로 거쳐야 하는 부담" — 그 컷의 AI가
// 이미 써둔 한글 설명을 기본값으로 재사용하면 새로 짓는 과정 자체가 없어진다. sh/ca/md/ac/pl 은
// 여전히 클릭 불가(표시만) — 이유는 server/proxy.js의 /api/codebook/register 주석 참고.
export default function CodeGloss({ cb, kind, value, sep = ' · ', defaultLabel = '' }) {
  const parts = glossParts(cb, kind, value)
  const [openCode, setOpenCode] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!parts.length) return null

  // sp 는 ch/lookId 와 달리 glossParts가 "조각별" 아니라 "합쳐진 코드 전체"를 한 덩어리 span으로
  // 돌려준다(예: "IN.BALL.TZ_NT.LT_MOON(...)") — spUnregistered()는 그 안의 낱개 조각(BALL,
  // LT_MOON 등)을 코드로 쓰는데, 합쳐진 문자열 전체를 그 낱개 코드와 비교하면 절대 안 맞아서
  // 클릭이 안 먹었다(2026-10-14 버그 리포트: "일부는 클릭이 안되는 상태"). sp는 본문 span을
  // 클릭 타깃으로 쓰지 말고, 조각마다 별도 칩을 만든다.
  const isSp = kind === 'sp'
  const registerable = isSp || kind === 'ch' || kind === 'lookId'
  const items = !registerable ? [] : isSp ? spUnregistered(cb, value) : lookUnregistered(cb, value)
  const itemFor = (code) => items.find((it) => it.code === code)

  const openItem = (code) => {
    const already = openCode === code
    setErr('')
    setOpenCode(already ? '' : code)
    if (!already) setDraft(defaultLabel || '')
  }
  const doRegister = async (item) => {
    const label = draft.trim()
    if (!label) { setErr('한글 설명을 입력하세요'); return }
    setBusy(true); setErr('')
    try {
      await registerCode(item.kind, item.code, label)
      setOpenCode('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)', marginTop: 2 }}>
      <div>
        {parts.map((p, i) => {
          const code = !isSp ? (p.text.match(/^([A-Za-z0-9_.]+)\(/) || [])[1] : null
          const item = p.warn && code ? itemFor(code) : null
          return (
            <span key={i}>
              {i > 0 && sep}
              {item ? (
                <span
                  style={{ color: '#f59e0b', cursor: 'pointer', textDecoration: 'underline dotted' }}
                  title="클릭하면 정식 코드로 등록할 수 있어요"
                  onClick={() => openItem(item.code)}
                >{p.text}</span>
              ) : (
                <span style={p.warn ? { color: '#f59e0b' } : undefined} title={p.warn ? '레퍼런스(코드북)에 없는 코드' : undefined}>{p.text}</span>
              )}
            </span>
          )
        })}
      </div>
      {isSp && items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
          {items.map((item) => (
            <span key={item.code}
              style={{ color: '#f59e0b', cursor: 'pointer', textDecoration: 'underline dotted', fontSize: 10.5 }}
              title="클릭하면 정식 코드로 등록할 수 있어요"
              onClick={() => openItem(item.code)}
            >{item.group} {item.code} 등록▸</span>
          ))}
        </div>
      )}
      {items.filter((it) => it.code === openCode).map((item) => (
        <div key={item.code} style={{ marginTop: 4, padding: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 10.5, color: '#f59e0b', marginBottom: 4 }}>
            {item.group} <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0 4px', borderRadius: 3 }}>{item.code}</code> 신규 등록
          </div>
          <textarea rows={2}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, padding: 6, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-1)' }}
            value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="한글 설명" />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" disabled={busy} onClick={() => doRegister(item)}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', background: '#f59e0b', color: '#1a1a1a', border: 'none', borderRadius: 5, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1 }}>
              {busy ? '등록 중…' : '신규 등록'}
            </button>
            <button type="button" onClick={() => setOpenCode('')}
              style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }}>
              취소
            </button>
          </div>
          {err && <div style={{ color: '#f87171', fontSize: 10.5, marginTop: 4 }}>{err}</div>}
        </div>
      ))}
    </div>
  )
}
