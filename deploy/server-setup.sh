#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 VM (docs/DEPLOY.md, step 2). Run as root, from the repository:
#
#   bash server-setup.sh              everything below, except closing SSH
#   bash server-setup.sh --lock-ssh   AFTER logging in as deploy in another session: no root
#                                     login, no passwords
#
# Re-runnable: each step checks what is already done.
#   - timezone UTC, updates, base packages
#   - user deploy (sudo, the SSH key of root)
#   - ufw (22, 80, 443) and fail2ban
#   - Docker (official repository), log rotation, network app_net 172.30.0.0/24 (gateway .1)
#   - PostgreSQL 17 (PGDG) with the cluster in /mnt/dados/postgresql/17/main
#   - automatic security updates (Ubuntu, Docker, PGDG) at 04:15, reboot if needed at 04:30
#     (Brasília)
set -euo pipefail

log() { printf '\n\033[1m[setup] %s\033[0m\n' "$*"; }
die() {
  echo "ERRO: $*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die "rode como root (sudo bash server-setup.sh)"
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die "feito para Ubuntu 24.04 (encontrado: $PRETTY_NAME)"

DATA=/mnt/dados
NET_SUBNET=172.30.0.0/24
NET_GATEWAY=172.30.0.1
REPO_URL=https://github.com/longarayb/gastrohub_v2.git

# ---------------------------------------------------------------------------------------------
if [[ "${1:-}" == "--lock-ssh" ]]; then
  [[ -s /home/deploy/.ssh/authorized_keys ]] || die "deploy não tem chave SSH; não vou fechar o acesso"
  cat >/etc/ssh/sshd_config.d/10-app-hardening.conf <<'EOF'
# docs/DEPLOY.md: only the deploy user, only with a key.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
  sshd -t || die "configuração do SSH inválida; nada foi recarregado"
  systemctl reload ssh
  log "SSH fechado: sem login de root e sem senha. Teste outra sessão como deploy antes de sair desta."
  exit 0
fi

# ---------------------------------------------------------------------------------------------
log "Fuso UTC, atualizações e pacotes base"
timedatectl set-timezone Etc/UTC
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl gnupg jq ufw fail2ban unattended-upgrades \
  rclone age file postgresql-common

# ---------------------------------------------------------------------------------------------
log "Usuário deploy"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG sudo deploy
# No password (SSH key only): sudo without password, so commands can run over SSH.
echo 'deploy ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
visudo -cf /etc/sudoers.d/90-deploy >/dev/null
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [[ -s /root/.ssh/authorized_keys && ! -s /home/deploy/.ssh/authorized_keys ]]; then
  install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi

# ---------------------------------------------------------------------------------------------
log "Firewall (ufw) e fail2ban"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban

# ---------------------------------------------------------------------------------------------
log "Docker (repositório oficial)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
cat >/etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
systemctl restart docker
usermod -aG docker deploy

# The network of the containers, created once outside Compose (it survives `compose down`):
# Postgres listens on its gateway.
if ! docker network inspect app_net >/dev/null 2>&1; then
  docker network create --driver bridge --subnet "$NET_SUBNET" --gateway "$NET_GATEWAY" \
    -o com.docker.network.bridge.name=br-app app_net
fi
# Containers → Postgres on the host goes through the host's INPUT chain: ufw must allow it.
ufw allow in on br-app from "$NET_SUBNET" to "$NET_GATEWAY" port 5432 proto tcp

# ---------------------------------------------------------------------------------------------
log "Pastas de dados em $DATA"
if mountpoint -q "$DATA"; then
  echo "  $DATA é uma partição própria ($(findmnt -no SOURCE "$DATA"))."
else
  echo "  $DATA é uma pasta no disco principal (mudar para um disco separado: roteiro de operação)."
  mkdir -p "$DATA"
fi
install -d -m 700 -o postgres -g postgres "$DATA/postgresql" 2>/dev/null ||
  install -d -m 700 "$DATA/postgresql" # postgres user exists only after the package
install -d -m 750 -o 1000 -g 1000 "$DATA/uploads" # the node user of the API image
install -d -m 700 "$DATA/backups"

# ---------------------------------------------------------------------------------------------
log "PostgreSQL 17 (PGDG), cluster em $DATA/postgresql/17/main"
# No default cluster in /var/lib/postgresql: ours is created in /mnt/dados.
mkdir -p /etc/postgresql-common
if ! grep -q '^create_main_cluster' /etc/postgresql-common/createcluster.conf 2>/dev/null; then
  echo 'create_main_cluster = false' >>/etc/postgresql-common/createcluster.conf
fi
if [[ ! -e /etc/apt/sources.list.d/pgdg.list && ! -e /etc/apt/sources.list.d/pgdg.sources ]]; then
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
fi
apt-get -y -q install postgresql-17
chown postgres:postgres "$DATA/postgresql"
chmod 700 "$DATA/postgresql"

if ! pg_lsclusters -h | awk '{print $1"/"$2}' | grep -qx '17/main'; then
  pg_createcluster 17 main -d "$DATA/postgresql/17/main" --locale C.UTF-8
fi

# Memory for the VM (12 GB: 2 GB / 6 GB; smaller VMs: 1.5 GB / 4 GB).
mem_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
if ((mem_gb >= 11)); then shared=2GB cache=6GB; else shared=1536MB cache=4GB; fi
cat >/etc/postgresql/17/main/conf.d/app.conf <<EOF
# docs/PROPOSTA_HOSPEDAGEM.md, section 3 (generated by server-setup.sh)
listen_addresses = 'localhost,${NET_GATEWAY}'
port = 5432
max_connections = 40
shared_buffers = ${shared}
effective_cache_size = ${cache}
work_mem = 16MB
maintenance_work_mem = 512MB
random_page_cost = 1.1
effective_io_concurrency = 200
idle_in_transaction_session_timeout = '5min'
log_min_duration_statement = 500
timezone = 'UTC'
log_timezone = 'UTC'
password_encryption = scram-sha-256
EOF
cat >/etc/postgresql/17/main/pg_hba.conf <<EOF
# docs/DEPLOY.md: local admin by peer; the containers only from app_net; nothing else.
local   all       postgres                    peer
local   all       all                         peer
host    all       all       127.0.0.1/32      scram-sha-256
host    all       all       ::1/128           scram-sha-256
host    app_db    app,app_owner ${NET_SUBNET} scram-sha-256
EOF

# Starts only with /mnt/dados mounted, and after Docker (172.30.0.1 exists only then).
mkdir -p /etc/systemd/system/postgresql@17-main.service.d
cat >/etc/systemd/system/postgresql@17-main.service.d/app.conf <<EOF
[Unit]
RequiresMountsFor=$DATA
After=docker.service
Wants=docker.service
EOF
systemctl daemon-reload
systemctl enable postgresql@17-main
systemctl restart postgresql@17-main

# ---------------------------------------------------------------------------------------------
log "Atualizações automáticas (Ubuntu, Docker, PGDG): 04:15, reinício se preciso às 04:30 (Brasília)"
cat >/etc/apt/apt.conf.d/52app-unattended <<'EOF'
// docs/DEPLOY.md
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
  "${distro_id}ESMApps:${distro_codename}-apps-security";
  "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Origins-Pattern {
  "origin=apt.postgresql.org,codename=${distro_codename}-pgdg";
  "origin=Docker,codename=${distro_codename}";
};
Unattended-Upgrade::Automatic-Reboot "true";
// The server clock is UTC: 07:30 UTC = 04:30 in Brasília (no daylight saving time).
Unattended-Upgrade::Automatic-Reboot-Time "07:30";
EOF
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
mkdir -p /etc/systemd/system/apt-daily-upgrade.timer.d
cat >/etc/systemd/system/apt-daily-upgrade.timer.d/app.conf <<'EOF'
[Timer]
OnCalendar=
OnCalendar=*-*-* 04:15 America/Sao_Paulo
RandomizedDelaySec=0
EOF
systemctl daemon-reload
systemctl restart apt-daily-upgrade.timer

# ---------------------------------------------------------------------------------------------
log "Repositório em /opt/app/repo"
install -d -m 755 -o deploy -g deploy /opt/app
if [[ ! -d /opt/app/repo/.git ]]; then
  sudo -u deploy git clone --depth 1 "$REPO_URL" /opt/app/repo
fi

log "Conferência"
echo "  Postgres escutando:"
ss -tlnp | awk '$4 ~ /:5432$/ {print "    " $4}'
echo "  ufw:"
ufw status | sed 's/^/    /'
echo
echo "Próximos passos (docs/DEPLOY.md): entrar como deploy numa NOVA sessão, depois"
echo "'sudo bash /opt/app/repo/deploy/server-setup.sh --lock-ssh', e o snapshot inicial."
