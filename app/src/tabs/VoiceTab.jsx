import { useRef } from 'react'
import { useApp } from '../context/AppContext'
import s from './VoiceTab.module.css'

function makeVoiceTrack() {
  return {
    id: `vt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url: null, name: '', size: 0, uploading: false, saved: false,
  }
}

export default function VoiceTab() {
  const { state, dispatch } = useApp()
  const { cuts } = state
  const { tracks = {} } = state.voiceInsertState || {}
  const fileRefs = useRef({})

  const setVoiceState = (p) => dispatch({ type: 'SET_VOICE_INSERT_STATE', p })

  const getTracksForCut = (cutId) => tracks[cutId] || []
  const setTracksForCut = (cutId, updater) => {
    const cur  = getTracksForCut(cutId)
    const next = typeof updater === 'function' ? updater(cur) : updater
    setVoiceState({ tracks: { ...tracks, [cutId]: next } })
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

  const hasCutAny = (cutId) => getTracksForCut(cutId).some(t => t.url)

  const activeCutId = state.voiceInsertState?.activeCutId ?? cuts[0]?.id
  const activeCut = cuts.find(c => c.id === activeCutId) || cuts[0]
  const setActiveCut = (cutId) => setVoiceState({ activeCutId: cutId })

  const cut = activeCut
  const cutTracks = cut ? getTracksForCut(cut.id) : []

  return (
    <div className={s.root}>
      <div className={s.sidebar}>
        <div className={s.sideTitle}>컷 목록</div>
        <div className={s.cutList}>
          {cuts.map((c) => (
            <button key={c.id}
              className={`${s.cutItem} ${cut?.id === c.id ? s.active : ''}`}
              onClick={() => setActiveCut(c.id)}
            >
              <div className={s.cutRow}>
                <span className={s.cutNo}>CUT {c.no}</span>
                {hasCutAny(c.id) && (
                  <span className={s.tag}>🎙️ {getTracksForCut(c.id).filter(t => t.url).length}개</span>
                )}
              </div>
              <span className={s.cutPrev}>{c.dialogue || c.narration || '(내용 없음)'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={s.main}>
        <div className={s.header}>
          <h2>내 음성 삽입</h2>
          <p className={s.desc}>직접 녹음한 음성 파일을 각 컷에 연결합니다. 롱컷처럼 한 컷에 목소리가 여럿 필요하면 트랙을 추가하세요. MP3, WAV, M4A, OGG 지원.</p>
        </div>

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
  )
}
