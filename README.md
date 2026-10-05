# GastroHub V2 (nome provisório)

> O nome do produto é provisório e fica centralizado em [packages/shared/src/brand.ts](packages/shared/src/brand.ts). Pacotes (`@app/*`), banco (`app_db`) e containers usam nomes neutros.

Sistema SaaS de gestão para restaurantes, bares, lanchonetes, pizzarias e deliveries no Brasil: cardápio, pedidos em tempo real, salão e mesas, PDV/caixa, KDS (cozinha), delivery e cardápio digital.

> Em desenvolvimento — Fase 1 (MVP). Veja [docs/ROADMAP.md](docs/ROADMAP.md).

> Computador novo? Siga o passo a passo completo em [docs/SETUP.md](docs/SETUP.md).

## Pré-requisitos (Windows)

| Ferramenta | Versão | Instalação |
|---|---|---|
| Node.js | 24 LTS | `winget install OpenJS.NodeJS.LTS` |
| pnpm | 12 (via corepack) | `corepack enable pnpm` |
| Docker Desktop | com backend WSL2 | `wsl --install` e `winget install Docker.DockerDesktop` |
| Git | 2.4x+ | `winget install Git.Git` |

> Funciona igualmente no PowerShell e no Git Bash. Os scripts não dependem de shell Unix.

## Primeiros passos

```powershell
git clone https://github.com/longarayb/gastrohub_v2.git
cd gastrohub_v2
corepack enable pnpm
pnpm install
pnpm bootstrap  # cria .env, sobe Postgres/Redis/Mailpit, aplica migrations e popula o seed
pnpm dev        # sobe a infraestrutura e todas as apps em modo watch
```

| Serviço | URL |
|---|---|
| Painel / PDV / KDS (`apps/web`) | http://localhost:3000 |
| Cardápio digital (`apps/menu`) | http://localhost:3001 |
| API REST (`apps/api`) | http://localhost:3333/api |
| Swagger | http://localhost:3333/docs |
| Mailpit (e-mails de dev) | http://localhost:8025 |

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe Docker (Postgres, Redis, Mailpit), aplica migrations e roda api/web/menu com hot reload |
| `pnpm start:lite` | Modo leve: builds de produção da API e do painel, sem watchers (recomendado com pouca memória) |
| `pnpm dev:lite` | Hot reload só da API, do painel e dos pacotes (sem o cardápio digital) |
| `pnpm infra:up` / `pnpm infra:down` | Sobe/derruba só a infraestrutura Docker |
| `pnpm build` | Build de todos os pacotes |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm test` | Testes unitários (Vitest) |
| `pnpm test:e2e` | Testes e2e da API (requer Docker rodando) |
| `pnpm db:migrate` | Cria/aplica migration em desenvolvimento (`prisma migrate dev`) |
| `pnpm db:seed` | Popula dados de demonstração |
| `pnpm db:reset` | Recria o banco do zero (apaga dados!) |
| `pnpm db:studio` | Abre o Prisma Studio |
| `pnpm format` | Formata o código com Prettier |

### Infraestrutura local

| Item | Valor (apenas desenvolvimento) |
|---|---|
| Containers | `app-postgres-1`, `app-redis-1`, `app-mailpit-1` |
| Banco | `app_db` (testes e2e: `app_db_test`), usuário `app` / senha `app_dev` |

### Tudo em containers

```powershell
docker compose --profile full up --build
```

## Estrutura

```
apps/api       API NestJS (REST + WebSocket), Prisma, BullMQ
apps/web       Painel administrativo, PDV, gestão de pedidos, mesas, KDS (Next.js)
apps/menu      Cardápio digital público (Next.js)
packages/shared  Tipos, schemas Zod, utils BR (moeda, CPF/CNPJ, telefone, CEP) e regras de cálculo
packages/ui      Componentes shadcn/ui compartilhados e tema (claro/escuro)
packages/config  tsconfig e ESLint compartilhados
docs/          Arquitetura, decisões técnicas e roadmap
```

## Credenciais de demonstração

Criadas por `pnpm db:seed` (ou `pnpm bootstrap`). São **apenas para demonstração** — nunca use em produção.

Unidade: **GastroHub Demo** (`${BRAND.name} Demo`, slug `demo`). Senha de todos os usuários: `Demo1234`

| Papel | E-mail |
|---|---|
| Dono | `dono@demo.local` |
| Gerente | `gerente@demo.local` |
| Caixa | `caixa@demo.local` |
| Garçom | `garcom@demo.local` |
| Cozinha | `cozinha@demo.local` |
| Entregador | `entregador@demo.local` |

O seed pode ser rodado de novo: ele apaga e recria apenas a unidade de demonstração. Cardápio incluído: lanches com complementos herdados (e um produto que desliga um grupo herdado), combos com bebida (opção que referencia produto), porções e bebidas por tamanho, pizzas de 1 a 4 sabores com borda com preço por tamanho, sobremesas, almoço executivo só em dias úteis no almoço e um item pausado ("Onion rings"). Caixa e pagamentos: a operadora Caixa já tem o caixa aberto, o caixa do Gerente está fechado com diferença, há um delivery "a receber", um pedido do iFood pago online, uma conta de mesa paga pela metade e uma chave PIX fictícia (`pix@demo.local`). Cozinha: tarefas de produção em todos os estados (o combo leva a bebida para o bar) e uma "TV da cozinha" aguardando vínculo; abra `/kds` com o login da Cozinha.

Pedidos do dia de negócio atual em todos os status (balcão, delivery e mesa): pendentes do cardápio digital e do iFood, uma mesa dupla com duas contas e duas rodadas, uma conta com itens não enviados, um pedido cancelado com motivo e uma conta fechada sem taxa de serviço. Também: 12 mesas em 2 áreas, clientes com endereço, entregadores e os cupons `BEMVINDO10` e `FRETEGRATIS`.

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- [docs/DECISOES.md](docs/DECISOES.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/SETUP.md](docs/SETUP.md) (instalação em computador novo)
- [docs/HANDOFF.md](docs/HANDOFF.md) (estado atual e próximos passos)
