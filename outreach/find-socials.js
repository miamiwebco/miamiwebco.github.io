/**
 * find-socials.js
 *
 * Searches DuckDuckGo Lite for Instagram and TikTok handles for every
 * business in miami_leads.csv — no API keys, no artificial delays.
 *
 * Two searches per business:
 *   "[name] Miami Instagram"
 *   "[name] Miami TikTok"
 *
 * Saves "none" sentinel for rows that were searched but nothing found,
 * so re-runs skip them instead of searching again.
 *
 * Usage: node find-socials.js
 */
const fs   = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../data/miami_leads.csv');

// ── CSV parser / writer ───────────────────────────────────────────────────────

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const records = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++; let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else field += text[i++];
        }
        row.push(field);
      } else {
        let field = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') field += text[i++];
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
  return '\uFEFF' + records.map(row =>
    row.map(cell => '"' + String(cell ?? '').replace(/"/g, '""') + '"').join(',')
  ).join('\r\n') + '\r\n';
}

// ── Handle extraction ─────────────────────────────────────────────────────────

const IG_SKIP = new Set([
  'p','reel','tv','explore','accounts','direct','stories','reels',
  'share','hashtag','tags','challenges','about','developer','legal',
  'privacy','help','press','blog','jobs','api',
]);
const TT_SKIP = new Set([
  'video','tag','music','sound','discover','legal','privacy','fyp',
  'trending','live','effect','effects','search','notifications','about',
  'foryou','following','friends','explore','activity','login','signup',
  'creator','business','developers','en','us','embed',
]);
const FILE_EXT = /\.(html?|php|aspx|js|css|json|xml|pdf|jpe?g|png|gif|svg|ico|webp)$/i;

function extractIG(html) {
  // lite DDG returns bare URLs — no percent-encoding needed, but decode anyway
  const decoded = html.replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%40/gi, '@');
  const counts  = new Map();
  const re      = /instagram\.com\/([a-zA-Z0-9._]{2,30})(?:[/?#"'\s<]|$)/g;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    const h = m[1].toLowerCase();
    if (IG_SKIP.has(h) || /^\d+$/.test(h) || FILE_EXT.test(h)) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  if (!counts.size) return '';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function extractTT(html) {
  const decoded = html.replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%40/gi, '@');
  const counts  = new Map();
  const re      = /tiktok\.com\/@([a-zA-Z0-9_.]{2,30})(?:[/?#"'\s<]|$)/g;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    const h = m[1].toLowerCase();
    if (TT_SKIP.has(h) || FILE_EXT.test(h)) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  if (!counts.size) return '';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ── DuckDuckGo Lite search ────────────────────────────────────────────────────

const DDG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function ddgSearch(query) {
  // Use the POST form on lite.duckduckgo.com — most scraper-friendly DDG surface
  const res = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: { ...DDG_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'q=' + encodeURIComponent(query),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error('HTTP_' + res.status);
  const html = await res.text();
  if (html.length < 500) throw new Error('empty/challenge response');
  return html;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('ERROR: ' + CSV_PATH + ' not found'); process.exit(1);
  }

  const records = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const [header, ...rows] = records;

  if (!header.includes('Instagram')) header.push('Instagram');
  if (!header.includes('TikTok'))    header.push('TikTok');
  const C = {
    name:      header.indexOf('Business Name'),
    instagram: header.indexOf('Instagram'),
    tiktok:    header.indexOf('TikTok'),
  };
  rows.forEach(r => { while (r.length < header.length) r.push(''); });

  const todo = rows.filter(r => r[C.instagram] === '' || r[C.tiktok] === '');
  let igFound = 0, ttFound = 0, searches = 0;

  // Count already-found handles
  rows.forEach(r => {
    if (r[C.instagram] && r[C.instagram] !== 'none') igFound++;
    if (r[C.tiktok]    && r[C.tiktok]    !== 'none') ttFound++;
  });

  console.log('\n' + '-'.repeat(60));
  console.log('  DuckDuckGo Lite scrape — Instagram & TikTok');
  console.log('  Total: ' + rows.length + '   To search: ' + todo.length);
  console.log('-'.repeat(60) + '\n');

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const name   = row[C.name];
    const prefix = '  [' + String(i + 1).padStart(2) + '/' + rows.length + '] ' + name;

    // Both already resolved — skip
    if (row[C.instagram] !== '' && row[C.tiktok] !== '') {
      const ig = row[C.instagram] !== 'none' ? row[C.instagram] : '';
      const tt = row[C.tiktok]    !== 'none' ? row[C.tiktok]    : '';
      const tag = [ig && 'IG:@' + ig, tt && 'TT:@' + tt].filter(Boolean).join('  ') || 'not found';
      console.log(prefix + ' — ' + tag);
      continue;
    }

    console.log(prefix);

    // ── Instagram ────────────────────────────────────────────────────────
    let ig = row[C.instagram];
    if (ig === '') {
      process.stdout.write('      IG search ... ');
      try {
        const html = await ddgSearch('"' + name + '" Miami Instagram');
        searches++;
        ig = extractIG(html) || 'none';
        console.log(ig !== 'none' ? 'found @' + ig : 'not found');
      } catch (err) {
        ig = '';
        console.log('error: ' + err.message);
      }
    }

    // ── TikTok ───────────────────────────────────────────────────────────
    let tt = row[C.tiktok];
    if (tt === '') {
      process.stdout.write('      TT search ... ');
      try {
        const html = await ddgSearch('"' + name + '" Miami TikTok');
        searches++;
        tt = extractTT(html) || 'none';
        console.log(tt !== 'none' ? 'found @' + tt : 'not found');
      } catch (err) {
        tt = '';
        console.log('error: ' + err.message);
      }
    }

    row[C.instagram] = ig;
    row[C.tiktok]    = tt;
    if (ig && ig !== 'none') igFound++;
    if (tt && tt !== 'none') ttFound++;

    fs.writeFileSync(CSV_PATH, writeCSV([header, ...rows]), 'utf8');
  }

  fs.writeFileSync(CSV_PATH, writeCSV([header, ...rows]), 'utf8');

  console.log('\n' + '-'.repeat(60));
  console.log('  Searches run     : ' + searches);
  console.log('  Instagram found  : ' + igFound);
  console.log('  TikTok found     : ' + ttFound);
  console.log('  CSV saved        : ' + CSV_PATH);
  console.log('-'.repeat(60) + '\n');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
