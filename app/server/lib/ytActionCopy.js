// ── 유튜브 운영실 "조치 가이드" — 에피소드별 실제 입력문구 생성(2026-11-14) ──
// thumbnailAi.js(AI 후킹 문구 제안)와 같은 패턴: studio-secrets.json의 apiKeys.gemini로 호출,
// 키 없거나 실패 시 항상 알고리즘 폴백으로 결과를 돌려준다. 체크리스트 항목 중 실제 "글"을 써야
// 하는 것들(고정댓글·설명 첫 문장·태그·시의성 키워드·재생목록 설명)을 해당 에피소드 제목에 맞춰 생성.
import fs from 'fs'
import path from 'path'

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

function buildPrompt({ title, scriptSummary, channelKeywords }) {
  const now = new Date()
  const todayStr = now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월'
  return `당신은 한국 유튜브 쇼츠 채널의 운영 담당자입니다. 아래 에피소드 하나에 대해, 업로드 후 "48시간 조치"
단계에서 실제로 복사해 붙여넣을 수 있는 문구들을 만들어주세요. 일반적인 템플릿이 아니라 이 에피소드의
제목(그리고 있다면 내용 요약)에 실제로 맞는 내용이어야 합니다.

[입력 정보]
- 오늘 날짜: ${todayStr} (timelyKeyword는 반드시 이 날짜 기준으로 작성 — 다른 연도를 쓰지 말 것)
- 영상 제목: ${title || '(제목 없음)'}
- 대본/내용 요약(참고용, 없을 수 있음): ${(scriptSummary || '').slice(0, 800) || '(없음)'}
- 채널 기본 키워드(참고용): ${channelKeywords || '(없음)'}

[만들 것]
1. pinnedComment: 이 영상의 핵심 키워드가 댓글에 자연스럽게 언급되도록 유도하는 "질문형" 고정 댓글 1개
   (예: 타이어 교체 영상이면 "타이어 교체할 때 더 궁금한 부분 있으면 댓글로 남겨주세요, 답변드릴게요!")
2. descOpening: 영상 설명란 첫 1~2문장. 핵심 키워드가 자연스럽게 포함되도록.
3. tags: 유튜브 태그란에 바로 넣을 수 있는 한글/영문 태그 5개(배열)
4. timelyKeyword: 제목이나 썸네일에 덧붙일 수 있는 시의성/계절 키워드 문구 1개(예: "2026년 11월 기준")

반드시 아래 JSON 형식으로만, 다른 설명 없이 응답하세요:
{
  "pinnedComment": "...",
  "descOpening": "...",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "timelyKeyword": "..."
}`
}

function algorithmicFallback({ title }) {
  const topic = (title || '').trim() || '이 영상'
  const words = topic.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2).slice(0, 4)
  return {
    source: 'algorithmic',
    pinnedComment: `'${topic}' 보고 더 궁금한 부분 있으면 댓글로 남겨주세요 — 최대한 답변드릴게요! 💬`,
    descOpening: `${topic} — 이번 에피소드에서는 그 이야기를 담아봤어요.`,
    tags: [...new Set([...words, '서여리', 'Seoyeori', 'AI인플루언서', '숏폼'])].slice(0, 5),
    timelyKeyword: new Date().toISOString().slice(0, 7).replace('-', '년 ') + '월 기준',
  }
}

export async function generateActionCopy(codeRoot, { title, scriptSummary, channelKeywords }) {
  const apiKey = readGeminiKey(codeRoot)
  if (!apiKey) return algorithmicFallback({ title })

  try {
    const prompt = buildPrompt({ title, scriptSummary, channelKeywords })
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
      console.warn('[ytActionCopy] Gemini 호출 실패:', resp.status, errBody.slice(0, 300))
      return algorithmicFallback({ title })
    }
    const data = await resp.json()
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    const cleanJson = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleanJson)
    const fb = algorithmicFallback({ title })
    return {
      source: 'gemini',
      pinnedComment: parsed.pinnedComment || fb.pinnedComment,
      descOpening: parsed.descOpening || fb.descOpening,
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.slice(0, 5) : fb.tags,
      timelyKeyword: parsed.timelyKeyword || fb.timelyKeyword,
    }
  } catch (err) {
    console.warn('[ytActionCopy] Gemini 호출/파싱 오류, 알고리즘 폴백:', err.message)
    return algorithmicFallback({ title })
  }
}
