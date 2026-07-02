import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import s from './StoryArchiveTab.module.css'

const TREND_RADAR_URL = 'https://trend-radar-gamma.vercel.app'

const YEORI_EMOTIONS = ['공감', '위로', '동기부여', '유머', '진솔함', '성장', '일상', '반전']
const YEORI_SITUATIONS = ['퇴근 후 혼자', '카페에서', '새벽 감성', '직장 스트레스', '자기계발 중', '번아웃', '소소한 행복', '관계 고민']
const SAMPLE_TRENDS = [
  { keyword: '번아웃 극복', source: 'YouTube KR', score: 92 },
  { keyword: '직장인 루틴', source: 'Naver', score: 88 },
  { keyword: '혼자 저녁', source: 'YouTube KR', score: 85 },
  { keyword: '퇴사 고민', source: 'Reddit', score: 79 },
  { keyword: '자기계발 현실', source: 'YouTube KR', score: 76 },
]
const GENRES = ['브이로그형', '토크형', '정보형', '감성 다큐형', '챌린지형']
const TONES = ['진솔함', '유머', '동기부여', '감성', '현실공감']
const TARGETS = ['20대 직장인', '30대 직장인', '40대 직장인', '취준생', '자기계발러']

// ── Claude 호출 ──────────────────────────────
async function callClaude(system, userContent, apiKey, maxTokens = 1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
  })
  const data = await res.json()
  const text = data.content?.find(b => b.type === 'text')?.text || ''
  return text.replace(/```json|```/g, '').trim()
}

// ── XML 파싱 → 키워드 추출 ──────────────────────────────
function parseYoutubeXML(xml) {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    const entries = doc.querySelectorAll('entry')
    const items = []
    entries.forEach(entry => {
      const title = entry.querySelector('title')?.textContent || ''
      const id = entry.querySelector('videoId')?.textContent || ''
      if (title) items.push({ title, id })
    })
    return items
  } catch { return [] }
}

// ── 제목에서 핵심 키워드 추출 ──────────────────────────────
async function extractKeywords(titles, apiKey) {
  const text = await callClaude(
    `당신은 유튜브 트렌드 분석가입니다.
반드시 JSON만 반환하세요. 마크다운 없이.
형식: {"keywords":[{"word":"키워드","category":"카테고리","count":숫자,"score":숫자}]}
keywords는 최대 12개, score는 1-100.`,
    `아래는 현재 유튜브 한국 인기 영상 제목 목록입니다:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

이 제목들에서:
1. 반복되거나 트렌드를 나타내는 핵심 키워드 12개 추출
2. 각 키워드의 카테고리 (자기계발/직장/감성/유머/정보/라이프스타일 등)
3. 등장 빈도(count)와 트렌드 점수(score) 계산`,
    apiKey
  )
  return JSON.parse(text).keywords || []
}

// ── Claude 폴백 키워드 생성 ──────────────────────────────
async function generateFallbackKeywords(apiKey) {
  const text = await callClaude(
    `당신은 유튜브 트렌드 분석가입니다.
반드시 JSON만 반환하세요. 마크다운 없이.
형식: {"keywords":[{"word":"키워드","category":"카테고리","count":숫자,"score":숫자}]}`,
    `2025년 현재 한국 유튜브에서 인기 있는 키워드 12개를 생성해줘.
20-40대 직장인이 많이 검색하는 키워드 위주로.
카테고리: 자기계발/직장/감성/유머/정보/라이프스타일`,
    apiKey
  )
  return JSON.parse(text).keywords || []
}

// ════════════════════════════════════════════════
// 📺 유튜브 분석 탭
// ════════════════════════════════════════════════
function YoutubeAnalysisTab() {
  const { state } = useApp()
  const apiKey = state.apiKeys?.claude || ""
  const [keywords, setKeywords] = useState([])
  const [dataSource, setDataSource] = useState('') // 'live' | 'ai'
  const [loadingKeywords, setLoadingKeywords] = useState(false)
  const [selectedKeyword, setSelectedKeyword] = useState(null)
  const [myTopic, setMyTopic] = useState('')
  const [formats, setFormats] = useState([])
  const [combinations, setCombinations] = useState([])
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState([])

  // 탭 열릴 때 자동 키워드 수집
  useEffect(() => {
    loadKeywords()
  }, [])

  const loadKeywords = async () => {
    setLoadingKeywords(true)
    setKeywords([])
    setDataSource('')
    setError('')

    try {
      // 방법 1: Trend Radar API 시도
      const res = await fetch(`${TREND_RADAR_URL}/api/youtube?type=trending`)
      if (res.ok) {
        const data = await res.json()
        if (data.xml) {
          const items = parseYoutubeXML(data.xml)
          if (items.length > 0) {
            const titles = items.map(i => i.title)
            const kws = await extractKeywords(titles, apiKey)
            setKeywords(kws)
            setDataSource('live')
            setLoadingKeywords(false)
            return
          }
        }
      }
    } catch { /* 폴백으로 이동 */ }

    // 방법 2: Claude 폴백
    try {
      const kws = await generateFallbackKeywords(apiKey)
      setKeywords(kws)
      setDataSource('ai')
    } catch {
      setError('키워드 로드 실패. 새로고침 해주세요.')
    } finally {
      setLoadingKeywords(false)
    }
  }

  // 키워드 클릭 → 형식 분석
  const analyzeFormats = async (kw) => {
    setSelectedKeyword(kw)
    setStep(2)
    setLoading(true)
    setFormats([])
    setCombinations([])
    setLoadingMsg(`"${kw.word}" 형식 분석 중`)

    try {
      const text = await callClaude(
        `당신은 유튜브 콘텐츠 전략가입니다.
반드시 JSON만 반환하세요. 마크다운 없이.
형식: {"formats":[{"name":"형식명","desc":"한 줄 설명","why":"잘 되는 이유","examples":["예시1","예시2"],"score":숫자}],"summary":"트렌드 요약 한 줄"}
formats 4개, score 1-100.`,
        `유튜브 키워드: "${kw.word}" (카테고리: ${kw.category})

이 키워드로 현재 유튜브에서 잘 되는 영상 형식 4가지를 분석해줘.
각 형식이 왜 잘 되는지, 실제 예시 채널/영상 포함.`,
        apiKey
      )
      const parsed = JSON.parse(text)
      setFormats(parsed.formats || [])
    } catch {
      setError('형식 분석 실패.')
      setStep(1)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // 내 주제 → 블루오션 조합
  const generateCombinations = async () => {
    if (!myTopic.trim()) return
    setLoading(true)
    setCombinations([])
    setLoadingMsg('블루오션 조합 찾는 중')

    try {
      const formatsText = formats.map(f => `- ${f.name}: ${f.desc}`).join('\n')
      const text = await callClaude(
        `당신은 유튜브 블루오션 전략가입니다.
블루오션 공식: 잘 되는 형식 × 새 주제 = 아직 없는 조합
서여리는 20대 중반 한국 직장인 AI 인플루언서입니다.
반드시 JSON만 반환하세요. 마크다운 없이.
형식: {"combinations":[{"format":"형식","topic":"주제","title":"영상 제목 예시","hook":"첫 3초 훅","reason":"블루오션 이유","competition":"낮음|보통|높음","score":숫자}]}
combinations 4개.`,
        `트렌드 키워드: "${selectedKeyword.word}"
잘 되는 형식:
${formatsText}

내 채널 주제: "${myTopic}" (서여리 - AI 직장인 인플루언서)

위 형식들과 내 주제를 조합해서 아직 없거나 경쟁이 낮은 블루오션 조합 4개 찾아줘.
서여리 캐릭터에 맞는 조합만 선택.`,
        apiKey
      )
      const parsed = JSON.parse(text)
      setCombinations(parsed.combinations || [])
      setStep(3)
    } catch {
      setError('조합 생성 실패.')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  const saveCombination = (combo) => {
    if (saved.find(x => x.title === combo.title)) return
    setSaved(prev => [{ ...combo, keyword: selectedKeyword?.word, myTopic, savedAt: new Date().toLocaleString('ko-KR'), id: Date.now() }, ...prev])
  }

  const reset = () => {
    setStep(1); setSelectedKeyword(null); setMyTopic('')
    setFormats([]); setCombinations([]); setError('')
  }

  const categoryColor = (cat) => {
    const map = { '자기계발': '#7c5cfc', '직장': '#22d3ee', '감성': '#f472b6', '유머': '#fbbf24', '정보': '#4ade80', '라이프스타일': '#fb923c' }
    return map[cat] || '#888'
  }

  return (
    <div className={s.ytWrap}>

      {/* 진행 단계 */}
      <div className={s.stepBar}>
        <div className={`${s.stepItem} ${step >= 1 ? s.stepActive : ''}`}><span className={s.stepNum}>1</span><span>키워드 선택</span></div>
        <div className={s.stepLine} />
        <div className={`${s.stepItem} ${step >= 2 ? s.stepActive : ''}`}><span className={s.stepNum}>2</span><span>형식 분석</span></div>
        <div className={s.stepLine} />
        <div className={`${s.stepItem} ${step >= 3 ? s.stepActive : ''}`}><span className={s.stepNum}>3</span><span>블루오션 조합</span></div>
      </div>

      {/* STEP 1: 키워드 카드 */}
      <div className={s.section}>
        <div className={s.sectionLabel}>
          <span className={s.step}>STEP 1</span>
          <span>유튜브 인기 키워드</span>
          {dataSource === 'live' && <span className={s.liveTag}>🔴 실시간</span>}
          {dataSource === 'ai' && <span className={s.aiTag}>🤖 AI 생성</span>}
          <button className={s.refreshBtn} onClick={loadKeywords} disabled={loadingKeywords}>
            {loadingKeywords ? '...' : '↺ 새로고침'}
          </button>
          {step > 1 && <button className={s.resetBtn} onClick={reset}>← 다시 선택</button>}
        </div>

        {loadingKeywords && (
          <div className={s.kwLoading}>
            <span className={s.loadingDots}>키워드 수집 중<span>.</span><span>.</span><span>.</span></span>
          </div>
        )}

        {!loadingKeywords && keywords.length > 0 && (
          <>
            <p className={s.searchHint}>키워드를 클릭하면 유튜브 형식 분석을 시작해요</p>
            <div className={s.kwGrid}>
              {keywords.map((kw, i) => (
                <button key={i}
                  className={`${s.kwCard} ${selectedKeyword?.word === kw.word ? s.kwSelected : ''}`}
                  onClick={() => step === 1 && analyzeFormats(kw)}
                  disabled={step > 1 && selectedKeyword?.word !== kw.word}>
                  <div className={s.kwTop}>
                    <span className={s.kwWord}>{kw.word}</span>
                    <span className={s.kwScore}>{kw.score}</span>
                  </div>
                  <div className={s.kwBottom}>
                    <span className={s.kwCategory} style={{ color: categoryColor(kw.category), borderColor: categoryColor(kw.category) + '44', background: categoryColor(kw.category) + '11' }}>
                      {kw.category}
                    </span>
                    <span className={s.kwCount}>언급 {kw.count}회</span>
                  </div>
                  <div className={s.kwBar}>
                    <div className={s.kwBarFill} style={{ width: `${kw.score}%`, background: categoryColor(kw.category) }} />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div className={s.error}>{error}</div>}
      </div>

      {/* STEP 2: 형식 분석 결과 */}
      {loading && step === 2 && (
        <div className={s.section}>
          <div className={s.loadingCenter}>
            <span className={s.loadingDots}>{loadingMsg}<span>.</span><span>.</span><span>.</span></span>
          </div>
        </div>
      )}

      {formats.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionLabel}>
            <span className={s.step}>STEP 2</span>
            <span>"{selectedKeyword?.word}" 잘 되는 형식</span>
          </div>
          <div className={s.formatGrid}>
            {formats.map((f, i) => (
              <div key={i} className={s.formatCard}>
                <div className={s.formatHeader}>
                  <span className={s.formatName}>{f.name}</span>
                  <div className={s.miniScoreBar}>
                    <div className={s.miniScoreFill} style={{ width: `${f.score}%` }} />
                    <span className={s.miniScoreNum}>{f.score}</span>
                  </div>
                </div>
                <p className={s.formatDesc}>{f.desc}</p>
                <p className={s.formatWhy}>💡 {f.why}</p>
                <div className={s.exampleList}>
                  {f.examples?.slice(0, 2).map((ex, j) => <span key={j} className={s.exampleTag}>{ex}</span>)}
                </div>
              </div>
            ))}
          </div>

          {step === 2 && (
            <div className={s.myTopicBox}>
              <div className={s.myTopicLabel}><span className={s.step}>STEP 3</span><span>내 채널 주제 입력</span></div>
              <div className={s.searchRow}>
                <input className={s.input} placeholder="예: AI 직장인 일상, 번아웃 극복"
                  value={myTopic} onChange={e => setMyTopic(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generateCombinations()} />
                <button className={`${s.searchBtn} ${myTopic.trim() ? s.searchBtnActive : ''}`}
                  onClick={generateCombinations} disabled={!myTopic.trim() || loading}>
                  {loading
                    ? <span className={s.loadingDots}>{loadingMsg}<span>.</span><span>.</span><span>.</span></span>
                    : '🌊 블루오션 찾기'}
                </button>
              </div>
              <div className={s.formulaRow}>
                <span className={s.formulaItem}>"{selectedKeyword?.word}" 형식</span>
                <span className={s.formulaCross}>×</span>
                <span className={s.formulaItem}>{myTopic || '내 주제'}</span>
                <span className={s.formulaArrow}>→</span>
                <span className={s.formulaResult}>🌊 블루오션</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: 블루오션 조합 */}
      {combinations.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionLabel}>
            <span className={s.step}>🌊</span>
            <span>블루오션 조합 발견!</span>
          </div>
          <div className={s.comboList}>
            {combinations.map((c, i) => (
              <div key={i} className={s.comboCard}>
                <div className={s.comboHeader}>
                  <div className={s.comboFormula}>
                    <span className={s.comboFormat}>{c.format}</span>
                    <span className={s.comboCross}>×</span>
                    <span className={s.comboTopic}>{c.topic}</span>
                  </div>
                  <div className={s.comboRight}>
                    <span className={`${s.compBadge} ${c.competition === '낮음' ? s.compLow : c.competition === '보통' ? s.compMid : s.compHigh}`}>
                      경쟁 {c.competition}
                    </span>
                    <div className={s.miniScoreBar}>
                      <div className={s.miniScoreFill} style={{ width: `${c.score}%`, background: '#22d3ee' }} />
                      <span className={s.miniScoreNum}>{c.score}</span>
                    </div>
                    <button className={s.saveBtn} onClick={() => saveCombination(c)}>
                      {saved.find(x => x.title === c.title) ? '✅' : '💾'}
                    </button>
                  </div>
                </div>
                <h4 className={s.comboTitle}>{c.title}</h4>
                <div className={s.hookBox}><span className={s.hookLabel}>훅</span><p className={s.hookText}>"{c.hook}"</p></div>
                <div className={s.blueoceanBox}><span className={s.blueoceanLabel}>🌊</span><span className={s.blueoceanText}>{c.reason}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 저장된 조합 */}
      {saved.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>📁</span><span>저장된 조합 ({saved.length})</span></div>
          <div className={s.archiveList}>
            {saved.map(c => (
              <div key={c.id} className={s.archiveCard}>
                <div className={s.archiveHeader}>
                  <span className={s.archiveTitle}>{c.title}</span>
                  <span className={s.archiveDate}>{c.savedAt}</span>
                  <button className={s.removeBtn} onClick={() => setSaved(prev => prev.filter(x => x.id !== c.id))}>✕</button>
                </div>
                <div className={s.comboFormula}>
                  <span className={s.comboFormat}>{c.format}</span>
                  <span className={s.comboCross}>×</span>
                  <span className={s.comboTopic}>{c.topic}</span>
                </div>
                <p className={s.archiveHook}>"{c.hook}"</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════
// 💡 단편 아이디어
// ════════════════════════════════════════════════
function ShortIdeaTab() {
  const { state } = useApp()
  const apiKey = state.apiKeys?.claude || ""
  const [selectedTrend, setSelectedTrend] = useState(null)
  const [selectedEmotion, setSelectedEmotion] = useState('')
  const [selectedSituation, setSelectedSituation] = useState('')
  const [stories, setStories] = useState([])
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState([])
  const [error, setError] = useState('')
  const canGenerate = selectedTrend && selectedEmotion && selectedSituation

  const generateStories = async () => {
    if (!canGenerate) return
    setLoading(true); setError(''); setStories([])
    try {
      const text = await callClaude(
        `당신은 서여리의 콘텐츠 기획자입니다. JSON 배열만 반환. 마크다운 없이.
형식: [{"title":"제목","hook":"훅 대사","summary":"요약 2줄","tags":["태그"]}]`,
        `트렌드: "${selectedTrend.keyword}", 감정: "${selectedEmotion}", 상황: "${selectedSituation}"
서여리 스토리 3개 제안해줘.`,
        apiKey
      )
      setStories(JSON.parse(text))
    } catch { setError('생성 실패.') }
    finally { setLoading(false) }
  }

  const saveStory = (story) => {
    if (saved.find(x => x.title === story.title)) return
    setSaved(prev => [{ ...story, savedAt: new Date().toLocaleString('ko-KR'), id: Date.now() }, ...prev])
  }

  return (
    <div className={s.grid}>
      <div className={s.panel}>
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>01</span><span>트렌드 키워드</span></div>
          <div className={s.trendList}>
            {SAMPLE_TRENDS.map(t => (
              <button key={t.keyword} className={`${s.trendItem} ${selectedTrend?.keyword === t.keyword ? s.selected : ''}`} onClick={() => setSelectedTrend(t)}>
                <div className={s.trendInfo}><span className={s.trendKeyword}>{t.keyword}</span><span className={s.trendSource}>{t.source}</span></div>
                <div className={s.scoreBar}><div className={s.scoreFill} style={{ width: `${t.score}%` }} /><span className={s.scoreNum}>{t.score}</span></div>
              </button>
            ))}
          </div>
        </div>
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>02</span><span>감정 톤</span></div>
          <div className={s.chips}>{YEORI_EMOTIONS.map(e => <button key={e} className={`${s.chip} ${selectedEmotion === e ? s.chipActive : ''}`} onClick={() => setSelectedEmotion(e)}>{e}</button>)}</div>
        </div>
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>03</span><span>상황</span></div>
          <div className={s.chips}>{YEORI_SITUATIONS.map(sit => <button key={sit} className={`${s.chip} ${selectedSituation === sit ? s.chipActive : ''}`} onClick={() => setSelectedSituation(sit)}>{sit}</button>)}</div>
        </div>
        <button className={`${s.genBtn} ${canGenerate ? s.genBtnActive : ''}`} onClick={generateStories} disabled={!canGenerate || loading}>
          {loading ? <span className={s.loadingDots}>생성 중<span>.</span><span>.</span><span>.</span></span> : '✨ 스토리 3개 생성'}
        </button>
        {error && <div className={s.error}>{error}</div>}
      </div>
      <div className={s.resultCol}>
        {stories.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>✦</span><span>생성된 스토리</span></div>
            <div className={s.storyList}>
              {stories.map((story, i) => (
                <div key={i} className={s.storyCard}>
                  <div className={s.storyHeader}><span className={s.storyNum}>0{i+1}</span><h3 className={s.storyTitle}>{story.title}</h3><button className={s.saveBtn} onClick={() => saveStory(story)}>{saved.find(x => x.title === story.title) ? '✅' : '💾'}</button></div>
                  <div className={s.hookBox}><span className={s.hookLabel}>훅</span><p className={s.hookText}>"{story.hook}"</p></div>
                  <p className={s.storySummary}>{story.summary}</p>
                  <div className={s.tagRow}>{story.tags?.map(tag => <span key={tag} className={s.tag}>#{tag}</span>)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {saved.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>📁</span><span>저장 ({saved.length})</span></div>
            <div className={s.archiveList}>
              {saved.map(story => (
                <div key={story.id} className={s.archiveCard}>
                  <div className={s.archiveHeader}><span className={s.archiveTitle}>{story.title}</span><span className={s.archiveDate}>{story.savedAt}</span><button className={s.removeBtn} onClick={() => setSaved(prev => prev.filter(x => x.id !== story.id))}>✕</button></div>
                  <p className={s.archiveHook}>"{story.hook}"</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {stories.length === 0 && saved.length === 0 && !loading && <div className={s.empty}><div className={s.emptyIcon}>✦</div><p>트렌드 + 감정 + 상황 선택 후<br />스토리를 생성해보세요</p></div>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// 🎬 시리즈 기획
// ════════════════════════════════════════════════
function SeriesPlanTab() {
  const { state } = useApp()
  const apiKey = state.apiKeys?.claude || ""
  const [channel, setChannel] = useState({ name: '', concept: '', target: '', genre: '', tone: '' })
  const [keyword, setKeyword] = useState('')
  const [plans, setPlans] = useState([])
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [channelSaved, setChannelSaved] = useState(false)
  const channelComplete = channel.name && channel.concept && channel.target && channel.genre && channel.tone
  const canGenerate = channelComplete && channelSaved && keyword
  const updateChannel = (key, val) => { setChannel(p => ({ ...p, [key]: val })); setChannelSaved(false) }

  const generatePlans = async () => {
    if (!canGenerate) return
    setLoading(true); setError(''); setPlans([])
    try {
      const text = await callClaude(
        `서여리 채널 시리즈 기획자. JSON 배열만 반환. 마크다운 없이.
형식: [{"seriesTitle":"제목","concept":"콘셉트","episodeCount":숫자,"episodes":[{"ep":1,"title":"화 제목","keyword":"키워드","hook":"훅"}],"targetReaction":"반응","tags":["태그"]}]
episodes 4개.`,
        `채널: ${channel.name}, 콘셉트: ${channel.concept}, 타깃: ${channel.target}, 장르: ${channel.genre}, 톤: ${channel.tone}
주제: "${keyword}" — 기획 개요 2개.`,
        apiKey,
        1500
      )
      setPlans(JSON.parse(text))
    } catch { setError('생성 실패.') }
    finally { setLoading(false) }
  }

  const savePlan = (plan) => {
    if (saved.find(x => x.seriesTitle === plan.seriesTitle)) return
    setSaved(prev => [{ ...plan, savedAt: new Date().toLocaleString('ko-KR'), id: Date.now() }, ...prev])
  }

  return (
    <div className={s.grid}>
      <div className={s.panel}>
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>채널</span><span>채널 설정</span>{channelSaved && <span className={s.savedBadge}>✓ 저장됨</span>}</div>
          <div className={s.fieldGroup}><label className={s.fieldLabel}>채널명</label><input className={s.input} placeholder="예: 서여리 일상" value={channel.name} onChange={e => updateChannel('name', e.target.value)} /></div>
          <div className={s.fieldGroup}><label className={s.fieldLabel}>콘셉트 한 줄</label><input className={s.input} placeholder="예: 직장인 AI 인플루언서의 진솔한 일상" value={channel.concept} onChange={e => updateChannel('concept', e.target.value)} /></div>
          <div className={s.fieldGroup}><label className={s.fieldLabel}>타깃</label><div className={s.chips}>{TARGETS.map(t => <button key={t} className={`${s.chip} ${channel.target === t ? s.chipActive : ''}`} onClick={() => updateChannel('target', t)}>{t}</button>)}</div></div>
          <div className={s.fieldGroup}><label className={s.fieldLabel}>장르</label><div className={s.chips}>{GENRES.map(g => <button key={g} className={`${s.chip} ${channel.genre === g ? s.chipActive : ''}`} onClick={() => updateChannel('genre', g)}>{g}</button>)}</div></div>
          <div className={s.fieldGroup}><label className={s.fieldLabel}>톤</label><div className={s.chips}>{TONES.map(t => <button key={t} className={`${s.chip} ${channel.tone === t ? s.chipActive : ''}`} onClick={() => updateChannel('tone', t)}>{t}</button>)}</div></div>
          <button className={`${s.genBtn} ${channelComplete ? s.genBtnActive : ''}`} onClick={() => channelComplete && setChannelSaved(true)} disabled={!channelComplete}>{channelSaved ? '✅ 설정 완료' : '💾 채널 설정 저장'}</button>
        </div>
        {channelSaved && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>기획</span><span>시리즈 주제</span></div>
            <input className={s.input} placeholder="예: 번아웃 극복 30일 챌린지" value={keyword} onChange={e => setKeyword(e.target.value)} />
            <button className={`${s.genBtn} ${canGenerate ? s.genBtnActive : ''} ${s.mtop}`} onClick={generatePlans} disabled={!canGenerate || loading}>
              {loading ? <span className={s.loadingDots}>생성 중<span>.</span><span>.</span><span>.</span></span> : '🎬 기획 개요 생성'}
            </button>
            {error && <div className={s.error}>{error}</div>}
          </div>
        )}
      </div>
      <div className={s.resultCol}>
        {plans.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>✦</span><span>기획 개요</span></div>
            <div className={s.storyList}>
              {plans.map((plan, i) => (
                <div key={i} className={s.seriesCard}>
                  <div className={s.seriesHeader}>
                    <div className={s.seriesTitleGroup}><div className={s.seriesBadge}>시리즈 {i+1}</div><h3 className={s.seriesTitle}>{plan.seriesTitle}</h3><p className={s.seriesConcept}>{plan.concept}</p></div>
                    <button className={s.saveBtn} onClick={() => savePlan(plan)}>{saved.find(x => x.seriesTitle === plan.seriesTitle) ? '✅' : '💾'}</button>
                  </div>
                  <div className={s.seriesMeta}><span className={s.metaItem}>📺 {plan.episodeCount}화</span><span className={s.metaItem}>👥 {plan.targetReaction}</span></div>
                  <div className={s.episodeList}>
                    <div className={s.episodeHeader}>샘플 에피소드</div>
                    {plan.episodes?.map(ep => (
                      <div key={ep.ep} className={s.episodeRow}>
                        <span className={s.epNum}>{ep.ep}화</span>
                        <div className={s.epInfo}><span className={s.epTitle}>{ep.title}</span><span className={s.epHook}>"{ep.hook}"</span></div>
                        <span className={s.epKeyword}>{ep.keyword}</span>
                      </div>
                    ))}
                  </div>
                  <div className={s.tagRow}>{plan.tags?.map(tag => <span key={tag} className={s.tag}>#{tag}</span>)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {plans.length === 0 && !loading && <div className={s.empty}><div className={s.emptyIcon}>🎬</div><p>채널 설정 후 시리즈 주제를 입력해보세요</p></div>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════
export default function StoryArchiveTab() {
  const [activeInner, setActiveInner] = useState('youtube')
  const INNER_TABS = [
    { id: 'youtube', label: '📺 유튜브 분석' },
    { id: 'short',   label: '💡 단편 아이디어' },
    { id: 'series',  label: '🎬 시리즈 기획' },
  ]
  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <div className={s.headerIcon}>📚</div>
        <div>
          <h1 className={s.title}>스토리 아카이브</h1>
          <p className={s.subtitle}>유튜브 실시간 분석 → 블루오션 조합 → 콘텐츠 기획</p>
        </div>
      </div>
      <div className={s.innerTabs}>
        {INNER_TABS.map(t => (
          <button key={t.id} className={`${s.innerTab} ${activeInner === t.id ? s.innerTabActive : ''}`} onClick={() => setActiveInner(t.id)}>{t.label}</button>
        ))}
      </div>
      {activeInner === 'youtube' && <YoutubeAnalysisTab />}
      {activeInner === 'short'   && <ShortIdeaTab />}
      {activeInner === 'series'  && <SeriesPlanTab />}
    </div>
  )
}
