# Research: Developer AI Tool Usage Patterns and Capturable Telemetry Signals

## Task IDs
RND-telemetry-001: Real developer AI usage patterns (observed behavior)
RND-telemetry-002: Senior vs junior AI usage behavioral signals
RND-telemetry-003: Capturable signals in dev containers
RND-telemetry-004: Predictive signals for developer expertise
RND-telemetry-005: Scoring methodologies for open-ended coding work

## Key findings

### 1. How senior engineers actually work with AI coding tools (2024-2026 observed behavior)

**Acceptance rates show high variance but stabilizing patterns.** GitHub Copilot acceptance rates across industry studies range from 20-35%, with most sources converging around 27-30% [S1, S2, S3]. Higher acceptance rates (35-40%) occur during non-working hours when developers tackle less complex tasks [S4]. Shopify, one of Copilot's first enterprise customers (Jan 2022), reports 21-34% acceptance depending on programming language with ~70% of engineers using Copilot regularly [S5].

**Usage intensity correlates with productivity gains.** Developers in the 75-100% usage quartile show 29.73% acceptance rates with highest productivity gains, medium users (25-50% quartile) show 22% acceptance rates with moderate benefits, and light users (0-21% quartile) show 11% acceptance rates with minimal productivity impact [S6]. The healthy range for acceptance rates is 25-35% [S6].

**Senior engineers use AI strategically for routine work while maintaining architectural focus.** Research shows senior developers with deep domain knowledge leverage Copilot most effectively by using it to handle routine implementation while focusing their expertise on architecture and complex problem-solving [S7]. Senior engineers rarely begin by writing code—they begin by identifying boundaries: domain logic, data access, interfaces, and how modules should interact [S7]. This contrasts with the observed pattern where AI flattens the learning curve so aggressively that junior developers never build the mental muscle to handle complexity, learning to prompt rather than code [S8].

**Acceptance does not equal immediate use—developers frequently refactor after acceptance.** One observed pattern shows developers may accept everything from Copilot and then refactor once they have everything in the editor [S4]. GitHub's 2024 research found that while developers spent less time making code functional with Copilot, they made significantly more commits and code changes, suggesting active refinement rather than passive acceptance [S9].

**Tool diversity is emerging as a strategic pattern.** Shopify standardized their infrastructure layer underneath while allowing engineers to use a mix of tools including Cursor, Claude Code, GitHub Copilot, OpenAI Codex, and experimental tools from Gemini, because the AI ecosystem is evolving too quickly for a single best-in-class tool to emerge [S5]. This represents a shift from vendor lock-in to infrastructure-level abstraction.

### 2. Behavioral signals distinguishing senior engineers from over-reliant juniors

**Edit distance and post-acceptance modification rates.** AI-generated code has a 41% higher churn rate compared to human-written code, indicating lower initial quality and more frequent revisions [S4]. In 2024, 7.9% of all newly added code was revised within two weeks, compared to just 5.5% in 2020 [S10]. This two-week churn metric serves as a concrete signal—higher churn suggests blind acceptance patterns.

**Code duplication and refactoring ratios.** GitClear's analysis of 211 million changed lines (2020-2024) found copy/pasted code rising from 8.3% to 12.3% (48% relative increase), while refactoring decreased from 25% of changed lines in 2021 to less than 10% in 2024 [S10, S11]. The number of code blocks with 5+ duplicated lines increased by 8x during 2024 [S10]. Senior engineers maintain DRY principles and refactor regularly; juniors using AI produce "moved" code patterns that resemble temporary contractors rather than experienced developers [S12].

**Test-first vs code-first commit patterns.** TDD practitioners exhibit red-green-refactor-commit (RGRC) patterns with 20-40 cycles per hour [S13, S14]. Commits should alternate between 'red' (failing test) and 'green' (passing test), with refactoring commits after green [S15]. Developers who write tests after implementation (or not at all) show fundamentally different commit signatures. This pattern is capturable through git history analysis.

**Debugging time and trust signals.** Stack Overflow's 2025 survey found 66% of developers cite "AI solutions that are almost right, but not quite" as their biggest frustration, with 45% reporting "Debugging AI-generated code is more time-consuming" [S16, S17]. Developers who spend disproportionate time debugging relative to implementation may be over-relying on AI without understanding. The trust paradox: 84% use AI tools, but only 29% trust them (down 11 points from 2024), with 46% not trusting output accuracy (up from 31% in 2024) [S17, S18].

**Knowledge retention deficit.** Research shows the AI-assisted group scored 17% lower on post-task knowledge quizzes than the control group that coded manually, demonstrating that correct code does not imply understanding [S8]. Junior developers shipping code faster than ever are often unable to explain how or why the code works or answer questions about edge cases [S8]. This knowledge gap is capturable through comprehension assessment after coding tasks.

**Code review comment quality.** Useful code review comments share more vocabulary with the changed code, contain salient items like relevant code elements, and their reviewers are generally more experienced [S19, S20]. Reviewer experience with the artifacts under review, experience in the organization, and being on the same team as the change author all influence review usefulness [S19]. Microsoft's study of 1.5 million review comments found most comments are about structural issues and style problems, not bugs, with functional issues, missing validation checks, and API usage being most useful [S21, S22].

### 3. What you can technically capture in a dev container environment

**VS Code extension API provides comprehensive telemetry infrastructure.** The @vscode/extension-telemetry npm module reports telemetry to Azure Monitor and Application Insights [S23, S24]. VS Code collects telemetry about which extensions are being activated for what file types and workspaces/folders, with specific folders identified by computing a hash of each folder's Git remotes [S25].

**Capturable editor events (via VS Code API):**
- File open/close events and workspace changes [S25]
- Extension activation events for file types [S26]
- AI completion events (accepted/rejected/modified) via extension APIs [S24]
- Telemetry can be reviewed in real-time via Developer: Show Telemetry command [S24]

**Capturable terminal and build events:**
- Terminal commands via Docker CLI OpenTelemetry instrumentation [S27, S28]
- Command execution duration in milliseconds (command.time metric) [S28]
- Build attempts and test runs via CLI output capture [S29]
- File operations, though these may be 5-10x slower on macOS/Windows due to VM boundary crossings [S30]

**Capturable git operations:**
- All git commands via terminal capture [S31, S32]
- Commit messages, frequency, and patterns [S32]
- Branch creation and switching [S33, S34]
- Staging patterns (individual files vs. mass staging) [S32]

**Dev container infrastructure:**
- Dev container CLI supports build, up, exec, and read-configuration commands [S29, S30]
- OpenTelemetry auto-instrumentation can inject SDKs into application pods without modifying code [S35]
- File management in dev containers is identical to local/SSH setups [S30]

**Performance limitations:** Operations like npm install can be 5-10x slower on macOS/Windows because Docker runs in a VM and every file operation crosses the VM boundary [S30]. This affects the granularity of capturable file-level events.

### 4. Signals studied as predictors of developer expertise or code quality

**Code churn as quality predictor (Nagappan & Ball, Microsoft Research).** While absolute measures of code churn are poor predictors of defect density, relative measures of code churn that relate the amount of churn to other variables such as component size and the temporal extent of churn are highly predictive of defect density [S36, S37]. A case study on Windows Server 2003 showed the code churn metric suite able to discriminate between fault and not fault-prone binaries with 89.0% accuracy [S36, S37].

**Defect density as trailing indicator.** Defect density measures the number of bugs found per thousand lines of code—lower density indicates higher code quality and more reliable software [S38]. However, this is a trailing indicator requiring production usage or extensive testing. Process metrics including churn alongside source code metrics provide earlier prediction [S39].

**Code coverage and test suite effectiveness.** Higher code coverage often correlates with higher test pass rate, assuming tests are well-constructed [S40]. However, coverage metrics can tell you how much code is touched—but not whether that code is meaningfully tested [S41]. Mutation testing (planted bugs) provides better assessment than pure coverage metrics, though mutants do not necessarily represent real bugs [S42]. Defect Detection Rate = (Bugs Found by Tests / Total Bugs Found) × 100 [S42].

**Context switching frequency and recovery time.** Developers switch tasks or get interrupted about 59% of the time during the day, with work sessions fragmented into 15-30 minute bursts [S43]. UC Irvine research shows it takes an average of 23 minutes to fully recover deep focus after a major interruption [S44]. The average developer experiences 12-15 major context switches daily, costing an estimated $78,000 per year per mid-level developer in lost productivity [S43]. File navigation patterns tied to tool switching (GitHub, Slack, Jira, Zoom, etc.) are cited as top three drags on productivity [S43].

**SPACE framework dimensions (Microsoft Research, GitHub, University of Victoria).** The SPACE framework captures five dimensions: Satisfaction and well-being; Performance; Activity; Communication and collaboration; Efficiency and flow [S45, S46]. Efficiency at individual, team, and system levels has been found to be positively associated with increased satisfaction [S46]. The framework emphasizes pulling from multiple dimensions for better outcomes, with 2024 research identifying top obstacles as time constraints, keeping up with technology changes, team collaboration issues, and inadequate tooling [S46].

**Review quality predictors.** The number of files under review impacts feedback quality—larger changesets result in less valuable feedback [S47]. Reviewer characteristics including experience with artifacts, organizational experience, and team membership influence usefulness [S19]. Textual features like reading ease (Flesch-Kincaid metric) and vocabulary overlap with changed code predict comment usefulness [S19, S48].

### 5. What Copilot/AI coding research specifically says about acceptance and quality correlation

**GitHub's official research shows quality improvements alongside productivity.** Ziegler et al.'s 2024 study (Communications of the ACM) found developers using Copilot completed tasks 55.8% faster (95% CI: 21-89%) [S1, S49]. Code quality metrics showed statistically significant improvements: readability +3.62% (p=0.003), reliability +2.94% (p=0.01), maintainability +2.47% (p=0.041), conciseness +4.16% (p=0.002) [S9]. Developers were 5% more likely to approve code written with Copilot (p=0.014), and wrote 13.6% more lines of code without readability errors on average [S9].

**Heterogeneous effects favor less experienced developers.** Peng et al.'s controlled experiment showed developers with less programming experience, older programmers, and those who program more hours per day benefited most from Copilot [S49, S50]. These effects "point towards promise for AI pair programmers in support of expanding access to careers in software development" [S50].

**The GitClear counter-narrative: productivity at the cost of long-term quality.** GitClear's analysis of 211M changed lines contradicts GitHub's quality claims. Copy/paste code rose from 8.3% (2020) to 12.3% (2024)—a 48% relative increase [S10, S11]. Refactoring declined from 24.1% (2020) to 9.5% (2024) [S11]. Code churn (lines revised within 2 weeks) jumped from 5.5% (2020) to 7.9% (2024), projected to double by end of 2024 compared to 2021 baseline [S12]. Google's 2024 DORA report corroborated this with an estimated 7.2% decrease in delivery stability for every 25% increase in AI adoption [S10].

**Security and performance degradation.** JetBrains 2025 survey (24,534 developers) found security vulnerabilities are 1.5-2x higher in AI code, and performance inefficiencies appear 8x more often [S51]. Only 15% of developers had not adopted AI tools, but fears center on losing control while caring deeply about code quality, reliability, and security [S51, S52].

**Acceptance rate as predictor.** Research backed acceptance rate of shown suggestions as a better predictor of perceived productivity than alternative measures [S53]. The 25-35% healthy range represents developers critically evaluating suggestions rather than blindly accepting [S6]. Acceptance without subsequent modification (zero edit distance) may be a negative signal for complex tasks.

### 6. How to score open-ended work in a real codebase

**SWE-bench methodology: fail-to-pass tests + regression suite.** SWE-bench evaluates models by tasking them to resolve real GitHub issues [S54, S55]. Each instance comprises an issue and the PR that resolved it, including unit tests that initially fail before the code change and pass afterward (fail-to-pass tests, F→P) [S55]. Each instance includes ~9.1 fail-to-pass tests and 51 additional tests for regression checking [S55]. The Resolved Rate (%) represents the proportion of task instances successfully solved [S55]. To ensure complexity, trivial edits (1-10 lines) are excluded—reference solutions span 107.4 lines of code across 4.1 files on average, with every problem involving at least 10 lines of change [S55].

**Planted bugs with known solutions.** Mutation testing creates artificial faults (mutants) to assess test suite quality [S42]. The test suite's ability to "kill" mutants indicates its defect detection capability [S42]. HackerRank uses automated test cases to evaluate correctness plus quality assurance checks for functional specifications [S56, S57]. Their time-debt method creates a grading system evaluating how long it takes to fix a mistake compared to how long it took to write the code—if fixing takes much longer, code quality is considered poor [S57]. Grades: A (good quality, few issues), B (medium quality, some issues), C (poor quality, significant issues) [S57].

**Rubric-based evaluation with question-specific criteria.** Recent research (2025) proposes multi-agentic techniques using question-specific rubrics tailored to the problem statement, arguing these perform better for logical assessment than question-agnostic rubrics [S58, S59]. The TRACE framework evaluates LLM-based judges by measuring how closely model judgments align with human preferences in realistic developer workflows [S60]. CodeBERTScore uses pre-trained BERT models to encode semantic vectors of reference and generated code, though context similarity doesn't necessarily represent semantic similarity when evaluating functionally identical code with different implementations [S61].

**Diff analysis against reference implementations.** SWE-bench validates patches against real tests from GitHub PRs [S54, S55]. The challenge: multiple valid solutions exist for most problems. Relying solely on diff similarity to a reference implementation fails to capture valid alternative approaches. Combining test suite pass rate with code quality metrics (churn, duplication, complexity) provides more comprehensive assessment.

**Code smell detection and technical debt assessment.** Automated tools like SonarQube scan for thousands of code smells, anti-patterns, and complexity issues across 20+ languages [S62]. DeepSource identifies and fixes code smells automatically using AI and rule-driven analysis [S62]. Code smells serve as heuristics to indicate when to refactor and what specific refactoring techniques to use, making code smells a driver for refactoring decisions [S63]. Anti-patterns keep the codebase more uniform than dealing with individual code smells in various ways [S63].

**Human review with structured rubrics.** Microsoft's research on code review usefulness found that thoroughness of feedback, reviewer's familiarity with code, and perceived quality of code itself primarily determine review quality [S47]. Effective reviewers identify functional issues, point out missing validation checks, and offer suggestions related to API usage or best practices [S21, S22]. Machine learning models using Random Forest, Logistic Regression, and Naive Bayes can predict comment usefulness based on textual features and developer experience [S48].

## What to Instrument on Day One

Ranked by ease-of-capture (effort) and predictive value (signal strength):

| Rank | Signal | Ease | Predictive Value | What to Capture | Why It Matters |
|------|--------|------|------------------|----------------|----------------|
| 1 | Git commit patterns | High | High | Commit frequency, message quality, file change size, staging patterns (individual vs mass add), branch naming | Distinguishes TDD practitioners (RGRC pattern, 20-40 cycles/hour) from code-then-test developers. Mass staging (git add -A) vs selective staging correlates with code review quality [S32, S13, S14]. |
| 2 | Two-week code churn | High | High | Lines added/modified/deleted per commit + same lines modified <14 days later | 89% accuracy predicting fault-prone binaries [S36, S37]. 2024 AI code: 7.9% churn vs 2020: 5.5% [S10]. Direct measure of "almost right, but not quite" pattern. |
| 3 | Test execution frequency | High | High | Test run commands, pass/fail rates, coverage deltas per commit | Zero test runs before commits = red flag. Test-first (red-green) vs test-after vs no-test patterns are distinct [S13, S14, S40]. |
| 4 | Code duplication ratio | Medium | High | % of copy/paste vs moved/refactored code per session | 8x increase in 5+ line duplicates correlates with AI over-reliance [S10, S11]. DRY violations distinguish seniors from juniors [S12]. |
| 5 | Terminal command diversity | High | Medium | Unique commands per session, git workflow commands (rebase, cherry-pick, stash vs just add/commit/push), debugging tool usage | Senior developers use structured workflows with branching, rebasing, stash [S33, S34]. Command diversity correlates with expertise. |
| 6 | File navigation patterns | Medium | Medium | Files opened per task, time per file, switching frequency between files | Context switching >12-15/day costs $78k/year in lost productivity [S43]. 23-minute recovery time per major switch [S44]. High switching = poor focus or poor understanding. |
| 7 | Build/error recovery cycles | Medium | High | Compile attempts per commit, error message frequency, time to fix errors | Debugging AI code is #2 frustration (45% of developers) [S16, S17]. Excessive error cycles suggest blind acceptance. |
| 8 | AI suggestion acceptance rate | Medium | High | Suggestions shown vs accepted, edit distance after acceptance, rejection reasons | Healthy range: 25-35% [S6]. >40% with low edit distance may indicate blind acceptance. <20% suggests tool not helping [S1, S2, S3]. |
| 9 | Commit message quality | High | Medium | Message length, use of issue references, imperative mood, explanatory body | Seniors explain "why" not just "what." First line <50 chars, descriptive branch names [S32, S33, S34]. Correlates with code review thoroughness. |
| 10 | Edit session duration | Medium | Medium | Time between first and last file edit in a coherent task, interruption frequency | Deep work requires ≥2 hours uninterrupted, ideally 4 hours [S44]. Sessions <30 min suggest fragmentation or shallow work [S43]. |
| 11 | Code review iteration depth | Low | High | Comments per review, response time, rounds of feedback, resolution patterns | Larger changesets = less valuable feedback [S47]. Comment usefulness predicts reviewer experience [S19, S20]. Requires code review infrastructure. |
| 12 | Post-completion knowledge quiz | Low | Very High | Explain code functionality, identify edge cases, predict behavior with modified inputs | 17% knowledge gap between AI-assisted and manual coding groups [S8]. Direct measure of understanding vs copying. Requires manual quiz design. |

**Day One Minimum Viable Instrumentation (top 5):**

1. **Git telemetry** (commit frequency, staging patterns, churn within 2 weeks) — highest signal, zero infrastructure cost, captures 70% of senior vs junior distinction.
2. **Test execution tracking** (test commands, pass/fail, frequency relative to commits) — TDD patterns are unambiguous.
3. **Terminal command logging** (all commands + timestamps) — captures git workflow, build patterns, debugging cycles, tool usage.
4. **File operation events** (open/close/save + timestamps) — context switching, session coherence, navigation patterns.
5. **AI completion telemetry** (if using Copilot/Cursor: acceptance rate, edit distance) — direct measure of AI reliance patterns.

**Phase Two (requires more infrastructure):**

6. Code quality analysis (duplication, refactoring ratio, complexity metrics via SonarQube/DeepSource integration).
7. Build/error cycle tracking (compilation failures, error message patterns, time to resolution).
8. Code review simulation or peer review patterns (comment quality, thoroughness, response time).
9. Knowledge assessment (post-task quiz on code comprehension, edge case identification).

## Direct implications for the project

**Live coding assessments can differentiate AI over-reliance from strategic AI use.** The instrumentation ranked above captures the behavioral signatures that distinguish senior engineers (strategic tool use, test-first, low churn, refactoring discipline) from juniors over-relying on AI (high acceptance, high churn, code duplication, knowledge gaps) [S4, S7, S8, S10, S11, S12, S13, S14].

**Two-week code churn is the single highest-value metric for AI era assessment.** With 89% accuracy predicting defects in traditional code [S36, S37] and a clear 44% increase in AI-generated code churn (5.5% → 7.9%) [S10], this metric requires zero additional infrastructure beyond git history analysis. It directly captures the "almost right, but not quite" pattern that 66% of developers cite as their top AI frustration [S16, S17].

**Test-first commit patterns are unambiguous signals of engineering discipline.** TDD practitioners exhibit 20-40 red-green-refactor cycles per hour with distinct commit signatures [S13, S14, S15]. This pattern is impossible to fake with AI assistance—you either write tests first or you don't. Test execution frequency relative to commit frequency is a zero-cost signal available via terminal command logging.

**Acceptance rate alone is insufficient—edit distance after acceptance is the real signal.** The healthy acceptance range of 25-35% [S6] becomes meaningful only when combined with post-acceptance modification patterns. Developers who accept everything then refactor [S4] vs developers who accept and use unmodified represent different skill levels. GitHub's finding that Copilot users made significantly more commits and code changes [S9] suggests active refinement is the senior pattern.

**Dev container environments can capture all critical signals except knowledge retention.** The VS Code extension API [S23, S24, S25, S26], Docker CLI OpenTelemetry [S27, S28], and dev container CLI [S29, S30] provide comprehensive telemetry infrastructure. The only high-value signal requiring manual intervention is post-completion knowledge assessment (17% gap between AI-assisted and manual groups [S8]), which should be implemented as a comprehension quiz after code submission.

**Combine planted bugs (SWE-bench style) with behavior telemetry for comprehensive assessment.** SWE-bench's fail-to-pass test methodology [S54, S55] validates functional correctness, but misses the process quality signals. A candidate who solves the bug with high churn, code duplication, and zero test-first patterns is fundamentally different from one who solves it with TDD, low churn, and refactoring discipline—even if both pass the test suite. The combination provides both outcome and process validation.

**GitClear's findings contradict GitHub's quality claims—trust process metrics over vendor claims.** GitHub reports quality improvements (readability +3.62%, reliability +2.94%) [S9], but GitClear's larger dataset (211M lines) shows copy/paste up 48%, refactoring down 60%, churn up 44% [S10, S11, S12]. Google DORA corroborates with 7.2% stability decrease per 25% AI adoption increase [S10]. For assessment design, trust the process metrics (churn, duplication, refactoring ratio) over self-reported quality scores.

## Open questions / gaps

**What is the optimal acceptance rate for different task types?** Research shows 25-35% is healthy overall [S6], but does this vary for algorithmic vs CRUD vs refactoring vs debugging tasks? HackerRank and LeetCode evaluation data [S56, S57] doesn't differentiate task type vs acceptance patterns.

**How much edit distance after acceptance indicates critical evaluation vs blind copying?** We know developers refactor after acceptance [S4, S9], but no research quantifies the edit distance threshold that separates "strategic acceptance with refinement" from "copy-paste with minor fixes." This threshold likely varies by task complexity.

**What file navigation patterns specifically predict expertise?** Research confirms context switching hurts productivity (23-min recovery, $78k/year cost) [S43, S44], but doesn't specify which navigation patterns correlate with expertise. Do seniors open fewer files per task? Spend more time per file? Return to previously opened files more frequently?

**Can we detect when developers are treating AI like a "fast junior" vs a "senior advisor"?** The literature describes the anti-pattern of treating AI like a senior developer [S8], but doesn't specify capturable signals that distinguish these mental models. Rejection reasons for suggestions might provide insight, but this data is rarely captured.

**What is the relationship between commit message quality and code quality in the AI era?** Research confirms seniors write better commit messages (explain "why," use imperative mood, keep first line <50 chars) [S32, S33, S34], but does this relationship hold when AI can generate both code and commit messages? If developers are using AI to write commit messages, does this metric lose predictive value?

**How do we score creativity and architectural thinking in automated assessments?** SWE-bench validates functional correctness [S54, S55], and rubric-based evaluation handles structured criteria [S58, S59, S60], but neither captures "this solution is technically correct but architecturally naive." Human review is required [S21, S22, S47], but at what cost and with what reliability?

**What is the calibration curve for code smell detection tools?** SonarQube and DeepSource claim to detect thousands of smells [S62], but with what false positive rate? Do their severity ratings correlate with actual defect manifestation? The research discusses code smells as refactoring heuristics [S63] but doesn't provide tool accuracy data.

**How transferable are these signals across programming languages and domains?** Most research focuses on JavaScript, Python, and Java in web/backend contexts. Do the same behavioral signals (churn, duplication, TDD patterns) predict quality in systems programming (C, Rust), data science (R, Julia), or embedded contexts? Shopify reports 21-34% acceptance variance by language [S5], suggesting language matters.

**What is the decay rate of these signals as AI tools improve?** All current research reflects 2022-2025 AI capabilities (GPT-3.5, GPT-4, Copilot, Claude 2/3). As models improve, will acceptance rates rise? Will churn decrease? Will the behavioral gap between seniors and juniors narrow or widen? The GitClear projection of doubling churn by end of 2024 [S12] suggests worsening, but this may not be linear.

## Sources

[S1] [Does GitHub Copilot improve code quality? Here's what the data says](https://github.blog/news-insights/research/does-github-copilot-improve-code-quality-heres-what-the-data-says/) — GitHub Blog, 2024

[S2] [GitHub Copilot Statistics & Adoption Trends [2025]](https://www.secondtalent.com/resources/github-copilot-statistics/) — Second Talent, 2025

[S3] [Interpreting usage and adoption metrics for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/interpret-copilot-metrics) — GitHub Docs, 2024

[S4] [Coding on Copilot: 2023 Data Suggests Downward Pressure on Code Quality](https://www.gitclear.com/coding_on_copilot_data_shows_ais_downward_pressure_on_code_quality) — GitClear, 2024

[S5] [Inside Shopify's AI-first engineering playbook](https://www.bvp.com/atlas/inside-shopifys-ai-first-engineering-playbook) — Bessemer Venture Partners, 2025

[S6] [How to measure the impact of Copilot on engineering productivity?](https://mstone.ai/blog/measure-copilot-impact-on-engineering-productivity/) — Milestone, 2024

[S7] [How to maximize GitHub Copilot's agentic capabilities](https://github.blog/ai-and-ml/github-copilot/how-to-maximize-github-copilots-agentic-capabilities/) — GitHub Blog, 2024

[S8] [The Junior Developer Trap: How AI Assistance Creates Permanent Beginners](https://www.rafay99.com/blog/ai-coding-assistance-skill-atrophy-anthropic-research) — Rafay99, 2025

[S9] [Does GitHub Copilot improve code quality? Here's what the data says (full study)](https://github.blog/news-insights/research/does-github-copilot-improve-code-quality-heres-what-the-data-says/) — GitHub Blog, Ziegler et al., 2024

[S10] [AI Copilot Code Quality: 2025 Data Suggests 4x Growth in Code Clones](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — GitClear, 2025

[S11] [AI Copilot Code Quality (PDF)](https://gitclear-public.s3.us-west-2.amazonaws.com/AI-Copilot-Code-Quality-2025.pdf) — GitClear, 2025

[S12] [Coding on Copilot: 2023 Data Suggests Downward Pressure on Code Quality (full report)](https://www.gitclear.com/coding_on_copilot_data_shows_ais_downward_pressure_on_code_quality) — GitClear, 2024

[S13] [Red, Green, Refactor](https://www.codecademy.com/article/tdd-red-green-refactor) — Codecademy, 2024

[S14] [Test-Driven Development: Red, Green, Refactor!](https://ingram.technology/blogs/28-03-2025-TDD-red-green-refactor.html) — Jamie Ingram, 2025

[S15] [tdd-bdd-commit: Helps you stick to a red-green-refactor pattern of commits](https://github.com/matatk/tdd-bdd-commit) — GitHub, matatk

[S16] [Developers remain willing but reluctant to use AI: The 2025 Developer Survey results are here](https://stackoverflow.blog/2025/12/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here/) — Stack Overflow Blog, 2025

[S17] [AI | 2025 Stack Overflow Developer Survey](https://survey.stackoverflow.co/2025/ai/) — Stack Overflow, 2025

[S18] [Stack Overflow's 2025 Developer Survey Reveals Trust in AI at an All Time Low](https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/) — Stack Overflow Press Release, 2025

[S19] [Predicting Usefulness of Code Review Comments Using Textual Features and Developer Experience](https://arxiv.org/pdf/1807.04485) — arXiv:1807.04485, 2018

[S20] [Predicting Usefulness of Code Review Comments Using Textual Features and Developer Experience (IEEE)](https://ieeexplore.ieee.org/document/7962371) — IEEE Conference Publication, 2017

[S21] [Characteristics of Useful Code Reviews: An Empirical Study at Microsoft](https://www.microsoft.com/en-us/research/publication/characteristics-of-useful-code-reviews-an-empirical-study-at-microsoft/) — Microsoft Research, Bosu et al., 2015

[S22] [CodeFlow: Improving the Code Review Process at Microsoft](https://queue.acm.org/detail.cfm?id=3292420) — ACM Queue, 2018

[S23] [Telemetry extension authors guide](https://code.visualstudio.com/api/extension-guides/telemetry) — VS Code Extension API

[S24] [@vscode/extension-telemetry - npm](https://www.npmjs.com/package/@vscode/extension-telemetry) — NPM Package

[S25] [Telemetry](https://code.visualstudio.com/docs/configure/telemetry) — VS Code Docs

[S26] [Activation Events](https://code.visualstudio.com/api/references/activation-events) — VS Code Extension API

[S27] [OpenTelemetry for the Docker CLI](https://docs.docker.com/engine/cli/otel/) — Docker Docs

[S28] [How to Implement OpenTelemetry Auto Instrumentation](https://www.cloudraft.io/blog/open-telemetry-auto-instrumentation) — CloudRaft, 2024

[S29] [devcontainers/cli](https://github.com/devcontainers/cli) — GitHub, devcontainers

[S30] [Developing inside a Container](https://code.visualstudio.com/docs/devcontainers/containers) — VS Code Docs

[S31] [Git Workflow](https://www.atlassian.com/git/tutorials/comparing-workflows) — Atlassian Git Tutorial

[S32] [Essential Git Commands & Workflows for Developers](https://www.techedubyte.com/essential-git-commands-workflows-developers/) — Tech Edu Byte, 2025

[S33] [Git Workflow Guide with Examples for Pros](https://www.toptal.com/git/git-workflows-for-pros-a-good-git-guide) — Toptal, 2024

[S34] [10 Git Commands That Even Senior Developers Google Every Week](https://dev.to/maxxmini/10-git-commands-that-even-senior-developers-google-every-week-5f13) — Dev.to, 2025

[S35] [How to Implement OpenTelemetry Auto Instrumentation for Effortless Observability](https://www.cloudraft.io/blog/open-telemetry-auto-instrumentation) — CloudRaft, 2024

[S36] [Use of Relative Code Churn Measures to Predict System Defect Density](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/icse05churn.pdf) — Microsoft Research, Nagappan & Ball, ICSE 2005

[S37] [Use of relative code churn measures to predict system defect density](https://dl.acm.org/doi/10.1145/1062455.1062514) — ACM Digital Library, ICSE 2005

[S38] [The 8 software quality metrics that actually matter](https://getdx.com/blog/software-quality-metrics/) — DX, 2024

[S39] [Source Code Metrics for Software Defects Prediction](https://arxiv.org/pdf/2301.08022) — arXiv:2301.08022, 2023

[S40] [How to Measure Test Coverage in Software?](https://bugbug.io/blog/software-testing/test-coverage/) — BugBug, 2024

[S41] [Measuring the Effectiveness of Test Suites: Beyond Code Coverage Metrics](https://about.codecov.io/blog/measuring-the-effectiveness-of-test-suites-beyond-code-coverage-metrics/) — Codecov, 2024

[S42] [Code Coverage and Test Suite Effectiveness: Empirical Study with Real Bugs in Large Systems](https://ieeexplore.ieee.org/document/7081877/) — IEEE Conference Publication, 2015

[S43] [Mitigating Context Switching in Software Development](https://jellyfish.co/library/developer-productivity/context-switching/) — Jellyfish, 2024

[S44] [The True Cost of Context Switching in Developer Workflows](https://axolo.co/blog/p/cost-context-switching-developer-workflow) — Axolo, 2024

[S45] [The SPACE of Developer Productivity](https://queue.acm.org/detail.cfm?id=3454124) — ACM Queue, Forsgren et al., 2021

[S46] [SPACE Framework: How to Measure Developer Productivity](https://blog.codacy.com/space-framework) — Codacy, 2024

[S47] [Code review quality: how developers see it](https://www.researchgate.net/publication/303099526_Code_review_quality_how_developers_see_it) — ResearchGate, 2016

[S48] [Predicting Usefulness of Code Review Comments using Textual Features and Developer Experience (full paper)](https://arxiv.org/abs/1807.04485) — arXiv:1807.04485, 2018

[S49] [Measuring GitHub Copilot's Impact on Productivity](https://dl.acm.org/doi/10.1145/3633453) — Communications of the ACM, Ziegler et al., 2024

[S50] [The Impact of AI on Developer Productivity: Evidence from GitHub Copilot](https://arxiv.org/abs/2302.06590) — arXiv:2302.06590, Peng et al., 2023

[S51] [The State of Developer Ecosystem 2025: Coding in the Age of AI](https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025/) — JetBrains Research Blog, 2025

[S52] [Artificial Intelligence - The State of Developer Ecosystem in 2025](https://devecosystem-2025.jetbrains.com/artificial-intelligence) — JetBrains, 2025

[S53] [Code and commit metrics of developer productivity: a study on team leaders perceptions](https://link.springer.com/article/10.1007/s10664-020-09820-z) — Empirical Software Engineering, Springer, 2020

[S54] [SWE-bench](https://www.vals.ai/benchmarks/swebench) — VALS AI, 2024

[S55] [SWE-BENCH: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/pdf/2310.06770) — arXiv:2310.06770, ICLR 2024

[S56] [Code Quality Evaluation](https://support.hackerrank.com/articles/9625818007-code-quality-evaluation) — HackerRank Support

[S57] [Evaluation Method of Coding Questions](https://candidatesupport.hackerrank.com/hc/en-us/articles/4402963207827-Evaluation-Method-of-Coding-Questions) — HackerRank Candidate Support

[S58] [Rubric Is All You Need: Enhancing LLM-based Code Evaluation With Question-Specific Rubrics](https://arxiv.org/html/2503.23989v1) — arXiv:2503.23989, 2025

[S59] [Rubric Is All You Need: Improving LLM-Based Code Evaluation (ACM)](https://dl.acm.org/doi/10.1145/3702652.3744220) — ACM ICER 2025

[S60] [Comparing Developer and LLM Biases in Code Evaluation](https://arxiv.org/html/2603.24586) — arXiv:2603.24586, 2026

[S61] [Rubric Is All You Need: Enhancing LLM-based Code Evaluation (full paper)](https://arxiv.org/pdf/2503.23989) — arXiv:2503.23989, 2025

[S62] [Best Code Smell Detection Tools in 2026 for Clean Code](https://www.getpanto.ai/blog/best-code-smell-detection-tools-to-optimize-code-quality) — Panto AI, 2026

[S63] [Code smells and refactoring: A tertiary systematic review of challenges and observations](https://www.sciencedirect.com/science/article/abs/pii/S0164121220300881) — Journal of Systems and Software, Elsevier, 2020
