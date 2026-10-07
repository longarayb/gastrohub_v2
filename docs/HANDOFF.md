# Passagem de bastão

> **Leia este arquivo primeiro** ao iniciar uma sessão. Depois: [CLAUDE.md](../CLAUDE.md) (convenções e regras de trabalho em duas máquinas), [PROMPT_INICIAL.md](PROMPT_INICIAL.md) (requisitos completos), [DECISOES.md](DECISOES.md) e [ROADMAP.md](ROADMAP.md).
>
> Atualizado em **2026-10-07**, no Surface (`C:\GastroHub_v2`), ao fim da etapa `feat/digital-menu` (cardápio digital público, pedidos pelo celular e acompanhamento).

## Estado atual

- `main` contém tudo o que foi feito; todas as branches estão no GitHub (`longarayb/gastrohub_v2`, público). Nenhuma frente em paralelo.
- Validação no último commit da `feat/digital-menu`: `pnpm check` verde (18 tarefas; unitários: shared 209, api 22, web 5), `pnpm format:check` verde, `pnpm test:e2e` com 84 testes (e a guarda que reprova consultas paralelas na mesma conexão), roteiros visuais `digital-menu.mjs` 11/11 (precisa de `pnpm start:lite --menu`), `delivery.mjs` 16/16, `orders.mjs` 18/18, `pos.mjs` 12/12, `kds.mjs` 8/8, `menu.mjs` 15/15 e `auth.mjs` 19/19 (cada um com `pnpm db:seed` antes).
- Migrations: `auth_tenancy`, `menu`, `orders`, `tables_pos`, `kds`, `delivery`, `digital_menu`. Um clone novo fica igual com `pnpm bootstrap` (ou `pnpm --filter @app/api db:deploy` + `pnpm db:seed`).

### Desktop de casa, na próxima sessão

1. `git pull` na `main` e `pnpm install` (dependência nova: `qrcode` no app do cardápio; o `@tanstack/react-query` saiu dele).
2. Compare o `.env` com o `.env.example` e acrescente `MENU_INTERNAL_URL`, `MENU_REVALIDATE_SECRET` e `TRUST_PROXY` (além das anteriores: `POSTGRES_PORT=5432`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `CHECK_CONCURRENCY`, `NEXT_BUILD_CPUS`, `LOGIN_RATE_LIMIT_PER_MINUTE=300`, `GEOCODING_PROVIDER`, `NOMINATIM_URL`, `NOMINATIM_EMAIL`).
3. `pnpm --filter @app/api db:deploy` (migrations `delivery` e `digital_menu`) e `pnpm db:seed`.
4. Para ver o cardápio: `pnpm start:lite --menu` e http://localhost:3001/demo.

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
| `feat/digital-menu` | App `menu` com a marca do restaurante (cor, logo, capa; a nossa só no "feito com"), renderizado no servidor com cache atualizado pela API, SEO e imagem de prévia de link; aberto/fechado com próxima abertura; item com complementos, pizza e combos pelas funções do shared; checkout com área, taxa, mínimo, "grátis acima de", cupom, pagamento na entrega (troco, cartão, PIX), consentimento LGPD e "Não é você?"; limites contra trote (telefone, IP largo, pendentes), honeypot e telefones bloqueados; recusa com motivo para o cliente e nota interna; acompanhamento em tempo real por token não adivinhável com QR do PIX após o aceite e "Já paguei" (visível no kanban, caixa e entregador); configurações em Configurações › Cardápio digital |

### Decisões recentes (detalhes em DECISOES.md)

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

### 1. Etapa `feat/printing` — proposta apresentada, aguardando aprovação

Ordem combinada: **`feat/printing` → `feat/dashboard` → `feat/table-qr`** (fechar o escopo do MVP antes do QR na mesa). A proposta da impressão foi apresentada na sessão de 2026-10-07 (agente local, impressoras por unidade, fila com confirmação, layouts 58/80 mm, vínculo por código, instalação sem ajuda técnica; NFC-e fora). Aguardar a aprovação e seguir a ordem de sempre.

### 2. Etapa `feat/dashboard`

Depois da impressão. Apresentar a proposta antes de codar.

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
