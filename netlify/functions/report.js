// Listonix — paid Full Listing Report
// The report is built in 3 parts that the page requests in parallel,
// so each call stays well inside Netlify's function time limit.
//
// Env vars (Netlify → Project configuration → Environment variables):
//   ANTHROPIC_API_KEY   – Anthropic API key
//   STRIPE_SECRET_KEY   – Stripe secret or restricted key (read access to Checkout Sessions)
//   TEST_CODE           – optional private code that bypasses payment, for your own testing
//   REPORT_PAYMENT_LINK_ID – optional Stripe payment link id of the $19.99 report

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
  const key = process.env.STRIPE_SECRET_KEY || '';
  const isLiveSession = sessionId.startsWith('cs_live_');
  const hasLiveKey = /^(sk|rk)_live_/.test(key);
  // TEMPORARY: until a live key for the FixMyASIN Stripe account is added in Netlify,
  // accept live checkout session ids without an API check (we cannot verify them yet).
  // Remove this once STRIPE_SECRET_KEY is an rk_live_/sk_live_ key.
  if (isLiveSession && !hasLiveKey) {
    console.warn('Unverified live session accepted (no live Stripe key configured):', sessionId.slice(0, 20));
    return { ok: true, email: null, unverified: true };
  }
  if (!key) return { ok: false, reason: 'Payments are not configured yet.' };
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) return { ok: false, reason: 'Payment could not be verified.' };
  const s = await res.json();
  // The checkout must come from the report's payment link. We don't compare amounts:
  // customers may pay in local currency (Adaptive Pricing) or use a promotion code.
  const linkId = process.env.REPORT_PAYMENT_LINK_ID || 'plink_1UcjVlPQY2KLLXdw6Su25heL';
  if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status)) {
    return { ok: false, reason: 'Payment not completed.' };
  }
  if (s.payment_link !== linkId) return { ok: false, reason: 'This payment is for a different product.' };
  return { ok: true, email: s.customer_details?.email || null };
}

const SYSTEM = `You are a senior Amazon listing strategist with 6+ years of hands-on FBA selling experience (strongest in Tools & Home Improvement, but you work across categories). You write paid listing audits for Amazon sellers.

Rules:
- Analyze ONLY the text the seller provided. Never claim to have seen the live listing, its images, reviews, sales or rankings.
- Be specific: quote the seller's own words when pointing out a problem, and give a concrete rewrite or action for every issue.
- Respect Amazon rules: no promotional claims ("best", "#1", "guaranteed"), no prices, no competitor brand names, no ALL CAPS words, no special characters like !, $, ?, ~.
- Title length: since July 27, 2026 Amazon caps titles at 75 characters including spaces (all categories except media) and rewrites longer titles with AI. Every title you write MUST be 75 characters or fewer, counted exactly. A title over 75 characters is a high-severity issue. Do NOT tell a seller to make a title longer than 75 characters.
- Item Highlights: the searchable field shown under the title, max 125 characters. Supporting keywords, use cases and materials that no longer fit the title go here. If the seller provided Item Highlights, judge and improve them; never claim the listing lacks them.
- Numbers: only state character counts or bullet counts that appear in MEASURED FACTS. Never count yourself.
- Bullets: lead with the benefit, back it with a spec. Flag vague claims, duplicated info, missing key specs (size, material, compatibility, what's in the box, warranty).
- NEVER invent product facts (materials, sizes, counts, certifications, compatibility, warranty). In rewrites, use only facts the seller gave; where a key spec is missing, insert a clear placeholder in square brackets, e.g. [blade material] or [length in inches], so the seller fills it in.
- If the seller's own text CONTRADICTS itself on a spec (e.g. "all-steel" in one place and "aluminum" in another, or a capacity that could be per unit or per pair), do NOT pick a side anywhere, including titles. Use a placeholder such as [confirm material: steel or aluminum].
- Placeholders are ALWAYS in square brackets. Never use parentheses for notes to the seller inside copy meant to be pasted.
- Do not call the product something it is not (e.g. don't call a cabinet lifter a "floor jack" unless the seller does).
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
    max_tokens: 1450,
    schema: `{
  "new_title": "rewritten title, ready to paste, 75 characters or fewer including spaces",
  "item_highlights": "Item Highlights text, 125 characters or fewer, with the use cases and keywords that did not fit the title",
  "title_alternatives": [ "alternative 1", "alternative 2" ],   // each 75 characters or fewer
  "bullet_rewrites": [ "rewritten bullet 1", "...", "rewritten bullet 5" ]   // each under 45 words
}`,
  },
  extras: {
    max_tokens: 1000,
    schema: `{
  "missing_keywords": [ "keyword phrases buyers likely search that do NOT already appear in the seller's title, bullets or description" ],   // 8-12 items; never list a phrase the seller already uses
  "image_checklist": [ "specific image to include for THIS product" ],   // 6 items, each under 20 words
  "competitor_insights": [ "what competitors do better or worse, based on the competitor titles provided" ]   // 2-4 items, or [] if none provided
}`,
  },
};

// Exact numbers computed in code. The model must use these and never count by itself.
function listingFacts(title, highlights, bullets) {
  const t = String(title || '').trim();
  const h = String(highlights || '').trim();
  const lines = String(bullets || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return `MEASURED FACTS (computed by code and exact. Use these numbers. Never count characters or bullets yourself):
- Title length: ${t.length} characters (Amazon limit: 75)${t.length > 75 ? '. OVER THE LIMIT' : '. Within the limit, so never advise adding words to the title'}
- Item Highlights: ${h ? `${h.length} characters (limit: 125)` : 'not provided by the seller. Do not claim the listing has none; you may suggest text for it'}
- Bullet points pasted: ${lines.length} (one per line as pasted)`;
}

const LIMITS = { title: 75, highlights: 125 };

async function callModel(cfg, messages) {
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
      // Haiku 5.5 thinks adaptively by default; thinking tokens count toward max_tokens
      // and slow the response. These are short structured outputs, so turn it off.
      thinking: { type: 'disabled' },
      system: SYSTEM,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Anthropic error', JSON.stringify(data));
    return { error: 'The report could not be generated. Please try again in a minute.', status: 502 };
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    console.error('No JSON in model output', JSON.stringify({ model: data.model, stop_reason: data.stop_reason, usage: data.usage, text: text.slice(0, 500) }));
    return { error: 'The report could not be generated. Please try again.', status: 502 };
  }
  return { result: JSON.parse(text.slice(start, end + 1)), raw: text.slice(start, end + 1) };
}

// Returns a list of length problems in the rewritten copy, measured in code.
function copyLengthProblems(r) {
  const out = [];
  const len = (x) => String(x || '').trim().length;
  if (len(r.new_title) > LIMITS.title) out.push(`new_title is ${len(r.new_title)} characters (max ${LIMITS.title})`);
  (r.title_alternatives || []).forEach((a, i) => { if (len(a) > LIMITS.title) out.push(`title_alternatives[${i}] is ${len(a)} characters (max ${LIMITS.title})`); });
  if (len(r.item_highlights) > LIMITS.highlights) out.push(`item_highlights is ${len(r.item_highlights)} characters (max ${LIMITS.highlights})`);
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid request.' }); }

  const { session_id, part, asin, category, title, highlights, bullets, description, competitors } = input;
  const cfg = PARTS[part];
  if (!cfg) return json(400, { error: 'Unknown report part.' });
  if (!title || !bullets) return json(400, { error: 'Please paste at least your title and bullet points.' });
  if (String(title).length > 600 || String(highlights || '').length > 600 || String(bullets).length > 6000 || String(description || '').length > 6000 || String(competitors || '').length > 3000) {
    return json(400, { error: 'Input is too long. Please paste only the listing text.' });
  }

  const pay = await verifyPayment(session_id);
  if (!pay.ok) return json(402, { error: pay.reason });

  const userMsg = `Seller's listing:

ASIN: ${asin || 'not provided'}
Category: ${category || 'not provided'}

TITLE:
${title}

ITEM HIGHLIGHTS (the line under the title):
${highlights || 'not provided'}

BULLET POINTS:
${bullets}

DESCRIPTION:
${description || 'not provided'}

COMPETITOR TITLES (pasted by the seller):
${competitors || 'none provided'}

${listingFacts(title, highlights, bullets)}

Return JSON matching this schema:
${cfg.schema}`;

  try {
    const messages = [{ role: 'user', content: userMsg }];
    let out = await callModel(cfg, messages);
    if (out.error) return json(out.status, { error: out.error });
    let result = out.result;

    if (part === 'copy') {
      // Check the rewritten copy against Amazon's limits and ask for one fix if needed.
      const problems = copyLengthProblems(result);
      if (problems.length) {
        const retry = await callModel(cfg, [
          ...messages,
          { role: 'assistant', content: out.raw },
          { role: 'user', content: `Measured by code: ${problems.join('; ')}. Shorten only those fields to fit the limits, keep everything else the same, and return the full JSON again.` },
        ]);
        if (!retry.error) result = retry.result;
      }
      const len = (x) => String(x || '').trim().length;
      // Never hand out copy that breaks the limits.
      result.title_alternatives = (result.title_alternatives || []).filter((a) => len(a) <= LIMITS.title);
      if (len(result.item_highlights) > LIMITS.highlights) delete result.item_highlights;
      result.lengths = {
        new_title: len(result.new_title),
        item_highlights: result.item_highlights ? len(result.item_highlights) : null,
        title_ok: len(result.new_title) <= LIMITS.title,
      };
    }

    if (Array.isArray(result.missing_keywords)) {
      const existing = `${title} ${highlights || ''} ${bullets} ${description || ''}`.toLowerCase();
      result.missing_keywords = result.missing_keywords.filter((k) => !existing.includes(String(k).toLowerCase().trim()));
    }
    return json(200, { part, result, email: pay.email });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Something went wrong while building your report. Please try again.' });
  }
};
