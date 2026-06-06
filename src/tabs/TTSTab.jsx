import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { elTTS } from '../lib/api'
import { setGPoint } from '../lib/gpoints'
import s from './TTSTab.module.css'

const VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', desc: '여성 · 차분함' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',   desc: '여성 · 강렬함' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  desc: '여성 · 부드러움' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', desc: '남성 · 성숙함' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',   desc: '남성 · 젊음' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   desc: '남성 · 중후함' },
  { id: '5n5gqmaQi9Ewevrz7bOS', name: 'Sian',   desc: '여성 · 진솔함' },
]

export default function TTSTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys, ttsSettings, elevenLabsStatus } = state
  const [audios, setAudios] = useState({})
  const [loading, setLoading] = useState({})
  const [text, setText] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const audioRefs = useRef({})

  const remaining = elevenLabsStatus.remainingChars

  const getTextForCut = (cut) =>
    (cut.dialogue || '').replace(/^\s*\[?(CLOSEUP|FULLBODY)\s*(SHOT)?\]?[\s:：]*/i, '').trim()

  const generateTTS = async (cutId, inputText) => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 입력하고 연동하세요'); return }
    const finalText = inputText || text
    if (!finalText.trim()) { alert('텍스트를 입력하세요'); return }
    setLoading(p => ({ ...p, [cutId]: true }))
    try {
      const res = await elTTS(
        apiKeys.elevenLabs,
        ttsSettings.voiceId || VOICES[0].id,
        {
          text: finalText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: ttsSettings.emotion / 100,
            similarity_boost: ttsSettings.tone / 100,
            speed: ttsSettings.speed,
          },
        }
      )
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail?.message || 'API 오류') }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setAudios(p => ({ ...p, [cutId]: { url, blob, text: finalText } }))
      // ── G2 포인트 자동 저장 ──────────────────────────────
      const cut = cuts.find(c => c.id === cutId)
      if (cut) setGPoint(cut.no, 'g2', true)
    } catch (err) {
      alert('TTS 오류: ' + err.message)
    } finally {
      setLoading(p => ({ ...p, [cutId]: false }))
    }
  }

  const downloadAudio = (cutId, cutNo) => {
    const a = audios[cutId]; if (!a) return
    const link = document.createElement('a')
    link.href = a.url; link.download = `cut_${cutNo}.mp3`; link.click()
  }

  const cut = cuts[activeCut]

  return (
    <div className={s.root}>
      {/* Left: Cut list */}
      <div className={s.sidebar}>
        <div className={s.sideHead}>
          <span className={s.sideTitle}>컷 목록</span>
          <div className={`${s.elBadge} ${elevenLabsStatus.connected ? s.connected : ''}`}>
            {elevenLabsStatus.connected
              ? `${remaining.toLocaleString()}자 남음`
              : 'EL 미연결'}
          </div>
        </div>
        <div className={s.cutList}>
          {cuts.map((c, i) => (
            <button key={c.id}
              className={`${s.cutItem} ${activeCut === i ? s.cutActive : ''}`}
              onClick={() => { setActiveCut(i); setText(getTextForCut(c)) }}
            >
              <div className={s.cutTop}>
                <span className={s.cutNo}>CUT {c.no}</span>
                {audios[c.id] && <span className={s.doneTag}>✓ 생성됨</span>}
              </div>
              <span className={s.cutPrev}>{getTextForCut(c) || '(내용 없음)'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: TTS settings + generate */}
      <div className={s.main}>
        <div className={s.panel}>
          <h3 className={s.panelTitle}>목소리 선택</h3>
          <div className={s.voices}>
            {VOICES.map(v => (
              <button key={v.id}
                className={`${s.voiceCard} ${ttsSettings.voiceId === v.id ? s.voiceActive : ''}`}
                onClick={() => dispatch({ type: 'SET_TTS', p: { voiceId: v.id } })}
              >
                <span className={s.voiceName}>{v.name}</span>
                <span className={s.voiceDesc}>{v.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={s.panel}>
          <h3 className={s.panelTitle}>음성 설정</h3>
          <div className={s.sliders}>
            {[
              { key: 'emotion', label: '안정성', min: 0, max: 100, step: 1 },
              { key: 'tone', label: '유사도', min: 0, max: 100, step: 1 },
              { key: 'speed', label: '속도', min: 0.5, max: 2.0, step: 0.1 },
            ].map(({ key, label, min, max, step }) => (
              <div key={key} className={s.sliderRow}>
                <span className={s.sliderLabel}>{label}</span>
                <input type="range" min={min} max={max} step={step}
                  value={ttsSettings[key]}
                  onChange={e => dispatch({ type: 'SET_TTS', p: { [key]: parseFloat(e.target.value) } })} />
                <span className={s.sliderVal}>{ttsSettings[key]}{key !== 'speed' ? '%' : 'x'}</span>
              </div>
            ))}
          </div>
        </div>

        {cut && (
          <div className={s.panel}>
            <h3 className={s.panelTitle}>CUT {cut.no} 음성 생성</h3>
            <textarea className={s.textArea} rows={4}
              placeholder="TTS 변환할 텍스트를 입력하세요..."
              value={text}
              onChange={e => setText(e.target.value)} />
            <div className={s.textMeta}>
              <span>{text.length}자 입력됨</span>
              {remaining > 0 && <span>· {remaining.toLocaleString()}자 남음</span>}
            </div>

            <div className={s.genRow}>
              <button className={s.genBtn}
                onClick={() => generateTTS(cut.id, text)}
                disabled={loading[cut.id]}
              >
                {loading[cut.id] ? <><span className={s.spinner} />생성 중...</> : '🔊 음성 생성'}
              </button>
              <button className={s.fillBtn}
                onClick={() => setText(getTextForCut(cut))}>
                대사 자동 입력
              </button>
            </div>

            {audios[cut.id] && (
              <div className={s.audioResult}>
                <audio ref={el => audioRefs.current[cut.id] = el}
                  controls src={audios[cut.id].url} className={s.audioPlayer} />
                <button className={s.dlBtn} onClick={() => downloadAudio(cut.id, cut.no)}>
                  ⬇ MP3 다운로드
                </button>
              </div>
            )}
          </div>
        )}

        <div className={s.panel}>
          <h3 className={s.panelTitle}>전체 일괄 생성</h3>
          <p className={s.batchDesc}>모든 컷의 대사/나레이션을 순서대로 음성 생성합니다.</p>
          <button className={s.batchBtn}
            onClick={async () => {
              for (const c of cuts) {
                const t = getTextForCut(c)
                if (t) await generateTTS(c.id, t)
              }
            }}
          >🎙️ 전체 컷 일괄 생성</button>
        </div>
      </div>
    </div>
  )
}
