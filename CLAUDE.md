# CLAUDE.md — Plataforma de gestão para food service (nome provisório: GastroHub)

Memória do projeto para sessões do Claude Code. Mantenha este arquivo atualizado ao final de cada etapa.

> **Comece por [docs/HANDOFF.md](docs/HANDOFF.md):** estado atual, decisões recentes e os próximos passos exatos. Instalação em máquina nova: [docs/SETUP.md](docs/SETUP.md).

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
- A pasta `GastroHub_v2` e o repositório `gastrohub_v2` mantêm o nome original (não renomear sem pedido do usuário).

## Ambiente

- Windows, pasta raiz do monorepo (não criar subpasta): `C:\GastroHub_v2` no Surface, `D:\GastroHub_v2` no desktop de casa (ver "Trabalho em várias máquinas").
- Portas do Docker no host vêm do `.env` de cada máquina (`POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`; padrão 5432/6379/1025/8025 no `.env.example`); `DATABASE_URL`, `REDIS_URL` e `SMTP_PORT` as referenciam com `${...}`. Quem lê o `.env` precisa expandir variáveis: Next (`@next/env`) já expande; na API, use `expand(loadEnv(...))` do `dotenv-expand` e `expandVariables: true` no `ConfigModule`. Nunca troque a porta no `.env.example` para resolver conflito de uma máquina.
- Repositório: https://github.com/longarayb/gastrohub_v2 (público), branch `main`.
- Node 24 LTS, pnpm via corepack, Docker Desktop (WSL2), Git.
- Scripts do `package.json` precisam funcionar em PowerShell e Git Bash: usar `cross-env`, `rimraf`, scripts Node em `scripts/`. Nada de `rm -rf`, `export`, `&&` dependente de shell Unix.
- Line endings: LF (`.gitattributes` + Prettier `endOfLine: "lf"`). `.ps1/.cmd` em CRLF.

## Trabalho em várias máquinas (seguir sempre)

O usuário alterna o projeto entre dois computadores, **um por vez**: o **Surface** durante o dia e o **desktop de casa** à noite. O GitHub é a única ponte entre eles.

| Máquina | Pasta | `.env` local | Memória |
|---|---|---|---|
| Surface (hostname `Infra`) | `C:\GastroHub_v2` | `POSTGRES_PORT=5433` (outro projeto Docker, `C:\GastroHub`, usa a 5432), `CHECK_CONCURRENCY=1`, `NEXT_BUILD_CPUS=1` | 8 GB: concorrência 1 em testes e build. **Smart App Control ligado bloqueia o pnpm** (desde 2026-10-08): não desligar nem contornar; ver HANDOFF e SETUP (alternativa: WSL) |
| Desktop de casa | `D:\GastroHub_v2` | portas padrão | concorrência padrão (2) |

- **Ao iniciar uma sessão:** `git fetch`, `git pull` da branch atual e da `main` (sem reescrever histórico; se houver conflito ou divergência, parar e avisar o usuário) e ler `docs/HANDOFF.md`.
- **Quando o usuário disser que vai trocar de computador ou encerrar o dia:**
  1. Commit e push de **todas** as branches com trabalho (nada fica só local; o `.env` nunca vai para o git).
  2. `docs/HANDOFF.md` atualizado: o que foi feito, o que está em andamento (branch e ponto exato), os próximos passos exatos e as pendências de decisão do usuário. Commit e push dele também.
  3. Parar servidores de dev e containers **sem apagar volumes**: `pnpm infra:down` (equivale a `docker compose down`, que preserva os volumes). Nunca `docker compose down -v`.
- **Nunca trabalhar direto na `main`:** todo trabalho em branch (`feat/`, `fix/`, `chore/`, `docs/`); a `main` só recebe merge `--no-ff`.
- **Frentes em paralelo:** se houver mais de uma branch em andamento, o `HANDOFF.md` ganha a seção "Frentes em andamento", com cada branch, seu estado e **qual delas pode alterar o schema do Prisma** (só uma por vez, para não gerar migrations conflitantes).

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
- `apps/print-agent`: agente de impressão local (serviço do Windows, ESC/POS), empacotado como executável único com instalador.
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
pnpm start:lite               # modo leve: builds de produção da API (3333) e do painel (3000), sem watchers
pnpm start:lite --menu        # idem, com o cardápio digital (3001; demo em http://localhost:3001/demo)
pnpm start:lite --menu --lan  # idem, acessível pelo celular na mesma rede (pnpm lan:links mostra os links)
pnpm dev --lan                # desenvolvimento acessível pelo celular (o pnpm dev comum compila com localhost)
pnpm tunnel:menu              # túnel HTTPS temporário (30 min) só para testar a prévia do link no WhatsApp
pnpm dev:lite                 # watch só de API, painel e pacotes (sem o cardápio digital); rode infra:up antes
pnpm --filter @app/print-agent build && pnpm --filter @app/print-agent start:virtual   # agente de impressão virtual (página em 127.0.0.1:9180)
pnpm infra:up / infra:down    # apenas a infraestrutura Docker
pnpm db:migrate               # prisma migrate dev (criar migration: pnpm db:migrate --name x)
pnpm db:seed                  # dados de demonstração
pnpm lint | pnpm test | pnpm build | pnpm typecheck | pnpm format
pnpm test:e2e                 # e2e da API (banco app_db_test, requer Docker)
docker compose --profile full up --build   # tudo em containers
```

Validação completa antes de merge: `pnpm check` (imports versionados + build + typecheck + lint + test; concorrência do Turborepo em `CHECK_CONCURRENCY`, padrão 2) + `pnpm format:check` + `pnpm test:e2e` (arquivos sempre em série).

> **Memória:** as duas máquinas têm pouca memória para muitos processos Node/Next/Edge em paralelo; o Windows derruba processos com código 0xC0000409 (-1073740791 / 3221226505). No Surface (8 GB), o `.env` tem `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`; não sobrescreva. Playwright sempre headless, um navegador, sem paralelismo. Pare os servidores de dev antes de rodar builds.

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
- **Cardápio:** preço e snapshot do item só por `priceMenuItem` (shared); grupos efetivos por `effectiveModifierLinks`; disponibilidade por `getProductAvailability`; "Acabou" = `MenuContext.pauseState({ mode: 'END_OF_DAY' })` (fim do dia de negócio). Alteração de preço exige `prices:manage` e grava `product.price_changed` na auditoria. Pausar exige só `menu:pause` (caixa e cozinha podem).
- **Pedidos:** toda mudança envia `expectedVersion` (409 = alterado por outra pessoa; o front recarrega). Criação com `Idempotency-Key` (uma chave por pedido em digitação). Preço de item só por `priceCatalogItem` (shared), igual na API e no compositor. Eventos de tempo real são notificações emitidas após o commit; o front invalida as queries (`orderKeys`). Mutations de pedido no front via `useOrderAction` (atualiza cache, mostra erro, trata 409).
- **Tema:** cores, raios e larguras só por tokens (`globals.css` → `@theme inline`): `status-*` para status de pedido (`STATUS_STYLES` em `lib/orders.ts`), `w-kanban-column`. Nada de cores soltas nas telas (redesign = trocar o tema).
- **Socket.IO:** versão fixada por `overrides` no `pnpm-workspace.yaml` (evita tipos duplicados com `@nestjs/platform-socket.io`). O Nest chama `RedisIoAdapter.close()` uma vez por entrada de servidor (raiz e namespace), em paralelo: o encerramento é memoizado para dar `quit` nos clientes Redis uma única vez (senão os `UNSUBSCRIBE` do adapter viram rejeições não tratadas).
- **Consultas dentro de `$transaction`:** sempre em sequência (nada de `Promise.all` nem consulta sem `await` com o `tx`). O Prisma 7 carrega as relações de um `include` em paralelo, e numa transação todas usam a mesma conexão: leitura com **duas ou mais relações** dentro de transação vai por `findFirstSequential` (`core/prisma/sequential.ts`), que lê uma relação por vez. O e2e reprova qualquer consulta enfileirada numa conexão ocupada (`test/setup-env.ts`, mostra as duas SQLs); o `pg` 9 transformará isso em erro.
- **Redis/BullMQ:** passe opções de conexão (`{ url }`), nunca uma instância `ioredis` — o BullMQ só fecha conexões que ele mesmo cria.
- **Erros não tratados:** `main.ts` registra `unhandledRejection`/`uncaughtException` no logger com stack completo. No e2e, `test/setup-env.ts` reprova o teste em que o erro ocorreu (ou o arquivo, se vier do `app.close()`). Para caçar vazamentos: `npx vitest run --project e2e --detectAsyncLeaks` em `apps/api` (restam 1 `AsyncResource.bind` do Throttler por arquivo e, às vezes, uma promessa interna do BullMQ — benignos).
- **Caixa e pagamentos (D023–D024):** pagamento e estorno só pelo `PaymentsService` (módulo `cash`). Todo pagamento, estorno ou movimento trava o caixa aberto com `CashService.lockOpenSession` (incrementa a `version`). `paidCents`/`paymentStatus` sempre via `paymentSummaryOf`. `OrdersService.recalculate` recusa total abaixo do pago. `ONLINE` (app/marketplace) não usa caixa. Fechar mesa/balcão exige saldo zero (`closeError`); delivery pode ficar "a receber".
- **Operações de mesa (D025):** `TabsService` (mover itens entre contas, transferir conta, trocar/juntar/separar mesas, pré-conta). Mudanças em contas de outra sessão incrementam a `version` dessas contas.
- **Cozinha (D027):** tarefas de produção só pelo `ProductionService` (módulo de pedidos): `createForItems` no envio da rodada, `cancelItems`/`cancelOrder`, `completeOrder` quando o pedido sai, `moveWithItem`/`splitWithItem` ao mover itens e `sync` (status do item e do pedido) depois de qualquer mudança — sempre **depois** do `updateVersioned` com `expectedVersion`, porque o `sync` pode incrementar a versão. Roteamento só por `routeItem` (shared), igual na API, no seed e na futura impressão.
- **Telas da cozinha (D028):** papel interno `KDS_DEVICE` (`ActorRole`, nunca membership), com `ctx.deviceId` em vez de `ctx.userId`; rotas sem `@RequirePermissions` recusam dispositivos. No painel, `/kds` tem layout próprio (fora do `(app)`), escuro; o token do dispositivo é `setDeviceSession` em `lib/api.ts` (tem prioridade e se renova pelo cookie).
- **Entregas (D029–D031):** área e taxa só pelo `DeliveryPricingService` (módulo de pedidos): `locate` (geocodificação) **fora** da transação, `apply` dentro, depois do `recalculate`. Saída, parada, entregue e não entregue só pelo `DispatchService`; `OrdersService.dispatchInTx` é a única porta para `DISPATCHED` com vários pedidos (kanban e KDS). Acerto e pagamentos ao entregador no módulo `delivery` com `CashService.lockOpenSession` (exportado pelo `CashModule`). O geocodificador recebe só o endereço (LGPD) e é `none` nos testes. O entregador (`courier:app`) só acessa `/courier/*` e vê a própria saída aberta. Eventos `delivery.updated` são emitidos pelo `OrdersService.publish` em pedidos de delivery.
- **Cardápio digital (D032–D034):** rotas públicas em `/public/:slug/...` (`@Public()` + `PublicStoreGuard`, que resolve o slug pelo client raw e monta o tenant); o resto usa os serviços de sempre. O cliente nunca define preço: prévia e pedido são calculados no servidor (`PublicMenuService.evaluate`). Pedido do cardápio = `OrdersService.create` com `source: 'DIGITAL_MENU'`. Acompanhamento só por `trackingToken` (sem dados pessoais) e namespace `/tracking`. A marca no `apps/menu` é a do restaurante (`storeCssVariables`); a nossa só no "feito com". **Bundle do celular:** não importe schemas Zod nem libs pesadas em componentes do `apps/menu`; regra pura usada no navegador não pode morar num arquivo de schema (o `z.object` no topo do módulo entra no bundle). Mudanças em cardápio/loja/áreas atualizam o cache do cardápio pelo `MenuRevalidationInterceptor`.
- **Impressão (D035–D037):** trabalho de impressão só pelo `PrintQueueService` (módulo `printing`, importado pelo de pedidos): `orderTickets` (pedido aceito e rodadas enviadas, só as rodadas passadas), `deliveryCopy` (aceite do delivery) e `canceled` (reescreve a comanda que não saiu ou gera "CANCELADO"), sempre **dentro da transação** e depois do `updateVersioned`; os agentes são avisados depois do commit pelo `flush()` (o `OrdersService.publish` já chama). Automáticos com `dedupeKey` (nunca duplicam); manuais e 2ª via sem chave, com `reprintOfId` e auditoria. Documentos só pelas funções puras de `shared/printing/documents.ts` (prévia do painel = o que o agente imprime). O agente (`apps/print-agent`) é bundle esbuild sem Zod (constantes de impressora ficam em `domain/printing.ts`, não no arquivo de schema); papel `PRINT_AGENT` só acessa `/print-agent/*` e a sala `print-agent:{id}`. Meta de memória do agente: até 80 MB.
- **Relatórios (D038):** definições só em `shared/domain/reports.ts` (faturamento, conciliação, comparação, ABC, durações) e textos do ⓘ em `REPORT_HELP`. Pedido conta pelo `closedBusinessDate` (gravado no `changeStatus` ao concluir ou cancelar); pagamento e estorno pelo `businessDate`/`refundBusinessDate` (dia do caixa, ou o corrente se online) — novo ponto que cria pagamento ou estorno precisa gravá-los. Para filtrar instantes por período de dias de negócio use `businessDayWindow` (no banco) ou `businessDateResolver` (em memória), nunca `currentBusinessDay` por linha. Agregue no banco (`groupBy`/`aggregate`) em períodos longos. Visão da rede = calcular cada unidade com `TenantContext.run` e somar. Componentes do dashboard em `components/reports` seguem docs/DESIGN.md só com tokens.
- **Seed com histórico:** `prisma/seed/history.ts` monta tudo em memória com as funções puras e insere em lote (`jsonb_populate_recordset`); determinístico (semente fixa). Ao criar coluna obrigatória num modelo do histórico, preencha-a lá também. `HISTORY_DAYS=365` para medir desempenho.
- **Frontend — PDV:** atalhos com `useHotkeys` (`lib/hotkeys.ts`; teclas comuns não disparam enquanto se digita). Impressão com `PrintPortal` (renderiza em `.print-area`, largura `w-receipt`); QR Code com `QrCode` (tokens `qr-*`, sempre escuro no claro). Formulário com dados assíncronos: monte-o depois que os dados chegarem (`form.reset` em `useEffect` não alcança campos montados no mesmo ciclo).
- **Rotas tipadas do Next:** ao criar uma página nova, rode `npx next typegen` em `apps/web` antes do `tsc`, senão `href="/nova-rota"` não compila.
- **Roteiros visuais:** feche um diálogo de cada vez esperando a animação (`closeDialog`/`closeAll` em `pos.mjs`); dois `Escape` seguidos perdem o segundo. O limite de login vem de `LOGIN_RATE_LIMIT_PER_MINUTE` (produção: 10, o padrão; o `.env` de desenvolvimento usa 300 para os roteiros rodarem em sequência). O `kds.mjs` instrumenta o `AudioContext` para conferir os sons.
- **Imagens:** sempre via `ImageService` (WebP); o banco guarda chaves (`imageKey`), nunca URLs.
- **Seed:** `apps/api/prisma/seed` (re-executável; usa o client raw com `tenantId` explícito). Ao criar uma tabela de tenant nova, inclua-a em `TENANT_TABLES` do seed.
- **.gitignore:** regras de pastas genéricas devem ser ancoradas na raiz (`/storage/`); `pnpm check` falha se um arquivo versionado importar um arquivo não versionado (`scripts/check-tracked-imports.mjs`).
- **Teste visual das telas:** roteiros Playwright em `tools/ui-walkthrough/` (fora do workspace pnpm; `npm install` na pasta) contra o build de produção (`pnpm start:lite`) e o seed. Edge headless, um navegador, sem paralelismo. Ao criar uma etapa com telas, acrescente um roteiro novo ali.

## Estrutura

```
apps/api      apps/web      apps/menu
packages/shared  packages/ui  packages/config
docs/ARQUITETURA.md  docs/DECISOES.md  docs/ROADMAP.md  docs/DESIGN.md
scripts/      docker/       docker-compose.yml
```

## Papéis (RBAC)

`OWNER` (Dono), `MANAGER` (Gerente), `CASHIER` (Caixa), `WAITER` (Garçom), `KITCHEN` (Cozinha), `COURIER` (Entregador). Matriz de permissões em `packages/shared/src/auth/permissions.ts`, usada pelo backend (guard) e pelo frontend (esconder ações).

## Status atual

Ver `docs/ROADMAP.md`.
