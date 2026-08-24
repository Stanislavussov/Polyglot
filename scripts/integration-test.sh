#!/usr/bin/env bash
#
# The single entry point for the real-DB integration lane (`pnpm test:integration`).
#
# One command, every environment, no per-checkout setup: it finds or provisions a
# throwaway Postgres, brings it to the production schema (`db:migrate` + the plans
# bootstrap `admin:seed`), runs the lane against it, and always tears down whatever
# it created — on success, on failure, and on Ctrl-C.
#
# Lanes, tried in order (force one with POLYGLOT_TEST_DB=supplied|neon|local):
#
#   1. supplied — TEST_DATABASE_URL is already set. What CI uses (its service
#      container) and what a shared local Postgres uses. Nothing is provisioned and
#      nothing is torn down; the URL's owner decides its lifetime.
#   2. neon     — NEON_API_KEY + NEON_PROJECT_ID are available (env, or the
#      git-ignored .env). Cuts an ephemeral branch off `ci-base` and deletes it
#      after. Bills Neon compute-hours, which is why it sits below `supplied` and
#      is never what CI takes.
#   3. local    — a local Postgres installation (initdb) exists. Spins up a private
#      cluster in a temp directory on a free port and destroys it after. Needs no
#      daemon, no Docker, no credentials and no config file, so a freshly created
#      git worktree can run the lane with zero setup, and several worktrees can run
#      it at once: the run directory is keyed to the pid and the port is probed.
#
# Bootstrap runs for every lane so the target is never assumed to be prepared.
# Both steps are idempotent (drizzle skips applied migrations by journal;
# `admin:seed` is bootstrap-only and never touches existing rows), so a re-run
# against a warm database is a no-op. Because the seed no longer re-asserts the
# plan feature matrix, the vitest setup (test/integration/setup.ts) restores it
# for the default plans itself. Set TEST_DB_SKIP_BOOTSTRAP=1 to skip bootstrap
# when iterating against a database you know is already migrated and seeded.
#
# `db:migrate` here targets an ephemeral, CI-style database — the posture the repo
# prescribes — and is NOT a substitute for the dev-DB workflow (`db:generate` +
# `db:push`), which this script must never be used for.
#
# Connection strings carry credentials and are passed only via env — never echoed.
set -euo pipefail

# Pinned neonctl version — bump deliberately (parity with the CI branch actions).
# Verify the JSON output shape still matches the parser below when bumping.
NEONCTL_VERSION="2.15.0"
BASE_BRANCH="ci-base"

# First port probed for the local cluster; later ones are tried when it is taken,
# which is what lets parallel worktrees provision at the same time.
LOCAL_PORT_BASE=55432
LOCAL_PORT_TRIES=64
LOCAL_DB_NAME="polyglot_test"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LANE="${POLYGLOT_TEST_DB:-auto}"

# Resolved by whichever lane wins; consumed by the bootstrap + test run.
DB_URL=""
# Teardown state — the trap reads these, so they must exist before it is installed.
BRANCH_NAME=""
BRANCH_CREATED=0
PG_BIN=""
PG_RUN_DIR=""
PG_STARTED=0

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

  if [[ "$PG_STARTED" -eq 1 ]]; then
    echo "Stopping the local Postgres cluster…"
    "$PG_BIN/pg_ctl" -D "$PG_RUN_DIR/pgdata" -m immediate stop >/dev/null 2>&1 || \
      echo "WARNING: failed to stop the cluster at ${PG_RUN_DIR}; kill it and remove the directory." >&2
  fi
  # Removed even if the stop failed: the data is throwaway either way, and a
  # leftover directory in /tmp is the thing most likely to be forgotten. Written as
  # a full `if` rather than `[[ … ]] && rm`, whose non-zero result would trip
  # `set -e` here and replace a passing run's exit code with 1.
  if [[ -n "$PG_RUN_DIR" && -d "$PG_RUN_DIR" ]]; then
    rm -rf "$PG_RUN_DIR"
  fi

  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# --- Lane 1: a database was supplied. -------------------------------------------
if [[ "$LANE" == "supplied" || ( "$LANE" == "auto" && -n "${TEST_DATABASE_URL:-}" ) ]]; then
  if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
    echo "ERROR: POLYGLOT_TEST_DB=supplied but TEST_DATABASE_URL is not set." >&2
    exit 1
  fi
  echo "Using the supplied TEST_DATABASE_URL (nothing provisioned)."
  DB_URL="$TEST_DATABASE_URL"
fi

# --- Lane 2: an ephemeral Neon branch. ------------------------------------------
if [[ -z "$DB_URL" && "$LANE" != "local" ]]; then
  # Credentials: env wins, otherwise the git-ignored .env at the repo root.
  if [[ -z "${NEON_API_KEY:-}" || -z "${NEON_PROJECT_ID:-}" ]] && [[ -f "$ROOT_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source "$ROOT_DIR/.env"
    set +a
  fi

  if [[ -z "${NEON_API_KEY:-}" || -z "${NEON_PROJECT_ID:-}" ]]; then
    if [[ "$LANE" == "neon" ]]; then
      echo "ERROR: POLYGLOT_TEST_DB=neon but NEON_API_KEY / NEON_PROJECT_ID are not set." >&2
      exit 1
    fi
  else
    export NEON_API_KEY NEON_PROJECT_ID
    NEONCTL="pnpm dlx neonctl@${NEONCTL_VERSION}"

    # Unique, timestamped branch name so a crashed run (that missed the trap) leaves
    # a recognisable, prunable straggler rather than colliding with a future run.
    BRANCH_NAME="local/$(whoami)-$(date +%s)-$$"

    echo "Creating ephemeral Neon branch ${BRANCH_NAME} from ${BASE_BRANCH}…"
    BRANCH_JSON="$($NEONCTL branches create \
      --project-id "$NEON_PROJECT_ID" \
      --api-key "$NEON_API_KEY" \
      --name "$BRANCH_NAME" \
      --parent "$BASE_BRANCH" \
      --output json)"
    BRANCH_CREATED=1

    # Defensive parse: extract the DIRECT connection URI from the create output —
    # never the pooled one, because postgres-js prepared statements break under
    # PgBouncer transaction pooling and `db:migrate` (DDL) needs a direct
    # connection. neonctl's JSON shape has drifted across versions; try the known
    # fields and fail loudly (without printing the URL) if none carries a value.
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
  fi
fi

# --- Lane 3: a private, throwaway local cluster. --------------------------------

# Locate a Postgres installation. `initdb` is rarely on PATH even when the server
# is installed, so the usual Homebrew and Debian layouts are probed too.
find_pg_bin() {
  local candidate
  if candidate="$(command -v initdb 2>/dev/null)"; then
    dirname "$candidate"
    return 0
  fi
  for candidate in \
    /opt/homebrew/opt/postgresql@*/bin \
    /usr/local/opt/postgresql@*/bin \
    /usr/lib/postgresql/*/bin \
    /usr/pgsql-*/bin
  do
    [[ -x "$candidate/initdb" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

# True when something already listens on the port. Only an optimisation: it skips
# ports taken by long-lived servers so the start loop below does not have to burn
# an attempt on them. It can never be a guarantee — between the probe and the bind
# a concurrent run can take the port, which is why the bind itself is the arbiter.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

if [[ -z "$DB_URL" ]]; then
  if ! PG_BIN="$(find_pg_bin)"; then
    cat >&2 <<'REMEDIATION'
ERROR: no test database available and none could be provisioned.

`pnpm test:integration` needs exactly one of these; pick whichever is easiest:

1. A local Postgres installation — nothing else. The script then creates and
   destroys its own throwaway cluster on every run (no daemon, no credentials,
   no config), which is the zero-setup path for a fresh git worktree:
     macOS:  brew install postgresql@17
     Debian: sudo apt-get install postgresql

2. Any already-migrated-or-empty Postgres you point at — export TEST_DATABASE_URL
   and re-run; the script migrates and seeds it for you. A Docker one-liner:
     docker run -d --name polyglot-itest-pg -e POSTGRES_USER=postgres \
       -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=polyglot_test \
       -p 55432:5432 postgres:17
     TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/polyglot_test \
       pnpm test:integration

3. An ephemeral Neon branch (bills Neon compute-hours) — put both of these in the
   git-ignored .env at the repo root (or export them), then re-run:
     - NEON_API_KEY     : a Neon API key (Neon console → Account → API keys)
     - NEON_PROJECT_ID  : the Neon project id that owns the `ci-base` branch
REMEDIATION
    exit 1
  fi

  # Deliberately under /tmp rather than the repo or $TMPDIR: the Unix socket path
  # has a hard ~103-byte limit, and macOS' per-user $TMPDIR alone can eat most of
  # it. Keyed by pid so concurrent worktrees never share a directory.
  PG_RUN_DIR="/tmp/polyglot-itest.$$"
  rm -rf "$PG_RUN_DIR"
  mkdir -p "$PG_RUN_DIR/pgdata"

  echo "Creating a throwaway Postgres cluster…"
  "$PG_BIN/initdb" -D "$PG_RUN_DIR/pgdata" -U postgres --auth=trust >"$PG_RUN_DIR/initdb.log" 2>&1 || {
    echo "ERROR: initdb failed; see $PG_RUN_DIR/initdb.log" >&2
    cat "$PG_RUN_DIR/initdb.log" >&2
    exit 1
  }

  # Claim a port by BINDING it, not by probing it. Two worktrees starting at the
  # same moment both see 55432 free and both try it; the loser gets "Address
  # already in use" and moves on, which a pre-flight check can never prevent. The
  # first port tried is derived from the pid so simultaneous runs usually do not
  # even meet. Durability is off throughout: the cluster is deleted at the end of
  # this run, so fsync would only buy the right to recover data nobody will read.
  PG_PORT=""
  for attempt in $(seq 0 $((LOCAL_PORT_TRIES - 1))); do
    candidate=$(( LOCAL_PORT_BASE + ( ($$ + attempt) % LOCAL_PORT_TRIES ) ))
    port_in_use "$candidate" && continue
    if "$PG_BIN/pg_ctl" -D "$PG_RUN_DIR/pgdata" -w -t 30 -l "$PG_RUN_DIR/server.log" \
      -o "-p $candidate -k $PG_RUN_DIR -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
      start >/dev/null 2>&1
    then
      PG_PORT="$candidate"
      PG_STARTED=1
      break
    fi
    : > "$PG_RUN_DIR/server.log"
  done

  if [[ -z "$PG_PORT" ]]; then
    echo "ERROR: the local Postgres cluster failed to start on any of ${LOCAL_PORT_TRIES} ports." >&2
    [[ -f "$PG_RUN_DIR/server.log" ]] && tail -20 "$PG_RUN_DIR/server.log" >&2
    exit 1
  fi
  echo "Cluster listening on port ${PG_PORT}."

  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U postgres "$LOCAL_DB_NAME"
  DB_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/${LOCAL_DB_NAME}"
fi

# --- Bootstrap + run. -----------------------------------------------------------
if [[ "${TEST_DB_SKIP_BOOTSTRAP:-}" == "1" ]]; then
  echo "TEST_DB_SKIP_BOOTSTRAP=1 — assuming the database is already migrated and seeded."
else
  echo "Applying migrations (prod path: db:migrate)…"
  DATABASE_URL="$DB_URL" pnpm db:migrate

  echo "Bootstrapping seed data (plans + feature access + a default AI model)…"
  DATABASE_URL="$DB_URL" pnpm admin:seed
fi

echo "Running the integration lane…"
# Extra arguments are forwarded to vitest, so the order-independence check the
# bot-testing skill prescribes needs no database of its own either:
#   pnpm test:integration -- --sequence.shuffle
if [[ $# -gt 0 ]]; then
  TEST_DATABASE_URL="$DB_URL" pnpm test:integration:run -- "$@"
else
  TEST_DATABASE_URL="$DB_URL" pnpm test:integration:run
fi
