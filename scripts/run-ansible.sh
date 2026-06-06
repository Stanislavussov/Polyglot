#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.prod"
ANSIBLE_DIR="${ROOT_DIR}/deploy/ansible"

expand_path() {
  local path="$1"

  case "${path}" in
    "~") printf '%s\n' "${HOME}" ;;
    "~/"*) printf '%s/%s\n' "${HOME}" "${path#"~/"}" ;;
    *) printf '%s\n' "${path}" ;;
  esac
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

missing_vars=()
for var_name in VPS_HOST VPS_USER VPS_SSH_KEY; do
  if [[ -z "${!var_name:-}" ]]; then
    missing_vars+=("${var_name}")
  fi
done

if [[ ${#missing_vars[@]} -gt 0 ]]; then
  echo "Missing required .env variables: ${missing_vars[*]}" >&2
  exit 1
fi

VPS_SSH_KEY="$(expand_path "${VPS_SSH_KEY}")"
export VPS_SSH_KEY

if [[ ! -f "${VPS_SSH_KEY}" ]]; then
  echo "VPS_SSH_KEY points to a missing file: ${VPS_SSH_KEY}" >&2
  exit 1
fi

if [[ -z "${DEPLOY_USER_SSH_KEY:-}" && -f "${VPS_SSH_KEY}.pub" ]]; then
  DEPLOY_USER_SSH_KEY="$(<"${VPS_SSH_KEY}.pub")"
  export DEPLOY_USER_SSH_KEY
fi

if [[ -z "${DEPLOY_USER_SSH_KEY:-}" ]]; then
  echo "DEPLOY_USER_SSH_KEY is not set and ${VPS_SSH_KEY}.pub was not found." >&2
  echo "Set DEPLOY_USER_SSH_KEY in .env or create the matching public key file." >&2
  exit 1
fi

if [[ -n "${ACME_EMAIL:-}" && ( -z "${ADMIN_PANEL_DOMAIN:-}" || -z "${ADMIN_API_DOMAIN:-}" ) ]]; then
  echo "ACME_EMAIL requires ADMIN_PANEL_DOMAIN and ADMIN_API_DOMAIN." >&2
  exit 1
fi

cd "${ANSIBLE_DIR}"
exec ansible-playbook site.yml "$@"
