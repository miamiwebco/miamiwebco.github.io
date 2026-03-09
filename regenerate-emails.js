/**
 * regenerate-emails.js
 *
 * Regenerates the Cold Email column for every lead in miami_leads.csv
 * using the Anthropic Batches API (50% cheaper, all 49 run in parallel).
 *
 * Also clears the Call Script column so outreach.js regenerates fresh
 * scripts from the new emails next time it's run.
 *
 * Usage:
 *   node regenerate-emails.js
 */

require('dotenv').config();
const fs       = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const CSV_PATH  = 'miami_leads.csv';
const YOUR_NAME = process.env.YOUR_NAME || 'Nicholas';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY not set in .env');
  process.exit(1);
}

const client = new Anthropic();
const delay  = ms => new Promise(r => setTimeout(r, ms));

// ── CSV parser/writer (handles quoted multi-line fields) ─────────────────────

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const records = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++;
        let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else { field += text[i++]; }
        }
        row.push(field);
      } else {
        let field = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          field += text[i++];
        }
        row.push(field);
      }
      if (text[i] === ',') { i++; continue; }
      break;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) records.push(row);
  }
  return records;
}

function writeCSV(records) {
  const lines = records.map(row =>
    row.map(cell => '"' + String(cell ?? '').replace(/"/g, '""') + '"').join(',')
  );
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ── Prompt builder ───────────────────────────────────────────────────────────

const SYSTEM = `You write cold emails for ${YOUR_NAME}, a Miami-based digital marketing consultant in his mid-20s. He grew up in Miami, knows every neighborhood, and genuinely notices local businesses when he's around the city. His emails sound like he typed them on his phone after walking past the place — direct, warm, a little casual.

He never writes:
- "Hi there" or "I hope this finds you well" or "I hope this email finds you"
- "I wanted to reach out" or "I'm reaching out" or "touching base"
- Corporate words: "digital presence", "online presence", "leverage", "synergy", "pain points", "value proposition", "cutting-edge"
- Exclamation marks
- More than 5 sentences total`;

function buildPrompt(lead) {
  const weaknessSentence = lead.weaknesses
    .split('; ')
    .map(w => {
      if (w.includes('no website'))  return 'no website showing up online';
      if (w.includes('rating'))      return `a ${lead.rating}-star rating on Google`;
      if (w.includes('reviews'))     return `only ${lead.reviews} Google reviews`;
      return w;
    })
    .join(' and ');

  return `Write a cold email from ${YOUR_NAME} to the owner of "${lead.name}", a restaurant at ${lead.address}.

What ${YOUR_NAME} noticed: ${weaknessSentence}.

Rules:
1. Open with something specific to the street, neighborhood, or business — show you actually looked it up. Do NOT open with "Hi" or "Hey [name]" or "I came across".
2. One sentence that names the gap tactfully — not hammering it, just matter-of-fact.
3. One sentence: who ${YOUR_NAME} is + one concrete thing he can do for them.
4. One low-pressure close — e.g. "Worth a quick call?" or "Happy to chat if curious." Vary it.
5. Sign off: ${YOUR_NAME}

5 sentences max. Body only — no subject line, no extra commentary.`;
}

// ── Batches API flow ─────────────────────────────────────────────────────────

async function submitBatch(rows, C) {
  const requests = rows.map((row, i) => ({
    custom_id: String(i),
    params: {
      model: 'claude-opus-4-6',
      max_tokens: 220,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: buildPrompt({
          name:       row[C.name]       ?? '',
          address:    row[C.address]    ?? '',
          weaknesses: row[C.weaknesses] ?? '',
          rating:     row[C.rating]     ?? '',
          reviews:    row[C.reviews]    ?? '',
        }),
      }],
    },
  }));

  console.log(`Submitting batch of ${requests.length} emails to Anthropic...`);
  const batch = await client.messages.batches.create({ requests });
  console.log(`Batch ID: ${batch.id}  |  status: ${batch.processing_status}\n`);
  return batch.id;
}

async function pollUntilDone(batchId) {
  let dots = 0;
  while (true) {
    const batch = await client.messages.batches.retrieve(batchId);
    const { processing, succeeded, errored, expired, canceled } = batch.request_counts;

    process.stdout.write(
      `\r  Processing: ${processing}  |  Done: ${succeeded}  |  Errors: ${errored}  ${'.'.repeat(dots % 4).padEnd(3)}`
    );
    dots++;

    if (batch.processing_status === 'ended') {
      console.log('\n');
      return batch;
    }

    await delay(5000); // poll every 5 s
  }
}

async function collectResults(batchId, total) {
  // Map custom_id → generated email text
  const results = new Map();

  for await (const result of await client.messages.batches.results(batchId)) {
    const idx = parseInt(result.custom_id, 10);
    if (result.result.type === 'succeeded') {
      const textBlock = result.result.message.content.find(b => b.type === 'text');
      results.set(idx, textBlock?.text?.trim() ?? '');
    } else {
      console.warn(`  ⚠  Row ${idx} failed: ${result.result.type}`);
      results.set(idx, ''); // keep blank so original isn't overwritten on re-run
    }
  }

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: ${CSV_PATH} not found.`); process.exit(1);
  }

  const records = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const [header, ...rows] = records;

  const col = name => header.indexOf(name);
  const C = {
    name:       col('Business Name'),
    address:    col('Address'),
    weaknesses: col('Weaknesses'),
    rating:     col('Rating'),
    reviews:    col('Review Count'),
    coldEmail:  col('Cold Email'),
    emailSent:  col('Email Sent'),
    callScript: col('Call Script'),
  };

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`  Regenerating ${rows.length} cold emails via Batches API`);
  console.log(`  Model : claude-opus-4-6`);
  console.log(`  Cost  : ~50% off standard pricing`);
  console.log(`${'─'.repeat(54)}\n`);

  // Submit batch
  const batchId = await submitBatch(rows, C);

  // Poll until complete
  console.log('Waiting for batch to finish (polls every 5 s)...');
  const finalBatch = await pollUntilDone(batchId);

  const { succeeded, errored } = finalBatch.request_counts;
  console.log(`Batch complete — ${succeeded} succeeded, ${errored} errors\n`);

  // Collect results
  const results = await collectResults(batchId, rows.length);

  // Write back to CSV
  let updated = 0;
  for (const [idx, email] of results) {
    if (!email) continue;
    rows[idx][C.coldEmail]  = email;
    rows[idx][C.callScript] = ''; // clear stale call script — will regenerate on next outreach run
    // Don't touch Email Sent — those were dry-runs anyway
    updated++;
  }

  fs.writeFileSync(CSV_PATH, writeCSV([header, ...rows]), 'utf8');

  console.log(`${'─'.repeat(54)}`);
  console.log(`  Emails updated : ${updated} / ${rows.length}`);
  console.log(`  Call Scripts   : cleared (regenerate with: node outreach.js --dry-run)`);
  console.log(`  CSV saved      : ${CSV_PATH}`);
  console.log(`${'─'.repeat(54)}\n`);

  // Print a few samples
  console.log('── Sample emails ────────────────────────────────────\n');
  [0, 5, 23].forEach(i => {
    if (!rows[i]) return;
    console.log(`[${rows[i][C.name]}]`);
    console.log(rows[i][C.coldEmail]);
    console.log();
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
