import { useRef, useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { EpisodeOverviewBlock, CutList } from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './VoiceTab.module.css'
import { elIsolateVoice, elSpeechToText, elTTS, freeTTS, replaceCutAudioSegment } from '../lib/api'
import { isFreeVoice, freeVoiceName, speedToRate } from '../lib/freeTts'
import { videoUrl } from '../lib/mediaPaths'

// TTSTab.jsx의 기본값과 동일(이 코드베이스 관례상 작은 값은 탭마다 복제) — 화자별 목소리
// 설정이 없는 컷에서 구간교체 미리듣기가 쓸 폴백.
const SEGFIX_DEFAULT_VOICE_ID = 'free:ko-KR-SunHiNeural'
const SEGFIX_DEFAULT_SETTINGS = { speed: 0.9, stability: 30, similarity: 75 }

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

  // ── 컷 영상 자체 오디오 구간 교체(2026-11-23) — 두 캐릭터가 번갈아 말하는 대사 컷에서
  // 한쪽 목소리만 이상하게 생성됐을 때, 그 구간만 시간으로 잘라 TTS로 다시 끼워넣는다.
  // 화자가 겹쳐 말하는(동시발화) 구간엔 못 쓴다 — 음원 분리가 아니라 시간상 분리 전용.
  // 2026-11-24 수정(성준님 제보 — "탭을 벗어났다 돌아오니 만들어둔 TTS 이력이 없다"): 아래
  // segFixPersist(start/end/text/speaker/적용이력)는 voiceInsertState로 저장되어 탭 전환·
  // 새로고침에도 남는다. duration/미리듣기(blob URL)처럼 다시 만들기 쉽고 직렬화도 안 되는
  // 값만 segFixLocal(컴포넌트 로컬 state)에 남겨 분리한다 — EditMetaTab의 동일 패턴 참고.
  const segFixPersist = state.voiceInsertState?.segFix || {}
  const [segFixLocal, setSegFixLocal] = useState({})
  const segVideoRef = useRef(null)
  const sf = cut ? { ...(segFixPersist[cut.id] || {}), ...(segFixLocal[cut.id] || {}) } : {}
  const PERSIST_SF_KEYS = new Set(['start', 'end', 'text', 'speaker', 'appliedAt', 'appliedFactor', 'appliedBackupPath'])
  const setSf = (patch) => {
    if (!cut) return
    const pPatch = {}, lPatch = {}
    for (const k of Object.keys(patch)) (PERSIST_SF_KEYS.has(k) ? pPatch : lPatch)[k] = patch[k]
    if (Object.keys(pPatch).length) {
      dispatch({ type: 'UPDATE_TAB_FIELD', slice: 'voiceInsertState', field: 'segFix', key: cut.id, updater: (prev) => ({ ...(prev || {}), ...pPatch }) })
    }
    if (Object.keys(lPatch).length) {
      setSegFixLocal(p => ({ ...p, [cut.id]: { ...(p[cut.id] || {}), ...lPatch } }))
    }
  }

  const onSegVideoMeta = (e) => {
    const d = e.target.duration
    const already = segFixPersist[cut?.id]
    if (already && already.start != null && already.end != null) { setSf({ duration: d }); return }
    setSf({ duration: d, start: 0, end: Math.min(2, d) })
  }

  const playSegOriginal = () => {
    const v = segVideoRef.current
    if (!v || sf.end == null) return
    v.currentTime = sf.start
    v.play()
    const onTime = () => { if (v.currentTime >= sf.end) { v.pause(); v.removeEventListener('timeupdate', onTime) } }
    v.addEventListener('timeupdate', onTime)
  }

  const dragSegBar = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const move = (ev) => {
      const ratio = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
      const sec = Math.round((ratio * sf.duration) / 0.1) * 0.1
      // 클릭/드래그 지점에 더 가까운 핸들(시작/끝)을 옮긴다 — 핸들을 따로 그리지 않아도
      // 막대 위 아무 곳이나 끌면 그쪽 경계가 따라오는 단순한 구간 선택.
      if (Math.abs(sec - sf.start) <= Math.abs(sec - sf.end)) setSf({ start: Math.max(0, Math.min(sec, sf.end - 0.3)) })
      else setSf({ end: Math.min(sf.duration, Math.max(sec, sf.start + 0.3)) })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    move(e)
  }

  const segTtsRequest = (voiceId, text, settings) => {
    if (isFreeVoice(voiceId)) return freeTTS(freeVoiceName(voiceId), text, speedToRate(settings.speed))
    if (!apiKeys.elevenLabs) throw new Error('ElevenLabs API 키를 입력하세요 (상단 API 바)')
    return elTTS(apiKeys.elevenLabs, voiceId, {
      text, model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: settings.stability / 100, similarity_boost: settings.similarity / 100, speed: settings.speed },
    })
  }

  const genSegPreview = async () => {
    if (!sf.text?.trim()) { alert('교체할 대사를 입력하세요'); return }
    const tts = state.ttsSettings || {}
    const speakerVoices = tts.speakerVoices || {}
    const speakerSettings = tts.speakerSettings || {}
    const voiceId  = (sf.speaker && speakerVoices[sf.speaker]) || tts.voiceId || SEGFIX_DEFAULT_VOICE_ID
    const settings = (sf.speaker && speakerSettings[sf.speaker]) || SEGFIX_DEFAULT_SETTINGS
    setSf({ previewBusy: true })
    try {
      const res = await segTtsRequest(voiceId, sf.text.trim(), settings)
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail?.message || e.error || 'TTS 생성 실패') }
      const blob = await res.blob()
      setSf({ previewBusy: false, previewUrl: URL.createObjectURL(blob), previewBlob: blob })
    } catch (err) {
      setSf({ previewBusy: false })
      alert('미리듣기 실패: ' + err.message)
    }
  }

  const applySegFix = async () => {
    if (!sf.previewBlob) { alert('먼저 미리듣기를 생성하세요'); return }
    setSf({ applyBusy: true })
    try {
      const res = await replaceCutAudioSegment(state.episode?.number, cut.no, sf.start, sf.end, sf.previewBlob)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.error || '적용 실패')
      setSf({
        applyBusy: false, videoBust: data.mtimeMs, previewUrl: null, previewBlob: null,
        appliedAt: Date.now(), appliedFactor: data.factor ?? null, appliedBackupPath: data.backupPath || null,
      })
      alert('✅ 적용 완료 — 영상의 해당 구간 음성이 교체되었습니다(원본은 _backup에 보관).')
    } catch (err) {
      setSf({ applyBusy: false })
      alert('적용 실패: ' + err.message)
    }
  }

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

            <div className={s.audioBlock} style={{ marginBottom: 14 }}>
              <div className={s.audioName}>🎬 영상 음성 구간 교체 — 번갈아 말하는 대사 중 한쪽만 다시 녹음(겹쳐 말하는 구간엔 못 씀)</div>
              <video
                ref={segVideoRef}
                src={`${videoUrl(state.episode, cut.no)}?v=${sf.videoBust || cut.id}`}
                controls
                onLoadedMetadata={onSegVideoMeta}
                style={{ width: '100%', maxHeight: 220, background: '#000', borderRadius: 6 }}
              />
              {sf.duration > 0 && (
                <>
                  <div
                    style={{ position: 'relative', height: 28, background: 'rgba(255,255,255,0.08)', borderRadius: 4, margin: '10px 0 4px', cursor: 'pointer' }}
                    onPointerDown={dragSegBar}
                  >
                    <div style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: `${(sf.start / sf.duration) * 100}%`,
                      width: `${Math.max(0, (sf.end - sf.start) / sf.duration) * 100}%`,
                      background: 'rgba(124,92,255,0.5)', borderRadius: 4,
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, opacity: 0.85 }}>
                    <span>구간 {sf.start?.toFixed(1)}s ~ {sf.end?.toFixed(1)}s (길이 {(sf.end - sf.start).toFixed(1)}s) · 전체 {sf.duration.toFixed(1)}s</span>
                    <button type="button" onClick={playSegOriginal}>▶ 이 구간 들어보기</button>
                  </div>

                  <textarea rows={2} placeholder="이 구간에서 다시 말할 대사를 입력하세요"
                    style={{ width: '100%', marginTop: 8, boxSizing: 'border-box' }}
                    value={sf.text || ''} onChange={e => setSf({ text: e.target.value })} />

                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <select value={sf.speaker || ''} onChange={e => setSf({ speaker: e.target.value || null })}>
                      <option value="">기본 목소리</option>
                      {Object.keys(state.ttsSettings?.speakerVoices || {}).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <button type="button" disabled={sf.previewBusy} onClick={genSegPreview} style={{ flex: 1 }}>
                      {sf.previewBusy ? '⏳ 생성 중…' : '🔊 미리듣기 생성'}
                    </button>
                  </div>

                  {sf.previewUrl && (
                    <div className={s.audioBlock} style={{ marginTop: 8 }}>
                      <audio controls src={sf.previewUrl} className={s.player} />
                      <button type="button" disabled={sf.applyBusy} onClick={applySegFix}>
                        {sf.applyBusy ? '⏳ 적용 중…' : '✅ 이 구간에 적용'}
                      </button>
                    </div>
                  )}

                  {!sf.previewUrl && sf.appliedAt && (
                    <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6 }}>
                      ✅ 마지막 적용: {new Date(sf.appliedAt).toLocaleString('ko-KR')}
                      {sf.appliedFactor != null && sf.appliedFactor !== 1 ? ` · 배속 ${sf.appliedFactor}x(TTS가 구간보다 길어 압축됨)` : ' · 원래 속도 그대로'}
                      {' · 원본 백업: '}<a href={sf.appliedBackupPath} target="_blank" rel="noreferrer">보기</a>
                    </div>
                  )}
                </>
              )}
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
