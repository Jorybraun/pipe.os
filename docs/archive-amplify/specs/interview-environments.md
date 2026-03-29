# Architectural Brief: Modern Interview Environments

**Status:** Proposed  
**Owner:** Principal Architect  
**Epic:** Advanced Assessment Environments  
**Goal:** Transition from 'Code Snippets' (Monaco) to 'Full Projects' (Dev Containers).

---

## 1. The Core Decision
We need to provide candidates with a real development environment (IDE + Terminal + Runtime). We have two primary paths, each with a different "Complexity Profile."

### Option A: The "Lightweight" Engine (StackBlitz WebContainers)
*   **Technology:** Node.js environment running entirely in the browser via WebAssembly (Wasm).
*   **Pros:** 
    *   **Zero Boot Time:** Instant start for the candidate.
    *   **Zero Infrastructure Cost:** Runs on the candidate's CPU/RAM, not ours.
    *   **Zero Server Management:** No containers to spin up or tear down.
*   **Cons:**
    *   **Implementation Complexity:** Extremely high. Requires complex Wasm-to-JS bridging and custom file-system handling.
    *   **Language Locked:** Only supports Node-based projects (React, Vite, Node.js).
    *   **Security:** Client-side only; easier to manipulate via browser DevTools.

### Option B: The "Hardcore" Engine (AWS Fargate + Dev Containers)
*   **Technology:** A unique, server-side Linux container spun up per interview session.
*   **Pros:**
    *   **Language Agnostic:** Supports *any* language (Python, Go, Java, C++, Rust).
    *   **Top-Tier Security:** 100% isolated environment; no access to host OS; restricted network (No Google/GitHub).
    *   **Standard Implementation:** Uses industry-standard Docker images and AWS Fargate orchestration.
*   **Cons:**
    *   **Infrastructure Cost:** We pay for the compute time (~$0.01 per interview).
    *   **UX Friction:** 30–60 second "boot time" while the container pulls the image.

---

## 2. Technical Comparison Matrix

| Feature | StackBlitz (Web Mode) | AWS Fargate (System Mode) |
| :--- | :--- | :--- |
| **Boot Speed** | 🚀 < 2 seconds | 🐢 30–60 seconds |
| **Hosting Cost** | 💎 $0.00 | 💰 ~$0.01 / hr |
| **Security** | ⚠️ Browser Sandbox | 🔒 Linux Jail (Isolated) |
| **Implementation** | 🧩 High (Custom Bridge) | 🏗️ Medium (AWS Primitives) |
| **Exporting Code** | 📄 `getFiles()` API | 📦 S3 Zip Upload |
| **Identity** | "Fast & Modern" | "Industrial & Enterprise" |

---

## 3. Recommendation: The "System Mode" Path
Although it incurs a small compute cost, **AWS Fargate + Dev Containers** is the more robust choice for Pipe.

**Why?**
1.  **Reliability:** It uses standard AWS "Primitives" (ECS, S3, IAM) that are battle-tested. 
2.  **Flexibility:** It allows us to support "Backend" and "Systems" roles (Python, Go, etc.) which is where the highest-value coding interviews happen.
3.  **Simplicity of Logic:** A Docker container is just a Linux box. We don't have to fight the "WebAssembly limitations" of a browser-based kernel.

---

## 4. Proposed Implementation Strategy (MVP)
1.  **Environment Registry:** Create a `ChallengeEnvironment` IoC (Inversion of Control) to allow both Snippet and System modes.
2.  **The "System" Lambda:** An Amplify-triggered Lambda that calls the `ECS.RunTask` API to start a unique Fargate container.
3.  **The Proxy:** An AWS Application Load Balancer (ALB) that routes the candidate's iframe to their specific container.
4.  **The Submit Script:** A small shell script inside the container that zips the `/workspace` and pushes it to S3 when the candidate clicks "Submit."

---

## 5. Phase 1: Isolated Prototype Route
To de-risk the AWS Fargate orchestration (spin-up, iframe rendering, and automatic tear-down) without disrupting the existing candidate assessment flow, we will build an isolated prototype.

### 5.1 The Sandbox Route (`/sandbox/dev-container`)
*   **Purpose:** A standalone, hidden route used exclusively for testing the container lifecycle.
*   **UI Elements:**
    *   A simple "Launch Environment" button to trigger the spin-up Lambda.
    *   A loading state (polling the Lambda or subscribing to an AppSync event) to show container boot progress.
    *   An iframe that renders the `code-server` UI once the ALB routes traffic to the ready container.
    *   A "Destroy Environment" button to manually trigger tear-down (though automatic timeout should also be tested).
*   **Integration Strategy:** Once the spin-up/tear-down lifecycle is proven stable and fast enough in this isolated route, we will encapsulate the logic into a React component (`SystemEnvironmentShell`) and integrate it into the main `CandidateAssessmentPage`.

---

## 6. Cost Analysis (Estimated)
Using AWS Fargate (Serverless Containers) allows for a "Pay-as-you-go" model. Costs are only incurred while the interview container is running.

### 6.1 Configuration Baseline
*   **Specs:** 1 vCPU / 2 GB RAM (Sufficient for VS Code + Node/Python runtime)
*   **Duration:** 60 Minutes (Typical interview length)
*   **Region:** us-east-1 (N. Virginia)

### 6.2 Price Breakdown (Estimated)
| Resource | Rate (per unit/hr) | Qty | Cost |
| :--- | :--- | :--- | :--- |
| **vCPU** | ~$0.0405 | 1 | $0.0405 |
| **Memory** | ~$0.0044 | 2 GB | $0.0088 |
| **Total** | | | **~$0.0493 / Interview** |

**Note on Efficiency:** If we use smaller tasks (0.25 vCPU / 0.5 GB RAM) for lighter challenges, the cost drops to **~$0.012 / Interview**. 

### 6.3 Secondary Costs
*   **ALB (Load Balancer):** Fixed cost of ~$16/month + traffic.
*   **NAT Gateway:** If containers need internet access, ~$32/month.
*   **S3 Storage:** Negligible (cents per month for thousands of code zips).

**Summary:** At approximately **$0.05 per interview**, this is significantly cheaper than the overhead of a manual technical interview and competitive with other high-end assessment platforms that charge $20+ per candidate.
