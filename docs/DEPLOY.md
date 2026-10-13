# Publicação no servidor (hospedagem)

Do servidor zerado ao sistema no ar, e a operação depois. Decisões em [PROPOSTA_HOSPEDAGEM.md](PROPOSTA_HOSPEDAGEM.md) (aprovada em 2026-10-13). Cada passo diz **o comando**, **o que deve aparecer** e **como conferir**; dá para seguir sem ajuda. Os arquivos citados estão em `deploy/`.

**Visão geral:**

```
internet ──443──> Caddy (container) ──> painel / cardapio / admin (containers Next)
                         │               └─ /api e /socket.io de cada endereço ──> API (container)
                         └─ api.<base> ──> API ──> Redis (container)
                                               └─> PostgreSQL 17 na própria VM (172.30.0.1:5432)
                                                     dados em /mnt/dados/postgresql/17/main
```

- Rede dos containers: `app_net`, `172.30.0.0/24`, criada uma vez pelo `server-setup.sh`. O Postgres escuta só em `localhost` e no gateway dela (`172.30.0.1`); a porta 5432 nunca fica aberta para a internet.
- Só o Caddy publica portas (80 e 443). Dados em `/mnt/dados` (banco, imagens enviadas, backups locais temporários).
- Servidor em **UTC**; agendamentos no horário de **Brasília**: backup 03:30, restauração da demonstração 04:00, atualizações 04:15, reinício (se preciso) 04:30, monitoramento a cada 5 minutos.
- `<base>` = `<ip-com-traços>.sslip.io` (ex.: `203-0-113-10.sslip.io`) até haver domínio próprio.

> **Snapshot antes de cada etapa** (decisão 8): os passos marcados com 📸 pedem um snapshot da Contabo antes (painel da Contabo › a VM › Snapshots › Create). O snapshot volta a VM inteira; não substitui o backup.

---

## Parte 1 — Contratar e preparar as contas (Braian, uma vez)

### 1.1 Chave SSH e chave dos backups (no seu computador)

```bash
ssh-keygen -t ed25519 -C "servidor-app"     # gera ~/.ssh/id_ed25519 e id_ed25519.pub
age-keygen -o backup-key.txt                 # chave dos backups (instale o age: https://age-encryption.org)
```

- A **chave privada SSH** não sai do computador. A pública (`.pub`) vai no pedido da VM.
- `backup-key.txt`: guarde o arquivo inteiro no **gerenciador de senhas** e apague-o do disco. A linha `# public key: age1...` é a **chave pública**, que vai para o servidor (`BACKUP_AGE_RECIPIENT`).

### 1.2 VM na Contabo

- **Cloud VPS 20** (12 GB, NVMe), região **United States (East)**, imagem **Ubuntu 24.04**, autenticação pela chave SSH pública.
- No pedido, se houver opção de **particionamento**, crie uma partição para `/mnt/dados` (ext4, o resto do disco menos ~40 GB para o sistema). Se não houver, `/mnt/dados` será uma pasta (decisão 7).
- Anote quantos **snapshots** o plano inclui (painel › Snapshots) e escreva aqui: `____`.
- Anote o **IP**: `<base>` será `<IP com traços>.sslip.io`.

### 1.3 Backblaze B2 (backups)

1. Conta em backblaze.com › B2 Cloud Storage. Bucket **privado** `app-backups`, criptografia do servidor ligada.
2. **Regras de ciclo de vida** (Lifecycle Settings › custom), uma por prefixo:

   | Prefixo | Esconder após | Apagar escondidos após |
   |---|---|---|
   | `daily/` | 7 dias | 1 dia |
   | `weekly/` | 28 dias | 1 dia |
   | `monthly/` | 180 dias | 1 dia |

3. **Application Key** só para esse bucket, com `listBuckets, listFiles, readFiles, writeFiles` — **sem** `deleteFiles` (quem invadir o servidor não apaga os backups). Anote o keyID e a applicationKey (só aparece uma vez) no gerenciador de senhas.

### 1.4 Brevo (e-mail)

Conta gratuita em brevo.com › SMTP & API › gere uma **chave SMTP**. Anote o login SMTP e a chave. Remetente: um e-mail verificado (Senders). Sem domínio próprio, os e-mails tendem a cair no spam: use o botão **"Copiar link do convite"** do painel da plataforma enquanto isso.

### 1.5 Healthchecks.io (alertas)

Conta gratuita. Crie dois checks e anote as URLs de ping:

| Check | Período | Tolerância |
|---|---|---|
| `backup` | 1 dia | 2 horas |
| `monitor` | 5 minutos | 10 minutos |

### 1.6 Imagens no GitHub (GHCR)

As imagens são montadas pelo GitHub Actions a cada push na `main` (workflow `images`). Depois da **primeira** execução, torne os 4 pacotes públicos (decisão 2): github.com › seu perfil › Packages › `app-api`, `app-web`, `app-menu`, `app-admin` › Package settings › Change visibility › **Public**. Conferir: `docker pull ghcr.io/longarayb/app-api:main` funciona sem login.

---

## Parte 2 — Servidor

Comandos como `deploy@vm$` rodam no servidor (por SSH: `ssh deploy@<IP>`); `root@vm#` como root.

### 2.1 Primeiro acesso e preparação

```bash
ssh root@<IP>
root@vm# apt-get update && apt-get -y install git
root@vm# git clone --depth 1 https://github.com/longarayb/gastrohub_v2.git /root/repo
root@vm# bash /root/repo/deploy/server-setup.sh
```

O script mostra cada etapa (`[setup] ...`) e termina com a **Conferência**:

- `Postgres escutando:` só `127.0.0.1:5432`, `[::1]:5432` e `172.30.0.1:5432`;
- `ufw`: `22/tcp (OpenSSH)`, `80/tcp`, `443/tcp`, `443/udp` e `5432/tcp on br-app` vindo de `172.30.0.0/24`.

Se `/mnt/dados` for partição, ele avisa `é uma partição própria`; se for pasta, `é uma pasta no disco principal`.

### 2.2 Fechar o SSH

Numa **nova** janela, confirme que o usuário `deploy` entra: `ssh deploy@<IP>` e `sudo whoami` (deve responder `root`). Só então:

```bash
root@vm# bash /opt/app/repo/deploy/server-setup.sh --lock-ssh
```

Conferir: `ssh root@<IP>` é recusado; `ssh deploy@<IP>` continua entrando.

### 2.3 📸 Snapshot "servidor preparado"

### 2.4 Segredos

```bash
deploy@vm$ bash /opt/app/repo/deploy/gen-secrets.sh <base> <seu e-mail>
```

Ele cria `/opt/app/.env` (permissão 600) e mostra **uma vez** a senha do Dozzle: guarde-a. Depois preencha os `<preencher>` (`nano /opt/app/.env`):

| Variável | Valor |
|---|---|
| `SMTP_USER`, `SMTP_PASSWORD` | login e chave SMTP da Brevo |
| `MAIL_FROM_ADDRESS` | o remetente verificado na Brevo |
| `NOMINATIM_EMAIL` | um e-mail de contato (regra de uso do OpenStreetMap) |
| `BACKUP_AGE_RECIPIENT` | a chave **pública** `age1...` |
| `BACKUP_REMOTE` | `b2:app-backups` |
| `HC_BACKUP_URL`, `HC_MONITOR_URL` | as URLs de ping do Healthchecks |

Conferir: `grep -cE '=<(preencher|gerado)>' /opt/app/.env` responde `0`. **Copie o `.env` inteiro para o gerenciador de senhas** (em especial a `PLATFORM_SECRETS_KEY`: perdida, todo admin refaz o 2FA).

### 2.5 Banco

```bash
deploy@vm$ sudo bash /opt/app/repo/deploy/db-setup.sh
```

Deve terminar com `Banco app_db pronto: app_owner (migrations) e app (API).`

Conferir **de fora da VM** (no seu computador) que a porta do banco não responde:

```bash
nc -vz -w 5 <IP> 5432      # deve falhar (timed out / refused)
```

### 2.6 rclone (envio dos backups)

```bash
deploy@vm$ sudo rclone config create b2 b2 account <keyID> key <applicationKey>
deploy@vm$ sudo rclone lsd b2:app-backups       # deve listar sem erro (vazio)
```

### 2.7 📸 Primeiro deploy

Pegue o commit da última execução verde do workflow `images` (GitHub › Actions › images), por exemplo `3f2c1ab...`:

```bash
deploy@vm$ bash /opt/app/repo/deploy/deploy.sh <commit>
```

Etapas: backup rápido, imagens, migrations, subida e `saúde ok (5 endereços)`, depois `Versão <commit> no ar.` Se a saúde falhar no primeiro deploy, o script para e mostra o endereço com problema; veja os logs (`docker compose --project-name app -f /opt/app/compose.prod.yml logs api`).

### 2.8 Demonstração e primeiro admin

```bash
deploy@vm$ cd /opt/app
deploy@vm$ docker compose --project-name app -f compose.prod.yml run --rm --no-deps api node dist/cli/demo-reset.js --yes
#  Demo restaurada em ~10 s: ... pedidos em 30 dias, 6 usuários (senha Demo1234), modo demonstração ligado.
deploy@vm$ docker compose --project-name app -f compose.prod.yml run --rm --no-deps api node dist/cli/platform-admin.js create --email <seu e-mail> --name "<seu nome>"
#  Senha temporária (mostrada só agora): ...   (vale 24 h sem uso)
```

Abra `https://admin.<base>`, entre com a senha temporária, cadastre o 2FA (guarde os **códigos de recuperação** no gerenciador de senhas) e troque a senha. Abra `https://painel.<base>` com `dono@demo.local` / `Demo1234`: aparece a faixa **"Ambiente de demonstração"**. Abra `https://cardapio.<base>/demo` no celular.

A Demo não precisa de assinatura (sem assinatura não há faixa de cobrança) nem de aceite dos termos (visitantes não são clientes).

### 2.9 Teste de restauração

Rode um backup agora e restaure-o num banco temporário:

```bash
deploy@vm$ sudo systemctl start app-backup.service 2>/dev/null || sudo bash /opt/app/repo/deploy/backup.sh
# cole o conteúdo de backup-key.txt (gerenciador de senhas) num arquivo em memória:
deploy@vm$ sudo nano /dev/shm/backup-key.txt
deploy@vm$ sudo bash /opt/app/repo/deploy/restore.sh /dev/shm/backup-key.txt
```

Deve terminar com `TESTE DE RESTAURAÇÃO OK` e as contagens iguais às atuais (o script apaga a chave do `/dev/shm` no fim). Registre aqui a data e o resultado: `____`.

### 2.10 Agendamentos

```bash
deploy@vm$ sudo bash /opt/app/repo/deploy/install-timers.sh
```

Lista os timers com o próximo horário: `app-backup` (03:30), `app-demo-reset` (04:00), `app-monitor` (5 min) e `apt-daily-upgrade` (04:15). No Healthchecks, o check `monitor` fica verde em até 5 minutos.

### 2.11 Reinício da VM

```bash
deploy@vm$ sudo reboot
```

Depois de ~1 minuto: `ssh deploy@<IP>` e `bash /opt/app/repo/deploy/healthcheck.sh` → `saúde ok`. Conferir também `systemctl status postgresql@17-main` (ativo, iniciado depois do Docker) e `ss -tlnp | grep 5432` (escutando em `172.30.0.1`). Se o Postgres não escutar em `172.30.0.1` depois do boot, use a alternativa da proposta (`net.ipv4.ip_nonlocal_bind = 1`) e registre aqui.

### 2.12 📸 Snapshot "sistema no ar"

### 2.13 Agente de impressão

No desktop (Windows, com Inno Setup): `pnpm --filter @app/print-agent package -- --api https://api.<base>/api`. Sem assinatura de código, o Smart App Control bloqueia (ROADMAP). Na Demo, o vínculo de impressão fica bloqueado pelo modo demonstração: teste com uma unidade criada pelo painel da plataforma.

---

## Roteiro de operação

### Publicar uma versão

Depois do push na `main`, espere o workflow `images` ficar verde e:

```bash
deploy@vm$ bash /opt/app/repo/deploy/deploy.sh <commit>
```

Se a saúde falhar, ele **volta sozinho** para a versão anterior e mostra o backup feito antes das migrations.

**Migrations só andam para a frente:** toda migration precisa funcionar com a versão anterior do app (acrescentar coluna antes de usá-la; remover só numa versão seguinte).

### Voltar uma versão

```bash
deploy@vm$ bash /opt/app/repo/deploy/rollback.sh            # a anterior
deploy@vm$ bash /opt/app/repo/deploy/rollback.sh <commit>   # uma específica
```

### Voltar o banco (a versão anterior não funciona com o banco migrado)

Com os apps parados, a partir do backup feito pelo `deploy.sh`:

```bash
deploy@vm$ cd /opt/app && docker compose --project-name app -f compose.prod.yml stop api web menu admin
deploy@vm$ ls -1t /mnt/dados/backups/pre-deploy/        # o mais recente antes da versão problemática
deploy@vm$ sudo -u postgres pg_restore --clean --if-exists -d app_db /mnt/dados/backups/pre-deploy/<arquivo>.dump
deploy@vm$ sudo bash /opt/app/repo/deploy/db-setup.sh     # repõe as permissões do usuário app
deploy@vm$ bash /opt/app/repo/deploy/rollback.sh
```

### Logs

`https://logs.<base>` (Dozzle; usuário `admin`, senha no gerenciador). No servidor: `docker compose --project-name app -f /opt/app/compose.prod.yml logs -f --tail 100 api`. Postgres: `/var/log/postgresql/` (consultas acima de 500 ms aparecem lá).

### Backup manual e restauração de desastre

- Backup agora: `sudo bash /opt/app/repo/deploy/backup.sh`.
- Teste de restauração **mensal**: passo 2.9 (o resultado vai para `/opt/app/state/restore-tests.log`).
- **Desastre (VM perdida):** VM nova pelos passos 2.1 a 2.6 com o **mesmo `.env`** (do gerenciador de senhas; não gere segredos novos); baixe o backup (`rclone copy b2:app-backups/daily/<data> /root/restore`), decifre com `age -d -i backup-key.txt`, restaure `app_db.dump` com `pg_restore -d app_db` como `postgres`, rode o `db-setup.sh`, extraia `uploads.tar.gz` em `/mnt/dados` (dono 1000:1000) e faça o deploy da última versão.

### Snapshots

- **Quando:** depois do `server-setup.sh`, antes de mudanças no servidor e antes de atualizar a versão principal do Postgres.
- **Como:** `sudo -u postgres psql -c CHECKPOINT` e depois Snapshots › Create no painel da Contabo. Para voltar: Rollback no mesmo painel (a VM inteira, inclusive o banco, volta para aquele momento; o que foi feito depois se perde — se preciso, restaure o backup mais recente por cima).
- **Não substitui o backup** (fica na mesma empresa, sem retenção longa nem teste).

### Atualizar a versão principal do Postgres (ex.: 17 → 18)

Manual, fora do horário de movimento, com 📸 e backup antes:

```bash
deploy@vm$ sudo apt-get install postgresql-18
deploy@vm$ cd /opt/app && docker compose --project-name app -f compose.prod.yml stop api
deploy@vm$ sudo pg_upgradecluster -m upgrade 17 main /mnt/dados/postgresql/18/main
```

Confira o `conf.d/app.conf` e o `pg_hba.conf` copiados para `/etc/postgresql/18/main`, o override do systemd (`postgresql@18-main.service.d`) e `ss -tlnp | grep 5432`; suba a API e rode o `healthcheck.sh`. Só depois de dias funcionando: `sudo pg_dropcluster 17 main`. Atualize também o `docker-compose.yml` de desenvolvimento (`postgres:18-alpine`).

### Mudar `/mnt/dados` para um disco separado

Nada de configuração muda: só o que está montado em `/mnt/dados`.

1. 📸 e backup. Pare tudo: `docker compose ... stop` e `sudo systemctl stop postgresql@17-main`.
2. Prepare o disco novo (`mkfs.ext4`), monte-o temporariamente em `/mnt/novo` e copie: `sudo rsync -aHAX /mnt/dados/ /mnt/novo/`.
3. No `/etc/fstab`, monte o disco novo em `/mnt/dados` **por UUID** e **sem `nofail`** (se o disco faltar, o boot para e avisa, em vez de o Postgres subir numa pasta vazia).
4. Desmonte `/mnt/novo`, renomeie a pasta antiga (`/mnt/dados.antigo`), `sudo mount /mnt/dados`, suba o Postgres e os containers, rode o `healthcheck.sh`. Apague a pasta antiga só depois de alguns dias.

### Renovar segredos

Edite o valor no `/opt/app/.env` (gere com `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='`), atualize o gerenciador de senhas e reinicie: `docker compose --project-name app -f /opt/app/compose.prod.yml up -d`.

- `JWT_*`: todos entram de novo.
- `DB_*_PASSWORD`: depois de editar, `sudo bash deploy/db-setup.sh` e reinicie.
- `PLATFORM_SECRETS_KEY`: **não renove** sem necessidade (todo admin refaz o 2FA com `reset-2fa`).
- Senha do Dozzle: `docker run --rm caddy:2-alpine caddy hash-password --plaintext '<nova>' | tr -d '\n' | base64 -w0` em `DOZZLE_PASSWORD_HASH`.

### Admin da plataforma: senha ou 2FA

```bash
docker compose --project-name app -f /opt/app/compose.prod.yml run --rm --no-deps api node dist/cli/platform-admin.js reset-password --email <e-mail> --reason "<motivo>"
docker compose --project-name app -f /opt/app/compose.prod.yml run --rm --no-deps api node dist/cli/platform-admin.js reset-2fa --email <e-mail> --reason "<motivo>"
```

### Trocar para o domínio próprio

1. No DNS do domínio: registros `A` de `painel`, `cardapio`, `admin`, `api` e `logs` para o IP da VM.
2. `BASE_DOMAIN=<domínio>` no `.env` (as URLs públicas seguem por `${BASE_DOMAIN}`) e `docker compose ... up -d`. O Caddy emite os certificados novos sozinho.
3. Reinstale o agente de impressão com o endereço novo; refaça o QR Code das mesas e do cardápio.
4. Na Brevo, autentique o domínio (SPF/DKIM) e troque o `MAIL_FROM_ADDRESS`.

### Quando chega um alerta

| Alerta | O que olhar |
|---|---|
| `monitor` fora (nenhum sinal) | A VM caiu ou está sem rede: painel da Contabo (ligar/console). |
| `monitor`: `apps: ...` | `healthcheck.sh` e os logs do container citado; `docker compose ... ps`. |
| `monitor`: `Postgres não aceita conexão` | `systemctl status postgresql@17-main`, `/var/log/postgresql/`, disco cheio? |
| `monitor`: `disco ... em 8x%` | `sudo du -xh /mnt/dados --max-depth 2`, `docker system df`; aumente o disco no painel da Contabo. |
| `monitor`: memória ou carga | `docker stats`; consultas lentas no log do Postgres. |
| `backup` falhou ou não rodou | `journalctl -u app-backup --since today`; `sudo rclone lsd b2:app-backups`. |
