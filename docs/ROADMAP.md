# Roadmap

Legenda: ✅ feito · 🚧 em andamento · ⏳ pendente

## Fase 1 — MVP

| Etapa | Branch | Status |
|---|---|---|
| Fundação do monorepo, Docker, tooling | `main` / `chore/foundation` | ✅ |
| Autenticação, multi-tenant, empresa e usuários | `feat/auth-tenancy` | ✅ |
| Cardápio (categorias, produtos, complementos, tamanhos, pizza) | `feat/menu` | 🚧 |
| Pedidos e tempo real (kanban, status, numeração) | `feat/orders` | ⏳ |
| Salão, mesas, PDV e caixa | `feat/tables-pos` | ⏳ |
| KDS e setores de produção | `feat/kds` | ⏳ |
| Delivery (clientes, áreas, entregadores) | `feat/delivery` | ⏳ |
| Cardápio digital (app `menu`) | `feat/digital-menu` | ⏳ |
| Impressão (comanda e cupom 80mm) | `feat/printing` | ⏳ |
| Dashboard e relatórios | `feat/reports` | ⏳ |
| Seed de demonstração e documentação | `chore/seed-docs` | ⏳ |

## Fase 2+ (arquitetura preparada, não implementado)

- Integrações com marketplaces (iFood, 99Food, Aiqfome, Open Delivery) via `MarketplaceAdapter`
- Emissão fiscal NFC-e/NF-e via `FiscalProvider`
- Pagamento online (PIX dinâmico, cartão) via `PaymentGateway`; TEF via `TefProvider`
- Agente local de impressão ESC/POS por setor via `PrintProvider`
- Estoque e ficha técnica
- Financeiro (contas a pagar/receber, DRE)
- CRM, fidelidade, campanhas, robô de WhatsApp
- Apps de garçom, entregador e totem de autoatendimento
- Roteirização de entregas e mapa
- Postgres RLS como segunda camada de isolamento multi-tenant
