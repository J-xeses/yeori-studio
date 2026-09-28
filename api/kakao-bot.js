// app/api/kakao-bot.js
// 카카오 챗봇 + 유비 스토리보드 Claude 프록시 통합


export const config = {
  maxDuration: 30,
};

const YUBI_SYSTEM_PROMPT = `당신은 반영구 시술 전문가 유비입니다.

유비 프로필:
- 이마라인 모발 시술 전문 시술사
- 현직 BJ 출신, 친근하고 따뜻한 성격
- 2026년 9월 21일 석촌에 개인 샵 오픈 (눈썹 반영구·이마라인)
- 진솔하고 공감 잘하는 언니 느낌

답변 규칙:
- 유비 본인 말투로 (친근한 언니 느낌)
- 이모지 적절히 사용 😊
- 2~3줄 이내로 아주 짧게 (카카오톡 말풍선)
- 마크다운 기호(**, #, -, 목록) 절대 쓰지 말 것 — 평범한 문장으로
- 전문성과 친근함 동시에
- 상담/예약으로 자연스럽게 연결
- 가격은 "상담 후 안내"로 처리
- 예약은 "DM 또는 이 채널로 문의" 안내

자주 묻는 질문 기본 답변:
- 가격: "시술 종류와 범위에 따라 달라져서 상담 후 정확히 안내드려요 😊"
- 통증: "개인차가 있지만 마취크림 사용해서 많이 편해요!"
- 지속기간: "보통 1~2년이고 리터치로 유지 가능해요"
- 예약: "원하시는 날짜 알려주시면 원장님이 직접 확인해서 답드려요 🌿"
- 모르는 내용·예약 확정은 지어내지 말고 원장님 직접 상담으로 안내`;

// 카카오 스킬은 5초 안에 답해야 한다 — 응답 전송 뒤 이어서 일하는 방식(9/16)은 Vercel 에서 작업이 멈춰
// 손님이 "잠깐만요"만 반복해서 받았다(9/28 재현). 그래서 4초 안에 동기로 답하고, 못 하면 원장님 연결로 넘긴다.
const AI_TIMEOUT_MS = 3800;
async function askClaude(userMessage) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 180,
        system: YUBI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || null;
    // 카톡은 마크다운을 그대로 보여 주므로 기호 제거
    return text ? text.replace(/\*\*|__|^#+\s*/gm, '').replace(/^\s*[-•]\s+/gm, '').trim() : null;
  } finally {
    clearTimeout(t);
  }
}

// 원장님(1:1 채팅) 연결 버튼 — 누르면 채널 1:1 채팅으로 넘어가 유비 관리자 앱에 알림이 간다
const OPERATOR_CARD = {
  textCard: {
    description: '원장님과 직접 이야기하고 싶으시면 아래를 눌러 주세요 👇',
    buttons: [{ label: '💬 원장님과 직접 대화', action: 'operator' }]
  }
};

function kakaoSimpleText(text, { operator = true } = {}) {
  const outputs = [{ simpleText: { text } }];
  if (operator) outputs.push(OPERATOR_CARD);
  return {
    version: '2.0',
    template: {
      outputs,
      quickReplies: [
        { label: '📅 예약하기', action: 'message', messageText: '예약 문의드려요!' },
        { label: '💰 가격 문의', action: 'message', messageText: '시술 가격이 궁금해요' }
      ]
    }
  };
}

// 예약·가격·일정처럼 사람이 확인해야 하는 문의 — AI 답과 함께 원장님 연결을 먼저 권한다
const HANDOFF_RE = /(예약|가격|얼마|비용|날짜|언제|시간|가능|상담|위치|주소|오시는|리터치)/;
const FALLBACK_TEXT = '문의 감사해요 🤍\n원장님이 직접 확인하고 바로 답드릴게요!\n아래 "원장님과 직접 대화"를 눌러 주세요.';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── URL 경로로 라우팅 ──────────────────────────
  const url = req.url || '';

  // /api/kakao-bot/claude-proxy 또는 쿼리로 구분
  const isProxy = url.includes('claude-proxy') || req.query?.mode === 'proxy';

  // ══════════════════════════════════════════════
  // A. Claude 프록시 (유비 스토리보드용)
  // ══════════════════════════════════════════════
  if (isProxy) {
    if (req.method === 'GET') {
      return res.status(200).json({ status: 'ok', message: 'Claude proxy 정상 작동 중' });
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    try {
      const { model, max_tokens, messages, system } = req.body;

      // 허용 모델 제한
      const allowed = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
      if (!allowed.includes(model)) {
        return res.status(400).json({ error: 'Model not allowed' });
      }

      const body = {
        model,
        max_tokens: Math.min(max_tokens || 1000, 4000),
        messages,
      };
      if (system) body.system = system;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await claudeRes.json();
      return res.status(claudeRes.ok ? 200 : claudeRes.status).json(data);

    } catch (err) {
      console.error('[claude-proxy] error:', err);
      return res.status(500).json({ error: 'Proxy error: ' + err.message });
    }
  }

  // ══════════════════════════════════════════════
  // B. 카카오 챗봇 (기존 로직 그대로)
  // ══════════════════════════════════════════════
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: '유비봇 API 정상 작동 중입니다 😊'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  const userMessage = body?.userRequest?.utterance || '';
  const userId = body?.userRequest?.user?.id || 'unknown';
  console.log(`[유비봇] 사용자(${userId}): ${userMessage}`);

  let replyText = null;
  try {
    replyText = await askClaude(userMessage);
  } catch (error) {
    console.error('[유비봇] AI 응답 실패/시간초과:', error?.name || error);
  }
  if (!replyText) return res.status(200).json(kakaoSimpleText(FALLBACK_TEXT));
  if (HANDOFF_RE.test(userMessage)) replyText += '\n\n예약·일정은 원장님이 직접 확인해 드려요 🌿';
  return res.status(200).json(kakaoSimpleText(replyText));
}
