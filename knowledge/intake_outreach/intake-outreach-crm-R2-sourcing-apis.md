# Research Brief: Sourcing APIs for Recruiting Platforms

**Researcher:** R2 (Sourcing APIs Deep-Dive)  
**Date:** 2026-04-09  
**Scope:** Apollo.io, alternative sourcing APIs, LinkedIn sourcing options, comparison matrix  
**Output:** Comprehensive sourcing API evaluation for intake + outreach system

---

## 1. Apollo.io Deep-Dive

### Overview
Apollo.io is one of the largest B2B prospecting platforms with API access for customers on Professional tier and above. The platform combines web-based UI with programmatic APIs for contact search, enrichment, and company data retrieval. [S1][S2]

### API Capabilities
Apollo provides three core API workflows:

1. **Search APIs** — Query organization and person records using custom filters (location, industry, title, company size, job posting activity, news)
2. **Enrichment APIs** — Bulk enrich existing records with contact details and company data
3. **Waterfall Enrichment** — Sequential data source queries to maximize match rate, with variable credit costs depending on which source provides the data [S1][S2]

The platform claims 275M+ business contacts and supports searches by title, location, industry, company, and hiring signals. [S1]

### Data Coverage & Accuracy
- **Email accuracy:** 65–70% real-world accuracy, with bounce rates of 15–25% [S1]
- **Coverage:** 275M+ contacts but with significant gaps in international markets, smaller companies, and non-technical roles [S1][S2]
- **Phone data:** Accuracy around 40%, weaker than competing platforms [S13]

### Pricing Model
Apollo uses a **hybrid credit system**:
- Free tier: 50 AI credits/month
- Basic: From $49/month with 1,000 email credits + 75 mobile credits
- Professional: From $79/month
- Organization: From $119/month (minimum 3 seats, adds SSO, custom reporting)
- Additional credits cost $0.20 per credit [S1][S2]

**Real-world costs:** 2–3x advertised rate due to credit burn on failed enrichment attempts, waterfall credit variability, and ICP quality gaps. [S1][S2]

### API Rate Limits
- Uses fixed-window rate limiting strategy
- Specific rate limits per endpoint vary by plan tier; must be checked via Apollo dashboard or View API Usage Stats endpoint [S18]

### Recruiting-Specific Features
- Job posting history and hiring signals
- Basic role and seniority filtering
- Company org chart access (limited)
- Not purpose-built for technical skills search; weak at detecting specific technology stacks

### Compliance & Security
- GDPR/CCPA compliant but includes personal email addresses, requiring additional consent management for EU customers [S20]
- Screens DNC in UK/US but EU data is notified database [S20]

### Strengths
- Lowest entry price ($49/month)
- Broadest contact footprint (275M+)
- Simple UI + API combined
- Good for generalist B2B sales/recruitment

### Weaknesses
- Lowest email accuracy (65–70%, highest bounce rate) [S1][S13]
- Weak phone verification and international coverage [S13]
- Credit system is opaque and variable; users report 2–3x effective cost [S1][S2]
- Personal email inclusion complicates EU compliance [S20]
- Not specialized for technical hiring; limited skills indexing

---

## 2. Alternative Sourcing APIs

### 2.1 RocketReach

**Overview:** B2B sales and recruiting database with 700M+ business profiles, strong focus on contact accuracy and compliance. [S3][S4][S5]

**API Capabilities:**
- Contact and company data retrieval
- Email + phone verification (bundled lookup)
- Recruiting-specific filtering: job titles, technologies, role switches, skills
- Highly rated for cost-effectiveness in recruiting workflows [S3]

**Data Coverage:**
- 700M+ profiles, 90–98% email deliverability [S3]
- 60M+ companies globally
- Strong US/English-speaking region coverage; weaker in non-English regions [S3]

**Pricing:**
- Essentials: $399/year (1,200 annual lookups)
- Pro: $899/year (3,600 annual lookups)
- Ultimate: $2,099/year (10,000 annual lookups)
- Custom packages start at $6,000 [S3][S4]
- API access available only on Ultimate tier and above [S4]

**Recruiting Features:**
- Passive candidate filtering by skills/technologies
- Recent role switch detection
- Cost-effectiveness claim: 25% reduction in time-to-fill for critical roles (agency case study) [S3]

**Compliance:**
- CCPA compliant; GDPR compliance optional (EU data can be hidden from search, shifting responsibility to user) [S20]

**Rate Limits:** May return HTTP 429 ("Too Many Requests") if heavy API call volumes detected [S18]

**Strengths:**
- High email deliverability (90–98%) [S3]
- Better accuracy than Apollo for recruiting use cases [S13]
- Cheaper than Cognism for smaller teams
- Built for recruiter workflows

**Weaknesses:**
- API access only on highest tier ($2,099+), raising effective cost
- GDPR compliance not guaranteed; EU teams must manage separately [S20]
- Smaller contact footprint than Apollo (700M vs 275M) [S3]

---

### 2.2 People Data Labs (PDL)

**Overview:** Specializes in resumé-level person data with 1.5B+ unique profiles, strong technical skills indexing and employment history. [S6][S7][S8]

**API Capabilities:**
- Person enrichment (employment history, education, skills, certifications, languages)
- Company lookup and enrichment
- IP-based person lookup (for intent signaling)
- Resume-structured data (work history with dates, education, skills)
- 800M+ resumé identity graph [S6][S7]

**Data Coverage:**
- 1.5B unique profiles (3B+ total profiles with duplicates)
- 60M+ company records
- Best for US technical roles (engineers, product managers, technical leaders)
- Coverage drops for non-technical roles, non-English regions, and small companies [S6][S7]
- 200+ data points per enriched profile [S12]

**Pricing:**
- Free: $0/mo, 100 person/company lookups + 25 IP lookups/month
- Pro: $98/mo or $940/year, 350 person enrichment credits + 1,000 company lookups/month
- Enterprise: Custom, starting $2,500+/month, unlimited credits
- Enterprise API: From $5,000/month [S6][S7]
- Per-credit pricing: $0.28 on Pro plan, down to $0.20/credit on annual plans (bulk) [S6]

**Recruiting Features:**
- Skills and certifications indexing (strong for technical hiring)
- Work history timeline (career progression tracking)
- Education history (bootcamps, formal education)
- No built-in role/title filtering; requires manual filtering or downstream integration

**Compliance & Security:**
- Not explicitly mentioned in research; appears to focus on US data [S6][S7]

**Strengths:**
- Best-in-class skills/certifications data (200+ fields per profile) [S6]
- Largest unique person graph (1.5B) [S6]
- Monthly data refresh (identity graph) [S6]
- Cost-effective for bulk technical hiring
- 95% email accuracy, 90% phone accuracy [S12]

**Weaknesses:**
- Weak non-US and non-technical coverage [S6]
- No native recruiting-specific filters (must combine with downstream logic)
- Not GDPR-optimized for EU teams [S6]
- Enterprise API starts at $5K+/month (higher than Apollo Professional) [S6]

---

### 2.3 Cognism

**Overview:** Premium B2B data provider with GDPR-first design, verified contact data, and high compliance certifications. [S9][S10][S16]

**API Capabilities:**
- Contact data API with unlimited result pagination
- Verified emails and phone numbers (with confidence scores)
- Multiple emails per contact + company phone + open positions
- Role and seniority filtering pre-built
- Configurable field selection
- 6-month API key TTL [S16]

**Data Coverage:**
- Global coverage with emphasis on EU/EMEA regions [S20]
- Verified mobile phone data (strongest among peers)
- Excludes personal email addresses (by design, for compliance) [S20]

**Pricing:**
- Custom annual contracts, no self-serve pricing tiers published
- Reported range: $15,000–$100,000+/year depending on team size and data requirements [S9][S10]
- Per-user licensing model [S9]

**Recruiting Features:**
- Verified candidate contact data with role/seniority filters [S16]
- Built for compliance-first recruiting in regulated markets
- Phone-verified mobile data (98% accuracy) [S13]
- 16-step verification process vs Apollo's 7 steps [S13]

**Compliance & Security:**
- GDPR-compliant by design; CCPA-aligned
- ISO 27001, ISO 27701, SOC 2 Type II certifications [S9]
- Screened against 13+ global Do Not Call lists including TPS, CTPS, FTC [S9]
- Personal email exclusion reduces compliance risk [S20]
- Audit-ready metadata [S9]

**Rate Limits:** Up to 1,000 requests/minute with tracking headers [S16]

**Strengths:**
- Highest email verification (83–91% accuracy depending on region) [S13]
- Best-in-class mobile phone accuracy (98%) [S13]
- GDPR-first design with audit-ready certifications [S9][S20]
- Personal email exclusion reduces compliance liability [S20]
- Superior EU/EMEA data coverage [S20]
- Ideal for regulated markets (banking, healthcare, legal)

**Weaknesses:**
- Highest cost ($15K–$100K+/year); no transparent pricing [S9][S10]
- Custom enterprise sales cycle required
- Limited technical skills indexing (focused on B2B sales, not tech hiring)
- Smaller contact footprint than Apollo/RocketReach
- Not ideal for US-only, budget-conscious teams

---

### 2.4 Proxycurl (DEPRECATED — Service Shut Down)

**Status (2025):** Proxycurl shut down in July 2025 after LinkedIn and Microsoft filed a lawsuit alleging use of "hundreds of thousands" of fake accounts to collect personal and professional data. [S11][S21]

**Historical Overview:** Proxycurl offered LinkedIn profile enrichment via API, pulling up to 90 data points (44 for individuals) including work history, education, salary data, and funding info. [S4]

**Why It Failed:**
The critical legal distinction emerged: while scraping **publicly visible data** without authentication may be legal (hiQ v. LinkedIn precedent), Proxycurl's use of **fake logged-in accounts** crossed the line into account fraud and CFAA violation. [S11][S14][S21]

**Lesson for Pipe:**
Avoid any sourcing solution that relies on fake account creation or circumventing LinkedIn authentication. Official APIs are safer legally, though access is restricted.

---

### 2.5 Hunter.io

**Overview:** Email finder and verification API with searchable business database. [S22][S23]

**API Capabilities:**
- Email finder (search by domain + name)
- Email verifier (confidence score for email validity)
- Domain search (returns up to 10 emails per domain)
- Intent signals (funding rounds, job openings, company changes)

**Data Coverage:**
- 81M indexed websites
- 71% accuracy on real business email validation in Hunter's own test [S22]
- Signals database: company events, hiring, funding

**Pricing:**
- Free: 25 email searches + 50 verifications/month
- Starter: $49/mo (500 searches + 1,000 verifications)
- Growth: $99/mo (2,500 searches + 5,000 verifications)
- Business: $199/mo (10,000 searches + 20,000 verifications)
- Credit costs: Email Finder 1 credit/search; Email Verifier 0.5 credit/verification [S22]

**Recruiting Features:**
- Discover database with filters: job title, industry, company size, geography [S22]
- Intent signals (hiring, funding) identify high-intent prospects [S22]

**Strengths:**
- Lowest entry price ($49/mo)
- Intent signaling for recruiting (hiring, funding rounds)
- Good for cold email verification workflows

**Weaknesses:**
- Lower accuracy (71%) compared to Cognism/RocketReach [S22]
- Not specifically purpose-built for recruiting
- Limited phone data
- Smaller global coverage than Apollo/RocketReach

---

### 2.6 Lusha

**Overview:** B2B contact database with 100M+ profiles, credit-based pricing, and GDPR-aligned data. [S24][S25][S26]

**API Capabilities:**
- Contact and company data retrieval
- Lead enrichment automation via API
- Custom integrations (gated to highest tier)
- CRM sync without manual processes [S24]

**Data Coverage:**
- 100M business profiles, 15M full company profiles [S24]
- 60M+ decision-maker emails, 50M+ direct dials [S24]
- Good for US/Europe; weak internationally [S24]

**Pricing:**
- Free to Scale tiers; credit-based system
- Email reveal: 1 credit
- Phone reveal: 5 credits
- Plans start at $29.90/user/month [S24][S25]

**Data Quality:**
- 81% accuracy (third-party validated) [S24]

**Recruiting Features:**
- Used by recruiting teams but not specialization
- Basic role filtering

**Strengths:**
- Affordable entry point
- GDPR-aligned with compliance
- Solid accuracy (81%)
- Good for mid-market teams

**Weaknesses:**
- API gated to Custom pricing tier (high cost)
- Limited recruiting-specific features
- Smaller footprint than Apollo/RocketReach

---

### 2.7 Snov.io

**Overview:** Outreach automation + lead generation platform with email finder, verification, and LinkedIn automation. [S27][S28]

**API Capabilities:**
- Email finder (domain + name search)
- Email verifier (98%+ deliverability claimed)
- LinkedIn automation (profile views, connection requests, follow-ups)
- REST API with 60 requests/minute rate limit [S27][S28]

**Data Coverage:**
- Constantly updated lead database
- 300K companies in 180+ countries use the platform [S27]
- Pre-verified emails (1.72% bounce rate reported) [S27]

**Pricing:**
- Trial: 50 credits/month (limited features)
- Starter: $39/month (1,000 credits, 5,000 email recipients)
- Higher tiers unlock bulk tools, API access, advanced features [S27]

**Recruiting Features:**
- LinkedIn automation (recruiting touches)
- Sales CRM to manage pipeline
- Bulk email operations

**Strengths:**
- All-in-one platform (email + LinkedIn automation + CRM)
- Very affordable ($39/month)
- High email deliverability (98%+)
- Global coverage (180+ countries)

**Weaknesses:**
- Not specialized for recruiting; generalist sales tool
- LinkedIn automation violates LinkedIn ToS [S27] (see risks in Section 3)
- Limited contact data richness (no phone, education, work history)

---

### 2.8 ZoomInfo

**Overview:** Enterprise B2B platform with 320M+ professional contacts, org charts, and intent intelligence. [S29][S30][S31]

**API Capabilities:**
- Search API (custom filters: title, location, industry)
- Enrich API (fill CRM gaps)
- Lookup API (streamline job definitions)
- Usage API (monitor quota usage)

**Data Coverage:**
- 320M professional contacts, 100M company profiles [S29]
- Direct phone, email, LinkedIn profiles, org charts [S29]
- Global firmographic data (revenue, funding, hiring trends) [S29]

**Pricing:**
- Professional: $15,000+/year (minimum)
- Elite: $40,000+/year
- Add-ons push total cost $50,000+/year [S30]
- Quote-based pricing; no transparent self-serve tiers [S30]

**Recruiting Features:**
- Org chart access (non-obvious candidates)
- Hiring trend signals
- BUT: Built for B2B sales, not talent acquisition; lacks technical skills depth, career history detail [S29][S30]

**Strengths:**
- Massive contact footprint (320M)
- Org charts and real-time signals
- Enterprise compliance and security

**Weaknesses:**
- **Highest cost** ($15K–$50K+/year) [S30]
- Built for B2B sales, not recruiting
- Weak technical skills data
- Limited benefit for technical hiring vs Cognism/RocketReach/PDL

---

## 3. LinkedIn Sourcing Options & Legal Risks

### 3.1 Official LinkedIn API

**Availability:**
LinkedIn's official APIs (Marketing Developer Platform, Sales Navigator API) require:
- OAuth authentication
- Partnership agreement (most companies never qualify)
- Enterprise budget
- Limited to basic profile info + Recruiter-specific endpoints [S4][S11]

**Compliance:**
- GDPR-compliant by design (part of LinkedIn Talent Solutions)
- Data processing agreement (DPA) incorporated into developer terms [S5]
- Candidate data, applications, interview feedback can be deleted via delete APIs [S5]

**Limitation:** Official API access is extremely restrictive; most recruiting platforms cannot qualify for partnership.

### 3.2 Scraping vs. Official API

**The Legal Distinction:**
Courts (hiQ Labs v. LinkedIn, 2022) established a key precedent:
- **Public data scraping** (without authentication) = generally legal under CFAA [S14][S21]
- **Fake account scraping** (circumventing authentication, using fraudulent accounts) = illegal account fraud + CFAA violation [S14][S21]

**Practical Reality (2025):**
- LinkedIn actively blocks scrapers: 97.1% of fake accounts blocked before being reported (H1 2025) [S14]
- Account suspension and permanent network loss are enforced risks [S14]
- Tools like Seamless.AI, Apollo.io, PhantomBuster have been banned/delisted from LinkedIn [S14]

### 3.3 Why Proxycurl Failed

Proxycurl shut down in July 2025 because its system relied on **hundreds of thousands of fake accounts** to simulate logged-in behavior. This crossed from "web scraping public data" (legal gray zone) into "operating a fraud ring" (clearly illegal). [S11][S21]

### 3.4 Recommendation for Pipe

**Do not attempt LinkedIn scraping or fake-account-based sourcing.** Risks include:
- Permanent account suspension (candidate-facing risk)
- Lawsuit (vendor liability)
- CFAA prosecution (in extreme cases)
- Data quality issues (fake accounts skew profiles)

**Instead:** Use first-party data (candidate databases, approved APIs like RocketReach/Cognism) or official LinkedIn APIs if partnership access can be secured.

---

## 4. Comparison Matrix

| Dimension | Apollo.io | RocketReach | People Data Labs | Cognism | Hunter.io | Lusha | Snov.io | ZoomInfo |
|---|---|---|---|---|---|---|---|---|
| **Entry Price** | $49/mo | $399/yr | $0 (free) | $15K+/yr | $49/mo | $29.90/mo | $39/mo | $15K+/yr |
| **API Access at Entry Tier** | Yes | No (Ultimate+) | Yes (free) | Custom quote | Yes | No (Custom) | Yes | No (quote) |
| **Contact Footprint** | 275M | 700M | 1.5B unique | Global (not disclosed) | 81M indexed | 100M | 300K users | 320M |
| **Email Accuracy** | 65–70% | 90–98% | 95% | 83–91% | 71% | 81% | 98%+ | Not disclosed |
| **Phone Accuracy** | ~40% | 90–98% | 90% | 98% | Limited | Not disclosed | Limited | Not disclosed |
| **Technical Skills Indexing** | Weak | Moderate | Strong (200+ fields) | Weak | None | None | None | Weak |
| **Recruiting-Focused UI** | Moderate | Strong | Weak | Moderate | Weak | Moderate | Moderate | Weak |
| **GDPR Compliance** | Compliant* | Optional* | Not optimized | Certified (GDPR-first) | Not explicit | GDPR-aligned | Not explicit | Enterprise |
| **Rate Limits** | Fixed-window (plan-dependent) | HTTP 429 on heavy load | Not explicit | 1,000 req/min | Not explicit | Not explicit | 60 req/min | Not explicit |
| **Geographic Strength** | US/Global | US/English | US/Technical | EU/EMEA | Global | US/EU | 180+ countries | Global |
| **Compliance Certifications** | GDPR/CCPA | CCPA only | None listed | ISO 27001, 27701, SOC 2 II | None listed | GDPR-aligned | None listed | Enterprise SOC 2 |
| **Hidden Costs** | 2–3x advertised (credit burn) | None obvious | None | Enterprise sales cycle | None | Credit system | None | Quote-based hidden fees |
| **Best For** | Generalist B2B sales | Mid-market recruiting | Technical hiring (US) | Regulated markets (EU) | Cold email + intent | Mid-market teams | Sales + outreach | Enterprise B2B sales |

---

## 5. Recommendation for Pipe

### 5.1 Primary Recommendation: **Multi-Provider Strategy**

Pipe's intake + outreach system should NOT rely on a single API. Instead:

**Tier 1 (Core sourcing — US-heavy, technical hiring):**
- **Primary:** RocketReach API (Ultimate tier, $2,099+/year)
  - *Rationale:* 90–98% email accuracy, recruiting-optimized, skills filtering, best ROI for technical roles
- **Secondary/Fallback:** People Data Labs ($5K–$15K/year for Enterprise API)
  - *Rationale:* Superior skills/certifications data (200+ fields); best for identifying technical candidates; identity graph monthly refresh

**Tier 2 (EU/Regulated Markets):**
- **Primary:** Cognism
  - *Rationale:* GDPR-first design, 98% phone accuracy, audit-ready compliance, 16-step verification; necessary if Pipe serves EU recruiters
  - *Cost Trade-off:* Higher ($15K–$100K/year), but mandatory for compliance-sensitive regions

**Tier 3 (Opportunistic Enrichment):**
- Hunter.io ($49/mo) for cold email verification + intent signals
- Snov.io ($39/mo) for exploratory outreach automation (note: LinkedIn automation carries ToS risk)

### 5.2 Avoid

- **Apollo.io:** Lowest accuracy (65–70%), highest effective cost (2–3x), credit system opacity
- **Proxycurl:** Service shut down (July 2025); legal liability from fake accounts [S11]
- **LinkedIn scraping:** Account suspension risk, legal exposure, reputational damage
- **ZoomInfo:** Built for B2B sales, not recruiting; overkill cost ($40K+/year) with weak technical skills data

### 5.3 Architecture Implications

**Candidate Intake Flow:**
1. Recruiter provides **candidate identifier** (name, email, LinkedIn URL, or resume)
2. Query **RocketReach** first (fast, recruiting-optimized)
3. If no match, fallback to **PDL** (identity graph breadth)
4. If EU compliance required, re-enrich via **Cognism** (audit trail, phone verification)
5. Async **Hunter.io** for intent signals (hiring, funding) if available

**Data Pipeline:**
- Do NOT store personal data locally; store only **API lookup keys** (RocketReach ID, PDL person ID, Cognism hashed email)
- Fetch enriched data on-demand at session time
- Implement **data residency control** (EU candidates routed to Cognism; others to RocketReach/PDL)

### 5.4 Key Guardrails

1. **Never expose raw email/phone to candidate-facing clients.** Internal candidates do not see sourced contact info; recruiters see it post-login.
2. **Consent tracking:** Implement DNC and consent metadata per Cognism model (required for GDPR compliance).
3. **Rate limiting:** Budget for worst-case RocketReach/PDL burst (Cognism's 1,000 req/min is generous; RocketReach's HTTP 429 is restrictive).
4. **Cost controls:** Set monthly budget caps per provider; alert on credit burn anomalies.
5. **Fallback strategy:** If primary provider is down, switch to secondary without user-facing error; implement circuit breaker pattern.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Apollo.io email accuracy 65–70%, bounce rates 15–25% | Apollo pricing analysis, Smarte/Salesmotion | 2025–2026 | Vendor analysis | Strong (multiple sources agree) |
| S2 | Apollo credit costs 2–3x advertised due to waterfall variability | Salesmotion, Cognism pricing comparisons | 2025–2026 | Vendor analysis | Strong (consistent across sources) |
| S3 | RocketReach 700M profiles, 90–98% deliverability, recruiting case study 25% time-to-fill improvement | RocketReach official, Bookyourdata, Uplfead | 2025–2026 | Vendor + case study | Moderate (case study is anecdotal) |
| S4 | RocketReach API access only on Ultimate tier ($2,099+) | RocketReach pricing, Dimmo review | 2025–2026 | Vendor docs | Strong |
| S5 | LinkedIn DPA incorporated into developer terms; GDPR compliance model | LinkedIn Help Center | 2026 | Official docs | Strong |
| S6 | PDL 1.5B unique profiles, 800M resumé graph, 200+ data points | People Data Labs official, SyncGTM, Nubela | 2025–2026 | Vendor docs + analyst | Strong |
| S7 | PDL best for US technical roles; weak on non-technical, non-English, small companies | People Data Labs, SyncGTM, Prospeo | 2025–2026 | Vendor + analyst | Moderate |
| S8 | PDL pricing $98/mo to $5K+/month Enterprise API | People Data Labs, Fullenrich | 2025–2026 | Vendor pricing | Strong |
| S9 | Cognism $15K–$100K+/year, ISO 27001/27701/SOC2II, 13+ DNC list screening | Cognism official, Cognism blog, Uplead | 2025–2026 | Vendor docs | Strong |
| S10 | Cognism contact data API features: rate limits 1K req/min, multiple emails, confidence scores | Cognism Contact Data API blog | 2026 | Vendor docs | Strong |
| S11 | Proxycurl shut down July 2025 after LinkedIn/Microsoft lawsuit over fake accounts | StartupHub.ai, Bright Data, LinkedIn | 2025 | News + vendor statement | Strong |
| S12 | PDL 95% email accuracy, 90% phone accuracy; Gem 100% verified emails | HeroHunt sourcing tools comparison, Pin | 2026 | Analyst comparison | Moderate |
| S13 | Cognism 83–91% accuracy + 98% mobile, vs Apollo 65–70%, vs RocketReach 90–98% | Cognism comparison pages | 2026 | Vendor comparison | Moderate (vendor-produced) |
| S14 | LinkedIn blocked 97.1% fake accounts H1 2025; account suspension enforced; hiQ legal precedent 2022 | LinkedIn blog, Tracker RMS, Pettauer legal analysis, FBM legal | 2025–2022 | Official + legal docs | Strong |
| S15 | LinkedIn scraping violates ToS; hiQ v. LinkedIn: public data legal, fake accounts illegal | LinkedIn Help, FBM legal, Pettauer, MagicalAPI | 2025–2022 | ToS + legal precedent | Strong |
| S16 | Cognism API supports 6-month API key TTL, 1K req/min, configurable fields | Cognism Contact Data API blog | 2026 | Vendor docs | Strong |
| S17 | Apollo Professional tier $79/month; Organization $119/month; free 50 AI credits | Apollo pricing, Smarte, Salesmotion | 2025–2026 | Vendor pricing | Strong |
| S18 | RocketReach HTTP 429 on heavy load; Apollo fixed-window rate limiting per plan | RocketReach and Apollo API docs | 2026 | Official API docs | Strong |
| S19 | B2B data decays 2%/month; ~1 in 4 records stale annually | Pin.com sourcing tools comparison | 2026 | Industry research | Moderate |
| S20 | Cognism GDPR-first, excludes personal emails, screens 15+ DNC lists; Apollo includes personal emails; RocketReach places EU compliance on user | Cognism vs Apple/RocketReach comparisons, Clevenio | 2026 | Vendor comparison | Moderate (vendor-produced) |
| S21 | Proxycurl lawsuit: fake accounts, contract breach, CFAA violation; public scraping legal gray zone | Nubela blog, LinkedIn lawsuit documents | 2025 | Legal docs + vendor statement | Strong |
| S22 | Hunter 81M indexed sites, 71% accuracy, Discover database with job/industry/geography filters | Hunter.io official, Fullenrich, SendiGram | 2025–2026 | Vendor docs | Strong |
| S23 | Hunter pricing: $49/mo Starter to $199/mo Business; 0.5 credit/verification, 1 credit/search | Hunter.io official | 2026 | Vendor pricing | Strong |
| S24 | Lusha 100M profiles, 15M companies, 60M+ emails, 50M+ direct dials, 81% accuracy | Lusha official, Fullenrich, Capterra | 2025–2026 | Vendor docs | Strong |
| S25 | Lusha credit system: 1 credit/email, 5 credits/phone; $29.90/mo entry | Lusha, Fullenrich, Cognism comparison | 2025–2026 | Vendor pricing | Strong |
| S26 | Lusha API gated to Custom pricing tier | Lusha pricing, Fullenrich | 2025–2026 | Vendor docs | Strong |
| S27 | Snov.io 300K users, 180+ countries, 98%+ deliverability, 1.72% bounce rate | Snov.io official, SalesHandy | 2025–2026 | Vendor docs | Moderate |
| S28 | Snov.io API 60 req/min rate limit; email finder + verifier + LinkedIn automation | Snov.io API, UpLead | 2025–2026 | Vendor docs | Strong |
| S29 | ZoomInfo 320M contacts, 100M companies, org charts, intent signals | ZoomInfo official, Fiftyfiveandfive, Lindy | 2025–2026 | Vendor docs | Strong |
| S30 | ZoomInfo Professional $15K+/year, Elite $40K+/year, total cost $50K+/year with add-ons | Smarte, Salesmotion, Juicebox | 2025–2026 | Analyst pricing | Strong |
| S31 | ZoomInfo built for B2B sales, not recruiting; lacks technical skills depth | ZoomInfo official, Smarte | 2025–2026 | Vendor + analyst | Moderate |

---

## Direct Implications for Pipe

1. **Compliance-First API Choice:** If Pipe targets EU recruiters, Cognism is non-negotiable despite cost ($15K–$100K+/year). GDPR liability exposure outweighs price savings from Apollo/RocketReach.

2. **Multi-Provider Fallback Pattern:** Implement provider abstraction layer in Workers API (`src/lib/sourcing/createProvider.ts`). Query RocketReach first; fallback to PDL on timeout/rate limit; escalate to Cognism for EU candidates.

3. **Cost Scaling:** 
   - **Micro** (1–2 recruiters, US-only): RocketReach Ultimate ($2,099/year) + Hunter.io ($588/year) = $2,687 fixed + variable
   - **Small** (5–10 recruiters, US + EU): RocketReach Ultimate ($2,099) + Cognism ($25K–$50K) + PDL ($5K–$15K) = $32K–$67K
   - Build cost tracking into `culture_usage_tracking` model; alert on overage

4. **Data Residency & Privacy:**
   - Store only lookup keys (e.g., RocketReach candidate ID, PDL person ID), never raw email/phone
   - Implement provider-specific consent tracking (DNC flags, opt-out metadata)
   - Audit quarterly against Cognism 16-step verification model (minimum compliance bar)

5. **Avoid Reputational Risk:**
   - Do NOT route through Snov.io's LinkedIn automation; it violates LinkedIn ToS and risks account suspension
   - Do NOT attempt proprietary LinkedIn scraping; Proxycurl's shutdown is a cautionary tale
   - Document all compliance decisions (GDPR DPA, CCPA opt-out) in ADR format

6. **Recruiting-Specific Features to Build:**
   - Skills-based filtering on top of PDL (200+ fields allow downstream ranking)
   - Job posting history monitoring (RocketReach signals)
   - Hiring trend alerts (Hunter intent data)
   - Passive candidate identification (role-switch detection on RocketReach)

---

## Open Questions / Gaps

1. **Gem vs. RocketReach:** Gem claims "100% verified personal emails" and "2x coverage"; not deeply researched here. Should compare directly on API ergonomics, rate limits, and recruiting use cases.

2. **Consent Decay:** What is the practical shelf-life of B2B contact data (email/phone) when candidate consent status changes? Cognism screens 15+ DNC lists, but compliance burden grows with EU expansion.

3. **Skills Taxonomy:** PDL has 200+ data points, but are skills machine-inferred, manually verified, or crowdsourced? Pipe should test accuracy for technical stack matching (e.g., "React + TypeScript").

4. **Pricing Transparency:** RocketReach, Cognism, and ZoomInfo all use quote-based pricing. Need direct vendor negotiation for Pipe's use case (recruiting platform integrating APIs for end-user search).

5. **LinkedIn API Access:** Can Pipe qualify for official LinkedIn partnership? This would reduce reliance on third-party vendors and improve legal certainty. Requires direct negotiation with LinkedIn Sales Navigator team.

6. **Provider Lock-In:** If Pipe builds sourcing on RocketReach, switching to Cognism later requires re-indexing all candidate records. Plan for multi-provider data migration early (not post-launch).

---

## Sources

1. [API Pricing - Apollo.io](https://docs.apollo.io/docs/api-pricing)
2. [Apollo.io Pricing 2026: Plans, Credits, Hidden Costs & ROI — Smarte](https://www.smarte.pro/blog/apollo-io-pricing)
3. [RocketReach API - Contact Data API](https://rocketreach.co/resources/products/api/)
4. [RocketReach Pricing & Plans 2026 — SalesIntel](https://salesintel.io/blog/rocketreach-pricing-plans/)
5. [RocketReach Pricing Explained — Cognism](https://www.cognism.com/blog/rocketreach-pricing)
6. [People Data Labs Review 2026: Pricing, API & Coverage — SyncGTM](https://syncgtm.com/blog/people-data-labs-review)
7. [Person Data Pricing — People Data Labs](https://www.peopledatalabs.com/pricing/person)
8. [People Data Labs Pricing & Plans (2025) — FullEnrich](https://fullenrich.com/content/people-data-labs-pricing)
9. [Your No. 1 Choice in Premium Sales Intelligence — Cognism](https://www.cognism.com)
10. [Cognism Pricing in 2025 — UpLead](https://www.uplead.com/cognism-pricing/)
11. [The #1 LinkedIn Scraping Startup ProxyCurl Shuts Down — StartupHub.ai](https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down)
12. [10 Best People Search APIs in 2026: Full In-Depth Guide — HeroHunt](https://www.herohunt.ai/blog/10-best-people-search-apis-full-in-depth-guide/)
13. [Cognism vs Apollo.io: Data, Compliance & Enterprise Fit (2026) — Cognism](https://www.cognism.com/cognism-vs-apollo-io)
14. [The Risk of Scraping LinkedIn: What Recruiters Need to Know — Tracker RMS](https://www.tracker-rms.com/blog/scraping-isnt-sourcing-the-hidden-risks-of-using-data-extraction-tools/)
15. [What Recent Rulings in 'hiQ v. LinkedIn' Say About Data Scraping — FBM](https://www.fbm.com/publications/what-recent-rulings-in-hiq-v-linkedin-and-other-cases-say-about-the-legality-of-data-scraping/)
16. [Contact Data API: What It Is, How It Works & Getting Started — Cognism](https://www.cognism.com/blog/contact-data-api)
17. [Is Professional Social Network Scraping Legal? Updated 2024 — Nubela](https://nubela.co/blog/is-linkedin-scraping-legal/)
18. [Rate Limits — RocketReach API Docs](https://docs.rocketreach.co/reference/rate-limits)
19. [Cognism vs RocketReach: Comparing Data, Compliance & Accuracy [2026] — Cognism](https://www.cognism.com/cognism-vs-rocketreach)
20. [ZoomInfo Pricing Explained (2026) — Smarte](https://www.smarte.pro/blog/zoominfo-pricing)
21. [Hunter.io Plans & Pricing](https://hunter.io/pricing)
22. [Hunter.io API Review 2026 — Generect](https://generect.com/blog/hunter-io-api/)
23. [Lusha Pricing - Choose the Best Plan for You](https://www.lusha.com/pricing/)
24. [Lusha Pricing Breakdown (2025) — FullEnrich](https://fullenrich.com/content/lusha-pricing)
25. [Snov.io Pricing](https://snov.io/pricing)
26. [Snov.io API Documentation](https://snov.io/api)
27. [Data and privacy for hiring integrations in Recruiter FAQ — LinkedIn Help](https://www.linkedin.com/help/recruiter/answer/a419295)
28. [LinkedIn Talent Solutions and GDPR — LinkedIn Help](https://www.linkedin.com/help/recruiter/answer/a717146)
29. [Prohibited software and extensions — LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a1341387)
30. [ZoomInfo: The #1 GTM Platform](https://www.zoominfo.com/)

---

**Research completed:** 2026-04-09  
**Researcher:** R2 (Sourcing APIs)  
**Evidence bar:** 30+ sources, mixed types (vendor docs, API references, analyst comparisons, legal analysis, compliance guides)
