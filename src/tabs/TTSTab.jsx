import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { elTTS, elVoices } from '../lib/api'
import { setGPoint } from '../lib/gpoints'
import s from './TTSTab.module.css'

const DEFAULT_VOICE_ID = 'RmYuvmCbqOMBJxDLW4k8'
const DEFAULT_DIALOGUE_SETTINGS  = { speed: 1.0,  stability: 35, similarity: 75 }
const DEFAULT_NARRATION_SETTINGS = { speed: 0.85, stability: 60, similarity: 75 }

function makeTrack(type, text = '') {
  return {
    id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    text,
    url: null,
    settings: type === 'narration'
      ? { ...DEFAULT_NARRATION_SETTINGS }
      : { ...DEFAULT_DIALOGUE_SETTINGS },
  }
}

function initTracksForCut(cut) {
  const tracks = []
  if (cut.dialogue?.trim())  tracks.push(makeTrack('dialogue',  cut.dialogue))
  if (cut.narration?.trim()) tracks.push(makeTrack('narration', cut.narration))
  if (!tracks.length)        tracks.push(makeTrack('dialogue',  ''))
  return tracks
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate  = buffer.sampleRate
  const length      = buffer.length
  const ab   = new ArrayBuffer(44 + length * numChannels * 2)
  const view = new DataView(ab)
  const wr   = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
  wr(0, 'RIFF'); view.setUint32(4, 36 + length * numChannels * 2, true)
  wr(8, 'WAVE'); wr(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true)
  wr(36, 'data'); view.setUint32(40, length * numChannels * 2, true)
  let off = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
      view.setInt16(off, s * 0x7FFF, true); off += 2
    }
  }
  return ab
}

export default function TTSTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys, ttsSettings, elevenLabsStatus } = state
  const { tracks = {}, mergedUrls = {}, g3Confirmed = {} } = state.ttsTabState || {}

  const [activeCutIdx, setActiveCutIdx]   = useState(0)
  const [voiceInput,   setVoiceInput]     = useState(ttsSettings.voiceId || DEFAULT_VOICE_ID)
  const [myVoices,     setMyVoices]       = useState([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [trackLoading,  setTrackLoading]  = useState({})
  const [merging,       setMerging]       = useState({})
  const [batchRunning,  setBatchRunning]  = useState(false)

  const setTTS = (p) => dispatch({ type: 'SET_TTS_TAB_STATE', p })

  const getTracksForCut = (cutId) => {
    if (tracks[cutId]) return tracks[cutId]
    const c = cuts.find(c => c.id === cutId)
    return c ? initTracksForCut(c) : []
  }

  const setTracksForCut = (cutId, updater) => {
    const cur  = getTracksForCut(cutId)
    const next = typeof updater === 'function' ? updater(cur) : updater
    setTTS({ tracks: { ...tracks, [cutId]: next } })
  }

  const handleCutSelect = (idx) => {
    setActiveCutIdx(idx)
    const c = cuts[idx]
    if (c && !tracks[c.id]) {
      setTTS({ tracks: { ...tracks, [c.id]: initTracksForCut(c) } })
    }
  }

  const remaining = elevenLabsStatus.remainingChars
  const cut = cuts[activeCutIdx]
  const cutTracks = cut ? getTracksForCut(cut.id) : []

  // ── 목소리 설정 ──────────────────────────────────────────
  const saveVoiceId = async () => {
    const id = voiceInput.trim()
    if (!id) { alert('Voice ID를 입력하세요'); return }
    dispatch({ type: 'SET_TTS', p: { voiceId: id } })
    try {
      const res = await fetch('http://localhost:3001/api/update-env', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ELEVENLABS_VOICE_ID', value: id }),
      })
      if (!res.ok) throw new Error()
      alert(`저장 완료: ${id}`)
    } catch { alert('.env.local 저장 실패 — 프록시 서버가 실행 중인지 확인하세요') }
  }

  const restoreYeoriVoice = async () => {
    setVoiceInput(DEFAULT_VOICE_ID)
    dispatch({ type: 'SET_TTS', p: { voiceId: DEFAULT_VOICE_ID } })
    try {
      const res = await fetch('http://localhost:3001/api/update-env', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ELEVENLABS_VOICE_ID', value: DEFAULT_VOICE_ID }),
      })
      if (!res.ok) throw new Error()
      alert(`서여리 목소리로 복원 완료`)
    } catch { alert('.env.local 저장 실패') }
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
    } finally { setVoicesLoading(false) }
  }

  // ── 트랙 개별 TTS 생성 ───────────────────────────────────
  const generateTrackById = async (cutId, trackId, trackList) => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 입력하고 연동하세요'); return null }
    const list  = trackList || getTracksForCut(cutId)
    const track = list.find(t => t.id === trackId)
    if (!track || !track.text.trim()) { alert('텍스트를 입력하세요'); return null }

    setTrackLoading(p => ({ ...p, [trackId]: true }))
    try {
      const res = await elTTS(
        apiKeys.elevenLabs,
        ttsSettings.voiceId || DEFAULT_VOICE_ID,
        {
          text: track.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability:       track.settings.stability / 100,
            similarity_boost: track.settings.similarity / 100,
            speed:           track.settings.speed,
          },
        }
      )
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail?.message || 'API 오류') }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      setTracksForCut(cutId, prev => prev.map(t => t.id === trackId ? { ...t, url } : t))
      return url
    } catch (err) {
      alert('TTS 오류: ' + err.message)
      return null
    } finally {
      setTrackLoading(p => ({ ...p, [trackId]: false }))
    }
  }

  // ── 합치기 (Web Audio API) ───────────────────────────────
  const mergeTracksForCut = async (cutId, localTracks) => {
    const list    = localTracks || getTracksForCut(cutId)
    const toMerge = list.filter(t => t.url)
    if (!toMerge.length) { alert('생성된 오디오가 없습니다'); return }

    setMerging(p => ({ ...p, [cutId]: true }))
    try {
      const audioCtx = new AudioContext()
      const buffers  = await Promise.all(
        toMerge.map(async t => {
          const res = await fetch(t.url)
          const ab  = await res.arrayBuffer()
          return audioCtx.decodeAudioData(ab)
        })
      )
      const totalLen   = buffers.reduce((s, b) => s + b.length, 0)
      const numCh      = Math.max(...buffers.map(b => b.numberOfChannels))
      const sampleRate = audioCtx.sampleRate
      const merged     = audioCtx.createBuffer(numCh, totalLen, sampleRate)
      let offset = 0
      for (const buf of buffers) {
        for (let ch = 0; ch < numCh; ch++) {
          const src = ch < buf.numberOfChannels ? buf.getChannelData(ch) : new Float32Array(buf.length)
          merged.getChannelData(ch).set(src, offset)
        }
        offset += buf.length
      }
      const wav  = audioBufferToWav(merged)
      const blob = new Blob([wav], { type: 'audio/wav' })
      const url  = URL.createObjectURL(blob)
      setTTS({ mergedUrls: { ...mergedUrls, [cutId]: url } })

      // videoTab subtitles 동기화
      const allText = list.map(t => t.text).filter(Boolean).join('\n')
      dispatch({ type: 'SET_VIDEO_TAB_STATE',
        p: { subtitles: { ...(state.videoTabState?.subtitles || {}), [cutId]: allText } } })

      const c = cuts.find(c => c.id === cutId)
      if (c) setGPoint(c.no, 'g2', true)
      await audioCtx.close()
    } catch (err) {
      alert('합치기 실패: ' + err.message)
    } finally {
      setMerging(p => ({ ...p, [cutId]: false }))
    }
  }

  // ── 다운로드 ─────────────────────────────────────────────
  const downloadMerged = async (cutId, cutNo) => {
    const url = mergedUrls[cutId]; if (!url) return
    const res  = await fetch(url)
    const blob = await res.blob()
    const a    = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cut_${String(cutNo).padStart(2, '0')}.wav`
    a.click()
  }

  // ── G3 승인 ──────────────────────────────────────────────
  const approveG3 = (cutId, cutNo) => {
    const next = { ...g3Confirmed, [cutId]: true }
    setTTS({ g3Confirmed: next })
    setGPoint(cutNo, 'g3', true)
    if (cuts.every(c => next[c.id])) dispatch({ type: 'SET_TAB', p: 'video' })
  }

  // ── 전체 일괄 생성 ────────────────────────────────────────
  const runBatch = async () => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 입력하고 연동하세요'); return }
    setBatchRunning(true)
    try {
      for (const c of cuts) {
        let cutTrks = tracks[c.id] || initTracksForCut(c)
        // 각 트랙 생성
        const updated = []
        for (const t of cutTrks) {
          if (!t.text.trim()) { updated.push(t); continue }
          setTrackLoading(p => ({ ...p, [t.id]: true }))
          try {
            const res = await elTTS(
              apiKeys.elevenLabs,
              ttsSettings.voiceId || DEFAULT_VOICE_ID,
              {
                text: t.text, model_id: 'eleven_multilingual_v2',
                voice_settings: {
                  stability:       t.settings.stability / 100,
                  similarity_boost: t.settings.similarity / 100,
                  speed:           t.settings.speed,
                },
              }
            )
            if (res.ok) {
              const blob = await res.blob()
              updated.push({ ...t, url: URL.createObjectURL(blob) })
            } else { updated.push(t) }
          } catch { updated.push(t) } finally {
            setTrackLoading(p => ({ ...p, [t.id]: false }))
          }
        }
        // 트랙 상태 저장 후 합치기
        setTTS({ tracks: { ...tracks, [c.id]: updated } })
        await mergeTracksForCut(c.id, updated)
      }
    } finally { setBatchRunning(false) }
  }

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className={s.root}>
      {/* 왼쪽 사이드바 */}
      <div className={s.sidebar}>
        <div className={s.sideHead}>
          <span className={s.sideTitle}>컷 목록</span>
          <div className={`${s.elBadge} ${elevenLabsStatus.connected ? s.connected : ''}`}>
            {elevenLabsStatus.connected ? `${remaining.toLocaleString()}자 남음` : 'EL 미연결'}
          </div>
        </div>
        <div className={s.cutList}>
          {cuts.map((c, i) => (
            <button key={c.id}
              className={`${s.cutItem} ${activeCutIdx === i ? s.cutActive : ''}`}
              onClick={() => handleCutSelect(i)}>
              <div className={s.cutTop}>
                <span className={s.cutNo}>CUT {c.no}</span>
                <div className={s.cutBadges}>
                  {g3Confirmed[c.id] && <span className={s.g3Tag}>G3✅</span>}
                  {!g3Confirmed[c.id] && mergedUrls[c.id] && <span className={s.doneTag}>🎵완성</span>}
                </div>
              </div>
              <span className={s.cutPrev}>{c.dialogue || c.narration || '(내용 없음)'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 오른쪽 메인 */}
      <div className={s.main}>
        {/* 1. 목소리 설정 */}
        <div className={s.panel}>
          <h3 className={s.panelTitle}>목소리 선택</h3>
          {ttsSettings.voiceId === DEFAULT_VOICE_ID ? (
            <div className={`${s.voiceBanner} ${s.voiceBannerOk}`}>✅ 서여리 목소리 적용 중</div>
          ) : (
            <div className={`${s.voiceBanner} ${s.voiceBannerWarn}`}>
              <span>⚠️ 서여리 목소리가 아닙니다</span>
              <button className={s.restoreBtn} onClick={restoreYeoriVoice}>서여리로 복원</button>
            </div>
          )}
          <div className={s.voiceInputRow}>
            <input className={s.voiceInput} type="text" placeholder="ElevenLabs Voice ID 입력"
              value={voiceInput} onChange={e => setVoiceInput(e.target.value)} />
            <button className={s.voiceLoadBtn} onClick={saveVoiceId}>저장</button>
          </div>
          {myVoices.length > 0 && (
            <select className={s.voiceSelect} value=""
              onChange={e => { if (e.target.value) setVoiceInput(e.target.value) }}>
              <option value="">— 목소리 선택 —</option>
              {myVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
            </select>
          )}
          <button className={s.voiceFetchBtn} onClick={loadMyVoices} disabled={voicesLoading}>
            {voicesLoading ? '불러오는 중...' : '🎤 내 목소리 목록 불러오기'}
          </button>
          {ttsSettings.voiceId && (
            <div className={s.voiceApplied}>적용됨: <code>{ttsSettings.voiceId}</code></div>
          )}
        </div>

        {/* 2. 트랙 구성 패널 */}
        {cut && (
          <div className={s.panel}>
            <h3 className={s.panelTitle}>CUT {cut.no} 트랙 구성</h3>

            {cutTracks.map((track, idx) => (
              <div key={track.id} className={s.trackCard}>
                {/* 헤더 */}
                <div className={s.trackHeader}>
                  <span className={`${s.trackLabel} ${track.type === 'narration' ? s.trackLabelNarr : ''}`}>
                    {track.type === 'dialogue' ? '💬 대사' : '🎙 나레이션'}
                  </span>
                  <div className={s.trackHeaderBtns}>
                    <button className={s.trackMoveBtn} disabled={idx === 0}
                      onClick={() => setTracksForCut(cut.id, prev => {
                        const a = [...prev]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; return a
                      })}>↑</button>
                    <button className={s.trackMoveBtn} disabled={idx === cutTracks.length - 1}
                      onClick={() => setTracksForCut(cut.id, prev => {
                        const a = [...prev]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; return a
                      })}>↓</button>
                    <button className={s.trackDelBtn}
                      onClick={() => setTracksForCut(cut.id, prev => prev.filter(t => t.id !== track.id))}>
                      ✕
                    </button>
                  </div>
                </div>

                {/* 텍스트 */}
                <textarea className={s.trackText} rows={3}
                  placeholder={track.type === 'dialogue' ? '대사 입력...' : '나레이션 입력...'}
                  value={track.text}
                  onChange={e => setTracksForCut(cut.id, prev =>
                    prev.map(t => t.id === track.id ? { ...t, text: e.target.value } : t)
                  )} />

                {/* 슬라이더 */}
                <div className={s.trackSettings}>
                  {[
                    { key: 'speed',      label: '속도',   min: 0.5, max: 2.0, step: 0.05, unit: 'x' },
                    { key: 'stability',  label: '안정성', min: 0,   max: 100, step: 1,    unit: '%' },
                    { key: 'similarity', label: '유사도', min: 0,   max: 100, step: 1,    unit: '%' },
                  ].map(({ key, label, min, max, step, unit }) => (
                    <div key={key} className={s.sliderRow}>
                      <span className={s.sliderLabel}>{label}</span>
                      <input type="range" min={min} max={max} step={step}
                        value={track.settings[key]}
                        onChange={e => setTracksForCut(cut.id, prev =>
                          prev.map(t => t.id === track.id
                            ? { ...t, settings: { ...t.settings, [key]: parseFloat(e.target.value) } }
                            : t
                          )
                        )} />
                      <span className={s.sliderVal}>{track.settings[key]}{unit}</span>
                    </div>
                  ))}
                </div>

                {/* 생성 버튼 + 개별 오디오 */}
                <div className={s.trackGenRow}>
                  <button className={s.trackGenBtn} disabled={trackLoading[track.id]}
                    onClick={() => generateTrackById(cut.id, track.id)}>
                    {trackLoading[track.id]
                      ? <><span className={s.spinner} />생성 중…</>
                      : '🔊 생성'}
                  </button>
                  {track.url && <audio controls src={track.url} className={s.trackAudio} />}
                </div>
              </div>
            ))}

            {/* 트랙 추가 */}
            <div className={s.addTrackRow}>
              <button className={s.addTrackBtn}
                onClick={() => setTracksForCut(cut.id, prev => [...prev, makeTrack('dialogue', '')])}>
                + 대사 추가
              </button>
              <button className={s.addTrackBtn}
                onClick={() => setTracksForCut(cut.id, prev => [...prev, makeTrack('narration', '')])}>
                + 나레이션 추가
              </button>
            </div>

            {/* 전체 합치기 버튼 */}
            <button className={s.mergeBtn}
              disabled={merging[cut.id] || !cutTracks.some(t => t.url)}
              onClick={() => mergeTracksForCut(cut.id)}>
              {merging[cut.id]
                ? <><span className={s.spinner} />합치는 중…</>
                : '🎵 전체 합치기'}
            </button>

            {/* 합친 결과 */}
            {mergedUrls[cut.id] && (
              <div className={s.mergedResult}>
                <div className={s.mergedLabel}>합친 결과</div>
                <audio controls src={mergedUrls[cut.id]} className={s.audioPlayer} />
                <div className={s.mergedActions}>
                  <button className={s.dlBtn} onClick={() => downloadMerged(cut.id, cut.no)}>
                    ⬇ 다운로드
                  </button>
                  {!g3Confirmed[cut.id] ? (
                    <button className={s.g3Btn} onClick={() => approveG3(cut.id, cut.no)}>
                      ✅ G3 승인
                    </button>
                  ) : (
                    <span className={s.g3Tag}>G3 완료</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. 전체 일괄 생성 */}
        <div className={s.panel}>
          <h3 className={s.panelTitle}>전체 일괄 생성</h3>
          <p className={s.batchDesc}>모든 컷의 트랙을 순서대로 생성 후 합치기까지 자동 실행합니다.</p>
          <button className={s.batchBtn} disabled={batchRunning} onClick={runBatch}>
            {batchRunning
              ? <><span className={s.spinner} />실행 중…</>
              : '🎙️ 전체 컷 합치기까지 자동 실행'}
          </button>
        </div>
      </div>
    </div>
  )
}
