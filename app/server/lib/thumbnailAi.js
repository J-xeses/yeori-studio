// ── 썸네일 탭 "AI 후킹 문구 제안" (2026-11-04) ──
// ThumbTrend Studio(성준님이 별도로 구축한 썸네일 도구, localhost:4000)의
// src/services/geminiService.ts를 참고해 포팅. 그 도구는 클라이언트에서 @google/genai로 직접
// Gemini를 호출했지만, 여기서는 기존 ElevenLabs/Claude 키들과 동일하게 studio-secrets.json을
// 경유해 서버에서만 키를 다루고(클라이언트에 노출 안 함) REST 엔드포인트를 직접 fetch한다
// (별도 @google/genai 의존성 추가 없이 Node 18+ 전역 fetch로 충분).
import fs from 'fs'
import path from 'path'

// 2026-11-04 — gemini-2.5-flash는 API가 신규 사용자에게 404로 거부(모델 폐기). 실측으로 확인된
// 현재 사용 가능 모델로 교체.
const GEMINI_MODEL = 'gemini-3.8-flash'

function readGeminiKey(codeRoot) {
  try {
    const secretsPath = path.join(codeRoot, 'studio-secrets.json')
    const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) : {}
    return secrets.apiKeys?.gemini || ''
  } catch {
    return ''
  }
}

function buildPrompt({ title, scriptSummary, platform, currentText }) {
  const platformLabel = { youtube: '유튜브', shorts: '유튜브 쇼츠/릴스', instagram: '인스타그램' }[platform] || '유튜브'
  return `당신은 한국 1티어 유튜브/쇼츠 썸네일 카피라이터이자 CTR(클릭률) 최적화 전문가입니다.
아래 에피소드를 위한 썸네일용 후킹 문구를 만들어주세요. 시청자가 피드를 스크롤하다 0.8초 안에
멈추고 클릭하게 만드는 것이 목표입니다.

[입력 정보]
- 영상 제목: ${title || '(제목 없음)'}
- 대본/내용 요약: ${(scriptSummary || '').slice(0, 1200) || '(없음)'}
- 송출 플랫폼: ${platformLabel}
- 현재 썸네일에 들어가 있는 문구(참고용, 비어있을 수 있음): ${currentText || '(없음)'}

[제작 원칙]
- 썸네일 문구는 3~6단어(한글 기준) 이내로 극도로 짧고 강렬하게. 모바일 화면에서 0.8초 내 인지되어야 함.
- 서로 다른 후킹 전략 3가지를 제시: ①충격/반전형 ②궁금증 유발형 ③수치·결과 제시형.
- 코너 뱃지에 쓸 아주 짧은 보조 문구(2~5자, 예: "실화", "충격", "결말") 하나도 제안.

반드시 아래 JSON 형식으로만, 다른 설명 없이 응답하세요:
{
  "titles": ["후킹 문구 1", "후킹 문구 2", "후킹 문구 3"],
  "badge": "짧은 보조 문구",
  "viralScore": 92,
  "tips": ["이 문구가 효과적인 이유나 CTR 팁 1", "팁 2"]
}`
}

function algorithmicFallback({ title, platform }) {
  const topic = (title || '').trim() || '이 에피소드'
  const score = Math.floor(78 + Math.random() * 12)
  return {
    source: 'algorithmic',
    titles: [
      `${topic}, 결국 이렇게 됐다`,
      `아무도 몰랐던 ${topic}의 진실`,
      `${topic} 끝까지 보면 다름`,
    ],
    badge: '실화',
    viralScore: score,
    tips: [
      'Gemini API 키가 없거나 호출에 실패해 알고리즘 기반 문구로 대체했습니다.',
      '첫 3단어에 가장 강한 키워드를 배치하면 모바일 스크롤 중 인지율이 올라갑니다.',
    ],
  }
}

export async function generateThumbnailHooks(codeRoot, { title, scriptSummary, platform, currentText }) {
  const apiKey = readGeminiKey(codeRoot)
  if (!apiKey) return algorithmicFallback({ title, platform })

  try {
    const prompt = buildPrompt({ title, scriptSummary, platform, currentText })
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    )
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      console.warn('[thumbnailAi] Gemini 호출 실패:', resp.status, errBody.slice(0, 300))
      return algorithmicFallback({ title, platform })
    }
    const data = await resp.json()
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    const cleanJson = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleanJson)
    return {
      source: 'gemini',
      titles: Array.isArray(parsed.titles) && parsed.titles.length ? parsed.titles.slice(0, 3) : algorithmicFallback({ title, platform }).titles,
      badge: parsed.badge || '실화',
      viralScore: typeof parsed.viralScore === 'number' ? parsed.viralScore : 90,
      tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    }
  } catch (err) {
    console.warn('[thumbnailAi] Gemini 호출/파싱 오류, 알고리즘 폴백:', err.message)
    return algorithmicFallback({ title, platform })
  }
}
