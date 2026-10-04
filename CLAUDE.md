# CLAUDE.md — Plataforma de gestão para food service (nome provisório: GastroHub)

Memória do projeto para sessões do Claude Code. Mantenha este arquivo atualizado ao final de cada etapa.

> **Requisitos completos do produto:** [docs/PROMPT_INICIAL.md](docs/PROMPT_INICIAL.md) (texto integral do prompt inicial, incluindo escopo da Fase 1, seção 0.1 sobre o nome provisório e o que fica fora do escopo). Consulte-o antes de começar cada etapa; este CLAUDE.md resume decisões e convenções, não substitui os requisitos.

## Produto

SaaS de gestão para food service no Brasil (restaurantes, bares, lanchonetes, pizzarias, deliveries), no segmento de Saipos/Suitable.
Público: restaurantes pequenos e médios com salão, balcão e delivery. Interface em **pt-BR**; código, nomes e commits em **inglês**.

Padrões locais: BRL (`R$ 1.234,56`), fuso `America/Sao_Paulo`, CPF/CNPJ validados, CEP via ViaCEP, telefone com DDD, PIX como forma de pagamento de primeira classe.

## Nome do produto e identidade (nomes neutros)

O nome **GastroHub é provisório**. Nada no código, nos pacotes ou na infraestrutura depende dele:

- **Única fonte da marca:** `packages/shared/src/brand.ts` (`BRAND`: nome, slogan, logo, cores). Toda UI, e-mail e título do Swagger lê de lá. Nunca escrever o nome do produto em código, textos de tela ou testes.
- **Cores da marca:** `--primary`, `--primary-foreground` e `--ring` saem de `BRAND.colors` e são injetadas por `brandCssVariables()` no layout raiz de cada app. O tema base (`@app/ui/globals.css`) não define essas três variáveis.
- **Logo e favicon:** arquivos em `packages/ui/assets/brand/` (`logo.svg`, `favicon.svg`), copiados para `apps/{web,menu}/public/brand/` por `scripts/sync-brand-assets.mjs` antes do `dev`/`build` (cópias no .gitignore). `BRAND.logo.src` e `BRAND.favicon` apontam para `/brand/...`.
- **Pacotes:** escopo neutro `@app/*` (`@app/shared`, `@app/ui`, `@app/config`, `@app/api`, `@app/web`, `@app/menu`). Raiz: `app-monorepo`.
- **Infra:** projeto Compose `app` (containers `app-postgres-1` etc.), banco `app_db` / `app_db_test`, usuário `app`. Cookie de refresh `app_refresh`. Prefixo de log dos scripts `[app]`.
- **Ambiente:** `APP_NAME` (opcional, sobrescreve `BRAND.name` em e-mails e Swagger) e `MAIL_FROM_ADDRESS`.
- A pasta `D:\GastroHub_v2` e o repositório `gastrohub_v2` mantêm o nome original (não renomear sem pedido do usuário).

## Ambiente

- Windows, pasta `D:\GastroHub_v2` (raiz do monorepo — não criar subpasta).
- Repositório: https://github.com/longarayb/gastrohub_v2 (público), branch `main`.
- Node 24 LTS, pnpm via corepack, Docker Desktop (WSL2), Git.
- Scripts do `package.json` precisam funcionar em PowerShell e Git Bash: usar `cross-env`, `rimraf`, scripts Node em `scripts/`. Nada de `rm -rf`, `export`, `&&` dependente de shell Unix.
- Line endings: LF (`.gitattributes` + Prettier `endOfLine: "lf"`). `.ps1/.cmd` em CRLF.

## Fluxo Git

- Uma branch por etapa: `feat/auth-tenancy`, `feat/menu`, `feat/orders`, ...
- Commits pequenos em Conventional Commits (`feat(orders): ...`, `fix(api): ...`, `chore: ...`).
- Antes do merge: `pnpm lint && pnpm test && pnpm build` verdes. Merge na `main` (`--no-ff`) e push.
- **Nunca** `push --force` ou reescrever histórico sem confirmação do usuário.
- **Repositório público:** nunca commitar `.env`, segredos, tokens ou dados reais. Só `.env.example` com valores fictícios. Conferir `git diff --cached` antes de cada push.

## Stack

- Monorepo Turborepo + pnpm workspaces.
- `apps/api`: NestJS + Prisma (PostgreSQL) + Socket.IO + BullMQ (Redis) + Swagger em `/docs`.
- `apps/web`: Next.js (App Router) — painel admin, PDV, gestão de pedidos, mesas, KDS, relatórios.
- `apps/menu`: Next.js — cardápio digital público (`/{slug}`).
- `packages/shared`: schemas Zod, enums, tipos, utils (dinheiro, CPF/CNPJ, telefone, CEP) e **domínio puro** de cálculo.
- `packages/ui`: componentes shadcn/ui compartilhados.
- `packages/config`: tsconfig, eslint, prettier, tailwind preset.
- Testes: Vitest (unit + e2e da API com Supertest).

## Comandos

> Preenchidos/atualizados conforme as etapas forem entregues.

```powershell
corepack enable pnpm          # uma vez
pnpm install
pnpm bootstrap                # .env + docker + migrations + seed (primeira vez)
pnpm dev                      # sobe docker (postgres, redis, mailpit) + todas as apps
pnpm infra:up / infra:down    # apenas a infraestrutura Docker
pnpm db:migrate               # prisma migrate dev (criar migration: pnpm db:migrate --name x)
pnpm db:seed                  # dados de demonstração
pnpm lint | pnpm test | pnpm build | pnpm typecheck | pnpm format
pnpm test:e2e                 # e2e da API (banco app_db_test, requer Docker)
docker compose --profile full up --build   # tudo em containers
```

Validação completa antes de merge: `pnpm check` (build + typecheck + lint + test com `--concurrency=2`) + `pnpm format:check` + `pnpm test:e2e`.

> **Memória nesta máquina:** o limite de commit do Windows (RAM + pagefile) é baixo; muitos processos Node/Next/Edge em paralelo derrubam processos com código 0xC0000409 (-1073740791 / 3221226505). Use sempre `pnpm check` (concorrência 2), Next build com 2 workers (`NEXT_BUILD_CPUS`) e Playwright headless, um navegador, sem paralelismo. Pare os servidores de dev antes de rodar builds.

## Notas de toolchain (descobertas na fundação)

- **NestJS 12 é ESM-only**: a API usa `"type": "module"`, `module: NodeNext` e **imports relativos com extensão `.js`**. Build com SWC (`.swcrc`) para emitir metadata de decorators. Evite imports circulares entre arquivos com classes injetáveis (TDZ em ESM).
- **Prisma 7**: URL do banco em `apps/api/prisma.config.ts` (lê o `.env` da raiz), client gerado em `apps/api/src/generated/prisma` (gitignored, gerado no `postinstall`), conexão via `@prisma/adapter-pg`.
- **TypeScript 6**: `types` não é mais incluído por padrão — declare `"types": [...]` em cada tsconfig.
- **Validação**: pipe próprio `ZBody/ZQuery` + `ApiZodBody` em `apps/api/src/core/validation/zod.ts` (nestjs-zod não suporta Nest 12). Swagger via `z.toJSONSchema`.
- `.env` único na raiz; Next carrega via `loadEnvConfig` no `next.config.ts`; Nest via `ConfigModule` (`../../.env`).
- `pnpm-workspace.yaml` controla `allowBuilds` (scripts de install permitidos).
- Neste ambiente o PowerShell não herda o PATH novo: prefixe comandos com
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- Não editar arquivos via `Get-Content/Set-Content` no PS 5.1 (corrompe UTF-8).

## Regras importantes (não violar)

1. **Multi-tenant:** tenant = unidade (`Store`). Toda tabela de negócio tem `tenantId`. O filtro é aplicado **centralmente** pela Prisma Client Extension (`apps/api/src/core/prisma`) com o tenant do contexto da requisição (nestjs-cls). Nunca filtrar `tenantId` manualmente em queries; nunca usar o client "raw" fora de casos explícitos (auth, seed, cardápio público resolvendo o slug).
2. **Dinheiro em centavos (inteiros)** em todo o sistema (`priceCents`, `totalCents`). Formatação só na borda (UI) via `formatBRL` do `shared`.
3. **Regras de valores** (subtotal, descontos, taxas, total, troco, divisão de conta, preço de pizza, fechamento de caixa) ficam em `packages/shared/src/domain` como funções puras e testadas. O backend **sempre recalcula**; nunca confia em totais do cliente.
4. **Status do pedido:** `PENDING → ACCEPTED → PREPARING → READY → DISPATCHED → DELIVERED`; `CANCELED` a partir de qualquer etapa não final, exige motivo e permissão. Toda transição grava `OrderStatusHistory` (usuário + horário). Transições válidas definidas em `shared/domain/order-status.ts`.
5. **Transações** em operações críticas (criar/fechar pedido, pagamento, fechar caixa, numeração diária).
6. **Auditoria** (`AuditLog`) para cancelamentos, descontos e alterações de preço.
7. **Numeração diária** por unidade, baseada na data de negócio em `America/Sao_Paulo`.
8. Validação Zod compartilhada front/back. Erros da API no formato `{ code, message, details }` com mensagem em pt-BR.
9. Pontos de extensão (não implementar na Fase 1): `MarketplaceAdapter`, `FiscalProvider`, `PaymentGateway`, `TefProvider`, `PrintProvider`, `GeocodingProvider`, `StorageProvider`, `MailProvider`.

## Convenções de código (aprendidas nas etapas)

- **API:** tenancy via `@InjectDb() db: Db` (cliente com escopo). `PrismaService` (raw) só em auth, `Store` (o próprio tenant), seed e cardápio público. Em escritas de modelos de tenant use FKs escalares (`productId`), não `connect`. Novo modelo de negócio: `tenantId String @default(dbgenerated("current_setting('app.tenant_id'::text)"))` + incluir em `TENANT_MODELS` (há teste que falha se esquecer).
- **Migrations:** `pnpm db:migrate --name <nome>`; confira drift com `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`.
- **Erros de negócio:** lance `DomainError`/`NotFoundError`/`ConflictError`/... com mensagem em pt-BR; nunca `HttpException` com texto em inglês.
- **Auditoria:** `AuditService.log({ action, entity, entityId, before, after, reason }, tx?)`.
- **Frontend — formulários:** `useZodForm(schema, defaults)` + `TextField`/`MaskedField`/`NumberField`/`MoneyField`/`PercentField` (`apps/web/src/components/form.tsx`). Validação no primeiro submit e depois a cada mudança (validar no blur engolia cliques em links). Erros 400 da API vão para os campos com `applyApiErrors`.
- **Frontend — rotas e permissões:** cada item de menu em `components/shell/nav.ts` declara `permissions`; `lib/routes.ts` deriva daí `canAccess` (tela de acesso negado no layout), `homeFor` e `safeNext` (valida `?next=`, evita open redirect). Nova tela protegida = novo item no `NAV`.
- **Frontend — dados:** TanStack Query; chaves por módulo (`storeKeys`); `api()` faz refresh automático em 401. Access token só em memória.
- **Teste visual das telas:** script Playwright fora do repo (scratchpad) contra o build de produção (`node dist/main.js` + `node .next/standalone/apps/web/server.js` com `.next/static` copiado). Edge headless, um navegador, sem paralelismo.

## Estrutura

```
apps/api      apps/web      apps/menu
packages/shared  packages/ui  packages/config
docs/ARQUITETURA.md  docs/DECISOES.md  docs/ROADMAP.md
scripts/      docker/       docker-compose.yml
```

## Papéis (RBAC)

`OWNER` (Dono), `MANAGER` (Gerente), `CASHIER` (Caixa), `WAITER` (Garçom), `KITCHEN` (Cozinha), `COURIER` (Entregador). Matriz de permissões em `packages/shared/src/auth/permissions.ts`, usada pelo backend (guard) e pelo frontend (esconder ações).

## Status atual

Ver `docs/ROADMAP.md`.
