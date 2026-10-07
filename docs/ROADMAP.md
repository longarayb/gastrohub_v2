# Roadmap

Legenda: ✅ feito · 🚧 em andamento · ⏳ pendente

## Fase 1 — MVP

| Etapa | Branch | Status |
|---|---|---|
| Fundação do monorepo, Docker, tooling | `main` / `chore/foundation` | ✅ |
| Autenticação, multi-tenant, empresa e usuários | `feat/auth-tenancy` | ✅ |
| Cardápio (categorias, produtos, complementos, tamanhos, pizza) | `feat/menu` | ✅ |
| Pedidos e tempo real (kanban, status, numeração, contas de mesa, cupons) | `feat/orders` | ✅ |
| Salão, mesas, PDV e caixa (pagamentos, troco, PIX estático, caixa por operador com fechamento cego, divisão da conta, transferir/juntar/separar mesas, pré-conta) | `feat/tables-pos` | ✅ |
| KDS e setores de produção (tickets por rodada e setor, combo dividido entre setores, status automático, expedição, telas vinculadas sem senha) | `feat/kds` | ✅ |
| Delivery (áreas por bairro ou raio com taxa, tempo e mínimo; saída com vários pedidos; app do entregador; não entregue e reenvio; acerto no caixa com remuneração e saldo; relatório) | `feat/delivery` | ✅ |
| Cardápio digital (app `menu`) | `feat/digital-menu` | ⏳ |
| Impressão (comanda e cupom 80mm) | `feat/printing` | ⏳ |
| Dashboard e relatórios | `feat/reports` | ⏳ |
| Seed de demonstração e documentação | `chore/seed-docs` | ⏳ |

## Redesign visual (planejado)

O layout será refeito trocando o tema (`packages/ui/src/styles/globals.css`), sem reescrever as telas. Referência pedida pelo usuário (imagem não versionada, pois contém dados reais): dashboard escuro em azul-marinho, cards de KPI com borda lateral colorida, gráficos de barras e de rosca, tipografia limpa e bastante espaço entre os blocos. As telas usam apenas tokens do tema (`bg-card`, `text-muted-foreground`, `status-*`, `w-kanban-column`, raios de `--radius`).

## Fase 2+ (arquitetura preparada, não implementado)

- Integrações com marketplaces (iFood, 99Food, Aiqfome, Open Delivery) via `MarketplaceAdapter`
- Emissão fiscal NFC-e/NF-e via `FiscalProvider`
- Pagamento online (PIX dinâmico, cartão) via `PaymentGateway`; TEF via `TefProvider`
- Agente local de impressão ESC/POS por setor via `PrintProvider`
- Estoque e ficha técnica
- Financeiro (contas a pagar/receber, DRE)
- CRM, fidelidade, campanhas, robô de WhatsApp
- Apps de garçom, entregador e totem de autoatendimento
- Roteirização de entregas e mapa; acompanhamento do pedido pelo cliente (o modelo de saídas e paradas já guarda os horários)
- Delivery: maquininha própria do entregador (o acerto passa a separar o que entrou na maquininha dele)
- Delivery: geocodificação paga ou Nominatim próprio para produção com volume (D029)
- Postgres RLS como segunda camada de isolamento multi-tenant
- Cardápio: copiar cardápio entre unidades
- Cardápio: cardápio compartilhado da rede (matriz define, unidades ajustam preço/disponibilidade)
- Cardápio: preço por canal (`ProductChannelPrice`), promoção com período, frações desiguais na pizza
- Fiscal: dados fiscais de produtos e opções (NCM, CFOP, CEST, origem) em tabela separada, quando a NFC-e entrar
