#!/usr/bin/env python3
"""Parse HAR file - dump GraphQL request bodies to find duplicates."""
import json
import sys
import hashlib

har_path = sys.argv[1] if len(sys.argv) > 1 else "/Users/hans/Documents/localhost.har"

with open(har_path) as f:
    har = json.load(f)

entries = har["log"]["entries"]

print(f"Total requests: {len(entries)}\n")

# Collect all POST requests with bodies
gql_calls = []
for i, e in enumerate(entries):
    method = e["request"]["method"]
    url = e["request"]["url"]
    started = e.get("startedDateTime", "?")
    time_ms = e.get("time", 0)
    
    if method != "POST":
        continue
    
    pd = e["request"].get("postData", {})
    text = pd.get("text", "")
    if not text:
        continue
    
    try:
        body = json.loads(text)
    except Exception:
        continue
    
    # Extract query string
    query = body.get("query", "")
    variables = body.get("variables", {})
    
    # Get first 200 chars of query for display
    query_preview = query.replace("\n", " ")[:200].strip()
    
    # Create a hash of query + variables for dedup detection
    sig = hashlib.md5((query + json.dumps(variables, sort_keys=True)).encode()).hexdigest()[:8]
    
    gql_calls.append({
        "idx": i,
        "time": started,
        "duration": time_ms,
        "url": url,
        "sig": sig,
        "query_preview": query_preview,
        "variables": variables,
        "query_full": query,
    })

# Count by signature
from collections import Counter
sig_counts = Counter(c["sig"] for c in gql_calls)

print(f"GraphQL/POST calls: {len(gql_calls)}")
print(f"Unique request signatures: {len(sig_counts)}")
print()

# Group by signature and show duplicates
print("=== Duplicate groups (same query + same variables) ===\n")
seen_sigs = set()
for call in gql_calls:
    sig = call["sig"]
    count = sig_counts[sig]
    if count > 1 and sig not in seen_sigs:
        seen_sigs.add(sig)
        print(f"--- {count}x duplicated (sig={sig}) ---")
        print(f"  Query: {call['query_preview']}")
        if call["variables"]:
            print(f"  Vars:  {json.dumps(call['variables'])[:200]}")
        # Show timestamps of all instances
        instances = [c for c in gql_calls if c["sig"] == sig]
        for inst in instances:
            print(f"    @ {inst['time']}  ({inst['duration']:.0f}ms)")
        print()

print("\n=== Full timeline (all POST calls) ===\n")
for call in gql_calls:
    dup = f" [DUP x{sig_counts[call['sig']]}]" if sig_counts[call["sig"]] > 1 else ""
    is_gql = "/graphql" in call["url"]
    endpoint = "GQL" if is_gql else "API"
    print(f"  {call['time']}  {call['duration']:6.0f}ms  [{endpoint}] {call['sig']}{dup}")
    print(f"    {call['query_preview'][:120]}")
    print()
