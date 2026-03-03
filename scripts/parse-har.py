#!/usr/bin/env python3
"""Parse HAR file to find duplicate network calls."""
import json
import sys
from collections import Counter

har_path = sys.argv[1] if len(sys.argv) > 1 else "/Users/hans/Documents/localhost.har"

with open(har_path) as f:
    har = json.load(f)

entries = har["log"]["entries"]

calls = []
for e in entries:
    url = e["request"]["url"]
    method = e["request"]["method"]

    # Extract path
    if "localhost" in url:
        parts = url.split("localhost")
        path = parts[1].split("?")[0] if len(parts) > 1 else url
    elif "appsync" in url.lower() or "amazonaws" in url.lower():
        parts = url.split(".com")
        path = parts[1].split("?")[0] if len(parts) > 1 else url[:80]
    else:
        path = url[:100]

    # For POST requests, extract GraphQL operation name
    op = ""
    if method == "POST" and e["request"].get("postData"):
        try:
            body = json.loads(e["request"]["postData"]["text"])
            if "query" in body:
                q = body["query"]
                for keyword in ["query ", "mutation ", "subscription "]:
                    if keyword in q:
                        start = q.index(keyword) + len(keyword)
                        rest = q[start:]
                        end = len(rest)
                        for ch in ["(", "{", " "]:
                            idx = rest.find(ch)
                            if idx != -1 and idx < end:
                                end = idx
                        op = rest[:end].strip()
                        break
        except Exception:
            pass

    calls.append((method, path[:80], op))

print(f"Total requests: {len(entries)}")
print()

# GraphQL operations
print("=== GraphQL operations ===")
ops = [c[2] for c in calls if c[2]]
for op, count in Counter(ops).most_common():
    dup = "  *** DUPLICATE" if count > 1 else ""
    print(f"  {count}x  {op}{dup}")

print()

# All requests by URL pattern
print("=== Requests by URL pattern (top 25) ===")
patterns = [(c[0], c[1]) for c in calls]
for pat, count in Counter(patterns).most_common(25):
    dup = "  *** DUPLICATE" if count > 1 else ""
    print(f"  {count}x  {pat[0]:6s} {pat[1]}{dup}")

print()

# Timeline: show order of GraphQL ops with timestamps
print("=== GraphQL call timeline ===")
for e in entries:
    method = e["request"]["method"]
    if method != "POST":
        continue
    pd = e["request"].get("postData")
    if not pd:
        continue
    try:
        body = json.loads(pd["text"])
    except Exception:
        continue
    if "query" not in body:
        continue
    q = body["query"]
    op = ""
    for keyword in ["query ", "mutation ", "subscription "]:
        if keyword in q:
            start = q.index(keyword) + len(keyword)
            rest = q[start:]
            end = len(rest)
            for ch in ["(", "{", " "]:
                idx = rest.find(ch)
                if idx != -1 and idx < end:
                    end = idx
            op = rest[:end].strip()
            break
    started = e.get("startedDateTime", "?")
    time_ms = e.get("time", 0)
    print(f"  {started}  {time_ms:7.0f}ms  {op}")
