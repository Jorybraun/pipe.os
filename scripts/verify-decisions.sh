#!/bin/bash

# STREAM 3 Decision Tracking Verification Script
# Validates that all phases are documented with commit hashes

set -e

DECISION_FILE="docs/decisions/ADR-019-github-pr-integration.md"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================"
echo " STREAM 3: Decision Tracking Verification"
echo "================================================"
echo ""

# Check if decision file exists
if [ ! -f "$DECISION_FILE" ]; then
    echo -e "${RED}❌ FAIL: Decision file not found: $DECISION_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Decision file found${NC}"
echo ""

# Check for Phase 0
echo "Checking Phase 0 (Architecture)..."
if grep -q "Phase 0: Architecture Decision" "$DECISION_FILE"; then
    echo -e "${GREEN}✅ Phase 0 documented${NC}"
else
    echo -e "${RED}❌ Phase 0 NOT documented${NC}"
fi

# Check for Phase 1
echo "Checking Phase 1 (fetchGitHubPR Lambda)..."
if grep -q "Phase 1:" "$DECISION_FILE"; then
    echo -e "${GREEN}✅ Phase 1 documented${NC}"
else
    echo -e "${YELLOW}⚠️  Phase 1 documentation incomplete${NC}"
fi

# Check for Phase 2
echo "Checking Phase 2 (Admin UI)..."
if grep -q "Phase 2:" "$DECISION_FILE"; then
    echo -e "${GREEN}✅ Phase 2 documented${NC}"
else
    echo -e "${YELLOW}⚠️  Phase 2 documentation incomplete${NC}"
fi

# Check for Phase 3
echo "Checking Phase 3 (Candidate Flow)..."
if grep -q "Phase 3:" "$DECISION_FILE"; then
    echo -e "${GREEN}✅ Phase 3 documented${NC}"
else
    echo -e "${YELLOW}⚠️  Phase 3 documentation incomplete${NC}"
fi

# Check for Phase 4
echo "Checking Phase 4 (Scoring Lambda)..."
if grep -q "Phase 4:" "$DECISION_FILE"; then
    echo -e "${GREEN}✅ Phase 4 documented${NC}"
else
    echo -e "${YELLOW}⚠️  Phase 4 documentation incomplete${NC}"
fi

echo ""
echo "Checking for commit hashes..."
COMMIT_COUNT=$(grep -o "[a-f0-9]\{7\}" "$DECISION_FILE" | wc -l | tr -d ' ')
echo "Found $COMMIT_COUNT commit hashes"

if [ "$COMMIT_COUNT" -ge 4 ]; then
    echo -e "${GREEN}✅ Commit hashes present (expected 4+)${NC}"
else
    echo -e "${YELLOW}⚠️  Expected at least 4 commit hashes (one per phase)${NC}"
fi

echo ""
echo "================================================"
echo " Verification Complete"
echo "================================================"
