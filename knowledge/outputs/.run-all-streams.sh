#!/bin/bash
# Run all vector signals research streams

echo '=== Stream: what ==='
cat knowledge/outputs/.prompt-what.txt | claude --output knowledge/outputs/vector-signals-what-brief.md

echo '=== Stream: how ==='
cat knowledge/outputs/.prompt-how.txt | claude --output knowledge/outputs/vector-signals-how-brief.md

echo '=== Stream: validate ==='
cat knowledge/outputs/.prompt-validate.txt | claude --output knowledge/outputs/vector-signals-validate-brief.md

echo '=== Stream: match ==='
cat knowledge/outputs/.prompt-match.txt | claude --output knowledge/outputs/vector-signals-match-brief.md
