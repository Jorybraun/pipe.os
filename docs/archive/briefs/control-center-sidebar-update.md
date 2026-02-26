## Product Brief: Control Center Sidebar Update

**Objective:** Redesign the Control Center sidebar to focus on toggling the core assessment stages: Algorithm Question, Technical Quiz, and Code Review.

**Problem:** The current sidebar likely focuses on media settings (due to the previous video/voice recording focus), which is no longer the priority for the MVP. We need a faster way to enable/disable the core assessment components during pipeline creation.

**Proposed Solution:**
*   Modify the Control Center sidebar to display toggle switches for the Algorithm Question, Technical Quiz, and Code Review stages.
*   The toggles should control the inclusion/exclusion of these stages in the generated pipeline.
*   Remove or relocate the media settings controls.

**Constraints:**
*   Maintain a clean and intuitive user interface.
*   Ensure the toggles function correctly and reliably.
*   Consider the overall layout and design of the Control Center.

**Success Metrics:**
*   Reduced time to create a pipeline with the desired assessment stages.
*   Improved user satisfaction with the pipeline creation process.
*   Clear and intuitive control over the core assessment components.

**Out of Scope:**
*   Detailed customization of each stage (e.g., configuring the specific questions or code snippets).
*   Advanced features like A/B testing of different pipeline configurations.

**Next Steps:**
1.  Identify the relevant UI files that define the Control Center sidebar.
2.  Implement the toggle switches for the Algorithm Question, Technical Quiz, and Code Review stages.
3.  Test the functionality thoroughly.
4.  Gather user feedback and iterate on the design.
