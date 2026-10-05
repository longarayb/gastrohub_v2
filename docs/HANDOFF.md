# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-04**, ao fim da etapa `feat/orders`. A máquina de desenvolvimento vai mudar: o próximo ambiente é um **clone novo** (instalação em [SETUP.md](SETUP.md)).

## Estado atual

- `main` contém tudo o que foi feito até agora; todas as branches estão no GitHub (`longarayb/gastrohub_v2`, público).
- Validação no último commit: `pnpm check` verde (18 tarefas; testes unitários: shared 114, api 15, web 5), `pnpm format:check` verde, `pnpm test:e2e` com 48 testes passando, roteiro visual de pedidos (`tools/ui-walkthrough/orders.mjs`) com 18/18 passos.
- Migrations: `auth_tenancy`, `menu`, `orders`. Um clone novo fica igual ao ambiente de hoje com `pnpm bootstrap` (ou migrations + `pnpm db:seed`): nenhuma imagem ou arquivo local é usado pelo seed. Os uploads ficam em `apps/api/uploads/` (ignorado; no ambiente antigo só havia arquivos de unidades de teste).

### Etapas concluídas

| Etapa | O que entrega |
|---|---|
| Fundação | Monorepo Turborepo + pnpm, Docker (Postgres, Redis, Mailpit), scripts multiplataforma, CI local (`pnpm check`) |
| `feat/auth-tenancy` | Login com refresh token em cookie, recuperação de senha por e-mail, multiunidade (tenant = `Store`), papéis e permissões, empresa, horários, usuários |
| `feat/menu` | Categorias (inclusive pizza com tamanhos), produtos simples e com tamanhos, complementos reutilizáveis com herança, combos, pausa "Acabou" até o fim do dia de negócio, canais, horários, fotos em WebP, catálogo resolvido por canal |
| `feat/orders` | Pedidos de balcão, delivery e mesa; contas e rodadas de mesa; kanban em tempo real (Socket.IO) com som; compositor de pedido com total em tempo real; mesas; cupons; descontos e taxa de serviço com auditoria; versão otimista (409) e idempotência; seed com pedidos em todos os status |

### Decisões recentes (detalhes em DECISOES.md)

- **D019:** uma conta = um `Order`; uma mesa (ou várias mesas juntas) = `TableSession` com várias contas abertas; cada envio à produção = `OrderRound`. Mover itens entre contas fica para `feat/tables-pos`.
- **D020:** ordem dos valores: descontos por item → desconto do pedido → cupom → taxa de serviço sobre o resultado. Nada fica negativo. Taxa de serviço por tipo de pedido (configurável na tela Empresa; padrão só mesa), removível com permissão `orders:discount` e auditoria.
- **D021:** numeração diária por unidade pela data de negócio (turno da madrugada conta para o dia em que começou), atômica via `OrderSequence`.
- **D022:** `expectedVersion` em toda alteração (409 em pt-BR), `Idempotency-Key` na criação, eventos de tempo real só como notificação após o commit.
- O preço de cada item é calculado por `priceCatalogItem` (shared), a mesma função na API e no compositor do painel.
- Telas usam só tokens do tema (inclui `status-*` e `w-kanban-column`). O **redesign** (referência: dashboard escuro azul-marinho com cards de KPI e gráficos, descrito no ROADMAP) será feito trocando o tema, depois das funcionalidades.
- A imagem de referência do layout ficou só na máquina antiga (`docs/design/`, ignorado de propósito: contém dados reais de terceiros). Se precisar dela, o usuário reenvia.

## Próximos passos (nesta ordem)

### 1. Investigar os 4 erros não tratados do e2e

Numa execução do `pnpm test:e2e` (logo após mudanças no pacote shared), os 48 testes passaram mas o Vitest relatou **"4 errors"** não tratados e terminou com código 1. Nas quatro execuções seguintes não se repetiu e o stack não foi guardado.

Suspeitos: promessas não aguardadas; jobs do BullMQ (fila de e-mail, `apps/api/src/core/mail/mail.processor.ts`, `core/queue`) terminando depois de `app.close()`; eventos ou clientes Socket.IO (`orders.e2e.test.ts`, teste de tempo real) emitindo depois do teardown; conexões Redis/Prisma fechando fora de ordem.

O que fazer:

1. Na API (`apps/api/src/main.ts`, e também onde o app de teste é criado em `apps/api/test/utils.ts`), registrar `process.on('unhandledRejection')` e `process.on('uncaughtException')` logando o erro com **stack completo** (logger pino) e o contexto disponível.
2. No e2e, garantir que qualquer erro desses **reprova a execução** e aponta o teste: o Vitest já sai com código 1 quando há erro não tratado, mas é preciso registrar o stack (por exemplo, handlers no `test/setup-env.ts` que guardam o erro e um `afterEach`/`afterAll` que falha mostrando-o, ou `onUnhandledError` do Vitest 4 em `vitest.config.ts`).
3. Revisar o teardown de cada suíte: fechar clientes socket.io, `await app.close()`, esperar a fila do BullMQ esvaziar/fechar (`worker.close()`), desconectar Redis.
4. Rodar `pnpm test:e2e` várias vezes seguidas (umas 10) para confirmar estabilidade. Commit em uma branch `fix/e2e-unhandled-errors`, merge e push.

### 2. Etapa `feat/tables-pos` — apresentar o modelo ANTES de codar

Mostrar ao usuário o modelo de dados (Prisma) e as regras, esperar aprovação, e só então seguir a ordem de sempre: funções puras com testes → schema → API com e2e → tempo real → telas → seed → validação visual → docs → merge e push.

Ponto de partida que já existe: `Payment` (vários por pedido, `method`, `amountCents`, `receivedCents`, `changeCents`, `status`, `cashSessionId` previsto, campos de cancelamento), `Order.paidCents` e `paymentStatus` (`UNPAID/PARTIAL/PAID`), `TableSession`/`TableSessionTable` (com `leftAt`, pensado para juntar e separar mesas), permissões `cash:operate` e `cash:manage`, `PAYMENT_METHODS` no shared.

O modelo precisa resolver:

- **Caixa:** abertura e fechamento por operador (valor inicial); sangria e suprimento com motivo; no fechamento, valor informado por forma de pagamento, valor esperado calculado e **diferença registrada**; quem pode reabrir um caixa fechado (permissão + auditoria).
- **Pagamentos:** vários por pedido; pagamento parcial deixa a conta aberta; troco (dinheiro); estorno com permissão e auditoria; **a conta só fecha com saldo zero**.
- **Divisão da conta:** por igual (definir a regra dos centavos que sobram; já existe `allocateEvenly` no shared), por itens, e **movendo itens entre contas**; recalcular a taxa de serviço de cada parte.
- **Mesas:** transferir conta de mesa, juntar e separar mesas, **pré-conta imprimível** (80 mm, impressão pelo navegador; D012).
- **PIX:** QR Code estático (BR Code / EMV) com a chave PIX do restaurante e o valor; confirmação manual pelo operador. A chave fica nos dados da empresa.
- **Atalhos de teclado no caixa** (ex.: abrir pagamento, escolher forma, confirmar, buscar pedido/mesa).

## Lembretes de ambiente

- Máquina com pouca memória: `pnpm check` (concorrência 2), `pnpm start:lite` para navegar, Playwright headless com um navegador e sem paralelismo. Pare os servidores antes de builds.
- O login tem limite de tentativas: rodar vários roteiros visuais seguidos gera 429; reinicie a API.
- Repositório público: nunca commitar `.env`, segredos ou dados reais; conferir `git diff --cached` antes de cada push.
