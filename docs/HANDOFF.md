# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções e regras de trabalho em duas máquinas), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-09**, no Surface, **com o projeto dentro do WSL** (`~/projetos/GastroHub_v2`). A `feat/redesign` foi aprovada, validada e integrada na `main`.

## Estado atual

- `main` tem tudo até o **redesign** (merge da `feat/redesign`: D039 tema, componentes, telas de operação, cozinha, login e acessibilidade; D040 ordem pelo banco; mapa único de atalhos). Todas as branches estão no GitHub. **Nenhuma frente em andamento**; qualquer branch nova pode alterar o schema. A `main` ganhou a migration `event_sequence` (D040): no desktop, `pnpm --filter @app/api db:deploy`.
- **Surface agora trabalha dentro do WSL** (Ubuntu-24.04, `~/projetos/GastroHub_v2`), porque o Smart App Control (ligado; decisão do usuário: **não desligar nem contornar**) bloqueia executáveis do Windows sem assinatura, como o `pnpm-native.exe`. Os programas do Linux não são afetados. `C:\GastroHub_v2` ficou como **cópia antiga, sem uso: não editar nem apagar**. Passo a passo e dicas em docs/SETUP.md ("O projeto inteiro dentro do WSL"). O desktop de casa continua no Windows (`D:\GastroHub_v2`).
- Validado no WSL antes do merge do redesign: `pnpm check` 23/23, `pnpm format:check`, e2e 101/101, **os 10 roteiros visuais** com seed limpo antes de cada um (auth 19, menu 15, orders 18, keyboard 7, pos 12, kds 8, delivery 16, digital-menu 11, printing 13, dashboard 12) e a **checagem de acessibilidade** (48 combinações, sem violação séria ou crítica), com o relógio real e com o simulado (terça 23:50, virando a meia-noite). O painel abre no navegador do Windows por `localhost`.
- Os roteiros com o seed novo acharam e corrigiram: "a receber" do caixa contava delivery estornado (agora usa a regra da D038: estorno não reabre a dívida); o histórico do seed entregava em bairros fora das áreas ativas; a confirmação de "Desvincular" da página local do agente usava JavaScript inline, bloqueado pela própria CSP (agora é uma página de confirmação); o `kds.mjs` sai da tela cheia antes de redimensionar (Chromium no Linux).
- `pnpm db:seed` e `pnpm db:reset` passam pelo Turborepo e compilam antes o `@app/shared` (funcionam num clone novo). Os roteiros usam o Edge no Windows e o Chromium do Playwright no Linux (`tools/ui-walkthrough/browser.mjs`).
- Migrations: `auth_tenancy`, `menu`, `orders`, `tables_pos`, `kds`, `delivery`, `digital_menu`, `printing`, `reports` (preenche o dia de negócio dos pagamentos e pedidos antigos) e `event_sequence` (D040: `seq` nas tabelas de eventos, numerando as linhas antigas pela ordem de criação).
- O seed **não** configura impressão; gera **90 dias de histórico** para o dashboard (~20 s no total).
- **Agente de impressão no Surface:** o serviço `app-print-agent` ficou instalado no Windows (aponta para a API local, não vinculado). Não serve para o teste de reinicialização (o Smart App Control contamina o resultado); pode ser removido em Configurações › Aplicativos quando quiser.

### Desktop de casa, na próxima sessão

1. `git fetch`, `git checkout main`, `git pull`.
2. `pnpm install` (novidades desde a última vez no desktop: `apps/print-agent` com `esbuild`, `socket.io-client` e `postject`; `packages/ui` ganhou o `popover`). Para os roteiros visuais, `npm install` em `tools/ui-walkthrough` (agora com `@axe-core/playwright`).
3. `pnpm --filter @app/api db:deploy` (migrations `printing`, `reports` e `event_sequence`) e `pnpm db:seed` (90 dias de histórico; termina com "✔ Histórico: … pedidos em 90 dias").
4. **Teste de reinicialização do agente de impressão** (reservado para o desktop): `winget install --id JRSoftware.InnoSetup -e --scope user`; `pnpm --filter @app/print-agent package -- --api http://localhost:3333/api`; instalar `apps/print-agent/release/instalar-impressao.exe` (pede administrador); com `pnpm start:lite` rodando, vincular pela página `http://127.0.0.1:9180` (Configurações › Impressão › Adicionar computador) e cadastrar uma impressora virtual; **reiniciar o Windows** e conferir que o serviço sobe sozinho (`(Get-Service app-print-agent).Status` = Running), que a página local mostra "Conectado" e que a página de teste imprime (arquivo em `C:\ProgramData\app-print-agent\impressoes`). Confira também o novo "Desvincular este computador" (abre a confirmação "Sim, desvincular"/"Cancelar"). Se o desktop também tiver o Smart App Control ligado, registre o resultado: reforça a assinatura de código (ROADMAP).
5. Conferir o redesign no Windows: `pnpm start:lite --menu`, painel nos dois temas, `npm run a11y` e `npm run keyboard` em `tools/ui-walkthrough` (no Windows os roteiros usam o Edge).
6. Depois, a proposta da hospedagem (abaixo).

### Surface, na próxima sessão

Abrir o Claude Code dentro do WSL (docs/SETUP.md, passo 10): no Ubuntu, `cd ~/projetos/GastroHub_v2` e `claude` (ou VS Code conectado ao WSL). Lá: `git fetch`, `git pull`, `pnpm infra:up` (Docker Desktop aberto) e seguir os próximos passos.

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
| `feat/redesign` | Tema escuro padrão e claro equivalente (azul como cor principal, fontes embutidas, foco de 3 px, alvos de 44 px), menu lateral, kanban com atraso e "a receber", componentes base com teste de contraste, telas de operação (teclado completo no novo pedido, caixa, mesas, entregador, tablet 1024×768), mapa único de atalhos (F6/F7 impedidos, F9 com trava contra toque duplo), cozinha na paleta nova, login e cadastro, checagem de acessibilidade com axe-core, capturas finais em `docs/screenshots/final/`; D040: ordem de criação pelo banco (`seq`) |
| `feat/dashboard` | Dashboard do dia em tempo real (faturamento com quebra, ticket alternável, comparação com a semana anterior ou a média de 4 semanas até o mesmo momento, "Atenção agora", canais, mais vendidos, pedidos por hora, conciliação exata com o caixa, visão de rede); relatórios por período (vendas com curva ABC e mapa de calor, pagamentos, garçons, controle de perdas, tempos de preparo) com CSV e impressão A4; gráficos em SVG próprio com tokens do tema; 90 dias de histórico determinístico no seed |

### Decisões recentes (detalhes em DECISOES.md)

- **D039 Redesign:** escuro como padrão, tema por aparelho, cores e tamanhos só por tokens com contraste testado (cartão, fundo e trilho); mapa único de atalhos (sensíveis sem tecla, F9 com trava de 1 s); checagem de acessibilidade com axe-core (`tools/ui-walkthrough/a11y.mjs`).
- **D040 Ordem pelo banco:** `seq` (autoincremento) nas tabelas de eventos e desempate estável em toda ordenação por horário; os testes passam com o relógio saltando.
- **D038 Relatórios:** faturamento = pedidos concluídos no dia de negócio da conclusão; "a receber" à parte (total − tudo o que já foi pago; estorno não reabre a dívida, regra também do "a receber" do caixa); estorno de concluído abatido no dia do estorno; pagamentos guardam o dia de negócio do caixa; conciliação exata testada no e2e; comparação até o mesmo momento do dia.
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

### Consultas em paralelo na mesma conexão (corrigido em `fix/pg-concurrent-queries`)

- O aviso `client.query() when the client is already executing a query` vinha de leituras com várias relações (`include`) dentro de `$transaction`: o Prisma 7 busca as relações em paralelo na conexão da transação (caixa: `CashService.totals`/`findRow`; cardápio: carregadores de categoria, produto e grupo; contas de mesa: `openTab`). Nenhum `Promise.all` nosso estava dentro de transação. Essas leituras agora usam `findFirstSequential`, e o e2e reprova qualquer nova ocorrência.

## Próximos passos (nesta ordem)

### Agora: hospedagem (`chore/hosting`) — apresentar a proposta ANTES de codar

Servidor, domínio, HTTPS, backups, monitoramento e publicação de atualizações. Mostrar a proposta (opções e custos) ao usuário e esperar a aprovação antes de começar.

O redesign terminou em 2026-10-09 (detalhes em DECISOES.md, D039 e D040; tema e regras em DESIGN.md). Capturas finais versionadas em `docs/screenshots/final/`; as das fases ficaram fora do git em `docs/screenshots/redesign/` (no Windows: `\\wsl.localhost\Ubuntu-24.04\home\braian\projetos\GastroHub_v2\docs\screenshots\redesign`).

### Antes do lançamento (não é etapa de código agora)

**Assinatura de código agora é requisito obrigatório** (Smart App Control do Windows 11; ver ROADMAP, com a pesquisa do serviço de assinatura da Microsoft no Azure para empresas no Brasil). Certificado de assinatura de código para o `instalar-impressao.exe` e o `print-agent.exe` (ROADMAP, "Antes do lançamento"). O instalador já é gerado por `pnpm --filter @app/print-agent package -- --api <url>` (Inno Setup instalado no Surface por winget, por usuário; WinSW baixado da release oficial com SHA-256 fixado) e foi testado neste computador: instalação, serviço automático como LocalSystem, vínculo pela página local, impressão virtual, atualização por cima mantendo o vínculo e desinstalação limpa (serviço, programa e `C:\ProgramData\app-print-agent` com a credencial removidos). Reinício automático em falha testado em 2026-10-08 (agente morto: volta em 10 s; serviço morto: volta em 19 s, depois da correção `fix/print-agent-orphan`, em que o agente sai junto com o serviço e espera a porta liberar). O serviço ficou instalado no Surface, mas o teste de reinicialização ficou **reservado para o desktop de casa** (passo 4 acima). Falta: esse teste e uma impressora térmica física (rede e USB). No desktop de casa, para gerar o instalador: `winget install --id JRSoftware.InnoSetup -e --scope user`.

### Etapa `feat/table-qr` — apresentar a proposta ANTES de codar

QR Code na mesa: o cliente sentado no salão faz o pedido pelo celular e os itens viram rodadas na conta da mesa (sessão). Decidido na `feat/digital-menu`: etapa própria, logo depois, reaproveitando os componentes do `apps/menu` (cardápio, montagem de item, carrinho, preço pelo shared).

Ponto de partida: `TableSession`/contas e rodadas (D019, D025), canal `DINE_IN` do catálogo, `addItems`/`sendRound` no `OrdersService`, KDS por rodada (D027), app do cardápio (D032–D034) e a pré-conta com "aguardando pagamento".

O que a proposta precisa resolver: token do QR por mesa (impressão e troca do token), como o celular entra na conta (abre sessão ou entra na existente; várias pessoas na mesma mesa), confirmação pelo garçom antes de ir para a cozinha (evitar pedido de quem não está na mesa) ou envio direto configurável, chamar o garçom e pedir a conta, ver o consumo da mesa, taxa de serviço, limites contra abuso (reaproveitar D033), e o que muda no kanban, no mapa de mesas e no KDS.

Mostrar o modelo e as regras ao usuário, esperar aprovação e seguir a ordem de sempre.

## Pendências de decisão do usuário

- Nenhuma no momento. Próxima: aprovar a proposta da hospedagem quando for apresentada.

## Lembretes de ambiente

- **Testar no celular:** `pnpm start:lite --menu --lan` e `pnpm lan:links` (mesma rede Wi-Fi; regra do firewall em docs/SETUP.md). Prévia do link no WhatsApp: `pnpm tunnel:menu` (túnel temporário que se fecha em 30 min; expõe o ambiente de desenvolvimento).

- Surface (8 GB, projeto no WSL limitado a 5 GB + 8 GB de troca pelo `C:\Users\braia\.wslconfig`): `.env` com `POSTGRES_PORT=5433`, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`. Playwright headless, um navegador, sem paralelismo; pare os servidores antes de builds.
- Depois de reiniciar o Windows, abra o Docker Desktop antes do `pnpm test:e2e`/`start:lite` (o `global-setup` do e2e falha com "dockerDesktopLinuxEngine" se o engine estiver parado).
- Roteiros visuais: `pnpm db:seed` antes de cada um (eles alteram pedidos e saídas).
- Repositório público: nunca commitar `.env`, segredos ou dados reais; conferir `git diff --cached` antes de cada push.
