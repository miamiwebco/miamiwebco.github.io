/**
 * build-dashboard.js
 * Reads miami_leads.csv and writes dashboard.html with leads embedded as JSON.
 * Run this any time the CSV changes: node build-dashboard.js
 */
const fs   = require('fs');
const path = require('path');

// ── CSV parser (handles quoted multi-line fields) ────────────────────────────
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
          if (text[i] === '"') { if (text[i+1] === '"') { field += '"'; i += 2; } else { i++; break; } }
          else field += text[i++];
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

// ── Read CSV → JSON ──────────────────────────────────────────────────────────
const [header, ...rows] = parseCSV(fs.readFileSync(path.join(__dirname, '../data/miami_leads.csv'), 'utf8'));
const col = name => header.indexOf(name);
const leads = rows.map(r => ({
  name:         r[col('Business Name')]  || '',
  address:      r[col('Address')]        || '',
  phone:        r[col('Phone')]          || '',
  rating:       r[col('Rating')]         || '',
  reviews:      r[col('Review Count')]   || '',
  website:      r[col('Website URL')]    || '',
  weaknesses:   r[col('Weaknesses')]     || '',
  coldEmail:    r[col('Cold Email')]     || '',
  contactEmail: r[col('Contact Email')] || '',
  callScript:   r[col('Call Script')]   || '',
  // "none" = searched but not found; treat as blank for display/filtering
  instagram:    (r[col('Instagram')] || '').replace(/^none$/i, ''),
  tiktok:       (r[col('TikTok')]    || '').replace(/^none$/i, ''),
}));

const LEADS_JSON = JSON.stringify(leads);

// ── HTML template ─────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Miami Leads Dashboard</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0d1117;
  --surface:  #161b22;
  --surface2: #21262d;
  --border:   #30363d;
  --text:     #e6edf3;
  --muted:    #8b949e;
  --accent:   #58a6ff;
  --panel-w:  460px;
  --hdr-h:    56px;
  --flt-h:    48px;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Header */
header {
  height: var(--hdr-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 20px; gap: 16px; flex-shrink: 0; z-index: 30;
}
header h1 { font-size: 16px; font-weight: 600; white-space: nowrap; }
header h1 span { color: var(--accent); }

.header-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.stat-chip {
  font-size: 12px; padding: 3px 10px; border-radius: 20px;
  font-weight: 500; background: var(--surface2);
  border: 1px solid var(--border); color: var(--muted);
}
.stat-chip b { color: var(--text); }

.header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.search-wrap { position: relative; }
.search-wrap svg {
  position: absolute; left: 8px; top: 50%;
  transform: translateY(-50%); color: var(--muted); pointer-events: none;
}
#search {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text); font-size: 13px;
  padding: 5px 10px 5px 30px; width: 210px;
  outline: none; transition: border-color .15s;
}
#search:focus { border-color: var(--accent); }

/* Filter bar */
.filter-bar {
  height: var(--flt-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 20px; gap: 6px; flex-shrink: 0;
  overflow-x: auto;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.filter-bar::-webkit-scrollbar { display: none; }

.filter-label { color: var(--muted); font-size: 12px; margin-right: 2px; white-space: nowrap; flex-shrink: 0; }
.filter-sep { width: 1px; height: 20px; background: var(--border); margin: 0 6px; flex-shrink: 0; }

.filter-btn {
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 12px; font-weight: 500;
  padding: 4px 11px; border-radius: 20px; cursor: pointer;
  transition: all .15s; white-space: nowrap; flex-shrink: 0;
}
.filter-btn:hover { border-color: var(--accent); color: var(--text); }
.filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }

/* Weakness filter active states */
.wf-btn.active.wf-website { background: #2d1b69; border-color: #7c3aed; color: #a78bfa; }
.wf-btn.active.wf-rating  { background: #3d2000; border-color: #b45309; color: #fbbf24; }
.wf-btn.active.wf-reviews { background: #0c2340; border-color: #1d4ed8; color: #60a5fa; }

/* Contact method filter active states */
.cf-btn.active.cf-email     { background: #0d2040; border-color: #1e3a5f; color: #58a6ff; }
.cf-btn.active.cf-instagram { background: #2d0d20; border-color: #9d174d; color: #f472b6; }
.cf-btn.active.cf-tiktok    { background: #0d2828; border-color: #0f766e; color: #2dd4bf; }

/* Layout */
.main { flex: 1; display: flex; overflow: hidden; }
.table-wrap { flex: 1; overflow-y: auto; transition: margin-right .25s ease; }
.table-wrap.panel-open { margin-right: var(--panel-w); }

table { width: 100%; border-collapse: collapse; }
thead th {
  position: sticky; top: 0;
  background: var(--surface); color: var(--muted);
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .05em; padding: 10px 14px; text-align: left;
  border-bottom: 1px solid var(--border); white-space: nowrap; z-index: 10;
}
tbody tr { border-bottom: 1px solid var(--border); cursor: pointer; transition: background .1s; }
tbody tr:hover { background: var(--surface); }
tbody tr.selected { background: #1c2333; }
tbody tr.hidden { display: none; }
td { padding: 11px 14px; vertical-align: middle; }

.cell-clamp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-name { font-weight: 500; max-width: 200px; }
.td-addr { color: var(--muted); font-size: 13px; max-width: 190px; }
.td-phone { color: var(--muted); white-space: nowrap; font-size: 13px; }
.rating-num { font-weight: 600; margin-right: 2px; }
.stars { color: #d29922; font-size: 12px; }

.weak-badge {
  display: inline-block; font-size: 11px; font-weight: 500;
  padding: 2px 8px; border-radius: 20px; white-space: nowrap;
}
.wb-website  { background: #2d1b69; color: #a78bfa; border: 1px solid #4c1d95; }
.wb-rating   { background: #3d2000; color: #fbbf24; border: 1px solid #92400e; }
.wb-reviews  { background: #0c2340; color: #60a5fa; border: 1px solid #1e3a5f; }

/* Status selects */
.status-select {
  appearance: none; border: 1px solid var(--border); border-radius: 20px;
  font-size: 11px; font-weight: 600; padding: 3px 22px 3px 10px;
  cursor: pointer; outline: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238b949e' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 6px center;
}
.status-select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.s-not-contacted  { background: #21262d; color: #8b949e; border-color: #30363d; }
.s-contacted      { background: #0d2040; color: #58a6ff; border-color: #1e3a5f; }
.s-interested     { background: #2d1f00; color: #d29922; border-color: #7c5400; }
.s-closed         { background: #0d2e1a; color: #3fb950; border-color: #145523; }
.s-not-interested { background: #2d0d0d; color: #f85149; border-color: #8e1a1a; }

/* Side panel */
.panel {
  position: fixed;
  top: calc(var(--hdr-h) + var(--flt-h));
  right: 0; bottom: 0;
  width: var(--panel-w);
  background: var(--surface);
  border-left: 1px solid var(--border);
  transform: translateX(100%);
  transition: transform .25s ease;
  display: flex; flex-direction: column;
  z-index: 20; overflow: hidden;
}
.panel.open { transform: translateX(0); }

.panel-hdr {
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.panel-close {
  float: right; background: none; border: none;
  color: var(--muted); cursor: pointer; font-size: 18px;
  line-height: 1; padding: 2px 4px; border-radius: 4px; transition: color .1s;
}
.panel-close:hover { color: var(--text); }
.panel-biz { font-size: 17px; font-weight: 600; margin-right: 28px; margin-bottom: 6px; line-height: 1.3; }
.panel-sub { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.panel-sub .rn { font-weight: 600; color: var(--text); }
.panel-sub .st { color: #d29922; }

.panel-body { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 16px; }

.section-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--muted); margin-bottom: 6px;
}
.panel-status-row { display: flex; align-items: center; gap: 10px; }
.panel-status-row .section-label { margin-bottom: 0; }
#panel-status-sel {
  appearance: none; border: 1px solid var(--border); border-radius: 20px;
  font-size: 12px; font-weight: 600; padding: 4px 26px 4px 12px;
  cursor: pointer; outline: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238b949e' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center;
}
#panel-status-sel:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

.divider { border: none; border-top: 1px solid var(--border); }

.meta-grid { display: grid; grid-template-columns: 18px 1fr; gap: 7px 10px; align-items: start; }
.meta-icon { color: var(--muted); margin-top: 1px; }
.meta-val { color: var(--muted); font-size: 13px; line-height: 1.4; }
.meta-val a { color: var(--accent); text-decoration: none; }
.meta-val a:hover { text-decoration: underline; }
.meta-hi { color: var(--text); }

.email-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: #0d2040; border: 1px solid #1e3a5f;
  border-radius: 6px; padding: 4px 10px; font-size: 13px; color: #58a6ff;
}
.social-link {
  display: inline-flex; align-items: center; gap: 5px;
  border-radius: 6px; padding: 3px 10px;
  font-size: 12px; font-weight: 500; text-decoration: none; transition: opacity .15s;
}
.social-link:hover { opacity: 0.8; text-decoration: none !important; }
.ig-link { background: #2d0d20; border: 1px solid #9d174d; color: #f472b6; }
.tt-link { background: #0d2828; border: 1px solid #0f766e; color: #2dd4bf; }

.script-block { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.script-top {
  display: flex; align-items: center;
  padding: 8px 12px; border-bottom: 1px solid var(--border); gap: 8px;
}
.script-top .section-label { margin-bottom: 0; flex: 1; }

.copy-btn {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 500; color: var(--muted);
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 5px; padding: 3px 9px; cursor: pointer; transition: all .15s; white-space: nowrap;
}
.copy-btn:hover { color: var(--text); border-color: var(--accent); }
.copy-btn.copied { color: #3fb950; border-color: #3fb950; }
.copy-btn.hidden-btn { display: none; }

.script-body { padding: 12px; font-size: 13px; color: var(--muted); line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.script-empty { padding: 12px; font-size: 12px; color: var(--muted); font-style: italic; }
.script-empty code { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-style: normal; font-size: 11px; }

::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

.empty-row td { text-align: center; padding: 60px 20px; color: var(--muted); }
.empty-row:hover { background: transparent !important; cursor: default; }
</style>
</head>
<body>

<header>
  <h1>Miami <span>Leads</span></h1>
  <div class="header-stats" id="stat-chips"></div>
  <div class="header-right">
    <div class="search-wrap">
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="search" placeholder="Search leads\u2026" autocomplete="off">
    </div>
  </div>
</header>

<div class="filter-bar">
  <span class="filter-label">Status:</span>
  <button class="filter-btn active" data-f="all">All</button>
  <button class="filter-btn" data-f="not-contacted">Not Contacted</button>
  <button class="filter-btn" data-f="contacted">Contacted</button>
  <button class="filter-btn" data-f="interested">Interested</button>
  <button class="filter-btn" data-f="closed">Closed</button>
  <button class="filter-btn" data-f="not-interested">Not Interested</button>
  <div class="filter-sep"></div>
  <span class="filter-label">Issues:</span>
  <button class="filter-btn wf-btn wf-website" data-w="website">No Website</button>
  <button class="filter-btn wf-btn wf-rating"  data-w="rating">Low Rating</button>
  <button class="filter-btn wf-btn wf-reviews" data-w="reviews">Few Reviews</button>
  <div class="filter-sep"></div>
  <span class="filter-label">Contact:</span>
  <button class="filter-btn cf-btn cf-email"     data-c="email">Email</button>
  <button class="filter-btn cf-btn cf-instagram" data-c="instagram">Instagram</button>
  <button class="filter-btn cf-btn cf-tiktok"    data-c="tiktok">TikTok</button>
</div>

<div class="main">
  <div class="table-wrap" id="tw">
    <table>
      <thead>
        <tr>
          <th style="width:195px">Business</th>
          <th>Address</th>
          <th style="width:128px">Phone</th>
          <th style="width:170px">Email</th>
          <th style="width:100px">Rating</th>
          <th style="width:165px">Weakness</th>
          <th style="width:148px">Status</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

  <div class="panel" id="panel">
    <div class="panel-hdr">
      <button class="panel-close" id="pclose" title="Close (Esc)">&#x2715;</button>
      <div class="panel-biz" id="p-name"></div>
      <div class="panel-sub" id="p-sub"></div>
    </div>
    <div class="panel-body">

      <div class="panel-status-row">
        <div class="section-label">Status</div>
        <select id="panel-status-sel">
          <option value="not-contacted">Not Contacted</option>
          <option value="contacted">Contacted</option>
          <option value="interested">Interested</option>
          <option value="closed">Closed</option>
          <option value="not-interested">Not Interested</option>
        </select>
      </div>

      <hr class="divider">
      <div class="meta-grid" id="p-meta"></div>
      <hr class="divider">

      <div>
        <div class="section-label">Online Issues</div>
        <div id="p-weak"></div>
      </div>

      <hr class="divider">

      <div class="script-block">
        <div class="script-top">
          <div class="section-label">Cold Email</div>
          <button class="copy-btn" id="copy-email">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
        </div>
        <div class="script-body" id="p-email"></div>
      </div>

      <div class="script-block">
        <div class="script-top">
          <div class="section-label">Call Script</div>
          <button class="copy-btn hidden-btn" id="copy-call">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
        </div>
        <div id="p-call"></div>
      </div>

    </div>
  </div>
</div>

<script>
const LEADS = ${LEADS_JSON};

const STATUS_LABELS = {
  'not-contacted':'Not Contacted','contacted':'Contacted',
  'interested':'Interested','closed':'Closed','not-interested':'Not Interested'
};
const STATUS_CLS = {
  'not-contacted':'s-not-contacted','contacted':'s-contacted',
  'interested':'s-interested','closed':'s-closed','not-interested':'s-not-interested'
};

const LS_KEY = 'miami_leads_v1';
let statuses = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
let filter = 'all', query = '', selIdx = null;
let weakFilters = new Set(), contactFilters = new Set();

const $ = id => document.getElementById(id);
function getS(i) { return statuses[i] || 'not-contacted'; }
function setS(i, v) { statuses[i] = v; localStorage.setItem(LS_KEY, JSON.stringify(statuses)); }

function stars(n) {
  n = parseFloat(n) || 0;
  const f = Math.floor(n), h = (n - f) >= 0.25 ? 1 : 0, e = 5 - f - h;
  return '\u2605'.repeat(f) + (h ? '\u00bd' : '') + '\u2606'.repeat(e);
}

function weakBadges(w) {
  if (!w) return '<span style="color:var(--muted);font-size:12px">\u2014</span>';
  return w.split('; ').map(p => {
    let cls = 'wb-website', label = 'No Website';
    if (p.includes('rating'))  { cls = 'wb-rating';  label = p.replace('low star rating','').trim() || 'Low Rating'; }
    if (p.includes('reviews')) { cls = 'wb-reviews'; label = 'Few Reviews'; }
    return '<span class="weak-badge ' + cls + '">' + label + '</span>';
  }).join(' ');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyStatus(el, v) {
  Object.values(STATUS_CLS).forEach(c => el.classList.remove(c));
  el.classList.add(STATUS_CLS[v] || STATUS_CLS['not-contacted']);
}

function statusOptions(cur) {
  return Object.entries(STATUS_LABELS).map(([v,l]) =>
    '<option value="' + v + '"' + (cur===v?' selected':'') + '>' + l + '</option>'
  ).join('');
}

function renderTable() {
  const tbody = $('tbody');
  tbody.innerHTML = '';
  let vis = 0;

  LEADS.forEach((lead, i) => {
    const s = getS(i);

    // Weakness filter (AND — must match all active)
    const w = (lead.weaknesses || '').toLowerCase();
    const weakMatch = weakFilters.size === 0 || (
      (!weakFilters.has('website') || w.includes('no website')) &&
      (!weakFilters.has('rating')  || w.includes('rating'))    &&
      (!weakFilters.has('reviews') || w.includes('reviews'))
    );

    // Contact method filter (AND — must have all selected contact types)
    const hasEmail = !!(lead.contactEmail && lead.contactEmail !== 'not found');
    const hasIG    = !!lead.instagram;
    const hasTT    = !!lead.tiktok;
    const contactMatch = contactFilters.size === 0 || (
      (!contactFilters.has('email')     || hasEmail) &&
      (!contactFilters.has('instagram') || hasIG)    &&
      (!contactFilters.has('tiktok')    || hasTT)
    );

    const show = (filter === 'all' || s === filter) && weakMatch && contactMatch &&
      (!query || [lead.name, lead.address, lead.phone, lead.weaknesses,
                  lead.contactEmail, lead.instagram, lead.tiktok]
        .some(f => f.toLowerCase().includes(query)));

    const tr = document.createElement('tr');
    if (!show)      tr.classList.add('hidden');
    if (i===selIdx) tr.classList.add('selected');
    tr.dataset.i = i;
    if (show) vis++;

    const r    = parseFloat(lead.rating)||0;
    const addr = lead.address.replace(/, USA$/, '').replace(/, FL \\d{5}/, '');

    tr.innerHTML =
      '<td class="td-name"><div class="cell-clamp" title="' + esc(lead.name) + '">' + esc(lead.name) + '</div></td>' +
      '<td class="td-addr"><div class="cell-clamp" title="' + esc(addr) + '">' + esc(addr) + '</div></td>' +
      '<td class="td-phone">' + (lead.phone ? esc(lead.phone) : '<span style="color:var(--muted)">\u2014</span>') + '</td>' +
      '<td>' + (hasEmail ? '<a href="mailto:' + esc(lead.contactEmail) + '" style="color:var(--accent);font-size:12px;text-decoration:none;" onclick="event.stopPropagation()">' + esc(lead.contactEmail) + '</a>' : '') + '</td>' +
      '<td>' + (r ? '<span class="rating-num">' + r.toFixed(1) + '</span><span class="stars">' + stars(r) + '</span>' : '<span style="color:var(--muted)">\u2014</span>') + '</td>' +
      '<td>' + weakBadges(lead.weaknesses) + '</td>' +
      '<td><select class="status-select ' + STATUS_CLS[s] + '" data-i="' + i + '">' + statusOptions(s) + '</select></td>';

    tbody.appendChild(tr);
  });

  if (vis === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = '<td colspan="7">No leads match this filter.</td>';
    tbody.appendChild(tr);
  }
  updateStats();
}

function updateStats() {
  const c = {};
  Object.keys(STATUS_LABELS).forEach(k => c[k] = 0);
  LEADS.forEach((_,i) => c[getS(i)]++);
  $('stat-chips').innerHTML =
    '<span class="stat-chip"><b>' + LEADS.length + '</b> Total</span>' +
    '<span class="stat-chip"><b style="color:var(--muted)">' + c['not-contacted'] + '</b> Untouched</span>' +
    '<span class="stat-chip"><b style="color:#58a6ff">' + c['contacted'] + '</b> Contacted</span>' +
    '<span class="stat-chip"><b style="color:#d29922">' + c['interested'] + '</b> Interested</span>' +
    '<span class="stat-chip"><b style="color:#3fb950">' + c['closed'] + '</b> Closed</span>';
}

// SVG icons for panel meta
var PIN_SVG  = '<svg class="meta-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
var TEL_SVG  = '<svg class="meta-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.79a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
var MAIL_SVG = '<svg class="meta-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>';
var IG_SVG   = '<svg class="meta-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>';
var TT_SVG   = '<svg class="meta-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

function openPanel(i) {
  selIdx = i;
  const l = LEADS[i], s = getS(i);

  $('p-name').textContent = l.name;
  const r = parseFloat(l.rating)||0;
  $('p-sub').innerHTML = r
    ? '<span class="rn">' + r.toFixed(1) + '</span><span class="st">' + stars(r) + '</span><span>' + parseInt(l.reviews).toLocaleString() + ' reviews</span>'
    : '';

  const pss = $('panel-status-sel');
  pss.innerHTML = statusOptions(s); pss.value = s; applyStatus(pss, s);

  const addr = l.address.replace(/, USA$/, '');
  let meta = PIN_SVG + '<span class="meta-val">' + esc(addr) + '</span>';

  if (l.phone) meta +=
    TEL_SVG + '<span class="meta-val meta-hi"><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a></span>';

  // Email row
  const hasEmail = l.contactEmail && l.contactEmail !== 'not found';
  meta += MAIL_SVG + '<span class="meta-val">' + (hasEmail
    ? '<span class="email-chip">&#9993; <a href="mailto:' + esc(l.contactEmail) + '">' + esc(l.contactEmail) + '</a></span>'
    : '<span style="font-style:italic">No email found</span>') + '</span>';

  // Instagram row
  if (l.instagram) meta +=
    IG_SVG + '<span class="meta-val"><a class="social-link ig-link" href="https://instagram.com/' + esc(l.instagram) + '" target="_blank" rel="noopener">@' + esc(l.instagram) + '</a></span>';

  // TikTok row
  if (l.tiktok) meta +=
    TT_SVG + '<span class="meta-val"><a class="social-link tt-link" href="https://tiktok.com/@' + esc(l.tiktok) + '" target="_blank" rel="noopener">@' + esc(l.tiktok) + '</a></span>';

  $('p-meta').innerHTML = meta;
  $('p-weak').innerHTML = weakBadges(l.weaknesses);

  $('p-email').textContent = l.coldEmail || '';
  $('copy-email').classList.toggle('hidden-btn', !l.coldEmail);

  const callEl = $('p-call');
  if (l.callScript) {
    callEl.className = 'script-body';
    callEl.textContent = l.callScript;
    $('copy-call').classList.remove('hidden-btn');
  } else {
    callEl.className = 'script-empty';
    callEl.innerHTML = 'Not generated yet. Run <code>node outreach.js --dry-run</code> to generate.';
    $('copy-call').classList.add('hidden-btn');
  }

  $('panel').classList.add('open');
  $('tw').classList.add('panel-open');
  document.querySelectorAll('#tbody tr[data-i]').forEach(r =>
    r.classList.toggle('selected', parseInt(r.dataset.i) === i));
}

function closePanel() {
  selIdx = null;
  $('panel').classList.remove('open');
  $('tw').classList.remove('panel-open');
  document.querySelectorAll('#tbody tr').forEach(r => r.classList.remove('selected'));
}

function makeCopyBtn(id, getText) {
  $(id).addEventListener('click', e => {
    e.stopPropagation();
    const t = getText();
    if (!t) return;
    navigator.clipboard.writeText(t).then(() => {
      const btn = $(id);
      btn.classList.add('copied');
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1800);
    });
  });
}
makeCopyBtn('copy-email', () => selIdx !== null ? LEADS[selIdx].coldEmail || '' : '');
makeCopyBtn('copy-call',  () => selIdx !== null ? LEADS[selIdx].callScript || '' : '');

$('pclose').addEventListener('click', closePanel);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

$('tbody').addEventListener('click', e => {
  if (e.target.closest('select')) return;
  const row = e.target.closest('tr[data-i]');
  if (!row) return;
  const i = parseInt(row.dataset.i);
  i === selIdx ? closePanel() : openPanel(i);
});

$('tbody').addEventListener('change', e => {
  const sel = e.target.closest('select.status-select');
  if (!sel) return;
  e.stopPropagation();
  const i = parseInt(sel.dataset.i), v = sel.value;
  setS(i, v); applyStatus(sel, v);
  if (i === selIdx) { const ps = $('panel-status-sel'); ps.value = v; applyStatus(ps, v); }
  updateStats();
  if (filter !== 'all') renderTable();
});

$('panel-status-sel').addEventListener('change', e => {
  if (selIdx === null) return;
  const v = e.target.value;
  setS(selIdx, v); applyStatus(e.target, v);
  const rs = document.querySelector('select.status-select[data-i="' + selIdx + '"]');
  if (rs) { rs.value = v; applyStatus(rs, v); }
  updateStats();
  if (filter !== 'all') renderTable();
});

// Status filter (single-select)
document.querySelectorAll('.filter-btn:not(.wf-btn):not(.cf-btn)').forEach(btn => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.f;
    document.querySelectorAll('.filter-btn:not(.wf-btn):not(.cf-btn)').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (selIdx !== null) closePanel();
    renderTable();
  });
});

// Weakness filter (multi-select toggle)
document.querySelectorAll('.wf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const w = btn.dataset.w;
    if (weakFilters.has(w)) { weakFilters.delete(w); btn.classList.remove('active'); }
    else                    { weakFilters.add(w);    btn.classList.add('active');    }
    if (selIdx !== null) closePanel();
    renderTable();
  });
});

// Contact method filter (multi-select toggle)
document.querySelectorAll('.cf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = btn.dataset.c;
    if (contactFilters.has(c)) { contactFilters.delete(c); btn.classList.remove('active'); }
    else                       { contactFilters.add(c);    btn.classList.add('active');    }
    if (selIdx !== null) closePanel();
    renderTable();
  });
});

$('search').addEventListener('input', e => {
  query = e.target.value.trim().toLowerCase();
  renderTable();
});

renderTable();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html);
console.log('Written dashboard/dashboard.html — ' + Math.round(html.length / 1024) + 'KB (' + leads.length + ' leads)');
