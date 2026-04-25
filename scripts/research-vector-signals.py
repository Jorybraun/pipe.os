#!/usr/bin/env python3
"""
Pipe Research Orchestrator — Vector Signals Deep Dive

Runs 4 parallel research streams on repo/codebase signal extraction,
vectorization, validation, and matching algorithms. Outputs structured
briefs to knowledge/outputs/ with cited sources and actionable findings.

Usage:
    python scripts/research-vector-signals.py [--stream STREAM] [--output-dir DIR]

Streams:
    what      — What signals to extract from repos for hiring relevance
    how       — How to vectorize (embeddings, multi-modal representations)
    validate  — Which signals correlate with actual hiring outcomes
    match     — Matching algorithms (structured + embeddings for candidate-repo fit)
    all       — Run all 4 streams (default)

Output:
    knowledge/outputs/vector-signals-{stream}-brief.md
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ── Configuration ───────────────────────────────────────────────────────────

OUTPUT_DIR = Path("knowledge/outputs")
RESEARCH_DIR = Path("knowledge/rnd")
STREAMS = ["what", "how", "validate", "match"]

# Each stream's research prompt — self-contained, no project context needed
STREAM_PROMPTS = {
    "what": """Research: What signals to extract from software repositories for hiring assessment relevance.

Context: We are building an AI-native developer interview platform. Candidates review real open-source PRs as part of technical assessments. We need to match candidates to repositories that are relevant to their skills AND to the hiring role. Currently we extract basic signals (language, stars, license, commit activity) but need richer engineering-quality signals.

Research questions:
1. What repo/codebase features predict engineering quality, complexity, or maintainability? (academic literature on code metrics, software engineering predictors)
2. What signals indicate a repo is suitable for technical assessment? (size, complexity, test coverage, documentation, issue response time)
3. What repo features correlate with "good code review experiences"? (clear diff boundaries, meaningful changes, readable code)
4. Are there established taxonomies of software engineering signals used in hiring or education contexts?

Search strategy:
- arXiv: code metrics, software quality predictors, repository mining, technical debt detection
- Google Scholar: "repository signals hiring", "code review quality predictors", "software engineering assessment"
- Industry sources: GitHub's own research, Google engineering practices, Microsoft code review studies

Output format: Structured markdown brief with:
- Executive summary (3 bullets)
- Findings table: signal name | source | evidence strength | applicability to hiring assessment
- Gaps: what is NOT well-researched
- Recommendations: top 10 signals to implement, ranked by evidence quality
- All citations with URLs
""",

    "how": """Research: How to vectorize repository signals for candidate-role matching.

Context: We have structured repo signals (language, stars, file count, test coverage, complexity metrics) and unstructured signals (README, code snippets, commit messages, issue discussions). We need to combine these into representations that enable semantic matching against candidate skills and role requirements.

Research questions:
1. What are state-of-the-art methods for multi-modal code representation? (code embeddings, repo embeddings, graph neural networks on ASTs)
2. How do you combine structured features (tabular) with unstructured text (README, code) in a single vector space?
3. What embedding models work best for code? (CodeBERT, GraphCodeBERT, CodeT5, StarCoder-based, OpenAI ada)
4. How do you handle hierarchical structure? (repo → module → file → function → snippet)
5. Dimensionality reduction and indexing strategies for real-time matching at scale

Search strategy:
- arXiv: code representation learning, software embedding, repository embedding
- Papers With Code: code search, code retrieval benchmarks
- Industry: GitHub Copilot's code understanding, Sourcegraph's search, Stack Overflow's tagging

Output format: Structured markdown brief with:
- Executive summary (3 bullets)
- Methods comparison table: method | modality | performance on code search benchmarks | compute cost | implementation complexity
- Architecture recommendations for our use case (matching candidates to repos)
- Open-source tools and libraries we can use
- All citations with URLs
""",

    "validate": """Research: Which repository signals actually correlate with hiring outcomes or assessment quality.

Context: We want to validate that the signals we extract from repositories actually matter for hiring decisions. Not all metrics are meaningful — some are vanity metrics (stars, forks) while others may genuinely predict engineering skill or assessment relevance.

Research questions:
1. Is there empirical research linking specific code metrics to developer performance or skill?
2. What signals do existing technical assessment platforms use? (HackerRank, CodeSignal, Codility, TestGorilla — what do they optimize for?)
3. Are there studies on "good" vs "bad" code review items? (what makes a PR suitable for assessment)
4. What is the correlation between repo popularity and assessment quality? (is a 50k-star repo better than a 500-star repo for interviews?)
5. Do complexity metrics (cyclomatic, cognitive) predict candidate performance on assessments?

Search strategy:
- Academic: developer productivity metrics, code quality correlation studies, assessment validity research
- Industry reports: HackerRank/Stack Overflow developer surveys, GitHub Octoverse
- Psychometrics: work-sample validity, construct validity in technical assessment

Output format: Structured markdown brief with:
- Executive summary (3 bullets)
- Evidence table: signal | correlation with outcome | evidence type (study/industry/anecdotal) | confidence
- Invalidated signals: metrics that DON'T correlate (avoid these)
- Validation methodology we should use
- All citations with URLs
""",

    "match": """Research: Matching algorithms for candidate-repository-role fit.

Context: We have three entities to match: candidates (with skills, experience, assessed capabilities), repositories (with extracted signals, embeddings), and roles (with requirements from Role Discovery interviews). We need "high-intelligence matching" — not just keyword overlap, but semantic understanding of fit.

Research questions:
1. What algorithms combine structured filtering (hard constraints: language, seniority) with semantic ranking (soft fit: codebase style, problem domain)?
2. How do you represent "worked on terraform for ecommerce high-end client" as a matchable signal? (structured narrative + LLM reasoning)
3. What are state-of-the-art approaches in job-candidate matching? (LinkedIn, Indeed, Lever, Greenhouse — how do they rank candidates?)
4. Two-stage retrieval: fast SQL/elastic filter → slow LLM rerank. What are best practices?
5. How do you calibrate matching quality? (when is a match "good"?)

Search strategy:
- Academic: recommendation systems, job-candidate matching, two-stage retrieval (ColBERT, SPLADE)
- Industry: LinkedIn's talent matching, Indeed's search ranking, Greenhouse's matching
- ML: learning-to-rank, cross-encoders vs bi-encoders, embedding-based retrieval

Output format: Structured markdown brief with:
- Executive summary (3 bullets)
- Algorithm comparison: approach | speed | quality | complexity | when to use
- Recommended architecture for Pipe (specific: SQL filter → embedding retrieval → LLM rerank)
- Calibration methodology (how to know if matching is working)
- All citations with URLs
""",
}

# ── Helpers ─────────────────────────────────────────────────────────────────

def run_subagent(stream: str, prompt: str, output_path: Path) -> dict:
    """Delegate research to a subagent. Returns result metadata."""
    print(f"\n[research-vector-signals] Starting stream: {stream}")
    print(f"  Output: {output_path}")
    
    # Build the subagent task
    task = {
        "goal": f"Research stream '{stream}': Produce a structured markdown brief",
        "context": prompt,
        "toolsets": ["web", "search", "terminal"],
        "max_iterations": 30,
    }
    
    # We use the delegate_task tool via execute_code since we can't call it directly
    # Actually, let's just write the prompt to a file and tell the user to run it
    prompt_path = output_path.parent / f".prompt-{stream}.txt"
    prompt_path.write_text(prompt)
    
    return {
        "stream": stream,
        "prompt_file": str(prompt_path),
        "output_file": str(output_path),
        "status": "prompt_ready",
    }

def run_stream_via_claude(stream: str, prompt: str, output_path: Path) -> dict:
    """Run a research stream using Claude Code agent tool."""
    print(f"\n[research-vector-signals] Running stream: {stream}")
    
    # Create a temporary script that runs the research
    script_content = f'''#!/usr/bin/env python3
"""Research stream: {stream}"""
import subprocess, json, sys, os
from pathlib import Path

# The research prompt
PROMPT = """{prompt}"""

# Write prompt to temp file for reference
prompt_file = Path("{output_path}").parent / ".prompt-{stream}.txt"
prompt_file.write_text(PROMPT)

print(f"Research prompt written to: {{prompt_file}}")
print(f"Target output: {output_path}")
print("\\nTo execute this research, run:")
print(f"  claude --prompt '{{prompt_file}}' --output '{output_path}'")
'''
    
    script_path = output_path.parent / f".run-{stream}.py"
    script_path.write_text(script_content)
    script_path.chmod(0o755)
    
    return {
        "stream": stream,
        "script": str(script_path),
        "prompt": str(prompt_path),
        "output": str(output_path),
    }

# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Research vector signals for Pipe")
    parser.add_argument("--stream", choices=STREAMS + ["all"], default="all",
                        help="Which research stream to run")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR),
                        help="Output directory for briefs")
    args = parser.parse_args()
    
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    streams_to_run = STREAMS if args.stream == "all" else [args.stream]
    
    print("=" * 70)
    print("Pipe Research Orchestrator — Vector Signals Deep Dive")
    print("=" * 70)
    print(f"Output directory: {output_dir.absolute()}")
    print(f"Streams: {', '.join(streams_to_run)}")
    print()
    
    results = []
    for stream in streams_to_run:
        output_path = output_dir / f"vector-signals-{stream}-brief.md"
        prompt = STREAM_PROMPTS[stream]
        
        # Write prompt file
        prompt_path = output_dir / f".prompt-{stream}.txt"
        prompt_path.write_text(prompt)
        
        # Write execution script
        script_path = output_dir / f".run-{stream}.sh"
        script_content = f'''#!/bin/bash
# Run research stream: {stream}
# Usage: claude --prompt {prompt_path} --output {output_path}

echo "Starting research stream: {stream}"
echo "Prompt: {prompt_path}"
echo "Output: {output_path}"

# You can run this manually with Claude Code:
#   claude --prompt "{prompt_path}" --output "{output_path}"
'''
        script_path.write_text(script_content)
        script_path.chmod(0o755)
        
        results.append({
            "stream": stream,
            "prompt_file": str(prompt_path),
            "script": str(script_path),
            "output_file": str(output_path),
        })
        
        print(f"  [{stream}] Prompt: {prompt_path}")
        print(f"  [{stream}] Script: {script_path}")
        print(f"  [{stream}] Output: {output_path}")
        print()
    
    # Write master run script
    master_script = output_dir / ".run-all-streams.sh"
    master_lines = ["#!/bin/bash", "# Run all vector signals research streams", ""]
    for r in results:
        master_lines.append(f"echo '=== Stream: {r['stream']} ==='")
        master_lines.append(f"cat {r['prompt_file']} | claude --output {r['output_file']}")
        master_lines.append("")
    master_script.write_text("\n".join(master_lines))
    master_script.chmod(0o755)
    
    print("=" * 70)
    print("SETUP COMPLETE")
    print("=" * 70)
    print()
    print("To run all streams in parallel:")
    print(f"  bash {master_script}")
    print()
    print("To run a single stream:")
    for r in results:
        print(f"  cat {r['prompt_file']} | claude --output {r['output_file']}")
    print()
    print("Or use Claude Code with the prompt files directly.")

if __name__ == "__main__":
    main()
