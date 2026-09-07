import { useState } from 'react'
import s from './VoicePicker.module.css'

// 목소리 선택 통합 컴포넌트 — 기본값 패널 / 목소리 탭 / 트랙 override 세 군데 공용.
// value: Voice ID 문자열. onChange(id) 로 갱신.
// myVoices / onLoadVoices / voicesLoading 은 부모(TTSTab)가 캐시해서 내려준다.
export default function VoicePicker({
  value = '',
  onChange,
  myVoices = [],
  onLoadVoices,
  voicesLoading = false,
  placeholder = 'ElevenLabs Voice ID',
  inheritLabel,        // 트랙 override용: 비우면 상속하는 값 안내
  compact = false,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)

  const qq = q.trim().toLowerCase()
  const filtered = qq ? myVoices.filter(v => v.name?.toLowerCase().includes(qq)) : myVoices
  const cloned  = filtered.filter(v => v.category !== 'premade')
  const premade = filtered.filter(v => v.category === 'premade')
  const optLabel = v => `${v.name} (${v.labels?.accent || v.labels?.language || '-'} / ${v.labels?.gender || '-'})`
  const selected = myVoices.find(v => v.voice_id === value)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !myVoices.length && !voicesLoading && onLoadVoices) onLoadVoices()
  }
  const pick = (v) => { onChange(v.voice_id); setPreviewUrl(v.preview_url || null) }

  return (
    <div className={`${s.wrap} ${compact ? s.compact : ''}`}>
      <div className={s.row}>
        <input
          className={s.input}
          value={value}
          placeholder={inheritLabel ? `상속: ${inheritLabel}` : placeholder}
          onChange={e => onChange(e.target.value)}
        />
        <button type="button" className={s.pickBtn} onClick={toggle}>
          {open ? '▲ 닫기' : '🔍 목소리'}
        </button>
      </div>

      {selected && !open && <div className={s.selName}>▸ {selected.name}</div>}

      {open && (
        <div className={s.dropdown}>
          <input
            className={s.search}
            placeholder="이름으로 검색…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {voicesLoading && <div className={s.dim}>불러오는 중…</div>}
          {!voicesLoading && !myVoices.length && (
            <button type="button" className={s.loadBtn} onClick={onLoadVoices}>
              🎤 보이스 목록 불러오기 (클론 + 무료 프리셋)
            </button>
          )}
          {!voicesLoading && myVoices.length > 0 && (
            <select
              className={s.select}
              size={7}
              value={value || ''}
              onChange={e => {
                const v = myVoices.find(x => x.voice_id === e.target.value)
                if (v) pick(v)
              }}
            >
              <optgroup label={`내 목소리 / 클론 (${cloned.length})`}>
                {cloned.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
              </optgroup>
              <optgroup label={`무료 프리셋 (${premade.length})`}>
                {premade.map(v => <option key={v.voice_id} value={v.voice_id}>{optLabel(v)}</option>)}
              </optgroup>
            </select>
          )}
          {previewUrl && <audio controls autoPlay src={previewUrl} className={s.preview} />}
        </div>
      )}
    </div>
  )
}
