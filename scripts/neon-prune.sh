#!/usr/bin/env bash
#
# Prune leaked ephemeral Neon branches (Task 71).
#
# The integration wrapper (`scripts/integration-test.sh`) and the CI job always
# delete their ephemeral branch on exit. The one case a trap cannot cover is a
# hard runner kill / power loss. This helper sweeps `local/*` and `ci/*` branches
# older than a threshold so a leak surfaces and clears rather than silently eating
# into the free-plan branch cap. The permanent `ci-base` branch is never touched.
#
# Usage:
#   pnpm neon:prune            # delete local/* and ci/* branches older than 6h
#   MAX_AGE_HOURS=24 pnpm neon:prune
#
# Requires NEON_API_KEY + NEON_PROJECT_ID (env or a git-ignored root .env).
set -euo pipefail

NEONCTL_VERSION="2.15.0"
BASE_BRANCH="ci-base"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-6}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${NEON_API_KEY:-}" || -z "${NEON_PROJECT_ID:-}" ]] && [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -z "${NEON_API_KEY:-}" || -z "${NEON_PROJECT_ID:-}" ]]; then
  echo "ERROR: NEON_API_KEY and NEON_PROJECT_ID must be set (env or .env)." >&2
  exit 1
fi
export NEON_API_KEY NEON_PROJECT_ID

NEONCTL="pnpm dlx neonctl@${NEONCTL_VERSION}"

echo "Listing branches for project ${NEON_PROJECT_ID}…"
BRANCHES_JSON="$($NEONCTL branches list \
  --project-id "$NEON_PROJECT_ID" \
  --api-key "$NEON_API_KEY" \
  --output json)"

# Defensively select ephemeral branches (local/*, ci/*) older than MAX_AGE_HOURS,
# excluding the permanent base branch. Emits one branch id per line.
STALE_IDS="$(printf '%s' "$BRANCHES_JSON" | MAX_AGE_HOURS="$MAX_AGE_HOURS" BASE_BRANCH="$BASE_BRANCH" node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let list;
    try { list = JSON.parse(raw); } catch { process.exit(3); }
    const branches = Array.isArray(list) ? list : (list.branches ?? []);
    const maxAgeMs = Number(process.env.MAX_AGE_HOURS) * 60 * 60 * 1000;
    const base = process.env.BASE_BRANCH;
    const cutoff = Date.now() - maxAgeMs;
    for (const b of branches) {
      const name = b.name ?? "";
      if (name === base) continue;
      if (!/^(local|ci)\//.test(name)) continue;
      const created = Date.parse(b.created_at ?? b.createdAt ?? "");
      if (Number.isNaN(created) || created < cutoff) {
        if (b.id) process.stdout.write(String(b.id) + "\n");
      }
    }
  });
')"

if [[ -z "$STALE_IDS" ]]; then
  echo "No stale local/* or ci/* branches older than ${MAX_AGE_HOURS}h."
  exit 0
fi

while IFS= read -r branch_id; do
  [[ -z "$branch_id" ]] && continue
  echo "Deleting stale branch ${branch_id}…"
  $NEONCTL branches delete "$branch_id" \
    --project-id "$NEON_PROJECT_ID" \
    --api-key "$NEON_API_KEY" >/dev/null 2>&1 || \
    echo "WARNING: failed to delete ${branch_id}." >&2
done <<< "$STALE_IDS"

echo "Prune complete."
