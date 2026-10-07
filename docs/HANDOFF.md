# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções e regras de trabalho em duas máquinas), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-07**, no Surface (`C:\GastroHub_v2`), ao fim da etapa `feat/delivery` (áreas, saídas, app do entregador, acerto e relatório).

## Estado atual

- `main` contém tudo o que foi feito; todas as branches estão no GitHub (`longarayb/gastrohub_v2`, público). Nenhuma frente em paralelo.
- Validação no último commit da `feat/delivery`: `pnpm check` verde (18 tarefas; unitários: shared 194, api 16, web 5), `pnpm format:check` verde, `pnpm test:e2e` com 76 testes, roteiros visuais `delivery.mjs` 16/16, `orders.mjs` 18/18, `pos.mjs` 12/12, `kds.mjs` 8/8, `menu.mjs` 15/15 e `auth.mjs` 19/19 (cada um com `pnpm db:seed` antes).
- Migrations: `auth_tenancy`, `menu`, `orders`, `tables_pos`, `kds`, `delivery`. Um clone novo fica igual com `pnpm bootstrap` (ou `pnpm --filter @app/api db:deploy` + `pnpm db:seed`).

### Desktop de casa, na próxima sessão

1. `git pull` na `main` e `pnpm install` (sem dependências novas nesta etapa; se vier da `feat/kds` ou anterior, veja as variáveis do `.env` abaixo).
2. Compare o `.env` com o `.env.example` (`POSTGRES_PORT=5432`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `CHECK_CONCURRENCY`, `NEXT_BUILD_CPUS`, `LOGIN_RATE_LIMIT_PER_MINUTE=300`, `GEOCODING_PROVIDER`, `NOMINATIM_URL`, `NOMINATIM_EMAIL`).
3. `pnpm --filter @app/api db:deploy` (migration `delivery`) e `pnpm db:seed`.

### Etapas concluídas

| Etapa | O que entrega |
|---|---|
| Fundação | Monorepo Turborepo + pnpm, Docker (Postgres, Redis, Mailpit), scripts multiplataforma, CI local (`pnpm check`) |
| `feat/auth-tenancy` | Login com refresh token em cookie, recuperação de senha por e-mail, multiunidade (tenant = `Store`), papéis e permissões, empresa, horários, usuários |
| `feat/menu` | Categorias (inclusive pizza com tamanhos), produtos simples e com tamanhos, complementos reutilizáveis com herança, combos, pausa "Acabou", canais, horários, fotos em WebP, catálogo por canal |
| `feat/orders` | Pedidos de balcão, delivery e mesa; contas e rodadas; kanban em tempo real com som; compositor com total em tempo real; mesas; cupons; descontos e taxa de serviço com auditoria; versão otimista (409) e idempotência |
| `fix/e2e-unhandled-errors` | Encerramento do adapter Socket.IO/Redis e conexões do BullMQ sem vazamentos; e2e reprova erros não tratados |
| `chore/multi-machine-setup` | Portas do Docker por máquina no `.env`, concorrência do `pnpm check` configurável, regras de trabalho em duas máquinas |
| `feat/tables-pos` | Caixa por operador com fechamento cego, pagamentos (troco, cartão com bandeira/NSU, online sem caixa, estorno), PIX estático, delivery "a receber", divisão da conta, operações de mesa, pré-conta, atalhos |
| `feat/kds` | Tarefas de produção por setor, tickets por rodada, status automático, desfazer, cancelamento riscado com som, remoções em destaque, consolidado, expedição, telas vinculadas por código sem senha |
| `chore/login-rate-limit` | Limite de login configurável (`LOGIN_RATE_LIMIT_PER_MINUTE`) |
| `feat/delivery` | Áreas por bairro (com variações de nome; padrão) ou raio, com taxa, tempo, mínimo, "grátis acima de" e suspensão; bairros sem área com inclusão rápida; taxa da área no novo pedido (reduzir exige permissão e motivo; toda mudança auditada); geocodificação Nominatim só com o endereço; saída com vários pedidos e um entregador; "não entregue" com motivo (volta para Pronto, visível no kanban e na expedição; reenviar ou cancelar); app do entregador no celular (`/entregas`, só a própria rota); acerto no caixa de quem acerta (pagamentos dos pedidos, conferência de dinheiro e comprovantes, falta descontada ou não, remuneração por entrega, % da taxa e diária uma vez por dia, pagar agora ou acumular); saldo corrente com extrato e pagamento avulso; relatório com taxas separadas, tempos por área e entregador e quem deve a quem |

### Decisões recentes (detalhes em DECISOES.md)

- **D029 Áreas e taxa:** bairro primeiro, depois o menor raio; área suspensa recusa o endereço; sem área → escolha manual. Taxa sugerida pela área; reduzir exige `orders:discount` e motivo; qualquer mudança é auditada. Nominatim recebe só o endereço; **produção com volume exige serviço pago ou Nominatim próprio**.
- **D030 Saídas e app do entregador:** uma saída aberta por entregador; cada tentativa é uma parada; `DISPATCHED` exige entregador; o entregador (`courier:app`) vê só a própria saída aberta (LGPD); maquininha só a do restaurante (a do entregador está no ROADMAP).
- **D031 Acerto e remuneração:** o recebido vira pagamento no caixa de quem acerta; falta/sobra corrige a gaveta; remuneração da loja ou do entregador; diária no primeiro acerto do dia; saldo corrente com "pagar agora" (sangria auditada) ou "acumular"; pagamento avulso do saldo também é sangria.
- Anteriores: D027–D028 (KDS e telas da cozinha), D023–D026 (pagamentos, caixa, divisão, PIX), D019–D022 (pedidos).
- O **redesign** (dashboard escuro azul-marinho, descrito no ROADMAP) continua planejado para depois das funcionalidades, trocando só o tema.

### Observação conhecida (não bloqueia)

- Nas suítes e2e do PDV e de entrega aparece uma vez o aviso `DeprecationWarning: Calling client.query() when the client is already executing a query` do `pg`. Vem do Prisma 7 com `@prisma/adapter-pg` ao carregar relações dentro de transações interativas (já acontecia na `main` antes da entrega). Os testes passam; vale reavaliar ao atualizar o Prisma ou o `pg` 9 (que transforma o aviso em erro).

## Próximos passos (nesta ordem)

### 1. Etapa `feat/digital-menu` — apresentar a proposta ANTES de codar

Requisitos: PROMPT_INICIAL (cardápio digital, app `apps/menu`, rota pública `/{slug}`). Ponto de partida que já existe: catálogo por canal `DIGITAL_MENU` (`MenuContext`, disponibilidade por horário e "Acabou"), `Store.digitalMenuEnabled` e `autoAcceptDigitalOrders`, criação de pedido com `source: 'DIGITAL_MENU'` (status inicial pendente ou aceito, mínimo da área bloqueante), áreas de entrega com cotação (`DeliveryPricingService.quote`, hoje autenticada), `publicCode` do pedido para acompanhamento, PIX estático (BR Code com txid = `publicCode`).

O que a proposta precisa resolver: rotas públicas (catálogo, cotação de entrega, criação de pedido, acompanhamento por `publicCode`) e limites contra abuso; identificação do cliente (telefone, sem senha?); pagamento na entrega × PIX estático; acompanhamento do pedido pelo cliente (status e horários das paradas, sem dados do entregador além do necessário); aceitar/recusar pedidos no painel (som de novo pedido já existe); layout mobile-first e tema da marca.

Mostrar o modelo e as regras ao usuário, esperar aprovação e seguir a ordem de sempre.

## Pendências de decisão do usuário

Nenhuma no momento.

## Lembretes de ambiente

- Surface (8 GB): `.env` com `POSTGRES_PORT=5433`, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`. Playwright headless, um navegador, sem paralelismo; pare os servidores antes de builds.
- Depois de reiniciar o Windows, abra o Docker Desktop antes do `pnpm test:e2e`/`start:lite` (o `global-setup` do e2e falha com "dockerDesktopLinuxEngine" se o engine estiver parado).
- Roteiros visuais: `pnpm db:seed` antes de cada um (eles alteram pedidos e saídas).
- Repositório público: nunca commitar `.env`, segredos ou dados reais; conferir `git diff --cached` antes de cada push.
