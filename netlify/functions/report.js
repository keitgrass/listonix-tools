// Listonix — paid Full Listing Report
// The report is built in 3 parts that the page requests in parallel,
// so each call stays well inside Netlify's function time limit.
//
// Env vars (Netlify → Project configuration → Environment variables):
//   ANTHROPIC_API_KEY   – Anthropic API key
//   STRIPE_SECRET_KEY   – Stripe secret or restricted key (read access to Checkout Sessions)
//   TEST_CODE           – optional private code that bypasses payment, for your own testing
//   REPORT_MIN_CENTS    – optional minimum paid amount in cents (default 1999)

const MODEL = 'claude-haiku-5-5';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function verifyPayment(sessionId) {
  if (process.env.TEST_CODE && sessionId === process.env.TEST_CODE) {
    return { ok: true, email: null, test: true };
  }
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return { ok: false, reason: 'Missing or invalid payment reference.' };
  }
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, reason: 'Payments are not configured yet.' };
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
  );
  if (!res.ok) return { ok: false, reason: 'Payment could not be verified.' };
  const s = await res.json();
  const min = parseInt(process.env.REPORT_MIN_CENTS || '1999', 10);
  if (s.payment_status !== 'paid') return { ok: false, reason: 'Payment not completed.' };
  if ((s.amount_total || 0) < min) return { ok: false, reason: 'Payment amount does not match this product.' };
  return { ok: true, email: s.customer_details?.email || null };
}

const SYSTEM = `You are a senior Amazon listing strategist with 6+ years of hands-on FBA selling experience (strongest in Tools & Home Improvement, but you work across categories). You write paid listing audits for Amazon sellers.

Rules:
- Analyze ONLY the text the seller provided. Never claim to have seen the live listing, its images, reviews, sales or rankings.
- Be specific: quote the seller's own words when pointing out a problem, and give a concrete rewrite or action for every issue.
- Respect Amazon rules: no promotional claims ("best", "#1", "guaranteed"), no prices, no competitor brand names, title within 200 characters, no ALL CAPS words, no special characters like !, $, ?, ~.
- Bullets: lead with the benefit, back it with a spec. Flag vague claims, duplicated info, missing key specs (size, material, compatibility, what's in the box, warranty).
- Clear American English. No fluff, no generic advice that would apply to every listing.
- Respond with compact JSON only, no markdown fences, matching exactly the schema given.`;

const PARTS = {
  audit: {
    max_tokens: 1400,
    schema: `{
  "score": integer 0-100,
  "verdict": "one sentence: the listing's biggest weakness",
  "scores": { "title": 0-100, "bullets": 0-100, "description": 0-100, "keywords": 0-100 },
  "issues": [ { "severity": "high"|"medium"|"low", "area": "title"|"bullets"|"description"|"keywords"|"compliance", "problem": "short, quotes their text", "fix": "exact change" } ],  // 6-9 items, sorted by severity, each under 40 words
  "quick_wins": [ "3 changes to make today, in order" ]
}`,
  },
  copy: {
    max_tokens: 1300,
    schema: `{
  "new_title": "rewritten title, ready to paste",
  "title_alternatives": [ "alternative 1", "alternative 2" ],
  "bullet_rewrites": [ "rewritten bullet 1", "...", "rewritten bullet 5" ]   // each under 45 words
}`,
  },
  extras: {
    max_tokens: 1000,
    schema: `{
  "missing_keywords": [ "keyword phrases buyers likely search that are missing" ],   // 8-12 items
  "image_checklist": [ "specific image to include for THIS product" ],   // 6 items, each under 20 words
  "competitor_insights": [ "what competitors do better or worse, based on the competitor titles provided" ]   // 2-4 items, or [] if none provided
}`,
  },
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid request.' }); }

  const { session_id, part, asin, category, title, bullets, description, competitors } = input;
  const cfg = PARTS[part];
  if (!cfg) return json(400, { error: 'Unknown report part.' });
  if (!title || !bullets) return json(400, { error: 'Please paste at least your title and bullet points.' });
  if (String(title).length > 600 || String(bullets).length > 6000 || String(description || '').length > 6000 || String(competitors || '').length > 3000) {
    return json(400, { error: 'Input is too long. Please paste only the listing text.' });
  }

  const pay = await verifyPayment(session_id);
  if (!pay.ok) return json(402, { error: pay.reason });

  const userMsg = `Seller's listing:

ASIN: ${asin || 'not provided'}
Category: ${category || 'not provided'}

TITLE:
${title}

BULLET POINTS:
${bullets}

DESCRIPTION:
${description || 'not provided'}

COMPETITOR TITLES (pasted by the seller):
${competitors || 'none provided'}

Return JSON matching this schema:
${cfg.schema}`;

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
        max_tokens: cfg.max_tokens,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic error', JSON.stringify(data));
      return json(502, { error: 'The report could not be generated. Please try again in a minute.' });
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      console.error('No JSON in model output', JSON.stringify({ model: data.model, stop_reason: data.stop_reason, types: (data.content || []).map((b) => b.type), usage: data.usage, text: text.slice(0, 500) }));
      return json(502, { error: 'The report could not be generated. Please try again.' });
    }
    const result = JSON.parse(text.slice(start, end + 1));
    return json(200, { part, result, email: pay.email });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Something went wrong while building your report. Please try again.' });
  }
};
