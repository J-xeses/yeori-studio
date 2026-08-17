import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './MakingTab.module.css'

const YEORI_SERVER = 'http://localhost:3001'
const MAKING_STAGES = ['G2-R', 'G3-R', 'G4-R']

// codebook.json의 PL.making_record는 YR_VD/BR_VD/PIP_VD/CC_ED/GR_ED 5개 "정식" PL코드
// 기준으로만 정의돼 있어(server/lib/scriptParserV3.js의 pipelineCodeToCutType과 동일한
// 축), 대본에서 파싱된 실제 masterCode.pl(예: YR_IM 등 변형)이 아니라 cutType에서
// 역산한 정식 코드로 조회해야 null/정의 존재 여부를 정확히 판정할 수 있다.
const CUTTYPE_TO_CANONICAL_PL = { YEORI: 'YR_VD', BROLL: 'BR_VD', CAPCUT: 'CC_ED', GRAPHIC: 'GR_ED', PIP: 'PIP_VD' }

function makingEntryFor(codebook, stageKey, canonicalPl) {
  const stepDef = codebook?.PL?.making_record?.[stageKey]
  if (!stepDef) return undefined
  return stepDef[canonicalPl]
}

export default function MakingTab() {
  const { state } = useApp()
  const { episode, cuts } = state

  const [codebook, setCodebook] = useState(null)
  const [quality, setQuality] = useState('medium')
  const [regionMode, setRegionMode] = useState('full')
  const [region, setRegion] = useState({ x: 0, y: 0, w: 1920, h: 1080 })
  const [stageByCut, setStageByCut] = useState({})
  const [activeRecording, setActiveRecording] = useState(null) // { cutNo }
  const [busyCutNo, setBusyCutNo] = useState(null)
  const [statusMsg, setStatusMsg] = useState({}) // cutNo -> message
  const [lastResults, setLastResults] = useState({}) // cutNo -> { sizeBytes, duration }
  const [files, setFiles] = useState([])
  const [filesLoading, setFilesLoading] = useState(false)

  useEffect(() => {
    fetch(`${YEORI_SERVER}/api/codebook`)
      .then(r => r.json())
      .then(d => { if (d.ok) setCodebook(d.codebook) })
      .catch(() => {})
  }, [])

  const loadFiles = useCallback(async () => {
    if (!episode.number) { setFiles([]); return }
    setFilesLoading(true)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/making-files?epNum=${episode.number}`)
      const data = await res.json()
      setFiles(data.files || [])
    } catch {
      setFiles([])
    } finally {
      setFilesLoading(false)
    }
  }, [episode.number])

  useEffect(() => { loadFiles() }, [loadFiles])

  const startRecording = async (cut) => {
    const stageKey = stageByCut[cut.no] || MAKING_STAGES[0]
    const stageDigit = stageKey.match(/\d/)[0]
    const canonicalPl = CUTTYPE_TO_CANONICAL_PL[cut.cutType] || 'YR_VD'

    setBusyCutNo(cut.no)
    setStatusMsg(prev => ({ ...prev, [cut.no]: null }))
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: `g${stageDigit}`,
          cutNo: cut.no,
          pl: canonicalPl,
          options: { fps: 30, quality, region: regionMode === 'custom' ? region : null },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatusMsg(prev => ({ ...prev, [cut.no]: `❌ ${data.error || '녹화 시작 실패'}` }))
        return
      }
      if (data.skipped) {
        setStatusMsg(prev => ({ ...prev, [cut.no]: `⏭ ${data.reason}` }))
        return
      }
      setActiveRecording({ cutNo: cut.no })
    } catch (e) {
      setStatusMsg(prev => ({ ...prev, [cut.no]: `❌ 서버 연결 실패: ${e.message}` }))
    } finally {
      setBusyCutNo(null)
    }
  }

  const stopRecording = async (cutNo) => {
    setBusyCutNo(cutNo)
    try {
      const res = await fetch(`${YEORI_SERVER}/api/recording/stop`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setLastResults(prev => ({ ...prev, [cutNo]: { sizeBytes: data.sizeBytes, duration: data.duration } }))
        setStatusMsg(prev => ({ ...prev, [cutNo]: null }))
        loadFiles()
      } else {
        setStatusMsg(prev => ({ ...prev, [cutNo]: `❌ ${data.error || '녹화 종료 실패'}` }))
      }
    } catch (e) {
      setStatusMsg(prev => ({ ...prev, [cutNo]: `❌ 서버 연결 실패: ${e.message}` }))
    } finally {
      setActiveRecording(null)
      setBusyCutNo(null)
    }
  }

  const pathPreview = `downloads/making/ep${episode.number ?? '{N}'}/g{stage}r_cut{N}.mp4`

  return (
    <div className={s.page}>
      <TabToolbar
        actions={[
          { key: 'refresh-files', variant: 'green', label: filesLoading ? '⏳ 로딩 중…' : '🔄 녹화본 새로고침', onClick: loadFiles },
        ]}
      />
      <div className={s.root}>
        <EpisodeInfoSidebar />
        <div className={s.main}>
          <div className={s.scrollBody}>
            <div className={s.content}>

              <div className={s.header}>
                <div>
                  <div className={s.title}>메이킹 필름 녹화</div>
                  <div className={s.subtitle}>
                    G2/G3/G4 자동화 진행 화면을 ffmpeg gdigrab으로 녹화해 남깁니다. codebook.json의
                    PL.making_record 기준으로 녹화 대상이 아닌 단계는 자동으로 비활성 처리됩니다.
                  </div>
                </div>
              </div>

              {/* 1. 녹화 설정 */}
              <div className={s.card}>
                <div className={s.cardTitle}>녹화 설정</div>
                <div className={s.activeEp}>
                  활성 에피소드: <strong>{episode.number ? `EP${episode.number} · ${episode.title || '제목 없음'}` : '없음'}</strong>
                </div>

                <div className={s.settingRow}>
                  <div className={s.settingGroup}>
                    <div className={s.settingLabel}>녹화 품질</div>
                    <div className={s.radioRow}>
                      {['low', 'medium', 'high'].map(q => (
                        <label key={q} className={s.radioLabel}>
                          <input type="radio" name="making-quality" value={q}
                            checked={quality === q} onChange={() => setQuality(q)} />
                          {q}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className={s.settingGroup}>
                    <div className={s.settingLabel}>녹화 영역</div>
                    <div className={s.radioRow}>
                      <label className={s.radioLabel}>
                        <input type="radio" name="making-region" value="full"
                          checked={regionMode === 'full'} onChange={() => setRegionMode('full')} />
                        전체화면
                      </label>
                      <label className={s.radioLabel}>
                        <input type="radio" name="making-region" value="custom"
                          checked={regionMode === 'custom'} onChange={() => setRegionMode('custom')} />
                        특정영역
                      </label>
                      {regionMode === 'custom' && (
                        <div className={s.regionInputs}>
                          {['x', 'y', 'w', 'h'].map(k => (
                            <label key={k} className={s.regionField}>
                              {k}
                              <input type="number" value={region[k]}
                                onChange={e => setRegion(prev => ({ ...prev, [k]: parseInt(e.target.value) || 0 }))} />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={s.pathPreview}>저장 경로 미리보기: <code>{pathPreview}</code></div>
              </div>

              {/* 2. 단계별 녹화 컨트롤 */}
              <div className={s.card}>
                <div className={s.cardTitle}>단계별 녹화 컨트롤</div>
                {!cuts?.length && <div className={s.emptyHint}>활성 에피소드에 컷이 없습니다.</div>}
                <div className={s.cutList}>
                  {cuts?.map(cut => {
                    const canonicalPl = CUTTYPE_TO_CANONICAL_PL[cut.cutType] || 'YR_VD'
                    const plDisplay = cut.masterCode?.pl || canonicalPl
                    const stageKey = stageByCut[cut.no] || MAKING_STAGES[0]
                    const isThisRecording = activeRecording?.cutNo === cut.no
                    const isBusy = busyCutNo === cut.no
                    const result = lastResults[cut.no]
                    const msg = statusMsg[cut.no]

                    return (
                      <div key={cut.id} className={s.cutRow}>
                        <span className={s.cutNo}>#{cut.no}</span>
                        <span className={s.plCode}>{plDisplay}</span>
                        <select
                          className={s.stageSelect}
                          value={stageKey}
                          disabled={isThisRecording}
                          onChange={e => setStageByCut(prev => ({ ...prev, [cut.no]: e.target.value }))}
                        >
                          {MAKING_STAGES.map(stg => {
                            const entry = makingEntryFor(codebook, stg, canonicalPl)
                            const disabled = codebook != null && entry === null
                            return (
                              <option key={stg} value={stg} disabled={disabled}>
                                {stg}{disabled ? ' (해당없음)' : ''}
                              </option>
                            )
                          })}
                        </select>
                        {isThisRecording ? (
                          <button className={s.stopBtn} disabled={isBusy} onClick={() => stopRecording(cut.no)}>
                            🔴 녹화 중... 중지
                          </button>
                        ) : (
                          <button className={s.startBtn} disabled={!!activeRecording || isBusy}
                            onClick={() => startRecording(cut)}>
                            {isBusy ? '⏳' : '녹화 시작'}
                          </button>
                        )}
                        <span className={s.resultText}>
                          {result ? `${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB · ${result.duration != null ? result.duration.toFixed(1) + '초' : '-'}` : ''}
                          {msg && <span className={s.statusMsg}>{msg}</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 3. 녹화본 관리 */}
              <div className={s.card}>
                <div className={s.cardTitle}>녹화본 관리</div>
                {!files.length ? (
                  <div className={s.emptyHint}>{filesLoading ? '로딩 중…' : '아직 녹화본이 없습니다.'}</div>
                ) : (
                  <table className={s.filesTable}>
                    <thead>
                      <tr><th>파일명</th><th>크기</th><th>생성 시각</th></tr>
                    </thead>
                    <tbody>
                      {files.map(f => (
                        <tr key={f.name}>
                          <td>{f.name}</td>
                          <td>{(f.sizeBytes / 1024 / 1024).toFixed(1)}MB</td>
                          <td>{new Date(f.createdAt).toLocaleString('ko-KR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button className={s.assembleBtn} disabled title="추후 연결 예정">
                  🎬 G5-M 메이킹 조립
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
