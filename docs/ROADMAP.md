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
| Dashboard e relatórios (dashboard do dia em tempo real com comparação e "Atenção agora"; vendas com curva ABC e mapa de calor; controle de perdas; tempos do KDS; rede para o dono; CSV e impressão; conciliação exata com o caixa; 90 dias de histórico no seed) | `feat/dashboard` | ✅ |
| Redesign do painel (tema do [DESIGN.md](DESIGN.md) em todas as telas, escuro como padrão e claro equivalente; componentes base; KDS com a mesma paleta) | `feat/redesign` | ✅ concluído (2026-10-09; D039, D040) |
| Painel admin da plataforma (proposta a ser enviada pelo Braian) | `feat/platform-admin` | ⏳ próxima etapa (aguardando a proposta; vem antes da hospedagem) |
| Hospedagem (servidor, domínio, HTTPS, backups, monitoramento e publicação de atualizações) | `chore/hosting` | ⏳ depois da `feat/platform-admin` (apresentar a proposta antes) |
| QR Code na mesa (pedido pelo celular no salão, rodadas na conta da mesa) | `feat/table-qr` | ⏳ |
| Seed de demonstração e documentação | `chore/seed-docs` | ⏳ |

Ordem combinada (2026-10-07): fechar o escopo do MVP primeiro — impressão, depois dashboard e só então o QR Code na mesa. A NFC-e (cupom fiscal) fica para a etapa fiscal (Fase 2, `FiscalProvider`).

Atualização (2026-10-08): depois do dashboard, o **redesign** do painel vem agora; a **hospedagem** fica para a semana que vem, logo depois do redesign.

## Antes do lançamento (importante)

- **Assinatura de código do agente de impressão — requisito obrigatório** (`instalar-impressao.exe`, `print-agent.exe` e o `PrintAgentService.exe` do WinSW, que também não é assinado). Motivo (2026-10-08): o **Smart App Control do Windows 11** bloqueia executáveis sem assinatura nem reputação — no Surface ele passou a bloquear até o `pnpm-native.exe`. Num computador de restaurante com Windows 11 recém-instalado (o Smart App Control vem ligado em instalações novas), o agente pode simplesmente não rodar; não é mais só o aviso do SmartScreen. Antes do lançamento, pesquisar e decidir:
  - **Serviço de assinatura da Microsoft no Azure** (Trusted Signing, renomeado para Artifact Signing): verificar **se está disponível para empresas no Brasil** (no início era restrito a EUA, Canadá, UE e Reino Unido para organizações), o **custo mensal**, as exigências de validação da empresa (tempo de existência, documentos) e, principalmente, **se a assinatura dá reputação imediata no Smart App Control** (ou se ainda depende de reputação acumulada).
  - **Certificados OV e EV** de autoridades e revendedores (Sectigo, Certum, SSL.com, DigiCert e revendas brasileiras): custo anual, exigência de token físico ou HSM na nuvem (obrigatória desde 2023) e efeito no Smart App Control (EV historicamente dava reputação imediata no SmartScreen; confirmar para o Smart App Control).
  - Testar o instalador assinado num Windows 11 com o Smart App Control ligado antes de distribuir.
- ✅ **Teste de reinicialização do agente de impressão** (2026-10-10, desktop de casa, Smart App Control desligado): depois de reiniciar o Windows, o serviço subiu sozinho antes do login, voltou online sem novo vínculo quando a API ficou disponível e imprimiu a página de teste. Detalhes no HANDOFF.
- **A investigar:** depois do reinício, o canal de tempo real do agente conectou ~15 s depois de ele aparecer online; trabalho pedido nesse intervalo espera o canal (sem perda nem duplicação).
- Teste com impressora térmica física (rede e USB).
- Publicar o instalador num endereço fixo (`NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL` mostra o botão "Baixar instalador") e atualização automática do agente.

## Redesign visual (`feat/redesign`, D039)

Especificação validada em [DESIGN.md](DESIGN.md) (2026-10-08); os componentes do dashboard já seguem a estrutura. O layout será refeito trocando o tema (`packages/ui/src/styles/globals.css`), sem reescrever as telas. Referência pedida pelo usuário (imagem não versionada, pois contém dados reais): dashboard escuro em azul-marinho, cards de KPI com borda lateral colorida, gráficos de barras e de rosca, tipografia limpa e bastante espaço entre os blocos. As telas usam apenas tokens do tema (`bg-card`, `text-muted-foreground`, `status-*`, `w-kanban-column`, raios de `--radius`).

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
