# Proposta: hospedagem (`chore/hosting`)

> **Status: aguardando aprovação.** Apresentada em 2026-10-12 (desktop de casa). Nada desta proposta foi implementado. Antes de aprovar, ela precisa ser **revista com os pontos da seção "Pontos a revisar na retomada"** (no fim deste arquivo), principalmente o Postgres instalado direto na VM, fora do Docker. Onde a proposta abaixo conflita com esses pontos, valem os pontos.

Decisões já tomadas (2026-10-11, ROADMAP "Hospedagem: decisões"): VM na **Contabo**, região **EUA (East)**, cerca de **US$ 20/mês**, configurada do zero com **Docker Compose**; primeiro uso como **demonstração, só com dados fictícios**; **domínio provisório ou sslip.io**, trocável depois; **backup diário do Postgres fora da VM** (Backblaze B2 ou Cloudflare R2).

## 1. O que o Braian faz e o que fica automatizado

**Manual (Braian, uma vez):**

1. **VM:** Contabo **Cloud VPS 20** (12 GB de RAM, NVMe), região US East, **Ubuntu 24.04 LTS**. A VPS 10 (8 GB) também atenderia, porque as imagens não são montadas no servidor (item 5); a VPS 20 dá folga dentro do orçamento.
2. **Chave SSH:** gerada no computador (`ssh-keygen -t ed25519`); a parte pública vai no pedido da VM. A chave privada nunca sai do computador.
3. **Backblaze B2:** conta, bucket privado `app-backups` e uma chave de aplicação limitada ao bucket, **sem permissão de apagar** (a retenção fica com as regras do bucket).
4. **Brevo** (plano gratuito): conta e chave SMTP.
5. **Healthchecks.io** (plano gratuito): conta; os endereços de verificação são criados no passo a passo.
6. **Gerenciador de senhas** (Bitwarden gratuito ou o que já usa): guarda o `.env` de produção e a chave privada dos backups.
7. Executar o roteiro no servidor e conferir cada etapa (ou aprovar cada passo, se a execução for feita pelo Claude por SSH; ver os pontos a revisar).

**Automatizado no repositório (`deploy/`):**

- `server-setup.sh`: prepara o servidor zerado (usuário, SSH, firewall, fail2ban, atualizações automáticas, Docker).
- `gen-secrets.sh`: gera os segredos de produção.
- `compose.prod.yml` e `Caddyfile`.
- `deploy.sh` e `rollback.sh`.
- `backup.sh` e `restore.sh`.
- `monitor.sh`.
- `demo-reset` (comando da API).
- Workflow do GitHub Actions que monta as imagens.
- `docs/DEPLOY.md`.

## 2. Segurança do servidor

- **Usuário:** `deploy` com sudo; root sem login por SSH (`PermitRootLogin no`).
- **SSH:** só por chave (`PasswordAuthentication no`).
- **Firewall (ufw):** libera só 22, 80 e 443. Atenção: o Docker passa por cima do ufw nas portas que um container publica. Por isso, em produção, **nenhum container publica porta além do Caddy**; banco e Redis nunca expostos à internet.
- **fail2ban:** protege o SSH contra tentativas de login.
- **Atualizações:** `unattended-upgrades` com as de segurança; se uma exigir reinício, ele acontece às **04:30 de Brasília**.
- **Logs:** rotação nos logs do Docker (`max-size`), para não lotar o disco.

## 3. Endereços e HTTPS

O **Caddy** gera e renova o HTTPS sozinho, com um subdomínio por app:

| Subdomínio | Para quê |
|---|---|
| `painel.<base>` | Painel do restaurante |
| `cardapio.<base>` | Cardápio digital (`/demo`) |
| `admin.<base>` | Painel da plataforma |
| `api.<base>` | Swagger e agente de impressão |

- Hoje `<base>` = `203-0-113-10.sslip.io` (com o IP da VM). Para trocar pelo domínio próprio: mudar `BASE_DOMAIN` no `.env` e apontar o DNS.
- **Mudança de código necessária:** cada app passa a chamar a API pelo **próprio endereço** (`painel.<base>/api/...`), e o Caddy repassa para a API. Assim as imagens não carregam o domínio (trocar de domínio não exige build novo), os cookies de sessão ficam no mesmo site (sem CORS) e o tempo real (Socket.IO) passa pelo mesmo caminho. Conferido: o código aceita endereço de API vazio, que vira relativo (`API_URL = NEXT_PUBLIC_API_URL ?? ...`).
- **Risco do sslip.io:** domínio compartilhado pode bater nos limites do Let's Encrypt; o Caddy tenta outra autoridade (ZeroSSL) automaticamente. Se mesmo assim falhar, comprar o domínio antes.
- **Painel da plataforma:** aberto com 2FA e limite de tentativas; liberar só alguns IPs (`PLATFORM_ALLOWED_IPS`) fica como opção (IP doméstico dinâmico atrapalharia).

## 4. Segredos

- O `gen-secrets.sh` roda **no servidor** e gera com `openssl rand`: segredos de JWT e da plataforma, `PLATFORM_SECRETS_KEY`, senha do Postgres e segredo de revalidação do cardápio. Grava em `/opt/app/.env` (permissão 600, dono `deploy`).
- **Nada vai para o git.** A API **recusa iniciar** em produção com segredo de desenvolvimento ou faltando.
- **Cópia de segurança:** o `.env` inteiro no gerenciador de senhas, em especial a `PLATFORM_SECRETS_KEY` (consequência da perda em docs/SETUP.md).
- **Backups cifrados com `age`:** o servidor guarda só a chave pública; a privada fica **só** no gerenciador de senhas. Quem invadir o servidor não lê os backups antigos.
- **Renovação:** um comando por segredo, no roteiro de operação. Trocar o segredo de JWT só obriga todos a entrar de novo.

## 5. Publicar atualizações

| | Montar no servidor | **Montar no GitHub Actions** (recomendado) |
|---|---|---|
| Memória | 3 builds do Next disputam memória com o sistema no ar | O servidor só baixa as imagens |
| Tempo fora do ar | Builds de vários minutos na VM | Troca de containers em segundos |
| Custo | — | Gratuito (repositório público, imagens no GHCR) |
| Rollback | Precisa montar a versão antiga de novo | Imagens antigas guardadas por versão |

- **Cada push na `main`** monta 4 imagens (api, web, menu, admin), marcadas com o commit. Nenhum segredo dentro delas.
- **`deploy.sh <versão>`**, rodado no servidor:
  1. backup rápido do banco;
  2. `docker compose pull`;
  3. **migrations** num container de uso único (`prisma migrate deploy`), antes de trocar os apps;
  4. sobe a versão nova;
  5. **verificação de saúde** (`/api/health` e as três páginas por HTTPS);
  6. se falhar, volta sozinho para a versão anterior.
- Deploy manual no servidor por enquanto (sem guardar chave do servidor no GitHub); automatizar depois.
- **Rollback:** `rollback.sh` volta à versão anterior. Migrations só andam para a frente: toda migration precisa continuar compatível com a versão anterior do app (adicionar coluna antes de usar; remover numa versão seguinte). Quando não der, a volta é restaurar o backup do passo 1.
- Hoje o container da API roda as migrations ao iniciar (`docker/api.Dockerfile`); isso passa para o passo separado.

## 6. Backups

- **Diário, às 03:30 de Brasília:** `pg_dump` cifrado com `age`, `tar` cifrado da pasta de imagens enviadas (fotos do cardápio e logos), envio pelo `rclone` para o **B2**.
- **Retenção pelas regras do bucket:** 7 diários, 4 semanais e 6 mensais.
- **Alerta:** o script avisa o Healthchecks.io no início e no fim; se falhar ou não rodar, chega e-mail.
- **Teste de restauração:** `restore.sh` baixa, decifra e restaura num Postgres temporário, confere contagens (pedidos, clientes, produtos) e se as imagens abrem. Executado **pelo menos uma vez nesta etapa**, com o resultado registrado no DEPLOY.md; depois, mensalmente pelo roteiro de operação.
- **R2 em vez do B2:** sem custo de saída, mas mais caro para guardar; para este volume os dois saem praticamente de graça.

## 7. E-mail

- **Brevo:** grátis até 300 e-mails por dia, por SMTP; atende convites e recuperação de senha. Alternativa: Resend (100 por dia).
- **Mudança de código pequena:** o envio passa a aceitar usuário, senha e TLS do SMTP (hoje só fala com o Mailpit).
- **Sem domínio próprio:** o remetente seria um e-mail verificado (ex.: Gmail), sem autenticação do domínio (SPF/DKIM/DMARC): **os e-mails tendem a cair no spam ou ser recusados**. Recomendação: comprar um domínio barato (cerca de US$ 10–15/ano) assim que der.
- **Até lá:** botão "copiar link do convite" no painel da plataforma, para mandar o convite por WhatsApp (**aprovado**, ver pontos a revisar).

## 8. Monitoramento (gratuito ou leve)

- **Fora do ar:** o `monitor.sh` roda a cada 5 minutos, confere a saúde dos 4 endereços por HTTPS e o uso de disco, memória e CPU, e avisa o Healthchecks.io ("ok" ou falha com o motivo). Se a VM inteira cair, o sinal para de chegar e o Healthchecks avisa por e-mail. Limites: disco acima de 80%, memória acima de 90%, carga alta.
- **UptimeRobot:** checagem externa extra possível; os termos do plano gratuito para uso comercial são contraditórios nas fontes. Serve para a demonstração, mas não como dependência.
- **Logs:** **Dozzle** (cerca de 30 MB) mostra os logs dos containers em `logs.<base>`, protegido por senha no Caddy. A API já registra erros em JSON com stack. Sentry gratuito fica como opção futura.
- **Uso da máquina:** `docker stats` e o Dozzle; Netdata fica de fora por pesar mais.

## 9. Dados da demonstração

- **Hoje o `pnpm db:seed` apaga as tabelas da plataforma inteiras.** Em produção, isso apagaria administradores e clientes reais.
- **Proteção:** o seed de desenvolvimento passa a **recusar rodar** com `NODE_ENV=production` ou com banco que não seja local.
- **Comando de produção `demo-reset`**, que só mexe na unidade `demo`: nunca toca a plataforma nem outros clientes; só roda com `DEMO_RESET_ENABLED=true` no `.env` e a confirmação `--yes`.
- **Conteúdo:** a Demo com **30 dias de histórico** (dashboard com dados, seed em segundos), sem clientes de exemplo da plataforma nem admin de demonstração. O primeiro admin vem do comando `create`.
- **Restauração:** sugerida **toda noite às 04:00 de Brasília** (visitante sempre encontra a demonstração limpa); alternativa semanal ou manual.

## 10. Agente de impressão

- Instalador gerado no desktop (Windows + Inno Setup) apontando para produção:
  `pnpm --filter @app/print-agent package -- --api https://api.<base>/api`
- Continua **sem assinatura de código**: o Smart App Control bloqueia no Surface; serve para testar no desktop até existir o certificado (ROADMAP).
- Trocar de domínio exige reinstalar o agente por cima.

## 11. Custos mensais estimados

| Item | Custo |
|---|---|
| Contabo Cloud VPS 20, US East | cerca de US$ 8–12 (fontes divergem sobre a taxa da região; conferir no pedido) |
| Backblaze B2 (menos de 10 GB) | US$ 0–1 |
| Brevo, Healthchecks.io, Dozzle, GHCR | US$ 0 |
| Domínio (opcional, recomendado) | cerca de US$ 1/mês (US$ 10–15/ano) |
| **Total** | **cerca de US$ 10–14/mês**, abaixo dos US$ 20 |

Preços levantados em 2026-10-12 em fontes de terceiros; conferir nos sites oficiais antes de contratar.

## 12. Documentação

**`docs/DEPLOY.md`**, do servidor zerado ao sistema no ar:

1. pedido da VM;
2. primeiro acesso e `server-setup.sh`;
3. DNS, `BASE_DOMAIN` e `gen-secrets.sh`;
4. contas B2, Brevo e Healthchecks;
5. primeiro deploy, `demo-reset` e o primeiro admin (`create`);
6. teste de restauração;
7. agente de impressão.

**Roteiro de operação:** publicar e voltar uma versão; ver logs; rodar e restaurar backup; renovar segredos e gerar senha temporária de admin (`reset-password`); trocar para o domínio próprio; o que fazer quando chega um alerta.

## Ordem de trabalho (depois da aprovação)

1. **Código, testado localmente:** API pelo mesmo endereço do app; SMTP com autenticação; recusa de segredos de desenvolvimento; proteção do seed e `demo-reset`; migrations como passo separado; imagem do admin.
2. **Produção simulada no desktop:** `compose.prod.yml`, Caddy, scripts e workflow, com HTTPS local, `deploy.sh`, `rollback.sh`, backup e restauração reais.
3. **Servidor de verdade:** o Braian contrata; o DEPLOY.md é seguido passo a passo.
4. Teste de restauração no servidor, monitoramento e validação pelo celular.

## Decisões pendentes (da apresentação)

1. Montar as imagens no **GitHub Actions** e publicar com `deploy.sh` manual no servidor?
2. **B2** (recomendado) ou R2?
3. Comprar um domínio agora, ou começar com sslip.io e o botão "copiar link do convite"?
4. Restauração da demo: **toda noite**, semanal ou manual? (Os pontos a revisar indicam "toda noite".)
5. Quem roda os comandos no servidor? (Respondido nos pontos a revisar: provavelmente o Claude por SSH, com aprovação a cada passo.)

---

## Pontos a revisar na retomada

Pedidos do Braian em 2026-10-12, ao adiar a aprovação. A proposta acima precisa ser revista com eles antes de ser apresentada de novo.

### 1. Postgres de produção fora do Docker (mudança principal)

O Postgres de produção **não roda em Docker**: será instalado direto na VM, como um **cluster próprio com os dados em `/mnt/dados`**. Rever a proposta para cobrir:

- **Versão igual à de desenvolvimento:** hoje o `docker-compose.yml` usa `postgres:17-alpine` (Postgres 17). Produção: Postgres 17.
- **Instalação pelo repositório oficial (PGDG)** (`apt.postgresql.org`), não pelo pacote padrão do Ubuntu.
- **Cluster em `/mnt/dados`:** criação com `pg_createcluster 17 main -d /mnt/dados/postgresql/17/main` (ou equivalente), dono `postgres`, permissões 700; desativar ou remover o cluster padrão em `/var/lib/postgresql`.
- **Acesso dos containers ao banco do host:**
  - os containers alcançam o host pela rede do Docker (gateway da rede do Compose, ex.: `172.18.0.1`, ou `host.docker.internal` com `extra_hosts: ["host.docker.internal:host-gateway"]`);
  - rede do Compose com sub-rede **fixa** declarada no `compose.prod.yml`, para o `pg_hba.conf` liberar exatamente ela;
  - `listen_addresses = 'localhost,<IP do gateway da rede do Docker>'`;
  - `pg_hba.conf` liberando **só** `127.0.0.1/32`, `::1/128` e a sub-rede do Docker, com `scram-sha-256`; nada de `0.0.0.0/0`;
  - o Postgres precisa subir depois da interface da rede do Docker existir (ou escutar no gateway de uma rede criada antes); avaliar a ordem de inicialização no boot.
- **Porta 5432 nunca exposta à internet:** o ufw não libera a 5432; conferir com `ss -tlnp` e um teste de fora da VM.
- **Memória do Postgres ajustada à VM:** `shared_buffers` (cerca de 25% da RAM reservada ao banco), `effective_cache_size`, `work_mem`, `maintenance_work_mem`, `max_connections` coerente com o pool do Prisma (API + jobs), considerando a memória dos containers.
- **Atualizações de segurança:** o `unattended-upgrades` precisa incluir a origem do PGDG; atualizações menores do 17 reiniciam o serviço (definir janela de Brasília); atualização de versão principal (17 → 18) é manual e documentada (`pg_upgradecluster`).
- **O que muda:**
  - **backup:** `pg_dump` roda no host (usuário de backup só leitura, ou `postgres` via peer); o resto (age, rclone, B2, retenção, alerta) continua;
  - **restore:** restaurar num banco temporário no próprio cluster (ex.: `app_restore_test`) ou num cluster temporário, e apagar depois;
  - **migrations:** o container de uso único conecta no host pela rede do Docker com o usuário dono do schema; usuário da aplicação separado, com privilégios mínimos, se fizer sentido;
  - **compose.prod.yml:** sem serviço `postgres` nem volume do banco; `DATABASE_URL` aponta para o host; rede com sub-rede fixa.
- **`/mnt/dados`: disco separado ou só uma pasta?** Verificar no plano da Contabo:
  - **disco separado (volume adicional):** montar por UUID no `/etc/fstab` (com `nofail` avaliado), o serviço do Postgres esperar a montagem (`RequiresMountsFor=/mnt/dados` num override do systemd), conferir se os snapshots da Contabo incluem esse disco, e documentar o que acontece se ele não montar (o Postgres não deve subir com a pasta vazia);
  - **só uma pasta no disco principal:** sem isolamento nem ganho de desempenho; organiza os dados e facilita uma migração futura para um disco separado.

### 2. Imagens no GHCR: públicas ou privadas

Decidir se as imagens ficam públicas (o repositório já é público e as imagens não têm segredos) ou privadas. Se privadas: o servidor faz `docker login ghcr.io` com um token de acesso do GitHub só de leitura de pacotes (`read:packages`), guardado no servidor (fora do `.env` do app) e no gerenciador de senhas, com validade e renovação documentadas.

### 3. Modo demonstração da unidade Demo

As credenciais da Demo serão públicas. Criar um modo demonstração para a unidade:

- **bloqueado:** troca de senha e de e-mail, gestão de usuários, exclusões, configurações da empresa, chave PIX, impressão e **pedidos reais do cardápio digital**;
- **livre:** os fluxos de venda (pedidos, caixa, mesas, cozinha, entregas, relatórios);
- **faixa no painel:** "Ambiente de demonstração, restaurado toda noite";
- bloqueio no servidor (não só esconder botões), com mensagem em pt-BR, ligado por configuração da unidade.

### 4. Botão "copiar link do convite"

**Aprovado:** no painel da plataforma, ao lado do reenvio do convite.

### 5. Snapshots da VM

Documentar no DEPLOY.md os snapshots da Contabo: quando tirar (antes de mudanças grandes no servidor e de atualizações de versão do Postgres), limite do plano, como restaurar, e que snapshot **não substitui** o backup fora da VM.

### 6. Fuso horário

Servidor em **UTC**; todos os agendamentos (backup, monitoramento, restauração da demo, reinício de atualizações) definidos no **horário de Brasília** (ex.: `CRON_TZ=America/Sao_Paulo` ou timers do systemd com o fuso explícito), e documentados assim.

### 7. Senha do Dozzle

Gerada pelo `gen-secrets.sh`, junto com os outros segredos (hash no Caddy, senha no gerenciador de senhas).

### 8. Execução no servidor

Provavelmente feita pelo Claude por SSH, **com aprovação do Braian a cada passo**. Mesmo assim, o **DEPLOY.md precisa funcionar sozinho**, para qualquer pessoa seguir sem o Claude.
