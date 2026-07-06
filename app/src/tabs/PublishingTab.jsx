import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import s from './PublishingTab.module.css'

const SERVER = 'http://localhost:3001'
const SECTIONS = [
  { key: 'thumb',   label: '① 썸네일' },
  { key: 'meta',    label: '② 제목/설명/태그' },
  { key: 'package', label: '③ 결과물 패키징' },
  { key: 'upload',  label: '④ 업로드' },
]

// ── ① 썸네일 섹션 (기존 캔버스 편집기 + 스튜디오 이미지 불러오기 + 서버 저장) ──
function ThumbnailSection({ epNum }) {
  const { state, dispatch } = useApp()
  const { thumbnail } = state
  const canvasRef = useRef(null)
  const bgRef = useRef(null)
  const fileRef = useRef(null)
  const [bgImage, setBgImage] = useState(null)
  const [studioImages, setStudioImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)
  const [saveStatus, setSaveStatus] = useState('')

  const set = (p) => dispatch({ type: 'SET_THUMB', p })

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, W, H)
    } else {
      const grad = ctx.createLinearGradient(0, 0, W, H)
      grad.addColorStop(0, '#1a0a2e'); grad.addColorStop(1, '#0a0a1f')
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(124,58,237,.06)'; ctx.fillRect(0, 0, W, H)
    }
    if (thumbnail.text) {
      const overlay = ctx.createLinearGradient(0, H * 0.5, 0, H)
      overlay.addColorStop(0, 'rgba(0,0,0,0)'); overlay.addColorStop(1, 'rgba(0,0,0,0.75)')
      ctx.fillStyle = overlay; ctx.fillRect(0, 0, W, H)
    }
    if (thumbnail.text) {
      const lines = thumbnail.text.split('\n')
      const fSize = thumbnail.fontSize || 48
      ctx.font = `${thumbnail.bold ? 'bold ' : ''}${fSize}px ${'"Apple SD Gothic Neo"'},sans-serif`
      ctx.textAlign = 'center'
      ctx.shadowColor = '#000'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2
      ctx.fillStyle = thumbnail.color || '#ffffff'
      const yBase = H * ((thumbnail.textY || 70) / 100)
      const lineH = fSize * 1.3
      const totalH = lines.length * lineH
      lines.forEach((line, i) => {
        const y = yBase - totalH / 2 + i * lineH + fSize / 2
        ctx.fillText(line, W / 2, y)
      })
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
    }
    ctx.fillStyle = 'rgba(167,139,250,.25)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText('여리 Studio', W - 12, H - 10)
  }, [bgImage, thumbnail])

  useEffect(() => { draw() }, [draw])

  const handleBgUpload = (file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image(); img.src = url
    img.onload = () => { bgRef.current = img; setBgImage(img) }
  }

  const downloadPNG = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a'); a.href = url; a.download = 'thumbnail.png'; a.click()
  }

  // 스튜디오 탭에서 생성된 현재 에피소드 이미지 목록 불러오기
  const loadStudioImages = async () => {
    if (!epNum) return
    try {
      const res = await fetch(`${SERVER}/api/scan-media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum }),
      })
      const data = await res.json()
      const urls = Object.entries(data.images || {}).map(([key, absPath]) => ({
        key,
        url: `${SERVER}/downloads/${absPath.replace(/.*downloads[\\/]/i, '').replace(/\\/g, '/')}`,
      }))
      setStudioImages(urls)
    } catch {
      setStudioImages([])
    } finally {
      setLoadingImages(false)
    }
  }

  useEffect(() => {
    if (!epNum) return
    fetch(`${SERVER}/api/scan-media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum }),
    })
      .then(r => r.json())
      .then(data => {
        const urls = Object.entries(data.images || {}).map(([key, absPath]) => ({
          key,
          url: `${SERVER}/downloads/${absPath.replace(/.*downloads[\\/]/i, '').replace(/\\/g, '/')}`,
        }))
        setStudioImages(urls)
      })
      .catch(() => setStudioImages([]))
      .finally(() => setLoadingImages(false))
  }, [epNum])

  const pickStudioImage = (url) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // 캔버스 toDataURL 시 오염 방지
    img.src = url
    img.onload = () => { bgRef.current = img; setBgImage(img) }
  }

  const saveThumbnail = async () => {
    const canvas = canvasRef.current; if (!canvas || !epNum) return
    setSaveStatus('저장 중...')
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const res = await fetch(`${SERVER}/api/save-thumbnail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, dataUrl }),
      })
      const data = await res.json()
      setSaveStatus(data.success ? `✅ 저장 완료 → ${data.path}` : `❌ ${data.error}`)
    } catch (err) {
      setSaveStatus(`❌ 오류: ${err.message}`)
    }
  }

  return (
    <div className={s.root}>
      <div className={s.left}>
        <div className={s.panel}>
          <div className={s.panelTitle}>썸네일 텍스트</div>
          <textarea className={s.textInput} rows={3}
            placeholder={'첫 줄 텍스트\n둘째 줄 텍스트'}
            value={thumbnail.text || ''}
            onChange={e => set({ text: e.target.value })} />
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>스튜디오 이미지 불러오기 (EP{epNum || '-'})</span>
            <button className={s.refreshBtn} onClick={() => { setLoadingImages(true); loadStudioImages() }}>{loadingImages ? '...' : '↻'}</button>
          </div>
          {studioImages.length > 0 ? (
            <div className={s.studioImgGrid}>
              {studioImages.map(img => (
                <div key={img.key} className={s.studioImgItem} onClick={() => pickStudioImage(img.url)} title={img.key}>
                  <img src={img.url} alt={img.key} />
                </div>
              ))}
            </div>
          ) : (
            <div className={s.studioImgEmpty}>{loadingImages ? '불러오는 중...' : '스튜디오 탭에서 생성된 이미지가 없습니다'}</div>
          )}
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>배경 이미지 (직접 업로드)</div>
          <div className={s.bgArea} onClick={() => fileRef.current?.click()}>
            {bgImage ? (
              <div className={s.bgLoaded}>
                <span>✓ 이미지 로드됨</span>
                <button className={s.removeBg} onClick={e => { e.stopPropagation(); setBgImage(null) }}>제거</button>
              </div>
            ) : (
              <div className={s.bgPlaceholder}>
                <span>🖼️</span>
                <span>배경 이미지 업로드</span>
                <span className={s.bgSub}>JPG · PNG · WEBP</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => handleBgUpload(e.target.files[0])} />
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>텍스트 설정</div>
          <div className={s.fields}>
            <div className={s.field}>
              <label>글자 크기 <span className={s.val}>{thumbnail.fontSize || 48}px</span></label>
              <input type="range" min="20" max="120" value={thumbnail.fontSize || 48}
                onChange={e => set({ fontSize: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label>글자 색상</label>
              <div className={s.colorRow}>
                <input type="color" className={s.colorPicker}
                  value={thumbnail.color || '#ffffff'}
                  onChange={e => set({ color: e.target.value })} />
                <span className={s.colorVal}>{thumbnail.color || '#ffffff'}</span>
              </div>
            </div>
            <div className={s.field}>
              <label>텍스트 위치 (세로) <span className={s.val}>{thumbnail.textY || 70}%</span></label>
              <input type="range" min="10" max="95" value={thumbnail.textY || 70}
                onChange={e => set({ textY: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={thumbnail.bold !== false}
                  onChange={e => set({ bold: e.target.checked })} />
                굵게 (Bold)
              </label>
            </div>
          </div>
        </div>

        <button className={s.downloadBtn} onClick={downloadPNG}>
          ⬇ PNG 다운로드 (1280×720)
        </button>
        <button className={s.downloadBtn} onClick={saveThumbnail} style={{ background: '#059669' }}>
          💾 thumb.jpg로 서버 저장
        </button>
        {saveStatus && <div style={{ fontSize: 11.5, color: saveStatus.startsWith('❌') ? '#f87171' : '#4ade80' }}>{saveStatus}</div>}
      </div>

      <div className={s.right}>
        <div className={s.previewHeader}>
          <span>썸네일 미리보기</span>
          <span className={s.size}>1280 × 720</span>
        </div>
        <div className={s.canvasWrap}>
          <canvas ref={canvasRef} width={1280} height={720} className={s.canvas} />
        </div>
      </div>
    </div>
  )
}

// ── ② 제목/설명/태그 섹션 (Claude 자동 생성 + 플랫폼별 수동 편집) ──
function MetaSection() {
  const { state, dispatch } = useApp()
  const { publishing, scriptRaw, episode, apiKeys } = state
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  const setPlatform = (platform, p) => dispatch({ type: 'SET_PUBLISHING', platform, p })

  const generate = async () => {
    const apiKey = apiKeys?.claude || ''
    if (!apiKey) { setGenError('상단 API 바에서 Claude 키를 입력하세요.'); return }
    if (!scriptRaw?.trim()) { setGenError('대본이 없습니다. 대본 생성 탭에서 먼저 대본을 작성하세요.'); return }
    setGenerating(true); setGenError('')
    try {
      const data = await claudeMessages(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `아래는 유튜브 쇼츠/릴스용 영상 대본이다. 이 내용을 바탕으로 유튜브, 인스타그램, 틱톡 각 플랫폼에 맞는 제목/설명/태그를 만들어줘.

제목: ${episode?.title || '(제목 없음)'}
대본:
${scriptRaw.slice(0, 3000)}

반드시 아래 JSON 형식으로만, 다른 설명 없이 응답해:
{
  "youtube":   { "title": "...", "description": "...", "tags": "쉼표로 구분된 태그" },
  "instagram": { "title": "...", "description": "...", "tags": "#해시태그 형식" },
  "tiktok":    { "title": "...", "description": "...", "tags": "#해시태그 형식" }
}`,
        }],
      }).then(r => r.json())

      const text = data.content?.map(b => b.text || '').join('') || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다')
      const parsed = JSON.parse(jsonMatch[0])
      for (const platform of ['youtube', 'instagram', 'tiktok']) {
        if (parsed[platform]) setPlatform(platform, parsed[platform])
      }
    } catch (err) {
      setGenError('생성 오류: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  const platforms = [
    { key: 'youtube',   label: '📺 YouTube' },
    { key: 'instagram', label: '📸 Instagram' },
    { key: 'tiktok',    label: '🎵 TikTok' },
  ]

  return (
    <div className={s.metaWrap}>
      <button className={s.genBtn} onClick={generate} disabled={generating}>
        {generating ? '⏳ 생성 중...' : '✨ AI 자동 생성 (대본 기반)'}
      </button>
      {genError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12, marginTop: -8 }}>{genError}</div>}

      <div className={s.platformGrid}>
        {platforms.map(pf => {
          const v = publishing?.[pf.key] || { title: '', description: '', tags: '' }
          return (
            <div key={pf.key} className={s.platformCard}>
              <div className={s.platformTitle}>{pf.label}</div>
              <div className={s.metaField}>
                <label>제목</label>
                <input value={v.title} onChange={e => setPlatform(pf.key, { title: e.target.value })} />
              </div>
              <div className={s.metaField}>
                <label>설명</label>
                <textarea value={v.description} onChange={e => setPlatform(pf.key, { description: e.target.value })} />
              </div>
              <div className={s.metaField}>
                <label>태그</label>
                <textarea style={{ minHeight: 44 }} value={v.tags} onChange={e => setPlatform(pf.key, { tags: e.target.value })} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── ③ 결과물 패키징 섹션 ──
function PackageSection({ epNum }) {
  const [checking, setChecking] = useState(true)
  const [assets, setAssets] = useState(null)
  const [packaging, setPackaging] = useState(false)
  const [packageResult, setPackageResult] = useState(null)
  const [error, setError] = useState('')

  const checkAssets = async () => {
    if (!epNum) return
    try {
      const res = await fetch(`${SERVER}/api/check-final-assets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum }),
      })
      setAssets(await res.json())
      setError('')
      setPackageResult(null)
    } catch (err) {
      setError('확인 오류: ' + err.message)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (!epNum) return
    fetch(`${SERVER}/api/check-final-assets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum }),
    })
      .then(r => r.json())
      .then(data => { setAssets(data); setError(''); setPackageResult(null) })
      .catch(err => setError('확인 오류: ' + err.message))
      .finally(() => setChecking(false))
  }, [epNum])

  const runPackage = async () => {
    if (!epNum) return
    setPackaging(true); setError(''); setPackageResult(null)
    try {
      const res = await fetch(`${SERVER}/api/package-final`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum }),
      })
      const data = await res.json()
      if (!data.success) { setError(data.error || '패키징 실패'); return }
      setPackageResult(data)
      checkAssets()
    } catch (err) {
      setError('패키징 오류: ' + err.message)
    } finally {
      setPackaging(false)
    }
  }

  return (
    <div className={s.packageWrap}>
      <div className={s.checkRow}>
        <span className={`${s.checkIcon} ${assets?.videoExists ? s.checkOk : s.checkFail}`}>
          {assets?.videoExists ? '✅' : '❌'}
        </span>
        <span>ep{epNum}_final.mp4 (편집 완료 영상)</span>
        <span className={s.checkPath}>{assets?.videoPath || ''}</span>
      </div>
      <div className={s.checkRow}>
        <span className={`${s.checkIcon} ${assets?.thumbExists ? s.checkOk : s.checkFail}`}>
          {assets?.thumbExists ? '✅' : '❌'}
        </span>
        <span>thumb.jpg (썸네일)</span>
        <span className={s.checkPath}>{assets?.thumbPath || ''}</span>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className={s.refreshBtn} onClick={() => { setChecking(true); checkAssets() }}>{checking ? '확인 중...' : '↻ 다시 확인'}</button>
        <button className={s.packageBtn} onClick={runPackage} disabled={packaging || !assets?.videoExists}>
          {packaging ? '⏳ 패키징 중...' : '📦 downloads/final/ 로 패키징'}
        </button>
      </div>

      {packageResult && (
        <div className={s.packageResult}>
          ✅ 패키징 완료 → {packageResult.finalDir}
          <br />영상: {packageResult.files.video}
          {packageResult.files.thumb && <><br />썸네일: {packageResult.files.thumb}</>}
        </div>
      )}
    </div>
  )
}

// ── ④ 업로드 섹션 (UI만, 미구현) ──
function UploadSection() {
  const platforms = [
    { key: 'youtube',   label: '📺 YouTube 업로드' },
    { key: 'instagram', label: '📸 Instagram 업로드' },
    { key: 'tiktok',    label: '🎵 TikTok 업로드' },
  ]
  return (
    <div className={s.uploadWrap}>
      {platforms.map(pf => (
        <div key={pf.key} className={s.uploadRow}>
          <span className={s.uploadPlatform}>{pf.label}</span>
          <button className={s.uploadBtn} disabled title="준비 중 (API 연동 미구현)">준비 중</button>
        </div>
      ))}
    </div>
  )
}

export default function PublishingTab() {
  const { state } = useApp()
  const epNum = state.episode?.number
  const [activeSection, setActiveSection] = useState('thumb')

  return (
    <div className={s.page}>
      <div className={s.sectionTabs}>
        {SECTIONS.map(sec => (
          <button key={sec.key}
            className={`${s.sectionTab} ${activeSection === sec.key ? s.sectionTabActive : ''}`}
            onClick={() => setActiveSection(sec.key)}>
            {sec.label}
          </button>
        ))}
      </div>
      <div className={s.sectionBody}>
        {activeSection === 'thumb' && <ThumbnailSection epNum={epNum} />}
        {activeSection === 'meta' && <MetaSection />}
        {activeSection === 'package' && <PackageSection epNum={epNum} />}
        {activeSection === 'upload' && <UploadSection />}
      </div>
    </div>
  )
}
