# Proposta: hospedagem (`chore/hosting`)

> **Status: revisada em 2026-10-13 (Surface), aguardando aprovação.** Nada foi implementado. A primeira versão (2026-10-12, desktop de casa) foi revista com os oito pontos pedidos pelo Braian; o principal é o **Postgres instalado direto na VM, fora do Docker, com os dados em `/mnt/dados`**. A seção "O que mudou nesta revisão" resume as diferenças.

Decisões já tomadas (2026-10-11, ROADMAP "Hospedagem: decisões"): VM na **Contabo**, região **EUA (East)**, cerca de **US$ 20/mês**, configurada do zero com **Docker Compose**; primeiro uso como **demonstração, só com dados fictícios**; **domínio provisório ou sslip.io**, trocável depois; **backup diário do Postgres fora da VM**.

## O que mudou nesta revisão

1. **Postgres 17 do repositório oficial (PGDG) instalado na VM**, cluster `17/main` com os dados em `/mnt/dados/postgresql/17/main`; os containers chegam a ele por uma rede do Docker com sub-rede fixa; a porta 5432 só escuta em `localhost` e no gateway dessa rede (seção 3).
2. **`/mnt/dados` na Contabo é pasta (ou partição) no disco do plano:** o Cloud VPS não tem disco avulso para conectar; o armazenamento é o do plano, que pode ser aumentado no painel ([ajuda da Contabo](https://help.contabo.com/en/support/solutions/articles/103000404871-can-i-add-more-nvme-storage-to-my-vps-or-vds-dedicated-server-)). Conferir no primeiro acesso (seção 3.2).
3. **Dois usuários no banco:** `app_owner` (dono das tabelas, só nas migrations) e `app` (só dados, usado pela API). Conferido no código: a API em execução não cria nem altera tabelas.
4. **Imagens no GHCR públicas** (recomendado), com o caminho para privadas descrito (seção 6).
5. **Modo demonstração** da unidade Demo, com bloqueio no servidor e faixa no painel (seção 10).
6. **Botão "copiar link do convite"** (aprovado) entra na lista de código (seção 8).
7. **Snapshots da Contabo** no DEPLOY.md, como complemento do backup, nunca substituto (seção 7.4).
8. **Servidor em UTC, agendamentos no horário de Brasília** por timers do systemd com o fuso explícito (seção 9).
9. **Senha do Dozzle** gerada pelo `gen-secrets.sh` (seção 5).
10. **Execução no servidor pelo Claude por SSH, com aprovação a cada passo;** o DEPLOY.md funciona sozinho (seção 13).
11. **Ensaio na própria VM** em vez de "produção simulada no desktop": com o Postgres no host, o desktop Windows não reproduz a rede do servidor; a VM nova, só com dados fictícios, é o ensaio (com snapshot antes de cada etapa).

## 1. O que o Braian faz e o que fica automatizado

**Manual (Braian, uma vez):**

1. **VM:** Contabo **Cloud VPS 20** (12 GB de RAM, NVMe), região US East, **Ubuntu 24.04 LTS**. No pedido, conferir se há opção de particionamento (para o `/mnt/dados` em partição própria) e quantos snapshots o plano inclui.
2. **Chave SSH:** `ssh-keygen -t ed25519` no computador de onde o servidor será acessado; a parte pública vai no pedido da VM. A chave privada nunca sai desse computador nem vai para o git.
3. **Backblaze B2:** bucket privado `app-backups` e chave de aplicação limitada ao bucket, **sem permissão de apagar** (a retenção fica com as regras do bucket).
4. **Brevo** (gratuito): conta e chave SMTP.
5. **Healthchecks.io** (gratuito): conta.
6. **Gerenciador de senhas:** guarda o `.env` de produção, a chave privada dos backups, a senha do Dozzle e os códigos de recuperação do 2FA do primeiro admin.
7. **Aprovar cada passo** quando o Claude executar no servidor (seção 13).

**Automatizado no repositório (`deploy/`):** `server-setup.sh` (inclui a instalação do Postgres), `gen-secrets.sh`, `compose.prod.yml`, `Caddyfile`, `deploy.sh`, `rollback.sh`, `backup.sh`, `restore.sh`, `monitor.sh`, unidades e timers do systemd, comando `demo-reset` da API, workflow do GitHub Actions e `docs/DEPLOY.md`.

## 2. Segurança do servidor

- Usuário `deploy` com sudo; `PermitRootLogin no`; SSH só por chave (`PasswordAuthentication no`); **fail2ban** no SSH.
- **ufw:** entrada só 22, 80 e 443 da internet, mais **uma regra interna**: a sub-rede do Docker pode falar com o Postgres no gateway (`ufw allow in on br-app from 172.30.0.0/24 to 172.30.0.1 port 5432 proto tcp`). Sem ela, o ufw bloqueia os containers, porque o tráfego deles para o host passa pela entrada do host.
- **O Docker passa por cima do ufw nas portas que um container publica:** em produção só o Caddy publica porta (80 e 443). Redis sem porta publicada e com senha; Postgres fora do Docker, sem regra para a internet.
- **Atualizações automáticas** (`unattended-upgrades`) de segurança do Ubuntu, do Docker e do **PGDG** (seção 3.5); reinício, se exigido, às 04:30 de Brasília.
- Rotação dos logs do Docker (`max-size`) e do Postgres (`logrotate` do pacote).

## 3. Postgres na VM (fora do Docker)

### 3.1 Instalação

1. Repositório oficial pelo script do próprio pacote: `apt install postgresql-common` e `/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh` (chave assinada do PGDG).
2. **Antes de instalar o servidor**, `create_main_cluster = false` em `/etc/postgresql-common/createcluster.conf`: o pacote não cria o cluster padrão em `/var/lib/postgresql`.
3. `apt install postgresql-17` (a mesma versão principal do desenvolvimento, `postgres:17-alpine`).
4. `/mnt/dados/postgresql` com dono `postgres` e permissão 700; `pg_createcluster 17 main -d /mnt/dados/postgresql/17/main --locale C.UTF-8 --start`. A configuração continua em `/etc/postgresql/17/main` (é ela que vai no backup de configuração e no DEPLOY.md).
5. `timezone = 'UTC'` e `log_timezone = 'UTC'` (o app já grava instantes em UTC e calcula o dia de negócio em São Paulo).

### 3.2 `/mnt/dados`

- **No primeiro acesso:** `lsblk` e `findmnt /mnt/dados` mostram se é partição própria ou pasta do disco principal.
- **Pasta (o mais provável na Contabo):** organiza os dados e facilita mover para outro disco depois; não isola. Proteção contra disco cheio: alerta em 80% (seção 11), logs com rotação, backups locais apagados depois do envio.
- **Partição própria (se o pedido permitir particionar):** montada por UUID no `/etc/fstab`; **sem `nofail`**, para o sistema não seguir sem os dados (melhor parar e avisar do que o Postgres subir numa pasta vazia).
- **Nos dois casos:** override do systemd em `postgresql@17-main.service` com `RequiresMountsFor=/mnt/dados`, e o cluster só existe dentro de `/mnt/dados/postgresql/17/main` (se a pasta estiver vazia, o Postgres não sobe; não cria um banco novo sozinho).
- **Snapshots:** com tudo no disco do plano, o snapshot da Contabo inclui o banco (seção 7.4).

### 3.3 Acesso dos containers ao banco

- **Rede do Docker criada uma vez pelo `server-setup.sh`**, fora do Compose, para não sumir num `docker compose down`:
  `docker network create --subnet 172.30.0.0/24 --gateway 172.30.0.1 -o com.docker.network.bridge.name=br-app app_net`.
  O `compose.prod.yml` usa essa rede como `external`.
- **`DATABASE_URL` aponta para `172.30.0.1:5432`**, o gateway dessa rede. O atalho `host.docker.internal:host-gateway` não serve aqui: por padrão ele aponta para a rede padrão do Docker (`172.17.0.1`), não para a `app_net`.
- `listen_addresses = 'localhost,172.30.0.1'`.
- `pg_hba.conf` só com `local` (peer, para backup e administração), `127.0.0.1/32`, `::1/128` e `172.30.0.0/24`, todos com `scram-sha-256`. Nada de `0.0.0.0/0`.
- **Ordem no boot:** o endereço `172.30.0.1` só existe depois que o Docker sobe. Override do Postgres com `After=docker.service` e `Wants=docker.service`; os containers têm `restart: unless-stopped` e tentam de novo até o banco aceitar. **Testado no ensaio com um reinício da VM.** Se mesmo assim falhar, alternativa: `net.ipv4.ip_nonlocal_bind = 1`, que deixa o Postgres escutar no endereço antes de ele existir.
- **5432 nunca exposta:** `ss -tlnp` mostra só `127.0.0.1`, `::1` e `172.30.0.1`; teste de fora da VM (`nc -vz <IP> 5432` recusado) registrado no DEPLOY.md.

### 3.4 Usuários e conexões

- `app_owner`: dono do banco `app_db` e das tabelas; usado **só** pelo container de migrations.
- `app`: `SELECT, INSERT, UPDATE, DELETE` nas tabelas e uso das sequências, por `ALTER DEFAULT PRIVILEGES FOR ROLE app_owner` (tabelas novas já nascem com a permissão). Usado pela API. Bônus: sem `UPDATE`/`DELETE` na auditoria da plataforma, que hoje já é protegida por gatilho.
- Backup e administração pelo usuário `postgres` local (peer, sem senha na rede).
- **Conexões:** a API abre um único pool do `pg` (até 10 conexões); migrations, backup, teste de restauração e `psql` usam poucas e por pouco tempo. `max_connections = 40`.

### 3.5 Memória, configuração e atualizações

Para a VPS 20 (12 GB), com os containers usando cerca de 2 GB:

| Parâmetro | Valor | Por quê |
|---|---|---|
| `shared_buffers` | 2 GB | cerca de 25% da memória destinada ao banco |
| `effective_cache_size` | 6 GB | o que o cache do sistema costuma ter livre |
| `work_mem` | 16 MB | relatórios com ordenação; 40 conexões não estouram |
| `maintenance_work_mem` | 512 MB | `VACUUM`, índices, restore |
| `random_page_cost` / `effective_io_concurrency` | 1.1 / 200 | disco NVMe |
| `idle_in_transaction_session_timeout` | 5 min | transação esquecida não segura bloqueios |
| `log_min_duration_statement` | 500 ms | consultas lentas aparecem no log (meta dos relatórios: 500 ms) |

Se for a VPS 10 (8 GB): `shared_buffers` 1,5 GB e `effective_cache_size` 4 GB.

- **Atualizações menores do 17** (segurança): `unattended-upgrades` com a origem do PGDG (`origin=apt.postgresql.org,codename=${distro_codename}-pgdg`). Elas reiniciam o Postgres (alguns segundos). A rodada das atualizações passa para **04:15 de Brasília** (seção 9), depois do backup e da restauração da demo.
- **Versão principal (17 → 18): manual e documentada** no DEPLOY.md: snapshot e backup antes, `pg_upgradecluster 17 main`, teste, e só então apagar o cluster antigo. Desenvolvimento (`docker-compose.yml`) muda junto.

## 4. Endereços e HTTPS

O **Caddy** gera e renova o HTTPS sozinho, um subdomínio por app:

| Subdomínio | Para quê |
|---|---|
| `painel.<base>` | Painel do restaurante |
| `cardapio.<base>` | Cardápio digital (`/demo`) |
| `admin.<base>` | Painel da plataforma |
| `api.<base>` | Swagger e agente de impressão |
| `logs.<base>` | Dozzle, com senha |

- `<base>` começa como `<ip-com-traços>.sslip.io`; trocar de domínio = mudar `BASE_DOMAIN` no `.env` e apontar o DNS.
- **Mudança de código:** cada app chama a API pelo próprio endereço (`painel.<base>/api/...`) e o Caddy repassa: as imagens não carregam domínio, os cookies ficam no mesmo site e o Socket.IO passa pelo mesmo caminho.
- **Risco do sslip.io:** limites do Let's Encrypt para domínio compartilhado; o Caddy tenta ZeroSSL sozinho. Se falhar, comprar o domínio antes.
- Painel da plataforma aberto com 2FA e limite de tentativas; `PLATFORM_ALLOWED_IPS` fica como opção.

## 5. Segredos

- `gen-secrets.sh` roda **no servidor** e gera com `openssl rand`: segredos de JWT e da plataforma, `PLATFORM_SECRETS_KEY`, senhas do Postgres (`app_owner` e `app`), senha do Redis, segredo de revalidação do cardápio e a **senha do Dozzle**. O `.env` (`/opt/app/.env`, permissão 600, dono `deploy`) guarda só o **hash** da senha do Dozzle (formato do Caddy); a senha em texto aparece **uma vez** na tela, para o gerenciador de senhas.
- **Nada vai para o git**; a API recusa iniciar em produção com segredo de desenvolvimento ou faltando.
- **Cópia do `.env` no gerenciador de senhas**, em especial a `PLATFORM_SECRETS_KEY` (perda = todo admin refaz o 2FA; docs/SETUP.md).
- Backups cifrados com **`age`**: o servidor guarda só a chave pública; a privada fica só no gerenciador de senhas.
- Renovação: um comando por segredo no roteiro de operação.

## 6. Publicar atualizações

- **Imagens montadas no GitHub Actions** a cada push na `main` (api, web, menu, admin), marcadas com o commit, sem segredos; o servidor só baixa (3 builds do Next na VM disputariam memória com o sistema no ar).
- **GHCR: imagens públicas (recomendado).** O repositório já é público e as imagens não têm segredos; o servidor baixa sem credencial, e não há token para vencer ou vazar. **Se preferir privadas:** um token clássico do GitHub só com `read:packages` (o GHCR não aceita os tokens de permissão fina), validade de 1 ano com lembrete, `docker login ghcr.io` como `deploy` (fica em `~deploy/.docker/config.json`, permissão 600, fora do `.env` do app) e cópia no gerenciador de senhas; a renovação vai no roteiro de operação.
- **`deploy.sh <versão>`** no servidor: backup rápido → `docker compose pull` → **migrations num container de uso único** (`prisma migrate deploy` como `app_owner`, antes de trocar os apps) → sobe a versão nova → verificação de saúde (`/api/health` e as três páginas por HTTPS) → se falhar, volta sozinho.
- Hoje a imagem da API roda as migrations ao iniciar (`docker/api.Dockerfile`); isso passa para o passo separado.
- **Rollback:** `rollback.sh`. Migrations só andam para a frente e precisam continuar compatíveis com a versão anterior do app; quando não der, restaurar o backup do primeiro passo.
- Deploy manual no servidor por enquanto (nenhuma chave do servidor no GitHub).

## 7. Backups

### 7.1 Diário, às 03:30 de Brasília

- `sudo -u postgres pg_dump -Fc app_db` e `pg_dumpall --globals-only --no-role-passwords` (usuários e permissões), cifrados com `age`.
- `tar` cifrado da pasta de imagens enviadas (fotos do cardápio, logos) e da configuração do servidor (`/etc/postgresql/17/main`, `Caddyfile`, overrides do systemd; **sem** o `.env`, que vive no gerenciador de senhas).
- Envio pelo `rclone` para o **B2**; retenção pelas regras do bucket: 7 diários, 4 semanais e 6 mensais.
- O script avisa o Healthchecks.io no início e no fim; falha ou ausência vira e-mail.

### 7.2 Teste de restauração

`restore.sh`: baixa, decifra e restaura num banco temporário do próprio cluster (`app_restore_test`, criado e apagado pelo script), confere contagens (pedidos, clientes, produtos) e se as imagens abrem. Executado **nesta etapa**, com o resultado no DEPLOY.md, e depois mensalmente.

### 7.3 Antes de clientes reais (fora desta etapa)

O backup diário aceita perder até 24 h de dados, o que basta para a demonstração. Antes de dados reais: backup contínuo do WAL para o B2 (pgBackRest ou WAL-G), com perda de minutos. Fica registrado no ROADMAP.

### 7.4 Snapshots da Contabo (no DEPLOY.md)

- **Quando:** depois do `server-setup.sh` (ponto de partida limpo), antes de mudanças grandes no servidor e antes de atualizar a versão principal do Postgres.
- **Como:** painel da Contabo › Snapshots › criar; rodar `CHECKPOINT` no Postgres antes (o snapshot de uma VM ligada equivale a uma queda de energia; o Postgres se recupera, mas o `CHECKPOINT` encurta a recuperação). Restaurar é o "rollback" no mesmo painel e **volta a VM inteira**, inclusive o banco, para aquele momento.
- **Limite:** a quantidade incluída no plano não está clara nas fontes; conferir no painel no pedido e registrar no DEPLOY.md.
- **Não substitui o backup:** o snapshot fica na mesma empresa, não tem retenção longa nem é testado; o backup fora da VM continua obrigatório.

## 8. E-mail

- **Brevo** (300 e-mails por dia, SMTP); o envio passa a aceitar usuário, senha e TLS do SMTP.
- **Sem domínio próprio**, os e-mails tendem a cair no spam: comprar um domínio (US$ 10–15/ano) assim que der.
- **Botão "copiar link do convite"** no painel da plataforma, ao lado do reenvio (**aprovado**), para mandar o convite por WhatsApp.

## 9. Fuso horário e agendamentos

- **Servidor em UTC** (`timedatectl set-timezone Etc/UTC`), Postgres em UTC e containers com `TZ=UTC` (já é assim na imagem da API).
- **Agendamentos por timers do systemd com o fuso no próprio horário** (ex.: `OnCalendar=*-*-* 03:30 America/Sao_Paulo`). Assim o DEPLOY.md e os arquivos dizem o horário de Brasília, sem conta de cabeça, e uma volta do horário de verão não exige mudança.

| Horário (Brasília) | O quê |
|---|---|
| 03:30 | backup |
| 04:00 | restauração da demonstração (`demo-reset`) |
| 04:15 | atualizações automáticas (override do `apt-daily-upgrade.timer`) |
| 04:30 | reinício, se uma atualização exigir (`Automatic-Reboot-Time` do `unattended-upgrades`, que usa o relógio do servidor: `07:30` em UTC; anotado no arquivo) |
| a cada 5 min | monitoramento |

Bares e deliveries podem ir até 2–3 h; a janela 03:30–04:30 é a de menor movimento.

## 10. Dados e modo da demonstração

- **Hoje o `pnpm db:seed` apaga as tabelas da plataforma.** Proteção: o seed recusa rodar com `NODE_ENV=production` ou com banco que não seja local.
- **`demo-reset`** (comando da API): só mexe na unidade `demo`, nunca na plataforma nem em outros clientes; só roda com `DEMO_RESET_ENABLED=true` e `--yes`. Demo com 30 dias de histórico; sem clientes de exemplo da plataforma nem admin de demonstração (o primeiro admin vem do `create`). **Toda noite às 04:00.**
- **Modo demonstração** (credenciais da Demo públicas), ligado por configuração da unidade e **bloqueado no servidor** (guarda na API, erro `DEMO_MODE` com mensagem em pt-BR, "Indisponível no ambiente de demonstração"); a tela esconde ou desativa os botões, mas a regra é da API:
  - **bloqueado:** troca de senha e de e-mail, recuperação de senha dos usuários da Demo, gestão de usuários, exclusões, configurações da empresa, chave PIX, impressão (vínculo de computador e impressoras) e **pedidos reais do cardápio digital** (o cardápio abre, mas o envio mostra que é demonstração). **Sugestão minha, para aprovar:** bloquear também o envio de imagens (fotos de produto e logo), para a demo não virar hospedagem de arquivos de terceiros.
  - **livre:** pedidos, caixa, mesas, cozinha, entregas e relatórios.
  - **Faixa no painel:** "Ambiente de demonstração, restaurado toda noite".
  - Teste e2e para cada bloqueio e roteiro visual da faixa.

## 11. Monitoramento

- `monitor.sh` a cada 5 minutos: saúde dos 4 endereços por HTTPS, **Postgres aceitando conexão** (`pg_isready` no gateway), uso de disco (alerta em 80%, olhando também `/mnt/dados`), memória e carga; avisa o Healthchecks.io. VM fora do ar = o sinal para de chegar = e-mail.
- **Dozzle** (`logs.<base>`, com senha) para os logs dos containers; logs do Postgres em `/var/log/postgresql` (consultas lentas acima de 500 ms).
- UptimeRobot opcional (termos do gratuito para uso comercial pouco claros).

## 12. Agente de impressão

- Instalador gerado no desktop apontando para produção: `pnpm --filter @app/print-agent package -- --api https://api.<base>/api`.
- Continua **sem assinatura de código** (o Smart App Control bloqueia no Surface; serve para testar no desktop).
- Na Demo, o vínculo de impressão fica bloqueado pelo modo demonstração; o teste do agente em produção usa uma unidade de teste criada pelo painel da plataforma.

## 13. Execução no servidor

- **Pelo Claude por SSH**, a partir do computador do Braian e com a chave dele (que não sai do computador), **com aprovação a cada passo**: antes de cada comando, o que ele faz e o que pode dar errado; depois, o resultado.
- **O DEPLOY.md funciona sozinho:** cada passo tem o comando, a saída esperada e como conferir, para qualquer pessoa seguir sem o Claude. Os passos feitos pelo Claude seguem o DEPLOY.md, o que também testa o documento.

## 14. Custos mensais estimados

| Item | Custo |
|---|---|
| Contabo Cloud VPS 20, US East | cerca de US$ 8–12 (conferir a taxa da região no pedido) |
| Backblaze B2 (menos de 10 GB) | US$ 0–1 |
| Brevo, Healthchecks.io, Dozzle, GHCR (público) | US$ 0 |
| Domínio (opcional, recomendado) | cerca de US$ 1/mês |
| **Total** | **cerca de US$ 10–14/mês**, abaixo dos US$ 20 |

O Postgres no host não muda o custo. Preços de 2026-10-12; conferir nos sites oficiais antes de contratar.

## 15. Documentação

**`docs/DEPLOY.md`**, do servidor zerado ao sistema no ar: pedido da VM; primeiro acesso e `server-setup.sh`; **Postgres (instalação, cluster em `/mnt/dados`, rede, usuários, configuração, teste da porta de fora)**; snapshot inicial; DNS, `BASE_DOMAIN` e `gen-secrets.sh`; B2, Brevo e Healthchecks; primeiro deploy, `demo-reset` e o primeiro admin; teste de restauração; reinício da VM conferido; agente de impressão.

**Roteiro de operação:** publicar e voltar uma versão; logs; backup e restauração; snapshots; atualização da versão principal do Postgres; renovar segredos (e o token do GHCR, se privado); senha temporária de admin (`reset-password`); trocar para o domínio próprio; o que fazer com cada alerta.

## Ordem de trabalho (depois da aprovação)

1. **Código, testado localmente** (branch `chore/hosting`): API pelo mesmo endereço do app; SMTP com autenticação; recusa de segredos de desenvolvimento; proteção do seed e `demo-reset`; **modo demonstração**; botão "copiar link do convite"; migrations como passo separado; imagem do admin; workflow das imagens. Com `pnpm check`, e2e e roteiros visuais.
2. **Scripts e DEPLOY.md** (`deploy/`), revisados localmente (`shellcheck`, `docker compose config`).
3. **Ensaio na VM nova** (só dados fictícios), seguindo o DEPLOY.md, com snapshot antes de cada etapa: servidor, Postgres, primeiro deploy, backup, **restauração**, `rollback.sh` e **reinício da VM** (Postgres e containers voltam sozinhos, nessa ordem).
4. Monitoramento e alertas conferidos, validação pelo celular e o DEPLOY.md corrigido com o que o ensaio mostrar.

## Decisões pendentes

1. Montar as imagens no **GitHub Actions** e publicar com `deploy.sh` manual no servidor? (recomendado: sim)
2. **GHCR público** (recomendado) ou privado?
3. **B2** (recomendado) ou R2?
4. Comprar um domínio agora, ou começar com sslip.io e o botão "copiar link do convite"?
5. Restauração da demo **toda noite às 04:00** (recomendado)?
6. Modo demonstração: aprovar a lista acima, incluindo o **bloqueio de envio de imagens** (sugestão minha)?
7. **`/mnt/dados` como pasta** no disco do plano (o mais provável na Contabo) ou, se o pedido permitir, **partição própria**?
8. **Ensaio direto na VM nova** em vez da produção simulada no desktop?
