import { useEffect, useRef, useState } from 'react'
import SfxPicker from './SfxPicker'

const YEORI_SERVER = 'http://localhost:3001'

// 릴스 최종본 표의 효과음 칸 — 한 컷의 효과음 설정(무엇을 · 몇 초에 · 얼마나 크게)을 한 줄에서 끝낸다.
// 보이는 값은 서버가 계산한 "실제로 들어갈 값"(plan 의 startSec·volumePct)이라 화면과 최종본이 항상 같다.
// 저장은 studio-state 가 아니라 reel-overrides 파일(onChange → /api/reel-finalize/override).
export default function ReelSfxCell({ sfx, duration, onChange }) {
  const cur = sfx?.[0] || null
  const [start, setStart] = useState(cur ? String(cur.startSec) : '')
  const [vol, setVol] = useState(cur ? cur.volumePct : 70)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => { setStart(cur ? String(cur.startSec) : ''); setVol(cur ? cur.volumePct : 70) }, [cur?.file, cur?.startSec, cur?.volumePct])
  useEffect(() => () => audioRef.current?.pause(), [])

  // 자동 판단으로 붙은 효과음을 고치면 그 파일을 "직접 지정"으로 굳힌다(시작·음량은 직접 지정에만 적용되므로)
  const withFile = (patch) => (cur && !cur.manual ? { sfxFile: cur.file, ...patch } : patch)

  const commitStart = () => {
    if (!cur) return
    const v = parseFloat(start)
    if (!Number.isFinite(v) || v === cur.startSec) { setStart(String(cur.startSec)); return }
    onChange(withFile({ sfxAtSec: Math.max(0, v) }))
  }
  const commitVol = () => { if (cur && vol !== cur.volumePct) onChange(withFile({ sfxGain: Math.max(5, vol) / 100 })) }

  const play = () => {
    if (!cur) return
    if (playing) { audioRef.current?.pause(); setPlaying(false); return }
    if (!audioRef.current) audioRef.current = new Audio()
    const a = audioRef.current
    a.src = `${YEORI_SERVER}/downloads/_shared/sfx/${cur.file}`
    a.volume = Math.min(1, vol / 100)
    a.onended = () => setPlaying(false)
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  // 컷마다 칸 너비를 고정해 세로줄이 맞게 한다(이름 · 듣기 · 카탈로그 · 시작 · 음량 · 없음)
  const grid = { display: 'grid', gridTemplateColumns: '230px 28px 96px 112px 176px 48px', columnGap: 8, alignItems: 'center', padding: '3px 0' }
  const row = { display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }
  const name = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: cur ? 1 : 0.55 }
  const btn = { width: '100%', height: 24, padding: 0 }
  return (
    <div style={grid}>
      <span title={cur?.file || ''} style={name}>{cur ? cur.file.split('/').pop() : '효과음 없음'}</span>
      {cur ? <button type="button" style={btn} onClick={play} title="이 음량으로 들어보기">{playing ? '⏸' : '▶'}</button> : <span />}
      <SfxPicker onSelect={item => onChange({ sfxFile: item.path })} />
      {cur ? (<>
        <label style={row} title={`컷이 시작되고 몇 초 뒤에 낼지 (이 컷 길이 ${duration || '?'}초)`}>
          시작
          <input type="number" min={0} max={duration || undefined} step={0.1} value={start} style={{ width: 52, textAlign: 'right' }}
            onChange={e => setStart(e.target.value)} onBlur={commitStart}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          초
        </label>
        <label style={row} title="효과음 크기 (100% = 원래 크기)">
          음량
          <input type="range" min={5} max={100} step={5} value={vol} style={{ width: 96 }}
            onChange={e => setVol(parseInt(e.target.value, 10))} onPointerUp={commitVol} onKeyUp={commitVol} onBlur={commitVol} />
          <span style={{ width: 38, textAlign: 'right' }}>{vol}%</span>
        </label>
        <button type="button" style={btn} title="이 컷은 효과음 없이" onClick={() => onChange({ sfxFile: '__none__' })}>없음</button>
      </>) : (<><span /><span /><span /></>)}
    </div>
  )
}
