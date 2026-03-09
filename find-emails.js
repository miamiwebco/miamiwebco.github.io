require('dotenv').config();
const fs = require('fs');

const CSV_PATH = 'miami_leads.csv';
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── CSV parser (handles quoted multi-line fields correctly) ──────────────────

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

// ── Email extraction ─────────────────────────────────────────────────────────

const JUNK_DOMAINS = new Set([
  'duckduckgo.com', 'duck.com', 'example.com', 'test.com', 'domain.com',
  'sentry.io', 'wixpress.com', 'squarespace.com', 'wordpress.org',
  'cloudflare.com', 'google.com', 'googleapis.com', 'gstatic.com',
  'googletagmanager.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'yelp.com', 'tripadvisor.com', 'opentable.com', 'resy.com',
  'toasttab.com', 'grubhub.com', 'doordash.com', 'ubereats.com',
  'schema.org', 'w3.org', 'apple.com', 'microsoft.com',
  'amazonaws.com', 'sendgrid.net', 'mailchimp.com', 'klaviyo.com',
  'jsdelivr.net', 'unpkg.com',
]);

const JUNK_LOCAL = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'bounce', 'mailer-daemon', 'postmaster', 'abuse', 'spam',
  'unsubscribe', 'privacy', 'legal', 'dmca',
];

// Common real TLDs — used to trim concatenated garbage off raw regex matches
const KNOWN_TLDS = [
  'com', 'net', 'org', 'edu', 'gov', 'io', 'co', 'us', 'biz', 'info',
  'miami', 'restaurant', 'cafe', 'food', 'kitchen', 'menu', 'catering',
];

/**
 * When HTML has no spaces, email + surrounding text gets merged, e.g.:
 *   "502-3243reservation@kikimiami.comDresscode"
 * This trims the domain's last label to the first known TLD prefix.
 * TLDs are checked longest-first so "com" beats "co".
 */
function normalizeDomain(domain) {
  const parts = domain.split('.');
  const last = parts[parts.length - 1].toLowerCase();
  // Already an exact known TLD — leave it alone
  if (KNOWN_TLDS.includes(last)) return domain;
  // Sort longest-first so e.g. "com" is tried before "co"
  const sorted = [...KNOWN_TLDS].sort((a, b) => b.length - a.length);
  for (const tld of sorted) {
    if (last.startsWith(tld) && last.length > tld.length) {
      parts[parts.length - 1] = tld;
      return parts.join('.');
    }
  }
  return domain;
}

/**
 * Strips leading phone-number-like garbage from an email local part, e.g.:
 *   "502-3243reservation" → "reservation"
 */
function trimLocalPart(local) {
  return local.replace(/^[\d\s\-().]+(?=[a-zA-Z])/, '');
}

function isValidEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (JUNK_DOMAINS.has(domain)) return false;
  if (JUNK_LOCAL.some(p => local === p || local.startsWith(p + '+'))) return false;
  if (/\.(png|jpg|gif|svg|webp|ico|js|css|woff|map)$/i.test(domain)) return false;
  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2 || tld.length > 8) return false;
  if (!/^[a-zA-Z]+$/.test(tld)) return false; // TLD must be all alpha (catches "comDres")
  return true;
}

function extractEmails(html) {
  const found = new Set();

  // Priority 1: mailto: links — most reliable, extract cleanly including query-param emails
  for (const m of html.matchAll(/mailto:([^\s"'<>()?\n]+)/gi)) {
    const candidate = m[1].toLowerCase().replace(/[,;>)}\]]+$/, '');
    if (/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,8}$/.test(candidate)) {
      found.add(candidate);
    }
  }

  // Priority 2: greedy pattern match, then normalize local part and domain
  for (const m of html.matchAll(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z0-9]{2,10})/g)) {
    const raw = m[1].toLowerCase();
    const at = raw.indexOf('@');
    const cleanLocal = trimLocalPart(raw.slice(0, at));
    const cleanDomain = normalizeDomain(raw.slice(at + 1));
    if (cleanLocal) found.add(`${cleanLocal}@${cleanDomain}`);
  }

  return [...found].filter(isValidEmail);
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function fetchHTML(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── Strategy 1: scrape business website ─────────────────────────────────────

async function findEmailOnWebsite(rawUrl) {
  let base = rawUrl.trim();
  if (!base.startsWith('http')) base = 'https://' + base;
  base = base.replace(/\/$/, '');

  const pagesToTry = [
    base,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/about`,
    `${base}/about-us`,
  ];

  for (const url of pagesToTry) {
    const html = await fetchHTML(url);
    if (!html) continue;
    const emails = extractEmails(html);
    if (emails.length > 0) return emails[0];
    await delay(350);
  }
  return null;
}

// ── Strategy 2: Yelp search (restaurants; returns richer data than DDG) ──────

async function findEmailViaYelp(businessName) {
  const q = encodeURIComponent(businessName);
  const searchUrl = `https://www.yelp.com/search?find_desc=${q}&find_loc=Miami%2C+FL`;
  const searchHtml = await fetchHTML(searchUrl, 12000);
  if (!searchHtml) return null;

  // Extract the first business result link
  const bizMatch = searchHtml.match(/href="(\/biz\/[a-z0-9\-]+)"/);
  if (!bizMatch) return null;

  const bizUrl = 'https://www.yelp.com' + bizMatch[1];
  const bizHtml = await fetchHTML(bizUrl);
  if (!bizHtml) return null;

  const emails = extractEmails(bizHtml);
  return emails.length > 0 ? emails[0] : null;
}

// ── Strategy 3: scrape Facebook page if that's the "website" ────────────────

async function findEmailOnFacebook(fbUrl) {
  const html = await fetchHTML(fbUrl);
  if (!html) return null;
  const emails = extractEmails(html);
  return emails.length > 0 ? emails[0] : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: ${CSV_PATH} not found.`);
    process.exit(1);
  }

  const records = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const [header, ...rows] = records;

  const col = name => header.indexOf(name);
  const C = {
    name:      col('Business Name'),
    hasWebsite: col('Has Website'),
    website:   col('Website URL'),
    email:     col('Contact Email'),
  };

  if (C.email === -1) {
    header.push('Contact Email');
    C.email = header.length - 1;
    rows.forEach(r => r.push(''));
  }

  const isJunk = v =>
    !v || v === 'not found' || v.includes('duckduckgo') || v.startsWith('error-');

  const total = rows.length;
  let foundCount = 0, notFoundCount = 0, skippedCount = 0;

  console.log(`\nSearching for contact emails — ${total} leads\n`);

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const name     = row[C.name]       ?? '';
    const site     = row[C.website]    ?? '';
    const hasSite  = (row[C.hasWebsite] ?? '').toLowerCase() === 'yes';
    const existing = row[C.email]      ?? '';
    const isFacebook = site.includes('facebook.com');
    const prefix   = `[${String(i + 1).padStart(2)}/${total}] ${name}`;

    if (!isJunk(existing)) {
      console.log(`${prefix} — already: ${existing}`);
      skippedCount++;
      continue;
    }

    process.stdout.write(`${prefix} — `);

    let email = null;

    if (hasSite && site) {
      if (isFacebook) {
        process.stdout.write(`facebook page ... `);
        email = await findEmailOnFacebook(site);
      } else {
        process.stdout.write(`scraping site ... `);
        email = await findEmailOnWebsite(site);
      }
      if (email) process.stdout.write(`✅ ${email} (site)\n`);
    }

    if (!email) {
      process.stdout.write(`${hasSite ? '\n  └─ falling back → ' : ''}yelp search ... `);
      email = await findEmailViaYelp(name);
      if (email) process.stdout.write(`✅ ${email} (yelp)\n`);
    }

    if (email) {
      row[C.email] = email;
      foundCount++;
    } else {
      process.stdout.write(`❌ not found\n`);
      row[C.email] = 'not found';
      notFoundCount++;
    }

    // Save every 5 rows so progress survives interruption
    if ((i + 1) % 5 === 0) {
      fs.writeFileSync(CSV_PATH, writeCSV([header, ...rows]), 'utf8');
    }

    await delay(800);
  }

  fs.writeFileSync(CSV_PATH, writeCSV([header, ...rows]), 'utf8');

  console.log(`
── Results ──────────────────────────────────────
  Newly found   : ${foundCount}
  Not found     : ${notFoundCount}
  Already had   : ${skippedCount}
  Total w/ email: ${foundCount + skippedCount} / ${total}

CSV saved → ${CSV_PATH}
`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
