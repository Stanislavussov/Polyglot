# Ansible — Docker on Ubuntu VPS

## Environment variables

| Variable       | Required | Default         | Description             |
| -------------- | -------- | --------------- | ----------------------- |
| `VPS_HOST`     | **yes**  | —               | VPS IP address          |
| `VPS_USER`     | no       | `root`          | SSH user                |
| `VPS_SSH_KEY`  | no       | `~/.ssh/id_rsa` | Path to SSH private key |
| `VPS_SSH_PORT` | no       | `22`            | SSH port                |

## Usage

```bash
# 1. Copy inventory template (if needed)
cp inventory/hosts.example.yml inventory/hosts.yml

# 2. Export env vars (or add to .env / shell profile)
export VPS_HOST=45.33.xx.xx
export VPS_USER=root
export VPS_SSH_KEY=~/.ssh/vps_key
export VPS_SSH_PORT=22

# 3. Run
ansible-playbook site.yml
```

Or inline:

```bash
VPS_HOST=45.33.xx.xx VPS_SSH_KEY=~/.ssh/vps_key ansible-playbook site.yml
```
