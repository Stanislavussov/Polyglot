#!/usr/bin/env bash
# Push the dev-specific GitHub Actions secrets into the `development` environment.
# Values come from the git-ignored .env.dev (+ the dev SSH key file). Repository
# (prod) secrets are never touched: every call carries --env development.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.dev"
ENV="development"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a

for v in VPS_HOST VPS_SSH_KEY ADMIN_PANEL_DOMAIN ADMIN_API_DOMAIN BOT_TOKEN OPENROUTER_API_KEY; do
  [[ -n "${!v:-}" ]] || { echo "$v is empty in $ENV_FILE" >&2; exit 1; }
done
KEY_FILE="${VPS_SSH_KEY/#\~/$HOME}"
[[ -f "$KEY_FILE" ]] || { echo "SSH key not found: $KEY_FILE" >&2; exit 1; }

set_secret() { printf '%s' "$2" | gh secret set "$1" --env "$ENV"; }

set_secret VPS_HOST "$VPS_HOST"
set_secret VPS_USER "deploy"                       # CI connects as the deploy user, not root
set_secret VPS_SSH_PORT "${VPS_SSH_PORT:-22}"
gh secret set VPS_SSH_KEY --env "$ENV" < "$KEY_FILE"
ssh-keyscan -t ed25519 -p "${VPS_SSH_PORT:-22}" "$VPS_HOST" 2>/dev/null | grep -v '^#' | gh secret set VPS_SSH_KNOWN_HOSTS --env "$ENV"
set_secret ADMIN_PANEL_DOMAIN "$ADMIN_PANEL_DOMAIN"
set_secret ADMIN_API_DOMAIN "$ADMIN_API_DOMAIN"
set_secret BOT_TOKEN "$BOT_TOKEN"
set_secret OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
if [[ -n "${JWT_SECRET:-}" ]]; then
  set_secret JWT_SECRET "$JWT_SECRET"
else
  openssl rand -base64 48 | tr -d '\n' | gh secret set JWT_SECRET --env "$ENV"
fi

echo; echo "=== $ENV secrets ==="; gh secret list --env "$ENV"
echo; echo "=== $ENV variables ==="; gh variable list --env "$ENV"
