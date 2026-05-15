#!/usr/bin/env python3
"""Export D1 graph data to local Neo4j instance."""

import sqlite3
import json
import sys

DB_PATH = "workers/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c7052d4c5f690270845d2e1be0b13a62fc3f47b010c62f2243a64980dbf38f15.sqlite"
NEO4J_BOLT = "bolt://localhost:7687"
NEO4J_USER = "neo4j"
NEO4J_PASS = "pipe-local-dev"

def get_db():
    return sqlite3.connect(DB_PATH)

def neo4j_session():
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("neo4j-driver not installed. Installing...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "neo4j", "-q"])
        from neo4j import GraphDatabase
    return GraphDatabase.driver(NEO4J_BOLT, auth=(NEO4J_USER, NEO4J_PASS))

def export_candidates(driver, db):
    cur = db.cursor()
    cur.execute("SELECT id, name, email, created_at FROM candidates")
    candidates = cur.fetchall()
    print(f"Exporting {len(candidates)} candidates...")
    
    with driver.session() as session:
        for cid, name, email, created_at in candidates:
            session.run("""
                MERGE (c:Candidate {candidate_id: $cid})
                SET c.name = $name, c.email = $email, c.created_at = $created_at
            """, cid=cid, name=name or "", email=email or "", created_at=created_at or "")
    print(f"  ✓ {len(candidates)} candidates")

def export_candidate_nodes(driver, db):
    cur = db.cursor()
    cur.execute("""
        SELECT id, candidate_id, node_type, narrative_text, extracted_properties_json,
               embedding_json, source_type, source_reference, captured_at, confidence,
               supersedes, superseded_at, decomposition_version
        FROM candidate_nodes
    """)
    nodes = cur.fetchall()
    print(f"Exporting {len(nodes)} candidate_nodes...")
    
    with driver.session() as session:
        for row in nodes:
            (nid, cid, node_type, narrative, props_json, embed_json, source_type,
             source_ref, captured_at, confidence, supersedes, superseded_at, decomp_ver) = row
            
            embed = None
            if embed_json:
                try:
                    embed = json.loads(embed_json)
                    if not isinstance(embed, list) or len(embed) != 1024:
                        embed = None
                except json.JSONDecodeError:
                    embed = None
            
            session.run("""
                MATCH (c:Candidate {candidate_id: $cid})
                MERGE (n:CandidateNode:""" + node_type + """ {id: $nid})
                SET n.narrative = $narrative,
                    n.extracted_properties = $props,
                    n.embedding = $embed,
                    n.source_type = $source_type,
                    n.source_reference = $source_ref,
                    n.captured_at = $captured_at,
                    n.confidence = $confidence,
                    n.supersedes = $supersedes,
                    n.superseded_at = $superseded_at,
                    n.decomposition_version = $decomp_ver
                MERGE (c)-[:HAS]->(n)
            """, cid=cid, nid=nid, narrative=narrative or "", props=props_json,
               embed=embed, source_type=source_type or "", source_ref=source_ref or "",
               captured_at=captured_at, confidence=confidence, supersedes=supersedes,
               superseded_at=superseded_at, decomp_ver=decomp_ver or "")
    print(f"  ✓ {len(nodes)} candidate_nodes")

def export_roles(driver, db):
    cur = db.cursor()
    cur.execute("SELECT id, pipeline_id, created_at, role_searchable_profile FROM role_contexts")
    roles = cur.fetchall()
    print(f"Exporting {len(roles)} roles...")
    
    with driver.session() as session:
        for rid, pipeline_id, created_at, profile in roles:
            session.run("""
                MERGE (r:Role {role_context_id: $rid})
                SET r.pipeline_id = $pipeline_id, r.created_at = $created_at,
                    r.role_searchable_profile = $profile
            """, rid=rid, pipeline_id=pipeline_id or "", created_at=created_at or "",
               profile=profile or "")
    print(f"  ✓ {len(roles)} roles")

def export_role_nodes(driver, db):
    cur = db.cursor()
    cur.execute("""
        SELECT id, role_context_id, rcd_version, node_type, narrative_text,
               extracted_properties_json, embedding_json, source_section,
               source_stakeholder, weight, superseded_at
        FROM role_nodes
    """)
    nodes = cur.fetchall()
    print(f"Exporting {len(nodes)} role_nodes...")
    
    with driver.session() as session:
        for row in nodes:
            (nid, rid, rcd_version, node_type, narrative, props_json, embed_json,
             source_section, source_stakeholder, weight, superseded_at) = row
            
            embed = None
            if embed_json:
                try:
                    embed = json.loads(embed_json)
                    if not isinstance(embed, list) or len(embed) != 1024:
                        embed = None
                except json.JSONDecodeError:
                    embed = None
            
            session.run("""
                MATCH (r:Role {role_context_id: $rid})
                MERGE (n:RoleNode:""" + node_type + """ {id: $nid})
                SET n.narrative = $narrative,
                    n.extracted_properties = $props,
                    n.embedding = $embed,
                    n.rcd_version = $rcd_version,
                    n.source_section = $source_section,
                    n.source_stakeholder = $source_stakeholder,
                    n.weight = $weight,
                    n.superseded_at = $superseded_at
                MERGE (r)-[:HAS]->(n)
            """, rid=rid, nid=nid, narrative=narrative or "", props=props_json,
               embed=embed, rcd_version=rcd_version or "", source_section=source_section or "",
               source_stakeholder=source_stakeholder or "", weight=weight,
               superseded_at=superseded_at)
    print(f"  ✓ {len(nodes)} role_nodes")

def export_repos(driver, db):
    cur = db.cursor()
    cur.execute("SELECT id, full_name, github_url, description, primary_language, seniority_band, detected_domain, stars FROM qualified_repos WHERE disqualified = 0")
    repos = cur.fetchall()
    print(f"Exporting {len(repos)} repos...")
    
    with driver.session() as session:
        for row in repos:
            (rid, full_name, github_url, description, primary_language, seniority_band,
             detected_domain, stars) = row
            session.run("""
                MERGE (repo:Repo {repo_id: $rid})
                SET repo.full_name = $full_name, repo.github_url = $github_url,
                    repo.description = $description, repo.primary_language = $primary_language,
                    repo.seniority_band = $seniority_band, repo.detected_domain = $detected_domain,
                    repo.stars = $stars
            """, rid=rid, full_name=full_name or "", github_url=github_url or "",
               description=description or "", primary_language=primary_language or "",
               seniority_band=seniority_band or "", detected_domain=detected_domain or "",
               stars=stars or 0)
    print(f"  ✓ {len(repos)} repos")

def main():
    db = get_db()
    driver = neo4j_session()
    
    # Verify connection
    with driver.session() as session:
        result = session.run("RETURN 1 as n")
        record = result.single()
        assert record["n"] == 1
        print("✓ Neo4j connection verified")
    
    export_candidates(driver, db)
    export_candidate_nodes(driver, db)
    export_roles(driver, db)
    export_role_nodes(driver, db)
    export_repos(driver, db)
    
    # Verify counts
    with driver.session() as session:
        counts = session.run("""
            MATCH (c:Candidate) RETURN count(c) as candidates
        """).single()["candidates"]
        cnodes = session.run("""
            MATCH (n:CandidateNode) RETURN count(n) as nodes
        """).single()["nodes"]
        rnodes = session.run("""
            MATCH (n:RoleNode) RETURN count(n) as nodes
        """).single()["nodes"]
        repos = session.run("""
            MATCH (r:Repo) RETURN count(r) as repos
        """).single()["repos"]
        print(f"\nNeo4j counts: {counts} candidates, {cnodes} candidate_nodes, {rnodes} role_nodes, {repos} repos")
    
    driver.close()
    db.close()
    print("\nExport complete.")

if __name__ == "__main__":
    main()
