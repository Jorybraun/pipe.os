#!/usr/bin/env bash
# Neo4j migration runner for PIPE
# Usage: ./run-migrations.sh [NEO4J_URI] [NEO4J_USER] [NEO4J_PASSWORD]
#
# Defaults:
#   NEO4J_URI=bolt://localhost:7687
#   NEO4J_USER=neo4j
#   NEO4J_PASSWORD=pipe-local-dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/migrations"

NEO4J_URI="${1:-bolt://localhost:7687}"
NEO4J_USER="${2:-neo4j}"
NEO4J_PASSWORD="${3:-pipe-local-dev}"

echo "PIPE Neo4j Migration Runner"
echo "============================"
echo "Target: ${NEO4J_URI}"
echo "Migrations dir: ${MIGRATIONS_DIR}"
echo ""

# Ensure migration tracking node exists
cypher_track() {
  cat <<CYPHER
MERGE (m:__MigrationControl {name: 'tracker'})
ON CREATE SET m.applied = []
RETURN m.applied AS applied_migrations
CYPHER
}

# Fetch currently applied migrations
echo "Checking applied migrations..."
APPLIED=$(cyphercli --address "${NEO4J_URI}" --username "${NEO4J_USER}" --password "${NEO4J_PASSWORD}" --format plain "$(cypher_track)" 2>/dev/null | tail -n +2 | head -1 || echo "")

if [ -z "${APPLIED}" ]; then
  echo "No migration tracker found or cypher-shell not available. Will use direct cypher."
fi

# If cypher-shell is available, use it; otherwise warn
if ! command -v cypher-shell &> /dev/null; then
  echo "WARNING: cypher-shell not found in PATH."
  echo "Falling back to docker exec cypher-shell..."
  CYPHER_CMD=(docker exec -i pipe-neo4j cypher-shell -a "${NEO4J_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --format plain)
else
  CYPHER_CMD=(cypher-shell -a "${NEO4J_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --format plain)
fi

# Get applied migrations from tracker
APPLIED_JSON=$("${CYPHER_CMD[@]}" "MATCH (m:__MigrationControl {name: 'tracker'}) RETURN m.applied AS applied" 2>/dev/null | tail -n +2 | head -1 || echo "[]")
echo "Already applied: ${APPLIED_JSON}"
echo ""

# Run pending migrations in order
for migration in "${MIGRATIONS_DIR}"/*.cypher; do
  filename=$(basename "${migration}")
  
  if echo "${APPLIED_JSON}" | grep -q "\"${filename}\""; then
    echo "[SKIP] ${filename} (already applied)"
    continue
  fi
  
  echo "[APPLY] ${filename}..."
  
  # Run the migration
  if ! "${CYPHER_CMD[@]}" < "${migration}"; then
    echo "[FAIL] ${filename} — migration failed, aborting."
    exit 1
  fi
  
  # Record as applied
  "${CYPHER_CMD[@]}" "
    MATCH (m:__MigrationControl {name: 'tracker'})
    SET m.applied = coalesce(m.applied, []) + '${filename}'
    RETURN m.applied
  " > /dev/null
  
  echo "[OK] ${filename}"
done

echo ""
echo "All migrations complete."
