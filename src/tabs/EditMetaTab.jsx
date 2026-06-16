// src/tabs/EditMetaTab.jsx
import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import styles from './EditMetaTab.module.css'

function estimateDuration(text = '') {
  const chars = text.replace(/\s/g, '').length
  return Math.max(4, Math.round((chars / 300) * 60))
}

function toTimecode(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

export default function EditMetaTab() {
  const { state } = useApp()
  const [loading, setLoading] = useState(false)
  const [meta, setMeta]       = useState([])
  const [aiNote, setAiNote]   = useState('')
  const [error, setError]     = useState('')
  const [hookIndices, setHookIndices] = useState([0])

  // FFmpeg ?먮룞 ?ㅽ뻾 ?곹깭
  const [workDir, setWorkDir]         = useState('downloads/video/ep5')
  const [ffmpegRunning, setFfmpegRunning] = useState(false)
  const [ffmpegProgress, setFfmpegProgress] = useState(null)   // { current, total, label }
  const [ffmpegResults, setFfmpegResults]   = useState([])     // [{ cutNo, file, status }]
  const [ffmpegError, setFfmpegError]       = useState('')

  // ?뚯꽦 ??대컢 ?곹깭 (而룸퀎)
  const [audioSettings, setAudioSettings] = useState({})

  const cuts = state.cuts?.length
    ? state.cuts
    : Array.from({ length: 7 }, (_, i) => ({
        label: `CUT ${String(i+1).padStart(2,'0')}`,
        script: '',
      }))

  const getAudio = (i) => audioSettings[i] || {
    audioFile: '',
    audioStart: 0,
    audioEnd: '',
    sfxOnly: false,
    hasSubtitle: false,
  }

  const setAudio = (i, key, value) => {
    setAudioSettings(prev => ({
      ...prev,
      [i]: { ...getAudio(i), [key]: value }
    }))
  }

  const buildMeta = () => {
    let cursor = 0
    return cuts.map((cut, i) => {
      const dur   = cut.sec || cut.duration || estimateDuration(cut.script || cut.text || '')
      const start = cursor
      cursor += dur
      const isHook = hookIndices.includes(i)
      const audio = getAudio(i)
      return {
        cutNo: String(i+1).padStart(2,'0'),
        label: cut.label || `CUT ${String(i+1).padStart(2,'0')}`,
        start: toTimecode(start),
        end:   toTimecode(cursor),
        duration: dur,
        type: isHook ? '?? : '?쇰컲',
        transition: i === 0 ? '?섏씠?????꾩썐' : '而??몄쭛',
        note: isHook ? '由ы뀗????援ш컙 ??媛뺤“ ?④낵 沅뚯옣' : '',
        audioFile: audio.audioFile,
        audioStart: audio.audioStart,
        audioEnd: audio.audioEnd || dur,
        sfxOnly: audio.sfxOnly,
        hasSubtitle: audio.hasSubtitle,
      }
    })
  }

  const generate = async () => {
    setLoading(true); setError('')
    const computed = buildMeta()
    setMeta(computed)
    try {
      const apiKey   = state.apiKeys?.claude || state.apiKey || ''
      const totalSec = computed.reduce((a,c) => a + c.duration, 0)
      const hookCuts = computed.filter(c => c.type === '??).map(c => c.label).join(', ')
      const data = await claudeMessages(apiKey, {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `AI 踰꾩텛???명뵆猷⑥뼵??"?쒖뿬由? ?좏뒠釉??곸긽 CapCut ?몄쭛 ??二쇱쓽?ы빆 3以??붿빟.
珥?湲몄씠: ${toTimecode(totalSec)} / CUT: ${computed.length}媛?/ ??CUT: ${hookCuts || '?놁쓬'}
?ㅼ슜?곸씤 議곗뼵留?`,
        }],
      }).then(r => r.json())
      setAiNote(data.content?.map(b => b.text || '').join('') || '')
    } catch (e) {
      setError('AI 二쇱쓽?ы빆 ?앹꽦 ?ㅻ쪟: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'yeori_edit_meta.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const exportCSV = () => {
    const headers = ['CUT踰덊샇','?덉씠釉?,'?쒖옉','??,'湲몄씠(珥?','???,'?몃옖吏??,'?뚯꽦?뚯씪','?뚯꽦?쒖옉','?뚯꽦??,'?④낵?뚮쭔','?먮쭑']
    const rows = meta.map(m =>
      [m.cutNo, m.label, m.start, m.end, m.duration, m.type, m.transition,
       m.audioFile, m.audioStart, m.audioEnd, m.sfxOnly, m.hasSubtitle].join(',')
    )
    const csv  = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'yeori_edit_meta.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const generateFFmpeg = () => {
    if (!meta.length) { alert('癒쇱? ?몄쭛 硫뷀?瑜??앹꽦?댁＜?몄슂'); return }
    const lines = [
      '# ?쒖뿬由?FFmpeg ?몄쭛 ?먮룞???ㅽ겕由쏀듃',
      '# ?먯튃: ?뚯꽦 湲몄씠 = ?곸긽 湲몄씠 (?욌뮘 臾댁쓬?쇰줈 ?⑤뵫)',
      '# ?ㅽ뻾: PowerShell?먯꽌 .\yeori_ffmpeg.ps1',
      '',
      'New-Item -ItemType Directory -Force -Path "output_final" | Out-Null',
      '',
    ]

    meta.forEach(m => {
      const cutNum = m.cutNo
      const videoFile = 'cut_' + cutNum + '.mp4'
      const outFile = 'output_final\\C' + cutNum + '_final.mp4'
      const videoDur = parseFloat(m.duration)

      lines.push('# C' + cutNum + ' (' + videoDur + '珥?')

      if (m.sfxOnly || !m.audioFile) {
        lines.push('# ?뚯꽦 ?놁쓬 - ?④낵?뚮쭔')
        lines.push('ffmpeg -i "' + videoFile + '" -c:v copy -an "' + outFile + '" -y')
      } else {
        const audioDelay = parseFloat(m.audioStart) || 0
        const audioEnd = parseFloat(m.audioEnd) || videoDur
        const audioDuration = audioEnd - audioDelay
        const delayMs = Math.round(audioDelay * 1000)

        lines.push('# ?뚯꽦 ?쒖옉: +' + audioDelay + 's / ?? ' + audioEnd + 's / ?곸긽: ' + videoDur + 's')

        if (audioDelay > 0) {
          lines.push('ffmpeg -i "' + videoFile + '" -i "' + m.audioFile + '" `')
          lines.push('  -filter_complex "[1:a]atrim=duration=' + audioDuration + ',adelay=' + delayMs + '|' + delayMs + ',apad=whole_dur=' + videoDur + '[a]" `')
          lines.push('  -map 0:v -map "[a]" -t ' + videoDur + ' "' + outFile + '" -y')
        } else {
          lines.push('ffmpeg -i "' + videoFile + '" -i "' + m.audioFile + '" `')
          lines.push('  -filter_complex "[1:a]atrim=duration=' + audioDuration + ',apad=whole_dur=' + videoDur + '[a]" `')
          lines.push('  -map 0:v -map "[a]" -t ' + videoDur + ' "' + outFile + '" -y')
        }
      }
      lines.push('')
    })

    lines.push('Write-Host "???꾨즺! output_final ?대뜑 ?뺤씤?섏꽭??" -ForegroundColor Green')

    const script = lines.join('\n')
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'yeori_ffmpeg.ps1'; a.click()
    URL.revokeObjectURL(url)
  }

  const runFFmpegAuto = async () => {
    if (!meta.length) { alert('癒쇱? ?몄쭛 硫뷀?瑜??앹꽦?댁＜?몄슂'); return }
    setFfmpegRunning(true)
    setFfmpegProgress(null)
    setFfmpegResults([])
    setFfmpegError('')
    try {
      const res = await fetch('http://localhost:3001/api/ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta, workDir }),
      })
      if (!res.ok) {
        const err = await res.json()
        setFfmpegError(err.error || 'FFmpeg ?ㅽ뻾 ?ㅻ쪟')
        return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress')  setFfmpegProgress({ current: ev.current, total: ev.total, label: ev.label })
            if (ev.type === 'cut_done')  setFfmpegProgress(p => p ? { ...p, current: p.current } : p)
            if (ev.type === 'done')      setFfmpegResults(ev.results ?? [])
            if (ev.type === 'cut_error') setFfmpegError(p => p + `\nCUT ${ev.cutNo} ?ㅻ쪟 ??${ev.log}`)
            if (ev.type === 'error')     setFfmpegError(ev.message)
          } catch {}
        }
      }
    } catch (err) {
      setFfmpegError(err.message)
    } finally {
      setFfmpegRunning(false)
    }
  }

  const toggleHook = idx =>
    setHookIndices(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )

  const totalDur = meta.reduce((a,c) => a + c.duration, 0)

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>?몄쭛 硫뷀? ?먮룞 ?앹꽦</h2>
        <p className={styles.desc}>CUT蹂???꾩퐫?쑣룹쓬????대컢쨌FFmpeg ?ㅽ겕由쏀듃瑜??먮룞?쇰줈 ?앹꽦?⑸땲??/p>
      </div>

      {/* ??CUT 吏??*/}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>??CUT 吏??(?대┃?쇰줈 ?좉?)</div>
        <div className={styles.hookRow}>
          {cuts.map((cut, i) => (
            <span
              key={i}
              className={`${styles.cutTag} ${hookIndices.includes(i) ? styles.cutTagActive : ''}`}
              onClick={() => toggleHook(i)}
            >
              {cut.label || `CUT ${i+1}`}
            </span>
          ))}
        </div>
      </div>

      {/* ?뚯꽦 ??대컢 ?ㅼ젙 */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>而룸퀎 ?뚯꽦 ??대컢 ?ㅼ젙</div>
        <div className={styles.audioTable}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>CUT</th>
                <th className={styles.th}>?뚯꽦 ?뚯씪紐?/th>
                <th className={styles.th}>?쒖옉(珥?</th>
                <th className={styles.th}>??珥?</th>
                <th className={styles.th}>?④낵?뚮쭔</th>
                <th className={styles.th}>?먮쭑</th>
              </tr>
            </thead>
            <tbody>
              {cuts.map((cut, i) => (
                <tr key={i}>
                  <td className={styles.td}>{cut.label || `CUT ${i+1}`}</td>
                  <td className={styles.td}>
                    <input
                      type="text"
                      placeholder="ElevenLabs_04.mp3"
                      value={getAudio(i).audioFile}
                      onChange={e => setAudio(i, 'audioFile', e.target.value)}
                      style={{width:'160px', background:'#1c1c22', color:'#e8e6f0', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'4px', padding:'3px 6px', fontSize:'11px'}}
                    />
                  </td>
                  <td className={styles.td}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="0"
                      value={getAudio(i).audioStart}
                      onChange={e => setAudio(i, 'audioStart', e.target.value)}
                      style={{width:'60px', background:'#1c1c22', color:'#e8e6f0', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'4px', padding:'3px 6px', fontSize:'11px'}}
                    />
                  </td>
                  <td className={styles.td}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="?곸긽??
                      value={getAudio(i).audioEnd}
                      onChange={e => setAudio(i, 'audioEnd', e.target.value)}
                      style={{width:'60px', background:'#1c1c22', color:'#e8e6f0', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'4px', padding:'3px 6px', fontSize:'11px'}}
                    />
                  </td>
                  <td className={styles.td} style={{textAlign:'center'}}>
                    <input
                      type="checkbox"
                      checked={getAudio(i).sfxOnly}
                      onChange={e => setAudio(i, 'sfxOnly', e.target.checked)}
                    />
                  </td>
                  <td className={styles.td} style={{textAlign:'center'}}>
                    <input
                      type="checkbox"
                      checked={getAudio(i).hasSubtitle}
                      onChange={e => setAudio(i, 'hasSubtitle', e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button className={styles.genBtn} onClick={generate} disabled={loading}>
        {loading ? '硫뷀? ?앹꽦 以?..' : '?몄쭛 硫뷀? ?먮룞 ?앹꽦'}
      </button>

      {error && <div className={styles.error}>{error}</div>}

      {meta.length > 0 && (
        <>
          <div className={styles.statRow}>
            {[
              { label: '珥?湲몄씠', value: toTimecode(totalDur) },
              { label: 'CUT ??,  value: `${meta.length}媛? },
              { label: '??CUT', value: `${meta.filter(m => m.type === '??).length}媛? },
            ].map(s => (
              <div key={s.label} className={styles.statCard}>
                <div className={styles.statLabel}>{s.label}</div>
                <div className={styles.statValue}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {['CUT','援ш컙','湲몄씠','???,'?몃옖吏??,'?뚯꽦?뚯씪','?쒖옉','??,'硫붾え'].map(h => (
                    <th key={h} className={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meta.map((m, i) => (
                  <tr key={i} className={m.type === '?? ? styles.hookRow2 : ''}>
                    <td className={styles.td}>{m.label}</td>
                    <td className={`${styles.td} ${styles.mono}`}>{m.start} ~ {m.end}</td>
                    <td className={styles.td}>{m.duration}珥?/td>
                    <td className={styles.td}>
                      <span className={m.type === '?? ? styles.badgeHook : styles.badge}>{m.type}</span>
                    </td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.transition}</td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.audioFile || '-'}</td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.sfxOnly ? '?④낵?? : `+${m.audioStart}s`}</td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.sfxOnly ? '-' : `${m.audioEnd}s`}</td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {aiNote && (
            <div className={styles.aiNote}>
              <div className={styles.aiNoteLabel}>AI ?몄쭛 二쇱쓽?ы빆</div>
              <div className={styles.aiNoteText}>{aiNote}</div>
            </div>
          )}

          <div className={styles.exportRow}>
            <button className={styles.exportBtn} onClick={exportJSON}>JSON ?대낫?닿린</button>
            <button className={styles.exportBtn} onClick={exportCSV}>CSV ?대낫?닿린</button>
            <button className={styles.exportBtn} onClick={generateFFmpeg} style={{background:'#7c3aed', color:'#fff', borderColor:'#7c3aed'}}>
              ??FFmpeg ?ㅽ겕由쏀듃 ?앹꽦
            </button>
          </div>

          {/* ?? FFmpeg ?먮룞 ?ㅽ뻾 ?? */}
          <div style={{marginTop:'24px', padding:'16px', background:'rgba(124,58,237,0.08)', border:'1px solid rgba(124,58,237,0.25)', borderRadius:'8px'}}>
            <div style={{fontWeight:600, fontSize:'13px', color:'#c4b5fd', marginBottom:'10px'}}>??FFmpeg ?먮룞 ?ㅽ뻾</div>

            <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px'}}>
              <span style={{fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap'}}>?묒뾽 ?대뜑</span>
              <input
                type="text"
                value={workDir}
                onChange={e => setWorkDir(e.target.value)}
                placeholder="downloads/video/ep5"
                style={{flex:1, background:'#1c1c22', color:'#e8e6f0', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'4px', padding:'5px 8px', fontSize:'12px'}}
              />
            </div>

            <button
              onClick={runFFmpegAuto}
              disabled={ffmpegRunning}
              style={{background: ffmpegRunning ? '#4b4b5a' : '#7c3aed', color:'#fff', border:'none', borderRadius:'6px', padding:'8px 16px', fontSize:'13px', fontWeight:600, cursor: ffmpegRunning ? 'not-allowed' : 'pointer', width:'100%'}}
            >
              {ffmpegRunning ? '?ㅽ뻾 以?..' : '??FFmpeg ?먮룞 ?ㅽ뻾'}
            </button>

            {/* 吏꾪뻾瑜?諛?*/}
            {ffmpegRunning && ffmpegProgress && (
              <div style={{marginTop:'12px'}}>
                <div style={{fontSize:'12px', color:'#c4b5fd', marginBottom:'4px'}}>
                  CUT {ffmpegProgress.current}/{ffmpegProgress.total} ??{ffmpegProgress.label}
                </div>
                <div style={{background:'rgba(255,255,255,0.08)', borderRadius:'4px', height:'6px', overflow:'hidden'}}>
                  <div style={{
                    background:'#7c3aed',
                    height:'100%',
                    width: `${(ffmpegProgress.current / ffmpegProgress.total) * 100}%`,
                    transition:'width 0.3s ease',
                    borderRadius:'4px',
                  }} />
                </div>
              </div>
            )}

            {/* ?먮윭 */}
            {ffmpegError && (
              <div style={{marginTop:'10px', padding:'8px', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:'4px', fontSize:'11px', color:'#fca5a5', whiteSpace:'pre-wrap'}}>
                {ffmpegError}
              </div>
            )}

            {/* 寃곌낵 */}
            {ffmpegResults.length > 0 && (
              <div style={{marginTop:'12px'}}>
                <div style={{fontSize:'12px', color:'#86efac', marginBottom:'6px', fontWeight:600}}>
                  ???꾨즺 ??output_final ?대뜑 ?뺤씤
                </div>
                <div style={{display:'flex', flexWrap:'wrap', gap:'6px'}}>
                  {ffmpegResults.map(r => (
                    <span key={r.cutNo} style={{
                      fontSize:'11px', padding:'3px 8px', borderRadius:'4px',
                      background: r.status === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: r.status === 'ok' ? '#86efac' : '#fca5a5',
                      border: `1px solid ${r.status === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    }}>
                      {r.status === 'ok' ? '?? : '??} CUT {r.cutNo}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
