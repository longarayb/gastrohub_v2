# Instalação em um computador Windows novo

Passo a passo para deixar um Windows 10/11 recém-instalado pronto para desenvolver o projeto, do zero até o painel aberto no navegador. Tempo estimado: 40–60 minutos (a maior parte é download).

> Os comandos são para o **PowerShell**. Quando o passo pedir **PowerShell como administrador**, abra o menu Iniciar, digite "PowerShell", clique com o botão direito → "Executar como administrador".

## 1. Ativar a virtualização (necessária para o Docker)

1. Abra o **Gerenciador de Tarefas** (Ctrl+Shift+Esc) → **Desempenho** → **CPU**. Se aparecer **Virtualização: Habilitado**, pule para o passo 2.
2. Se estiver desabilitado, reinicie o computador e entre na BIOS/UEFI (geralmente F2, F10, Del ou Esc logo ao ligar; em notebooks, consulte o fabricante).
3. Ative a opção **Intel Virtualization Technology (VT-x)** ou **AMD SVM / AMD-V** (costuma ficar em *Advanced*, *CPU Configuration* ou *Security*). Salve e reinicie.
4. Instale o WSL2 (PowerShell como administrador) e reinicie quando ele pedir:

   ```powershell
   wsl --install
   ```

## 2. Ajustar o arquivo de paginação (memória virtual)

Builds do Next.js, testes e o navegador ao mesmo tempo esgotam o limite de memória do Windows em máquinas com pouca RAM (processos morrem com o código `0xC0000409`). Aumente a memória virtual:

1. Tecla Windows → digite **"Exibir configurações avançadas do sistema"** → aba **Avançado** → em *Desempenho*, **Configurações...** → aba **Avançado** → em *Memória virtual*, **Alterar...**
2. Desmarque **"Gerenciar automaticamente o tamanho do arquivo de paginação"**.
3. Selecione a unidade **C:** → **Tamanho personalizado**: inicial **8192** MB, máximo **24576** MB (ou cerca de 3× a RAM) → **Definir** → **OK**.
4. Reinicie o computador.

Opcional, para limitar a memória que o Docker/WSL reserva: crie `C:\Users\<seu-usuário>\.wslconfig` com:

```ini
[wsl2]
memory=3GB
swap=2GB
```

## 3. Liberar scripts no PowerShell

O `pnpm` e outros comandos instalam scripts `.ps1`. Em um PowerShell normal (não precisa ser administrador):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Responda **S** (Sim) se perguntar.

## 4. Instalar as ferramentas

Em um **PowerShell como administrador** (o `winget` já vem no Windows 10/11 atualizado):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
```

Se preferir baixar os instaladores:

| Ferramenta | Versão usada | Link |
|---|---|---|
| Git for Windows | 2.4x+ (testado com 2.55) | https://git-scm.com/download/win |
| Node.js LTS | **24** (testado com 24.19) | https://nodejs.org/pt-br/download |
| Docker Desktop | com backend WSL2 (testado com 29.8) | https://www.docker.com/products/docker-desktop/ |
| Claude Code | atual | https://docs.claude.com/en/docs/claude-code/setup |

**Feche e abra o PowerShell** depois de instalar (para recarregar o PATH). Se um comando recém-instalado não for encontrado, rode:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

### pnpm via corepack

Ainda no **PowerShell como administrador** (o corepack grava na pasta do Node em *Arquivos de Programas*):

```powershell
corepack enable pnpm
```

A versão exata do pnpm (12) vem do campo `packageManager` do `package.json`; o corepack baixa sozinho na primeira execução.

### Docker Desktop

1. Abra o **Docker Desktop**, aceite os termos e espere o ícone da baleia ficar estável ("Engine running").
2. Em *Settings → General*, deixe marcado **Use the WSL 2 based engine**.
3. Opcional: *Settings → General → Start Docker Desktop when you sign in*.

### Claude Code

Em um PowerShell normal:

```powershell
irm https://claude.ai/install.ps1 | iex
```

(Alternativa: `npm install -g @anthropic-ai/claude-code`.) Depois rode `claude` e faça login. No VS Code, instale também a extensão **Claude Code**. Ao abrir a sessão na pasta do projeto, peça para ler `docs/HANDOFF.md` (o `CLAUDE.md` já aponta para ele).

Confira as versões:

```powershell
git --version; node -v; pnpm -v; docker --version
```

## 5. Clonar o repositório

Use a mesma pasta da máquina original (o `CLAUDE.md` cita `D:\GastroHub_v2`; se não houver disco D:, qualquer pasta sem espaços serve):

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
git config --global core.autocrlf false
git clone https://github.com/longarayb/gastrohub_v2.git D:\GastroHub_v2
cd D:\GastroHub_v2
```

> `core.autocrlf false`: o repositório controla as quebras de linha pelo `.gitattributes` (LF; `.ps1/.cmd` em CRLF).

## 6. Criar o `.env`

```powershell
Copy-Item .env.example .env
```

Os valores do `.env.example` são de **desenvolvimento** e funcionam sem alteração (banco `app_db`, usuário `app`/`app_dev`, Redis e Mailpit locais, segredos JWT fictícios). Nunca commite o `.env`.

As portas do Docker no computador (`POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`) vêm do `.env` e as URLs as seguem (`DATABASE_URL=...localhost:${POSTGRES_PORT}/...`). Se alguma estiver ocupada nesta máquina, veja "Problemas comuns".

## 7. Instalar dependências

```powershell
pnpm install
```

O `postinstall` gera o Prisma Client. Se aparecer aviso de "build scripts ignorados", os permitidos já estão em `pnpm-workspace.yaml` (`allowBuilds`).

## 8. Subir o Docker, rodar migrations e seed

Com o Docker Desktop aberto, um comando faz tudo (sobe Postgres, Redis e Mailpit, aplica as migrations, compila os pacotes compartilhados e popula o seed):

```powershell
pnpm bootstrap
```

Equivalente, passo a passo:

```powershell
pnpm infra:up                          # Postgres, Redis e Mailpit (cria também app_db_test)
pnpm --filter @app/api db:deploy       # gera o Prisma Client e aplica as migrations
pnpm turbo run build --filter=./packages/*
pnpm db:seed                           # unidade de demonstração (pode rodar de novo quando quiser)
```

## 9. Rodar o projeto

**Modo leve (recomendado nesta máquina):** builds de produção da API e do painel, sem watchers nem hot reload. Recompila só o que mudou.

```powershell
pnpm start:lite
```

Outros modos:

| Comando | Quando usar |
|---|---|
| `pnpm start:lite` | Navegar e testar telas gastando pouca memória (API 3333 + painel 3000) |
| `pnpm dev:lite` | Desenvolver com hot reload só da API e do painel (sem o cardápio digital); rode `pnpm infra:up` antes |
| `pnpm dev` | Tudo em modo watch (API, painel e cardápio digital); o mais pesado |

Para parar: **Ctrl+C** no terminal. Para desligar os containers sem apagar dados: `docker compose stop`.

## Links

| Serviço | URL |
|---|---|
| Painel (pedidos, mesas, cardápio, configurações) | http://localhost:3000 |
| API (Swagger) | http://localhost:3333/docs |
| Health check da API | http://localhost:3333/api/health |
| Mailpit (e-mails de desenvolvimento, ex.: recuperação de senha) | http://localhost:8025 |
| Cardápio digital (só com `pnpm dev`; por enquanto só a página inicial, a rota `/demo` vem na etapa `feat/digital-menu`) | http://localhost:3001 |

## Credenciais de demonstração

Criadas pelo `pnpm db:seed`. **Apenas para desenvolvimento.** Unidade **Demo** (slug `demo`), senha de todos: `Demo1234`.

| Papel | E-mail | Tela inicial |
|---|---|---|
| Dono | `dono@demo.local` | Painel |
| Gerente | `gerente@demo.local` | Painel |
| Caixa | `caixa@demo.local` | Pedidos |
| Garçom | `garcom@demo.local` | Pedidos |
| Cozinha | `cozinha@demo.local` | Pedidos |
| Entregador | `entregador@demo.local` | Minhas entregas (só a própria rota; abra no celular) |

Cupons de demonstração: `BEMVINDO10` (10%, até R$ 20) e `FRETEGRATIS` (R$ 8 acima de R$ 50).

Caixa de demonstração: a **Caixa** já entra com o caixa aberto (troco inicial R$ 200); o caixa do **Gerente** da manhã está fechado com diferença de −R$ 2,50. Há um delivery entregue "a receber" e um pedido do iFood pago online. A chave PIX de demonstração (`pix@demo.local`) gera QR Codes válidos que não pagam ninguém — troque na tela Empresa por uma chave real só em produção.

Entregas: 4 áreas ("Pinheiros" suspensa por chuva), o Gustavo (usuário `entregador@demo.local`) em rota com uma entrega, a Helena de volta com uma entrega em dinheiro e uma não entregue esperando o **acerto** (Caixa ou Entregadores), e bairros sem área na tela Áreas de entrega. A geocodificação usa o Nominatim público (`GEOCODING_PROVIDER=nominatim`; `none` desliga), só quando uma área por raio precisa das coordenadas.

Tela da cozinha: abra http://localhost:3000/kds com o login da **Cozinha** (ou de qualquer papel com acesso ao KDS), ou vincule um tablet sem senha: em **Cardápio › Setores de produção › Telas da cozinha**, gere o código da "TV da cozinha" e digite-o em http://localhost:3000/kds/vincular (código da unidade: `demo`).

## Conferir se está tudo certo

```powershell
pnpm check          # imports versionados + build + typecheck + lint + testes unitários (concorrência 2)
pnpm format:check
pnpm test:e2e       # e2e da API (banco app_db_test; requer Docker)
```

Roteiros visuais com Playwright (opcional): veja [tools/ui-walkthrough/README.md](../tools/ui-walkthrough/README.md).

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `Docker não está rodando` | Abra o Docker Desktop e espere "Engine running" |
| `pnpm` não é reconhecido | Rode `corepack enable pnpm` como administrador e reabra o PowerShell |
| "a execução de scripts foi desabilitada" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Processo morre com `0xC0000409` / `3221226505` | Pouca memória: aumente o arquivo de paginação (passo 2), feche o navegador e use `pnpm start:lite`. No `.env` da máquina, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1` deixam `pnpm check` e o build do Next em série |
| `port is already allocated` (5432, 6379, 1025 ou 8025) no `pnpm infra:up`/`bootstrap` | Outro serviço usa a porta (outro projeto Docker, Postgres/Redis instalado no Windows). Descubra com `docker ps` ou `Get-NetTCPConnection -LocalPort 5432 \| Select OwningProcess`. Em vez de parar o outro serviço, mude a porta **só nesta máquina**, no `.env`: `POSTGRES_PORT=5433` (ou `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`). `DATABASE_URL`, `REDIS_URL` e `SMTP_PORT` usam essas variáveis (`${POSTGRES_PORT}`), então nada mais muda. Depois: `pnpm infra:down` e `pnpm infra:up`. O `.env.example` fica com as portas padrão |
| Porta 3000/3333 em uso | Um servidor antigo ficou aberto: `Get-NetTCPConnection -LocalPort 3000 \| Select OwningProcess` e `Stop-Process -Id <pid>` |
| Taxa de entrega pede "escolha a área manualmente" | O endereço não está em nenhuma área por bairro e o mapa não o encontrou (ou o Nominatim está fora/sem internet). Escolha a área no pedido, ou inclua o bairro numa área em Áreas de entrega ("Bairros sem área") |
| Login responde 429 | Limite de tentativas de login por minuto e IP (`LOGIN_RATE_LIMIT_PER_MINUTE`: 10 em produção; 300 no `.env.example` de desenvolvimento). Espere 1 minuto ou reinicie a API; se o seu `.env` é antigo, acrescente a variável |
