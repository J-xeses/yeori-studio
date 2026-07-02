import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import s from './VoiceTab.module.css'

export default function VoiceTab() {
  const { state } = useApp()
  const { cuts } = state
  const [voices, setVoices] = useState({})
  const fileRefs = useRef({})
  const [activeCut, setActiveCut] = useState(0)

  const handleUpload = (cutId, file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setVoices(p => ({ ...p, [cutId]: { url, name: file.name, size: file.size } }))
  }

  const remove = (cutId) => setVoices(p => { const n = {...p}; delete n[cutId]; return n })

  const cut = cuts[activeCut]

  return (
    <div className={s.root}>
      <div className={s.sidebar}>
        <div className={s.sideTitle}>컷 목록</div>
        <div className={s.cutList}>
          {cuts.map((c, i) => (
            <button key={c.id}
              className={`${s.cutItem} ${activeCut === i ? s.active : ''}`}
              onClick={() => setActiveCut(i)}
            >
              <div className={s.cutRow}>
                <span className={s.cutNo}>CUT {c.no}</span>
                {voices[c.id] && <span className={s.tag}>🎙️ 삽입됨</span>}
              </div>
              <span className={s.cutPrev}>{c.dialogue || c.narration || '(내용 없음)'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={s.main}>
        <div className={s.header}>
          <h2>내 음성 삽입</h2>
          <p className={s.desc}>직접 녹음한 음성 파일을 각 컷에 연결합니다. MP3, WAV, M4A 지원.</p>
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

            {voices[cut.id] ? (
              <div className={s.audioBlock}>
                <div className={s.audioInfo}>
                  <span className={s.audioIcon}>🎙️</span>
                  <div>
                    <div className={s.audioName}>{voices[cut.id].name}</div>
                    <div className={s.audioSize}>{(voices[cut.id].size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button className={s.removeBtn} onClick={() => remove(cut.id)}>✕ 제거</button>
                </div>
                <audio controls src={voices[cut.id].url} className={s.player} />
              </div>
            ) : (
              <div className={s.uploadArea} onClick={() => fileRefs.current[cut.id]?.click()}>
                <span className={s.uploadIcon}>🎤</span>
                <span className={s.uploadText}>클릭하여 음성 파일 업로드</span>
                <span className={s.uploadSub}>MP3 · WAV · M4A · OGG</span>
                <input ref={el => fileRefs.current[cut.id] = el} type="file"
                  accept="audio/*" style={{ display: 'none' }}
                  onChange={e => handleUpload(cut.id, e.target.files[0])} />
              </div>
            )}
          </div>
        )}

        <div className={s.allGrid}>
          <div className={s.allTitle}>전체 컷 현황</div>
          <div className={s.grid}>
            {cuts.map((c) => (
              <div key={c.id} className={`${s.miniCard} ${voices[c.id] ? s.miniDone : ''}`}
                onClick={() => setActiveCut(cuts.indexOf(c))}>
                <span className={s.miniNo}>CUT {c.no}</span>
                <span className={s.miniStatus}>{voices[c.id] ? '✓' : '○'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
