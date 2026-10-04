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
| `menu` | categorias, produtos, tamanhos, complementos, pizza, disponibilidade |
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

Detalhes de cada módulo serão adicionados conforme forem implementados.
