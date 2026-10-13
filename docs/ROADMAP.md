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
| Painel admin da plataforma (app `admin` com login e 2FA próprios, clientes, planos, assinaturas, mensalidades manuais, inadimplência com somente leitura fora do expediente, acesso de suporte, aceite dos termos) | `feat/platform-admin` | ✅ concluído (2026-10-12; D041–D044) |
| Hospedagem (servidor, domínio, HTTPS, backups, monitoramento e publicação de atualizações; decisões já tomadas em "Hospedagem: decisões") | `chore/hosting` | 📝 proposta revisada em 2026-10-13 (Postgres 17 na VM, fora do Docker, em `/mnt/dados`) em [PROPOSTA_HOSPEDAGEM.md](PROPOSTA_HOSPEDAGEM.md), aguardando aprovação |
| Integração iFood (API própria) | `feat/ifood` | ⏳ depois da hospedagem (ver "Integrações com marketplaces") |
| Adaptador Open Delivery (padrão da Abrasel; 99Food e Keeta) | `feat/open-delivery` | ⏳ depois do iFood |
| Aiqfome | — | ⏳ a verificar (forma de integração ainda não levantada) |
| QR Code na mesa (pedido pelo celular no salão, rodadas na conta da mesa) | `feat/table-qr` | ⏳ |
| Seed de demonstração e documentação | `chore/seed-docs` | ⏳ |

Ordem combinada (2026-10-07): fechar o escopo do MVP primeiro — impressão, depois dashboard e só então o QR Code na mesa. A NFC-e (cupom fiscal) fica para a etapa fiscal (Fase 2, `FiscalProvider`).

Atualização (2026-10-08): depois do dashboard, o **redesign** do painel vem agora; a **hospedagem** fica para a semana que vem, logo depois do redesign.

Atualização (2026-10-11): o **painel admin da plataforma** (`feat/platform-admin`) vem antes da hospedagem; depois da hospedagem, as **integrações com marketplaces** (iFood, depois Open Delivery). A posição do QR Code na mesa em relação aos marketplaces ainda será combinada.

## Hospedagem: decisões (2026-10-11, para a proposta da `chore/hosting`)

- **Servidor:** VM na **Contabo**, região **EUA (East)**, na faixa de **US$ 20 por mês**, configurada pelo Braian do zero, com os serviços em **Docker Compose**.
- **Primeiro uso: demonstração**, só com **dados fictícios** (nada de dados reais de restaurantes até haver uma decisão nova).
- **Domínio ainda não definido:** a proposta precisa funcionar com um domínio provisório ou com **sslip.io** (nomes derivados do IP, com HTTPS) e permitir **trocar o domínio depois** sem refazer o servidor (URLs públicas e cookies só por variáveis de ambiente).
- **Backups diários do Postgres enviados para fora da VM** (ex.: Backblaze B2 ou Cloudflare R2), com retenção e um teste de restauração documentado.
- Ainda a propor na etapa: HTTPS (proxy reverso), monitoramento e alertas, publicação de atualizações e onde ficam os uploads.

## Integrações com marketplaces (depois da hospedagem)

Entram pelo ponto de extensão `MarketplaceAdapter` (pedidos com `source` e código externo, já previstos em `Order`; pagamento `ONLINE` sem caixa, D023).

1. **iFood** (`feat/ifood`): API própria do iFood.
2. **Open Delivery** (`feat/open-delivery`): um adaptador para o padrão da Abrasel, já adotado pela **99Food** e pela **Keeta**; um mesmo adaptador atende as plataformas que seguem o padrão.
3. **Aiqfome:** a verificar (API própria ou Open Delivery).

- **Desenvolvimento** pode ser feito localmente, por **polling**, contra as lojas de teste de cada plataforma (sem precisar expor a máquina de desenvolvimento).
- **Homologação e produção exigem o sistema hospedado** (endereço público com HTTPS) e o **cadastro como parceiro** em cada plataforma (provavelmente com **CNPJ**). Por isso as integrações vêm depois da hospedagem.
- **Organização em somente leitura** (inadimplência, `feat/platform-admin`): quando as integrações existirem, todas as unidades dela devem aparecer como **loja fechada** nas plataformas (sem receber pedidos novos), pelo mesmo horário em que o painel passa a somente leitura.

## Antes do lançamento (importante)

- **Assinatura de código do agente de impressão — requisito obrigatório** (`instalar-impressao.exe`, `print-agent.exe` e o `PrintAgentService.exe` do WinSW, que também não é assinado). Motivo (2026-10-08): o **Smart App Control do Windows 11** bloqueia executáveis sem assinatura nem reputação — no Surface ele passou a bloquear até o `pnpm-native.exe`. Num computador de restaurante com Windows 11 recém-instalado (o Smart App Control vem ligado em instalações novas), o agente pode simplesmente não rodar; não é mais só o aviso do SmartScreen. Antes do lançamento, pesquisar e decidir:
  - **Serviço de assinatura da Microsoft no Azure** (Trusted Signing, renomeado para Artifact Signing): verificar **se está disponível para empresas no Brasil** (no início era restrito a EUA, Canadá, UE e Reino Unido para organizações), o **custo mensal**, as exigências de validação da empresa (tempo de existência, documentos) e, principalmente, **se a assinatura dá reputação imediata no Smart App Control** (ou se ainda depende de reputação acumulada).
  - **Certificados OV e EV** de autoridades e revendedores (Sectigo, Certum, SSL.com, DigiCert e revendas brasileiras): custo anual, exigência de token físico ou HSM na nuvem (obrigatória desde 2023) e efeito no Smart App Control (EV historicamente dava reputação imediata no SmartScreen; confirmar para o Smart App Control).
  - Testar o instalador assinado num Windows 11 com o Smart App Control ligado antes de distribuir.
- ✅ **Teste de reinicialização do agente de impressão** (2026-10-10, desktop de casa, Smart App Control desligado): depois de reiniciar o Windows, o serviço subiu sozinho antes do login, voltou online sem novo vínculo quando a API ficou disponível e imprimiu a página de teste. Detalhes no HANDOFF.
- ✅ **Atraso do canal de tempo real do agente depois do reinício** (~15 s): corrigido em 2026-10-11 (`fix/print-agent-realtime-reconnect`; o heartbeat que volta a ter contato reabre o canal na hora e o teto entre tentativas caiu de 30 s para 10 s; medido: 4 s em vez de 17 s).
- Teste com impressora térmica física (rede e USB).
- Publicar o instalador num endereço fixo (`NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL` mostra o botão "Baixar instalador") e atualização automática do agente.

## Redesign visual (`feat/redesign`, D039)

Especificação validada em [DESIGN.md](DESIGN.md) (2026-10-08); os componentes do dashboard já seguem a estrutura. O layout será refeito trocando o tema (`packages/ui/src/styles/globals.css`), sem reescrever as telas. Referência pedida pelo usuário (imagem não versionada, pois contém dados reais): dashboard escuro em azul-marinho, cards de KPI com borda lateral colorida, gráficos de barras e de rosca, tipografia limpa e bastante espaço entre os blocos. As telas usam apenas tokens do tema (`bg-card`, `text-muted-foreground`, `status-*`, `w-kanban-column`, raios de `--radius`).

## Fase 2+ (arquitetura preparada, não implementado)

- Integrações com marketplaces: planejadas como etapas logo depois da hospedagem (ver "Integrações com marketplaces" acima)
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
- Plataforma: **emissão da nota fiscal de serviço (NFS-e)** das mensalidades dos clientes (o cadastro do cliente já guarda CNPJ/CPF, razão social, endereço, inscrição municipal e e-mail para nota desde a `feat/platform-admin`)
- Plataforma: cobrança automática por um serviço brasileiro (Asaas, Mercado Pago ou Pagar.me) com PIX e boleto recorrentes, pela interface `BillingProvider` da `feat/platform-admin`
- Plataforma: **encerramento de um cliente pela LGPD** — exportação dos dados pelo próprio cliente (cardápio, pedidos, clientes, financeiro, em formatos abertos), prazo de retenção depois do cancelamento (somente leitura e exportação disponíveis), e depois exclusão ou anonimização dos dados pessoais (clientes finais, usuários), mantendo só o que a lei obriga a guardar (dados fiscais e financeiros pelo prazo legal); tudo registrado na auditoria da plataforma
