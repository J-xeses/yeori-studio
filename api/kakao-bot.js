// app/api/kakao-bot.js
// 카카오 챗봇 + 유비 스토리보드 Claude 프록시 통합

// 카카오 스킬 서버 응답 제한(5초)을 넘길 수 있어 비동기로 처리한다.
// 같은 람다 웜 인스턴스 안에서만 유지되는 폴백 캐시(콜백 미사용 시 사용).
const pendingAnswers = new Map(); // userId -> { status: 'pending' | 'done', text }

export const config = {
  maxDuration: 30,
};

const YUBI_SYSTEM_PROMPT = `당신은 반영구 시술 전문가 유비입니다.

유비 프로필:
- 이마라인 모발 시술 전문 시술사
- 현직 BJ 출신, 친근하고 따뜻한 성격
- 8월 샵 오픈 예정
- 진솔하고 공감 잘하는 언니 느낌

답변 규칙:
- 유비 본인 말투로 (친근한 언니 느낌)
- 이모지 적절히 사용 😊
- 3~4줄 이내로 간결하게
- 전문성과 친근함 동시에
- 상담/예약으로 자연스럽게 연결
- 가격은 "상담 후 안내"로 처리
- 예약은 "DM 또는 이 채널로 문의" 안내

자주 묻는 질문 기본 답변:
- 가격: "시술 종류와 범위에 따라 달라져서 상담 후 정확히 안내드려요 😊"
- 통증: "개인차가 있지만 마취크림 사용해서 많이 편해요!"
- 지속기간: "보통 1~2년이고 리터치로 유지 가능해요"
- 예약: "날짜 말씀해주시면 확인해드릴게요 🌿"`;

async function askClaude(userMessage) {
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: YUBI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const claudeData = await claudeRes.json();
  return claudeData.content?.[0]?.text ||
    '안녕하세요! 유비예요 😊 조금 더 자세히 말씀해주시면 답변드릴게요!';
}

function kakaoSimpleText(text) {
  return {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text } }],
      quickReplies: [
        { label: '📅 예약하기', action: 'message', messageText: '예약 문의드려요!' },
        { label: '💰 가격 문의', action: 'message', messageText: '시술 가격이 궁금해요' },
        { label: '📞 상담 신청', action: 'message', messageText: '상담 받고 싶어요' }
      ]
    }
  };
}

async function pushCallback(callbackUrl, text) {
  try {
    await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kakaoSimpleText(text)),
    });
  } catch (err) {
    console.error('[유비봇] 콜백 푸시 실패:', err);
  }
}

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
  const callbackUrl = body?.userRequest?.callbackUrl;

  console.log(`[유비봇] 사용자(${userId}): ${userMessage}`);

  // 콜백 미사용 폴백: 직전 응답이 이미 완성돼 있으면 그걸 바로 반환
  const cached = pendingAnswers.get(userId);
  if (cached?.status === 'done') {
    pendingAnswers.delete(userId);
    return res.status(200).json(kakaoSimpleText(cached.text));
  }

  // A) 카카오 i 오픈빌더에서 콜백이 켜져 있는 경우: 표준 콜백 방식으로 처리
  if (callbackUrl) {
    res.status(200).json({
      version: '2.0',
      useCallback: true,
      data: { text: '잠깐만요, 답변 준비 중이에요 🌿' }
    });

    try {
      const replyText = await askClaude(userMessage);
      await pushCallback(callbackUrl, replyText);
    } catch (error) {
      console.error('[유비봇] 오류:', error);
      await pushCallback(callbackUrl, '안녕하세요! 유비예요 😊\n잠시 후 다시 문의해주시거나\nDM으로 연락 주시면 바로 답변드릴게요!');
    }
    return;
  }

  // B) 콜백 미설정 환경 폴백: 대기 메시지 먼저 응답, 완료되면 캐시에 저장
  //    (사용자가 다시 말을 걸면 위 캐시 분기에서 바로 반환됨)
  pendingAnswers.set(userId, { status: 'pending' });
  res.status(200).json(kakaoSimpleText('잠깐만요, 답변 준비 중이에요 🌿\n조금 있다 다시 한 번 말 걸어주시면 답변 드릴게요!'));

  try {
    const replyText = await askClaude(userMessage);
    pendingAnswers.set(userId, { status: 'done', text: replyText });
  } catch (error) {
    console.error('[유비봇] 오류:', error);
    pendingAnswers.delete(userId);
  }
}
