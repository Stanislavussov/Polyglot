# Ansible — VPS Hardening

## Security features

- UFW firewall (deny incoming, allow outgoing, SSH/HTTP/HTTPS)
- fail2ban (brute-force protection)
- SSH hardening (no root login, no password auth, max 3 attempts)
- Deploy user with sudo access

## Usage

```bash
export DEPLOY_USER_SSH_KEY="$(cat ~/.ssh/id_rsa.pub)"
export VPS_HOST=45.33.xx.xx
ansible-playbook site.yml
```

## Env vars

| Variable | Description |
|----------|-------------|
| `VPS_HOST` | VPS IP address |
| `VPS_USER` | SSH user (default: root) |
| `VPS_SSH_KEY` | Path to SSH private key |
| `VPS_SSH_PORT` | SSH port (default: 22) |
| `DEPLOY_USER_SSH_KEY` | Public key for deploy user |