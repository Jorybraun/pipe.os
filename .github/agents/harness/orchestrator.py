"""
Orchestrator - Entry point for running the team.
"""

import argparse
import json
from team.team_graph import run_feature


def main():
    parser = argparse.ArgumentParser(description="Run a feature through the engineering team.")
    parser.add_argument("feature", help="Feature request description")
    parser.add_argument("--thread-id", default="feature-1", help="Thread ID for persistence")
    parser.add_argument("--output", "-o", help="Output file for results")
    
    args = parser.parse_args()
    
    print(f"Starting feature: {args.feature}")
    print(f"Thread ID: {args.thread_id}")
    print("-" * 50)
    
    result = run_feature(args.feature, args.thread_id)
    
    # Format output
    output = {
        "feature": args.feature,
        "thread_id": args.thread_id,
        "result": result
    }
    
    if args.output:
        with open(args.output, "w") as f:
            json.dump(output, f, indent=2, default=str)
        print(f"Results saved to: {args.output}")
    else:
        print("\nResult:")
        print(json.dumps(output, indent=2, default=str))


if __name__ == "__main__":
    main()
