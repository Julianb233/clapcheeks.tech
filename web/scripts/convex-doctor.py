#!/usr/bin/env python3
import sys
import os
import re
from pathlib import Path

# Paths relative to the script location
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parents[1]
CONVEX_SCHEMA_PATH = REPO_DIR / "web" / "convex" / "schema.ts"
MIGRATIONS_DIR = REPO_DIR / "supabase" / "migrations"

print("=========================================")
print("🩺 CLAPCHEEKS CONVEX BACKEND DOCTOR CHECK")
print("=========================================")

errors = []

# 1. Verify Convex Schema File Exists
if not CONVEX_SCHEMA_PATH.exists():
    errors.append(f"CRITICAL: Convex schema.ts file not found at {CONVEX_SCHEMA_PATH}")
else:
    print(f"✅ Found Convex schema.ts at {CONVEX_SCHEMA_PATH.relative_to(REPO_DIR)}")
    with open(CONVEX_SCHEMA_PATH, "r") as f:
        schema_content = f.read()

    # 1.1 Verify required tables exist
    required_tables = [
        "conversations",
        "messages",
        "outbound_scheduled_messages",
        "approval_queue",
        "agent_jobs",
        "platform_tokens",
        "calendar_slots",
        "memos",
        "matches",
        "device_heartbeats"
    ]

    for table in required_tables:
        # Match table name followed by defineTable
        pattern = re.compile(rf"{table}\s*:\s*defineTable")
        if pattern.search(schema_content):
            print(f"  ✅ Table defined: '{table}'")
        else:
            errors.append(f"Table mapping missing: Table '{table}' is not defined in schema.ts")

    # 1.2 Verify required indexes exist globally or within the schema
    # We will search for specific index signatures in the schema content
    required_indexes = [
        ("conversations", "user_id", r'index\("[^"]*",\s*\[\s*"user_id"\s*\]\)'),
        ("conversations", "status", r'index\("[^"]*",\s*\[\s*"user_id",\s*"status"\s*\]\)'),
        ("conversations", "platform/external_match_id", r'index\("[^"]*",\s*\[\s*"user_id",\s*"platform",\s*"external_match_id"\s*\]\)'),
        ("conversations", "last_message_at", r'index\("[^"]*",\s*\[\s*"user_id",\s*"last_message_at"\s*\]\)'),
        ("platform_tokens", "user_id", r'index\("[^"]*",\s*\[\s*"user_id"\s*\]\)'),
        ("platform_tokens", "platform", r'index\("[^"]*",\s*\[\s*"user_id",\s*"platform"\s*\]\)'),
        ("outbound_scheduled_messages", "scheduled_at", r'index\("[^"]*",\s*\[\s*"status",\s*"scheduled_at"\s*\]\)'),
        ("device_heartbeats", "heartbeat", r'index\("[^"]*",\s*\[\s*"user_id",\s*"last_heartbeat_at"\s*\]\)'),
        ("matches", "external_match_id", r'index\("[^"]*",\s*\[\s*"user_id",\s*"platform",\s*"external_match_id"\s*\]\)')
    ]

    for table, index_desc, pattern_str in required_indexes:
        pattern = re.compile(pattern_str)
        if pattern.search(schema_content):
            print(f"  ✅ Index verified: {table} ({index_desc})")
        else:
            errors.append(f"Index missing: Table '{table}' is missing a required index for '{index_desc}' (Pattern: {pattern_str})")

# 2. Verify Legacy SQL Migrations are Archived
if MIGRATIONS_DIR.exists():
    active_migrations = [f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")]
    if active_migrations:
        errors.append(f"Legacy migrations present: Found {len(active_migrations)} unarchived SQL migration files in {MIGRATIONS_DIR}")
    else:
        print(f"✅ Verified no unarchived SQL migration files remain in the active migrations folder")
else:
    print(f"✅ Migrations folder does not exist or has been removed entirely.")

# Summary and Exit
print("=========================================")
if errors:
    print("❌ BACKEND CHECK FAILED!")
    for err in errors:
        print(f"  - {err}")
    print("=========================================")
    sys.exit(1)
else:
    print("🎉 ALL BACKEND AND SCHEMA CHECKS PASSED!")
    print("=========================================")
    sys.exit(0)
