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
                  <div className={s.title}>메이킹 — GRAPHIC 편집기</div>
                  <div className={s.subtitle}>
                    G2~G5 파이프라인이 자동 생성하지 않는 GRAPHIC 컷을 HTML로 직접 제작합니다.
                    미리보기로 확인 후 캡처하면 정지화면이 그 컷의 mp4로 저장됩니다.
                  </div>
                </div>
              </div>

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
