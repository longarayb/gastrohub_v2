# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções e regras de trabalho em duas máquinas), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-08**, no Surface (`C:\GastroHub_v2`), ao fim da etapa `feat/printing` (impressão automática com agente local no Windows).

## Estado atual

- `main` contém tudo o que foi feito; todas as branches estão no GitHub (`longarayb/gastrohub_v2`, público). Nenhuma frente em paralelo.
- Validação no último commit da `feat/printing`: `pnpm check` verde (22 tarefas; unitários: shared 233, api 22, print-agent 12, web 5), `pnpm format:check` verde, `pnpm test:e2e` com 93 testes (9 novos de impressão), roteiro visual `printing.mjs` 13/13 (agente real em modo virtual). Os roteiros anteriores não foram rodados de novo nesta etapa: as telas que mudaram (pré-conta, caixa, acerto, detalhe do pedido) só ganharam botões novos, e o caminho pelo navegador continua igual.
- Migrations: `auth_tenancy`, `menu`, `orders`, `tables_pos`, `kds`, `delivery`, `digital_menu`, `printing`. Um clone novo fica igual com `pnpm bootstrap` (ou `pnpm --filter @app/api db:deploy` + `pnpm db:seed`).
- O seed **não** configura impressão (sem computador conectado, uma impressora cadastrada geraria alertas permanentes na demonstração); o roteiro `printing.mjs` configura tudo pelas telas e remove no fim.

### Desktop de casa, na próxima sessão

1. `git pull` na `main` e `pnpm install` (pacote novo `apps/print-agent`, com `esbuild`, `socket.io-client` e `postject`).
2. `pnpm --filter @app/api db:deploy` (migration `printing`) e `pnpm db:seed`. Nenhuma variável nova obrigatória no `.env` (opcional no painel: `NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL`, link do instalador).
3. Para ver a impressão funcionando sem impressora: `pnpm start:lite`, depois `pnpm --filter @app/print-agent build` e `pnpm --filter @app/print-agent start:virtual`, e siga docs/SETUP.md ("Agente de impressão").

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
| `fix/pg-concurrent-queries` | Leituras com várias relações dentro de transação carregam uma relação por vez (`findFirstSequential`); o e2e reprova consultas paralelas na mesma conexão |
| `feat/printing` | Agente de impressão local (serviço do Windows, executável único, instalador Inno Setup + WinSW, página de vínculo em 127.0.0.1:9180, credencial com DPAPI), vários computadores por unidade com status no painel; impressoras de rede, USB/compartilhadas (spooler RAW) e virtuais; perfis Elgin, Bematech, Epson, Daruma, Tanca e genéricos, "sem acentos" e página de teste com acentos; fila no banco gravada na transação do pedido (comanda por setor com 1–3 vias, "CANCELADO", via de entrega no aceite), confirmação por tentativa, novas tentativas, "POSSÍVEL 2ª VIA", "IMPRESSÃO ATRASADA", retenção com decisão no painel e 2ª via auditada; alertas no topo; pré-conta, fechamento de caixa e acerto direto na impressora do caixa (navegador continua como alternativa); memória medida ~60 MB |
| `feat/digital-menu` | App `menu` com a marca do restaurante (cor, logo, capa; a nossa só no "feito com"), renderizado no servidor com cache atualizado pela API, SEO e imagem de prévia de link; aberto/fechado com próxima abertura; item com complementos, pizza e combos pelas funções do shared; checkout com área, taxa, mínimo, "grátis acima de", cupom, pagamento na entrega (troco, cartão, PIX), consentimento LGPD e "Não é você?"; limites contra trote (telefone, IP largo, pendentes), honeypot e telefones bloqueados; recusa com motivo para o cliente e nota interna; acompanhamento em tempo real por token não adivinhável com QR do PIX após o aceite e "Já paguei" (visível no kanban, caixa e entregador); configurações em Configurações › Cardápio digital |

### Decisões recentes (detalhes em DECISOES.md)

- **D035 Agente de impressão:** agente próprio como serviço do Windows (navegador fica como alternativa manual; D012 substituída na impressão automática); vários por unidade; papel `PRINT_AGENT` que só imprime; vínculo por código com os limites do KDS; credencial com DPAPI, sem rotação; só conexões de saída; perfis por marca; meta de memória até 80 MB (medido ~60 MB); Windows 10 1809+ ou 11, 64 bits.
- **D036 Fila:** outbox na transação do evento com `dedupeKey`; arrendamento de 60 s e confirmação por tentativa; novas tentativas 5 s/15 s/30 s/1 min; lease vencido → "POSSÍVEL 2ª VIA"; mais de 2 min → "IMPRESSÃO ATRASADA"; mais de 30 min (configurável) → retido para imprimir ou descartar; 2ª via auditada; alertas no painel.
- **D037 Documentos:** funções puras do shared (prévia = papel), 58 mm/32 colunas e 80 mm/48 colunas, "Não é documento fiscal" nos documentos do cliente.
- **D032 Cardápio digital:** marca do restaurante; renderização no servidor com cache por restaurante (a API pede a atualização); nada de Zod no celular (regras puras fora dos arquivos de schema); 3G simulado: LCP ~0,9 s e ~171 KB de JS; SEO e prévia de link; pedido agendado fica para depois.
- **D033 Pedido pelo cardápio:** sem cadastro (dados só no aparelho); pagamento na entrega ou retirada; PIX com QR após o aceite e "Já paguei" para conferir; limite por telefone como proteção principal, IP largo (CGNAT), pendentes e telefones bloqueados; recusa com motivo para o cliente separado da nota interna.
- **D034 Acompanhamento e LGPD:** token de 128 bits, sem dados pessoais, tempo real pelo namespace `/tracking`; aviso de privacidade modelo (a tela pede revisão jurídica), consentimento registrado com versão, opt-in de marketing separado.
- **D029 Áreas e taxa:** bairro primeiro, depois o menor raio; área suspensa recusa o endereço; sem área → escolha manual. Taxa sugerida pela área; reduzir exige `orders:discount` e motivo; qualquer mudança é auditada. Nominatim recebe só o endereço; **produção com volume exige serviço pago ou Nominatim próprio**.
- **D030 Saídas e app do entregador:** uma saída aberta por entregador; cada tentativa é uma parada; `DISPATCHED` exige entregador; o entregador (`courier:app`) vê só a própria saída aberta (LGPD); maquininha só a do restaurante (a do entregador está no ROADMAP).
- **D031 Acerto e remuneração:** o recebido vira pagamento no caixa de quem acerta; falta/sobra corrige a gaveta; remuneração da loja ou do entregador; diária no primeiro acerto do dia; saldo corrente com "pagar agora" (sangria auditada) ou "acumular"; pagamento avulso do saldo também é sangria.
- Anteriores: D027–D028 (KDS e telas da cozinha), D023–D026 (pagamentos, caixa, divisão, PIX), D019–D022 (pedidos).
- O **redesign** (dashboard escuro azul-marinho, descrito no ROADMAP) continua planejado para depois das funcionalidades, trocando só o tema.

### Consultas em paralelo na mesma conexão (corrigido em `fix/pg-concurrent-queries`)

- O aviso `client.query() when the client is already executing a query` vinha de leituras com várias relações (`include`) dentro de `$transaction`: o Prisma 7 busca as relações em paralelo na conexão da transação (caixa: `CashService.totals`/`findRow`; cardápio: carregadores de categoria, produto e grupo; contas de mesa: `openTab`). Nenhum `Promise.all` nosso estava dentro de transação. Essas leituras agora usam `findFirstSequential`, e o e2e reprova qualquer nova ocorrência.

## Próximos passos (nesta ordem)

### 1. Etapa `feat/dashboard` — apresentar a proposta ANTES de codar

Próxima na ordem combinada (**`feat/dashboard` → `feat/table-qr`**). Dashboard e relatórios: vendas do dia e do período, ticket médio, por canal e forma de pagamento, produtos mais vendidos, cancelamentos e descontos, tempos de preparo e entrega (já existem relatórios de caixa e de entregas para reaproveitar). Considerar o **redesign** planejado no ROADMAP (dashboard escuro, KPIs com borda colorida, gráficos) ao propor o layout. Mostrar a proposta ao usuário e esperar aprovação.

### 2. Antes do lançamento (não é etapa de código agora)

Certificado de assinatura de código para o `instalar-impressao.exe` e o `print-agent.exe` (ROADMAP, "Antes do lançamento": pesquisar as opções mais baratas quando chegar a hora). O instalador completo ainda **não foi gerado** nesta máquina (faltam o WinSW em `apps/print-agent/installer/vendor/` e o Inno Setup); o executável único foi gerado e testado (vínculo, impressão e memória). Também falta testar com uma impressora térmica física (rede e USB): o caminho do spooler foi conferido com uma impressora inexistente (mensagem de erro certa) e o de rede com um servidor TCP simulado.

### 3. Etapa `feat/table-qr` — apresentar a proposta ANTES de codar

QR Code na mesa: o cliente sentado no salão faz o pedido pelo celular e os itens viram rodadas na conta da mesa (sessão). Decidido na `feat/digital-menu`: etapa própria, logo depois, reaproveitando os componentes do `apps/menu` (cardápio, montagem de item, carrinho, preço pelo shared).

Ponto de partida: `TableSession`/contas e rodadas (D019, D025), canal `DINE_IN` do catálogo, `addItems`/`sendRound` no `OrdersService`, KDS por rodada (D027), app do cardápio (D032–D034) e a pré-conta com "aguardando pagamento".

O que a proposta precisa resolver: token do QR por mesa (impressão e troca do token), como o celular entra na conta (abre sessão ou entra na existente; várias pessoas na mesma mesa), confirmação pelo garçom antes de ir para a cozinha (evitar pedido de quem não está na mesa) ou envio direto configurável, chamar o garçom e pedir a conta, ver o consumo da mesa, taxa de serviço, limites contra abuso (reaproveitar D033), e o que muda no kanban, no mapa de mesas e no KDS.

Mostrar o modelo e as regras ao usuário, esperar aprovação e seguir a ordem de sempre.

## Pendências de decisão do usuário

Nenhuma no momento.

## Lembretes de ambiente

- **Testar no celular:** `pnpm start:lite --menu --lan` e `pnpm lan:links` (mesma rede Wi-Fi; regra do firewall em docs/SETUP.md). Prévia do link no WhatsApp: `pnpm tunnel:menu` (túnel temporário que se fecha em 30 min; expõe o ambiente de desenvolvimento).

- Surface (8 GB): `.env` com `POSTGRES_PORT=5433`, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`. Playwright headless, um navegador, sem paralelismo; pare os servidores antes de builds.
- Depois de reiniciar o Windows, abra o Docker Desktop antes do `pnpm test:e2e`/`start:lite` (o `global-setup` do e2e falha com "dockerDesktopLinuxEngine" se o engine estiver parado).
- Roteiros visuais: `pnpm db:seed` antes de cada um (eles alteram pedidos e saídas).
- Repositório público: nunca commitar `.env`, segredos ou dados reais; conferir `git diff --cached` antes de cada push.
