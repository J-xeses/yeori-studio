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

// ════════════════════════════════════════════════
// 📺 유튜브 분석 탭
// ════════════════════════════════════════════════
function YoutubeAnalysisTab() {
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState([])

  const analyze = async () => {
    if (!keyword.trim()) return
    setLoading(true); setError(''); setResult(null)
    try {
      const text = await callClaude(
        `당신은 유튜브 콘텐츠 전략가입니다.
블루오션은 "새 주제"가 아닌 "잘 되는 형식 × 새 주제"의 조합에서 나옵니다.
서여리는 20대 중반 한국 직장인 AI 인플루언서입니다. 타깃: 20-40대 한국 직장인.
반드시 JSON만 반환하세요. 마크다운 없이.
형식:
{
  "formats": [{"name":"형식명","desc":"설명","example":"대표 채널/영상 예시","score":숫자}],
  "topics": [{"name":"주제명","desc":"설명","demand":"수요 설명","score":숫자}],
  "combinations": [{"format":"형식","topic":"주제","title":"콘텐츠 제목 예시","hook":"첫 문장 훅","blueocean":"블루오션인 이유","score":숫자}]
}
formats 4개, topics 4개, combinations 4개 제시하세요.
combinations는 반드시 서여리 캐릭터에 맞는 조합이어야 합니다.`,
        `유튜브 키워드: "${keyword}"
이 키워드를 중심으로:
1. 현재 잘 되는 영상 형식 4가지 분석
2. 관련 인기 주제 4가지 분석
3. 서여리 채널에 적합한 "형식 × 주제" 블루오션 조합 4가지 제안
각 조합은 아직 없거나 적은 조합이어야 합니다.`,
        1500
      )
      setResult(JSON.parse(text))
    } catch { setError('분석 실패. 다시 시도해주세요.') }
    finally { setLoading(false) }
  }

  const saveCombination = (combo) => {
    if (saved.find(x => x.title === combo.title)) return
    setSaved(prev => [{ ...combo, keyword, savedAt: new Date().toLocaleString('ko-KR'), id: Date.now() }, ...prev])
  }

  return (
    <div className={s.ytWrap}>
      {/* 검색 */}
      <div className={s.section}>
        <div className={s.sectionLabel}><span className={s.step}>🔍</span><span>유튜브 키워드 입력</span></div>
        <div className={s.searchRow}>
          <input className={s.input} placeholder="예: 직장인 자기계발, 번아웃, 퇴사"
            value={keyword} onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()} />
          <button className={`${s.searchBtn} ${keyword.trim() ? s.searchBtnActive : ''}`}
            onClick={analyze} disabled={!keyword.trim() || loading}>
            {loading ? <span className={s.loadingDots}>분석 중<span>.</span><span>.</span><span>.</span></span> : '분석 →'}
          </button>
        </div>
        <p className={s.searchHint}>잘 되는 형식 × 주제 = 블루오션 조합을 찾아드려요</p>
        {error && <div className={s.error}>{error}</div>}
      </div>

      {result && (
        <>
          {/* 형식 + 주제 나란히 */}
          <div className={s.analysisGrid}>
            {/* 잘 되는 형식 */}
            <div className={s.section}>
              <div className={s.sectionLabel}><span className={s.step}>🎬</span><span>잘 되는 형식</span></div>
              <div className={s.analysisList}>
                {result.formats?.map((f, i) => (
                  <div key={i} className={s.analysisCard}>
                    <div className={s.analysisHeader}>
                      <span className={s.analysisName}>{f.name}</span>
                      <div className={s.miniScoreBar}>
                        <div className={s.miniScoreFill} style={{ width: `${f.score}%` }} />
                        <span className={s.miniScoreNum}>{f.score}</span>
                      </div>
                    </div>
                    <p className={s.analysisDesc}>{f.desc}</p>
                    <span className={s.analysisExample}>예: {f.example}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 인기 주제 */}
            <div className={s.section}>
              <div className={s.sectionLabel}><span className={s.step}>📌</span><span>인기 주제</span></div>
              <div className={s.analysisList}>
                {result.topics?.map((t, i) => (
                  <div key={i} className={s.analysisCard}>
                    <div className={s.analysisHeader}>
                      <span className={s.analysisName}>{t.name}</span>
                      <div className={s.miniScoreBar}>
                        <div className={s.miniScoreFill} style={{ width: `${t.score}%` }} />
                        <span className={s.miniScoreNum}>{t.score}</span>
                      </div>
                    </div>
                    <p className={s.analysisDesc}>{t.desc}</p>
                    <span className={s.analysisExample}>{t.demand}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 블루오션 조합 */}
          <div className={s.section}>
            <div className={s.sectionLabel}>
              <span className={s.step}>✦</span>
              <span>서여리 블루오션 조합</span>
              <span className={s.blueTag}>형식 × 주제 = 새 콘텐츠</span>
            </div>
            <div className={s.comboList}>
              {result.combinations?.map((c, i) => (
                <div key={i} className={s.comboCard}>
                  <div className={s.comboHeader}>
                    <div className={s.comboFormula}>
                      <span className={s.comboFormat}>{c.format}</span>
                      <span className={s.comboCross}>×</span>
                      <span className={s.comboTopic}>{c.topic}</span>
                    </div>
                    <div className={s.comboRight}>
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
                    <span className={s.blueoceanLabel}>🌊 블루오션</span>
                    <span className={s.blueoceanText}>{c.blueocean}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
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
                <div className={s.comboFormula} style={{ marginBottom: 4 }}>
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

      {!result && !loading && (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📺</div>
          <p>키워드를 입력하면<br />잘 되는 형식 × 주제 조합을 분석해드려요</p>
          <div className={s.formulaBox}>
            <span className={s.formulaItem}>잘 되는 형식</span>
            <span className={s.formulaCross}>×</span>
            <span className={s.formulaItem}>인기 주제</span>
            <span className={s.formulaArrow}>→</span>
            <span className={s.formulaResult}>블루오션</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════
// 💡 단편 아이디어 탭
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
서여리는 20대 중반 한국 직장인 AI 인플루언서로, 진솔하고 공감가는 이야기를 전합니다.
반드시 JSON 배열만 반환하세요. 마크다운 없이.
형식: [{"title":"제목","hook":"첫 3초 훅 대사","summary":"스토리 요약 2줄","tags":["태그1","태그2"]}]`,
        `트렌드 키워드: "${selectedTrend.keyword}"
서여리 감정 톤: "${selectedEmotion}"
서여리 상황: "${selectedSituation}"
이 조합으로 서여리가 직접 경험한 것처럼 전달할 수 있는 유튜브 스토리 3개를 제안해줘.
훅은 반드시 시청자가 멈추게 만드는 첫 문장이어야 해.`
      )
      setStories(JSON.parse(text))
    } catch { setError('스토리 생성 실패. 다시 시도해주세요.') }
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
              <button key={t.keyword}
                className={`${s.trendItem} ${selectedTrend?.keyword === t.keyword ? s.selected : ''}`}
                onClick={() => setSelectedTrend(t)}>
                <div className={s.trendInfo}>
                  <span className={s.trendKeyword}>{t.keyword}</span>
                  <span className={s.trendSource}>{t.source}</span>
                </div>
                <div className={s.scoreBar}>
                  <div className={s.scoreFill} style={{ width: `${t.score}%` }} />
                  <span className={s.scoreNum}>{t.score}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>02</span><span>서여리 감정 톤</span></div>
          <div className={s.chips}>
            {YEORI_EMOTIONS.map(e => (
              <button key={e} className={`${s.chip} ${selectedEmotion === e ? s.chipActive : ''}`}
                onClick={() => setSelectedEmotion(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div className={s.section}>
          <div className={s.sectionLabel}><span className={s.step}>03</span><span>서여리 상황</span></div>
          <div className={s.chips}>
            {YEORI_SITUATIONS.map(sit => (
              <button key={sit} className={`${s.chip} ${selectedSituation === sit ? s.chipActive : ''}`}
                onClick={() => setSelectedSituation(sit)}>{sit}</button>
            ))}
          </div>
        </div>
        <button className={`${s.genBtn} ${canGenerate ? s.genBtnActive : ''}`}
          onClick={generateStories} disabled={!canGenerate || loading}>
          {loading ? <span className={s.loadingDots}>생성 중<span>.</span><span>.</span><span>.</span></span> : '✨ 스토리 3개 생성'}
        </button>
        {canGenerate && (
          <div className={s.summary}>
            <span className={s.summaryTag}>#{selectedTrend.keyword}</span>
            <span className={s.summaryTag}>#{selectedEmotion}</span>
            <span className={s.summaryTag}>#{selectedSituation}</span>
          </div>
        )}
        {error && <div className={s.error}>{error}</div>}
      </div>
      <div className={s.resultCol}>
        {stories.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>✦</span><span>생성된 스토리</span></div>
            <div className={s.storyList}>
              {stories.map((story, i) => (
                <div key={i} className={s.storyCard}>
                  <div className={s.storyHeader}>
                    <span className={s.storyNum}>0{i + 1}</span>
                    <h3 className={s.storyTitle}>{story.title}</h3>
                    <button className={s.saveBtn} onClick={() => saveStory(story)}>
                      {saved.find(x => x.title === story.title) ? '✅' : '💾 저장'}
                    </button>
                  </div>
                  <div className={s.hookBox}>
                    <span className={s.hookLabel}>훅</span>
                    <p className={s.hookText}>"{story.hook}"</p>
                  </div>
                  <p className={s.storySummary}>{story.summary}</p>
                  <div className={s.tagRow}>
                    {story.tags?.map(tag => <span key={tag} className={s.tag}>#{tag}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {saved.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>📁</span><span>저장된 스토리 ({saved.length})</span></div>
            <div className={s.archiveList}>
              {saved.map(story => (
                <div key={story.id} className={s.archiveCard}>
                  <div className={s.archiveHeader}>
                    <span className={s.archiveTitle}>{story.title}</span>
                    <span className={s.archiveDate}>{story.savedAt}</span>
                    <button className={s.removeBtn} onClick={() => setSaved(prev => prev.filter(x => x.id !== story.id))}>✕</button>
                  </div>
                  <p className={s.archiveHook}>"{story.hook}"</p>
                  <div className={s.tagRow}>
                    {story.tags?.map(tag => <span key={tag} className={s.tag}>#{tag}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {stories.length === 0 && saved.length === 0 && !loading && (
          <div className={s.empty}>
            <div className={s.emptyIcon}>✦</div>
            <p>트렌드 + 감정 + 상황을 선택하고<br />스토리를 생성해보세요</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// 🎬 시리즈 기획 탭
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

  const saveChannel = () => { if (channelComplete) setChannelSaved(true) }
  const updateChannel = (key, val) => { setChannel(p => ({ ...p, [key]: val })); setChannelSaved(false) }

  const generatePlans = async () => {
    if (!canGenerate) return
    setLoading(true); setError(''); setPlans([])
    try {
      const text = await callClaude(
        `당신은 AI 버추얼 인플루언서 "서여리" 채널의 시리즈 기획자입니다.
반드시 JSON 배열만 반환하세요. 마크다운 없이.
형식: [{"seriesTitle":"시리즈 제목","concept":"전체 콘셉트 한 줄","episodeCount":숫자,"episodes":[{"ep":1,"title":"화 제목","keyword":"핵심 키워드","hook":"첫 문장 훅"}],"targetReaction":"예상 시청자 반응","tags":["태그"]}]
episodes는 4개 샘플만 제시하세요.`,
        `채널명: ${channel.name}
채널 콘셉트: ${channel.concept}
타깃 시청자: ${channel.target}
장르: ${channel.genre}
서여리 톤: ${channel.tone}
시리즈 키워드/주제: "${keyword}"
이 채널 설정에 맞는 시리즈 기획 개요 2개를 제안해줘.`,
        1500
      )
      setPlans(JSON.parse(text))
    } catch { setError('기획 생성 실패. 다시 시도해주세요.') }
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
          <div className={s.sectionLabel}>
            <span className={s.step}>채널</span><span>채널 설정</span>
            {channelSaved && <span className={s.savedBadge}>✓ 저장됨</span>}
          </div>
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>채널명</label>
            <input className={s.input} placeholder="예: 서여리 일상 채널"
              value={channel.name} onChange={e => updateChannel('name', e.target.value)} />
          </div>
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>채널 콘셉트 한 줄</label>
            <input className={s.input} placeholder="예: 직장인 AI 인플루언서의 진솔한 일상"
              value={channel.concept} onChange={e => updateChannel('concept', e.target.value)} />
          </div>
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>타깃 시청자</label>
            <div className={s.chips}>
              {TARGETS.map(t => (
                <button key={t} className={`${s.chip} ${channel.target === t ? s.chipActive : ''}`}
                  onClick={() => updateChannel('target', t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>주력 장르</label>
            <div className={s.chips}>
              {GENRES.map(g => (
                <button key={g} className={`${s.chip} ${channel.genre === g ? s.chipActive : ''}`}
                  onClick={() => updateChannel('genre', g)}>{g}</button>
              ))}
            </div>
          </div>
          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>서여리 톤</label>
            <div className={s.chips}>
              {TONES.map(t => (
                <button key={t} className={`${s.chip} ${channel.tone === t ? s.chipActive : ''}`}
                  onClick={() => updateChannel('tone', t)}>{t}</button>
              ))}
            </div>
          </div>
          <button className={`${s.genBtn} ${channelComplete ? s.genBtnActive : ''}`}
            onClick={saveChannel} disabled={!channelComplete}>
            {channelSaved ? '✅ 채널 설정 완료' : '💾 채널 설정 저장'}
          </button>
        </div>
        {channelSaved && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>기획</span><span>시리즈 주제 / 키워드</span></div>
            <input className={s.input} placeholder="예: 번아웃 극복 30일 챌린지"
              value={keyword} onChange={e => setKeyword(e.target.value)} />
            <button className={`${s.genBtn} ${canGenerate ? s.genBtnActive : ''} ${s.mtop}`}
              onClick={generatePlans} disabled={!canGenerate || loading}>
              {loading ? <span className={s.loadingDots}>기획 생성 중<span>.</span><span>.</span><span>.</span></span> : '🎬 시리즈 기획 개요 생성'}
            </button>
            {error && <div className={s.error}>{error}</div>}
          </div>
        )}
      </div>
      <div className={s.resultCol}>
        {plans.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>✦</span><span>생성된 기획 개요</span></div>
            <div className={s.storyList}>
              {plans.map((plan, i) => (
                <div key={i} className={s.seriesCard}>
                  <div className={s.seriesHeader}>
                    <div className={s.seriesTitleGroup}>
                      <div className={s.seriesBadge}>시리즈 {i + 1}</div>
                      <h3 className={s.seriesTitle}>{plan.seriesTitle}</h3>
                      <p className={s.seriesConcept}>{plan.concept}</p>
                    </div>
                    <button className={s.saveBtn} onClick={() => savePlan(plan)}>
                      {saved.find(x => x.seriesTitle === plan.seriesTitle) ? '✅' : '💾 저장'}
                    </button>
                  </div>
                  <div className={s.seriesMeta}>
                    <span className={s.metaItem}>📺 총 {plan.episodeCount}화</span>
                    <span className={s.metaItem}>👥 {plan.targetReaction}</span>
                  </div>
                  <div className={s.episodeList}>
                    <div className={s.episodeHeader}>샘플 에피소드</div>
                    {plan.episodes?.map(ep => (
                      <div key={ep.ep} className={s.episodeRow}>
                        <span className={s.epNum}>{ep.ep}화</span>
                        <div className={s.epInfo}>
                          <span className={s.epTitle}>{ep.title}</span>
                          <span className={s.epHook}>"{ep.hook}"</span>
                        </div>
                        <span className={s.epKeyword}>{ep.keyword}</span>
                      </div>
                    ))}
                  </div>
                  <div className={s.tagRow}>
                    {plan.tags?.map(tag => <span key={tag} className={s.tag}>#{tag}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {saved.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionLabel}><span className={s.step}>📁</span><span>저장된 기획 ({saved.length})</span></div>
            <div className={s.archiveList}>
              {saved.map(plan => (
                <div key={plan.id} className={s.archiveCard}>
                  <div className={s.archiveHeader}>
                    <span className={s.archiveTitle}>{plan.seriesTitle}</span>
                    <span className={s.archiveDate}>{plan.savedAt}</span>
                    <button className={s.removeBtn} onClick={() => setSaved(prev => prev.filter(x => x.id !== plan.id))}>✕</button>
                  </div>
                  <p className={s.archiveHook}>{plan.concept}</p>
                  <span className={s.metaItem}>📺 {plan.episodeCount}화</span>
                  <div className={s.tagRow}>
                    {plan.tags?.map(tag => <span key={tag} className={s.tag}>#{tag}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {plans.length === 0 && saved.length === 0 && !loading && (
          <div className={s.empty}>
            <div className={s.emptyIcon}>🎬</div>
            <p>채널 설정을 완료하고<br />시리즈 주제를 입력해보세요</p>
          </div>
        )}
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
          <p className={s.subtitle}>트렌드 분석 → 블루오션 조합 → 콘텐츠 기획</p>
        </div>
      </div>
      <div className={s.innerTabs}>
        {INNER_TABS.map(t => (
          <button key={t.id}
            className={`${s.innerTab} ${activeInner === t.id ? s.innerTabActive : ''}`}
            onClick={() => setActiveInner(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {activeInner === 'youtube' && <YoutubeAnalysisTab />}
      {activeInner === 'short'   && <ShortIdeaTab />}
      {activeInner === 'series'  && <SeriesPlanTab />}
    </div>
  )
}
