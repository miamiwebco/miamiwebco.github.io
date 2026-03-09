/**
 * outreach.js
 *
 * For every lead in miami_leads.csv:
 *   1. Generates a 30-second call script via Claude (all leads).
 *   2. Sends the cold email via Gmail SMTP (leads with a real email only).
 *
 * Adds two columns to the CSV: "Call Script" and "Email Sent".
 *
 * Required .env vars:
 *   ANTHROPIC_API_KEY   — already set
 *   YOUR_NAME           — already set
 *   EMAIL_FROM          — your Gmail address  (e.g. you@gmail.com)
 *   EMAIL_PASS          — Gmail App Password  (16-char, spaces optional)
 *                         Create one at: myaccount.google.com → Security →
 *                         2-Step Verification → App passwords
 *
 * Usage:
 *   node outreach.js            ← sends emails + prints call scripts
 *   node outreach.js --dry-run  ← prints everything, sends nothing
 */

require('dotenv').config();
const fs       = require('fs');
const nodemailer = require('nodemailer');
const Anthropic  = require('@anthropic-ai/sdk');

const CSV_PATH = 'miami_leads.csv';
const DRY_RUN  = process.argv.includes('--dry-run');
const YOUR_NAME = process.env.YOUR_NAME || 'Nicholas';

// ── Guards ───────────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY not set in .env'); process.exit(1);
}
if (!DRY_RUN) {
  if (!process.env.EMAIL_FROM) {
    console.error('ERROR: EMAIL_FROM not set in .env (your Gmail address)'); process.exit(1);
  }
  if (!process.env.EMAIL_PASS) {
    console.error('ERROR: EMAIL_PASS not set in .env (Gmail App Password)'); process.exit(1);
  }
}

const anthropic = new Anthropic();
const delay = ms => new Promise(r => setTimeout(r, ms));

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

// ── Claude helpers ───────────────────────────────────────────────────────────

async function generateCallScript(lead) {
  const prompt = `You are helping ${YOUR_NAME}, a local Miami digital marketing consultant, prepare a 30-second phone pitch for a cold call.

Business details:
- Name: ${lead.name}
- Address: ${lead.address}
- Weakness: ${lead.weaknesses}

Their cold email (for context — do NOT read this verbatim):
${lead.coldEmail}

Write a natural, spoken-word phone pitch that ${YOUR_NAME} can read off a screen during a cold call. Requirements:
- 70–80 words max (30 seconds at a calm speaking pace)
- Open with a quick, warm intro: who you are and why you're calling THIS business specifically
- One crisp sentence on their online gap and why it costs them customers
- One concrete offer (e.g. "a simple website that shows up in local searches")
- Close with a low-pressure ask: "Would you have 5 minutes this week?"
- Conversational, not salesy — sounds like a real person talking
- Do NOT start with "Hi, my name is" — vary the opener

Return only the script text, no labels or stage directions.`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content.find(b => b.type === 'text')?.text.trim() ?? '';
}

async function generateEmailSubject(lead) {
  const prompt = `Write a short, friendly email subject line (max 8 words) for a cold outreach email to ${lead.name}, a Miami restaurant.
The email is from ${YOUR_NAME}, a local digital marketing consultant, about their online presence gap: ${lead.weaknesses}.
Return only the subject line text, nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 30,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content.find(b => b.type === 'text')?.text.trim() ?? `Quick question about ${lead.name}'s online presence`;
}

// ── Email sender ─────────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendEmail(transporter, lead, subject) {
  await transporter.sendMail({
    from: `${YOUR_NAME} <${process.env.EMAIL_FROM}>`,
    to: lead.contactEmail,
    subject,
    text: lead.coldEmail,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

function isRealEmail(v) {
  return v &&
    v !== 'not found' &&
    !v.includes('duckduckgo') &&
    !v.startsWith('error-') &&
    v.includes('@');
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: ${CSV_PATH} not found.`); process.exit(1);
  }

  const records = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  const [header, ...rows] = records;

  const col = name => header.indexOf(name);
  const C = {
    name:        col('Business Name'),
    address:     col('Address'),
    weaknesses:  col('Weaknesses'),
    coldEmail:   col('Cold Email'),
    contactEmail: col('Contact Email'),
    emailSent:   col('Email Sent'),
    callScript:  col('Call Script'),
  };

  // Add new columns if not present
  if (C.emailSent === -1) {
    header.push('Email Sent');
    C.emailSent = header.length - 1;
    rows.forEach(r => r.push(''));
  }
  if (C.callScript === -1) {
    header.push('Call Script');
    C.callScript = header.length - 1;
    rows.forEach(r => r.push(''));
  }

  const total   = rows.length;
  const emailable = rows.filter(r => isRealEmail(r[C.contactEmail]));

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  miami-leads outreach${DRY_RUN ? '  [DRY RUN — no emails sent]' : ''}`);
  console.log(`${'─'.repeat(52)}`);
  console.log(`  Total leads     : ${total}`);
  console.log(`  With email      : ${emailable.length}`);
  console.log(`  Call scripts    : all ${total} leads`);
  console.log(`${'─'.repeat(52)}\n`);

  const transporter = !DRY_RUN ? createTransport() : null;

  let scriptsDone = 0;
  let emailsSent  = 0;
  let emailsFailed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lead = {
      name:         row[C.name]         ?? '',
      address:      row[C.address]      ?? '',
      weaknesses:   row[C.weaknesses]   ?? '',
      coldEmail:    row[C.coldEmail]     ?? '',
      contactEmail: row[C.contactEmail] ?? '',
    };

    const hasEmail    = isRealEmail(lead.contactEmail);
    const alreadySent = (row[C.emailSent] ?? '').startsWith('sent');
    const hasScript   = !!(row[C.callScript] ?? '').trim();

    const prefix = `[${String(i + 1).padStart(2)}/${total}] ${lead.name}`;
    console.log(prefix);

    // ── Generate call script (skip if already done) ──────────────────────────
    let callScript = row[C.callScript] ?? '';
    if (!hasScript) {
      process.stdout.write('  ✍  Generating call script ... ');
      try {
        callScript = await generateCallScript(lead);
        row[C.callScript] = callScript;
        scriptsDone++;
        process.stdout.write('done\n');
      } catch (err) {
        process.stdout.write(`failed: ${err.message}\n`);
        callScript = '';
      }
      await delay(400);
    } else {
      process.stdout.write('  ✍  Call script already generated\n');
    }

    // Print the call script
    if (callScript) {
      console.log('\n  📞 CALL SCRIPT:');
      console.log('  ' + '─'.repeat(48));
      callScript.split('\n').forEach(line => console.log('  ' + line));
      console.log('  ' + '─'.repeat(48) + '\n');
    }

    // ── Send email (only for leads with a real email) ────────────────────────
    if (hasEmail) {
      if (alreadySent) {
        console.log(`  📧 Email already sent (${row[C.emailSent]})\n`);
      } else {
        process.stdout.write(`  📧 ${DRY_RUN ? '[DRY RUN] Would send' : 'Sending'} to ${lead.contactEmail} ... `);
        try {
          const subject = await generateEmailSubject(lead);
          if (!DRY_RUN) {
            await sendEmail(transporter, lead, subject);
            row[C.emailSent] = `sent ${new Date().toISOString()}`;
          } else {
            row[C.emailSent] = `dry-run ${new Date().toISOString()}`;
          }
          process.stdout.write(`✅ "${subject}"\n\n`);
          emailsSent++;
        } catch (err) {
          process.stdout.write(`❌ ${err.message}\n\n`);
          emailsFailed++;
        }
        await delay(400);
      }
    } else {
      console.log(`  📧 No email address — skip send\n`);
    }

    // Save after each lead so progress isn't lost
    fs.writeFileSync(CSV_PATH, writeCSV([header, ...rows]), 'utf8');
  }

  // Final summary
  console.log('─'.repeat(52));
  console.log(`  Call scripts generated : ${scriptsDone} new  (${total} total)`);
  if (!DRY_RUN) {
    console.log(`  Emails sent           : ${emailsSent}`);
    if (emailsFailed) console.log(`  Emails failed         : ${emailsFailed}`);
  } else {
    console.log(`  Emails (dry run)      : ${emailsSent} would have sent`);
  }
  console.log(`  CSV saved → ${CSV_PATH}`);
  console.log('─'.repeat(52) + '\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
