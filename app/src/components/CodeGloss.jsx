import { useState } from 'react'
import { glossParts, spUnregistered, lookUnregistered, promptCodeUnregistered, PROMPT_FIELD_SHAPE, registerCode } from '../lib/codeRef'

// 코드 입력칸 바로 아래에 붙는 한글 풀이 한 줄 — 예: SH_MCU(미디엄 클로즈업) → SH_CU(클로즈업).
// 코드북에 없는 코드는 "(?)" + 주황색으로 표시한다.
//
// sp/ch/lookId/sh/ca/md/ac 는 추가로 클릭 가능 — 누르면 바로 아래 등록 창이 펼쳐진다(2026-10-14).
// sp/ch/lookId는 그 컷의 공간설명(한글)·캐릭터설명(한글)(defaultLabel)이 기본값으로 이미 채워져
// 있어 대부분 "신규 등록"만 누르면 된다. sh/ca/md/ac는 실제 생성 프롬프트에 들어갈 영문 문구가
// 테이블마다 다른 모양으로 필요해서(PROMPT_FIELD_SHAPE) 한글 이름 + 영문 문구를 같이 받는다 —
// 처음엔 "라벨만으로 자동 등록하면 빈 프롬프트가 생긴다"는 이유로 대상 밖이었는데, 성준님 요청
// (MD_PLF/MD_CF 등록 안 되는 이유 질문 뒤)으로 확장했다. pl 은 여전히 표시만(플랫폼 코드라 등록
// 개념이 없음).
// vp_phrase는 ca(카메라 움직임)·md/ac(분위기·동작)가 공유하는 필드명이라 예시 문구를 kind별로
// 다르게 보여준다 — 안 그러면 "감정" 등록 창에 "camera slowly pushes in" 같은 카메라 예시가 떠서
// 헷갈린다(2026-10-14).
function promptFieldPlaceholder(field, kind) {
  if (field === 'ip_prefix') return 'IP 접두어 (예: MEDIUM SHOT —)'
  if (field === 'ip_suffix') return 'IP 접미어 (예: medium shot, eye level, vertical 9:16,)'
  if (field === 'ip_phrase') return kind === 'md' ? 'IP 문구 — 표정 영문 묘사 (예: dreamy soft gaze)' : 'IP 문구 — 동작 영문 묘사 (예: walking naturally, shoulders relaxed)'
  if (field === 'vp_phrase') {
    if (kind === 'ca') return 'VP 문구 — 카메라 움직임 (예: camera slowly pushes in)'
    if (kind === 'md') return 'VP 문구 — 영상용 표정·분위기 (예: gaze soft and dreamy)'
    return 'VP 문구 — 영상용 동작 묘사 (예: walks naturally, shoulders relaxed)'
  }
  return ''
}

export default function CodeGloss({ cb, kind, value, sep = ' · ', defaultLabel = '' }) {
  const parts = glossParts(cb, kind, value)
  const [openCode, setOpenCode] = useState('')
  const [draft, setDraft] = useState('')
  const [draftExtra, setDraftExtra] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!parts.length) return null

  // sp 는 ch/lookId 와 달리 glossParts가 "조각별" 아니라 "합쳐진 코드 전체"를 한 덩어리 span으로
  // 돌려준다(예: "IN.BALL.TZ_NT.LT_MOON(...)") — spUnregistered()는 그 안의 낱개 조각(BALL,
  // LT_MOON 등)을 코드로 쓰는데, 합쳐진 문자열 전체를 그 낱개 코드와 비교하면 절대 안 맞아서
  // 클릭이 안 먹었다(2026-10-14 버그 리포트: "일부는 클릭이 안되는 상태"). sp는 본문 span을
  // 클릭 타깃으로 쓰지 말고, 조각마다 별도 칩을 만든다.
  const isSp = kind === 'sp'
  const isPromptKind = !!PROMPT_FIELD_SHAPE[kind]
  const registerable = isSp || kind === 'ch' || kind === 'lookId' || isPromptKind
  const items = !registerable ? []
    : isSp ? spUnregistered(cb, value)
    : isPromptKind ? promptCodeUnregistered(cb, kind, value)
    : lookUnregistered(cb, value)
  const itemFor = (code) => items.find((it) => it.code === code)

  const openItem = (code) => {
    const already = openCode === code
    setErr('')
    setOpenCode(already ? '' : code)
    if (!already) { setDraft(defaultLabel || ''); setDraftExtra({}) }
  }
  const doRegister = async (item) => {
    const label = draft.trim()
    if (!label) { setErr('한글 설명을 입력하세요'); return }
    const fields = PROMPT_FIELD_SHAPE[item.kind]
    if (fields) {
      const missing = fields.filter((f) => !(draftExtra[f] || '').trim())
      if (missing.length) { setErr('영문 문구를 모두 입력하세요'); return }
    }
    setBusy(true); setErr('')
    try {
      await registerCode(item.kind, item.code, label, fields ? Object.fromEntries(fields.map((f) => [f, draftExtra[f].trim()])) : {})
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
                  style={{ color: '#f59e0b', cursor: 'pointer', textDecoration: 'underline dotted', fontWeight: 700 }}
                  title="클릭하면 정식 코드로 등록할 수 있어요"
                  onClick={() => openItem(item.code)}
                >+{p.text}</span>
              ) : (
                <span style={p.warn ? { color: '#f59e0b' } : undefined} title={p.warn ? '레퍼런스(코드북)에 없는 코드' : undefined}>{p.text}</span>
              )}
            </span>
          )
        })}
      </div>
      {/* 2026-10-14: 전엔 메인 글귀 바로 밑에 똑같은 스타일의 작은 밑줄 텍스트라 사람이
          "그냥 경고 표시"로 보고 지나쳤다(성준님: "왜 등록클릭이 안되는지" — 실제론 됐는데
          못 찾은 사례). 버튼처럼 테두리·배경을 둬서 눌러야 할 것으로 보이게 바꿈. */}
      {isSp && items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {items.map((item) => (
            <button key={item.code} type="button"
              style={{
                color: '#f59e0b', cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: 10, padding: '2px 8px',
              }}
              title="클릭하면 정식 코드로 등록할 수 있어요"
              onClick={() => openItem(item.code)}
            >+ {item.group} {item.code} 등록</button>
          ))}
        </div>
      )}
      {items.filter((it) => it.code === openCode).map((item) => (
        <div key={item.code} style={{ marginTop: 4, padding: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 10.5, color: '#f59e0b', marginBottom: 4 }}>
            {item.group} <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0 4px', borderRadius: 3 }}>{item.code}</code> 신규 등록
          </div>
          <textarea rows={2}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, padding: 6, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
            value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="한글 이름" />
          {PROMPT_FIELD_SHAPE[item.kind]?.map((f) => (
            <textarea key={f} rows={2}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, padding: 6, marginTop: 6, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
              value={draftExtra[f] || ''} onChange={(e) => setDraftExtra((p) => ({ ...p, [f]: e.target.value }))}
              placeholder={promptFieldPlaceholder(f, item.kind)} />
          ))}
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
