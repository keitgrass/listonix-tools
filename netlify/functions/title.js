// FixMyASIN — free Title Rewrite Checker.
// Amazon caps titles at 75 characters (since July 27, 2026) and its AI rewrites longer ones.
// This checks what a shortened title lost and writes a 75-character title + Item Highlights.
// All counts and word comparisons are done in code; the model only writes copy.

const MODEL = 'claude-haiku-5-5';
const LIMITS = { title: 75, highlights: 125 };

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const STOP = new Set(('a an and or the for with of to in on by at from as is are be this that your you our it its into per pcs pc pack set ' +
  'x & - | , / + new best premium quality fits fit most all great perfect ideal').split(' '));

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.\/" ]+/g, ' ').split(/\s+/).filter(Boolean);
const norm = (w) => w.replace(/[".]+$/g, '').replace(/(ing|es|s|e)$/, '');

// Words that were in the old title but appear in neither the current title nor the Item Highlights.
function droppedWords(oldTitle, current, highlights) {
  if (!oldTitle) return [];
  const keep = new Set([...words(current), ...words(highlights)].map(norm));
  const seen = new Set();
  const out = [];
  for (const w of words(oldTitle)) {
    const n = norm(w);
    if (!n || STOP.has(w) || STOP.has(n) || seen.has(n) || keep.has(n)) continue;
    seen.add(n);
    out.push(w);
  }
  return out.slice(0, 30);
}

// Where each keyword phrase appears now.
function keywordCoverage(keywords, current, highlights) {
  const t = ` ${words(current).map(norm).join(' ')} `;
  const h = ` ${words(highlights).map(norm).join(' ')} `;
  return String(keywords || '')
    .split(/[,\n;]+/).map((k) => k.trim()).filter(Boolean).slice(0, 10)
    .map((k) => {
      const n = ` ${words(k).map(norm).join(' ')} `;
      return { keyword: k, in_title: t.includes(n), in_highlights: h.includes(n) };
    });
}

const SYSTEM = `You are a senior Amazon listing strategist with 6+ years of hands-on FBA selling experience.
Since July 27, 2026 Amazon caps product titles at 75 characters including spaces (all categories except media) and its AI rewrites longer titles, often dropping key words. The searchable Item Highlights line under the title holds up to 125 characters.

Your job: explain what the seller's title lost or is missing, then write a better title and Item Highlights.

Rules:
- Use ONLY the facts and numbers in MEASURED FACTS. Never count characters or words yourself, and never claim a word was dropped unless it is in the measured dropped-words list.
- Each new title option MUST be 75 characters or fewer; aim for 55 to 70. Keep titles short: about 9 to 11 words. Lead with the brand (if given) and the core product keyword, then the most important spec (size, count, material, compatibility).
- Each Item Highlights option MUST be 125 characters or fewer; aim for 90 to 115. Put the use cases, secondary keywords and specs that did not fit the title there. Plain text, no ALL CAPS, no emoji.
- Recover the most valuable dropped words and missing keywords into the title or Item Highlights. Do not stuff; keep both readable.
- NEVER invent product facts. Use only what the seller gave. If a key spec is missing, use a placeholder in square brackets, e.g. [size].
- No promotional claims ("best", "#1", "premium"), no ! $ ? ~ characters.
- Clear American English.
- Respond with compact JSON only, no markdown fences, matching this schema exactly:
{"verdict":"one sentence on the biggest problem","lost":[{"what":"short name of what was lost or is missing","why":"why it costs sales or rank, under 25 words"}],"new_titles":["3 different title options, each about 9 to 11 words and well under 75 characters"],"item_highlights_options":["2 options, each about 15 to 18 words and under 125 characters"],"notes":["up to 2 short tips"]}
"lost" has 2-4 items, most costly first.`;

async function callModel(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, thinking: { type: 'disabled' }, system: SYSTEM, messages }),
  });
  const data = await res.json();
  if (!res.ok) { console.error('Anthropic error', JSON.stringify(data)); return { error: true }; }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) { console.error('No JSON', text.slice(0, 300)); return { error: true }; }
  return { result: JSON.parse(text.slice(s, e + 1)), raw: text.slice(s, e + 1) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid request.' }); }

  const current = String(input.current_title || '').trim();
  const oldTitle = String(input.old_title || '').trim();
  const highlights = String(input.highlights || '').trim();
  const keywords = String(input.keywords || '').trim();
  const brand = String(input.brand || '').trim();

  if (current.length < 10) return json(400, { error: 'Please paste your current title.' });
  if (current.length > 400 || oldTitle.length > 400 || highlights.length > 400 || keywords.length > 500 || brand.length > 60) {
    return json(400, { error: 'That looks too long. Please paste only the title text.' });
  }

  const dropped = droppedWords(oldTitle, current, highlights);
  const coverage = keywordCoverage(keywords, current, highlights);
  const measured = {
    current_title_length: current.length,
    current_title_over_limit: current.length > LIMITS.title,
    old_title_length: oldTitle ? oldTitle.length : null,
    item_highlights_length: highlights ? highlights.length : null,
    dropped_words: dropped,
    keyword_coverage: coverage,
  };

  const userMsg = `Brand: ${brand || 'not provided'}

CURRENT TITLE (what Amazon shows now):
${current}

OLD / ORIGINAL TITLE:
${oldTitle || 'not provided'}

CURRENT ITEM HIGHLIGHTS:
${highlights || 'not provided'}

KEYWORDS THE SELLER WANTS TO RANK FOR:
${keywords || 'not provided'}

MEASURED FACTS (computed by code and exact):
- Current title: ${current.length} characters (limit 75)${current.length > 75 ? ', OVER THE LIMIT' : ''}
- Old title: ${oldTitle ? oldTitle.length + ' characters' : 'not provided'}
- Item Highlights: ${highlights ? highlights.length + ' characters (limit 125)' : 'not provided'}
- Words in the old title that are now in neither the title nor the Item Highlights: ${dropped.length ? dropped.join(', ') : (oldTitle ? 'none' : 'old title not provided')}
- Keyword coverage: ${coverage.length ? coverage.map((c) => `"${c.keyword}": ${c.in_title ? 'in title' : c.in_highlights ? 'only in Item Highlights' : 'MISSING'}`).join('; ') : 'no keywords provided'}`;

  try {
    const messages = [{ role: 'user', content: userMsg }];
    let out = await callModel(messages);
    if (out.error) return json(502, { error: 'We could not check your title right now. Please try again in a minute.' });
    let r = out.result;

    const len = (x) => String(x || '').trim().length;
    // The model can't count characters reliably, so it writes several options and code picks
    // the longest one that fits the limit.
    const pick = (opts, max) => (Array.isArray(opts) ? opts : [opts])
      .map((x) => String(x || '').trim()).filter((x) => x && x.length <= max)
      .sort((a, b) => b.length - a.length)[0] || null;
    let title = pick(r.new_titles, LIMITS.title);
    let hl = pick(r.item_highlights_options, LIMITS.highlights);
    if (!title || !hl) {
      const lens = (opts) => (Array.isArray(opts) ? opts : []).map(len).join(', ');
      const retry = await callModel([...messages, { role: 'assistant', content: out.raw },
        { role: 'user', content: `Measured by code: title option lengths are ${lens(r.new_titles) || 'none'} characters (max ${LIMITS.title}); Item Highlights option lengths are ${lens(r.item_highlights_options) || 'none'} (max ${LIMITS.highlights}). Write shorter options (titles about 8 to 10 words, Item Highlights about 14 to 16 words) and return the full JSON again.` }]);
      if (!retry.error) {
        title = title || pick(retry.result.new_titles, LIMITS.title);
        hl = hl || pick(retry.result.item_highlights_options, LIMITS.highlights);
      }
    }
    r.new_title = title;
    r.item_highlights = hl;
    delete r.new_titles; delete r.item_highlights_options;
    if (Array.isArray(r.lost)) r.lost = r.lost.slice(0, 4);
    if (Array.isArray(r.notes)) r.notes = r.notes.slice(0, 2);

    r.measured = {
      ...measured,
      new_title_length: r.new_title ? len(r.new_title) : null,
      new_highlights_length: r.item_highlights ? len(r.item_highlights) : null,
    };
    return json(200, { result: r });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
