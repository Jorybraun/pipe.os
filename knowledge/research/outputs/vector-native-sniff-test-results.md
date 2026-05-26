# Vector-Native Sniff Test Results

> **Generated:** 2026-04-22T23:42:54.444Z
> **Model:** Xenova/bge-large-en-v1.5 (via @xenova/transformers)
> **Framework:** Xenova Transformers (local inference, fp32)

## Executive Summary

| Criterion | Result | Threshold |
|---|---|---|
| Same-domain margin ≥ 0.10 | **PASS** ✅ | ≥ 0.10 |
| Dynamic range > 0.20 | **PASS** ✅ | > 0.20 |
| Query prefix sensitivity | **PASS** ✅ | vectors different & non-harmful |
| Inversion count | 0 | < 5 per direction |

### Phase 4 Recommendation

**GO** ✅ — The unified BGE vector space shows strong domain discrimination. Same-domain pairs consistently outrank cross-domain pairs with comfortable margins, dynamic range is healthy per query row, and the query prefix behaves as expected. Proceed with the Phase 4 pipeline flip (vector-native ANN as primary, SQL graph as fallback).

**Caveats:**
- This is a synthetic test with 5 fixtures per entity type. Real profiles may be noisier, sparser, or bimodal (dense synthesis vs. raw bio).
- Fine-grained skill matching (e.g., Apollo Client ↔ GraphQL) was not tested.
- Recruiter feedback calibration (N≥100) remains required to validate the combinator weights, not just the embedding space.

---

## Fixtures

### Roles

- **L_A** (fintech-react): Senior React frontend engineer for fintech. TypeScript, Next.js, trading dashboards. Experience with real-time market data visualization, payment flow UI, and regulatory reporting interfaces.
- **L_B** (blockchain-rust): Cryptography researcher for blockchain protocols. Rust, zero-knowledge proofs, elliptic curve cryptography, formal verification of consensus algorithms. Deep expertise in cryptographic protocols and peer-to-peer networking.
- **L_C** (healthcare-ml): Machine learning researcher for natural language processing. Python, PyTorch, transformer models, entity recognition and relation extraction. Academic research background with publications on text mining and information extraction.

### Candidates

- **C_A** (fintech-react): Senior frontend engineer with 6 years building React and TypeScript applications in fintech. Led development of real-tim...
- **C_B** (blockchain-rust): Cryptography engineer specializing in Rust for blockchain protocols. Implemented zero-knowledge proof verifiers, ellipti...
- **C_C** (healthcare-ml): Machine learning researcher with PyTorch and Hugging Face transformers. Built NLP pipelines for entity recognition, rela...
- **C_D** (design): Graphic designer with expertise in brand identity, visual design systems, Adobe Illustrator, Photoshop, and motion graph...
- **C_E** (civil-engineering): Civil engineer with structural analysis, AutoCAD, and bridge design experience for municipal infrastructure projects. Pe...

### Repos

- **R_A** (fintech-react): React-based fintech trading dashboard. TypeScript frontend with Next.js, real-time WebSocket data feeds, charting librar...
- **R_B** (blockchain-rust): Rust implementation of a zero-knowledge proof system. Cryptographic primitives including elliptic curve signatures, Merk...
- **R_C** (healthcare-ml): PyTorch NLP research toolkit for text mining. Transformer-based entity recognition and relation extraction models. Inclu...
- **R_D** (design): Brand design system and digital asset library. Adobe Creative Suite templates, logo variations, color palette generators...
- **R_E** (civil-engineering): Structural engineering analysis suite for bridge and building design. Finite element modeling for load distribution, mat...

---

## Role → Candidate

|    Query |      C_A |      C_B |      C_C |      C_D |      C_E |
|----------|----------|----------|----------|----------|----------|
|      L_A |   0.9336 |   0.6742 |   0.6133 |   0.6178 |   0.5631 |
|      L_B |   0.6169 |   0.9138 |   0.6552 |   0.5567 |   0.5759 |
|      L_C |   0.5751 |   0.6406 |   0.9069 |   0.5810 |   0.5770 |

- **Same-domain margin ≥ 0.10:** PASS
- **Dynamic range > 0.20:** PASS (min: 0.3318, skipped: 0)
- **Inversions:** 0

## Candidate → Role

|    Query |      L_A |      L_B |      L_C |
|----------|----------|----------|----------|
|      C_A |   0.9336 |   0.6169 |   0.5751 |
|      C_B |   0.6742 |   0.9138 |   0.6406 |
|      C_C |   0.6133 |   0.6552 |   0.9069 |
|      C_D |   0.6178 |   0.5567 |   0.5810 |
|      C_E |   0.5631 |   0.5759 |   0.5770 |

- **Same-domain margin ≥ 0.10:** PASS
- **Dynamic range > 0.20:** PASS (min: 0.2732, skipped: 2)
- **Inversions:** 0

## Role → Repo

|    Query |      R_A |      R_B |      R_C |      R_D |      R_E |
|----------|----------|----------|----------|----------|----------|
|      L_A |   0.9042 |   0.5781 |   0.5733 |   0.5898 |   0.6058 |
|      L_B |   0.6152 |   0.8353 |   0.6092 |   0.5278 |   0.5868 |
|      L_C |   0.5475 |   0.5688 |   0.8764 |   0.5566 |   0.5762 |

- **Same-domain margin ≥ 0.10:** PASS
- **Dynamic range > 0.20:** PASS (min: 0.3074, skipped: 0)
- **Inversions:** 0

## Candidate → Repo

|    Query |      R_A |      R_B |      R_C |      R_D |      R_E |
|----------|----------|----------|----------|----------|----------|
|      C_A |   0.8566 |   0.6086 |   0.5780 |   0.5832 |   0.6114 |
|      C_B |   0.6434 |   0.8446 |   0.5975 |   0.5401 |   0.6210 |
|      C_C |   0.5928 |   0.6146 |   0.8889 |   0.6015 |   0.5847 |
|      C_D |   0.5579 |   0.4901 |   0.5330 |   0.7936 |   0.6087 |
|      C_E |   0.5046 |   0.5579 |   0.5406 |   0.5613 |   0.8292 |

- **Same-domain margin ≥ 0.10:** PASS
- **Dynamic range > 0.20:** PASS (min: 0.2785, skipped: 0)
- **Inversions:** 0

## Prefix Sensitivity Test

This test verifies that `preprocessForEmbedding(text, 'query')` produces a measurably different embedding and does not harm retrieval when the text is used as a query against documents.

```
Vector difference check (same text, query vs document prefix):
  Cosine similarity: 0.966543
  Angular distance:  0.033457

Query: "Who can build a React trading dashboard with TypeScript..."
  query-side relevance gap: 0.2404
  doc-side relevance gap:   0.2560
  delta:                    -0.0156
Query: "Find someone experienced in zero-knowledge proofs and R..."
  query-side relevance gap: 0.2788
  doc-side relevance gap:   0.2672
  delta:                    0.0116
Query: "Need a PyTorch expert for NLP research and text mining..."
  query-side relevance gap: 0.2740
  doc-side relevance gap:   0.2622
  delta:                    0.0118
Query: "How do I find a frontend engineer for payment systems..."
  query-side relevance gap: 0.0784
  doc-side relevance gap:   0.0750
  delta:                    0.0035
Query: "Candidate with equity research and financial modeling s..."
  query-side relevance gap: 0.2189
  doc-side relevance gap:   0.2198
  delta:                    -0.0009
Average delta: 0.0021
Positive/neutral cases: 3/5
```

**Result:** PASS ✅
- Vector angular distance: 0.033457
- Average retrieval delta: 0.0021

---

*End of report.*
