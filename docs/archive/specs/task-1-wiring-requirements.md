# Product Requirements Document: Discovery-to-Lambda Wiring (Task 1)

**1. Introduction**

This document outlines the requirements for connecting the Phase 1 UI of the role discovery feature to the AI backend. This integration will enable the agent to ask tailored questions based on user input, moving away from mock data.

**2. Goal**

Connect the Phase 1 UI to the AI backend so the agent can start asking real tailored questions.

**3. Requirements**

**3.1. Trigger Event:**

*   The call to the AI backend should be triggered when the user clicks the "Next Step" button after completing a phase in the role discovery process.

**3.2. Data Payload:**

The following data should be included in the payload sent to the AI backend:

*   Current baseline configuration (details to be defined based on the agreed-upon data structure).
*   Answers provided by the user in the current phase. Data format should be consistent and well-defined.
*   Phase identifier. To specify which phase the user is currently in.

**3.3. UI Feedback:**

*   While the AI backend is processing the request, the UI should display a visual indicator to the user. Options include:
    *   Skeleton loaders to represent the loading state of the next set of questions.
    *   A progress indicator with a message such as "Generating tailored questions..." or "Analyzing your responses..."
    *   A combination of both.

**3.4. Integration Logic:**

*   The hook responsible for fetching data should seamlessly transition from using mock data to real data from the AI backend.
*   A feature flag or environment variable should control whether the mock data or the AI backend is used. This allows for easy switching between development and production environments.
*   The hook should handle the data transformation required to adapt the AI backend response to the UI component’s expected data structure.

**3.5. Error Scenarios:**

*   If the Lambda function times out or returns an error:
    *   Display a user-friendly error message indicating that the request failed.
    *   Provide an option for the user to retry the request.
    *   Log the error details for debugging purposes.
    *   Consider implementing a circuit breaker pattern to prevent cascading failures if the backend is consistently unavailable.

**4. Constraints**

*   The integration should not introduce any performance bottlenecks in the UI.
*   The data payload size should be minimized to reduce latency.
*   The error handling should be robust and prevent the application from crashing.

**5. Measurable Outcomes**

*   Successful integration of the AI backend with the Phase 1 UI.
*   Reduction in the reliance on mock data for role discovery.
*   Improved user experience through personalized question generation.
*   Stable and reliable performance of the role discovery feature.
