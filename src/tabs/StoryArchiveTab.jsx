import { useState } from 'react'
import s from './StoryArchiveTab.module.css'

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

// ── 일반 Claude 호출 ──────────────────────────────
async function callClaude(system, userContent, maxTokens = 1000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
  })
  const data = await res.json()
  const text = data.content?.find(b => b.type === 'text')?.text || ''
  return text.replace(/```json|```/g, '').trim()
}

// ── 웹검색 포함 Claude 호출 ──────────────────────────────
async function callClaudeWithSearch(system, userContent, maxTokens = 2000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search'
        }
      ],
      messages: [{ role: 'user', content: userContent }]
    })
  })
  const data = await res.json()

  // 모든 텍스트 블록 합치기
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  return text.replace(/```json|```/g, '').trim()
}

// ════════════════════════════════════════════════
// 📺 유튜브 분석 탭 (웹검색 기반)
// ════════════════════════════════════════════════
function YoutubeAnalysisTab() {
  const [keyword, setKeyword] = useState('')
  const [myTopic, setMyTopic] = useState('')
  const [step, setStep] = useState(1) // 1: 키워드입력, 2: 형식분석결과, 3: 조합결과
  const [formats, setFormats] = useState([])
  const [combinations, setCombinations] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState([])

  // STEP 1: 유튜브 검색 → 잘 되는 형식 분석
  const analyzeFormats = async () => {
    if (!keyword.trim()) return
    setLoading(true)
    setError('')
    setFormats([])
    setLoadingMsg('유튜브 실제 검색 중...')

    try {
      const text = await callClaudeWithSearch(
        `당신은 유튜브 콘텐츠 전략가입니다.
web_search 툴로 유튜브를 실제 검색해서 현재 잘 되는 영상 형식을 분석하세요.
반드시 JSON만 반환하세요. 마크다운 없이.
형식: {"formats":[{"name":"형식명","desc":"한 줄 설명","why":"잘 되는 이유","examples":["실제 채널/영상 예시"],"score":숫자}],"summary":"전체 트렌드 한 줄 요약"}
formats는 4개, score는 1-100.`,
        `유튜브에서 "${keyword}" 관련 인기 영상을 검색해서:
1. 현재 조회수 높은 영상들의 공통 형식 패턴 4가지를 분석해줘
2. 각 형식이 왜 잘 되는지 이유와 실제 예시 포함
3. 실제 유튜브 검색 결과 기반으로 분석할 것`,
        2000
      )
      const parsed = JSON.parse(text)
      setFormats(parsed.formats || [])
      setStep(2)
    } catch (e) {
      setError('분석 실패. 다시 시도해주세요.')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // STEP 2: 내 주제 입력 → 블루오션 조합 생성
  const generateCombinations = async () => {
    if (!myTopic.trim()) return
    setLoading(true)
    setError('')
    setCombinations([])
    setLoadingMsg('아직 없는 조합 찾는 중...')

    try {
      const formatsText = formats.map(f => `- ${f.name}: ${f.desc}`).join('\n')
      const text = await callClaudeWithSearch(
        `당신은 유튜브 블루오션 전략가입니다.
블루오션 공식: 잘 되는 형식 × 새 주제 = 아직 없는 조합
서여리는 20대 중반 한국 직장인 AI 인플루언서입니다.
반드시 JSON만 반환하세요. 마크다운 없이.
형식: {"combinations":[{"format":"형식명","topic":"주제","title":"실제 영상 제목 예시","hook":"첫 3초 훅 문장","reason":"블루오션인 이유","competition":"경쟁 강도(낮음/보통/높음)","score":숫자}]}
combinations 4개, score는 1-100.`,
        `잘 되는 형식 목록:
${formatsText}

내 채널 주제: "${myTopic}" (서여리 - AI 직장인 인플루언서)

web_search로 "${myTopic}" 관련 유튜브를 검색해서:
1. 위 형식들과 내 주제를 조합했을 때 아직 없거나 적은 조합 4가지 찾기
2. 실제 유튜브에서 경쟁이 낮은 조합 우선으로 제안
3. 서여리 캐릭터에 맞는 조합만 선택`,
        2000
      )
      const parsed = JSON.parse(text)
      setCombinations(parsed.combinations || [])
      setStep(3)
    } catch (e) {
      setError('조합 생성 실패. 다시 시도해주세요.')
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  const saveCombination = (combo) => {
    if (saved.find(x => x.title === combo.title)) return
    setSaved(prev => [{ ...combo, keyword, myTopic, savedAt: new Date().toLocaleString('ko-KR'), id: Date.now() }, ...prev])
  }

  const reset = () => {
    setStep(1); setKeyword(''); setMyTopic('')
    setFormats([]); setCombinations([]); setError('')
  }

  const competitionColor = (c) => {
    if (c === '낮음') return s.compLow
    if (c === '보통') return s.compMid
    return s.compHigh
  }

  return (
    <div className={s.ytWrap}>

      {/* 진행 단계 표시 */}
      <div className={s.stepBar}>
        <div className={`${s.stepItem} ${step >= 1 ? s.stepActive : ''}`}>
          <span className={s.stepNum}>1</span>
          <span>유튜브 검색</span>
        </div>
        <div className={s.stepLine} />
        <div className={`${s.stepItem} ${step >= 2 ? s.stepActive : ''}`}>
          <span className={s.stepNum}>2</span>
          <span>형식 분석</span>
        </div>
        <div className={s.stepLine} />
        <div className={`${s.stepItem} ${step >= 3 ? s.stepActive : ''}`}>
          <span className={s.stepNum}>3</span>
          <span>블루오션 조합</span>
        </div>
      </div>

      {/* STEP 1: 키워드 입력 */}
      <div className={s.section}>
        <div className={s.sectionLabel}>
          <span className={s.step}>STEP 1</span>
          <span>유튜브 검색 키워드</span>
          {step > 1 && <button className={s.resetBtn} onClick={reset}>↺ 다시 시작</button>}
        </div>
        <div className={s.searchRow}>
          <input className={s.input}
            placeholder="예: 직장인 자기계발, 번아웃, 퇴사"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && step === 1 && analyzeFormats()}
            disabled={step > 1} />
          {step === 1 && (
            <button className={`${s.searchBtn} ${keyword.trim() ? s.searchBtnActive : ''}`}
              onClick={analyzeFormats} disabled={!keyword.trim() || loading}>
              {loading
                ? <span className={s.loadingDots}>{loadingMsg || '검색 중'}<span>.</span><span>.</span><span>.</span></span>
                : '🔍 유튜브 검색'}
            </button>
          )}
        </div>
        <p className={s.searchHint}>실제 유튜브를 검색해서 잘 되는 형식을 찾아드려요</p>
        {error && <div className={s.error}>{error}</div>}
      </div>

      {/* STEP 2: 형식 분석 결과 */}
      {formats.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionLabel}>
            <span className={s.step}>STEP 2</span>
            <span>유튜브에서 잘 되는 형식</span>
            <span className={s.liveTag}>🔴 실시간 분석</span>
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
                  {f.examples?.slice(0, 2).map((ex, j) => (
                    <span key={j} className={s.exampleTag}>{ex}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 내 주제 입력 */}
          {step === 2 && (
            <div className={s.myTopicBox}>
              <div className={s.myTopicLabel}>
                <span className={s.step}>STEP 3</span>
                <span>내 채널 주제 입력</span>
              </div>
              <div className={s.searchRow}>
                <input className={s.input}
                  placeholder="예: 직장인 일상, AI 자기계발, 번아웃 극복"
                  value={myTopic}
                  onChange={e => setMyTopic(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generateCombinations()} />
                <button className={`${s.searchBtn} ${myTopic.trim() ? s.searchBtnActive : ''}`}
                  onClick={generateCombinations} disabled={!myTopic.trim() || loading}>
                  {loading
                    ? <span className={s.loadingDots}>{loadingMsg}<span>.</span><span>.</span><span>.</span></span>
                    : '✨ 블루오션 조합 찾기'}
                </button>
              </div>
              <p className={s.searchHint}>잘 되는 형식 × 내 주제 = 아직 없는 조합!</p>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: 블루오션 조합 */}
      {combinations.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionLabel}>
            <span className={s.step}>블루오션</span>
            <span>아직 없는 조합 발견!</span>
            <span className={s.liveTag}>🌊 {myTopic}</span>
          </div>

          {/* 공식 표시 */}
          <div className={s.formulaRow}>
            <span className={s.formulaItem}>잘 되는 형식</span>
            <span className={s.formulaCross}>×</span>
            <span className={s.formulaItem}>{myTopic}</span>
            <span className={s.formulaArrow}>→</span>
            <span className={s.formulaResult}>🌊 블루오션</span>
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
                    <span className={`${s.compBadge} ${competitionColor(c.competition)}`}>
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
                <div className={s.hookBox}>
                  <span className={s.hookLabel}>훅</span>
                  <p className={s.hookText}>"{c.hook}"</p>
                </div>
                <div className={s.blueoceanBox}>
                  <span className={s.blueoceanLabel}>🌊</span>
                  <span className={s.blueoceanText}>{c.reason}</span>
                </div>
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

      {/* 빈 상태 */}
      {step === 1 && !loading && (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📺</div>
          <p>유튜브 키워드를 입력하면<br />실제 검색으로 잘 되는 형식을 찾아드려요</p>
          <div className={s.formulaRow} style={{ justifyContent: 'center' }}>
            <span className={s.formulaItem}>잘 되는 형식</span>
            <span className={s.formulaCross}>×</span>
            <span className={s.formulaItem}>내 주제</span>
            <span className={s.formulaArrow}>→</span>
            <span className={s.formulaResult}>🌊 블루오션</span>
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
        `당신은 AI 버추얼 인플루언서 "서여리"의 콘텐츠 기획자입니다.
반드시 JSON 배열만 반환하세요. 마크다운 없이.
형식: [{"title":"제목","hook":"첫 3초 훅 대사","summary":"스토리 요약 2줄","tags":["태그1","태그2"]}]`,
        `트렌드 키워드: "${selectedTrend.keyword}"
서여리 감정 톤: "${selectedEmotion}"
서여리 상황: "${selectedSituation}"
스토리 3개 제안해줘. 훅은 시청자가 멈추게 만드는 첫 문장이어야 해.`
      )
      setStories(JSON.parse(text))
    } catch { setError('생성 실패. 다시 시도해주세요.') }
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
                  <div className={s.storyHeader}><span className={s.storyNum}>0{i+1}</span><h3 className={s.storyTitle}>{story.title}</h3><button className={s.saveBtn} onClick={() => saveStory(story)}>{saved.find(x => x.title === story.title) ? '✅' : '💾 저장'}</button></div>
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
        {stories.length === 0 && saved.length === 0 && !loading && <div className={s.empty}><div className={s.emptyIcon}>✦</div><p>트렌드 + 감정 + 상황을 선택하고<br />스토리를 생성해보세요</p></div>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// 🎬 시리즈 기획
// ════════════════════════════════════════════════
function SeriesPlanTab() {
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
        `당신은 서여리 채널의 시리즈 기획자입니다.
반드시 JSON 배열만 반환하세요. 마크다운 없이.
형식: [{"seriesTitle":"제목","concept":"콘셉트 한 줄","episodeCount":숫자,"episodes":[{"ep":1,"title":"화 제목","keyword":"키워드","hook":"훅"}],"targetReaction":"예상 반응","tags":["태그"]}]
episodes 4개 샘플만.`,
        `채널명: ${channel.name}, 콘셉트: ${channel.concept}, 타깃: ${channel.target}, 장르: ${channel.genre}, 톤: ${channel.tone}
시리즈 주제: "${keyword}" — 기획 개요 2개 제안해줘.`,
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
