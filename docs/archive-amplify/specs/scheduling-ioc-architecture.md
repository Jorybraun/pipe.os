# Architectural Specification: Scheduling Inversion of Control (IoC)

**Status:** Proposed  
**Owner:** Principal Architect  
**Epic:** Interview Scheduling Revamp  
**Core Pattern:** Inversion of Control (IoC) via Provider Interface

---

## 1. Executive Summary
The goal of this revamp is to move from a **Manual Bridge** (where recruiters paste URLs and manually update status) to an **Automated Sync** (where OAuth and Webhooks keep Pipe in real-time alignment with external providers). 

To support multiple providers (Cal.com, Calendly, etc.) interchangeably, we are implementing an **Inversion of Control (IoC)** pattern. This ensures that the core Pipe application logic remains "blind" to the specific implementation details of any one third-party service.

---

## 2. The SchedulingPlugin Interface
The `SchedulingPlugin` is the "Source of Truth" for how Pipe interacts with any scheduling service. Every provider (Cal.com, Calendly) must implement this interface.

### 2.1 Technical Requirements
Each plugin must provide:
*   **Authentication Flow:** Logic to generate the OAuth Authorization URL and exchange temporary codes for long-lived Access/Refresh tokens.
*   **Event Discovery:** Ability to fetch the recruiter's "Event Types" (templates) so they can be selected in the Pipe Pipeline Builder.
*   **Webhook Normalization:** A "Translator" function that takes a raw, provider-specific JSON payload (e.g., from a Calendly Webhook) and converts it into a **Pipe-Standard Interview Object**.
*   **UI Embedding:** A React component that wraps the provider's specific embed logic (e.g., Cal.com Atom or Calendly Inline Script).

---

## 3. The Provider Registry & Multi-Tenancy
Pipe must support a multi-tenant environment where different recruiters use different scheduling providers.

### 3.1 The Registry Service
A central `SchedulingRegistry` will manage the available plugins. 
*   **Registration:** Plugins are registered at application startup.
*   **Resolution:** When a candidate reaches an interview stage, the Registry identifies the recruiter's active provider and returns the corresponding plugin instance.

### 3.2 Security & Token Management
*   **Storage:** Recruiter OAuth tokens must be stored in a dedicated `SchedulingConnection` model.
*   **Encryption:** Tokens must be encrypted at rest.
*   **Rotation:** The system must support automatic token refreshing using the `Refresh Token` provided during the OAuth handshake.

---

## 4. The Webhook Router (Real-Time Sync)
The Webhook Router is the entry point for all external signals from Cal.com or Calendly.

### 4.1 Routing Logic
1.  **Receive:** An unauthenticated `POST` request hits a public-facing Lambda function.
2.  **Identify:** The Router inspects the payload or headers to determine the source provider.
3.  **Delegate:** The Router passes the raw payload to the correct plugin's `normalizeWebhookPayload` method.
4.  **Execute:** The Router uses the normalized data to update the `ScheduledInterview` record in the database.

---

## 5. Data Schema Updates (Amplify Gen 2)
To support automation, the data model must be expanded to track the link between Pipe and the external provider.

### 5.1 `ScheduledInterview` Model (Updates)
*   **`externalEventId`**: The unique ID of the meeting in the provider's system (crucial for matching webhooks to records).
*   **`providerId`**: Enum identifying which plugin owns this interview (`CALENDLY`, `CAL_COM`).
*   **`scheduledAt`**: The canonical "Source of Truth" date/time for the interview.
*   **`providerData`**: A JSON field to store raw metadata from the provider for debugging and future enrichment.

### 5.2 `SchedulingConnection` Model (New)
*   **`recruiterId`**: Owner of the connection.
*   **`providerId`**: The active provider.
*   **`accessToken` / `refreshToken`**: Encrypted OAuth credentials.
*   **`expiry`**: Timestamp for token rotation.

---

## 6. Functional Candidate Flow
The user experience remains seamless regardless of the underlying provider:
1.  **Stage Check:** Candidate hits a stage where `requiresBooking: true`.
2.  **Plugin Load:** Pipe loads the recruiter's active `SchedulingPlugin`.
3.  **Embed:** The plugin's `EmbedComponent` is rendered on the assessment page.
4.  **Handshake:** Upon booking, the Webhook Router handles the status update, instantly revealing the "Join Call" button to the candidate in Pipe.
