import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { elTTS, elVoices } from '../lib/api'
import { setGPoint } from '../lib/gpoints'
import s from './TTSTab.module.css'

const DEFAULT_VOICE_ID = 'RmYuvmCbqOMBJxDLW4k8'

export default function TTSTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys, ttsSettings, elevenLabsStatus } = state
  const [loading, setLoading] = useState({})
  const { audioUrls = {}, audioTexts = {}, g3Confirmed = {} } = state.ttsTabState || {}

  const setAudios = (updater) => {
    const prevShape = {}
    Object.keys(audioUrls).forEach(cid => {
      prevShape[cid] = { url: audioUrls[cid], text: audioTexts[cid] }
    })
    const next = typeof updater === 'function' ? updater(prevShape) : updater
    const nextUrls = {}, nextTexts = {}
    Object.keys(next).forEach(cid => {
      nextUrls[cid] = next[cid].url
      nextTexts[cid] = next[cid].text
    })
    dispatch({ type: 'SET_TTS_TAB_STATE', p: { audioUrls: nextUrls, audioTexts: nextTexts } })
  }

  const setG3Confirmed = (updater) => {
    const next = typeof updater === 'function' ? updater(g3Confirmed) : updater
    dispatch({ type: 'SET_TTS_TAB_STATE', p: { g3Confirmed: next } })
  }

  const audios = {}
  Object.keys(audioUrls).forEach(cid => {
    audios[cid] = { url: audioUrls[cid], text: audioTexts[cid] }
  })
  const [text, setText] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const [voiceInput, setVoiceInput] = useState(ttsSettings.voiceId || DEFAULT_VOICE_ID)
  const [myVoices, setMyVoices] = useState([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const audioRefs = useRef({})

  const remaining = elevenLabsStatus.remainingChars

  const getTextForCut = (cut) => cut.dialogue || cut.narration || ''

  const saveVoiceId = async () => {
    const id = voiceInput.trim()
    if (!id) { alert('Voice ID를 입력하세요'); return }
    dispatch({ type: 'SET_TTS', p: { voiceId: id } })
    try {
      const res = await fetch('http://localhost:3001/api/update-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ELEVENLABS_VOICE_ID', value: id }),
      })
      if (!res.ok) throw new Error()
      alert(`저장 완료: ${id}`)
    } catch {
      alert('.env.local 저장 실패 — 프록시 서버가 실행 중인지 확인하세요')
    }
  }

  const loadMyVoices = async () => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 먼저 연동하세요'); return }
    setVoicesLoading(true)
    try {
      const res = await elVoices(apiKeys.elevenLabs)
      if (!res.ok) throw new Error('API 오류')
      const data = await res.json()
      const clones = (data.voices || []).filter(v => v.category !== 'premade')
      setMyVoices(clones)
      if (!clones.length) alert('클론 목소리가 없어요. ElevenLabs에서 Voice Clone을 먼저 만들어주세요.')
    } catch (err) {
      alert('목소리 불러오기 실패: ' + err.message)
    } finally {
      setVoicesLoading(false)
    }
  }

  const generateTTS = async (cutId, inputText) => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 입력하고 연동하세요'); return }
    const finalText = inputText || text
    if (!finalText.trim()) { alert('텍스트를 입력하세요'); return }
    setLoading(p => ({ ...p, [cutId]: true }))
    try {
      const res = await elTTS(
        apiKeys.elevenLabs,
        ttsSettings.voiceId || DEFAULT_VOICE_ID,
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
      setAudios(p => ({ ...p, [cutId]: { url, text: finalText } }))
      dispatch({
        type: 'SET_VIDEO_TAB_STATE',
        p: {
          subtitles: {
            ...(state.videoTabState?.subtitles || {}),
            [cutId]: finalText,
          },
        },
      })
      // ── G2 포인트 자동 저장 ──────────────────────────────
      const cut = cuts.find(c => c.id === cutId)
      if (cut) setGPoint(cut.no, 'g2', true)
    } catch (err) {
      alert('TTS 오류: ' + err.message)
    } finally {
      setLoading(p => ({ ...p, [cutId]: false }))
    }
  }

  const restoreYeoriVoice = async () => {
    setVoiceInput(DEFAULT_VOICE_ID)
    dispatch({ type: 'SET_TTS', p: { voiceId: DEFAULT_VOICE_ID } })
    try {
      const res = await fetch('http://localhost:3001/api/update-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ELEVENLABS_VOICE_ID', value: DEFAULT_VOICE_ID }),
      })
      if (!res.ok) throw new Error()
      alert(`서여리 목소리로 복원 완료: ${DEFAULT_VOICE_ID}`)
    } catch {
      alert('.env.local 저장 실패 — 프록시 서버가 실행 중인지 확인하세요')
    }
  }

  const downloadAudio = async (cutId, cutNo) => {
    const audio = audios[cutId]
    if (!audio?.url) return
    const res = await fetch(audio.url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cut_${String(cutNo).padStart(2, '0')}.mp3`
    a.click()
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
                {g3Confirmed[c.id]
                  ? <span className={s.g3Tag}>G3 완료</span>
                  : audios[c.id] && <span className={s.doneTag}>✓ 생성됨</span>
                }
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
          {ttsSettings.voiceId === DEFAULT_VOICE_ID ? (
            <div className={`${s.voiceBanner} ${s.voiceBannerOk}`}>
              ✅ 서여리 목소리 적용 중
            </div>
          ) : (
            <div className={`${s.voiceBanner} ${s.voiceBannerWarn}`}>
              <span>⚠️ 서여리 목소리가 아닙니다</span>
              <button className={s.restoreBtn} onClick={restoreYeoriVoice}>서여리로 복원</button>
            </div>
          )}
          <div className={s.voiceInputRow}>
            <input
              className={s.voiceInput}
              type="text"
              placeholder="ElevenLabs Voice ID 입력"
              value={voiceInput}
              onChange={e => setVoiceInput(e.target.value)}
            />
            <button className={s.voiceLoadBtn} onClick={saveVoiceId}>저장</button>
          </div>
          {myVoices.length > 0 && (
            <select
              className={s.voiceSelect}
              value=""
              onChange={e => { if (e.target.value) setVoiceInput(e.target.value) }}
            >
              <option value="">— 목소리 선택 —</option>
              {myVoices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
              ))}
            </select>
          )}
          <button className={s.voiceFetchBtn} onClick={loadMyVoices} disabled={voicesLoading}>
            {voicesLoading ? '불러오는 중...' : '🎤 내 목소리 목록 불러오기'}
          </button>
          {ttsSettings.voiceId && (
            <div className={s.voiceApplied}>
              적용됨: <code>{ttsSettings.voiceId}</code>
            </div>
          )}
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
                {!g3Confirmed[cut.id] ? (
                  <button className={s.g3Btn}
                    onClick={() => {
                      const next = { ...g3Confirmed, [cut.id]: true }
                      setG3Confirmed(next)
                      setGPoint(cut.no, 'g3', true)
                      if (cuts.every(c => next[c.id])) dispatch({ type: 'SET_TAB', p: 'video' })
                    }}>
                    ✅ G3 승인
                  </button>
                ) : (
                  <span className={s.g3Tag}>G3 완료</span>
                )}
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
