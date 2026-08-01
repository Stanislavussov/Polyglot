#!/usr/bin/env bash
#
# Local auto-provisioning wrapper for the integration test lane (Task 71).
#
# Provisions an ephemeral Neon branch from the permanent `ci-base` branch,
# applies the committed migrations (the prod path), runs the integration lane
# against it, and ALWAYS deletes the branch on exit — even on failure or Ctrl-C.
#
# Design:
#   - Escape hatch first: if TEST_DATABASE_URL is already set (local Postgres or a
#     pre-provisioned branch), skip Neon entirely and just run the lane.
#   - Otherwise require NEON_API_KEY + NEON_PROJECT_ID (env or sourced from .env).
#   - Use the DIRECT connection string, never the pooled one: postgres-js prepared
#     statements break under PgBouncer transaction pooling and `db:migrate` (DDL)
#     needs a direct connection.
#   - The connection string carries credentials and is passed ONLY via env — it is
#     never echoed/printed.
#
# This runs `db:migrate` against an EPHEMERAL CI-style branch (DATABASE_URL points
# at that branch) — the CI-applies-migrations posture the repo prescribes, distinct
# from the forbidden local/dev-DB migrate. Do not use this script as a substitute
# for the dev DB workflow; it is a test entrypoint.
set -euo pipefail

# Pinned neonctl version — bump deliberately (parity with the CI branch actions).
# Verify the JSON output shape still matches the parser below when bumping.
NEONCTL_VERSION="2.15.0"
BASE_BRANCH="ci-base"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# --- Escape hatch: a TEST_DATABASE_URL was supplied, skip provisioning. ---------
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  echo "TEST_DATABASE_URL is set — using it directly (no Neon branch provisioned)."
  exec pnpm test:integration:run
fi

# --- Resolve credentials (env wins; otherwise source .env). ---------------------
if [[ -z "${NEON_API_KEY:-}" || -z "${NEON_PROJECT_ID:-}" ]] && [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -z "${NEON_API_KEY:-}" || -z "${NEON_PROJECT_ID:-}" ]]; then
  cat >&2 <<'REMEDIATION'
ERROR: no test database configured.

Pick ONE of the two lanes:

1. Any migrated+seeded Postgres (what CI does, free) — export TEST_DATABASE_URL
   and re-run. Example throwaway container:
     docker run -d --name polyglot-itest-pg -e POSTGRES_USER=postgres \
       -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=polyglot_test \
       -p 55432:5432 postgres:17
     DATABASE_URL=postgresql://postgres:postgres@localhost:55432/polyglot_test pnpm db:migrate
     DATABASE_URL=postgresql://postgres:postgres@localhost:55432/polyglot_test pnpm admin:seed
     TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/polyglot_test pnpm test:integration

2. Ephemeral Neon branch (bills Neon compute-hours) — put both of these in the
   git-ignored .env at the repo root (or export them), then re-run:
     - NEON_API_KEY     : a Neon API key (Neon console → Account → API keys)
     - NEON_PROJECT_ID  : the Neon project id that owns the `ci-base` branch
REMEDIATION
  exit 1
fi
export NEON_API_KEY NEON_PROJECT_ID

NEONCTL="pnpm dlx neonctl@${NEONCTL_VERSION}"

# Unique, timestamped branch name so a crashed run (that missed the trap) leaves a
# recognisable, prunable straggler rather than colliding with a future run.
BRANCH_NAME="local/$(whoami)-$(date +%s)-$$"
BRANCH_CREATED=0

cleanup() {
  local exit_code=$?
  if [[ "$BRANCH_CREATED" -eq 1 ]]; then
    echo "Deleting ephemeral Neon branch ${BRANCH_NAME}…"
    # Best-effort: never mask the test exit code with a cleanup failure.
    $NEONCTL branches delete "$BRANCH_NAME" \
      --project-id "$NEON_PROJECT_ID" \
      --api-key "$NEON_API_KEY" >/dev/null 2>&1 || \
      echo "WARNING: failed to delete ${BRANCH_NAME}; run 'pnpm neon:prune' to sweep stragglers." >&2
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "Creating ephemeral Neon branch ${BRANCH_NAME} from ${BASE_BRANCH}…"
BRANCH_JSON="$($NEONCTL branches create \
  --project-id "$NEON_PROJECT_ID" \
  --api-key "$NEON_API_KEY" \
  --name "$BRANCH_NAME" \
  --parent "$BASE_BRANCH" \
  --output json)"
BRANCH_CREATED=1

# Defensive parse: extract the DIRECT connection URI from the create output.
# neonctl's JSON shape has drifted across versions; try the known fields and fail
# loudly (without printing the URL) if none carries a value.
DB_URL="$(printf '%s' "$BRANCH_JSON" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let data;
    try { data = JSON.parse(raw); } catch { process.exit(3); }
    const uris = data.connection_uris ?? data.connectionUris ?? [];
    const direct = Array.isArray(uris)
      ? uris.map((u) => u.connection_uri ?? u.connectionUri ?? u).find(Boolean)
      : undefined;
    if (typeof direct === "string" && direct.length > 0) {
      process.stdout.write(direct);
    } else {
      process.exit(4);
    }
  });
')" || {
  echo "ERROR: could not parse a direct connection string from the neonctl output." >&2
  echo "The neonctl JSON contract may have changed for @${NEONCTL_VERSION}; verify and update the parser." >&2
  exit 1
}

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: neonctl returned an empty connection string for ${BRANCH_NAME}." >&2
  exit 1
fi

echo "Applying migrations to ${BRANCH_NAME} (prod path: db:migrate)…"
DATABASE_URL="$DB_URL" pnpm db:migrate

echo "Bootstrapping seed data on ${BRANCH_NAME} (plans + feature access)…"
DATABASE_URL="$DB_URL" pnpm admin:seed

echo "Running integration tests against ${BRANCH_NAME}…"
TEST_DATABASE_URL="$DB_URL" pnpm test:integration:run
