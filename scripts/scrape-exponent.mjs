#!/usr/bin/env node
// Scrape Exponent behavioral questions via Playwright.
// Reads _index.json, writes one q-{paddedId}-{slug}.md per question.
// Idempotent: skips files that already exist. Resumable.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const RAW_DIR = 'knowledge/culture/.raw/exponent';
const INDEX_PATH = path.join(RAW_DIR, '_index.json');
const LOG_PATH = path.join(RAW_DIR, '_scrape.log');
const SKIP_PATH = path.join(RAW_DIR, '_skipped.json');
const SUMMARY_PATH = path.join(RAW_DIR, '_summary.md');

const PACE_MS = 2500;
const HYDRATE_MS = 3500;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  process.stdout.write(line);
}

function pad4(id) {
  return String(id).padStart(4, '0');
}

function slugCase(s) {
  return s.toLowerCase().trim().replace(/\s+/g, '-');
}

function formatMarkdown({ id, slug, url, title, roles, companies, categories, comments }) {
  const rolesList = roles.map(slugCase).join(', ');
  const catsList = categories.map(c => c.toLowerCase().trim()).join(', ');
  const companiesYaml = companies.length
    ? companies.map(c => `  - {name: ${c.name}, count: ${c.count}}`).join('\n')
    : '  []';
  const ts = new Date().toISOString();
  let md = `---
source: exponent
source_id: ${id}
source_url: ${url}
scraped_at: ${ts}
roles: [${rolesList}]
companies:
${companiesYaml}
categories: [${catsList}]
---

# ${title}

## Community answers (top 2, capped at 5000 chars each)

### Answer 1
${comments[0]}
`;
  if (comments[1]) {
    md += `\n### Answer 2\n${comments[1]}\n`;
  }
  return md;
}

async function extract(page) {
  return await page.evaluate(() => {
    const title = document.querySelector('h1')?.innerText?.trim() || null;
    const allText = document.body.innerText;
    const gated = /Unlock|Upgrade to Pro|Premium content|Sign up to view/i.test(allText);
    const grab = (label) => {
      const re = new RegExp(label + '\\n([\\s\\S]*?)\\n(?:Roles|Companies|Categories|Practice|Community|Related|$)');
      const m = allText.match(re);
      return m ? m[1].split('\n').map(s => s.trim()).filter(Boolean) : [];
    };
    const roles = grab('Roles');
    const companiesRaw = grab('Companies');
    const companies = companiesRaw.map(c => {
      const m = c.match(/^(.+?)(\d+)$/);
      return m ? { name: m[1].trim(), count: parseInt(m[2], 10) } : { name: c, count: 1 };
    });
    const categories = grab('Categories');
    const comments = [...document.querySelectorAll('.comment')]
      .slice(0, 2)
      .map(el => el.innerText.trim().slice(0, 5000));
    return { title, gated, roles, companies, categories, comments };
  });
}

async function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`Raw dir not found: ${RAW_DIR}`);
    process.exit(1);
  }
  fs.writeFileSync(LOG_PATH, ''); // reset log

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  log(`Loaded index: ${index.length} questions`);

  // Load or init skip log
  let skipped = [];
  if (fs.existsSync(SKIP_PATH)) {
    try { skipped = JSON.parse(fs.readFileSync(SKIP_PATH, 'utf8')); } catch {}
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const counters = { total: index.length, written: 0, alreadyExists: 0, gated: 0, emptyContent: 0, navError: 0, extractError: 0 };
  const start = Date.now();

  for (let i = 0; i < index.length; i++) {
    const { id, slug } = index[i];
    const paddedId = pad4(id);
    const outPath = path.join(RAW_DIR, `q-${paddedId}-${slug}.md`);
    const url = `https://www.tryexponent.com/questions/${id}/${slug}`;

    if (fs.existsSync(outPath)) {
      counters.alreadyExists++;
      continue;
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(HYDRATE_MS);
    } catch (e) {
      log(`[${i+1}/${index.length}] NAV ERROR ${id} ${slug}: ${e.message}`);
      counters.navError++;
      skipped.push({ id, slug, reason: 'navigation-failed', url, error: String(e.message).slice(0,200) });
      continue;
    }

    let data;
    try {
      data = await extract(page);
    } catch (e) {
      log(`[${i+1}/${index.length}] EXTRACT ERROR ${id} ${slug}: ${e.message}`);
      counters.extractError++;
      skipped.push({ id, slug, reason: 'extraction-error', url, error: String(e.message).slice(0,200) });
      continue;
    }

    if (data.gated) {
      counters.gated++;
      skipped.push({ id, slug, reason: 'gated', url });
      log(`[${i+1}/${index.length}] GATED ${id} ${slug}`);
    } else if (!data.title || data.comments.length === 0) {
      counters.emptyContent++;
      skipped.push({ id, slug, reason: 'empty-content', url });
      log(`[${i+1}/${index.length}] EMPTY ${id} ${slug} (title=${!!data.title} comments=${data.comments.length})`);
    } else {
      const md = formatMarkdown({ id, slug, url, ...data });
      fs.writeFileSync(outPath, md);
      counters.written++;
      log(`[${i+1}/${index.length}] WROTE ${id} ${slug} (${data.comments.length} comments, ${data.roles.length} roles, ${data.companies.length} companies)`);
    }

    // Flush skip log every 25 entries
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(SKIP_PATH, JSON.stringify(skipped, null, 2));
    }

    await page.waitForTimeout(PACE_MS);
  }

  fs.writeFileSync(SKIP_PATH, JSON.stringify(skipped, null, 2));

  const runtimeMin = ((Date.now() - start) / 60000).toFixed(1);
  const summary = `# Exponent scrape summary

Completed: ${new Date().toISOString()}
Runtime: ${runtimeMin} min

## Counts
- Total in index: ${counters.total}
- Written: ${counters.written}
- Already existed (skipped): ${counters.alreadyExists}
- Gated (paywalled): ${counters.gated}
- Empty content: ${counters.emptyContent}
- Navigation errors: ${counters.navError}
- Extraction errors: ${counters.extractError}
`;
  fs.writeFileSync(SUMMARY_PATH, summary);
  log(`DONE — written=${counters.written} gated=${counters.gated} empty=${counters.emptyContent} navErr=${counters.navError} extractErr=${counters.extractError} alreadyExists=${counters.alreadyExists} runtime=${runtimeMin}min`);

  await browser.close();
}

main().catch(err => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
