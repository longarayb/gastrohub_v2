# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções e regras de trabalho em duas máquinas), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-05**, no Surface (`C:\GastroHub_v2`), ao fim da etapa `feat/tables-pos` (caixa, pagamentos, PIX, divisão de conta e operações de mesa).

## Estado atual

- `main` contém tudo o que foi feito; todas as branches estão no GitHub (`longarayb/gastrohub_v2`, público). Nenhuma frente em paralelo.
- Validação no último commit da `feat/tables-pos`: `pnpm check` verde (18 tarefas; unitários: shared 157, api 15, web 5), `pnpm format:check` verde, `pnpm test:e2e` com 58 testes, roteiros visuais `pos.mjs` 12/12, `orders.mjs` 18/18, `menu.mjs` 15/15 e `auth.mjs` 19/19 (os dois últimos foram atualizados: esperavam textos e a tela inicial de antes da etapa de pedidos).
- Migrations: `auth_tenancy`, `menu`, `orders`, `tables_pos`. Um clone novo fica igual com `pnpm bootstrap` (ou `pnpm --filter @app/api db:deploy` + `pnpm db:seed`).

### Desktop de casa, na próxima sessão

1. `git pull` na `main` e `pnpm install` (dependências novas: `dotenv-expand` na API e `qrcode` no painel).
2. Compare o `.env` com o `.env.example` e acrescente as variáveis novas (`POSTGRES_PORT=5432`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `CHECK_CONCURRENCY`, `NEXT_BUILD_CPUS`). As URLs antigas com a porta escrita continuam funcionando.
3. `pnpm --filter @app/api db:deploy` (migration `tables_pos`) e `pnpm db:seed`.
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

### Decisões recentes (detalhes em DECISOES.md)

- **D023 Pagamentos:** mesa e balcão só fecham com saldo zero; delivery pode ficar "a receber". `ONLINE` quita sem caixa e fora do esperado. Estorno com `payments:refund` (dono e gerente), motivo e auditoria; cancelar pedido exige estornar antes; total nunca abaixo do pago.
- **D024 Caixa por operador:** um aberto por operador (`openOperatorId` único); esperado por forma; o estorno sai do caixa aberto de quem estorna (caixa fechado nunca muda); fechamento cego configurável (ligado por padrão); pagamentos travam a linha do caixa (`version`), então nenhum pagamento escapa do fechamento.
- **D025 Divisão e mesas:** divisão por igual é só calculadora; por itens move linhas (ou parte) entre contas da mesma sessão, cada conta com sua taxa de serviço; pré-conta marca "aguardando pagamento" até nova rodada.
- **D026 PIX estático:** BR Code por função pura (CRC conferido com o exemplo do Banco Central), chave normalizada, txid = `publicCode` (8 alfanuméricos), confirmação manual.
- Anteriores: D019 (conta, rodadas e sessão de mesa), D020 (ordem dos valores), D021 (numeração diária), D022 (concorrência, idempotência e tempo real).
- O **redesign** (dashboard escuro azul-marinho, descrito no ROADMAP) continua planejado para depois das funcionalidades, trocando só o tema. A imagem de referência ficou na máquina antiga (`docs/design/`, ignorado); se precisar, o usuário reenvia.

## Próximos passos (nesta ordem)

### 1. Etapa `feat/kds` — apresentar o modelo ANTES de codar

Requisitos (PROMPT_INICIAL 5.6): tela para tablet/TV com os itens a preparar por pedido, tempo decorrido e destaque quando passar do limite (`Store.kdsLateAfterMinutes`, já existe); a cozinha marca itens/pedidos como prontos e o pedido atualiza em tempo real; setores de produção (cozinha, bar, pizzaria) com roteamento de itens por setor; botões grandes e modo escuro.

Ponto de partida que já existe: `ProductionSector` (setor padrão `isDefault`), `OrderItem.sectorId`/`status` (`QUEUED → PREPARING → READY → SERVED`) com `startedAt`/`readyAt`, salas Socket.IO por setor (`subscribe:sector`, eventos enviados também para `tenant:{id}:sector:{sectorId}`), permissão `kds:operate`, rodadas (`OrderRound.sentAt`) e o status do pedido que volta a `PREPARING` com nova rodada.

O que a proposta precisa resolver: como o status do pedido deriva do status dos itens de todos os setores (pedido pronto só quando todos os setores terminarem?); "recall" (desfazer pronto); tela por setor e tela "expedição" (todos os setores); ordem dos cartões; som e destaque de atraso; o que a cozinha vê de itens cancelados; teclado/toque (botões grandes, sem rolagem).

Mostrar o modelo e as regras ao usuário, esperar aprovação e seguir a ordem de sempre: funções puras com testes → schema → API com e2e → tempo real → telas → seed → validação visual → docs → merge e push.

## Pendências de decisão do usuário

Nenhuma no momento.

## Lembretes de ambiente

- Surface (8 GB): `.env` com `POSTGRES_PORT=5433`, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`. Playwright headless, um navegador, sem paralelismo; pare os servidores antes de builds.
- O login tem limite de tentativas: rodar vários roteiros visuais seguidos pode gerar 429; reinicie a API.
- Repositório público: nunca commitar `.env`, segredos ou dados reais; conferir `git diff --cached` antes de cada push.
