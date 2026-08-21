import { useState } from 'react'
import { useApp } from '../context/AppContext'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './MakingTab.module.css'

const YEORI_SERVER = 'http://localhost:3001'

const GRAPHIC_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1080px; height:1920px;
  background:#0a0a0a;
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  font-family:'Noto Sans KR', sans-serif;
  color:white;
}
.main-text {
  font-size:72px; font-weight:700;
  text-align:center; line-height:1.4;
  padding:0 80px;
}
.sub-text {
  font-size:42px; color:rgba(255,255,255,0.6);
  margin-top:40px; text-align:center;
  padding:0 80px;
}
</style>
</head>
<body>
<div class="main-text">{narration}</div>
<div class="sub-text">{scene}</div>
</body>
</html>`

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fillTemplate(cut) {
  return GRAPHIC_TEMPLATE
    .replace('{narration}', escapeHtml(cut.narration || cut.dialogue || ''))
    .replace('{scene}', escapeHtml(cut.scene || ''))
}

export default function MakingTab() {
  const { state } = useApp()
  const { episode, cuts } = state
  const graphicCuts = (cuts || []).filter(c => c.cutType === 'GRAPHIC')
  const brollCuts = (cuts || []).filter(c => c.cutType === 'BROLL')

  // ── 소스 검색(Pexels): BROLL/CAPCUT 컷에 쓸 영상/이미지 소재를 검색해 바로 다운로드.
  // 특정 컷타입에 종속되지 않는 범용 유틸이라 대상 컷은 자체 드롭다운으로 선택.
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceType, setSourceType] = useState('all')
  const [sourceOrientation, setSourceOrientation] = useState('portrait')
  const [sourceTargetCutNo, setSourceTargetCutNo] = useState(null)
  const [sourceSearching, setSourceSearching] = useState(false)
  const [sourceError, setSourceError] = useState(null)
  const [sourceResults, setSourceResults] = useState([])
  const [sourceDownloading, setSourceDownloading] = useState({})
  const [sourceDownloaded, setSourceDownloaded] = useState({})

  const searchSources = async () => {
    if (!sourceQuery.trim()) return
    setSourceSearching(true)
    setSourceError(null)
    setSourceResults([])
    try {
      const params = new URLSearchParams({
        q: sourceQuery, type: sourceType, orientation: sourceOrientation,
        page: '1', perPage: '15',
      })
      const res = await fetch(`${YEORI_SERVER}/api/source-search?${params}`)
      const data = await res.json()
      if (!res.ok) { setSourceError(data.error || '검색 실패'); return }
      setSourceResults(data.results || [])
    } catch (e) {
      setSourceError(`서버 연결 실패: ${e.message}`)
    } finally {
      setSourceSearching(false)
    }
  }

  const downloadSource = async (item) => {
    if (sourceTargetCutNo == null || !episode.number) return
    setSourceDownloading(prev => ({ ...prev, [item.id]: true }))
    try {
      const ext = item.type === 'video' ? 'mp4' : 'jpg'
      const filename = `${item.id}.${ext}`
      const res = await fetch(`${YEORI_SERVER}/api/source-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.downloadUrl, cutNo: sourceTargetCutNo, epNum: episode.number, filename }),
      })
      const data = await res.json()
      if (!res.ok) { setSourceDownloaded(prev => ({ ...prev, [item.id]: { error: data.error || '다운로드 실패' } })); return }
      setSourceDownloaded(prev => ({ ...prev, [item.id]: data }))
    } catch (e) {
      setSourceDownloaded(prev => ({ ...prev, [item.id]: { error: `서버 연결 실패: ${e.message}` } }))
    } finally {
      setSourceDownloading(prev => ({ ...prev, [item.id]: false }))
    }
  }

  const [selectedCutNo, setSelectedCutNo] = useState(null)
  const [htmlSource, setHtmlSource] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [duration, setDuration] = useState(5)
  const [capturing, setCapturing] = useState(false)
  const [captureResult, setCaptureResult] = useState(null)

  const selectCut = (cut) => {
    setSelectedCutNo(cut.no)
    setHtmlSource(fillTemplate(cut))
    setPreviewHtml('')
    setCaptureResult(null)
    setDuration(cut.duration || 5)
  }

  // ── BROLL: 특정 화면을 녹화 → 녹화 중지 즉시 자동으로 목표 길이 트림 + 1080x1920
  // 스케일/크롭해서 최종 컷 영상으로 확정(사용자 확정: "편집 과정도 사전 설정으로
  // 수동 없이 자동 진행"). raw 원본은 downloads/making/에 그대로 보관.
  const [selectedBrollCutNo, setSelectedBrollCutNo] = useState(null)
  const [brollUrl, setBrollUrl] = useState('')
  const [brollQuality, setBrollQuality] = useState('medium')
  const [brollRegionMode, setBrollRegionMode] = useState('full')
  const [brollRegion, setBrollRegion] = useState({ x: 0, y: 0, w: 1920, h: 1080 })
  const [brollTargetDuration, setBrollTargetDuration] = useState(5)
  const [brollTrimMode, setBrollTrimMode] = useState('end')
  const [brollRecording, setBrollRecording] = useState(false)
  const [brollBusy, setBrollBusy] = useState(false)
  const [brollResult, setBrollResult] = useState(null)
  const [brollCountdown, setBrollCountdown] = useState(null)

  const selectBrollCut = (cut) => {
    setSelectedBrollCutNo(cut.no)
    setBrollUrl('')
    setBrollTargetDuration(cut.duration || 5)
    setBrollResult(null)
  }

  // 전체화면 모드는 녹화가 시작되는 순간 화면 맨 위에 있는 창을 그대로 찍는다.
  // 버튼을 누른 직후엔 이 브라우저 탭 자체가 최상단이므로, 곧장 gdigrab을
  // 띄우면 사람이 대상 창으로 전환하기 전에 녹화가 시작돼버린다. 그래서
  // 실제 API 호출 전에 3초 카운트다운을 넣어 전환할 시간을 준다.
  const startBrollRecording = () => {
    if (selectedBrollCutNo == null || !episode.number || brollCountdown != null) return
    setBrollResult(null)
    setBrollCountdown(3)
    let remaining = 3
    const tick = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(tick)
        setBrollCountdown(null)
        doStartBrollRecording()
      } else {
        setBrollCountdown(remaining)
      }
    }, 1000)
  }

  const doStartBrollRecording = async () => {
    setBrollBusy(true)
    setBrollResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutNo: selectedBrollCutNo,
          options: { fps: 30, quality: brollQuality, region: brollRegionMode === 'custom' ? brollRegion : null },
          broll: { epNum: episode.number, targetDuration: brollTargetDuration, trimMode: brollTrimMode },
        }),
      })
      const data = await res.json()
      if (!res.ok) { setBrollResult({ error: data.error || '녹화 시작 실패' }); return }
      setBrollRecording(true)
    } catch (e) {
      setBrollResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setBrollBusy(false)
    }
  }

  const stopBrollRecording = async () => {
    setBrollBusy(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setBrollResult({ error: data.error || '녹화 종료 실패' }); return }
      setBrollResult(data)
    } catch (e) {
      setBrollResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setBrollRecording(false)
      setBrollBusy(false)
    }
  }

  // ── CAPCUT: CapCut 데스크톱 창을 자동 감지해 그 영역만 녹화 → BROLL과 동일한
  // editBrollRaw() 편집 파이프라인(트림+1080x1920 스케일)을 그대로 재사용.
  const capcutCuts = (cuts || []).filter(c => c.cutType === 'CAPCUT')
  const [selectedCapcutCutNo, setSelectedCapcutCutNo] = useState(null)
  const [capcutStatus, setCapcutStatus] = useState(null)
  const [capcutChecking, setCapcutChecking] = useState(false)
  const [capcutTargetDuration, setCapcutTargetDuration] = useState(5)
  const [capcutTrimMode, setCapcutTrimMode] = useState('end')
  const [capcutRecording, setCapcutRecording] = useState(false)
  const [capcutBusy, setCapcutBusy] = useState(false)
  const [capcutResult, setCapcutResult] = useState(null)

  const selectCapcutCut = (cut) => {
    setSelectedCapcutCutNo(cut.no)
    setCapcutTargetDuration(cut.duration || 5)
    setCapcutResult(null)
    setCapcutStatus(null)
  }

  const checkCapcutWindow = async () => {
    setCapcutChecking(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/capcut-window`)
      const data = await res.json()
      setCapcutStatus(data)
    } catch (e) {
      setCapcutStatus({ running: false, error: e.message })
    } finally {
      setCapcutChecking(false)
    }
  }

  const startCapcutRecording = async () => {
    if (selectedCapcutCutNo == null || !episode.number) return
    setCapcutBusy(true)
    setCapcutResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutNo: selectedCapcutCutNo,
          options: { fps: 30, quality: 'medium' },
          capcut: { epNum: episode.number, targetDuration: capcutTargetDuration, trimMode: capcutTrimMode },
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCapcutResult({ error: data.error || '녹화 시작 실패' }); return }
      setCapcutRecording(true)
    } catch (e) {
      setCapcutResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapcutBusy(false)
    }
  }

  const stopCapcutRecording = async () => {
    setCapcutBusy(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setCapcutResult({ error: data.error || '녹화 종료 실패' }); return }
      setCapcutResult(data)
    } catch (e) {
      setCapcutResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapcutRecording(false)
      setCapcutBusy(false)
    }
  }

  const captureGraphic = async () => {
    if (selectedCutNo == null || !episode.number) return
    setCapturing(true)
    setCaptureResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/graphic-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlSource, cutNo: selectedCutNo, epNum: episode.number, duration }),
      })
      const data = await res.json()
      if (!res.ok) { setCaptureResult({ error: data.error || '캡처 실패' }); return }
      setCaptureResult(data)
    } catch (e) {
      setCaptureResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setCapturing(false)
    }
  }

  // ── G5-M: 컷 번호 순서대로 확정된 cut_{NN}.mp4(컷타입 무관, BROLL/CAPCUT/GRAPHIC이
  // 자동편집으로 만든 것이든 YEORI의 기존 파일이든 전부 downloads/video/ep{N}/에
  // 모여 있어 그대로 이어붙이면 됨)를 메이킹 필름 하나로 조립.
  const [assembling, setAssembling] = useState(false)
  const [assembleResult, setAssembleResult] = useState(null)

  const assembleMaking = async () => {
    setAssembling(true)
    setAssembleResult(null)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/making-assemble`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(episode.number ? { epNum: episode.number } : {}),
      })
      const data = await res.json()
      if (!res.ok) { setAssembleResult({ error: data.error || '조립 실패' }); return }
      setAssembleResult(data)
    } catch (e) {
      setAssembleResult({ error: `서버 연결 실패: ${e.message}` })
    } finally {
      setAssembling(false)
    }
  }

  return (
    <div className={s.page}>
      <TabToolbar />
      <div className={s.root}>
        <EpisodeInfoSidebar />
        <div className={s.main}>
          <div className={s.scrollBody}>
            <div className={s.content}>

              <div className={s.header}>
                <div>
                  <div className={s.title}>메이킹</div>
                  <div className={s.subtitle}>
                    G2~G5 파이프라인이 자동 생성하지 않는 컷타입(BROLL/GRAPHIC 등)의 실제 영상을 여기서 제작합니다.
                  </div>
                </div>
              </div>

              <div className={s.card}>
                <div className={s.cardTitle}>소스 검색 (Pexels)</div>
                <div className={s.settingRow}>
                  <div className={s.settingGroup}>
                    <div className={s.settingLabel}>검색어</div>
                    <div className={s.urlRow}>
                      <input className={s.urlInput} value={sourceQuery} placeholder="예: slot machine lever"
                        onChange={e => setSourceQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchSources()} />
                      <button className={s.previewBtn} disabled={sourceSearching || !sourceQuery.trim()} onClick={searchSources}>
                        {sourceSearching ? '⏳' : '검색'}
                      </button>
                    </div>
                  </div>

                  <div className={s.settingGroup}>
                    <div className={s.settingLabel}>유형</div>
                    <div className={s.radioRow}>
                      {[['all', '전체'], ['video', '영상'], ['image', '이미지']].map(([v, l]) => (
                        <label key={v} className={s.radioLabel}>
                          <input type="radio" name="source-type" value={v}
                            checked={sourceType === v} onChange={() => setSourceType(v)} />
                          {l}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className={s.settingGroup}>
                    <div className={s.settingLabel}>방향</div>
                    <div className={s.radioRow}>
                      {[['portrait', '세로우선'], ['landscape', '가로'], ['all', '전체']].map(([v, l]) => (
                        <label key={v} className={s.radioLabel}>
                          <input type="radio" name="source-orientation" value={v}
                            checked={sourceOrientation === v} onChange={() => setSourceOrientation(v)} />
                          {l}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className={s.settingGroup}>
                    <div className={s.settingLabel}>대상 컷</div>
                    <select className={s.stageSelect} value={sourceTargetCutNo ?? ''}
                      onChange={e => setSourceTargetCutNo(e.target.value ? parseInt(e.target.value) : null)}>
                      <option value="">선택 안 함</option>
                      {(cuts || []).map(c => <option key={c.id} value={c.no}>#{c.no}</option>)}
                    </select>
                  </div>
                </div>

                {sourceError && <div className={s.resultError}>❌ {sourceError}</div>}

                {sourceResults.length > 0 && (
                  <div className={s.sourceGrid}>
                    {sourceResults.map(item => {
                      const dl = sourceDownloaded[item.id]
                      const downloading = sourceDownloading[item.id]
                      return (
                        <div key={item.id} className={s.sourceCard}>
                          <img src={item.thumbnail} alt={item.title} className={s.sourceThumb} loading="lazy" />
                          <div className={s.sourceMeta}>
                            <span className={s.sourcePhotographer}>{item.photographer || '작자 미상'}</span>
                            {item.type === 'video' && <span className={s.sourceDuration}>{item.duration}초</span>}
                          </div>
                          <button className={s.previewBtn} disabled={downloading || sourceTargetCutNo == null}
                            onClick={() => downloadSource(item)}>
                            {downloading ? '⏳' : dl?.success ? '저장됨 ✅' : '다운로드'}
                          </button>
                          {dl?.error && <div className={s.resultError}>❌ {dl.error}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className={s.pexelsCredit}>
                  Photos provided by <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>
                </div>
              </div>

              <div className={s.card}>
                <div className={s.cardTitle}>BROLL 컷 목록</div>
                {!brollCuts.length ? (
                  <div className={s.emptyHint}>활성 에피소드에 BROLL 타입 컷이 없습니다.</div>
                ) : (
                  <div className={s.cutList}>
                    {brollCuts.map(cut => (
                      <button key={cut.id}
                        className={`${s.cutListItem} ${selectedBrollCutNo === cut.no ? s.cutListItemActive : ''}`}
                        onClick={() => selectBrollCut(cut)}>
                        <span className={s.cutNo}>#{cut.no}</span>
                        <span className={s.cutSummary}>{cut.scene || '(내용 없음)'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedBrollCutNo != null && (
                <div className={s.card}>
                  <div className={s.cardTitle}>#{selectedBrollCutNo} 녹화 설정</div>

                  <div className={s.settingRow}>
                    <div className={s.settingGroup}>
                      <div className={s.settingLabel}>URL(선택)</div>
                      <div className={s.urlRow}>
                        <input className={s.urlInput} value={brollUrl} placeholder="https://..."
                          onChange={e => setBrollUrl(e.target.value)} />
                        <button className={s.previewBtn} disabled={!brollUrl}
                          onClick={() => window.open(brollUrl, '_blank', 'noopener,noreferrer')}>열기</button>
                      </div>
                    </div>

                    <div className={s.settingGroup}>
                      <div className={s.settingLabel}>녹화 품질</div>
                      <div className={s.radioRow}>
                        {['low', 'medium', 'high'].map(q => (
                          <label key={q} className={s.radioLabel}>
                            <input type="radio" name="broll-quality" value={q}
                              checked={brollQuality === q} onChange={() => setBrollQuality(q)} disabled={brollRecording} />
                            {q}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={s.settingRow}>
                    <div className={s.settingGroup}>
                      <div className={s.settingLabel}>녹화 영역</div>
                      <div className={s.radioRow}>
                        <label className={s.radioLabel}>
                          <input type="radio" name="broll-region" value="full"
                            checked={brollRegionMode === 'full'} onChange={() => setBrollRegionMode('full')} disabled={brollRecording} />
                          전체화면
                        </label>
                        <label className={s.radioLabel}>
                          <input type="radio" name="broll-region" value="custom"
                            checked={brollRegionMode === 'custom'} onChange={() => setBrollRegionMode('custom')} disabled={brollRecording} />
                          특정영역
                        </label>
                        {brollRegionMode === 'custom' && (
                          <div className={s.regionInputs}>
                            {['x', 'y', 'w', 'h'].map(k => (
                              <label key={k} className={s.regionField}>
                                {k}
                                <input type="number" value={brollRegion[k]} disabled={brollRecording}
                                  onChange={e => setBrollRegion(prev => ({ ...prev, [k]: parseInt(e.target.value) || 0 }))} />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {brollRegionMode === 'full' && (
                        <div className={s.emptyHint}>
                          녹화 시작을 누르면 3초 뒤에 실제로 녹화가 시작됩니다 — 그 사이 대상 화면으로 전환하세요.
                        </div>
                      )}
                    </div>

                    <div className={s.settingGroup}>
                      <div className={s.settingLabel}>목표 길이(초) / 트림 위치</div>
                      <div className={s.radioRow}>
                        <input type="number" min="1" value={brollTargetDuration} disabled={brollRecording}
                          onChange={e => setBrollTargetDuration(parseInt(e.target.value) || 1)}
                          className={s.durationInput} />
                        <label className={s.radioLabel}>
                          <input type="radio" name="broll-trim" value="end"
                            checked={brollTrimMode === 'end'} onChange={() => setBrollTrimMode('end')} disabled={brollRecording} />
                          끝에서부터
                        </label>
                        <label className={s.radioLabel}>
                          <input type="radio" name="broll-trim" value="start"
                            checked={brollTrimMode === 'start'} onChange={() => setBrollTrimMode('start')} disabled={brollRecording} />
                          처음부터
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className={s.editorActions}>
                    {!brollRecording ? (
                      <button className={s.captureBtn} disabled={brollBusy || brollCountdown != null} onClick={startBrollRecording}>
                        {brollCountdown != null ? `${brollCountdown}초 후 시작…` : brollBusy ? '⏳' : '녹화 시작'}
                      </button>
                    ) : (
                      <button className={s.stopBtn} disabled={brollBusy} onClick={stopBrollRecording}>
                        🔴 녹화 중... 중지
                      </button>
                    )}
                  </div>

                  {brollResult && (
                    brollResult.error ? (
                      <div className={s.resultError}>❌ {brollResult.error}</div>
                    ) : (
                      <div className={s.resultOk}>
                        ✅ 편집 완료 — 최종: {brollResult.finalPath} ({(brollResult.finalSizeBytes / 1024 / 1024).toFixed(1)}MB, {brollResult.finalDuration?.toFixed?.(1) ?? brollResult.finalDuration}초)
                        <br />원본(raw, 보관됨): {brollResult.rawPath} ({(brollResult.rawSizeBytes / 1024 / 1024).toFixed(1)}MB, {brollResult.rawDuration?.toFixed(1)}초)
                      </div>
                    )
                  )}
                </div>
              )}

              <div className={s.card}>
                <div className={s.cardTitle}>CAPCUT 컷 목록</div>
                {!capcutCuts.length ? (
                  <div className={s.emptyHint}>활성 에피소드에 CAPCUT 타입 컷이 없습니다.</div>
                ) : (
                  <div className={s.cutList}>
                    {capcutCuts.map(cut => (
                      <button key={cut.id}
                        className={`${s.cutListItem} ${selectedCapcutCutNo === cut.no ? s.cutListItemActive : ''}`}
                        onClick={() => selectCapcutCut(cut)}>
                        <span className={s.cutNo}>#{cut.no}</span>
                        <span className={s.cutSummary}>{cut.scene || '(내용 없음)'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedCapcutCutNo != null && (
                <div className={s.card}>
                  <div className={s.cardTitle}>#{selectedCapcutCutNo} CapCut 녹화 설정</div>

                  <div className={s.editorActions}>
                    <button className={s.previewBtn} disabled={capcutChecking} onClick={checkCapcutWindow}>
                      {capcutChecking ? '⏳ 확인 중…' : 'CapCut 상태 확인'}
                    </button>
                  </div>

                  {capcutStatus && (
                    capcutStatus.running ? (
                      <div className={s.resultOk}>
                        ✅ 실행 중 — {capcutStatus.windowTitle || 'CapCut'} (PID {capcutStatus.pid}, 창 {capcutStatus.region?.w}×{capcutStatus.region?.h})
                      </div>
                    ) : (
                      <div className={s.resultError}>⚠️ CapCut을 먼저 실행해주세요.</div>
                    )
                  )}

                  {capcutStatus?.running && (
                    <>
                      <div className={s.settingRow}>
                        <div className={s.settingGroup}>
                          <div className={s.settingLabel}>목표 길이(초) / 트림 위치</div>
                          <div className={s.radioRow}>
                            <input type="number" min="1" value={capcutTargetDuration} disabled={capcutRecording}
                              onChange={e => setCapcutTargetDuration(parseInt(e.target.value) || 1)}
                              className={s.durationInput} />
                            <label className={s.radioLabel}>
                              <input type="radio" name="capcut-trim" value="end"
                                checked={capcutTrimMode === 'end'} onChange={() => setCapcutTrimMode('end')} disabled={capcutRecording} />
                              끝에서부터
                            </label>
                            <label className={s.radioLabel}>
                              <input type="radio" name="capcut-trim" value="start"
                                checked={capcutTrimMode === 'start'} onChange={() => setCapcutTrimMode('start')} disabled={capcutRecording} />
                              처음부터
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className={s.editorActions}>
                        {!capcutRecording ? (
                          <button className={s.captureBtn} disabled={capcutBusy} onClick={startCapcutRecording}>
                            {capcutBusy ? '⏳' : '녹화 시작'}
                          </button>
                        ) : (
                          <button className={s.stopBtn} disabled={capcutBusy} onClick={stopCapcutRecording}>
                            🔴 녹화 중... 중지
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {capcutResult && (
                    capcutResult.error ? (
                      <div className={s.resultError}>❌ {capcutResult.error}</div>
                    ) : (
                      <div className={s.resultOk}>
                        ✅ 편집 완료 — 최종: {capcutResult.finalPath} ({(capcutResult.finalSizeBytes / 1024 / 1024).toFixed(1)}MB, {capcutResult.finalDuration?.toFixed?.(1) ?? capcutResult.finalDuration}초)
                        <br />원본(raw, 보관됨): {capcutResult.rawPath} ({(capcutResult.rawSizeBytes / 1024 / 1024).toFixed(1)}MB, {capcutResult.rawDuration?.toFixed(1)}초)
                      </div>
                    )
                  )}
                </div>
              )}

              <div className={s.card}>
                <div className={s.cardTitle}>GRAPHIC 컷 목록</div>
                {!graphicCuts.length ? (
                  <div className={s.emptyHint}>활성 에피소드에 GRAPHIC 타입 컷이 없습니다.</div>
                ) : (
                  <div className={s.cutList}>
                    {graphicCuts.map(cut => (
                      <button key={cut.id}
                        className={`${s.cutListItem} ${selectedCutNo === cut.no ? s.cutListItemActive : ''}`}
                        onClick={() => selectCut(cut)}>
                        <span className={s.cutNo}>#{cut.no}</span>
                        <span className={s.cutSummary}>{cut.narration || cut.dialogue || cut.scene || '(내용 없음)'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedCutNo != null && (
                <div className={s.card}>
                  <div className={s.cardTitle}>#{selectedCutNo} HTML 소스</div>
                  <textarea
                    className={s.htmlEditor}
                    value={htmlSource}
                    onChange={e => setHtmlSource(e.target.value)}
                    spellCheck={false}
                  />

                  <div className={s.editorActions}>
                    <label className={s.durationField}>
                      길이(초)
                      <input type="number" min="1" value={duration}
                        onChange={e => setDuration(parseInt(e.target.value) || 1)} />
                    </label>
                    <button className={s.previewBtn} onClick={() => setPreviewHtml(htmlSource)}>미리보기</button>
                    <button className={s.captureBtn} disabled={capturing} onClick={captureGraphic}>
                      {capturing ? '⏳ 캡처 중…' : '캡처 & 저장'}
                    </button>
                  </div>

                  {previewHtml && (
                    <div className={s.previewWrap}>
                      <div className={s.previewBox}>
                        <iframe title="graphic-preview" srcDoc={previewHtml} className={s.previewFrame} />
                      </div>
                    </div>
                  )}

                  {captureResult && (
                    captureResult.error ? (
                      <div className={s.resultError}>❌ {captureResult.error}</div>
                    ) : (
                      <div className={s.resultOk}>
                        ✅ 저장됨 — 이미지: {captureResult.imagePath} · 영상: {captureResult.videoPath}
                      </div>
                    )
                  )}
                </div>
              )}

              <div className={s.card}>
                <div className={s.cardTitle}>메이킹 필름 조립 (G5-M)</div>
                <div className={s.emptyHint}>
                  위에서 확정한 BROLL/CAPCUT/GRAPHIC 컷 영상 + 기존 YEORI 컷 영상을 컷 번호 순서대로 이어붙입니다.
                </div>
                <div className={s.editorActions}>
                  <button className={s.captureBtn} disabled={assembling} onClick={assembleMaking}>
                    {assembling ? '⏳ 조립 중…' : '🎬 메이킹 필름 조립'}
                  </button>
                </div>
                {assembleResult && (
                  assembleResult.error ? (
                    <div className={s.resultError}>❌ {assembleResult.error}</div>
                  ) : (
                    <div className={s.resultOk}>
                      ✅ 조립 완료 — 포함 {assembleResult.includedCuts.length}컷(#{assembleResult.includedCuts.join(', #')})
                      {assembleResult.skippedCuts.length > 0 && <> · 스킵 {assembleResult.skippedCuts.length}컷(#{assembleResult.skippedCuts.join(', #')})</>}
                      {' '}· 총 {assembleResult.duration?.toFixed?.(1) ?? assembleResult.duration}초
                      <br />출력: {assembleResult.outputPath}
                    </div>
                  )
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
