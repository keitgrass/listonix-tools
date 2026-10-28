// Listonix — paid Full Listing Report
// Env vars (Netlify → Site configuration → Environment variables):
//   ANTHROPIC_API_KEY   – Anthropic API key
//   STRIPE_SECRET_KEY   – Stripe secret or restricted key (needs read access to Checkout Sessions)
//   TEST_CODE           – optional: a private code that bypasses payment, for your own testing
//   REPORT_MIN_CENTS    – optional: minimum paid amount in cents (default 1999)

const MODEL = 'claude-sonnet-5-5';

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
- Analyze ONLY the text the seller provided. Never claim to have seen the live listing, its images, reviews, sales or rankings. If something can't be judged from the text, say what to check instead.
- Be specific: quote the seller's own words when pointing out a problem, and give a concrete rewrite or action for every issue.
- Respect Amazon rules: no promotional claims ("best", "#1", "guaranteed"), no prices, no competitor brand names in titles, title within the category's character limit (assume 200 characters unless the category clearly uses less), no ALL CAPS words, no special characters like !, $, ?, ~.
- Bullets: lead with the benefit, back it with a spec. Flag vague claims, duplicated info, missing key specs (size, material, compatibility, what's in the box, warranty).
- Write in clear American English. No fluff, no generic advice that would apply to every listing.
- Respond with JSON only, no markdown fences, matching exactly the schema you are given.`;

const SCHEMA = `{
  "score": integer 0-100,
  "verdict": "one sentence summary of the listing's biggest weakness",
  "scores": { "title": 0-100, "bullets": 0-100, "description": 0-100, "keywords": 0-100 },
  "issues": [ { "severity": "high" | "medium" | "low", "area": "title" | "bullets" | "description" | "keywords" | "compliance" | "images", "problem": "what is wrong, quoting their text", "fix": "exact change to make" } ],   // 6-12 items, sorted by severity
  "new_title": "rewritten title, ready to paste",
  "title_alternatives": [ "alternative 1", "alternative 2" ],
  "bullet_rewrites": [ "rewritten bullet 1", "...", "rewritten bullet 5" ],
  "missing_keywords": [ "keyword phrases buyers likely search that are missing" ],   // 8-15 items
  "image_checklist": [ "specific image to include for THIS product, e.g. 'Infographic showing the 3 blade sizes side by side'" ],   // 6-8 items
  "competitor_insights": [ "what competitors do better or worse, based on the competitor titles provided" ],   // empty array if none provided
  "quick_wins": [ "the 3 changes to make today, in order" ]
}`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid request.' }); }

  const { session_id, asin, category, title, bullets, description, competitors } = input;
  if (!title || !bullets) return json(400, { error: 'Please paste at least your title and bullet points.' });
  if (String(title).length > 600 || String(bullets).length > 6000 || String(description || '').length > 6000 || String(competitors || '').length > 3000) {
    return json(400, { error: 'Input is too long. Please paste only the listing text.' });
  }

  const pay = await verifyPayment(session_id);
  if (!pay.ok) return json(402, { error: pay.reason });

  const userMsg = `Seller's listing to audit:

ASIN: ${asin || 'not provided'}
Category: ${category || 'not provided'}

TITLE:
${title}

BULLET POINTS:
${bullets}

DESCRIPTION:
${description || 'not provided'}

COMPETITOR TITLES (top-ranking competitors, pasted by the seller):
${competitors || 'none provided'}

Return the audit as JSON matching this schema:
${SCHEMA}`;

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
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic error', data);
      return json(502, { error: 'The report could not be generated. Please try again in a minute.' });
    }
    const text = (data.content || []).map((b) => b.text || '').join('').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const report = JSON.parse(text.slice(start, end + 1));
    return json(200, { report, email: pay.email });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Something went wrong while building your report. Please try again.' });
  }
};
