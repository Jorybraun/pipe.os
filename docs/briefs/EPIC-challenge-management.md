# Epic: Challenge Management Page

## 1. Epic Title & Summary

**Title:** Challenge Management Page

**Summary:** This epic defines the requirements for a new "Challenge Page" in Pipe, accessible via the side navigation. This page will provide a centralized location for recruiters to discover existing challenges, create new challenges, and manage challenge templates for easy reuse in assessment pipelines. The goal is to streamline the challenge creation and management process, making it more efficient for recruiters to build effective assessment pipelines.

## 2. Business Value & Goals

*   **Increased Efficiency:** Reduce the time recruiters spend creating and managing individual challenges by providing a centralized management interface.
*   **Improved Consistency:** Enable recruiters to reuse pre-defined challenge templates, ensuring a consistent assessment experience across candidates.
*   **Enhanced Discoverability:** Make it easier for recruiters to find existing challenges that meet their specific needs, avoiding duplication of effort.
*   **Scalability:** Support the growing library of challenges in Pipe by providing a user-friendly interface for organization and management.
*   **Goal Metric:** Reduce challenge creation time by 25% within 3 months of launch, measured by recruiter surveys.

## 3. Scope: Challenge Listing & Discovery

*   **Challenge List:** Display a comprehensive list of all challenges in the system, including CODE\_REVIEW, CODE\_IMPLEMENTATION, QUIZ\_MCQ, and QUIZ\_SHORT\_ANSWER types.
*   **Filtering:** Allow recruiters to filter challenges by type, keywords, difficulty, and other relevant criteria.
*   **Search:** Implement a search function to quickly find specific challenges by name or description.
*   **Challenge Preview:** Provide a preview of each challenge, including the question, scoring rubric, and any associated files.
*   **Sorting:** Allow recruiters to sort challenges by name, creation date, or last modified date.

## 4. Scope: Challenge Creation & Editor

*   **Challenge Creation Wizard:** Guide recruiters through the process of creating new challenges, providing clear instructions and options for each challenge type.
*   **Rich Text Editor:** Integrate a rich text editor for creating and formatting challenge questions and descriptions.
*   **Code Editor:** Provide a code editor with syntax highlighting and code completion for CODE\_REVIEW and CODE\_IMPLEMENTATION challenges.
*   **MCQ Editor:** Provide an editor for creating multiple-choice questions with answer options and correct answers.
*   **Scoring Rubric Editor:** Allow recruiters to define scoring rubrics for each challenge, specifying the criteria for evaluation.
*   **File Upload:** Enable recruiters to upload files associated with the challenge (e.g., code samples, diagrams, data sets).
*   **Leverage Existing Types:** Fully support existing challenge types: CODE\_REVIEW, CODE\_IMPLEMENTATION, QUIZ\_MCQ, QUIZ\_SHORT\_ANSWER.
*   **ADR-005 Compliance:** Adhere to the composable challenge system architecture as defined in ADR-005 (shell/panel).

## 5. Scope: Template Management (Grouping)

*   **Template Creation:** Allow recruiters to group existing challenges into templates.
*   **Template Library:** Provide a library of pre-defined challenge templates for common assessment scenarios.
*   **Template Editing:** Allow recruiters to modify existing templates, adding or removing challenges as needed.
*   **Template Sharing:** Enable recruiters to share templates with other members of their team.
*   **Template Application:** Streamline the process of applying templates to new assessment pipelines.

## 6. Scope: Navigation & Integration

*   **Side Navigation:** Add a "Challenges" link to the side navigation menu.
*   **Pipeline Builder Integration:** Integrate the Challenge Page with the Pipeline Builder, allowing recruiters to easily add challenges to their assessment pipelines.
*   **User Interface (UI):** Follow existing design patterns (brutalist glassmorphic, dark theme #0c0c0e, Space Mono font).
*   **Component Reuse:** Reuse existing components where possible (e.g., LiquidMetalCard, MetalScoreRing, ButtonGroup).

## 7. Phased Rollout Plan

*   **Phase 1 (MVP):** Implement the Challenge Listing & Discovery and Challenge Creation & Editor features for CODE\_REVIEW and QUIZ\_MCQ challenge types.
*   **Phase 2:** Add support for CODE\_IMPLEMENTATION and QUIZ\_SHORT\_ANSWER challenge types.
*   **Phase 3:** Implement the Template Management features.
*   **Phase 4:** Integrate the Challenge Page with the Pipeline Builder.
*   **Phase 5:** Add advanced filtering and search capabilities.

## 8. Technical Unknowns & Architectural ADR requirements

*   **Scalability:** Need to investigate the scalability of the challenge listing and filtering features for large numbers of challenges. ADR might be needed if performance bottlenecks are found.
*   **Data Storage:** Determine the optimal storage solution for challenge templates and associated metadata. Consider implications for data retrieval speed and storage costs.
*   **Real-time Updates:** Investigate the feasibility of providing real-time updates to the challenge list when new challenges are created or existing challenges are modified.
*   **ADR-005 Deep Dive:** A deeper review of ADR-005 (Composable Challenge System) is needed to ensure UI/UX consistency between the Shell/Panel architecture and the Challenge Editor.
