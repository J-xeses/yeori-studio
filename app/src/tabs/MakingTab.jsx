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

  const selectBrollCut = (cut) => {
    setSelectedBrollCutNo(cut.no)
    setBrollUrl('')
    setBrollTargetDuration(cut.duration || 5)
    setBrollResult(null)
  }

  const startBrollRecording = async () => {
    if (selectedBrollCutNo == null || !episode.number) return
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
                      <button className={s.captureBtn} disabled={brollBusy} onClick={startBrollRecording}>
                        {brollBusy ? '⏳' : '녹화 시작'}
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

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
