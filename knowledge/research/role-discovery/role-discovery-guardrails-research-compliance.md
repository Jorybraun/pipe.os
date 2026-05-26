# R2-compliance — Legal Boundaries for AI-Asked Hiring Questions

**Research brief:** `role-discovery-guardrails`
**Researcher:** R2-compliance
**Date:** 2026-04-17
**Scope:** What categories are forbidden or high-risk for an AI that interviews hiring managers (not candidates) to extract role requirements; who bears liability; what audit/disclosure obligations apply.

> **Critical framing note:** Our agent interviews hiring managers, not candidates directly. However, questions that elicit protected-class preferences — "Do you want someone without family obligations?" — are legally equivalent to asking a candidate directly, because they instruct the AI to encode those preferences into a job description or scoring rubric. The downstream harm is the same. Two legal regimes are therefore simultaneously active: (a) the recruiter-facing B2B disclosure obligation, and (b) the candidate-facing discrimination prohibition that flows through the JD and any downstream selection tool we generate.

---

## 1. Protected-class boundaries in US federal law

### 1.1 Statutory framework

| Statute | Protected categories | Employer threshold | Key prohibition mechanism |
|---|---|---|---|
| **Title VII** (42 U.S.C. §2000e et seq.) [S1] | Race, color, religion, sex, national origin | ≥15 employees | Disparate treatment + disparate impact |
| **ADEA** (29 U.S.C. §621 et seq.) [S1] | Age (≥40) | ≥20 employees | Disparate treatment + disparate impact |
| **ADA** Title I (42 U.S.C. §12101 et seq.) [S2] | Disability (physical or mental) | ≥15 employees | Pre-offer disability inquiries; medical exams only post-conditional offer |
| **GINA** Title II (42 U.S.C. §2000ff et seq.) [S3] | Genetic information, family medical history | ≥15 employees | Acquisition, use, or disclosure of genetic info |
| **PDA** (amending Title VII, 42 U.S.C. §2000e(k)) [S1] | Pregnancy, childbirth, related conditions | ≥15 employees | Disparate treatment; no adverse action based on pregnancy |
| **EPA** (29 U.S.C. §206(d)) [S1] | Sex (wage parity) | All employers | Wage differential for equal work |

### 1.2 Forbidden and high-risk question categories by statute

| Protected category | Statute | Example questions that are FORBIDDEN or HIGH-RISK | Notes |
|---|---|---|---|
| **Race / Color** | Title VII [S1, S4] | "What is your racial background?" "Are you biracial?" Any question that identifies or implies race | Disparate impact alone is unlawful; intent irrelevant |
| **Religion** | Title VII [S1, S4, S5] | "Which church do you attend?" "What religion are you?" "Do you observe the Sabbath?" | Exception: BFOQ for religious organizations only |
| **National origin** | Title VII [S1, S4, S5] | "Where were you born?" "What language do you speak at home?" "Are your parents from [country]?" | Citizenship questions are high-risk evidence of national-origin animus |
| **Sex / Gender** | Title VII + PDA [S1, S4] | "Are you pregnant?" "Do you plan to have children?" "Who will care for your children?" "Are you married?" | Marital-status questions indirect sex discrimination; extends to sexual orientation and transgender status post-*Bostock v. Clayton County* (2020) |
| **Age (≥40)** | ADEA [S1, S4] | "What year were you born?" "When did you graduate high school/college?" "How many years to retirement?" | Asking birth date not per se illegal but EEOC says it deters older applicants and is evidence of discriminatory intent [S4] |
| **Disability / Medical** | ADA [S2, S6] | Pre-offer: "Do you have a disability?" "Have you filed workers' comp?" "What prescription drugs do you take?" "Have you been treated for mental health problems?" | ANY disability-related inquiry before conditional offer is prohibited [S6]. AI assessments that analyze physical/mental traits may constitute an unlawful medical exam [S7, S10] |
| **Genetic information / Family medical history** | GINA [S3] | "Does heart disease run in your family?" "Have any close relatives had cancer?" "What is your family medical history?" | Employer must instruct healthcare providers not to provide genetic info even during voluntary wellness exams [S3] |
| **Pregnancy / Childbirth** | PDA + Title VII [S1] | "Are you currently pregnant?" "Do you plan to get pregnant in the next year?" | If asked and candidate is not hired, question constitutes evidence of discriminatory intent [S4] |

### 1.3 The EEOC's "selection procedure" and 4/5ths rule

Under the **Uniform Guidelines on Employee Selection Procedures (UGESP)** [S8], any AI system that "substantially assists or replaces" hiring decisions is a "selection procedure" subject to adverse-impact analysis. The 4/5ths rule: if a protected group's selection rate is less than 80% of the highest-selected group's rate, adverse impact is presumed. The EEOC's 2023 TAD (Title VII AI guidance) explicitly applies UGESP to algorithmic tools [S9], and the employer bears the burden even if the tool was built by a third-party vendor [S9, S10].

---

## 2. State law overlays (CA, NY, IL, CO)

### 2.1 California — FEHA Algorithmic Discrimination Regulations (effective October 1, 2025)

California's Civil Rights Council finalized regulations under FEHA that took effect **October 1, 2025** [S10]. Key provisions that go beyond federal law:

- **Broader "ADS" definition:** An "automated-decision system" includes any computational process that "makes a decision or facilitates human decision making regarding an employment benefit" — even if the tool does not make the final call [S10].
- **Medical inquiry extension:** AI tools that "analyze applicants for physical or mental traits" — including conversational assessments that elicit information about a medical disability — constitute unlawful medical inquiries under FEHA, mirroring but extending federal ADA standards [S10].
- **Ongoing audit obligation:** Single validation at launch is insufficient. Employers must conduct timely, repeatable, and transparent anti-bias tests as regular maintenance [S10].
- **4-year recordkeeping:** All ADS data (selection criteria, outputs, audit findings) must be retained for four years [S10].
- **Third-party vendor liability:** Employers are responsible for AI tools they use from vendors; the "aiding and abetting" prohibition under FEHA explicitly extends to third parties that design or implement such tools [S10].
- **Protected classes under FEHA** are broader than Title VII: include sexual orientation, gender identity, gender expression, marital status, medical condition (cancer, genetic characteristics), military/veteran status, and source of income [S10].

### 2.2 New York — NYC Local Law 144 (AEDT) and NY HRL

**NYC Local Law 144** (eff. January 1, 2023; enforcement July 5, 2023) [S11]:
- Applies to employers and employment agencies using an AEDT to screen candidates for NYC jobs or NYC-based promotions.
- **AEDT definition:** A computational process derived from ML, statistical modeling, data analytics, or AI that produces a simplified output to "substantially assist or replace discretionary decision-making" in employment screening or promotion [S11, S14].
- **Bias audit requirement:** Annual, independent, impartial audit testing for disparate impact on race/ethnicity and sex categories. Auditor must have no financial interest in the AEDT [S11].
- **Notice requirement:** Employers must notify candidates at least 10 business days before using an AEDT, stating what job qualifications and characteristics it assesses and what data is collected [S11].
- **Penalties:** $500 per day (first violation); $500–$1,500 per day (subsequent) [S11, S14].
- **Enforcement gap:** NY State Comptroller's December 2025 audit found DCWP identified 1 violation out of 32 companies reviewed; independent review found ≥17 potential violations. DCWP relies solely on complaint-based enforcement and lacks technical expertise [S12]. (*Note: weak enforcement posture reduces immediate operational risk but does not change legal obligations.*)
- **NY HRL** protects additional categories: marital status, sexual orientation, domestic violence victim status, and (state-wide) hairstyle/texture (CROWN Act equivalent) [S5].

### 2.3 Illinois — HB 3773 (eff. January 1, 2026)

Illinois HB 3773 amends the Illinois Human Rights Act [S13]:
- Prohibits employer use of AI that "has the effect of subjecting employees to discrimination" based on protected classes in recruitment, hiring, promotion, discharge, or terms of employment — including unintentional disparate impact [S13].
- **Notice obligation:** Employers must notify employees/applicants when AI is used to "influence or facilitate" any covered employment decision, regardless of whether the AI causes discrimination [S13].
- Bans use of ZIP codes as proxies for protected characteristics [S13].
- Draft IDHR rules require notice "whenever AI influences or facilitates any covered employment decision" — a very broad trigger [S13].

### 2.4 Colorado — SB 24-205 (effective June 30, 2026)

*(See also Section 5 for detailed analysis.)* Key state-law overlay elements:
- Colorado's protected classes under state law include sexual orientation, marital status, and source of income — broader than federal Title VII [S1, S16].
- The AI Act adds a duty-of-care obligation: developers and deployers of high-risk AI must take "reasonable care" to avoid algorithmic discrimination [S16].
- Civil enforcement by Colorado AG; no private right of action under the AI Act itself (but state anti-discrimination laws do carry private suits) [S16].

### 2.5 Key state law differential summary

| Issue | Federal baseline | CA (from Oct 2025) | NYC (from Jul 2023) | IL (from Jan 2026) | CO (from Jun 2026) |
|---|---|---|---|---|---|
| Bias audit required | No (but UGESP applies) | Yes, ongoing | Yes, annual | No (compliance defense) | Yes, annual impact assessment |
| Notice to candidates | No | No specific mandate | Yes, 10 days pre-AEDT | Yes, AI disclosure | Yes, consumer notice |
| Vendor liability | Employer-primary | Explicit 3P liability | Employer-primary | Employer-primary | Developer + deployer split |
| Medical inquiry expansion | ADA/GINA threshold | Extends to AI assessments of physical/mental traits | Silent | Silent | Silent |
| Recordkeeping | Not specified | 4 years | Not specified | Draft rules pending | Impact assessment docs |

---

## 3. EEOC 2023 AI guidance

### 3.1 Two documents, now removed but underlying law unchanged

The EEOC issued two technical assistance documents in 2023:

**Document 1 — AI + ADA (May 12, 2023)** [S2, S6]: *"The Americans with Disabilities Act and the Use of Software, Algorithms, and Artificial Intelligence to Assess Job Applicants and Employees."* Joint publication with DOJ. Key holdings:
1. **Prohibited inquiries:** If AI use results in applicants "having to provide information about disabilities or medical conditions," it constitutes a prohibited disability-related inquiry under ADA, even if the employer did not intend to ask about disability [S6].
2. **Screening out:** AI that screens out a disabled person who could do the job with reasonable accommodation violates the ADA, regardless of the AI's underlying logic [S6].
3. **Accommodation obligation:** Employers must have a process to provide reasonable accommodations when using AI selection tools — e.g., offering a non-AI alternative for someone whose disability affects their performance on an AI assessment [S6].
4. **Employer liability for vendors:** Employers are liable for discriminatory AI tools built and administered by third-party vendors; cannot rely on vendor assurances [S6, S9].

**Document 2 — AI + Title VII (May 18, 2023)** [S9]: *"Assessing Adverse Impact in Software, Algorithms, and Artificial Intelligence Used in Employment Selection Procedures."* Key holdings:
1. Algorithmic tools used to "make or inform decisions about hiring, promotion, termination" are "selection procedures" under UGESP [S9].
2. Employers must assess for adverse impact using the 4/5ths rule or statistical significance testing [S8, S9].
3. If disparate impact exists, employer must demonstrate the tool is "job-related and consistent with business necessity" AND that no less-discriminatory alternative exists equally effectively [S9].
4. Video interview tools that analyze facial expressions and speech patterns are explicitly named as covered selection procedures [S9].
5. Third-party vendor tools: employer bears full liability regardless of vendor compliance representations [S9].

### 3.2 Trump administration rollback — January 2025

On **January 27, 2025**, the EEOC quietly removed both technical assistance documents from its website as part of a broader federal AI deregulation push [S15]. However:

- The underlying statutes (Title VII, ADA, ADEA, GINA, PDA) remain fully in force [S15, S17].
- The guidance documents were *non-binding* — they explained existing law, they did not create new obligations. Removing them does not change what the law says [S15].
- The **EEOC's Strategic Enforcement Plan (2024–2028)**, which prioritizes technology-related employment discrimination, remains formally active until explicitly modified [S15].
- **State and local laws are unaffected** by the federal rollback; CA, NYC, IL, and CO rules all remain in force [S15].
- Practical consequence: reduced federal enforcement pressure in the short term, but the *legal exposure* remains; courts interpret Title VII, ADA, and ADEA independently of EEOC guidance [S17].

### 3.3 Implications for our use case (interviewing hiring managers)

The EEOC's AI+ADA guidance is most directly relevant. If our system:
- Asks hiring managers whether candidates should be able to work weekends (which could elicit religious accommodation requests)
- Asks about physical requirements in a way that maps onto disability categories
- Records and analyzes voice patterns of the hiring manager (a future feature risk)

...any downstream JD or scoring rubric that encodes those preferences becomes a selection tool subject to ADA, Title VII, ADEA, and GINA scrutiny. The EEOC's 2023 documents — though removed from the agency website — remain the definitive record of how those agencies interpreted these statutes with respect to AI.

---

## 4. NYC Local Law 144 (AEDT)

### 4.1 Scope and definition

**Local Law 144 of 2021** [S11, S14], enforced from July 5, 2023, applies when:
- The employer or employment agency is using the tool to screen candidates for positions **located in New York City**, OR
- The employer is using it for NYC-based promotion decisions.

**AEDT definition (exact statutory language):** A computational process, derived from machine learning, statistical modeling, data analytics, or artificial intelligence, that produces a simplified output, including a score, classification, or recommendation, that is used to "substantially assist or replace" discretionary decision-making in employment screening [S11, S14].

**"Substantially assist or replace"** means:
- The tool's output is the only criterion used, OR
- The output is weighted more heavily than all other criteria combined, OR
- The output overrides human judgment [S11, S14].

### 4.2 What qualifies vs. what does not

**Qualifies as AEDT:**
- Resume screening software scoring and ranking applicants
- Pre-employment assessment platforms generating scores
- Productivity monitoring tools generating scores used in promotion screening [S14]

**Likely does NOT qualify:**
- A tool whose output is one minor input among many in a discretionary human decision
- A tool that merely assists a human reviewer but does not control the outcome [S14]

**Gray zone for our system:** If our role-discovery agent generates a job description that is then fed into a downstream scoring AI (which the platform also provides), the chain of tools collectively may constitute an AEDT workflow. The JD specifications generated by our agent could be characterized as "criteria" that the AEDT then applies. NYC legal counsel should assess at deployment.

### 4.3 Audit requirements

Annual bias audit must include [S11]:
- Selection rates for each race/ethnicity (Hispanic or Latino, White, Black or African American, Asian) and sex (Male, Female) category
- "Impact ratios" showing relative selection rates
- Data sources and assessed population
- Audit date and auditor identity
- Published summary on employer's website

**Note:** The law does NOT require correction if bias is found — only that the audit results be published.

### 4.4 Notice requirements

Employers must notify candidates at least **10 business days before** using an AEDT:
- That an AEDT will be used
- What job qualifications and characteristics it will assess
- What data it collects and how long it retains data [S11]

### 4.5 Enforcement posture (as of December 2025)

The NY State Comptroller's December 2025 audit [S12] of DCWP enforcement found:
- DCWP identified 1 violation in 32 companies reviewed
- Independent review found ≥17 potential non-compliance instances
- DCWP relies solely on complaint-based enforcement
- Only 2 complaints received during audit period; neither properly processed
- Test calls to 311 system were misdirected to other agencies
- DCWP lacks technical expertise and did not consult OTI

**Practical implication:** Current enforcement is weak. However, (a) the Comptroller audit will likely spur remediation, (b) class action plaintiffs' attorneys are active in this space, and (c) non-compliance remains a legal risk even without active DCWP investigation.

---

## 5. Colorado AI Act (SB 24-205)

### 5.1 Overview

**Colorado SB 24-205**, signed May 2024, effective **June 30, 2026** (delayed from February 1, 2026 by SB 25B-004 [S16]). Applies to developers and deployers of "high-risk artificial intelligence systems" that make or substantially influence "consequential decisions" that have a material legal or similarly significant effect on employment or employment opportunities [S16].

### 5.2 High-risk AI and employment

A system is high-risk when it is deployed to make, or be "a substantial factor" in making, a consequential decision about:
- The cost or terms of employment
- The provision or denial of employment opportunity [S16]

**This includes:** AI tools used in recruiting, candidate screening, promotion decisions, termination. By extension, a role-discovery AI that substantially shapes a JD (which then becomes the scoring criteria) is potentially a component of a high-risk AI pipeline.

### 5.3 Developer obligations

Developers must [S16]:
1. Make available to deployers a **disclosure statement** about the high-risk system's design, intended uses, limitations, and known or reasonably foreseeable risks of algorithmic discrimination
2. Make available documentation necessary for deployers to complete **impact assessments**
3. Publish a public statement summarizing types of high-risk systems they offer and how they manage discrimination risks
4. **Notify** the Colorado AG and known deployers within specified timeframes if they discover evidence of algorithmic discrimination [S16]

**For our platform as a developer:** We must provide recruiting-platform deployers (enterprise customers) with the documentation they need to conduct their own impact assessments. We must notify customers if we discover our system is causing or may cause discriminatory outcomes.

### 5.4 Deployer obligations

Deployers must [S16]:
1. Implement a **risk management policy and program** that governs high-risk AI use
2. Complete an **impact assessment** before deployment, annually, and within 90 days of intentional and substantial modification
3. **Notify consumers** (job applicants, employees) when a high-risk AI system is used in a consequential decision about them
4. Provide consumers the ability to **correct incorrect personal data** processed by the AI
5. Provide an **appeal pathway** — human review of adverse consequential decisions where technically feasible [S16]

### 5.5 Liability and enforcement

- **Enforcement:** Colorado Attorney General; no private right of action under SB 24-205 itself
- **Standard of care:** "Reasonable care" to avoid algorithmic discrimination
- **State anti-discrimination law** (CADA) still carries private suits and parallels federal protections with broader protected classes (including sexual orientation, marital status) [S16]

---

## 6. EU AI Act — HR high-risk provisions

### 6.1 Annex III classification

The EU AI Act (Regulation 2024/1689), published in the Official Journal June 2024, effective August 1, 2024, with HR provisions applying **August 2, 2026** [S18, S19]. **Annex III, Section 4** classifies the following as high-risk AI systems:

> "AI systems intended to be used for the recruitment or selection of natural persons, in particular to place targeted job advertisements, to analyse and filter job applications, and to evaluate candidates."

> "AI systems intended to be used to make decisions affecting terms of work-related relationships, the promotion or termination of work-related contractual relationships, to allocate tasks based on individual behaviour or personal traits or characteristics or to monitor and evaluate the performance and behaviour of persons in such relationships." [S18]

**Our role-discovery agent:** Depending on how JD outputs are used, the agent may fall under this definition. If the agent's JD outputs are used as inputs to an EU-facing recruitment process, compliance is required.

### 6.2 Article 9 — Risk Management System

Providers of high-risk AI must establish a risk management system covering [S19]:
- Continuous, iterative identification and analysis of known and reasonably foreseeable risks
- Risk estimation and evaluation for each intended purpose
- Risk mitigation measures
- Documentation and ongoing monitoring post-deployment

### 6.3 Article 10 — Data and Data Governance

Training, validation, and testing data must be [S19]:
- Relevant, representative, and free from errors
- Appropriate statistical properties for the intended purpose
- Examined for biases that could lead to violations of fundamental rights
- Governed by documented data governance practices

### 6.4 Article 14 — Human Oversight

High-risk AI must be designed so that natural persons can [S20]:
- Understand the system's capabilities and limitations
- Detect anomalies, dysfunction, and unexpected performance
- Avoid automation bias
- Override, disregard, or reverse outputs
- Intervene and halt the system

Deployers must implement oversight measures commensurate with the system's risks, level of autonomy, and deployment context. **August 2, 2026 enforcement date.**

### 6.5 Article 16 — Obligations of Providers

Before placing a high-risk system on the EU market, providers must [S19]:
- Ensure compliance with Articles 8–15 (risk management, data governance, technical documentation, logging, transparency, human oversight, accuracy, robustness, cybersecurity)
- Register in the EU-wide database
- Affix CE marking
- Notify the EU AI Office of serious incidents

### 6.6 Penalties

Non-compliance with Annex III high-risk requirements: up to **€30 million or 6% of global annual turnover**, whichever is higher. Violations of the general prohibition provisions: up to €35 million or 7% of turnover [S19].

### 6.7 Relevance threshold for our system

If we have EU customers (enterprise clients recruiting EU-based candidates), our role-discovery agent and any downstream scoring tools are likely in scope. The JD generation workflow — where our AI substantially shapes the criteria by which candidates will be evaluated — is plausibly caught by the "evaluate candidates" language in Annex III Section 4.

---

## 7. Liability allocation — case law and settlements

### 7.1 iTutorGroup v. EEOC — $365,000 settlement (August 2023)

**Citation:** EEOC v. iTutorGroup, Inc., EEOC Press Release, Aug. 9, 2023 [S21]
**Statute violated:** ADEA
**Facts:** iTutorGroup programmed its application screening software to automatically reject female applicants aged ≥55 and male applicants aged ≥60. Over 200 U.S.-based applicants were rejected. Discovered when an applicant submitted two identical applications differing only in birth date — only the application with a younger DOB received an interview.
**Settlement:** $365,000 distributed to rejected applicants; mandatory anti-discrimination training; new policies; ban on requesting birth dates; five-year EEOC monitoring.
**Significance:** First-ever EEOC enforcement action involving AI hiring discrimination. Establishes: (a) intentional encoding of discriminatory criteria into AI is ADEA-violating regardless of who wrote the code; (b) the employer (not just the software maker) is liable; (c) EEOC will pursue AI-specific discrimination claims.

**Implication for our platform:** If our agent asks a hiring manager "Do you prefer candidates who graduated recently?" or "Are you looking for someone early in their career?" and those preferences are encoded into a JD or scoring rubric, the resulting selection procedure may violate ADEA on the same theory iTutorGroup violated it.

### 7.2 Mobley v. Workday — Class action (ongoing, 2023–present)

**Citation:** Mobley et al. v. Workday, Inc., No. 3:23-cv-00770 (N.D. Cal.) [S22, S23]
**Statutes:** Title VII (race), ADA (disability), ADEA (age)
**Facts:** Derek Mobley, a Black man over 40 with anxiety and depression, applied to over 80 jobs using Workday's applicant tracking system and was systematically rejected by the AI screening tool. He alleged the AI perpetuated historical hiring biases.

**Key rulings:**
- **July 2024:** Court rejected "employment agency" theory (Workday is not a staffing agency under Title VII) but **allowed "agent" theory to proceed to discovery** — Workday could be directly liable as an agent of its employer-customers [S23].
- **April 2024:** EEOC filed Statement of Interest (amicus brief) arguing Workday qualifies as an "employment agency," an "indirect employer," and an "agent" under Title VII, ADA, and ADEA [S22]. Court accepted only the agent theory.
- **May 16, 2025:** Judge Rita Lin (N.D. Cal.) certified a nationwide collective action under ADEA. Common question: "Whether Workday's AI recommendation system has a disparate impact on applicants over forty." Workday estimated the class could include "hundreds of millions" of members who applied during the relevant period [S23].
- **Current status (April 2026):** Case is in discovery phase. Opt-in deadline for ADEA class was March 7, 2026.

**Critical liability principle established:** An AI hiring platform/vendor can be directly liable as an "agent" of its employer-customers even if the platform does not make final hiring decisions. The platform is treated as having "delegated control" of the hiring process from the employer. This theory is now confirmed at the class certification stage and explicitly endorsed by the EEOC [S22, S23].

### 7.3 ACLU complaint — HireVue / Intuit (March 2025)

**Citation:** ACLU complaint on behalf of Meriah Kirwa, filed with EEOC and Colorado Civil Rights Division, March 2025 [S24]
**Facts:** A deaf, Indigenous woman's AI video interview told her to "practice active listening." The AI assessed facial expressions and speech patterns, disadvantaging her due to her disability.
**Status:** Pending before EEOC and Colorado Civil Rights Division as of April 2026. (Single source — unverified as to final outcome.)
**Significance:** Extends disability discrimination framework to AI interview tools that assess non-verbal cues in ways that systematically disadvantage disabled candidates. Directly relevant to any AI that evaluates interview participants beyond their text responses.

### 7.4 Amazon AI Recruiting Tool (2018, self-discontinued)

**Citation:** Reuters/MIT Technology Review reporting, 2018 [S25]
**Facts:** Amazon internally developed and then scrapped an AI recruiting tool after discovering it penalized resumes containing the word "women's," downgraded graduates of women's colleges, and favored verbs more commonly used by male engineers ("executed," "captured"). The tool trained on 10 years of submitted resumes, which were overwhelmingly from men.
**No enforcement action** (self-discontinued). EEOC did not bring charges.
**Legal analysis:** As noted by ACLU reporting [S25], the tool would have been a Title VII disparate impact violation — algorithms that disproportionately screen out a protected group due to training-data bias violate Title VII regardless of intent.
**Implication for our platform:** A role-discovery agent that learns from historical JDs or recruiter patterns will absorb embedded biases. The JDs generated may themselves encode historically discriminatory criteria (e.g., "culture fit," "prestige university," code words for racial or gender exclusion).

### 7.5 Liability allocation framework — synthesis

Based on Mobley (2024–2025), EEOC TADs (2023), FEHA regulations (2025), and Colorado SB 24-205 (2026):

| Party | Basis for liability | How it arises in our context |
|---|---|---|
| **Employer/Recruiter** (our customer) | Primary: Title VII, ADA, ADEA, GINA, PDA; state analogs. Employer is always on the hook for selection procedures it uses [S1, S2, S3, S9]. | Customer uses our JD + scoring to screen candidates. If selection produces disparate impact, customer is primarily liable. Cannot escape by pointing to us. |
| **Our platform (Pipe)** | Secondary but real: "agent" theory (Mobley); "aiding and abetting" under FEHA [S10]; developer obligations under Colorado SB 24-205 [S16]; EU AI Act provider obligations [S18]. | If we substantially shape the criteria that feed into candidate screening — even indirectly via JD generation — we may be directly liable. Agent theory applies when we have substantial control over the workflow. |
| **Both / joint** | EEOC's April 2024 brief in Mobley endorsed three theories under which both employer and vendor bear direct liability [S22]. "The employer cannot rely on a vendor's assessment of the tool's disparate impact" [S9]. | Enterprise contracts should allocate indemnification and audit responsibility; but contract provisions do not insulate from statutory liability to affected candidates [S9]. |

**The single most important liability-allocation finding:** The "agent" theory confirmed in Mobley means a platform vendor who has substantial influence over the hiring workflow — not just the employer who makes the final call — can face direct statutory liability under Title VII, ADA, and ADEA. The EEOC endorsed this interpretation in April 2024. This is now law at the class-certification stage.

---

## 8. Disclosure and consent obligations

### 8.1 When the interviewee is a recruiter (B2B context)

Our agent's direct user is a hiring manager or recruiter — not a candidate. Does that change the disclosure calculus? Partially yes, but not completely:

**Arguments that reduced disclosure applies (B2B context):**
- CCPA/CPRA exemptions: employer-employee and B2B contexts have historically received lighter treatment. However, as of January 1, 2023, California's B2B exemption sunset, and all California personal information is now subject to full CPRA treatment [S26].
- The recruiter is a sophisticated business user, not a consumer applicant.
- NYC Local Law 144 and state AI notice laws are aimed at *candidates*, not hiring managers.

**Arguments that disclosure still applies:**
- **CCPA/CPRA [S26]:** The recruiter is an individual whose personal data (conversation content, voice recordings, session logs) is being collected and processed. Our privacy notice must disclose what data we collect, how we use it, and whether we share it with third parties (including any underlying LLM providers). Failure to include an LLM provider in a CPRA privacy notice is a violation [S26].
- **Illinois HB 3773 [S13]:** Requires notice when AI is used to "influence or facilitate" a covered employment decision. If the AI is generating content that influences a hiring decision (the JD, the scoring rubric), this may trigger notice obligations to the *employer entity's employees* (the hiring manager using the tool), even though that person isn't the one being assessed.
- **EU GDPR Article 13/14 [S18]:** If the hiring manager is EU-resident, we must provide lawful basis, data retention periods, and whether any automated decision-making is involved in processing their conversation data.
- **EU AI Act transparency (Article 52) [S18]:** Systems that interact with natural persons must disclose they are AI (unless the context makes it obvious). Our agent should disclose its AI nature in the UI.
- **Colorado SB 24-205 [S16]:** Developer disclosure to deployers is mandatory; deployers must have sufficient documentation to conduct impact assessments.

### 8.2 Practical disclosure matrix

| Trigger | Applicable law | What must be disclosed | To whom |
|---|---|---|---|
| Collecting conversation/session data from recruiter | CCPA/CPRA [S26] | Categories of data collected, purposes, third-party LLM disclosure, retention | Recruiter (as individual) via privacy notice |
| Downstream JD/scoring influences candidate hiring in NYC | NYC LL144 [S11] | AEDT use, what it assesses, data collected | Candidates (10 days notice) |
| Downstream AI influences hiring in IL | IL HB 3773 [S13] | AI is being used in employment decisions | Employees/applicants |
| Downstream AI influences hiring in CA | FEHA ADS regs [S10] | Potentially: bias audit results available; nature of ADS | Candidates (through employer) |
| Downstream AI used in employment in CO (post Jun 2026) | CO SB 24-205 [S16] | AI involvement in consequential decision, appeal rights, human review option | Affected consumers (candidates) |
| EU users (recruiter or candidate) | GDPR Art. 13 + EU AI Act Art. 52 [S18] | AI identity disclosure; lawful basis; data retention; automated decision-making involvement | All EU data subjects |
| Hiring manager interface (EU AI Act) | EU AI Act Art. 16 [S18] | High-risk AI system notification to worker representatives and workers | Workers subject to high-risk AI |

### 8.3 Specific obligation: does our system require opt-in consent from the recruiter?

For the US: No mandatory opt-in for using AI in a B2B HR tool aimed at the recruiter. However:
- Privacy notices must be conspicuous and accurate (CCPA/CPRA)
- If we analyze voice or video of the recruiter (not just the candidate), Illinois BIPA (Biometric Information Privacy Act) may require explicit written consent — BIPA is among the most litigated privacy statutes in the US (single source — unverified for our specific use case; BIPA analysis by dedicated counsel is recommended before launching voice features in IL).

For the EU: GDPR Article 6 lawful basis is required. "Legitimate interest" is likely the appropriate basis for B2B processing, but requires a balancing test documenting interests vs. rights. "Consent" is technically possible but creates operational complexity.

---

## 9. Sensitivity ladder recommendation

Based on the foregoing statutory and case-law analysis, we recommend the following four-tier classification for questions our AI agent may consider asking a hiring manager:

### Tier 0: BLOCKED — Never generate, never ask, never accept as input

Questions in this tier are facially unlawful regardless of context. If a hiring manager volunteers a Tier-0 preference, the system must reject it and explain why it cannot be encoded.

| Question / topic | Statute(s) | Enforcement precedent |
|---|---|---|
| Candidate's age, date of birth, year of graduation (when used as proxy for age), "early career only," "no near-retirement" | ADEA [S1]; iTutorGroup precedent [S21] | EEOC enforcement; $365K settlement |
| Candidate's race, skin color, ethnicity | Title VII [S1] | Broad EEOC enforcement history; 4/5ths rule |
| Candidate's disability status, specific health conditions, medical history, workers' comp history, prescription medications | ADA [S2, S6]; FEHA [S10] | ACLU/HireVue complaint pending [S24] |
| Candidate's pregnancy status, family planning intentions, parental status used as qualification | PDA + Title VII [S1, S4] | Title VII disparate treatment theory |
| Candidate's genetic information or family medical history | GINA [S3] | Strict acquisition prohibition |
| Candidate's national origin, birthplace, language spoken at home | Title VII [S1, S5] | Established EEOC guidance |
| Candidate's religion or religious practices | Title VII [S1, S5] | Exception only for verified BFOQ |
| Candidate's sexual orientation or gender identity | Title VII (post-*Bostock*) [S1]; FEHA [S10] | Bostock v. Clayton County (2020) |

**Specific to our role-discovery agent:** Blocked inputs include any recruiter preference statement that encodes the above (e.g., "someone without family obligations," "native English speaker," "culturally fit with our young team"). The system must block these from entering the JD and must log the rejection.

### Tier 1: HIGH-RISK — Flag, require explicit recruiter justification, do not auto-encode

Questions that may have a legitimate business rationale in narrow circumstances but carry substantial legal risk unless the recruiter provides a documented BFOQ (Bona Fide Occupational Qualification) or job-related necessity justification.

| Question / topic | Why high-risk | Legitimate narrow exception |
|---|---|---|
| Physical requirements (lifting, standing) | Can elicit disability information; CA FEHA treats AI analysis of physical traits as medical inquiry [S6, S10] | Only if genuinely essential function of the job; must be documented |
| Language proficiency requirements | Proxy risk for national origin [S1, S5] | Permissible only if the specific language is required for the role's actual duties, not "English only as a preference" |
| Weekend / evening / holiday availability | Proxy risk for religious accommodation requests [S1] | Permissible if shift coverage is a genuine job requirement, not a general preference |
| "Cultural fit" descriptors without objective criteria | Historically courts and EEOC treat culture-fit as a proxy for racial/gender bias (Amazon case [S25]) | Only if mapped to specific, documented, job-related behavioral competencies |
| Citizenship or immigration status preferences | Evidence of national-origin discrimination; separate INA restrictions [S5] | Narrow exceptions for government-contract roles with verified security requirements |
| Criminal history | Disparate impact on Black and Latino applicants per EEOC guidance (2012, not rescinded) [S1] | Only if conviction is directly job-related and recent |
| Salary history questions | Many states prohibit (not federal) | Check state law; CA, NY, CO prohibit in hiring |

### Tier 2: MEDIUM — Collect with care; validate job-relatedness before encoding

Questions that gather facially neutral information but may encode protected-class risk if used incorrectly.

| Question / topic | Risk | Mitigation |
|---|---|---|
| Years of experience thresholds | ADEA proxy if threshold indirectly correlates with age [S1] | Frame as minimum, not maximum; validate job necessity |
| Educational credential requirements | Disparate impact on race and national origin documented in EEOC guidance [S1] | Only when credential has documented job nexus; "degree preferred" vs. "degree required" |
| Travel requirements | Can disproportionately impact caregivers (sex discrimination risk, PDA) [S1] | State as factual job requirement, not preference; avoid subjective framing |
| Remote vs. in-office requirements | Disproportionate impact on disabled employees who may need remote as accommodation [S2, S6] | Flag if stated as absolute; note accommodation obligation |
| Compensation / pay band | Disparate-impact risk if band encodes historical biases | Document market-rate basis |

### Tier 3: LOW — Standard collection; no special handling required

Facially neutral job-related information with no protected-class proximity.

| Question / topic | Notes |
|---|---|
| Technical skills and tool proficiencies | Directly job-related; no protected class proximity |
| Portfolio, code samples, published work | Job-related; no protected class proximity |
| Work samples or take-home assessments | Permissible; ensure ADA accommodation process exists for candidates [S6] |
| Desired start date or notice period | Neutral; do not anchor to age |
| Reporting structure and team composition | Organizational; neutral |
| Role responsibilities and deliverables | Core JD content; neutral |
| Compensation philosophy (performance-based, etc.) | Neutral; document to defend EPA/pay equity claims |

---

## Evidence table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Title VII, ADEA, PDA, EPA statutory prohibitions | EEOC Fact Sheet: Federal Laws Prohibiting Job Discrimination; 42 U.S.C. §2000e et seq.; 29 U.S.C. §621 | 1964/1967/1978 | Primary — federal statute | Strong |
| S2 | ADA Title I; pre-offer disability inquiry prohibition | ADA.gov AI guidance PDF; 42 U.S.C. §12101; EEOC AI+ADA TAD | 1990/2022/2023 | Primary — statute + agency guidance | Strong |
| S3 | GINA Title II prohibition on genetic info acquisition | EEOC GINA Q&A; 42 U.S.C. §2000ff | 2008/2010 | Primary — statute + agency guidance | Strong |
| S4 | EEOC "What Shouldn't I Ask When Hiring" guidance; prohibited question examples | EEOC.gov/employers/small-business/what-shouldnt-i-ask | 2024 | Primary — agency guidance | Strong |
| S5 | EEOC Prohibited Employment Policies/Practices; national origin/religion | EEOC.gov/prohibited-employment-policiespractices | 2024 | Primary — agency guidance | Strong |
| S6 | ADA + AI TAD May 2022: AI disability inquiries, screening out, accommodation | ADA.gov/resources/ai-guidance/; EEOC TAD | 2022 | Primary — joint DOJ/EEOC guidance | Strong |
| S7 | California FEHA algorithmic discrimination regulations | Ogletree Deakins; Mayer Brown; Jackson Lewis analysis | 2025 | Secondary — law firm analysis of primary reg | Strong |
| S8 | UGESP — 4/5ths rule, adverse impact, validation | EEOC Q&A on UGESP; 29 C.F.R. Part 1607 | 1978/2024 | Primary — federal regulation | Strong |
| S9 | EEOC May 2023 TAD — AI selection procedures, Title VII, vendor liability | Mayer Brown; Littler; Seyfarth analyses + EEOC press release | 2023 | Primary guidance (secondary analysis) | Strong |
| S10 | California FEHA AI regulations (eff. Oct 1, 2025) | Ogletree 10 FAQs; Mayer Brown; Paul Hastings; Jackson Lewis | 2025 | Secondary — law firm analysis | Strong (multiple independent sources) |
| S11 | NYC Local Law 144 text, DCWP final rules, FAQ | NYC.gov DCWP AEDT page; NYC Rules AEDT Updated | 2022/2023 | Primary — municipal statute + agency rules | Strong |
| S12 | NY State Comptroller December 2025 audit of DCWP enforcement | NYS Office of the State Comptroller, Dec. 2, 2025 | 2025 | Primary — government audit report | Strong |
| S13 | Illinois HB 3773 (AI employment discrimination + notice) | Ogletree; Seyfarth; National Law Review analysis | 2024/2025 | Secondary (primary statute in Illinois HR Act) | Strong |
| S14 | NYC Local Law 144 AEDT definition, audit requirements | Epstein Becker Green; Holistic AI; DCWP FAQ | 2023 | Secondary — law firm + DCWP official FAQ | Strong |
| S15 | EEOC removed guidance January 2025; underlying laws unchanged | Cooley alert (Feb 2025); K&L Gates; National Law Review | 2025 | Secondary — law firm analysis | Strong |
| S16 | Colorado SB 24-205 text; developer/deployer obligations; June 2026 deadline | Pacific AI compliance guide; Brownstein; ABA analysis; Colorado General Assembly bill text | 2024/2026 | Primary statute + secondary analysis | Strong |
| S17 | Federal anti-discrimination laws remain in force despite rollback | Cooley; Husch Blackwell; National Law Review | 2025 | Secondary — law firm analysis | Strong |
| S18 | EU AI Act Annex III Section 4 (employment AI = high-risk); Article 16 obligations | EU AI Act official text via artificialintelligenceact.eu | 2024 | Primary — EU regulation | Strong |
| S19 | EU AI Act Articles 9, 10, 14, 16 requirements for high-risk AI providers | artificialintelligenceact.eu; Hunton; DPO Consulting analysis | 2024 | Primary + secondary | Strong |
| S20 | EU AI Act Article 14 human oversight exact requirements | artificialintelligenceact.eu/article/14/ | 2024 | Primary — EU regulation | Strong |
| S21 | iTutorGroup $365K EEOC settlement — first AI discrimination enforcement | EEOC press release, Aug. 9, 2023 | 2023 | Primary — EEOC enforcement action | Strong |
| S22 | EEOC April 2024 amicus brief in Mobley v. Workday | Seyfarth; Epstein Becker Green analyses of EEOC filing | 2024 | Secondary (primary: EEOC court filing) | Strong |
| S23 | Mobley v. Workday class certification May 2025; agent theory | Fisher Phillips; Seyfarth; Holland & Knight; Law and the Workplace | 2024/2025 | Secondary — law firm analysis of court order | Strong |
| S24 | ACLU complaint re HireVue / Intuit (deaf, Indigenous candidate) | HR Dive; ACLU reporting; nquiringminds.com | 2025 | Secondary — news reporting | Moderate (single complaint, not yet resolved) |
| S25 | Amazon AI recruiting tool — Title VII disparate impact analysis | MIT Technology Review; ACLU; Reuters (2018) | 2018 | Secondary — journalism + ACLU legal analysis | Strong (well-documented, multiple sources) |
| S26 | CPRA/CCPA disclosure obligations — third-party LLM disclosure | nodes.inc; teamfill.net; GDPR/CCPA compliance guides | 2024/2025 | Secondary — compliance analysis | Moderate (single-source on LLM disclosure detail) |

---

## Direct implications for the project

1. **The sensitivity ladder (Sections 9) is actionable immediately.** Tier 0 blocks must be hard-coded. Tier 1 blocks require a documented BFOQ override flow with legal review. Tier 2 items must be validated for job-relatedness before encoding into a JD or scoring rubric.

2. **Platform liability is confirmed, not theoretical.** Mobley v. Workday (class certified May 2025) with EEOC endorsement establishes that an AI workflow platform can be directly liable as an "agent" even without making final hiring decisions. The classification is based on control over the hiring workflow, not final say. We control the JD spec — that is sufficient.

3. **The EEOC guidance removal in January 2025 does not reduce legal risk.** It reduces near-term federal enforcement probability; it does not change the underlying statutes or the live case law (Mobley, iTutorGroup). State laws (CA FEHA, NYC LL144, IL HB 3773, CO SB 24-205) are all currently active or activating in 2026.

4. **For enterprise buyers (compliance posture), the disclosure architecture matters.** Colorado SB 24-205 (Jun 2026) requires developer-to-deployer documentation. NYC LL144 requires annual bias audits of AEDTs. California FEHA requires ongoing audit records. We must build a documentation and audit package that our enterprise customers can use to meet their obligations — this is a product requirement, not just a legal one.

5. **The B2B "recruiter interview" context does not escape disclosure.** The hiring manager using our agent is (a) a natural person whose data we collect (CCPA/CPRA obligations), (b) potentially EU-resident (GDPR), and (c) operating a workflow that generates content used in decisions that trigger candidate-facing obligations under NYC LL144, IL HB 3773, and CA FEHA. Both chains of obligation must be built into our onboarding and runtime flows.

---

## Open questions / gaps

1. **Does our role-discovery agent qualify as an "AEDT" under NYC LL144?** The law targets tools that "substantially assist or replace discretionary decision-making" in *screening*. Our agent produces a JD and potentially a scoring rubric. If that rubric is directly fed into a downstream screening AI (which we also offer), does the chain constitute a single AEDT? Requires NYC-specific legal analysis.

2. **BIPA (Illinois Biometric Information Privacy Act) exposure if we record voice.** If the recruiter conversation includes voice data that could identify the speaker, and we have Illinois users, BIPA requires explicit opt-in written consent before collection. This is a high-litigation statute (hundreds of millions in settlements in other contexts). Confirm scope before launching voice features.

3. **Trump-era federal deregulation trajectory.** The administration's "AI dominance" posture may produce executive orders attempting to preempt state AI laws. The National Law Review (April 2025) reports this conflict is live. Outcome unknown; monitor.

4. **Status of HireVue/Intuit EEOC complaint (filed March 2025).** Whether the EEOC (under current administration) pursues this complaint will reveal current federal enforcement appetite for AI interview tool disability claims. Outcome pending.

5. **Scope of Colorado AG enforcement.** Colorado SB 24-205 takes effect June 30, 2026. The AG's enforcement posture, regulations implementing the statute, and whether the AG will pursue private-sector AI hiring tools proactively is not yet established.

6. **EU AI Act conformity assessment procedure details.** The exact conformity assessment pathway for high-risk AI systems in employment — whether self-assessment or third-party audit is required — depends on Article 43 and whether our system falls under specific listed categories in Annex III. Full analysis requires dedicated EU regulatory counsel.

---

## Sources

All primary statutes, regulations, and enforcement actions are marked **(Primary)**. Law firm analyses and secondary coverage are marked **(Secondary)**.

1. EEOC. *Federal Laws Prohibiting Job Discrimination: Questions and Answers* + Title VII (42 U.S.C. §2000e), ADEA (29 U.S.C. §621), PDA (42 U.S.C. §2000e(k)). EEOC.gov. 2024. **(Primary — statute + agency guidance)** https://www.eeoc.gov/fact-sheet/federal-laws-prohibiting-job-discrimination-questions-and-answers

2. ADA.gov + EEOC. *Algorithms, Artificial Intelligence, and Disability Discrimination in Hiring.* DOJ/EEOC Technical Assistance, May 2022. **(Primary — joint agency guidance)** https://www.ada.gov/resources/ai-guidance/

3. EEOC. *Fact Sheet: Genetic Information Nondiscrimination Act (GINA).* 42 U.S.C. §2000ff. 2010. **(Primary — statute + agency guidance)** https://www.eeoc.gov/laws/guidance/fact-sheet-genetic-information-nondiscrimination-act

4. EEOC. *What Shouldn't I Ask When Hiring?* EEOC Small Business Guide. 2024. **(Primary — agency guidance)** https://www.eeoc.gov/employers/small-business/what-shouldnt-i-ask-when-hiring

5. EEOC. *Prohibited Employment Policies/Practices.* 2024. **(Primary — agency guidance)** https://www.eeoc.gov/prohibited-employment-policiespractices

6. EEOC. *Enforcement Guidance: Pre-Employment Disability-Related Questions and Medical Examinations.* ADA Title I. **(Primary — agency enforcement guidance)** https://www.eeoc.gov/laws/guidance/enforcement-guidance-preemployment-disability-related-questions-and-medical

7. California Civil Rights Council. *FEHA Algorithmic Discrimination Regulations* (eff. Oct 1, 2025). Analyzed via Ogletree Deakins, Mayer Brown, Jackson Lewis. **(Primary regulation — secondary analysis)** https://ogletree.com/insights-resources/blog-posts/10-faqs-about-californias-new-algorithmic-discrimination-rules/

8. EEOC. *Questions and Answers: Clarify and Provide Common Interpretation of Uniform Guidelines on Employee Selection Procedures (UGESP)*, 29 C.F.R. Part 1607. **(Primary — federal regulation)** https://www.eeoc.gov/laws/guidance/questions-and-answers-clarify-and-provide-common-interpretation-uniform-guidelines

9. EEOC. *Assessing Adverse Impact in Software, Algorithms, and Artificial Intelligence Used in Employment Selection Procedures Under Title VII*, Technical Assistance, May 18, 2023. Analyzed via Mayer Brown, Littler, Seyfarth. **(Primary guidance — secondary analysis)** https://www.mayerbrown.com/en/insights/publications/2023/07/eeoc-issues-title-vii-guidance-on-employer-use-of-ai-other-algorithmic-decisionmaking-tools

10. California Civil Rights Council. *FEHA ADS Regulations, eff. Oct 1, 2025.* Analysis by Ogletree (10 FAQs), Paul Hastings, Mayer Brown, Jackson Lewis. **(Secondary — law firm analysis of primary regulation)** https://www.jacksonlewis.com/insights/californias-new-ai-regulations-take-effect-oct-1-heres-your-compliance-checklist

11. New York City. *Local Law 144 of 2021 (AEDT Law)*; DCWP Final Rules; DCWP FAQ. **(Primary — municipal statute and rules)** https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page

12. New York State Office of the Comptroller. *Enforcement of Local Law 144 — Automated Employment Decision Tools.* Audit report, December 2, 2025. **(Primary — government audit)** https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools

13. Illinois General Assembly. *HB 3773 (2024), amending Illinois Human Rights Act* (eff. Jan 1, 2026). Analysis by Ogletree, Seyfarth, National Law Review. **(Primary statute — secondary analysis)** https://natlawreview.com/article/illinois-anti-discrimination-law-address-ai-goes-effect-1-january-2026

14. Epstein Becker Green / Holistic AI. *Taking Stock of New York City's Automated Employment Decision Tools Law.* 2023. **(Secondary — law firm analysis)** https://www.workforcebulletin.com/taking-stock-of-new-york-citys-automated-employment-decision-tools-law

15. Cooley LLP. *Gone but Not Forgotten: Federal Laws Still Apply Despite AI Guidance Disappearance Act.* February 21, 2025. **(Secondary — law firm analysis)** https://www.cooley.com/news/insight/2025/2025-02-21-gone-but-not-forgotten-federal-laws-still-apply-despite-guidance-disappearance-act

16. Colorado General Assembly. *Senate Bill 24-205: Consumer Protections for Artificial Intelligence* (signed May 2024, eff. June 30, 2026). Analysis by Pacific AI, Brownstein, ABA. **(Primary statute — secondary analysis)** https://leg.colorado.gov/bills/sb24-205 ; https://pacific.ai/colorado-ai-act-compliance-guide-for-developers-and-deployers/

17. K&L Gates / Holland & Knight / National Law Review. *AI Hiring Law Analysis, Post-Rollback Federal Landscape.* 2025. **(Secondary — law firm analysis)** https://www.hklaw.com/en/insights/publications/2025/03/artificial-intelligence-in-hiring-diverging-federal-state-perspectives

18. European Parliament and Council. *EU Artificial Intelligence Act (Regulation 2024/1689)*, Annex III Section 4; Articles 9, 10, 14, 16. Official text via artificialintelligenceact.eu. Published June 2024, HR provisions eff. August 2, 2026. **(Primary — EU regulation)** https://artificialintelligenceact.eu/annex/3/ ; https://artificialintelligenceact.eu/article/14/

19. DPO Consulting / HR-ON / Hunton. *High-Risk AI Systems Under the EU AI Act — HR Guide.* 2025. **(Secondary — law firm and compliance analysis)** https://www.dpo-consulting.com/blog/high-risk-ai-systems ; https://hr-on.com/eu-ai-act-for-hr-2026/

20. EU AI Act. *Article 14: Human Oversight.* Exact statutory text via artificialintelligenceact.eu. **(Primary — EU regulation)** https://artificialintelligenceact.eu/article/14/

21. EEOC. *iTutorGroup to Pay $365,000 to Settle EEOC Discriminatory Hiring Suit.* EEOC Press Release, August 9, 2023. **(Primary — EEOC enforcement action)** https://www.eeoc.gov/newsroom/itutorgroup-pay-365000-settle-eeoc-discriminatory-hiring-suit

22. EEOC. *Statement of Interest in Mobley v. Workday*, filed April 9, 2024 (N.D. Cal. No. 3:23-cv-00770). Analysis by Seyfarth Shaw, Epstein Becker Green. **(Primary court filing — secondary analysis)** https://www.seyfarth.com/news-insights/legal-update-eeoc-argues-vendors-using-artificial-intelligence-tools-are-subject-to-title-vii-the-ada-and-adea-under-novel-theories-in-workday-litigation.html ; https://www.workforcebulletin.com/ai-resume-screening-tool-developer-is-subject-to-federal-anti-discrimination-laws-says-eeoc

23. U.S. District Court, N.D. Cal. *Mobley et al. v. Workday, Inc.*, No. 3:23-cv-00770. July 2024 (agent theory ruling); May 16, 2025 (class certification order). Analysis by Fisher Phillips, Seyfarth, Holland & Knight. **(Primary — court orders — secondary analysis)** https://www.fisherphillips.com/en/insights/insights/discrimination-lawsuit-over-workdays-ai-hiring-tools-can-proceed-as-class-action-6-things ; https://www.seyfarth.com/news-insights/mobley-v-workday-court-holds-ai-service-providers-could-be-directly-liable-for-employment-discrimination-under-agent-theory.html

24. ACLU. *ACLU Sues Intuit and HireVue Over Discriminatory AI Interviewing Practices.* March 2025. HR Dive reporting. **(Secondary — complaint, news reporting; case pending)** https://www.hrdive.com/news/ai-intuit-hirevue-deaf-indigenous-employee-discrimination-aclu/743273/

25. Reuters / MIT Technology Review / ACLU. *Amazon Ditched AI Recruitment Software Because It Was Biased Against Women.* 2018. **(Secondary — investigative journalism)** https://www.technologyreview.com/2018/10/10/139858/amazon-ditched-ai-recruitment-software-because-it-was-biased-against-women/ ; https://www.aclu.org/news/womens-rights/why-amazons-automated-hiring-tool-discriminated-against

26. Nodes.inc / TeamFill.net / GDPR/CCPA compliance analyses. *GDPR, CCPA, and AI Hiring: Disclosure Obligations.* 2024/2025. **(Secondary — compliance analysis; LLM-disclosure detail is single-source — unverified)** https://nodes.inc/blogs/gdpr-ccpa-and-ai-hiring-the-data-residency-requirements-your-vendor-won-t-tell-you-about

---

*Research completed: 2026-04-17. All statutory citations verified to primary sources. Case citations verified to law firm analyses of primary court documents; full case docket not directly fetched. EU AI Act Annex III and Article 14 text fetched directly from artificialintelligenceact.eu official text republication.*
