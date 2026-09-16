import { useRef, useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { EpisodeOverviewBlock, CutList } from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './VoiceTab.module.css'
import { elIsolateVoice, elSpeechToText } from '../lib/api'

function makeVoiceTrack() {
  return {
    id: `vt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url: null, name: '', size: 0, uploading: false, saved: false,
  }
}

export default function VoiceTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys } = state
  const { tracks = {} } = state.voiceInsertState || {}
  const fileRefs = useRef({})
  const episodeCode = resolveEpisodeCode(state.episode)
  const [gData, setGData] = useState(() => loadGPoints())

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  const setVoiceState = (p) => dispatch({ type: 'SET_VOICE_INSERT_STATE', p })

  const getTracksForCut = (cutId) => tracks[cutId] || []
  // ⚠️ 클로저(tracks)에 대고 updater를 미리 계산하지 않고 리듀서에서 최신 state로 계산 —
  // handleUpload처럼 비동기 완료가 늦게 돌아오는 콜백이 그 사이 다른 트랙 추가를 덮어쓰는
  // stale-closure 레이스 방지(VideoTab.jsx의 동일 버그를 2026-09-16 발견 후 동일 패턴 적용).
  const setTracksForCut = (cutId, updater) => {
    if (typeof updater === 'function') dispatch({ type: 'UPDATE_TAB_FIELD', slice: 'voiceInsertState', field: 'tracks', key: cutId, updater })
    else setVoiceState({ tracks: { ...tracks, [cutId]: updater } })
  }

  const addTrack = (cutId) => {
    setTracksForCut(cutId, prev => [...prev, makeVoiceTrack()])
  }

  const removeTrack = (cutId, trackId) => {
    setTracksForCut(cutId, prev => prev.filter(t => t.id !== trackId))
  }

  const handleUpload = async (cutId, trackId, trackIdx, file) => {
    if (!file) return
    const localUrl = URL.createObjectURL(file)
    setTracksForCut(cutId, prev => prev.map(t =>
      t.id === trackId ? { ...t, url: localUrl, name: file.name, size: file.size, uploading: true, saved: false } : t
    ))

    const c = cuts.find(c => c.id === cutId)
    const epNo = state.episode?.number ?? ''
    const ext  = (file.name.split('.').pop() || 'mp3').toLowerCase()
    try {
      const res = await fetch(
        `http://localhost:3001/api/save-voice-insert?ep=${epNo}&cutNo=${String(c?.no ?? 0).padStart(2,'0')}&idx=${trackIdx}&ext=${ext}`,
        { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }
      )
      if (!res.ok) throw new Error('저장 실패')
      const data = await res.json()
      setTracksForCut(cutId, prev => prev.map(t => {
        if (t.id !== trackId) return t
        const version = (t.version || 0) + 1
        return { ...t, url: `http://localhost:3001${data.url}?v=${version}`, version, uploading: false, saved: true }
      }))
    } catch (err) {
      setTracksForCut(cutId, prev => prev.map(t => t.id === trackId ? { ...t, uploading: false } : t))
      alert('서버 저장 실패 — 새로고침하면 이 음성이 사라질 수 있습니다: ' + err.message)
    }
  }

  // ── ElevenLabs 후처리 (2026-09-16) — 업로드된 트랙에 노이즈 제거 / 자동 스크립트 추출.
  // 화면녹화 컷(CUT4/6/8류)처럼 원본 음향이 지저분하거나 대사를 다시 타이핑하기 귀찮을 때 씀.
  const [isolateBusy, setIsolateBusy] = useState({})   // trackId -> true
  const [isolateResult, setIsolateResult] = useState({}) // trackId -> { url, blob }
  const [sttBusy, setSttBusy] = useState({})
  const [sttResult, setSttResult] = useState({})       // trackId -> text

  const isolateTrack = async (track) => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 입력하세요 (상단 API 바)'); return }
    setIsolateBusy(p => ({ ...p, [track.id]: true }))
    try {
      const srcBlob = await (await fetch(track.url)).blob()
      const res = await elIsolateVoice(apiKeys.elevenLabs, srcBlob)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.detail?.message || e.error || '노이즈 제거 실패')
      }
      const cleanBlob = await res.blob()
      setIsolateResult(p => ({ ...p, [track.id]: { url: URL.createObjectURL(cleanBlob), blob: cleanBlob } }))
    } catch (err) {
      alert('노이즈 제거 실패: ' + err.message)
    } finally {
      setIsolateBusy(p => ({ ...p, [track.id]: false }))
    }
  }

  const applyIsolated = async (cutId, track, idx) => {
    const result = isolateResult[track.id]
    if (!result) return
    const file = new File([result.blob], track.name || 'isolated.mp3', { type: 'audio/mpeg' })
    await handleUpload(cutId, track.id, idx, file)
    setIsolateResult(p => { const n = { ...p }; delete n[track.id]; return n })
  }

  const transcribeTrack = async (track) => {
    if (!apiKeys.elevenLabs) { alert('ElevenLabs API 키를 입력하세요 (상단 API 바)'); return }
    setSttBusy(p => ({ ...p, [track.id]: true }))
    try {
      const srcBlob = await (await fetch(track.url)).blob()
      const res = await elSpeechToText(apiKeys.elevenLabs, srcBlob)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail?.message || data.error || '스크립트 추출 실패')
      setSttResult(p => ({ ...p, [track.id]: data.text || '(인식된 텍스트 없음)' }))
    } catch (err) {
      alert('스크립트 추출 실패: ' + err.message)
    } finally {
      setSttBusy(p => ({ ...p, [track.id]: false }))
    }
  }

  const applyTranscript = (cutId, text, field) => {
    dispatch({ type: 'UPDATE_CUT', id: cutId, p: { [field]: text } })
    alert(`✅ ${field === 'dialogue' ? '대사' : '나레이션'}에 반영했습니다.`)
  }

  const hasCutAny = (cutId) => getTracksForCut(cutId).some(t => t.url)

  const activeCutId = state.voiceInsertState?.activeCutId ?? cuts[0]?.id
  const activeCut = cuts.find(c => c.id === activeCutId) || cuts[0]
  const setActiveCut = (cutId) => setVoiceState({ activeCutId: cutId })

  const cut = activeCut
  const cutTracks = cut ? getTracksForCut(cut.id) : []

  return (
    <div className={s.page}>
      <TabToolbar />
    <div className={s.root}>
      <div className={s.sidebar}>
        <EpisodeOverviewBlock />
        <div className={s.sideTitle}>컷 목록</div>
        <CutList
          cuts={cuts} gData={gData} episodeCode={episodeCode} maxStage={3}
          activeCutId={cut?.id}
          onCutClick={c => setActiveCut(c.id)}
          renderExtra={c => hasCutAny(c.id)
            ? <span className={s.tag}>🎙️ {getTracksForCut(c.id).filter(t => t.url).length}개</span>
            : null}
        />
      </div>

      <div className={s.main}>
        <div className={`${s.header} ${s.topBar}`}>
          <h2>내 음성 삽입</h2>
          <p className={s.desc}>직접 녹음한 음성 파일을 각 컷에 연결합니다. 롱컷처럼 한 컷에 목소리가 여럿 필요하면 트랙을 추가하세요. MP3, WAV, M4A, OGG 지원.</p>
        </div>

        <div className={s.scrollBody}>
        {cut && (
          <div className={s.card}>
            <div className={s.cardHeader}>
              <span className={s.badge}>CUT {cut.no}</span>
              <span className={s.scene}>{cut.scene || '씬 미입력'}</span>
            </div>

            <div className={s.dialogue}>
              {cut.dialogue && <div className={s.textBlock}><span className={s.textLabel}>대사</span><span>{cut.dialogue}</span></div>}
              {cut.narration && <div className={s.textBlock}><span className={s.textLabel}>나레이션</span><span>{cut.narration}</span></div>}
            </div>

            <div className={s.trackGrid}>
              {cutTracks.map((track, idx) => (
                <div key={track.id} className={s.trackTile}>
                  <div className={s.trackTileHead}>
                    <span className={s.trackTileLabel}>트랙 {idx + 1}</span>
                    <button className={s.trackTileRemove} onClick={() => removeTrack(cut.id, track.id)}>✕</button>
                  </div>

                  {track.url ? (
                    <div className={s.audioBlock}>
                      <div className={s.audioInfo}>
                        <span className={s.audioIcon}>🎙️</span>
                        <div className={s.audioMeta}>
                          <div className={s.audioName}>{track.name || '(재생 가능)'}</div>
                          <div className={s.audioSize}>
                            {track.size ? `${(track.size / 1024).toFixed(1)} KB` : ''}
                            {track.uploading && <span className={s.savingBadge}> · 💾 저장 중…</span>}
                            {!track.uploading && track.saved && <span className={s.savedBadge}> · ✅ 저장됨</span>}
                          </div>
                        </div>
                      </div>
                      <audio controls src={track.url} className={s.player} />
                      <label className={s.replaceBtn}>
                        🔁 다른 파일로 교체
                        <input type="file" accept="audio/*" hidden
                          onChange={e => handleUpload(cut.id, track.id, idx, e.target.files[0])} />
                      </label>

                      {/* ElevenLabs 후처리 — 노이즈 제거 / 자동 스크립트 추출 */}
                      <div className={s.replaceBtn} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" style={{ flex: 1 }} disabled={isolateBusy[track.id]}
                          onClick={() => isolateTrack(track)}>
                          {isolateBusy[track.id] ? '⏳ 정리 중…' : '🧼 노이즈 제거'}
                        </button>
                        <button type="button" style={{ flex: 1 }} disabled={sttBusy[track.id]}
                          onClick={() => transcribeTrack(track)}>
                          {sttBusy[track.id] ? '⏳ 추출 중…' : '📝 스크립트 추출'}
                        </button>
                      </div>

                      {isolateResult[track.id] && (
                        <div className={s.audioBlock}>
                          <div className={s.audioName}>🧼 정리된 결과 (아직 저장 안 됨)</div>
                          <audio controls src={isolateResult[track.id].url} className={s.player} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" style={{ flex: 1 }} onClick={() => applyIsolated(cut.id, track, idx)}>
                              ✅ 이걸로 교체
                            </button>
                            <button type="button" style={{ flex: 1 }}
                              onClick={() => setIsolateResult(p => { const n = { ...p }; delete n[track.id]; return n })}>
                              취소
                            </button>
                          </div>
                        </div>
                      )}

                      {sttResult[track.id] && (
                        <div className={s.audioBlock}>
                          <div className={s.audioName}>📝 추출된 텍스트</div>
                          <textarea rows={3} style={{ width: '100%' }} value={sttResult[track.id]}
                            onChange={e => setSttResult(p => ({ ...p, [track.id]: e.target.value }))} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" style={{ flex: 1 }}
                              onClick={() => applyTranscript(cut.id, sttResult[track.id], 'dialogue')}>
                              대사에 반영
                            </button>
                            <button type="button" style={{ flex: 1 }}
                              onClick={() => applyTranscript(cut.id, sttResult[track.id], 'narration')}>
                              나레이션에 반영
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={s.uploadArea} onClick={() => fileRefs.current[track.id]?.click()}>
                      <span className={s.uploadIcon}>🎤</span>
                      <span className={s.uploadText}>클릭하여 음성 파일 업로드</span>
                      <span className={s.uploadSub}>MP3 · WAV · M4A · OGG</span>
                      <input ref={el => fileRefs.current[track.id] = el} type="file"
                        accept="audio/*" style={{ display: 'none' }}
                        onChange={e => handleUpload(cut.id, track.id, idx, e.target.files[0])} />
                    </div>
                  )}
                </div>
              ))}

              <button className={s.trackAddTile} onClick={() => addTrack(cut.id)}>
                <span className={s.trackAddIcon}>+</span>
                <span>음성 트랙 추가</span>
              </button>
            </div>
          </div>
        )}

        <div className={s.allGrid}>
          <div className={s.allTitle}>전체 컷 현황</div>
          <div className={s.grid}>
            {cuts.map((c) => (
              <div key={c.id} className={`${s.miniCard} ${hasCutAny(c.id) ? s.miniDone : ''}`}
                onClick={() => setActiveCut(c.id)}>
                <span className={s.miniNo}>CUT {c.no}</span>
                <span className={s.miniStatus}>{hasCutAny(c.id) ? '✓' : '○'}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
    </div>
  )
}
