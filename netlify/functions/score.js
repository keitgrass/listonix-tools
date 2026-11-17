// FixMyASIN — free listing score (title + bullets only, short answer)
// Uses the same ANTHROPIC_API_KEY as the paid report.

const MODEL = 'claude-haiku-5-5';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://www.amazon.com' }, // TEMP: outreach scoring, remove after
  body: JSON.stringify(body),
});

const SYSTEM = `You are a senior Amazon listing strategist with 6+ years of hands-on FBA selling experience. You give a quick, free first-look score of an Amazon listing.

Rules:
- Judge ONLY the title and bullets the seller pasted. Never claim to have seen images, reviews, sales or rankings.
- Score fairly: most real listings land between 35 and 80. Reserve 85+ for genuinely strong copy.
- Pick the 3 problems that cost the most sales or rank. Quote the seller's own words in each problem.
- Each fix must be a concrete change they can make today, not generic advice.
- Respect Amazon rules: flag promotional claims ("best", "#1"), ALL CAPS words, special characters like ! $ ?, titles over 200 characters, and contradictions between bullets.
- NEVER invent product facts. If a fix needs a spec they did not give, write a placeholder in square brackets, e.g. [material].
- Clear American English, no fluff.
- Respond with compact JSON only, no markdown fences, matching this schema exactly:
{"score": integer 0-100, "verdict": "one sentence on the biggest weakness", "scores": {"title": 0-100, "bullets": 0-100}, "problems": [{"problem": "under 30 words, quotes their text", "fix": "under 35 words"}]}  // exactly 3 problems, most costly first`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid request.' }); }
  const { asin, title, bullets } = input;

  if (!title || !bullets || String(title).trim().length < 10 || String(bullets).trim().length < 20) {
    return json(400, { error: 'Please paste your full title and bullet points.' });
  }
  if (String(title).length > 600 || String(bullets).length > 4000) {
    return json(400, { error: 'That looks too long. Please paste only the title and the 5 bullets.' });
  }

  const userMsg = `ASIN: ${asin || 'not provided'}

TITLE:
${title}

BULLET POINTS:
${bullets}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        thinking: { type: 'disabled' },
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic error', JSON.stringify(data));
      return json(502, { error: 'We could not score your listing right now. Please try again in a minute.' });
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      console.error('No JSON in model output', JSON.stringify({ stop_reason: data.stop_reason, text: text.slice(0, 300) }));
      return json(502, { error: 'We could not score your listing. Please try again.' });
    }
    const result = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(result.problems)) result.problems = result.problems.slice(0, 3);
    return json(200, { result });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
