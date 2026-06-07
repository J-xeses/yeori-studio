import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { elTTS, elVoices } from '../lib/api'
import { setGPoint } from '../lib/gpoints'
import s from './TTSTab.module.css'

const DEFAULT_VOICE_ID = 'RmYuvmCbqOMBJxDLW4k8'

export default function TTSTab() {
  const { state, dispatch } = useApp()
  const { cuts, episode, apiKeys, ttsSettings, elevenLabsStatus } = state
  const [audios, setAudios] = useState({})
  const [loading, setLoading] = useState({})
  const [text, setText] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const audioRefs = useRef({})

  const [localVoiceId, setLocalVoiceId] = useState(ttsSettings.voiceId || DEFAULT_VOICE_ID)
  const [myVoices, setMyVoices] = useState([])
  const [fetchingVoices, setFetchingVoices] = useState(false)
  const [saved, setSaved] = useState(false)

  const remaining = elevenLabsStatus.remainingChars

  const getTextForCut = (cut) =>
    (cut.dialogue || '').replace(/^\s*\[?(CLOSEUP|FULLBODY)\s*(SHOT)?\]?[\s:：]*/i, '').trim()

  const saveVoiceId = async () => {
    dispatch({ type: 'SET_TTS', p: { voiceId: localVoiceId } })
    try {
      await fetch('http://localhost:3001/api/update-env', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates: { ELEVENLABS_VOICE_ID: localVoiceId } }),
      })
    } catch {}
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const fetchVoices = async () => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 먼저 입력하세요'); return }
    setFetchingVoices(true)
    try {
      const res = await elVoices(apiKeys.elevenLabs)
      if (!res.ok) throw new Error('목소리 목록 로드 실패')
      const data = await res.json()
      const cloned = (data.voices || []).filter(v => v.category !== 'premade')
      setMyVoices(cloned)
      if (!cloned.length) alert('클론 목소리가 없습니다.')
    } catch (err) {
      alert('목소리 로드 오류: ' + err.message)
    } finally {
      setFetchingVoices(false)
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
      setAudios(p => ({ ...p, [cutId]: { url, blob, text: finalText } }))
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

  const cutsWithText = cuts.filter(c => getTextForCut(c))
  const allG3 = cutsWithText.length > 0 && cutsWithText.every(c => audios[c.id])

  const handleG3Approve = async () => {
    try {
      await fetch('http://localhost:3001/api/studio-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episode, cuts, type: 'report', generatedAt: new Date().toISOString() }),
      })
    } catch {}
    dispatch({ type: 'SET_TAB', p: 'extract' })
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
          <h3 className={s.panelTitle}>목소리 설정</h3>

          <div className={s.voiceIdRow}>
            <label className={s.voiceIdLabel}>Voice ID</label>
            <input
              className={s.voiceIdInput}
              value={localVoiceId}
              onChange={e => setLocalVoiceId(e.target.value)}
              placeholder={DEFAULT_VOICE_ID}
              spellCheck={false}
            />
            <button className={`${s.saveBtn} ${saved ? s.saveBtnDone : ''}`} onClick={saveVoiceId}>
              {saved ? '✓' : '저장'}
            </button>
          </div>

          <button className={s.fetchBtn} onClick={fetchVoices} disabled={fetchingVoices}>
            {fetchingVoices ? <><span className={s.spinner} />불러오는 중...</> : '내 목소리 목록 불러오기'}
          </button>

          {myVoices.length > 0 && (
            <select className={s.voiceSelect}
              value={localVoiceId}
              onChange={e => setLocalVoiceId(e.target.value)}
            >
              {myVoices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
              ))}
            </select>
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
              </div>
            )}
          </div>
        )}

        <div className={s.panel}>
          <h3 className={s.panelTitle}>전체 일괄 생성</h3>
          <p className={s.batchDesc}>모든 컷의 대사를 순서대로 음성 생성합니다.</p>
          <button className={s.batchBtn}
            onClick={async () => {
              for (const c of cuts) {
                const t = getTextForCut(c)
                if (t) await generateTTS(c.id, t)
              }
            }}
          >🎙️ 전체 컷 일괄 생성</button>
        </div>

        {allG3 && (
          <div className={s.panel}>
            <div className={s.approveBar}>
              <div>
                <div className={s.approveBadge}>✅ G3 완료</div>
                <div className={s.approveText}>모든 대사 TTS 생성됨 — 데이터 추출을 시작할까요?</div>
              </div>
              <button className={s.approveBtn} onClick={handleG3Approve}>
                추출 탭으로 이동 →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
