# Arquitetura

## Visão geral

```
            ┌──────────────┐     ┌──────────────┐
            │  apps/web    │     │  apps/menu   │
            │ admin/PDV/KDS│     │ cardápio dig.│
            └──────┬───────┘     └──────┬───────┘
          REST + Socket.IO        REST + Socket.IO (público)
                   └─────────┬──────────┘
                      ┌──────▼──────┐
                      │  apps/api   │  NestJS
                      │  REST /api  │  Swagger /docs
                      │  WS gateway │
                      └──┬───────┬──┘
                Prisma   │       │ BullMQ / Redis adapter
                  ┌──────▼──┐ ┌──▼─────┐
                  │Postgres │ │ Redis  │
                  └─────────┘ └────────┘
```

`packages/shared` é importado pelos três apps: schemas Zod, enums, tipos e o domínio puro de cálculo.

## Multi-tenant

- Tenant = `Store` (unidade). `Organization` agrupa unidades de um dono.
- O JWT carrega `sub` (userId), `tenantId` (unidade ativa) e `role` (papel na unidade).
- `TenantContext` (nestjs-cls) guarda o tenant da requisição; a Prisma extension aplica o filtro em todos os modelos de negócio.
- Troca de unidade emite um novo par de tokens para a unidade escolhida (se o usuário tiver `Membership` nela).

## Módulos da API

| Módulo | Responsabilidade |
|---|---|
| `core` | config, prisma, contexto, logger, erros, guards |
| `auth` | login, refresh, logout, recuperação de senha, troca de unidade |
| `stores` / `users` | dados da empresa, horários, usuários e papéis |
| `menu` | setores, categorias (tamanhos de pizza), produtos, grupos de complementos, catálogo resolvido por canal (`GET /menu/catalog`) |
| `orders` | criação, cálculo, status, histórico, numeração, cupons |
| `tables` | áreas, mesas, sessões, transferência, junção, divisão |
| `cash` | caixa, movimentos, pagamentos, fechamento |
| `kds` | setores e fila de produção |
| `customers` / `delivery` | clientes, endereços, áreas de entrega, entregadores |
| `public-menu` | endpoints públicos do cardápio digital |
| `printing` | documentos 80mm, fila, `PrintProvider` |
| `reports` | dashboard e relatórios |
| `realtime` | gateway Socket.IO |
| `integrations` | interfaces para marketplaces, fiscal, pagamentos (Fase 2+) |

## Cardápio

- **Modelo:** `Category` (STANDARD | PIZZA) → `Product` (STANDARD | SIZED). Tamanhos (`Size`) pertencem à categoria de pizza (compartilhados pelos sabores) ou ao produto SIZED; preços em `ProductSizePrice`.
- **Complementos:** `ModifierGroup`/`ModifierOption` reutilizáveis, ligados por `ModifierGroupLink` à categoria ou ao produto (mín./máx./ordem por vínculo; o vínculo do produto sobrepõe ou desliga o da categoria). `ModifierOption.productId` = opção de combo. Preço de opção por tamanho em `ModifierOptionSizePrice`.
- **Domínio puro** (`packages/shared/src/domain`): `menu-pricing` (preço + `MenuItemSnapshot` que o pedido vai gravar), `menu-modifiers` (grupos efetivos, preço por tamanho), `menu-availability` (pausa, canal, horário, loja aberta) e `business-day` (fim do dia de negócio com turnos que passam da meia-noite).
- **Catálogo:** `CatalogService` monta o cardápio pronto para um canal (preços, grupos efetivos, disponibilidade com motivo). Usado pela pré-visualização e, depois, pelo PDV e pelo cardápio digital.
- **Imagens:** `ImageService` (sharp → WebP 800 px + miniatura 240 px) sobre `StorageProvider` baseado em chaves (`put/copy/delete/publicUrl`).

## Pedidos

- **Modelo:** `Order` = uma conta. Mesa: `TableSession` (uma ou mais mesas via `TableSessionTable`) com várias contas abertas ao mesmo tempo; cada envio à produção é um `OrderRound`. Os itens guardam o `MenuItemSnapshot` e o status de produção (`DRAFT` = ainda não enviado). `OrderStatusHistory` registra cada transição; `Payment` já comporta vários pagamentos por pedido.
- **Valores:** `calculateOrderTotals` (shared): descontos por item → desconto do pedido → cupom → taxa de serviço sobre o resultado (+ taxa de entrega). A API sempre recalcula a partir dos itens.
- **Preço dos itens:** `priceCatalogItem` (shared) resolve o item contra o catálogo do canal (disponibilidade, tamanho, complementos, sabores). A API usa ao gravar; o painel usa para mostrar o total enquanto o pedido é montado.
- **Concorrência:** `version` otimista (409 com mensagem em pt-BR), `Idempotency-Key` na criação, numeração diária atômica (`OrderSequence`, `INSERT ... ON CONFLICT`) pela data de negócio.
- **Telas:** `/pedidos` (kanban + detalhe), `/pedidos/novo` (balcão, delivery e mesa; `?pedido=` adiciona rodada, `?mesa=` abre conta), `/mesas` e `/cupons`.

## Tempo real

- Gateway Socket.IO no namespace `/realtime`, autenticado pelo access token (`auth.token` no handshake); salas `tenant:{id}` e `tenant:{id}:sector:{id}`. Adapter Redis para várias instâncias da API.
- Eventos (`order.created`, `order.updated`, `tables.updated`) são apenas notificações emitidas após o commit; o cliente refaz as consultas.
- Web: `RealtimeProvider` (uma conexão por sessão) reconecta após renovar o token e refaz as consultas ao reconectar ou ao voltar o foco; `useOrderAlert` toca o aviso (WebAudio, botão "Ativar som") enquanto houver pedido pendente não aberto.
