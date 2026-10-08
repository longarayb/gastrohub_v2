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
| Cardápio digital (app `menu`: marca do restaurante, carrinho com complementos/pizza/combos, entrega ou retirada, pagamento na entrega, limites contra trote, acompanhamento em tempo real com PIX e "Já paguei", LGPD, SEO e prévia de link) | `feat/digital-menu` | ✅ |
| Impressão (agente local no Windows, vários por unidade; comanda por setor automática com vias, "CANCELADO", via de entrega, pré-conta, fechamento de caixa e acerto; perfis Elgin, Bematech, Epson, Daruma e Tanca; fila com confirmação, atraso, retenção e 2ª via; alertas no painel) — sem cupom fiscal | `feat/printing` | ✅ |
| Dashboard e relatórios | `feat/dashboard` | ⏳ próxima |
| QR Code na mesa (pedido pelo celular no salão, rodadas na conta da mesa) | `feat/table-qr` | ⏳ |
| Seed de demonstração e documentação | `chore/seed-docs` | ⏳ |

Ordem combinada (2026-10-07): fechar o escopo do MVP primeiro — impressão, depois dashboard e só então o QR Code na mesa. A NFC-e (cupom fiscal) fica para a etapa fiscal (Fase 2, `FiscalProvider`).

## Antes do lançamento (importante)

- **Certificado de assinatura de código para o agente de impressão** (`instalar-impressao.exe` e `print-agent.exe`). Sem ele o Windows mostra o alerta do SmartScreen ("O Windows protegeu o computador"), que assusta o cliente e parece vírus. Quando chegar a hora, pesquisar as opções mais baratas: certificados OV de autoridades e revendedores (Sectigo, Certum, SSL.com e revendas) e o Azure Trusted Signing (assinatura na nuvem com mensalidade; exige empresa com histórico). Desde 2023 a chave precisa ficar em token físico ou HSM na nuvem — considerar isso no custo.
- Publicar o instalador num endereço fixo (`NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL` mostra o botão "Baixar instalador") e atualização automática do agente.

## Redesign visual (planejado)

O layout será refeito trocando o tema (`packages/ui/src/styles/globals.css`), sem reescrever as telas. Referência pedida pelo usuário (imagem não versionada, pois contém dados reais): dashboard escuro em azul-marinho, cards de KPI com borda lateral colorida, gráficos de barras e de rosca, tipografia limpa e bastante espaço entre os blocos. As telas usam apenas tokens do tema (`bg-card`, `text-muted-foreground`, `status-*`, `w-kanban-column`, raios de `--radius`).

## Fase 2+ (arquitetura preparada, não implementado)

- Integrações com marketplaces (iFood, 99Food, Aiqfome, Open Delivery) via `MarketplaceAdapter`
- Emissão fiscal NFC-e/NF-e via `FiscalProvider`
- Pagamento online (PIX dinâmico, cartão) via `PaymentGateway`; TEF via `TefProvider`
- Impressão: atualização automática do agente, impressoras Bluetooth/Android (garçom e entregador), logo do restaurante na pré-conta, agente para macOS/Linux
- Estoque e ficha técnica
- Financeiro (contas a pagar/receber, DRE)
- CRM, fidelidade, campanhas, robô de WhatsApp
- Apps de garçom, entregador e totem de autoatendimento
- Roteirização de entregas e mapa; acompanhamento do pedido pelo cliente (o modelo de saídas e paradas já guarda os horários)
- Cardápio digital: pedido agendado (faixas de horário com capacidade, produção na hora certa)
- Cardápio digital: verificação do telefone por código (SMS/WhatsApp, `OtpProvider`) e captcha opcional
- Clientes: tela de clientes com histórico, anonimização (direito de exclusão da LGPD) e mesclagem de duplicados
- Delivery: maquininha própria do entregador (o acerto passa a separar o que entrou na maquininha dele)
- Delivery: geocodificação paga ou Nominatim próprio para produção com volume (D029)
- Postgres RLS como segunda camada de isolamento multi-tenant
- Cardápio: copiar cardápio entre unidades
- Cardápio: cardápio compartilhado da rede (matriz define, unidades ajustam preço/disponibilidade)
- Cardápio: preço por canal (`ProductChannelPrice`), promoção com período, frações desiguais na pizza
- Fiscal: dados fiscais de produtos e opções (NCM, CFOP, CEST, origem) em tabela separada, quando a NFC-e entrar
