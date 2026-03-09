require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

// ── Config ─────────────────────────────────────────────────────────────────

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const YOUR_NAME = process.env.YOUR_NAME || 'Alex';

// Lead qualification thresholds
const MIN_RATING     = 4.0;   // flag if rating is below this
const MIN_REVIEWS    = 20;    // flag if review count is below this

// Search settings — rotate through neighborhoods to surface smaller local spots
const NICHE    = 'restaurants';
const MAX_PAGES = 2;  // 20 results/page × searches below

// Smaller Miami neighborhoods yield local, less-prominent businesses
const SEARCH_QUERIES = [
  'local restaurants in Little Havana Miami',
  'restaurants in Allapattah Miami',
  'restaurants in Overtown Miami',
  'restaurants in Little Haiti Miami',
  'restaurants in Wynwood Miami',
  'restaurants in Liberty City Miami',
];

// ── Anthropic client ────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set in .env');
  process.exit(1);
}
if (!GOOGLE_API_KEY) {
  console.error('ERROR: GOOGLE_PLACES_API_KEY is not set in .env');
  process.exit(1);
}

const anthropic = new Anthropic();

// ── Helpers ─────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps a value in CSV-safe double quotes, escaping any internal quotes.
 */
function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

// ── Google Places API ────────────────────────────────────────────────────────

/**
 * Runs a Text Search query and returns one page of results.
 * Passing `pageToken` fetches the next page.
 */
async function textSearch(query, pageToken = null) {
  const params = new URLSearchParams({ query, key: GOOGLE_API_KEY });
  if (pageToken) params.set('pagetoken', pageToken);

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Text Search HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetches detailed fields for a single place_id.
 * We request only the fields we need to keep the call cost-efficient.
 */
async function getPlaceDetails(placeId) {
  const fields = [
    'name',
    'formatted_address',
    'formatted_phone_number',
    'rating',
    'user_ratings_total',
    'website',
  ].join(',');

  const params = new URLSearchParams({ place_id: placeId, fields, key: GOOGLE_API_KEY });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Place Details HTTP ${res.status}`);
  const data = await res.json();
  return data.result;
}

// ── Lead qualification ───────────────────────────────────────────────────────

/**
 * Returns an array of human-readable weakness strings, or [] if the business
 * looks healthy on all three signals.
 */
function detectWeaknesses(details) {
  const issues = [];
  if (!details.website) {
    issues.push('no website listed');
  }
  if (details.rating != null && details.rating < MIN_RATING) {
    issues.push(`low star rating (${details.rating.toFixed(1)} ★)`);
  }
  if (details.user_ratings_total != null && details.user_ratings_total < MIN_REVIEWS) {
    issues.push(`very few reviews (only ${details.user_ratings_total})`);
  }
  return issues;
}

// ── Claude email generation ──────────────────────────────────────────────────

/**
 * Asks Claude to write a personalised cold email for a weak business.
 * Uses claude-opus-4-6 with adaptive thinking for quality output.
 */
async function generateColdEmail(business) {
  const weaknessList = business.weaknesses.join(', ');

  const prompt = `You are writing a short, friendly cold email on behalf of ${YOUR_NAME}, \
a local digital marketing consultant based in Miami, FL.

Business details:
- Name: ${business.name}
- Address: ${business.address}
- Online presence issues: ${weaknessList}

Write a cold outreach email (body only, no subject line) that:
1. Has a warm, personal opening that references their specific location or niche
2. Mentions their specific online weakness (${weaknessList}) in a tactful, helpful way
3. Briefly introduces ${YOUR_NAME} as a local Miami digital marketing consultant
4. Offers one concrete way to help fix the identified issue
5. Ends with a clear, low-pressure call to action (reply or book a free 15-min call)
6. Is no longer than 130 words
7. Sounds human, not salesy — conversational and genuine

Sign off with: ${YOUR_NAME}`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 400,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract the text block (thinking blocks come first when adaptive thinking is on)
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

// ── CSV output ───────────────────────────────────────────────────────────────

function saveToCSV(leads, filename = 'miami_leads.csv') {
  const headers = [
    'Business Name',
    'Address',
    'Phone',
    'Rating',
    'Review Count',
    'Has Website',
    'Website URL',
    'Weaknesses',
    'Cold Email',
  ];

  const rows = leads.map((lead) => [
    lead.name,
    lead.address,
    lead.phone,
    lead.rating,
    lead.reviewCount,
    lead.hasWebsite ? 'Yes' : 'No',
    lead.website,
    lead.weaknesses.join('; '),
    lead.email,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');

  fs.writeFileSync(filename, csv, 'utf8');
  console.log(`\n✅  Saved ${leads.length} lead(s) → ${filename}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍  Searching for "${NICHE}" across ${SEARCH_QUERIES.length} Miami neighborhoods...\n`);

  // ── Step 1: Collect place stubs across multiple neighborhood queries ────────
  const seenPlaceIds = new Set();
  const allPlaceStubs = [];

  for (const query of SEARCH_QUERIES) {
    console.log(`  Query: "${query}"`);
    let pageToken = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (pageToken) await delay(2200); // Google requires ~2 s between page requests

      let data;
      try {
        data = await textSearch(query, pageToken);
      } catch (err) {
        console.error(`    Page ${page} failed:`, err.message);
        break;
      }

      if (data.status === 'ZERO_RESULTS') { console.log('    No results.'); break; }
      if (data.status !== 'OK') {
        console.error(`    API error: ${data.status} — ${data.error_message ?? ''}`);
        break;
      }

      // Deduplicate across queries
      const fresh = data.results.filter((r) => !seenPlaceIds.has(r.place_id));
      fresh.forEach((r) => seenPlaceIds.add(r.place_id));
      allPlaceStubs.push(...fresh);
      console.log(`    Page ${page}: +${fresh.length} new places (total: ${allPlaceStubs.length})`);

      pageToken = data.next_page_token ?? null;
      if (!pageToken) break;
    }
  }

  if (allPlaceStubs.length === 0) {
    console.log('\nNo places found. Check your API key and quota.');
    return;
  }

  // ── Step 2: Fetch details & qualify leads ──────────────────────────────────
  console.log(`\n📋  Checking ${allPlaceStubs.length} businesses for weaknesses...\n`);

  const leads = [];

  for (let i = 0; i < allPlaceStubs.length; i++) {
    const stub = allPlaceStubs[i];
    const prefix = `  [${String(i + 1).padStart(2)}/${allPlaceStubs.length}]`;

    process.stdout.write(`${prefix} ${stub.name} ... `);

    await delay(150); // gentle rate-limit on Details calls

    let details;
    try {
      details = await getPlaceDetails(stub.place_id);
    } catch (err) {
      console.log(`❌ details error: ${err.message}`);
      continue;
    }

    // Skip any business that already has a website — we only target no-web leads
    if (details.website) {
      console.log('🌐 has website (skipped)');
      continue;
    }

    const weaknesses = detectWeaknesses(details);

    if (weaknesses.length === 0) {
      console.log('✅ healthy (skipped)');
      continue;
    }

    console.log(`⚠️  ${weaknesses.join(' | ')}`);

    // ── Step 3: Generate personalised cold email via Claude ────────────────
    const businessInfo = {
      name: details.name || stub.name,
      address: details.formatted_address || stub.formatted_address || '',
      weaknesses,
    };

    let email = '';
    try {
      process.stdout.write(`${' '.repeat(prefix.length + 1)} ✉️  Generating email...`);
      email = await generateColdEmail(businessInfo);
      process.stdout.write(' done\n');
    } catch (err) {
      process.stdout.write(` failed: ${err.message}\n`);
      email = `[Email generation failed: ${err.message}]`;
    }

    leads.push({
      name: businessInfo.name,
      address: businessInfo.address,
      phone: details.formatted_phone_number || '',
      rating: details.rating ?? '',
      reviewCount: details.user_ratings_total ?? '',
      hasWebsite: !!details.website,
      website: details.website || '',
      weaknesses,
      email,
    });

    // Small pause so we don't hammer the Anthropic API
    await delay(300);
  }

  // ── Step 4: Save results ───────────────────────────────────────────────────
  if (leads.length === 0) {
    console.log('\n🎉  No weak businesses found in this batch — all look healthy!');
    return;
  }

  console.log(`\n💾  Found ${leads.length} lead(s). Writing CSV...`);
  saveToCSV(leads);

  // Quick summary
  const noWebsite  = leads.filter((l) => l.weaknesses.some((w) => w.includes('no website'))).length;
  const lowRating  = leads.filter((l) => l.weaknesses.some((w) => w.includes('rating'))).length;
  const fewReviews = leads.filter((l) => l.weaknesses.some((w) => w.includes('reviews'))).length;

  console.log('\n📊  Lead breakdown:');
  console.log(`     No website:   ${noWebsite}`);
  console.log(`     Low rating:   ${lowRating}`);
  console.log(`     Few reviews:  ${fewReviews}`);
  console.log('\nDone! Open miami_leads.csv to see your leads and generated emails.\n');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
