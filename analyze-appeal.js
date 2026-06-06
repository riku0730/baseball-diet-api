export default async function handler(req, res) {
  // CORS対応
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body ?? {};
  if (!text || text.trim().length === 0) {
    return res.status(200).json({ war: 0, message: '' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const prompt = `
あなたは野球ダイエットアプリの審判AIです。
ユーザーの今日のアピール（日記）を読んで、健康的な生活への努力度を評価してください。

【評価基準】
- 食事制限・我慢・健康的な選択 → 高評価
- 運動・早起き・節制 → 高評価
- 正直に失敗を書いている → 少しボーナス（正直ポイント）
- 何もしていない・ネガティブだけ → 低評価

【返答形式】必ずこのJSONのみ返してください。説明不要。
{"war": 数値, "message": "日本語で一言コメント（20文字以内）"}

warは0〜0.05の小数（例: 0.03）
messageは審判としての一言（褒める・励ます・ツッコむ）

ユーザーのアピール:「${text.slice(0, 500)}」
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 100 },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // JSONを抽出（```json ... ``` で囲まれる場合も対応）
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('JSON parse failed');

    const parsed = JSON.parse(jsonMatch[0]);
    const war = Math.max(0, Math.min(0.05, Number(parsed.war) || 0));
    const message = String(parsed.message || '').slice(0, 30);

    return res.status(200).json({ war, message });
  } catch (e) {
    console.error('Gemini error:', e);
    // APIエラーでもアプリを止めない
    return res.status(200).json({ war: 0.01, message: '審判、採点中…' });
  }
}
