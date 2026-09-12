# Task 82 — TLS Renewal Hardening & Public-Endpoint Monitoring

**Status:** 🔲 To Do
**Branch:** `worktree/calm-forest-6dd9` (based on `origin/develop` @ `596e4c0`)
**Priority:** 🔴 Critical — caused a live production outage

## Incident that triggered this

On **2026-09-05** the admin panel became unreachable: Chrome refused
`https://admin.polyglot.monster` with `ERR_CERT_DATE_INVALID`, and HSTS made it
impossible to click through.

The application was never down. `polyglot_admin` had been `Up 10 days (healthy)`
and `http://localhost:4321` returned `200` throughout. What failed was TLS: the
Let's Encrypt certificate for `admin.polyglot.monster` (which also covers
`api.polyglot.monster`) **expired 2026-09-04 16:11 UTC**.

### Direct cause — ACME webroot path mismatch

- `/etc/letsencrypt/renewal/admin.polyglot.monster.conf` declares
  `authenticator = webroot`, `webroot_path = /var/www/letsencrypt`
- nginx (`/etc/nginx/sites-available/polyglot`) serves
  `^~ /.well-known/acme-challenge/` from `root /var/www/certbot`

certbot wrote each challenge where nginx does not look. Verified on the live host
with a non-destructive probe:

```
/var/www/certbot/.well-known/acme-challenge/probe-test     → 200 "probe-ok"
/var/www/letsencrypt/.well-known/acme-challenge/probe-test2 → 404
```

Every renewal attempt since **2026-08-05** (exactly 30 days before expiry) failed
identically:

```
Detail: 176.102.64.115: Invalid response from
http://admin.polyglot.monster/.well-known/acme-challenge/PqWk_...: 404
```

`grafana.polyglot.monster` and `polyglot.monster` were unaffected only because
their lineages still use `authenticator = nginx`, which does not depend on this
path.

## Root causes — four missing guardrails

A month-long silent outage required all four to be absent. Fixing only the
webroot path leaves three in place.

### 1. Ansible converges certificate *existence*, not *configuration*

`deploy/ansible/site.yml` guards issuance with:

```yaml
creates: "/etc/letsencrypt/live/{{ admin_panel_domain }}/fullchain.pem"
```

Once the file exists the task never runs again, so `authenticator` and
`webroot_path` are written **once at first issuance and never revisited**. When
the design moved from `/var/www/letsencrypt` to `/var/www/certbot`
(Fable T30/F6, commit `ddd7502`), the playbook updated nginx but could not reach
the already-issued lineage — while still reporting green. **This class recurs for
any future change to certbot flags on any already-issued domain.**

### 2. Nothing reloads nginx after renewal — a latent second outage

`/etc/letsencrypt/renewal-hooks/{pre,deploy,post}/` are all empty. `--webroot`
has no installer, so certbot writes new PEMs while nginx keeps serving the old
certificate from memory until something reloads it.

Grafana and landing survive **by accident** — their `authenticator = nginx`
lineages make certbot reload nginx itself. The moment all three are standardised
on webroot (which the playbook intends), **all three domains begin silently
serving stale certificates** and expire ~30 days later. Fixing #1 without fixing
#2 converts a one-domain outage into a three-domain one.

### 3. Renewal failure emits no signal

`certbot.service` is stock — `ExecStart=/usr/bin/certbot -q renew`, no
`OnFailure=`, no drop-in. The timer fired twice daily, exited non-zero, and told
nobody: roughly 60 failed runs over a month. Loki collects Docker logs; certbot
is a host systemd unit, so nothing reached it there either.

### 4. Certificate expiry is not monitored at all

Prometheus scrapes exactly four jobs — `bot`, `node-exporter`, `cadvisor`,
itself. No blackbox exporter exists, so **nothing ever checks what the outside
world sees**. All six provisioned Grafana alerts (bot down, translation errors,
restart loop, circuit breaker, disk low/critical) are internal. None cover TLS or
public reachability. The detector of last resort was a human opening a browser.

Guardrails 1–2 prevent this family of faults. Guardrails 3–4 catch **any** cause,
including ones not yet imagined.

## Plan

| Layer | Change | Closes |
| --- | --- | --- |
| L0 | Re-issue the admin/api certificate on prod | Restores service (one-off, server-side only) |
| L-1 | `.env.dev` + `pnpm ansible:dev`, parameterise `scripts/run-ansible.sh` | Provisioning is currently untestable — see below |
| L1 | Drop `creates:`, converge renewal params every run | #1 |
| L2 | `renewal-hooks/deploy/reload-nginx.sh` deployed by Ansible | #2 |
| L3 | `OnFailure=` drop-in on `certbot.service` → Telegram | #3 |
| L4 | `blackbox_exporter` + TLS-expiry and `probe_success` alerts | #4 |
| L5 | `certbot renew --dry-run` assertion at the end of the playbook | Drift turns a provisioning run red |

**L-1 is part of the root cause.** `scripts/run-ansible.sh` hardcodes
`${ROOT_DIR}/.env.prod` and the inventory is a single host built from env vars.
There was no way to rehearse provisioning anywhere — which is partly why the
drift survived a month.

> **Scope boundary with [Task 62](./62-separate-deployment-environments.md).**
> Task 62 owns full environment separation — per-environment compose files, CI
> `environment` inputs, bot environment-awareness, DB separation. L-1 here is a
> deliberately narrow slice: make `run-ansible.sh` accept a target env file so
> the playbook can be aimed at the dev host. Do **not** expand this task into
> Task 62; if the `.env.dev` shape is decided here, record it there.

**L4 carries the most value:** it verifies the *actually served* certificate from
outside, so it catches expired, not-renewed, renewed-but-not-reloaded,
wrong-certificate-installed, nginx-down and DNS-moved in one mechanism. Reuse the
existing `polyglot-telegram` contact point and the provisioning pattern in
`deploy/monitoring/grafana/provisioning/alerting/`. Thresholds: 21 days warning,
7 days critical, `probe_success == 0` critical.

If only two layers are ever built, build **L4 and L2**.

### Optional, not the first step

A wildcard `*.polyglot.monster` via DNS-01 collapses three lineages into one and
removes the webroot/nginx-path coupling as a class. Cost: a DNS provider API
token in the deployment path.

## Unverified assumption — check before relying on it

L1 assumes `certbot certonly` **rewrites the renewal config from the supplied CLI
flags even when renewal is not yet due**. This has NOT been verified on either
host and is version-sensitive. Verify first. If it does not hold, converge
`[renewalparams]` declaratively with `ansible.builtin.ini_file` instead.

## Environments

### Production
- `176.102.64.115`, root via `~/.ssh/hukot_ed25519` (`.env.prod` in the main checkout)
- Ubuntu 24.04.3 LTS, nginx 1.24.0, certbot 2.9.0, Docker 29.4.2
- Lineages: `admin.polyglot.monster` (+`api.`, **expired**, webroot),
  `grafana.polyglot.monster` (valid to 2026-11-24, nginx),
  `polyglot.monster` (+`www.`, valid to 2026-11-26, nginx)

### Dev — the rehearsal target
- `polyglot-dev` / `176.102.67.24`, root via `~/.ssh/id_ed25519_polyglot-dev`
  (SSH alias `polyglot-dev-root` is already configured)
- Ubuntu **26.04** LTS, 1 CPU / 1.6 GB RAM / 20 GB
- **Completely unprovisioned:** no Docker, no nginx, no certbot, `/opt` empty,
  no ufw, ports 80/443 free. `pnpm ansible` has never successfully run here.
- A clean host is an advantage: it exercises both first issuance and renewal.

## Blockers requiring a human decision

1. **DNS.** A wildcard `*.polyglot.monster → 176.102.64.115` (prod) resolves
   every name, verified with a deliberately nonexistent label. So
   `dev.polyglot.monster` currently points at **production** and HTTP-01 on the
   dev host cannot succeed. Explicit A records are needed at WEDOS
   (`ns.wedos.com`) to override the wildcard. Recommended, to mirror prod's
   three-lineage shape so the rehearsal reproduces the real drift scenario:

   ```
   dev.polyglot.monster          A  176.102.67.24
   api.dev.polyglot.monster      A  176.102.67.24
   grafana.dev.polyglot.monster  A  176.102.67.24
   ```

2. **Version parity.** Dev is Ubuntu 26.04, prod 24.04. apt will deliver a
   certbot newer than prod's 2.9.0. Since the assumption above is
   version-sensitive, a conclusion drawn on a newer certbot does not transfer.
   Either pin certbot 2.9.0 on dev, or verify on both and encode behaviour valid
   for each.

## Also in scope — self-healing is dead

Two containers are in a permanent restart loop on prod, so container
self-healing does not work at all:

- `polyglot_docker_socket_proxy`: `dial unix /var/run/docker.sock: connect: permission denied`
- `polyglot_autoheal`: `/docker-entrypoint: exec: line 104: autoheal: not found`

Unrelated to TLS, same theme: guardrails that are installed but not working.

## Constraints

- Repo rules in `CLAUDE.md` and `@docs/agents/deployment.md` apply in full.
- **Never run `pnpm ansible` against production without a separate, explicit
  user request for that exact action.** Dev is the rehearsal target.
- Never run `pnpm db:migrate`. This task touches no schema.
- Quality gate after source changes; the Markdown-only exception applies to doc
  commits.
- `deploy-monitoring.yml` triggers on push to **master** under
  `deploy/monitoring/**` — L4 reaches prod only after a merge to master. Ansible
  is applied manually and is branch-independent.
- Confirm DNS before any certbot run; a failed challenge burns Let's Encrypt
  quota. Prefer `--dry-run` (staging) while iterating.

## Definition of done

- Prod admin panel reachable over valid TLS; `certbot renew --dry-run` passes for
  all three lineages.
- A clean `pnpm ansible:dev` run against the bare dev host produces working TLS
  from scratch, and a second run is idempotent.
- Deliberately corrupting `webroot_path` on dev and re-running the playbook
  repairs it — this is the regression test for root cause #1.
- Renewal on dev demonstrably reloads nginx (verify the *served* certificate
  changes, not just the file on disk).
- A forced certbot failure on dev delivers a Telegram alert.
- Blackbox alerts fire for an expiring/unreachable endpoint on dev.
- `polyglot_autoheal` and `polyglot_docker_socket_proxy` healthy on prod, with a
  demonstration that an unhealthy container is actually restarted.
