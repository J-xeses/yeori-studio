import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { elTTS, elVoices, freeTTS } from '../lib/api'
import { setGPoint, loadGPoints } from '../lib/gpoints'
import { resolveEpisodeCode } from '../lib/episodeCode'
import { cleanForTTS, splitSpeakerSegments, applyReadings, DEFAULT_READINGS } from '../lib/ttsText'
import { isFreeVoice, freeVoiceName, speedToRate } from '../lib/freeTts'
import { EpisodeOverviewBlock, CutList } from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import VoicePicker from '../components/VoicePicker'
import s from './TTSTab.module.css'

const DEFAULT_VOICE_ID = 'RmYuvmCbqOMBJxDLW4k8'
const FALLBACK_DEFAULTS = {
  dialogue:  { speed: 0.9,  stability: 30, similarity: 75 },
  narration: { speed: 0.85, stability: 55, similarity: 75 },
}

function makeTrack(type, text = '', trackDefaults, speaker = null) {
  const defs = trackDefaults || FALLBACK_DEFAULTS
  return {
    id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    text,
    speaker,     // 다중 화자 대사에서 이 트랙을 말하는 화자 이름 (없으면 null)
    url: null,
    voiceId: '', // 비어있으면 화자별 목소리 → 탭 기본값 순으로 상속
    settings: { ...(defs[type] || FALLBACK_DEFAULTS[type]) },
  }
}

function initTracksForCut(cut, trackDefaults) {
  const tracks = []
  if (cut.dialogue?.trim()) {
    // 다중 화자면 화자별 트랙으로 분리 (지아 트랙 / 여리 트랙 … 각각 다른 목소리 지정)
    for (const seg of splitSpeakerSegments(cut.dialogue)) {
      tracks.push(makeTrack('dialogue', seg.text, trackDefaults, seg.speaker))
    }
  }
  if (cut.narration?.trim()) {
    tracks.push(makeTrack('narration', cleanForTTS(cut.narration).clean, trackDefaults))
  }
  if (!tracks.length) tracks.push(makeTrack('dialogue', '', trackDefaults))
  return tracks
}

function makeVoiceTab(idx, voiceId) {
  return { id: `v${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, label: `목소리 ${idx}`, voiceId }
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate  = buffer.sampleRate
  const length      = buffer.length
  const ab   = new ArrayBuffer(44 + length * numChannels * 2)
  const view = new DataView(ab)
  const wr   = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
  wr(0, 'RIFF'); view.setUint32(4, 36 + length * numChannels * 2, true)
  wr(8, 'WAVE'); wr(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true)
  wr(36, 'data'); view.setUint32(40, length * numChannels * 2, true)
  let off = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
      view.setInt16(off, s * 0x7FFF, true); off += 2
    }
  }
  return ab
}

export default function TTSTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys, ttsSettings, elevenLabsStatus } = state
  // episode.code(3차 정식 필드) 우선, 레거시 에피소드는 과도기 방식(번호)으로 대체
  const episodeCode = resolveEpisodeCode(state.episode)
  const {
    tracks = {}, mergedUrls = {}, g3Confirmed = {},
    voiceTabs = {}, activeVoiceTab = {}, focusCutId = null,
  } = state.ttsTabState || {}
  const trackDefaults = ttsSettings.trackDefaults || FALLBACK_DEFAULTS
  const speakerVoices = ttsSettings.speakerVoices || {}
  const readingMap = ttsSettings.readingMap || {}   // 사용자 추가 읽기교정 (기본 사전 위에 덮어씀)
  const speakClean = (raw) => applyReadings(cleanForTTS(raw).clean, readingMap)

  // 캐릭터 레지스트리 — 화자명 별칭(지아↔한지아, 여리↔서여리)을 정식 이름으로 통일하기 위함.
  // 대본마다 화자 표기가 달라도 "화자별 목소리" 는 컷과 무관하게 한 인물 = 한 항목이 되도록.
  const [charList, setCharList] = useState([])
  useEffect(() => {
    fetch('http://localhost:3001/api/characters')
      .then(r => r.json())
      .then(d => setCharList(Object.entries(d.characters || {})
        .filter(([id]) => !id.startsWith('_'))
        .map(([, c]) => ({ name: c.name, aliases: c.aliases || [], primary: !!c.primary }))
        .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))))
      .catch(() => {})
  }, [])
  const canonSpeaker = (name) => {
    const n = String(name || '').trim()
    if (!n) return n
    const nl = n.toLowerCase()
    const hit = charList.find(c =>
      c.name?.toLowerCase() === nl || c.aliases.some(a => String(a).toLowerCase() === nl))
    return hit?.name || n
  }

  const speakerSettings = ttsSettings.speakerSettings || {}

  // 별칭 키를 정식 이름으로 접은 조회 맵 — 과거에 "지아" 키로 저장됐어도 "한지아" 로 찾게.
  // (뒤 항목이 이기므로 정식 이름 키가 별칭 키보다 우선)
  const foldByCanon = (obj) => {
    const out = {}
    for (const [k, v] of Object.entries(obj || {})) {
      const c = canonSpeaker(k)
      if (c === k) out[c] = v            // 정식 이름 키 — 항상 우선
      else if (!(c in out)) out[c] = v   // 별칭 키 — 정식 키 없을 때만
    }
    return out
  }
  const speakerVoicesByCanon   = foldByCanon(speakerVoices)
  const speakerSettingsByCanon = foldByCanon(speakerSettings)
  const speakerVoiceFor   = (name) => speakerVoicesByCanon[canonSpeaker(name)]
  const speakerSettingFor = (name) => speakerSettingsByCanon[canonSpeaker(name)]

  // 트랙 목소리 상속: 트랙 직접지정 → 화자별 목소리(정식이름 기준) → 목소리 탭 기본값 → 전역 기본값
  const resolveVoiceId = (track, variant) =>
    track.voiceId?.trim()
    || (track.speaker && speakerVoiceFor(track.speaker))
    || variant?.voiceId || ttsSettings.voiceId || DEFAULT_VOICE_ID

  // 화자별 목소리는 항상 정식 이름 키로 저장 → 대본 표기가 "지아"든 "한지아"든 한 곳으로 모임
  const setSpeakerVoice = (name, id) =>
    dispatch({ type: 'SET_TTS', p: { speakerVoices: { ...speakerVoices, [canonSpeaker(name)]: id } } })

  // 화자별 미세조정 — 이름이 명시된 화자 트랙(CUT 15/21 두샷 등)에만 적용. 전 컷 공통.
  // 이름 없는 대사(대부분의 서여리 대사)는 트랙 개별값(= trackDefaults) 을 그대로 쓴다.
  const resolveSettings = (track) =>
    (track.speaker && speakerSettingFor(track.speaker)) || track.settings
  const setSpeakerSetting = (name, key, value) => {
    const canon = canonSpeaker(name)
    const cur = speakerSettings[canon] || { ...FALLBACK_DEFAULTS.dialogue }
    dispatch({ type: 'SET_TTS', p: { speakerSettings: { ...speakerSettings, [canon]: { ...cur, [key]: value } } } })
  }
  const clearSpeakerSetting = (name) => {
    const canon = canonSpeaker(name)
    const next = { ...speakerSettings }; delete next[canon]
    dispatch({ type: 'SET_TTS', p: { speakerSettings: next } })
  }

  // 읽기 교정 — 기본 사전(DEFAULT_READINGS) 위에 사용자 항목(readingMap) 을 덮어씀
  const setReading = (from, to) => {
    const f = String(from || '').trim()
    if (!f) return
    dispatch({ type: 'SET_TTS', p: { readingMap: { ...readingMap, [f]: String(to || '').trim() } } })
  }
  const removeReading = (from) => {
    const next = { ...readingMap }; delete next[from]
    dispatch({ type: 'SET_TTS', p: { readingMap: next } })
  }
  const [newRead, setNewRead] = useState({ from: '', to: '' })

  const [activeCutIdx, setActiveCutIdx]   = useState(0)
  const [voiceInput,   setVoiceInput]     = useState(ttsSettings.voiceId || DEFAULT_VOICE_ID)
  const [myVoices,     setMyVoices]       = useState([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [trackLoading,  setTrackLoading]  = useState({})
  const [trackConfirming, setTrackConfirming] = useState({})
  const [merging,       setMerging]       = useState({})
  const [batchRunning,  setBatchRunning]  = useState(false)
  const [saving,        setSaving]        = useState({})
  const [saved,         setSaved]         = useState({})
  const [gData, setGData] = useState(() => loadGPoints())

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  // 편집메타 "컷 싱크" 패널에서 특정 컷으로 딥링크해 온 경우 — 그 컷을 펼치고 플래그 해제
  useEffect(() => {
    if (!focusCutId) return
    const idx = cuts.findIndex(c => c.id === focusCutId)
    if (idx >= 0) setActiveCutIdx(idx)
    dispatch({ type: 'SET_TTS_TAB_STATE', p: { focusCutId: null } })
  }, [focusCutId, cuts, dispatch])

  const setTTS = (p) => dispatch({ type: 'SET_TTS_TAB_STATE', p })

  // ── 목소리 탭 (컷당 여러 목소리 버전) ──────────────────────
  const getVoiceTabsForCut = (cutId) =>
    voiceTabs[cutId] || [{ id: 'v1', label: '목소리 1', voiceId: ttsSettings.voiceId || DEFAULT_VOICE_ID }]

  const getActiveVoiceIdx = (cutId) => activeVoiceTab[cutId] ?? 0

  const trackKey = (cutId, voiceTabId) => `${cutId}__${voiceTabId}`

  const getTracksForKey = (key, cutForInit) => {
    if (tracks[key]) return tracks[key]
    return cutForInit ? initTracksForCut(cutForInit, trackDefaults) : []
  }

  const setTracksForKey = (key, updater, cutForInit) => {
    const cur  = getTracksForKey(key, cutForInit)
    const next = typeof updater === 'function' ? updater(cur) : updater
    setTTS({ tracks: { ...tracks, [key]: next } })
  }

  const hasCutMergedAny = (cutId) =>
    Object.keys(mergedUrls).some(k => k.startsWith(`${cutId}__`))

  const setActiveVoiceIdxFor = (cutId, idx) => {
    setTTS({ activeVoiceTab: { ...activeVoiceTab, [cutId]: idx } })
  }

  const addVoiceTab = (cutId) => {
    const c = cuts.find(c => c.id === cutId)
    const existing = getVoiceTabsForCut(cutId)
    const newTab = makeVoiceTab(existing.length + 1, ttsSettings.voiceId || DEFAULT_VOICE_ID)
    const nextTabs = [...existing, newTab]
    const key = trackKey(cutId, newTab.id)
    setTTS({
      voiceTabs: { ...voiceTabs, [cutId]: nextTabs },
      activeVoiceTab: { ...activeVoiceTab, [cutId]: nextTabs.length - 1 },
      tracks: { ...tracks, [key]: c ? initTracksForCut(c, trackDefaults) : [] },
    })
  }

  const removeVoiceTab = (cutId, voiceTabId) => {
    const existing = getVoiceTabsForCut(cutId)
    if (existing.length <= 1) return
    if (!confirm('이 목소리 탭의 트랙과 결과가 삭제됩니다. 계속할까요?')) return
    const removedIdx = existing.findIndex(v => v.id === voiceTabId)
    const nextTabs = existing.filter(v => v.id !== voiceTabId)
    const key = trackKey(cutId, voiceTabId)
    const nextTracks = { ...tracks }; delete nextTracks[key]
    const nextMerged = { ...mergedUrls }; delete nextMerged[key]
    const curActive = getActiveVoiceIdx(cutId)
    const nextActive = Math.max(0, curActive >= nextTabs.length ? nextTabs.length - 1 : (removedIdx < curActive ? curActive - 1 : curActive))
    setTTS({
      voiceTabs: { ...voiceTabs, [cutId]: nextTabs },
      activeVoiceTab: { ...activeVoiceTab, [cutId]: nextActive },
      tracks: nextTracks,
      mergedUrls: nextMerged,
    })
  }

  const updateVariantVoiceId = (cutId, voiceTabId, voiceId) => {
    const existing = getVoiceTabsForCut(cutId)
    const nextTabs = existing.map(v => v.id === voiceTabId ? { ...v, voiceId } : v)
    setTTS({ voiceTabs: { ...voiceTabs, [cutId]: nextTabs } })
  }

  // 대본(대사/나레이션)에서 트랙을 다시 만든다 — 다중 화자면 화자별로 분리.
  // 현재 트랙/오디오는 버려짐(persisted ttsTabState 가 stale 할 때 복구용).
  const reloadTracksFromScript = (cutId, voiceTabId) => {
    const c = cuts.find(x => x.id === cutId)
    if (!c) return
    const hasScript = !!(c.dialogue?.trim() || c.narration?.trim())
    const msg = hasScript
      ? `CUT ${c.no} 트랙을 대본에서 다시 만듭니다. 현재 트랙과 생성된 오디오가 사라집니다. 계속할까요?`
      : `CUT ${c.no} 대본에 대사/나레이션이 없습니다. 빈 트랙으로 초기화됩니다. 계속할까요?`
    if (!confirm(msg)) return
    const key = trackKey(cutId, voiceTabId)
    const nextMerged = { ...mergedUrls }; delete nextMerged[key]
    setTTS({ tracks: { ...tracks, [key]: initTracksForCut(c, trackDefaults) }, mergedUrls: nextMerged })
  }

  const reloadAllFromScript = () => {
    if (!confirm('모든 컷의 트랙을 대본에서 다시 만듭니다. 생성된 오디오와 합친 결과가 전부 사라집니다. 계속할까요?')) return
    // 현재 컷·목소리탭 조합만 남기고 재생성 (renumber·대본 교체로 생긴 orphan 키 제거)
    const nextTracks = {}
    const nextMerged = {}
    for (const c of cuts) {
      for (const vt of getVoiceTabsForCut(c.id)) {
        const key = trackKey(c.id, vt.id)
        nextTracks[key] = initTracksForCut(c, trackDefaults)
        if (mergedUrls[key]) delete nextMerged[key]   // 병합 결과는 버림
      }
    }
    setTTS({ tracks: nextTracks, mergedUrls: nextMerged })
  }

  // TTS 탭에서 쉼표·물결표 등으로 다듬은 최종 문구를 대본(cut.dialogue/narration)에 반영.
  // 화자 표기·따옴표를 복원해 원래 대본 포맷으로 재조립(다시 불러와도 splitSpeakerSegments 로 동일하게 파싱됨).
  // state.cuts 는 ScriptGenTab 과 공유하는 전역 상태라 반영 즉시 그쪽에도 보이고, 3초 후 studio-state.json 저장.
  const pushTracksToScript = (cutId, voiceTabId) => {
    const c = cuts.find(x => x.id === cutId)
    if (!c) return
    const list = getTracksForKey(trackKey(cutId, voiceTabId), c)
    const hasDialogueTracks  = list.some(t => t.type === 'dialogue')
    const hasNarrationTracks = list.some(t => t.type === 'narration')
    const dialogueText  = list.filter(t => t.type === 'dialogue' && t.text.trim())
      .map(t => t.speaker ? `${t.speaker} "${t.text.trim()}"` : `"${t.text.trim()}"`).join(' / ')
    const narrationText = list.filter(t => t.type === 'narration' && t.text.trim())
      .map(t => t.text.trim()).join(' ')
    if (!hasDialogueTracks && !hasNarrationTracks) { alert('반영할 트랙이 없습니다'); return }
    const preview = [dialogueText, narrationText].filter(Boolean).join('\n') || '(비어있음)'
    if (!confirm(`대본의 CUT ${c.no} 대사/나레이션을 지금 트랙 문구로 덮어씁니다.\n\n${preview}\n\n계속할까요?`)) return
    const patch = {}
    if (hasDialogueTracks)  patch.dialogue  = dialogueText
    if (hasNarrationTracks) patch.narration = narrationText
    dispatch({ type: 'UPDATE_CUT', id: cutId, p: patch })
  }

  const handleCutSelect = (idx) => {
    setActiveCutIdx(idx)
    const c = cuts[idx]
    if (!c) return
    const vts = getVoiceTabsForCut(c.id)
    if (!voiceTabs[c.id]) setTTS({ voiceTabs: { ...voiceTabs, [c.id]: vts } })
    const activeVt = vts[getActiveVoiceIdx(c.id)] || vts[0]
    const key = trackKey(c.id, activeVt.id)
    if (!tracks[key]) setTTS({ tracks: { ...tracks, [key]: initTracksForCut(c, trackDefaults) } })
  }

  const remaining = elevenLabsStatus.remainingChars
  const cut = cuts[activeCutIdx]
  const cutVoiceTabs  = cut ? getVoiceTabsForCut(cut.id) : []
  const activeVIdx    = cut ? getActiveVoiceIdx(cut.id) : 0
  const activeVariant = cutVoiceTabs[activeVIdx] || cutVoiceTabs[0]
  const activeKey     = cut && activeVariant ? trackKey(cut.id, activeVariant.id) : null
  const cutTracks     = activeKey ? getTracksForKey(activeKey, cut) : []

  // ── 목소리 설정 (기본값 · .env 저장용) ────────────────────
  // 캐릭터 목소리/미세조정 즉시 저장 (평소엔 3초 자동저장이지만, 명시적으로 눌러 확인용)
  const [charVoiceSaved, setCharVoiceSaved] = useState(false)
  const saveCharacterVoices = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/studio-state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
      if (!res.ok) throw new Error()
      setCharVoiceSaved(true)
      setTimeout(() => setCharVoiceSaved(false), 2500)
    } catch { alert('저장 실패 — 프록시 서버 연결을 확인하세요') }
  }

  const saveVoiceId = async () => {
    const id = voiceInput.trim()
    if (!id) { alert('Voice ID를 입력하세요'); return }
    dispatch({ type: 'SET_TTS', p: { voiceId: id } })
    try {
      const res = await fetch('http://localhost:3001/api/update-env', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ELEVENLABS_VOICE_ID', value: id }),
      })
      if (!res.ok) throw new Error()
      alert(`저장 완료: ${id}`)
    } catch { alert('.env.local 저장 실패 — 프록시 서버가 실행 중인지 확인하세요') }
  }

  const restoreYeoriVoice = async () => {
    setVoiceInput(DEFAULT_VOICE_ID)
    dispatch({ type: 'SET_TTS', p: { voiceId: DEFAULT_VOICE_ID } })
    try {
      const res = await fetch('http://localhost:3001/api/update-env', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ELEVENLABS_VOICE_ID', value: DEFAULT_VOICE_ID }),
      })
      if (!res.ok) throw new Error()
      alert(`서여리 목소리로 복원 완료`)
    } catch { alert('.env.local 저장 실패') }
  }

  const loadMyVoices = async (silent = false) => {
    if (!apiKeys.elevenLabs) { if (!silent) alert('ElevenLabs API 키를 먼저 연동하세요'); return }
    setVoicesLoading(true)
    try {
      const res = await elVoices(apiKeys.elevenLabs)
      if (!res.ok) throw new Error('API 오류')
      const data = await res.json()
      // 전체 보이스 (클론 + 무료 프리셋 모두) — 한지아 등 추가 캐릭터는 무료 프리셋에서 고를 수 있음
      const voices = data.voices || []
      setMyVoices(voices)
      if (!voices.length && !silent) alert('사용 가능한 목소리가 없습니다.')
    } catch (err) {
      if (!silent) alert('목소리 불러오기 실패: ' + err.message)
    } finally { setVoicesLoading(false) }
  }

  // 탭 진입 시 목소리 목록 자동 로드 — 화자별/트랙 목소리가 ID 대신 이름으로 보이게 (조용히)
  useEffect(() => {
    if (apiKeys.elevenLabs && !myVoices.length && !voicesLoading) loadMyVoices(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys.elevenLabs])

  // ── 한 트랙 텍스트 → 오디오 Response (provider 분기) ──────
  // voiceId 가 'free:' 로 시작하면 무료 TTS(Edge), 아니면 ElevenLabs.
  const ttsRequest = (voiceId, speakText, settings) => {
    if (isFreeVoice(voiceId)) {
      return freeTTS(freeVoiceName(voiceId), speakText, speedToRate(settings.speed))
    }
    if (!apiKeys.elevenLabs) throw new Error('ElevenLabs API 키를 입력하고 연동하세요 (무료 목소리는 키 불필요)')
    return elTTS(apiKeys.elevenLabs, voiceId, {
      text: speakText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability:        settings.stability / 100,
        similarity_boost: settings.similarity / 100,
        speed:            settings.speed,
      },
    })
  }

  // ── 캐릭터 목소리 미리듣기 ───────────────────────────────
  // 정한 목소리 + 미세조정을 그대로 적용해 대본의 실제 대사(없으면 샘플)로 한 문장 생성.
  const [charPreview, setCharPreview] = useState({})   // { [name]: { url, loading } }
  // 톤 확인용 고정 예문 (특정 컷 대사 아님). "대본 대사로" 버튼으로 실제 대사도 넣을 수 있음.
  const sampleLineFor = (name) =>
    `안녕하세요, ${name}예요. 이 톤이 괜찮은지 한 번 들어볼게요. 오늘 준비한 이야기 시작해 볼까요?`
  const scriptLineFor = (name) => {
    for (const c of cuts) {
      if (!c.dialogue?.trim()) continue
      for (const seg of splitSpeakerSegments(c.dialogue)) {
        if (seg.speaker && canonSpeaker(seg.speaker) === canonSpeaker(name) && seg.text.trim())
          return seg.text.trim()
      }
    }
    return null
  }
  const previewText = (name) => charPreview[name]?.text ?? sampleLineFor(name)
  const previewCharacter = async (name) => {
    const voiceId  = speakerVoiceFor(name) || ttsSettings.voiceId || DEFAULT_VOICE_ID
    const settings = speakerSettingFor(name) || FALLBACK_DEFAULTS.dialogue
    const text = applyReadings(cleanForTTS(previewText(name)).clean || sampleLineFor(name), readingMap)
    setCharPreview(p => ({ ...p, [name]: { ...p[name], loading: true } }))
    try {
      const res = await ttsRequest(voiceId, text, settings)
      if (!res.ok) {
        let msg = 'API 오류'
        try { const e = await res.json(); msg = e.detail?.message || e.error || msg } catch { /* */ }
        throw new Error(msg)
      }
      const url = URL.createObjectURL(await res.blob())
      setCharPreview(p => ({ ...p, [name]: { ...p[name], loading: false, url, prevUrl: p[name]?.url } }))
    } catch (err) {
      setCharPreview(p => ({ ...p, [name]: { ...p[name], loading: false } }))
      alert('미리듣기 실패: ' + err.message)
    }
  }

  // ── 트랙 개별 TTS 생성 ───────────────────────────────────
  const generateTrackById = async (cutId, voiceTabId, trackId, trackList) => {
    const key   = trackKey(cutId, voiceTabId)
    const list  = trackList || getTracksForKey(key, cuts.find(c => c.id === cutId))
    const track = list.find(t => t.id === trackId)
    if (!track || !track.text.trim()) { alert('텍스트를 입력하세요'); return null }
    const variant = getVoiceTabsForCut(cutId).find(v => v.id === voiceTabId)
    const voiceId = resolveVoiceId(track, variant)
    // 안전망: textarea에 지문 섞인 원문이 다시 들어와도 괄호/메모는 읽지 않는다 + 읽기교정
    const speakText = speakClean(track.text)
    if (!speakText) { alert('정제 후 읽을 텍스트가 없습니다 (전부 지문/메모)'); return null }

    setTrackLoading(p => ({ ...p, [trackId]: true }))
    try {
      const res = await ttsRequest(voiceId, speakText, resolveSettings(track))
      if (!res.ok) {
        let msg = 'API 오류'
        try { const e = await res.json(); msg = e.detail?.message || e.error || msg } catch { /* non-json */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      setTracksForKey(key, prev => prev.map(t => t.id === trackId ? { ...t, url } : t))
      return url
    } catch (err) {
      alert('TTS 오류: ' + err.message)
      return null
    } finally {
      setTrackLoading(p => ({ ...p, [trackId]: false }))
    }
  }

  // ── 트랙 미리듣기 "확정" — blob URL(브라우저 메모리 전용, 새로고침하면 사라짐)을
  // 서버 mp3 파일로 영구 저장하고 track.url을 그 경로로 교체. 2026-09-12 사용자 요청:
  // "미리듣기 후 만족한 순간 저장해야 그 느낌이 보존된다" — 병합(mergeTracksForKey)까지
  // 안 가도 트랙 단위로 그 자리에서 확정 가능하게.
  const confirmTrackAudio = async (cutId, voiceTabId, trackId, url) => {
    const c = cuts.find(x => x.id === cutId)
    if (!c || !url) return
    const key = trackKey(cutId, voiceTabId)
    const epNo = state.episode?.number ?? ''
    setTrackConfirming(p => ({ ...p, [trackId]: true }))
    try {
      const blob = await (await fetch(url)).blob()
      const saveRes = await fetch(
        `http://localhost:3001/api/save-tts-track?ep=${epNo}&cutNo=${String(c.no).padStart(2, '0')}&trackId=${trackId}`,
        { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/mpeg' }, body: blob }
      )
      const data = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok || !data.url) throw new Error(data.error || '저장 실패')
      setTracksForKey(key, prev => prev.map(t => t.id === trackId ? { ...t, url: data.url } : t))
    } catch (err) {
      alert('오디오 확정 저장 오류: ' + err.message)
    } finally {
      setTrackConfirming(p => ({ ...p, [trackId]: false }))
    }
  }

  // ── 합치기 (Web Audio API) ───────────────────────────────
  const mergeTracksForKey = async (cutId, voiceTabId, localTracks) => {
    const key  = trackKey(cutId, voiceTabId)
    const list = localTracks || getTracksForKey(key, cuts.find(c => c.id === cutId))
    const toMerge = list.filter(t => t.url)
    if (!toMerge.length) { alert('생성된 오디오가 없습니다'); return }

    setMerging(p => ({ ...p, [key]: true }))
    try {
      const audioCtx = new AudioContext()
      const buffers  = await Promise.all(
        toMerge.map(async t => {
          const res = await fetch(t.url)
          const ab  = await res.arrayBuffer()
          return audioCtx.decodeAudioData(ab)
        })
      )
      const totalLen   = buffers.reduce((s, b) => s + b.length, 0)
      const numCh      = Math.max(...buffers.map(b => b.numberOfChannels))
      const sampleRate = audioCtx.sampleRate
      const merged     = audioCtx.createBuffer(numCh, totalLen, sampleRate)
      let offset = 0
      for (const buf of buffers) {
        for (let ch = 0; ch < numCh; ch++) {
          const src = ch < buf.numberOfChannels ? buf.getChannelData(ch) : new Float32Array(buf.length)
          merged.getChannelData(ch).set(src, offset)
        }
        offset += buf.length
      }
      const wav  = audioBufferToWav(merged)
      const blob = new Blob([wav], { type: 'audio/wav' })
      const url  = URL.createObjectURL(blob)
      setTTS({ mergedUrls: { ...mergedUrls, [key]: url } })

      // 서버에 MP3로 저장 (컷당 1개 파일 — 마지막으로 합친 목소리 탭 결과가 저장됨)
      const c2 = cuts.find(c => c.id === cutId)
      if (c2) {
        const epNo = state.episode?.number ?? ''
        setSaving(p => ({ ...p, [key]: true }))
        try {
          const wavRes  = await fetch(url)
          const wavBlob = await wavRes.blob()
          const saveRes = await fetch(
            `http://localhost:3001/api/save-audio?ep=${epNo}&cutNo=${String(c2.no).padStart(2,'0')}`,
            { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wavBlob }
          )
          if (!saveRes.ok) throw new Error('저장 실패')
          setSaved(p => ({ ...p, [key]: true }))
        } catch (err) {
          alert('MP3 저장 오류: ' + err.message)
        } finally {
          setSaving(p => ({ ...p, [key]: false }))
        }
      }

      // videoTab subtitles 동기화
      const allText = list.map(t => t.text).filter(Boolean).join('\n')
      dispatch({ type: 'SET_VIDEO_TAB_STATE',
        p: { subtitles: { ...(state.videoTabState?.subtitles || {}), [cutId]: allText } } })

      const c = cuts.find(c => c.id === cutId)
      if (c) setGPoint(episodeCode, c.no, 'g2', true)
      await audioCtx.close()
    } catch (err) {
      alert('합치기 실패: ' + err.message)
    } finally {
      setMerging(p => ({ ...p, [key]: false }))
    }
  }

  // ── 다운로드 ─────────────────────────────────────────────
  const downloadMerged = async (cutId, voiceTabId, cutNo) => {
    const key = trackKey(cutId, voiceTabId)
    const url = mergedUrls[key]; if (!url) return
    const res  = await fetch(url)
    const blob = await res.blob()
    const a    = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cut_${String(cutNo).padStart(2, '0')}.wav`
    a.click()
  }

  // ── G3 승인 ──────────────────────────────────────────────
  const approveG3 = (cutId, cutNo) => {
    const next = { ...g3Confirmed, [cutId]: true }
    setTTS({ g3Confirmed: next })
    setGPoint(episodeCode, cutNo, 'g3', true)
    if (cuts.every(c => next[c.id])) dispatch({ type: 'SET_TAB', p: 'video' })
  }

  // ── 전체 일괄 생성 (컷당 첫 번째 목소리 탭 기준) ───────────
  const runBatch = async () => {
    setBatchRunning(true)
    try {
      for (const c of cuts) {
        const vts     = getVoiceTabsForCut(c.id)
        const primary = vts[0]
        const key     = trackKey(c.id, primary.id)
        let cutTrks = tracks[key] || initTracksForCut(c, trackDefaults)
        // 각 트랙 생성 (트랙별 목소리 지정이 있으면 우선 사용 — 한 컷에 여러 목소리 조합 가능)
        const updated = []
        for (const t of cutTrks) {
          const speakText = speakClean(t.text)
          if (!speakText) { updated.push(t); continue }
          const voiceId = resolveVoiceId(t, primary)
          setTrackLoading(p => ({ ...p, [t.id]: true }))
          try {
            const res = await ttsRequest(voiceId, speakText, resolveSettings(t))
            if (res.ok) {
              const blob = await res.blob()
              updated.push({ ...t, url: URL.createObjectURL(blob) })
            } else { updated.push(t) }
          } catch { updated.push(t) } finally {
            setTrackLoading(p => ({ ...p, [t.id]: false }))
          }
        }
        // 트랙 상태 저장 후 합치기
        setTTS({ tracks: { ...tracks, [key]: updated }, voiceTabs: { ...voiceTabs, [c.id]: vts } })
        await mergeTracksForKey(c.id, primary.id, updated)
      }
    } finally { setBatchRunning(false) }
  }

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className={s.page}>
      <TabToolbar />
    <div className={s.root}>
      {/* 왼쪽 사이드바 */}
      <div className={s.sidebar}>
        <EpisodeOverviewBlock />
        <div className={s.sideHead}>
          <span className={s.sideTitle}>컷 목록</span>
          <div className={`${s.elBadge} ${elevenLabsStatus.connected ? s.connected : ''}`}>
            {elevenLabsStatus.connected ? `${remaining.toLocaleString()}자 남음` : 'EL 미연결'}
          </div>
        </div>
        <CutList
          cuts={cuts} gData={gData} episodeCode={episodeCode} maxStage={3}
          activeCutId={cuts[activeCutIdx]?.id}
          onCutClick={c => handleCutSelect(cuts.findIndex(x => x.id === c.id))}
          renderExtra={c => (
            // 실제 G3 승인 여부는 CutList의 공유 배지가 보여주므로, 여기선 그걸로는
            // 안 드러나는 "합쳐진 오디오는 있는데 아직 확정 전" 상태만 별도 표시
            !g3Confirmed[c.id] && hasCutMergedAny(c.id) ? <span className={s.doneTag}>🎵완성</span> : null
          )}
        />
      </div>

      {/* 오른쪽 메인 */}
      <div className={s.main}>
        {/* 1. 목소리 설정 (기본값) — ElevenLabs 연동 등록/사양 표시 겸 상단바 고정 */}
        <div className={`${s.panel} ${s.topBar}`}>
          <h3 className={s.panelTitle}>목소리 선택 (기본값)</h3>
          {ttsSettings.voiceId === DEFAULT_VOICE_ID ? (
            <div className={`${s.voiceBanner} ${s.voiceBannerOk}`}>✅ 서여리 목소리 적용 중</div>
          ) : (
            <div className={`${s.voiceBanner} ${s.voiceBannerWarn}`}>
              <span>⚠️ 서여리 목소리가 아닙니다</span>
              <button className={s.restoreBtn} onClick={restoreYeoriVoice}>서여리로 복원</button>
            </div>
          )}
          <div className={s.voiceInputRow}>
            <VoicePicker
              value={voiceInput}
              onChange={setVoiceInput}
              myVoices={myVoices}
              onLoadVoices={loadMyVoices}
              voicesLoading={voicesLoading}
            />
            <button className={s.voiceLoadBtn} onClick={saveVoiceId}>기본값 저장</button>
          </div>
          {ttsSettings.voiceId && (
            <div className={s.voiceApplied}>적용됨: <code>{ttsSettings.voiceId}</code></div>
          )}
        </div>

        <div className={s.scrollBody}>
        {/* 1-b. 캐릭터 목소리 — 특정 컷 아님. 전 회차·전 컷 공통. 화자 이름 붙은 트랙에 자동 적용 */}
        <details className={s.panel} open>
          <summary className={s.panelTitle}>
            🎭 캐릭터 목소리 설정 · 미리듣기 <span className={s.sliderGuideNote}>(특정 컷 아님 — 인물별로 전 컷 공통 적용)</span>
          </summary>
          <div className={s.panelTitleRow}>
            <span className={s.sliderGuideNote}>변경 시 3초 뒤 자동 저장. 바로 확정하려면 💾</span>
            <button className={s.voiceLoadBtn} onClick={saveCharacterVoices}>
              {charVoiceSaved ? '✅ 저장됨' : '💾 저장'}
            </button>
          </div>
          {!charList.length && (
            <div className={s.sliderGuideNote}>캐릭터 레지스트리를 불러오지 못했습니다 (프록시 연결 확인).</div>
          )}
          {charList.map(c => {
            const tuned = !!speakerSettingFor(c.name)
            const sv = speakerSettingFor(c.name) || FALLBACK_DEFAULTS.dialogue
            return (
              <div key={c.name} className={s.speakerVoiceRow} style={{ flexWrap: 'wrap' }}>
                <span className={s.speakerVoiceName}>{c.name}{c.primary ? ' (기본)' : ''}</span>
                <VoicePicker
                  compact
                  value={speakerVoiceFor(c.name) || ''}
                  onChange={id => setSpeakerVoice(c.name, id)}
                  myVoices={myVoices}
                  onLoadVoices={loadMyVoices}
                  voicesLoading={voicesLoading}
                  inheritLabel={c.primary ? `상단 기본값 ${(ttsSettings.voiceId || '').slice(0, 10)}…` : '상단 기본값'}
                />
                {/* 미세조정 — 항상 펼쳐서 바로 조절 가능 */}
                <div className={s.trackSettings} style={{ flexBasis: '100%' }}>
                  <div className={s.sliderGuideNote}>
                    🎚 미세조정 {tuned ? '(적용 중 · 전 컷)' : '(기본치 — 움직이면 이 화자 전용으로 저장)'}
                  </div>
                  {[
                    { key: 'speed', label: '속도', min: 0.5, max: 2.0, step: 0.05, unit: 'x' },
                    { key: 'stability', label: '안정성', min: 0, max: 100, step: 1, unit: '%' },
                    { key: 'similarity', label: '유사도', min: 0, max: 100, step: 1, unit: '%' },
                  ].map(({ key, label, min, max, step, unit }) => {
                    const val = sv[key]
                    const pct = ((val - min) / (max - min)) * 100
                    return (
                      <div key={key} className={s.sliderRow}>
                        <span className={s.sliderLabel}>{label}</span>
                        <input type="range" min={min} max={max} step={step} value={val}
                          style={{ background: `linear-gradient(to right, var(--slider-fill) ${pct}%, var(--bg-input) ${pct}%)` }}
                          onChange={e => setSpeakerSetting(c.name, key, parseFloat(e.target.value))} />
                        <span className={s.sliderVal}>{val}{unit}</span>
                      </div>
                    )
                  })}
                  {tuned && (
                    <button type="button" className={s.applyCleanBtn} onClick={() => clearSpeakerSetting(c.name)}>
                      미세조정 해제 (트랙 기본치로)
                    </button>
                  )}
                </div>

                {/* 미리듣기 예문 — 톤 확인용. 특정 컷 대사가 아님 (자유 입력 or 대본에서 가져오기). */}
                <div className={s.sliderGuideNote} style={{ flexBasis: '100%', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span>🎧 미리듣기 예문 (특정 컷 대사 아님)</span>
                  {scriptLineFor(c.name) && (
                    <button type="button" className={s.applyCleanBtn}
                      onClick={() => setCharPreview(p => ({ ...p, [c.name]: { ...p[c.name], text: scriptLineFor(c.name) } }))}>
                      대본 대사로
                    </button>
                  )}
                  <button type="button" className={s.applyCleanBtn}
                    onClick={() => setCharPreview(p => ({ ...p, [c.name]: { ...p[c.name], text: sampleLineFor(c.name) } }))}>
                    기본 예문
                  </button>
                </div>
                <textarea className={s.trackText} rows={2} style={{ flexBasis: '100%' }}
                  value={previewText(c.name)}
                  onChange={e => setCharPreview(p => ({ ...p, [c.name]: { ...p[c.name], text: e.target.value } }))} />

                {/* 미리듣기 · 다시 듣기 · A/B */}
                <div className={s.trackGenRow} style={{ flexBasis: '100%', flexWrap: 'wrap' }}>
                  <button type="button" className={s.trackGenBtn}
                    disabled={charPreview[c.name]?.loading}
                    onClick={() => previewCharacter(c.name)}>
                    {charPreview[c.name]?.loading
                      ? <><span className={s.spinner} />생성 중…</>
                      : (charPreview[c.name]?.url ? '🔁 다시 듣기 (현재 설정)' : '🔊 이 목소리로 미리듣기')}
                  </button>
                  {charPreview[c.name]?.url && (
                    <span className={s.sliderVal}>NEW</span>
                  )}
                  {charPreview[c.name]?.url && (
                    <audio controls autoPlay src={charPreview[c.name].url} className={s.trackAudio} />
                  )}
                  {charPreview[c.name]?.prevUrl && (
                    <>
                      <span className={s.sliderGuideNote}>이전:</span>
                      <audio controls src={charPreview[c.name].prevUrl} className={s.trackAudio} />
                    </>
                  )}
                </div>
                <div className={s.sliderGuideNote} style={{ flexBasis: '100%' }}>
                  안 맞으면 → 위 슬라이더 조정 → <b>🔁 다시 듣기</b> 반복. NEW/이전 비교 가능. 확정되면 상단 <b>💾 저장</b>.
                </div>
              </div>
            )
          })}
        </details>

        {/* 1-c. 읽기 교정 — 영문 고유명사 등을 한글 발음으로. TTS 에만 적용(자막엔 원문 유지) */}
        <details className={s.panel}>
          <summary className={s.panelTitle}>
            읽기 교정 <span className={s.sliderGuideNote}>(예: LE SSERAFIM → 르세라핌 · TTS 에만 적용)</span>
          </summary>
          <div className={s.trackSettings}>
            {Object.entries(readingMap).map(([from, to]) => (
              <div key={from} className={s.sliderRow}>
                <input className={s.trackText} style={{ flex: 1 }} value={from} readOnly />
                <span>→</span>
                <input className={s.trackText} style={{ flex: 1 }} value={to}
                  onChange={e => setReading(from, e.target.value)} />
                <button type="button" className={s.trackDelBtn} onClick={() => removeReading(from)}>✕</button>
              </div>
            ))}
            <div className={s.sliderRow}>
              <input className={s.trackText} style={{ flex: 1 }} placeholder="원문 (예: KATSEYE)"
                value={newRead.from} onChange={e => setNewRead(r => ({ ...r, from: e.target.value }))} />
              <span>→</span>
              <input className={s.trackText} style={{ flex: 1 }} placeholder="읽기 (예: 캣아이)"
                value={newRead.to} onChange={e => setNewRead(r => ({ ...r, to: e.target.value }))} />
              <button type="button" className={s.applyCleanBtn}
                onClick={() => { setReading(newRead.from, newRead.to); setNewRead({ from: '', to: '' }) }}>
                추가
              </button>
            </div>
            <div className={s.sliderGuideNote}>
              기본 내장: {Object.keys(DEFAULT_READINGS).slice(0, 8).join(', ')} … (같은 원문을 위에 추가하면 덮어씁니다)
            </div>
          </div>
        </details>

        {/* 2. 트랙 구성 패널 */}
        {cut && activeVariant && (
          <div className={s.panel}>
            <div className={s.panelTitleRow}>
              <h3 className={s.panelTitle}>CUT {cut.no} 트랙 구성</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={s.reloadBtn}
                  title="TTS 로 다듬은 지금 트랙 문구(쉼표·물결표 등)를 대본 대사/나레이션에 반영합니다"
                  onClick={() => pushTracksToScript(cut.id, activeVariant.id)}>
                  📝 대본에 반영
                </button>
                <button className={s.reloadBtn}
                  title="이 컷 대본(대사/나레이션)에서 트랙을 다시 만듭니다 — 다중 화자면 화자별로 분리"
                  onClick={() => reloadTracksFromScript(cut.id, activeVariant.id)}>
                  🔄 대본에서 다시 불러오기
                </button>
              </div>
            </div>
            {cut.dialogue?.trim() && (
              <div className={s.scriptSrc}>
                <span className={s.scriptSrcLabel}>대본 대사</span> {cut.dialogue}
              </div>
            )}

            {/* 목소리 탭 — 컷당 여러 목소리 버전 비교 */}
            <div className={s.voiceTabRow}>
              {cutVoiceTabs.map((vt, i) => (
                <div key={vt.id} className={`${s.voiceTabItem} ${activeVIdx === i ? s.voiceTabActive : ''}`}>
                  <button className={s.voiceTabBtn} onClick={() => setActiveVoiceIdxFor(cut.id, i)}>
                    {vt.label}
                    {hasMergedForVariant(mergedUrls, cut.id, vt.id) && <span className={s.voiceTabDone}>●</span>}
                  </button>
                  {cutVoiceTabs.length > 1 && (
                    <span className={s.voiceTabClose} title="이 목소리 탭 삭제"
                      onClick={() => removeVoiceTab(cut.id, vt.id)}>✕</span>
                  )}
                </div>
              ))}
              <button className={s.voiceTabAddBtn} onClick={() => addVoiceTab(cut.id)}>+ 목소리 추가</button>
            </div>

            {/* 이 탭 전용 목소리 (새 트랙 기본값) */}
            <div className={s.trackVoiceRow}>
              <span className={s.trackVoiceLabel}>이 탭 목소리</span>
              <VoicePicker
                value={activeVariant.voiceId}
                onChange={id => updateVariantVoiceId(cut.id, activeVariant.id, id)}
                myVoices={myVoices}
                onLoadVoices={loadMyVoices}
                voicesLoading={voicesLoading}
              />
            </div>

            {/* 화자별 목소리 — 다중 화자 대사가 있으면 화자마다 목소리 지정 (전 컷 공용).
                대본 표기(지아/한지아 등)가 달라도 정식 이름 1개로 합쳐서 보여준다. */}
            {(() => {
              const names = [...new Set(cutTracks.map(t => canonSpeaker(t.speaker)).filter(Boolean))]
              if (!names.length) return null
              return (
                <div className={s.speakerVoicePanel}>
                  <div className={s.speakerVoiceTitle}>🎭 화자별 목소리 <span>(모든 컷 공통)</span></div>
                  {names.map(name => {
                    const tuned = !!speakerSettingFor(name)
                    const sv = speakerSettingFor(name) || FALLBACK_DEFAULTS.dialogue
                    return (
                    <div key={name} className={s.speakerVoiceRow} style={{ flexWrap: 'wrap' }}>
                      <span className={s.speakerVoiceName}>{name}</span>
                      <VoicePicker
                        compact
                        value={speakerVoiceFor(name) || ''}
                        onChange={id => setSpeakerVoice(name, id)}
                        myVoices={myVoices}
                        onLoadVoices={loadMyVoices}
                        voicesLoading={voicesLoading}
                        inheritLabel={`탭 기본값 ${activeVariant.voiceId.slice(0, 10)}…`}
                      />
                      <details className={s.sliderGuide} style={{ flexBasis: '100%' }} open={tuned}>
                        <summary>🎚 {name} 미세조정 {tuned ? '(적용 중 — 이 화자 전 컷)' : '(기본치 사용 중)'}</summary>
                        <div className={s.trackSettings}>
                          {[
                            { key: 'speed', label: '속도', min: 0.5, max: 2.0, step: 0.05, unit: 'x' },
                            { key: 'stability', label: '안정성', min: 0, max: 100, step: 1, unit: '%' },
                            { key: 'similarity', label: '유사도', min: 0, max: 100, step: 1, unit: '%' },
                          ].map(({ key, label, min, max, step, unit }) => {
                            const val = sv[key]
                            const pct = ((val - min) / (max - min)) * 100
                            return (
                              <div key={key} className={s.sliderRow}>
                                <span className={s.sliderLabel}>{label}</span>
                                <input type="range" min={min} max={max} step={step} value={val}
                                  style={{ background: `linear-gradient(to right, var(--slider-fill) ${pct}%, var(--bg-input) ${pct}%)` }}
                                  onChange={e => setSpeakerSetting(name, key, parseFloat(e.target.value))} />
                                <span className={s.sliderVal}>{val}{unit}</span>
                              </div>
                            )
                          })}
                          {tuned && (
                            <button type="button" className={s.applyCleanBtn}
                              onClick={() => clearSpeakerSetting(name)}>
                              화자 미세조정 해제 (트랙 기본치로)
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                    )
                  })}
                </div>
              )
            })()}

            <details className={s.sliderGuide}>
              <summary>🎚 목소리 제어 가이드 (속도 · 안정성 · 유사도)</summary>
              <div className={s.sliderGuideBody}>
                <p><b>속도</b> — 말하는 빠르기. 1.0이 기본. 대사 0.9~1.0, 나레이션 0.85. 0.7 미만·1.3 초과는 어색해집니다.</p>
                <p><b>안정성</b> — <i>낮을수록</i> 억양·감정 기복이 크고 연기력이 살지만 가끔 튀거나 발음이 뭉갭니다. <i>높을수록</i> 차분하고 일관되지만 단조로워집니다.<br />
                  · 감정/리액션 씬: <b>20~35</b> &nbsp; · 정보 전달·차분한 나레이션: <b>45~60</b> &nbsp; · 70 이상은 로봇처럼 들릴 수 있음</p>
                <p><b>유사도</b> — 원본(클론) 목소리에 얼마나 가깝게 붙일지. <i>높을수록</i> 음색은 똑같아지지만 원본 녹음의 <b>잡음·숨소리·울림까지 따라옵니다</b>. 보통 <b>70~85</b>. 원본이 깨끗하면 높게, 지저분하면 낮춰서 모델이 정리하게 두세요.</p>
                <p className={s.sliderGuideNote}>※ 무료(Edge) 목소리는 안정성·유사도가 없고 속도만 적용됩니다. &nbsp; 모델: eleven_multilingual_v2</p>
                <p><b>문장부호로 억양·간격 표현</b> — 슬라이더는 컷 전체에 걸리지만, 대사 텍스트 안의 문장부호는
                  그 지점에서만 억양·쉬는 간격을 바꿉니다. 정제 과정에서 지워지지 않고 그대로 TTS로 들어갑니다.<br />
                  · <b>쉼표(,)</b> — 짧게 끊어 쉼. 숨 고르는 지점에 넣으면 자연스러워짐 (예: "저는요, 음, 그러니까~")<br />
                  · <b>물결표(~)</b> — 앞 음절을 늘여 발음(느긋·애교·강조 톤). 여러 개(~~)면 더 길게 늘어짐 (예: "아~~ 대박")<br />
                  · <b>말줄임표(…)</b> — 쉼표보다 긴 정지. 망설임·여운 (예: "음… 그게")<br />
                  · <b>느낌표/물음표</b> — 억양 자체를 올림. 여러 개(!!)로 강도 조절 가능</p>
              </div>
            </details>

            {cutTracks.map((track, idx) => (
              <div key={track.id} className={s.trackCard}>
                {/* 헤더 */}
                <div className={s.trackHeader}>
                  <span className={`${s.trackLabel} ${track.type === 'narration' ? s.trackLabelNarr : ''}`}>
                    {track.type === 'narration'
                      ? '🎙 나레이션'
                      : (track.speaker ? `💬 ${track.speaker}` : '💬 대사')}
                    {track.speaker && speakerVoiceFor(track.speaker) && (
                      <span className={s.trackVoiceTag} title="화자별 목소리 적용 중">🎭</span>
                    )}
                  </span>
                  <div className={s.trackHeaderBtns}>
                    <button className={s.trackResetBtn} title="기본값 복원"
                      onClick={() => setTracksForKey(activeKey, prev =>
                        prev.map(t => t.id === track.id
                          ? { ...t, settings: { ...(trackDefaults[t.type] || FALLBACK_DEFAULTS[t.type]) } }
                          : t
                        )
                      )}>🔄</button>
                    <button className={s.trackMoveBtn} disabled={idx === 0}
                      onClick={() => setTracksForKey(activeKey, prev => {
                        const a = [...prev]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; return a
                      })}>↑</button>
                    <button className={s.trackMoveBtn} disabled={idx === cutTracks.length - 1}
                      onClick={() => setTracksForKey(activeKey, prev => {
                        const a = [...prev]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; return a
                      })}>↓</button>
                    <button className={s.trackDelBtn}
                      onClick={() => setTracksForKey(activeKey, prev => prev.filter(t => t.id !== track.id))}>
                      ✕
                    </button>
                  </div>
                </div>

                {/* 이 트랙만 다른 목소리 (한 컷에 여러 목소리 조합 — 비우면 탭 기본값) */}
                <div className={s.trackVoiceOverrideRow}>
                  <span className={s.trackVoiceOverrideLabel}>이 트랙 목소리</span>
                  <VoicePicker
                    compact
                    value={track.voiceId}
                    onChange={id => setTracksForKey(activeKey, prev =>
                      prev.map(t => t.id === track.id ? { ...t, voiceId: id } : t)
                    )}
                    myVoices={myVoices}
                    onLoadVoices={loadMyVoices}
                    voicesLoading={voicesLoading}
                    inheritLabel={`탭 기본값 ${activeVariant.voiceId.slice(0, 10)}…`}
                  />
                </div>

                {/* 텍스트 */}
                <textarea className={s.trackText} rows={3}
                  placeholder={track.type === 'dialogue' ? '대사 입력...' : '나레이션 입력...'}
                  value={track.text}
                  onChange={e => setTracksForKey(activeKey, prev =>
                    prev.map(t => t.id === track.id ? { ...t, text: e.target.value } : t)
                  )} />
                {(() => {
                  const segs = track.type === 'dialogue' ? splitSpeakerSegments(track.text) : []
                  const multi = segs.filter(x => x.speaker).length > 1 && !track.speaker
                  const { clean, removed } = cleanForTTS(track.text)
                  const needClean = clean !== track.text.trim() && !multi
                  if (!multi && !needClean) return null
                  return (
                    <div className={s.removedHint}>
                      {multi ? (
                        <>
                          <div>🎭 화자 {segs.filter(x => x.speaker).length}명 감지: <b>{segs.filter(x => x.speaker).map(x => x.speaker).join(', ')}</b> — 각자 다른 목소리로 생성하려면 분리하세요</div>
                          <button type="button" className={s.applyCleanBtn}
                            onClick={() => setTracksForKey(activeKey, prev => {
                              const i = prev.findIndex(t => t.id === track.id)
                              if (i < 0) return prev
                              const newTracks = segs.map(seg =>
                                makeTrack('dialogue', seg.text, trackDefaults, seg.speaker))
                              return [...prev.slice(0, i), ...newTracks, ...prev.slice(i + 1)]
                            })}>
                            화자별 트랙으로 분리
                          </button>
                        </>
                      ) : (
                        <>
                          <div>🔊 실제 읽을 내용: <b>{clean || '(비어있음 — 전부 지문/메모)'}</b></div>
                          {removed.length > 0 && <div className={s.removedList}>제외: {removed.join('  ')}</div>}
                          {clean && (
                            <button type="button" className={s.applyCleanBtn}
                              onClick={() => setTracksForKey(activeKey, prev =>
                                prev.map(t => t.id === track.id ? { ...t, text: clean } : t)
                              )}>
                              정제본으로 교체
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })()}

                {/* 슬라이더 */}
                {(() => {
                  const isFree = isFreeVoice(resolveVoiceId(track, activeVariant))
                  const bySpeaker = !!(track.speaker && speakerSettingFor(track.speaker))
                  const eff = resolveSettings(track)
                  return (
                <div className={s.trackSettings}>
                  {bySpeaker && (
                    <div className={s.sliderHint}>🎭 {canonSpeaker(track.speaker)} 캐릭터 미세조정 적용 중 — 상단 "캐릭터 목소리" 패널에서 조정</div>
                  )}
                  {[
                    { key: 'speed', label: '속도', min: 0.5, max: 2.0, step: 0.05, unit: 'x',
                      hint: '말하는 빠르기. 1.0=기본. 대사는 0.9~1.0, 나레이션은 0.85 정도. 0.7 미만/1.3 초과는 부자연스러워짐.' },
                    { key: 'stability', label: '안정성', min: 0, max: 100, step: 1, unit: '%',
                      hint: '낮을수록 감정·억양 변화가 크고 연기력↑ 대신 불안정(가끔 튐). 높을수록 차분·일관·단조. 감정 씬 20~35 / 정보 전달·나레이션 45~60.',
                      free: true },
                    { key: 'similarity', label: '유사도', min: 0, max: 100, step: 1, unit: '%',
                      hint: '원본 목소리에 얼마나 붙일지. 높으면 음색은 비슷하지만 원본의 잡음·숨소리까지 따라옴. 보통 70~85. 원본이 깨끗하면 높게, 지저분하면 낮게.',
                      free: true },
                  ].map(({ key, label, min, max, step, unit, hint, free }) => {
                    const val = eff[key]
                    const pct = ((val - min) / (max - min)) * 100
                    const disabled = (isFree && free) || bySpeaker
                    return (
                      <div key={key} className={`${s.sliderRow} ${disabled ? s.sliderRowOff : ''}`} title={hint}>
                        <span className={s.sliderLabel}>{label}</span>
                        <input type="range" min={min} max={max} step={step}
                          value={val} disabled={disabled}
                          style={{ background: `linear-gradient(to right, var(--slider-fill) ${pct}%, var(--bg-input) ${pct}%)` }}
                          onChange={e => setTracksForKey(activeKey, prev =>
                            prev.map(t => t.id === track.id
                              ? { ...t, settings: { ...t.settings, [key]: parseFloat(e.target.value) } }
                              : t
                            )
                          )} />
                        <span className={s.sliderVal}>{val}{unit}</span>
                        {disabled && !bySpeaker && <span className={s.sliderHint}>무료(Edge) 목소리는 속도만 적용됩니다</span>}
                      </div>
                    )
                  })}
                </div>
                  )
                })()}

                {/* 생성 버튼 + 개별 오디오 */}
                <div className={s.trackGenRow}>
                  <button className={s.trackGenBtn} disabled={trackLoading[track.id]}
                    onClick={() => generateTrackById(cut.id, activeVariant.id, track.id)}>
                    {trackLoading[track.id]
                      ? <><span className={s.spinner} />생성 중…</>
                      : '🔊 생성'}
                  </button>
                  {track.url && <audio controls src={track.url} className={s.trackAudio} />}
                  {track.url && track.url.startsWith('blob:') && (
                    <button type="button" className={s.trackGenBtn} disabled={trackConfirming[track.id]}
                      title="지금 이 소리를 서버 파일로 영구 저장 — 안 해두면 새로고침 시 사라짐(브라우저 임시 메모리)"
                      onClick={() => confirmTrackAudio(cut.id, activeVariant.id, track.id, track.url)}>
                      {trackConfirming[track.id]
                        ? <><span className={s.spinner} />저장 중…</>
                        : '✅ 이 소리로 확정'}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* 트랙 추가 */}
            <div className={s.addTrackRow}>
              <button className={s.addTrackBtn}
                onClick={() => setTracksForKey(activeKey, prev => [...prev, makeTrack('dialogue', '', trackDefaults)])}>
                + 대사 추가
              </button>
              <button className={s.addTrackBtn}
                onClick={() => setTracksForKey(activeKey, prev => [...prev, makeTrack('narration', '', trackDefaults)])}>
                + 나레이션 추가
              </button>
            </div>

            {/* 전체 합치기 버튼 */}
            <button className={s.mergeBtn}
              disabled={merging[activeKey] || !cutTracks.some(t => t.url)}
              onClick={() => mergeTracksForKey(cut.id, activeVariant.id)}>
              {merging[activeKey]
                ? <><span className={s.spinner} />합치는 중…</>
                : `🎵 ${activeVariant.label} 트랙 합치기`}
            </button>

            {/* 합친 결과 */}
            {mergedUrls[activeKey] && (
              <div className={s.mergedResult}>
                <div className={s.mergedLabel}>{activeVariant.label} · 합친 결과</div>
                <audio controls src={mergedUrls[activeKey]} className={s.audioPlayer} />
                <div className={s.mergedActions}>
                  <button className={s.dlBtn} onClick={() => downloadMerged(cut.id, activeVariant.id, cut.no)}>
                    ⬇ 다운로드
                  </button>
                  {saving[activeKey] && <span className={s.savingBadge}>💾 저장 중…</span>}
                  {saved[activeKey]  && <span className={s.savedBadge}>✅ MP3 저장됨</span>}
                  {!g3Confirmed[cut.id] ? (
                    <button className={s.g3Btn} onClick={() => approveG3(cut.id, cut.no)}>
                      ✅ G3 승인
                    </button>
                  ) : (
                    <span className={s.g3Tag}>G3 완료</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. 전체 일괄 생성 */}
        <div className={s.panel}>
          <h3 className={s.panelTitle}>전체 일괄 생성</h3>
          <p className={s.batchDesc}>
            모든 컷의 첫 번째 목소리 탭을 순서대로 생성 후 합치기까지 자동 실행합니다.<br />
            트랙이 대본과 안 맞으면(빈 트랙 / 화자 미분리) 먼저 아래로 다시 불러오세요.
          </p>
          <div className={s.batchBtnRow}>
            <button className={s.reloadBtn} onClick={reloadAllFromScript}>
              🔄 모든 컷 대본에서 다시 불러오기
            </button>
            <button className={s.batchBtn} disabled={batchRunning} onClick={runBatch}>
              {batchRunning
                ? <><span className={s.spinner} />실행 중…</>
                : '🎙️ 전체 컷 일괄 생성 + 합치기'}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
    </div>
  )
}

function hasMergedForVariant(mergedUrls, cutId, voiceTabId) {
  return !!mergedUrls[`${cutId}__${voiceTabId}`]
}
