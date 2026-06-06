# Ansible — VPS Hardening

## Security features

- UFW firewall (deny incoming, allow outgoing, SSH/HTTP/HTTPS)
- fail2ban (brute-force protection)
- SSH hardening (no root login, no password auth, max 3 attempts)
- Deploy user with sudo access
- Docker Engine and Compose plugin
- Optional nginx reverse proxy for admin/admin-api domains
- Optional Let's Encrypt TLS certificates via certbot
- Admin seeding helper script

## Public access

The production Compose file binds internal service ports to `127.0.0.1` only:

- admin panel: `127.0.0.1:4321`
- admin API: `127.0.0.1:3001`
- bot metrics: `127.0.0.1:9090`

Do not open those ports publicly for normal production use. Public traffic should enter through nginx on ports 80/443.

Set `ADMIN_PANEL_DOMAIN` and `ADMIN_API_DOMAIN`; nginx proxies each hostname to the matching service.

Automatic Let's Encrypt TLS needs those domains to resolve to the VPS before certbot runs.

## Usage

```bash
export DEPLOY_USER_SSH_KEY="$(cat ~/.ssh/id_rsa.pub)"
export VPS_HOST=45.33.xx.xx
export VPS_USER=root
export VPS_SSH_KEY=~/.ssh/root_or_existing_vps_key

# Domain routing + TLS.
export ADMIN_PANEL_DOMAIN=admin.example.com
export ADMIN_API_DOMAIN=admin-api.example.com
export ACME_EMAIL=ops@example.com

ansible-playbook site.yml
```

Or load the same values from the repository `.env` file:

```bash
./scripts/run-ansible.sh
```

The script exports values from `.env`, expands `~` in `VPS_SSH_KEY`, validates the private key path, and uses `${VPS_SSH_KEY}.pub` as `DEPLOY_USER_SSH_KEY` when that variable is empty.

If the SSH user needs a sudo password, pass Ansible flags through the script:

```bash
./scripts/run-ansible.sh -K
```

After the playbook creates the `deploy` user, configure GitHub Actions with:

```text
VPS_USER=deploy
VPS_SSH_KEY=<private key matching DEPLOY_USER_SSH_KEY>
```

To seed the first admin after the app is deployed:

```bash
ssh deploy@45.33.xx.xx
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='strong-password' sudo -E polyglot-admin-seed
```

## Env vars

| Variable | Description |
|----------|-------------|
| `VPS_HOST` | VPS IP address |
| `VPS_USER` | SSH user for running Ansible, usually `root` before hardening |
| `VPS_SSH_KEY` | Local path to the private SSH key used by Ansible |
| `VPS_SSH_PORT` | SSH port (default: 22) |
| `DEPLOY_USER_SSH_KEY` | Public key installed for the `deploy` user |
| `ADMIN_PANEL_DOMAIN` | Optional public admin panel hostname for nginx |
| `ADMIN_API_DOMAIN` | Optional public admin API hostname for nginx |
| `ACME_EMAIL` | Optional Let's Encrypt registration email; required for automatic TLS |

## Notes

- DNS still has to be configured outside Ansible. Point `ADMIN_PANEL_DOMAIN` and `ADMIN_API_DOMAIN` to the VPS before running certbot.
- GitHub repository secrets still have to be created in GitHub.
- Database backups are managed outside this playbook by the PostgreSQL provider.
