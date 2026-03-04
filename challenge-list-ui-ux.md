## Product Brief: Challenge List UI/UX

**1. Goal/Problem:** We need to clarify the user experience around base (system) challenges versus user-created challenges, particularly regarding editability and presentation in the UI.

**2. Target User:** Users who create and manage challenges, including content creators, hiring managers, and recruiters.

**3. Proposed Solutions & Decisions:**

*   **Base Challenge Editability:**
    *   Decision: Show an "Edit" button on Base challenges. Clicking this button will trigger a "Clone & Edit" action, creating a user-editable copy.
    *   Rationale: This provides discoverability and avoids a completely locked-down feeling for system challenges. Users can easily adapt a base challenge without accidentally modifying the original.

*   **List Presentation:**
    *   Decision: Separate tabs/sections for "Library" (Base challenges) and "My Challenges" (user-created).
    *   Rationale: This provides clear separation and avoids confusion. A "SYSTEM" badge within a mixed list can be easily missed. Separate tabs provide better visual clarity and organization.

*   **UI Aesthetic & Layout:**
    *   Decision: Adopt the 'glassmorphic' aesthetic of the Scheduling page, and implement a fixed 100vh layout with independent scrolling for the list and the workspace.
    *   Rationale: Consistent aesthetic provides a unified user experience across the platform. The fixed layout with independent scrolling improves usability, especially on smaller screens, by keeping the overall structure stable while allowing users to focus on either the challenge list or the challenge details.

**4. Non-Negotiables:**

*   Base challenges must remain immutable in their original form.
*   The UI must clearly distinguish between Base and User challenges.

**5. Out of Scope:**

*   Complex permissioning or sharing of challenges beyond basic "My Challenges" vs "Library" separation.

**6. Success Metrics:**

*   Reduction in user confusion regarding challenge editability (measured through user feedback and support requests).
*   Increased usage of Base challenges as templates (measured by the number of "Clone & Edit" actions).
*   Positive user feedback on the new UI aesthetic and layout.

**7. Business Context:** A clear and intuitive challenge management UI improves user engagement, reduces support overhead, and empowers users to create high-quality interview content.

**8. Timeline:** Aim to deliver this within the next sprint (2 weeks).
