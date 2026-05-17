# Compliance Landscape — PIPE Marketing Research

**Research date:** April 19, 2026
**Scope:** AI hiring compliance obligations, enforcement status, and whether "audit-ready AI hiring" is a real buyer requirement or marketing theater.

---

## TL;DR

- **"Audit-ready" is a real and growing wedge, not theater** — but enforcement has historically been soft. A December 2025 New York State Comptroller audit found NYC DCWP missed 17 violations while only catching 1; that audit triggered a compliance escalation pledge. The signal is: the window of regulatory non-enforcement is closing.
- **The most concrete teeth in 2026 are NYC LL144 (active, $1,500/day/violation), Illinois HB 3773 (effective Jan 1, 2026, $5,000/violation), and Colorado SB 24-205 (effective June 30, 2026).** The EU AI Act's high-risk provisions face a proposed delay to December 2027.
- **Workday's class action certification (May 2025) — 1.1 billion rejected applications, potential hundreds-of-millions collective — is the event that changed enterprise buyer calculus more than any regulation.** Vendors can be held liable as "agents" of discriminating employers.
- **Federal enforcement is effectively off-table** under the Trump administration (EEOC guidance pulled Jan 27, 2025); compliance pressure is entirely state-level and litigation-driven.
- **Vendor compliance marketing is rampant but thin.** Eightfold has ISO 42001. HireVue has published DCI bias audits. Most others claim "compliance support" features without third-party validation.

---

## EU AI Act

### Primary Source
Full text: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
EC overview: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
Implementation timeline: https://artificialintelligenceact.eu/implementation-timeline/

### Status and Timeline

| Date | Obligation |
|------|------------|
| Aug 1, 2024 | Act enters into force; no requirements apply |
| Feb 2, 2025 | Prohibited AI practices banned (e.g., emotion recognition in workplaces, biometric categorization); AI literacy obligations begin |
| Aug 2, 2025 | GPAI model obligations; governance infrastructure; **penalty regime activates** |
| Aug 2, 2026 | Original deadline for high-risk AI system obligations (Articles 6–51) |
| Dec 2, 2027 | **Proposed new deadline** for high-risk standalone systems (under Digital Omnibus amendment, not yet finalized) |
| Aug 2, 2028 | Proposed deadline for high-risk AI embedded in products |

### Hiring as High-Risk AI

Under Annex III, Point 4, the following employment-related systems are classified **high-risk**:
- Systems used to shortlist or rank candidates
- CV screening and matching tools
- Video interview analysis
- Exam scoring and candidate evaluation
- Promotion and termination recommendations

### High-Risk Obligations (once applicable)

Operators and providers must:
1. Maintain technical documentation (Article 11)
2. Ensure human oversight with ability to override (Article 14)
3. Conduct conformity assessments and register in EU AI database (Article 49)
4. Conduct post-market monitoring (Article 72)
5. Provide transparency to affected individuals (Article 50)
6. Test for bias and accuracy across demographic groups

### Fines

- Up to **€35 million or 7% of global annual turnover** for prohibited AI violations (effective Aug 2025)
- Up to **€15 million or 3% of global annual turnover** for other violations

### Critical Uncertainty: The Omnibus Delay

In November 2025, the European Commission proposed the "Digital Omnibus" amendment to delay high-risk AI provisions from August 2026 to December 2, 2027. As of April 2026, this remains a proposal requiring agreement between the European Parliament and EU Council. If agreed before August 2026, the high-risk deadline moves. If not agreed in time, the August 2026 deadline stands.

**Implication for PIPE:** Vendors selling into EU markets face real but uncertain timelines. The July 2024–August 2026 window is used by vendors to market "EU AI Act readiness" even though enforcement is not yet active for high-risk systems. Once active, hiring interview platforms like PIPE would qualify as high-risk under Annex III — requiring conformity assessment, human oversight documentation, and bias testing.

---

## NYC AEDT (Local Law 144)

### Primary Source
https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page
NYC DCWP Rules: https://rules.cityofnewyork.us/rule/automated-employment-decision-tools/

### What It Requires

Local Law 144 applies to any employer or employment agency in NYC using an **Automated Employment Decision Tool (AEDT)** in hiring or promotion decisions for NYC-based employees or applicants.

**Three core obligations:**

1. **Annual Independent Bias Audit**: Must be conducted by an independent third party no more than 12 months before use. Must test for disparate impact by race/ethnicity and sex using EEOC-defined adverse impact ratio (four-fifths rule). Results must be published prominently on the company's career website.

2. **Notice to Candidates**: At least 10 business days before the AEDT is used, employers must notify candidates: (a) that an AEDT will be used; (b) the job qualifications and characteristics assessed; (c) that candidates may request an alternative process.

3. **Alternative Process**: If a candidate requests it, a non-AEDT alternative must be provided.

### Audit Cost

Independent bias audits from firms like DCI Consulting Group typically run **$15,000–$50,000 per tool** depending on scope. NYC LL144 has spawned an ecosystem of specialized audit vendors (FairNow, ORCAA, O'Neil Risk Consulting, DCI Consulting Group, Warden AI).

### Penalties

- **$500 per violation** for first offense
- **$1,500 per violation per day** for subsequent offenses
- Each day an unaudited tool is in use is a separate violation — creating significant compounding exposure

### Enforcement Gap (and Escalation)

In December 2025, the New York State Comptroller conducted an audit of NYC's Department of Consumer and Worker Protection (DCWP) enforcement:

- 75% of test calls to NYC 311 hotline about AEDT issues were misrouted and never reached DCWP
- DCWP surveyed 32 companies and found **1 compliance issue**
- Comptroller's auditors reviewing the same companies found **at least 17 potential violations**
- DCWP agreed to implement all recommendations: better complaint routing, cross-trained staff, proactive investigations

Law firm DLA Piper concluded (December 2025): *"Employers should expect a new phase of stricter enforcement with more frequent investigations and higher penalties."*

Source: https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools

### Published Audit Examples

HireVue's 2023 NYC LL144 bias audit (DCI Consulting) produced nearly 300 bias tables across competencies, job levels, and occupational groupings for race, gender, and intersectional categories. Published at: https://www.hirevue.com/press-release/hirevue-leads-industry-in-fair-and-ethical-hiring-practice-engaging-external-auditor-dci-consulting-group-for-external-bias-audit-of-algorithms

---

## Colorado AI Act (SB 24-205)

### Primary Source
Full text (signed): https://content.leg.colorado.gov/sites/default/files/2024a_205_signed.pdf
Legislative page: https://leg.colorado.gov/bills/sb24-205

### Current Status

- Signed by Governor Polis in May 2024
- **Original effective date: February 1, 2026**
- Governor Polis signed **SB 25B-004** in August 2025, delaying implementation by five months
- **Revised effective date: June 30, 2026**
- Colorado Attorney General is developing implementing regulations with pre-enforcement rulemaking authority

### Scope

Applies to **developers and deployers** of "high-risk artificial intelligence systems" used in "consequential decisions," explicitly including employment decisions (hiring, promotion, termination, compensation).

### Obligations for Deployers

1. **Impact Assessments**: Must complete algorithmic impact assessments documenting purpose, potential discrimination risks, and data governance
2. **Non-discrimination**: Use "reasonable care to protect consumers from any known or reasonably foreseeable risks of algorithmic discrimination"
3. **Transparency**: Notify consumers when a high-risk AI system is used in a consequential decision
4. **Appeal/Accommodation**: Provide consumers a means to appeal or seek human review of consequential AI decisions
5. **Record Keeping**: Maintain documentation of high-risk systems

### Enforcement

- Colorado Attorney General enforces
- **60-day cure period** before formal enforcement action
- No specified per-violation penalty in the statute; AG has general consumer protection enforcement authority (up to $20,000/violation under CCPA framework)

---

## Other US States 2026

### States with Actual Teeth

**Illinois — HB 3773 (Effective January 1, 2026)**
- Makes it unlawful to use AI in employment decisions that discriminates on protected class bases
- Requires employers to notify employees and applicants when AI is used in employment decisions
- Notice must include: AI product name, employment decisions affected, purpose, data collected, targeted positions, contact information
- Enforcement: Illinois AG and Department of Labor; **up to $5,000 per violation**
- 37 cases filed in the first month of enforcement
- Source: https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=4015&ChapterID=68 (Video Interview Act) and HB 3773 (broader employment AI law)

**Illinois — AI Video Interview Act (Older, Pre-2026)**
- Already in force since 2020; requires employer notification, consent, and explanation before AI analysis of video interviews
- Amended 2024 to add race and national origin bias disclosure requirements

**California — FEHA AI Regulations (Effective October 1, 2025)**
- Amends California Fair Employment and Housing Act to explicitly cover AI/automated decision systems (ADS)
- Unlawful to use ADS that discriminates in hiring/promotion based on protected traits
- 4-year record retention for ADS inputs, outputs, and bias testing documentation
- Enforcement: California Civil Rights Department (CRD) and DFEH
- Described by Littler as "the most stringent requirements in the United States on employers' use of AI"
- Source: https://www.dlapiper.com/en-us/insights/publications/2025/10/california-ai-employment-regulations-take-effect

**California — CCPA ADS Rules (Effective January 1, 2027)**
- Pre-use notices, opt-out mechanisms, and bias testing requirements for ADS in employment decisions
- Four-year retention requirement

**Texas — TRAIGA (HB 149, Effective January 1, 2026)**
- Prohibits intentional discrimination through AI systems
- Significantly lighter than Colorado/California: no impact assessment mandate, no disclosure to affected individuals
- Does NOT impose the sweeping obligations the original HB 1709 would have
- Source: https://www.klgates.com/Pared-Back-Version-of-the-Texas-Responsible-Artificial-Intelligence-Governance-Act-Signed-Into-Law-6-24-2025

**Minnesota — Consumer Data Privacy Act (Effective July 31, 2026)**
- Requires disclosure of AI use in employment decisions and opportunity to opt out

**Maryland**
- HB 1202 (2020): Consent required for facial recognition in hiring interviews — very narrow scope
- Broader AI hiring bills (HB 1255, etc.) have failed to pass

### States with Proposed Bills but No Law (as of April 2026)

- Washington state: Multiple bills proposed, none enacted
- New Jersey: Proposed AEDT rules modeled on NYC LL144, not yet enacted
- Massachusetts: Bills introduced, no law

### Federal Preemption Watch

The White House's March 2026 "National AI Legislative Framework" recommends federal preemption of state AI laws deemed "unduly burdensome." This is non-binding; no preemptive federal law has been enacted. State laws remain fully enforceable.

---

## Federal US (EEOC, NIST AI RMF)

### EEOC Post-January 2025

On January 27, 2025, the EEOC **removed its AI-specific hiring guidance** from its website (originally published May 2023 under the Biden administration). This guidance had educated employers on how Title VII and the ADA apply to AI hiring tools.

Key implications:
- The underlying statutes (Title VII, ADA, ADEA) remain in full effect — only the interpretive guidance was removed
- Employers still face potential EEOC enforcement if AI tools produce discriminatory outcomes; they just lost interpretive safe harbor
- The OFCCP (Office of Federal Contract Compliance Programs) **retained** its April 2024 nonbinding guidance on AI use by federal contractors
- The Trump administration's January 23, 2025 executive order "Removing Barriers to American Leadership in Artificial Intelligence" requires agencies to roll back AI regulations

### Practical Federal Enforcement Posture

Multiple law firms (K&L Gates, Holland & Knight, King & Spalding) confirmed in early 2025 analyses: **federal AI-in-hiring enforcement is effectively dormant under the current administration.** The EEOC has de-emphasized AI-related regulatory initiatives. However:

- Title VII, the ADEA, and ADA provide a litigation foundation that is independent of EEOC guidance
- The Workday class action proceeds under these existing statutes — no new regulation required

Source: https://www.klgates.com/The-Changing-Landscape-of-AI-Federal-Guidance-for-Employers-Reverses-Course-with-New-Administration-1-31-2025

### NIST AI RMF

The NIST AI Risk Management Framework (2023) remains a de facto standard that enterprise procurement teams reference. Not legally binding, but widely cited in government RFPs and enterprise AI governance policies. Provides the vocabulary of "bias," "transparency," and "accountability" that buyers use in vendor assessments.

---

## Vendor Compliance Claims — Mapped

| Vendor | Compliance Claims | Certifications/Audits | Substantiated? |
|--------|-------------------|----------------------|----------------|
| **HireVue** | "Compliance king"; supports NYC LL144, EU AI Act, Illinois, California FEHA; configurable data retention; bias monitoring; audit trails | Annual DCI Consulting bias audits (NYC LL144 compliant); O'Neil Risk Consulting audit (limited scope); discontinued facial analysis in 2021 | **Partially** — bias audits published, but DCI audit methodology was limited to pre-built assessments; no EU AI Act certification exists yet |
| **Eightfold AI** | EU AI Act compliant positioning; ISO 42001 certified; human oversight in all decisions; ongoing external bias audits | **ISO/IEC 42001:2023** (August 2025, claimed to be first HR tech vendor certified to all three levels); external auditor confirmed "Instructions for Use"; Match Score bias audits publicly available in Trust Center | **Strongest substantiation** among vendors; ISO 42001 is legitimate third-party certification |
| **Workday** | General fairness claims; compliance with existing laws | Conducted AI Bias Audits per EEOC guidelines; bias audit documentation | **Undermined by litigation** — Mobley v. Workday (class action certified May 2025) covering ~1.1B rejected applications for age, race, and disability bias; conducting audits was insufficient to prevent class certification |
| **HackerRank** | Technical assessment platform; marketed as "objective" skills-based evaluation | No published bias audits found; no compliance certifications publicly documented | **Unsubstantiated** — marketing relies on "skills-based = fair" claim without third-party validation |
| **Greenhouse** | Compliance features listed (EEOC reporting, configurable workflows) | No published bias audits; no AI-specific compliance certifications found | **Thin** — traditional ATS compliance (EEO-1 reporting) not AI-specific |
| **Paradox** | Acquired by Workday (2024); AI interview scheduling and screening | No standalone AI compliance documentation publicly available post-acquisition | **Unknown/insufficient** |
| **Holistic AI** | Sells EU AI Act readiness assessments; positions as compliance vendor | Provides audit services to others; EU AI Act readiness assessment tool | **Third-party auditor rather than hiring platform** |

**Key finding:** No hiring platform currently holds EU AI Act certification because the conformity assessment regime is not yet operational. Claims of "EU AI Act compliance" are forward-looking positioning, not current certification. ISO 42001 (Eightfold) is the only credible third-party AI governance certification currently available.

Sources:
- HireVue: https://www.hirevue.com/blog/hiring/ai-hiring-compliance-insights-for-2026-key-insights-from-hirevue-experts
- Eightfold: https://eightfold.ai/blog/eu-ai-act-hr-leaders/
- Workday: https://fairnow.ai/workday-lawsuit-resume-screening/

---

## Real Buyer Pain vs. Theater

### Evidence That Compliance Is a Real Buying Factor

**1. Litigation risk has changed enterprise calculus**

*Mobley v. Workday* (N.D. Cal., class certified May 2025): Court held AI vendors can be held liable as "agents" of discriminating employers. ~1.1 billion rejected applications in scope. This case, more than any regulation, caused enterprise procurement teams to demand audit documentation from AI hiring vendors.

*Fisher Phillips (2025):* "Employers should conduct regular bias audits of their hiring technologies... [and] be prepared to demonstrate that their use of these tools does not result in disparate impacts on protected groups."

**2. NYC LL144 created a documented audit ecosystem**

The law has been in force since July 2023. Enterprise-scale employers in NYC (finance, media, tech) are publishing bias audit summaries on their career sites. The December 2025 Comptroller audit — finding 17 violations missed by DCWP — is explicitly described by DLA Piper as creating "heightened enforcement risk" and "a new phase of stricter enforcement."

**3. Enterprise procurement is incorporating AI governance criteria**

From Georgia state government procurement guidelines (publicly available, GS-25-002): vendors must provide Algorithmic Impact Assessments, training data documentation, and explainability reports. Enterprise HR technology RFP consultants note 30-40% of scoring weight now allocated to AI governance criteria.

**4. Multi-jurisdictional patchwork creates operational demand**

With California (Oct 2025), Illinois (Jan 2026), Colorado (June 2026), NYC (ongoing), and Minnesota (July 2026) each having different requirements, multinational or multi-state employers cannot manage compliance manually. Baker McKenzie's January 2026 client alert: employers must "implement systems capable of cross-border compliance."

**5. Law firms are billing for AI compliance audits**

Littler, Baker McKenzie, DLA Piper, K&L Gates, Ogletree, Foley & Lardner, Seyfarth Shaw all have published 2025–2026 client alerts on AI hiring compliance. The billable work is real: inventory audits, policy frameworks, vendor due diligence, and bias testing protocols.

### Evidence That Compliance Remains Theater for Some Buyers

**1. Federal enforcement is functionally off**

The EEOC's guidance removal (January 2025) and the Trump administration's deregulatory posture mean there is no federal pressure. Companies outside NYC, Illinois, California, and Colorado face minimal regulatory risk in 2026.

**2. NYC enforcement was actively poor until recently**

The Comptroller's audit confirmed: DCWP identified 1 violation in 32 companies; auditors found 17+. The practical risk of penalties was near-zero until the December 2025 escalation. Many companies have been non-compliant for years without consequence.

**3. No verbatim enterprise RFP language found in public procurement documents**

Despite extensive search, no publicly available private-sector HR technology RFP with specific AI bias audit language was identified. The audit ecosystem and compliance requirements are well-documented in law firm guidance, but direct buyer RFP language is not publicly available. This limits the evidence of compliance as a private-sector switching factor.

**4. Most vendor compliance claims are marketing, not certification**

Outside Eightfold's ISO 42001, no hiring platform holds a recognized AI governance certification. "Audit-ready" and "EU AI Act compliant" are positioning claims, not verified status.

### Verdict

**Compliance is a real wedge in specific buyer segments (large enterprises in NYC/IL/CA/CO, public sector, EU-operating companies, financial services) and is becoming a real wedge in others (any enterprise using AI hiring at scale post-Workday).** For SMBs outside regulated jurisdictions, it remains closer to theater. The trajectory is clearly toward real compliance pressure: the Workday class action, the Comptroller's audit escalation, and the state law patchwork are all tightening simultaneously.

**For PIPE specifically:** PIPE's transcript-based, rubric-scored output addresses the core compliance demand — **auditability and explainability of hiring decisions**. A system that produces a cited, scored artifact (communication / technical / judgment with specific evidence) is structurally better positioned than black-box scoring systems. The compliance angle is strongest with:
- Buyers in NYC, IL, CA, or CO
- Enterprise buyers with EU operations
- Public sector / financial services (regulated industries)
- Any company that has recently received a Workday-style vendor audit inquiry

---

## Sources

### Statutory Primary Sources
1. EU AI Act full text: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
2. EU AI Act implementation timeline: https://artificialintelligenceact.eu/implementation-timeline/
3. EU Digital Strategy overview: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
4. NYC Local Law 144 DCWP page: https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page
5. Colorado SB 24-205 signed text: https://content.leg.colorado.gov/sites/default/files/2024a_205_signed.pdf
6. Colorado legislative page: https://leg.colorado.gov/bills/sb24-205
7. Illinois AI Video Interview Act: https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=4015&ChapterID=68
8. Texas TRAIGA (HB 149): https://legiscan.com/TX/bill/HB1709/2025

### Law Firm Client Alerts
9. Littler — 2025 AI Legislative Landscape: https://www.littler.com/news-analysis/asap/what-does-2025-artificial-intelligence-legislative-and-regulatory-landscape-look
10. Littler — Texas AI: https://www.littler.com/news-analysis/asap/texas-joins-fray-and-enacts-ai-legislation
11. K&L Gates — EEOC Guidance Reversal: https://www.klgates.com/The-Changing-Landscape-of-AI-Federal-Guidance-for-Employers-Reverses-Course-with-New-Administration-1-31-2025
12. K&L Gates — Texas TRAIGA: https://www.klgates.com/Pared-Back-Version-of-the-Texas-Responsible-Artificial-Intelligence-Governance-Act-Signed-Into-Law-6-24-2025
13. DLA Piper — NYC LL144 enforcement escalation: https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/New-York-Critical-audit-of-New-York-Citys-AI-hiring-law-signals-increased-risk-for-employers
14. DLA Piper — California AI regulations: https://www.dlapiper.com/en-us/insights/publications/2025/10/california-ai-employment-regulations-take-effect
15. DLA Piper — EU AI Act latest wave: https://www.dlapiper.com/en-us/insights/publications/2025/08/latest-wave-of-obligations-under-the-eu-ai-act-take-effect
16. Baker McKenzie — Workforce Transformation 2026: https://www.bakermckenzie.com/en/insight/publications/2026/01/a-year-of-workforce-transformation-prioritizing-fairness
17. Baker McKenzie — Employer Report: https://www.theemployerreport.com/2026/03/what-the-march-20-national-ai-legislative-framework-means-for-us-employers-right-now/
18. Hinshaw & Culbertson — Illinois 2026 AI regulations: https://www.hinshawlaw.com/en/insights/blogs/employment-law-observer/illinois-adopts-new-ai-in-employment-regulations-what-employers-need-to-know-for-2026
19. Seyfarth Shaw — Illinois AI law: https://www.seyfarth.com/news-insights/legal-update-new-illinois-ai-law-requires-employee-notice-affirms-existing-employer-nondiscrimination-duties.html
20. Holland & Knight — Federal/state AI divergence: https://www.hklaw.com/en/insights/publications/2025/03/artificial-intelligence-in-hiring-diverging-federal-state-perspectives

### Enforcement and Audit Sources
21. NYC Comptroller audit of LL144 enforcement: https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools
22. Mobley v. Workday class certification: https://www.insidetechlaw.com/blog/2025/06/workday-ai-lawsuit-receives-the-greenlight-to-proceed-as-a-class-action
23. Seyfarth Shaw — Workday agent liability theory: https://www.seyfarth.com/news-insights/mobley-v-workday-court-holds-ai-service-providers-could-be-directly-liable-for-employment-discrimination-under-agent-theory.html
24. Fisher Phillips — Workday class action employer guidance: https://www.fisherphillips.com/en/insights/insights/discrimination-lawsuit-over-workdays-ai-hiring-tools-can-proceed-as-class-action-6-things

### Vendor Compliance Sources
25. HireVue compliance insights 2026: https://www.hirevue.com/blog/hiring/ai-hiring-compliance-insights-for-2026-key-insights-from-hirevue-experts
26. HireVue bias audit announcement: https://www.hirevue.com/press-release/hirevue-leads-industry-in-fair-and-ethical-hiring-practice-engaging-external-auditor-dci-consulting-group-for-external-bias-audit-of-algorithms
27. Eightfold EU AI Act blog: https://eightfold.ai/blog/eu-ai-act-hr-leaders/
28. Workday lawsuit bias audit context: https://fairnow.ai/workday-lawsuit-resume-screening/
29. HireVue bias and legal implications: https://www.hirevue.com/blog/hiring/ai-hiring-legal-ethical-implications

### Additional Reference
30. EU AI Act Digital Omnibus delay proposal: https://www.onetrust.com/blog/eu-digital-omnibus-proposes-delay-of-ai-compliance-deadlines/
31. Colorado SB 205 delayed: https://www.clarkhill.com/news-events/news/colorados-ai-law-delayed-until-june-2026-what-the-latest-setback-means-for-businesses/
32. 50-state AI hiring guide: https://hrforhealth.com/blog/50-state-ai-in-hiring-laws
33. California AI employment bills 2025: https://calmatters.org/economy/technology/2025/08/california-ai-employment-legislation/
34. EEOC AI guidance (archived): https://data.aclum.org/storage/2025/01/EOCC_www_eeoc_gov_ai.pdf
35. Georgia AI procurement guidelines: https://gta-psg.georgia.gov/psg/procurement-ai-tools-guidelines-responsible-use-gs-25-002
