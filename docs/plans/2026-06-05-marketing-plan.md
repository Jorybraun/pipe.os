# PIPE Marketing Site & Domain Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. CEO owns this end-to-end.

**Goal:** Deliver a finished, soft light-blue monotone marketing site for PIPE with new hiring-crisis case study routes, professional non-dramatic copy, Google Analytics 4, self-managing marketing board, and the correct primary domain acquired and pointed.

**Architecture:** Static Cloudflare Pages site (existing wrangler.toml). Soft monotone light-blue theme inspired by Hermes app (calm, premium, less intense). New `/crisis/` section with original case studies. GA4 script + events. Modular components for marketing team self-management. Domain: primary recommendation `pipe.ai` (or `getpipe.dev` / `pipehires.com` if unavailable).

**Tech Stack:** Static HTML/CSS/JS, Cloudflare Pages, Google Analytics 4, existing JetBrains Mono + Inter font system (softened).

---

### Task 1: Research and secure the correct domain

**Objective:** Identify and acquire the best available domain that matches the soft, premium PIPE brand.

**Files:**
- Create: `marketing/domain-research.md`

**Step 1: Check current references and availability**

```bash
# Manual checks (user to execute)
whois pipe.ai
whois getpipe.dev
whois pipehires.com
whois pipe.dev
```

Expected: Note registrar, price, and availability.

**Step 2: Write domain research doc**

Document top 3 options with pros/cons, pricing, and recommendation (pipe.ai preferred for brand).

**Step 3: Commit**

```bash
git add marketing/domain-research.md docs/plans/2026-06-05-marketing-plan.md
git commit -m "docs: marketing domain research and plan"
```

### Task 2: Redesign site theme to soft light-blue monotone (less intense)

**Objective:** Update CSS variables and components to a calm, soft light-blue monotone palette while keeping the existing font system and house style.

**Files:**
- Modify: `marketing/index.html` (CSS variables + key sections)
- Modify: `marketing/index.atlas.html` and `index.neuro.html` if they exist

**Step 1: Define new soft light-blue palette**

```css
/* New soft monotone light-blue theme (Hermes-inspired) */
html {
  --bg: #f0f4f8;           /* soft off-white blue */
  --bg-2: #e6ecf2;
  --ink: #1a2a3a;          /* deep calm blue-gray */
  --ink-dim: #4a5a6a;
  --ink-mute: #7a8a9a;
  --rule: #c5d0db;
  --accent: #4a90c2;       /* soft light blue */
  --accent-hot: #3a7ab0;
  --head-filter: none;
}
```

**Step 2: Update hero and nav to feel calmer and less intense**

Remove heavy animations, soften gradients, increase whitespace.

**Step 3: Run local preview and verify**

```bash
cd marketing
python3 -m http.server 8000
# Open http://localhost:8000
```

Expected: Soft light-blue monotone look matching Hermes screenshot reference.

**Step 4: Commit**

### Task 3: Rewrite all copy to be professional, less dramatic ("less gody")

**Objective:** Replace existing copy with calmer, evidence-based, premium tone focused on clarity and trust rather than intensity.

**Files:**
- Modify: `marketing/index.html` (all text sections)
- Create: `marketing/content/crisis-copy.md` (source of truth for new case study copy)

**Step 1: Rewrite hero**

New hero text (example):

```html
<h1>PIPE — Evidence-based hiring.<br>Clear signals. Better decisions.</h1>
<p class="lede">Replace résumés and take-homes with one structured assessment on real work. You get cited transcripts and scores — not guesswork.</p>
```

**Step 2: Rewrite all other sections** (product explanation, benefits, etc.) to be soft, monotone, professional.

**Step 3: Commit**

### Task 4: Create original hiring-crisis case study content and routes

**Objective:** Build 4–6 new, original case studies showing real hiring failures and what PIPE would have caught. Store source copy separately.

**Files:**
- Create: `marketing/crisis/index.html`
- Create: `marketing/crisis/case-001-series-a-mis-hire.html`
- Create: `marketing/crisis/case-002-fraud-signal.html`
- Create: `marketing/content/case-studies/` (markdown source)

**Step 1: Write first case study (Series A mis-hire, $412k cost)**

Include timeline, cost breakdown, PIPE transcript contrast, soft visual treatment.

**Step 2: Build crisis hub page** with cards linking to individual cases.

**Step 3: Add self-managing board table** (HTML + comments so marketing team can edit weekly).

**Step 4: Commit**

### Task 5: Hook up Google Analytics 4

**Objective:** Add GA4 tracking with recommended events for case study performance and funnel.

**Files:**
- Modify: `marketing/index.html` and all crisis pages (head + event calls)

**Step 1: Add GA4 script**

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

**Step 2: Add event tracking** for `view_crisis_case`, `expand_transcript`, `click_case_cta`.

**Step 3: Document measurement plan** in `marketing/analytics.md`

**Step 4: Commit**

### Task 6: Set up weekly marketing strategy meeting (autonomous)

**Objective:** Create a recurring cron that triggers a marketing strategy review using the self-managing board.

**Files:**
- Use cronjob tool to create weekly job

**Step 1: Create the cron**

Schedule: every Monday 09:00

Prompt: Review current case study performance, suggest one new case or copy update, update the self-managing board table.

**Step 2: Test cron once**

**Step 3: Commit schedule**

### Task 7: Deploy and verify

**Objective:** Deploy the finished site to Cloudflare Pages with new domain (once acquired).

**Steps:**
1. Update wrangler.toml with custom domain if supported
2. `wrangler pages deploy . --project-name=pipe-marketing`
3. Verify GA4 is receiving events
4. Test all new routes on mobile

**Commit:** "feat: finished soft light-blue marketing site with crisis case studies and GA4"

---

**Plan complete.** CEO will execute task-by-task using subagents where helpful. Ready to begin with Task 1 (domain research) or jump straight to theme + copy redesign? 

I own delivery of the finished site.