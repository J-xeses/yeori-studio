// app/api/claude-proxy.js
// Yubi Storyboard Generator - Claude API Proxy
// API key is stored in Vercel environment variable, never exposed to client

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { model, max_tokens, messages, system } = req.body;

    // 허용 모델만 통과 (비용 제어)
    const allowedModels = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    if (!allowedModels.includes(model)) {
      return res.status(400).json({ error: 'Model not allowed' });
    }

    // max_tokens 상한 제한 (비용 제어)
    const safeMaxTokens = Math.min(max_tokens || 1000, 4000);

    const body = { model, max_tokens: safeMaxTokens, messages };
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

    if (!claudeRes.ok) {
      return res.status(claudeRes.status).json(data);
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[claude-proxy] error:', err);
    return res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
}
