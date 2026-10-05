# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções e regras de trabalho em duas máquinas), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-05**, no Surface (`C:\GastroHub_v2`), ao fim da etapa `feat/kds` (tela da cozinha, expedição e telas vinculadas sem senha).

## Estado atual

- `main` contém tudo o que foi feito; todas as branches estão no GitHub (`longarayb/gastrohub_v2`, público). Nenhuma frente em paralelo.
- Validação no último commit da `feat/kds`: `pnpm check` verde (18 tarefas; unitários: shared 174, api 15, web 5), `pnpm format:check` verde, `pnpm test:e2e` com 70 testes, roteiros visuais `kds.mjs` 8/8, `pos.mjs` 12/12, `orders.mjs` 18/18, `menu.mjs` 15/15 e `auth.mjs` 19/19.
- Migrations: `auth_tenancy`, `menu`, `orders`, `tables_pos`, `kds`. Um clone novo fica igual com `pnpm bootstrap` (ou `pnpm --filter @app/api db:deploy` + `pnpm db:seed`).

### Desktop de casa, na próxima sessão

1. `git pull` na `main` e `pnpm install` (dependências novas: `dotenv-expand` na API e `qrcode` no painel).
2. Compare o `.env` com o `.env.example` e acrescente as variáveis novas (`POSTGRES_PORT=5432`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `CHECK_CONCURRENCY`, `NEXT_BUILD_CPUS`, `LOGIN_RATE_LIMIT_PER_MINUTE=300`). As URLs antigas com a porta escrita continuam funcionando.
3. `pnpm --filter @app/api db:deploy` (migrations `tables_pos` e `kds`) e `pnpm db:seed`.
4. Para os roteiros visuais: `npm install` em `tools/ui-walkthrough` não é necessário de novo (sem dependências novas).

### Etapas concluídas

| Etapa | O que entrega |
|---|---|
| Fundação | Monorepo Turborepo + pnpm, Docker (Postgres, Redis, Mailpit), scripts multiplataforma, CI local (`pnpm check`) |
| `feat/auth-tenancy` | Login com refresh token em cookie, recuperação de senha por e-mail, multiunidade (tenant = `Store`), papéis e permissões, empresa, horários, usuários |
| `feat/menu` | Categorias (inclusive pizza com tamanhos), produtos simples e com tamanhos, complementos reutilizáveis com herança, combos, pausa "Acabou", canais, horários, fotos em WebP, catálogo por canal |
| `feat/orders` | Pedidos de balcão, delivery e mesa; contas e rodadas; kanban em tempo real com som; compositor com total em tempo real; mesas; cupons; descontos e taxa de serviço com auditoria; versão otimista (409) e idempotência |
| `fix/e2e-unhandled-errors` | Encerramento do adapter Socket.IO/Redis e conexões do BullMQ sem vazamentos; e2e reprova erros não tratados |
| `chore/multi-machine-setup` | Portas do Docker por máquina no `.env`, concorrência do `pnpm check` configurável, regras de trabalho em duas máquinas |
| `feat/tables-pos` | Caixa por operador (abertura, sangria/suprimento, fechamento cego com diferença por forma, relatório 80 mm, reabertura e fechamento por gerente); pagamentos (vários por conta, troco, cartão com bandeira/NSU, online/marketplace sem caixa, estorno com permissão); PIX estático (BR Code com txid = código do pedido); delivery "a receber"; divisão por igual (calculadora) e por itens; transferir conta, trocar/juntar/separar mesas; pré-conta com "aguardando pagamento"; atalhos de teclado; chave PIX e fechamento cego na tela Empresa |
| `feat/kds` | Tarefas de produção por setor (combo dividido: a bebida vai para o bar), tickets por rodada, status do item e do pedido automáticos, desfazer pronto, cancelamento riscado com som próprio, remoções em destaque, visão consolidada, "Acabou" na tela, limites amarelo/vermelho por setor, expedição (entregue; delivery sai com entregador), telas vinculadas por código de 6 dígitos sem senha (limites de tentativa, cookie httpOnly de 180 dias, revogação imediata), "Toque para iniciar" com som, tela cheia e Wake Lock |

### Decisões recentes (detalhes em DECISOES.md)

- **D027 KDS:** tarefa de produção por setor criada no envio da rodada (`routeItem`); ticket = rodada × setor; item e pedido seguem as tarefas de todos os setores; limites por setor (o campo da loja foi removido); expedição serve rodadas sem mudar o status e despacha delivery com entregador.
- **D028 Telas da cozinha:** papel interno `KDS_DEVICE` (só KDS e "Acabou"), vínculo por unidade + código de 6 dígitos com limites por código, por unidade e por IP, cookie httpOnly renovado, revogação imediata.
- **D023 Pagamentos:** mesa e balcão só fecham com saldo zero; delivery pode ficar "a receber". `ONLINE` quita sem caixa e fora do esperado. Estorno com `payments:refund` (dono e gerente), motivo e auditoria; cancelar pedido exige estornar antes; total nunca abaixo do pago.
- **D024 Caixa por operador:** um aberto por operador (`openOperatorId` único); esperado por forma; o estorno sai do caixa aberto de quem estorna (caixa fechado nunca muda); fechamento cego configurável (ligado por padrão); pagamentos travam a linha do caixa (`version`), então nenhum pagamento escapa do fechamento.
- **D025 Divisão e mesas:** divisão por igual é só calculadora; por itens move linhas (ou parte) entre contas da mesma sessão, cada conta com sua taxa de serviço; pré-conta marca "aguardando pagamento" até nova rodada.
- **D026 PIX estático:** BR Code por função pura (CRC conferido com o exemplo do Banco Central), chave normalizada, txid = `publicCode` (8 alfanuméricos), confirmação manual.
- Anteriores: D019 (conta, rodadas e sessão de mesa), D020 (ordem dos valores), D021 (numeração diária), D022 (concorrência, idempotência e tempo real).
- O **redesign** (dashboard escuro azul-marinho, descrito no ROADMAP) continua planejado para depois das funcionalidades, trocando só o tema. A imagem de referência ficou na máquina antiga (`docs/design/`, ignorado); se precisar, o usuário reenvia.

## Próximos passos (nesta ordem)

### 1. Etapa `feat/delivery` — apresentar o modelo ANTES de codar

Requisitos (PROMPT_INICIAL 5.7): clientes com histórico e busca rápida por telefone; **áreas de entrega por bairro ou por raio em km**, cada uma com taxa e tempo estimado; cadastro de entregadores e atribuição ao pedido.

Ponto de partida que já existe: `Customer`/`CustomerAddress` (com latitude/longitude e busca por telefone no compositor), `Courier` e atribuição no pedido (kanban e expedição do KDS), `Order.deliveryFeeCents` digitada à mão no compositor, `Store.deliveryMinimumCents`, `GeocodingProvider` (Nominatim) previsto, coordenadas da loja no seed, e "Delivery a receber" no caixa (D023: o entregador presta contas na volta).

O que a proposta precisa resolver: modelo das áreas (bairro × raio, prioridade quando um endereço cai em mais de uma, fora de área), cálculo da taxa e do tempo pelo endereço (geocodificação e fallback quando ela falhar), taxa sugerida × editável no compositor (com permissão e auditoria?), tela de clientes (histórico, endereços, mesclar duplicados?), entregadores (ativos, telefone, acerto do dia com os pedidos "a receber" de cada um) e o que o cardápio digital vai reaproveitar disso.

Mostrar o modelo e as regras ao usuário, esperar aprovação e seguir a ordem de sempre.

## Pendências de decisão do usuário

Nenhuma no momento.

## Lembretes de ambiente

- Surface (8 GB): `.env` com `POSTGRES_PORT=5433`, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`. Playwright headless, um navegador, sem paralelismo; pare os servidores antes de builds.
- Limite de login configurável (`LOGIN_RATE_LIMIT_PER_MINUTE`, 10 em produção, 300 no `.env` de desenvolvimento): os roteiros visuais rodam em sequência. No desktop de casa, acrescente a variável ao `.env`.
- Repositório público: nunca commitar `.env`, segredos ou dados reais; conferir `git diff --cached` antes de cada push.
