# miami-leads

Miami local restaurant lead generation, outreach, and demo site toolkit.

---

## Folder Structure

```
miami-leads/
├── index.js              # Main lead scraper — runs Google Places search & generates cold emails
├── package.json          # npm config & scripts (must stay in root)
├── .env                  # API keys & config (must stay in root, never commit)
├── .env.example          # Template showing required env vars
│
├── data/
│   └── miami_leads.csv   # Master leads file — all businesses, emails, socials, status
│
├── dashboard/
│   ├── build-dashboard.js  # Reads CSV → generates dashboard.html
│   └── dashboard.html      # Lead tracker UI (open in browser)
│
├── outreach/
│   ├── outreach.js         # Generates call scripts (Claude) + sends cold emails (Gmail SMTP)
│   ├── find-emails.js      # Scrapes contact emails for leads (website, Yelp fallback)
│   ├── find-socials.js     # Finds Instagram & TikTok handles via DuckDuckGo
│   ├── regenerate-emails.js # Rewrites all cold emails via Anthropic Batches API (50% cheaper)
│   ├── call-script.html    # NEPQ cold call script (mobile-optimized, open on phone while calling)
│   └── cold-call-script.html # Printable version of the call script (save as PDF from browser)
│
└── demo-sites/
    └── guembos-demo.html   # Demo restaurant website built for Guembo's and Grill pitch
```

---

## npm Scripts

Run all commands from the project root:

| Command | What it does |
|---|---|
| `npm start` | Scrape Google Places → qualify leads → generate cold emails → save to CSV |
| `npm run dashboard` | Rebuild `dashboard/dashboard.html` from the current CSV |
| `npm run find-emails` | Scrape contact emails for leads that don't have one |
| `npm run find-socials` | Find Instagram/TikTok handles for all leads |
| `npm run outreach` | Generate call scripts + send cold emails to leads with email addresses |
| `npm run outreach:dry` | Same as above but prints everything without sending any emails |
| `npm run regen-emails` | Regenerate all cold email copy via Batches API (cheaper, runs in parallel) |

---

## Required Environment Variables

Copy `.env.example` to `.env` and fill in:

```
ANTHROPIC_API_KEY=      # From console.anthropic.com
GOOGLE_PLACES_API_KEY=  # From Google Cloud Console (Places API enabled)
YOUR_NAME=              # Your name (used in email copy and call scripts)
EMAIL_FROM=             # Your Gmail address (for sending outreach)
EMAIL_PASS=             # Gmail App Password (not your login password)
```

---

## Typical Workflow

1. **Scrape leads** — `npm start` → fills `data/miami_leads.csv`
2. **Find contact info** — `npm run find-emails` then `npm run find-socials`
3. **Review leads** — `npm run dashboard` → open `dashboard/dashboard.html`
4. **Do outreach** — use `outreach/call-script.html` on your phone to call, `npm run outreach:dry` to preview emails
5. **Send emails** — `npm run outreach` to send to leads with email addresses
6. **Pitch demo sites** — open `demo-sites/guembos-demo.html` to show prospects

---

## Notes

- `package.json`, `package-lock.json`, and `.env` live in the root. Moving them would break npm and dotenv.
- The dashboard (`dashboard.html`) is auto-generated — don't edit it directly. Edit `build-dashboard.js` and re-run.
- Lead statuses (contacted, interested, closed, etc.) are saved in the browser's localStorage when using the dashboard.
- `miami_leads.csv` is the single source of truth. All scripts read from and write to it.
