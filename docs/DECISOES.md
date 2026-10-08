# Decisões técnicas

Formato: decisão — motivo. Novas decisões são adicionadas ao final.

## D001 — Tenant = unidade (`Store`)
Cada unidade é um tenant isolado com cardápio, clientes, mesas e caixa próprios. A `Organization` agrupa as unidades de um mesmo dono; usuários acessam unidades via `Membership` (com papel por unidade).
**Motivo:** é o modelo operacional mais comum (cada loja tem preços e operação próprios) e mantém o isolamento simples. Compartilhamento de cardápio entre unidades pode vir depois como "cópia/sincronização".

## D002 — Isolamento por Prisma Client Extension + AsyncLocalStorage
O `tenantId` vem do JWT, é guardado no contexto da requisição (nestjs-cls) e uma Prisma Client Extension injeta o filtro/valor em todas as operações dos modelos de negócio. Query em modelo tenant-scoped sem tenant no contexto lança erro.
**Motivo:** isolamento centralizado, impossível de "esquecer" em uma query. Postgres RLS fica como segunda camada na Fase 2.

## D003 — Dinheiro em centavos inteiros
Todos os valores monetários são `Int` (centavos). Formatação apenas na UI.
**Motivo:** evita erros de ponto flutuante em somas, descontos e divisão de conta.

## D004 — Domínio de cálculo em `packages/shared`
Funções puras de cálculo (pedido, pizza, troco, divisão, caixa) ficam no pacote compartilhado.
**Motivo:** o PDV e o cardápio digital exibem exatamente o mesmo cálculo que o backend aplica; o backend sempre recalcula e é a fonte da verdade.

## D005 — Vitest em todo o monorepo
API com Vitest + SWC (suporte a decorators/metadata do NestJS); e2e com Supertest em banco de teste dedicado.
**Motivo:** um único runner, mais rápido que Jest e com a mesma API.

## D006 — Autenticação
Access token JWT (15 min) + refresh token rotativo (30 dias) em cookie httpOnly, armazenado com hash no banco e invalidado em reuso. Senhas com argon2id. RBAC por papel com matriz de permissões compartilhada.

## D007 — Tempo real com Socket.IO + Redis adapter
Salas `tenant:{id}`, `tenant:{id}:sector:{id}` e `order:{publicId}` (acompanhamento público). Redis adapter para escalar horizontalmente.

## D008 — Numeração diária por unidade
Tabela `OrderSequence (tenantId, businessDate)` incrementada com upsert atômico na mesma transação da criação do pedido. `businessDate` calculada em `America/Sao_Paulo`.

## D009 — Pizza meio a meio
Preço por sabor e por tamanho; regra configurável por produto: `HIGHEST` (maior valor, padrão do mercado) ou `AVERAGE` (média, arredondada para cima ao centavo).

## D010 — Entrega por raio usa geocodificação Nominatim
ViaCEP não retorna coordenadas. Endereços são geocodificados via Nominatim/OpenStreetMap atrás de `GeocodingProvider`; se falhar, permite ajuste manual ou cai na zona por bairro.

## D011 — E-mail e uploads em dev
`MailProvider` com envio via fila BullMQ; em dev usa SMTP do **Mailpit** (Docker, UI em http://localhost:8025). `StorageProvider` grava em disco local em dev (adapter S3 futuro).

## D012 — Impressão via navegador na Fase 1 (substituída por D035 na impressão automática)
Comanda e cupom não fiscal renderizados em HTML/CSS 80mm e impressos com `window.print()`. Fila `print` e interface `PrintProvider` prontas para um agente ESC/POS local.

## D013 — Apps rodam no host, infra no Docker
`pnpm dev` sobe Postgres, Redis e Mailpit via Compose e roda as apps no Windows (hot reload rápido). Perfil `full` do Compose sobe tudo em containers.

## D014 — Nomes neutros e marca centralizada
O nome do produto é provisório. Pacotes usam o escopo `@app/*`; banco, usuário e containers usam `app`/`app_db`; o cookie de refresh é `app_refresh`. Nome, slogan, logo e cores ficam apenas em `packages/shared/src/brand.ts` (`BRAND`), e as cores primárias chegam ao tema via `brandCssVariables()`. `APP_NAME` pode sobrescrever o nome em e-mails e no Swagger.
**Motivo:** permitir trocar a marca editando um único arquivo, sem migração de banco, renomeação de pacotes ou mudanças de infraestrutura.

## D015 — Cardápio por unidade
O cardápio (categorias, produtos, tamanhos, complementos, setores) pertence à unidade (`tenantId` = `Store`). Duas unidades do mesmo dono têm cardápios independentes.
**Motivo:** preços, itens e disponibilidade costumam variar por loja e o isolamento por tenant continua simples. Cópia entre unidades e cardápio compartilhado da rede estão no roadmap.

## D016 — Modelo do cardápio
- **Tamanhos** são uma entidade única (`Size`) com dono na categoria (pizza: tamanhos compartilhados pelos sabores, com `maxFlavors`) ou no produto (`SIZED`: bebida lata/600 ml/2 L). Preços por tamanho em `ProductSizePrice`.
- **Complementos reutilizáveis:** `ModifierGroup` + `ModifierOption`, vinculados por `ModifierGroupLink` à categoria ou ao produto, com mínimo, máximo e ordem por vínculo. O vínculo do produto sobrepõe o da categoria e pode desligar (`isDisabled`) um grupo herdado. Opções podem ter preço por tamanho (`ModifierOptionSizePrice`).
- **Combos:** `ModifierOption.productId` opcional referencia um produto do cardápio; nome e setor vêm do produto, o preço é o da opção (normalmente zero ou um acréscimo) e o snapshot registra o produto referenciado.
- **Pizza:** frações iguais (1/2, 1/3, 1/4); regra de preço por restaurante (`Store.pizzaPricingRule`: maior valor ou média arredondada para cima ao centavo); complementos da categoria (borda) entram uma vez por pizza.
- **Sem preço por canal** e **promoção sem período** nesta fase (modelo comporta `ProductChannelPrice` e promoção agendada depois).
- **Exclusão lógica** (`deletedAt`) em categorias, produtos, grupos e opções; pedidos guardam snapshot (nome, preço cheio e cobrado, sabores com observação, complementos) e nunca dependem do cardápio atual.

## D017 — Pausa "Acabou" até o fim do dia de negócio
`pausedUntil` é o fim do **dia de negócio** da loja, calculado pelos horários de funcionamento (turnos que passam da meia-noite pertencem ao dia em que começam). Ex.: loja de sexta 18:00–02:00, pausa às 23:00 de sexta → volta sábado 02:00. Sem horários cadastrados, usa a meia-noite do dia civil. As janelas de `AvailabilitySchedule` seguem a mesma lógica e também podem virar a meia-noite.

## D018 — Imagens em WebP
Uploads passam pelo `sharp`: imagem principal até 800 px e miniatura de 240 px, WebP qualidade 80, sem EXIF. O banco guarda a chave do arquivo (`imageKey`); a URL é derivada pelo `StorageProvider` (disco local agora, S3/R2 depois).

## D019 — Pedidos: conta, rodadas e sessão de mesa
Um pedido (`Order`) é uma **conta**. Pedidos de mesa recebem itens em **rodadas** (`OrderRound`), cada uma enviada à cozinha de uma vez; balcão e delivery têm uma única rodada. A ocupação física é a **sessão de mesa** (`TableSession`), que pode reunir várias mesas (juntar mesas) e **várias contas abertas ao mesmo tempo** (casal que paga separado, comanda individual em bar). Mover itens entre contas (transferência e divisão por itens) é feito movendo linhas de `OrderItem` entre pedidos, com auditoria.
**Motivo:** a conta é a unidade de pagamento; dividir, transferir e juntar viram operações sobre itens e pagamentos, sem números e cards duplicados por rodada.

## D020 — Valores do pedido
Ordem: desconto por item → desconto do pedido → cupom (sobre o que restou; mínimo verificado no subtotal) → **taxa de serviço sobre o resultado** (nunca sobre a entrega nem sobre si mesma) → + taxa de entrega. Cada etapa é limitada a zero. Percentuais convertidos para centavos no ponto de aplicação, arredondando metade para cima. Funções em `shared/domain/order-totals.ts`; o backend sempre recalcula.
Taxa de serviço por padrão só em pedidos de mesa, configurável por tipo de pedido (Empresa). Pode ser removida de um pedido a pedido do cliente, com permissão `orders:discount` e auditoria (`order.service_fee_removed`).

## D021 — Numeração e dia de negócio
Número sequencial por unidade e dia de negócio via `OrderSequence` com `INSERT … ON CONFLICT DO UPDATE … RETURNING` na mesma transação da criação (sem repetição em pedidos simultâneos; número não é consumido se a criação falhar). O dia de negócio usa `currentBusinessDay`, a mesma regra do "Acabou" (turnos que passam da meia-noite pertencem ao dia em que começam).

## D022 — Concorrência, idempotência e tempo real
- Pedido com `version`: alterações enviam a versão vista; `UPDATE … WHERE version = ?`; conflito → 409 com mensagem em pt-BR.
- Criação com `Idempotency-Key` (obrigatória no cardápio digital): mesma chave + mesmo corpo devolve o pedido existente; corpo diferente → 409.
- Socket.IO autenticado por access token, salas por unidade e por setor; eventos são avisos (`{ id, version, status }`) emitidos após o commit; a tela refaz a busca ao reconectar ou voltar o foco. Som de novo pedido liberado por clique ("Ativar som") por causa do bloqueio de áudio dos navegadores.

## D023 — Pagamentos
- Vários pagamentos por pedido; pagamento parcial deixa a conta aberta. O valor aplicado nunca passa do saldo; **só dinheiro** pode ser entregue a mais, e o excedente é o troco (`receivedCents − amountCents`). `paidCents` e `paymentStatus` são recalculados na transação, com `expectedVersion` (funções em `shared/domain/payments.ts`).
- **Fechamento:** mesa e balcão só fecham (`DELIVERED`) com saldo zero. Delivery pode ser entregue com saldo — fica em "a receber" (`GET /orders?receivable=true`) até o entregador prestar contas.
- **Online/marketplace (`ONLINE`):** pedidos já pagos fora do sistema (iFood e similares; no futuro, o pagamento online do cardápio digital) são quitados sem caixa aberto e nunca entram no valor esperado do caixa.
- **Cartão:** bandeira e código de autorização/NSU opcionais (crédito ou débito é a própria forma), para a conciliação com a maquininha e o financeiro.
- **Estorno:** permissão `payments:refund` (dono e gerente), motivo obrigatório e auditoria (`payment.refunded`); só em contas abertas (ou delivery a receber). Cancelar um pedido exige estornar os pagamentos antes; nenhuma alteração pode deixar o total abaixo do valor já pago.

## D024 — Caixa por operador
- Um caixa aberto por operador (garantido no banco por `openOperatorId` único, preenchido só enquanto aberto). Na troca de turno, um fecha e o outro abre; quem tem `cash:manage` pode fechar o caixa de outro operador.
- **Esperado por forma** = pagamentos recebidos naquele caixa − estornos feitos nele; no dinheiro, + troco inicial + suprimentos − sangrias (o dinheiro entra líquido do troco). Sangria e estorno em dinheiro não podem passar do dinheiro esperado na gaveta.
- **Um caixa fechado nunca muda:** o estorno sai do caixa aberto de quem estorna (`Payment.refundSessionId`).
- **Fechamento cego** (configurável na tela Empresa, ligado por padrão): enquanto o caixa está aberto, quem não tem `cash:manage` não vê os totais nem os valores dos pagamentos; a diferença aparece depois de confirmar a contagem. A contagem fica em `CashSessionCount` (esperado congelado, contado, diferença).
- **Concorrência:** cada pagamento, estorno e movimento incrementa a `version` do caixa aberto (o que trava a linha); o fechamento usa `expectedVersion`. Um pagamento nunca entra num caixa que está sendo fechado: ou ele falha ("Abra o caixa"), ou o fechamento recebe 409 e a tela recarrega.
- **Reabertura:** só `cash:manage`, com motivo; a contagem anterior vai para a auditoria (`cash.reopened`) e é refeita no novo fechamento.

## D025 — Divisão da conta e operações de mesa
- **Por igual:** calculadora de pagamentos parciais sobre a mesma conta (`splitEvenly`; centavos que sobram vão para as primeiras partes). Não cria contas novas.
- **Por itens:** move linhas (ou parte da quantidade) para outra conta da mesma sessão ou para uma conta nova. Desconto em valor da linha é repartido proporcionalmente; percentual vale nas duas partes. Cada conta recalcula a própria taxa de serviço; desconto e cupom do pedido ficam na conta de origem. Rodadas são recriadas na conta de destino com o mesmo horário de envio. Auditoria `order.items_moved`. Dividir um único item (meia pizza para cada um) fica fora da Fase 1.
- **Mesas:** transferir conta (vai para a sessão da mesa destino ou abre uma), trocar a mesa do grupo por uma livre, juntar sessões (mesas e contas vão para uma, a outra fecha) e separar (a mesa sai com as contas escolhidas; sem contas, fica livre). Todas auditadas.
- **Pré-conta:** 80 mm pelo navegador (D012), com itens, "taxa de serviço (opcional)", sugestão de divisão e QR PIX opcional; ao imprimir, a mesa fica "aguardando pagamento" (`TableSession.billRequestedAt`) até uma nova rodada.
- **Atalhos do caixa:** F2 busca, F4 receber, 1–7 forma de pagamento, Enter confirma, Esc volta, F8 pré-conta, F9 sangria (`useHotkeys`; teclas comuns não disparam enquanto se digita).

## D026 — PIX estático
QR Code estático no padrão BR Code (EMV), montado por função pura (`buildPixBrCode`, CRC16-CCITT conferido com o exemplo do manual do Banco Central). Chave validada e normalizada por tipo (CPF/CNPJ só dígitos, e-mail minúsculo, celular `+55…`, aleatória minúscula); nome até 25 e cidade até 15 caracteres, sem acentos. O **txid é o `publicCode` do pedido** (8 caracteres alfanuméricos, dentro do limite de 25) e fica no pagamento (`externalRef`). Confirmação manual pelo operador; PIX dinâmico com confirmação automática fica para o `PaymentGateway` (Fase 2).

## D027 — KDS: tarefas de produção, tickets e status automático
- **Tarefa de produção** (`ProductionTask`): o que um setor prepara de um item enviado, criada no envio da rodada pela função pura `routeItem` (shared). A linha vai para o setor do produto (ou o padrão); complemento de combo que referencia produto de **outro** setor vira tarefa própria nesse setor (`COMBO_PART`, quantidade = linha × opção) — a bebida do combo vai para o bar. A mesma estrutura serve à impressão por setor.
- **Ticket** = (rodada, setor): itens acrescentados depois numa mesa são ticket novo. Pedidos não aceitos (`PENDING`) não aparecem.
- **Status automático:** o item deriva das suas tarefas (`deriveItemStatus`); o pedido vai para "em preparo" quando a primeira tarefa começa, para "pronto" quando todas as tarefas ativas de todas as rodadas ficam prontas e volta para "em preparo" se um "pronto" for desfeito ou chegar rodada nova (`kitchenTransitions`). Pedidos fora da cozinha (despachados, entregues, cancelados) nunca mudam por aqui. Os botões do kanban continuam valendo para quem não usa KDS (marcar pronto, despachar ou fechar conclui as tarefas abertas).
- **Desfazer pronto:** volta para "em preparo", conta `recallCount` e audita (`kds.task_recalled`); bloqueado depois de o item ser entregue.
- **Cancelamento** de item ou do pedido inteiro após o envio marca as tarefas como canceladas: aparecem riscadas, com som próprio, e saem da tela após 15 minutos ou no "Ok".
- **Mover itens entre contas** leva as tarefas junto (ou divide a quantidade, `scaleTaskQuantity`).
- **Limites de alerta por setor** (`warnAfterMinutes` amarelo, `lateAfterMinutes` vermelho); o antigo `Store.kdsLateAfterMinutes` foi migrado para os setores e removido. Setor que já recebeu tarefas não pode ser excluído (desativa-se).
- **Expedição:** visão de todos os setores por pedido. Mesa e balcão: "Entregue" marca os itens da rodada como servidos e tira da tela, **sem mudar o status do pedido** (fechar a conta continua no caixa). Delivery: "Saiu para entrega" com escolha do entregador, mesmas regras do kanban (versão, pedido pronto).
- **Tela:** "Pronto (recentes)" mostra só os últimos 15 minutos e no máximo 20 tickets; o cronômetro usa o relógio do servidor; ticket pronto mostra o tempo total congelado. Remoções ("sem cebola", "tirar", "retirar", "não colocar") são detectadas por regra pura (`isRemoval`) em complementos e observações e aparecem em destaque.
- **Dados para relatórios:** `sentAt`, `startedAt`, `readyAt`, `canceledAt`, `recallCount` e quem marcou (usuário ou dispositivo) por tarefa e setor.

## D028 — Telas da cozinha (dispositivos)
- O gerente (`store:manage`) cria a tela em Setores (nome, setores, expedição) e recebe um **código de 6 dígitos** válido por 10 minutos. No tablet, `/kds/vincular` pede o código da unidade (slug) + o código.
- **Segurança do vínculo:** código guardado só como hash (com o tenant); cada erro conta em todos os códigos pendentes da unidade e **5 erros invalidam** o código; **20 falhas em 15 minutos bloqueiam** a unidade (429); limite por IP de 10 tentativas por minuto; tentativas falhas auditadas (`kds.pairing_failed`, com IP); uso único.
- **Credencial:** cookie httpOnly `app_device` (caminho `/api/kds-device`, 180 dias, renovado e rotacionado a cada uso), trocado por access tokens curtos com o papel interno `KDS_DEVICE` — só `kds:operate` e `menu:pause` ("Acabou"). Rotas sem permissão explícita recusam dispositivos; o dispositivo só vê os próprios setores (e a expedição, se marcada).
- **Revogação:** imediata — o guard confere o dispositivo a cada requisição, o socket recusa e a tela recebe `device.revoked` e volta para o vínculo.
- No painel, o token do dispositivo fica separado do da sessão de usuário (tem prioridade na aba) e é renovado pelo cookie; usuários com `kds:operate` também podem abrir `/kds` com login normal.
- **Uso contínuo:** "Toque para iniciar" ativa som, tela cheia e Wake Lock de uma vez (bloqueio de autoplay dos navegadores); Wake Lock reativado ao voltar à aba; um único socket e um único timer, limpos ao sair; consultas antigas descartadas do cache em 1 minuto; refetch a cada 30 s como rede de segurança e a cada reconexão.

## D029 — Áreas de entrega, taxa e geocodificação
- **Área** (`DeliveryArea`) por **bairro** (padrão sugerido nas telas: funciona sem mapa) ou por **raio** a partir da loja. Cada área tem taxa, tempo, pedido mínimo opcional (senão vale o da loja), "grátis acima de" e suspensão temporária (motivo e retomada automática opcional, auditadas: `delivery.area_paused` / `delivery.area_resumed`).
- **Bairro aceita variações de nome** ("Centro", "Centro Histórico"); a comparação ignora acentos e maiúsculas (`normalizePlace`) e um bairro só pode estar em uma área da mesma cidade. A tela de áreas lista os bairros de pedidos e clientes dos últimos 60 dias que não bateram com nenhuma área, com um botão para incluí-los numa área existente.
- **Resolução** por função pura (`resolveDeliveryArea`): primeiro o bairro; depois o **menor raio** que cobre as coordenadas. Uma área suspensa recusa o endereço (sem cair em outra). Sem coordenadas quando há área por raio, ou fora de todas as áreas, o operador **escolhe a área à mão** (`areaSource = MANUAL`). Loja sem áreas: a taxa é digitada (`NONE`). Pedidos de marketplace trazem a própria taxa.
- **Taxa:** a da área é sugerida (zero acima do "grátis acima de"); **reduzir exige `orders:discount` e motivo**; **qualquer alteração**, inclusive aumento, vai para a auditoria (`delivery.fee_changed`). O pedido guarda a área, a origem, a taxa sugerida, o motivo, o tempo e a distância (`OrderDelivery`). No PDV o mínimo da área é aviso; no cardápio digital é bloqueio.
- **Geocodificação** (`GeocodingProvider`): Nominatim para começar, **enviando só o endereço** (nunca nome ou telefone do cliente), no máximo 1 requisição por segundo, timeout de 3 s, e só quando uma área por raio precisa das coordenadas. As coordenadas ficam no endereço salvo do cliente e no pedido (links do Google Maps e do Waze mais precisos). Falha = escolha manual da área. **Produção com volume exigirá um serviço pago ou um Nominatim próprio** atrás da mesma interface (a política do servidor público não permite uso intenso). Nos testes o provedor é desligado (`GEOCODING_PROVIDER=none`).

## D030 — Saídas, entregadores e app do entregador
- **Saída** (`DeliveryRun`): um entregador sai com um ou mais pedidos prontos (mesma rota); cada tentativa de entrega é uma **parada** (`DeliveryStop`) com horários de saída, entrega ou falha e "como o cliente pagou". Um entregador tem no máximo uma saída aberta (`openCourierId` único, linha do entregador travada); pedido despachado para quem já está na rua entra na mesma saída. `DISPATCHED` exige entregador (kanban, detalhe do pedido e expedição do KDS usam a mesma regra). O status do entregador (disponível, em rota, inativo) é calculado, nunca gravado.
- **Entrega não realizada:** motivo (cliente ausente, endereço não encontrado, recusado, outro com descrição). O pedido **volta para "Pronto"** com o motivo visível no kanban, no detalhe e na expedição; o operador reenvia (na mesma saída, se o entregador ainda está fora, ou numa nova) ou cancela com as regras de cancelamento e estorno de sempre. Auditoria `delivery.failed`; as falhas aparecem no acerto e nos relatórios.
- **App do entregador** (`/entregas`, papel Entregador com a permissão `courier:app`): o entregador vê **só as entregas da própria saída em andamento** (LGPD) — nada do kanban, de outros pedidos ou de saídas encerradas. Botões grandes: mapas, ligar, "Entregue" (com forma de pagamento, valor e troco quando há saldo), "Não entregue" e "Voltei para a loja" (só sem entregas em aberto). Dono e gerente não têm `courier:app`.
- **Maquininha:** nesta etapa só a do restaurante (o entregador leva a da loja e entrega os comprovantes no acerto). Maquininha própria do entregador ficou no ROADMAP.

## D031 — Acerto do entregador e remuneração
- **Acerto** no caixa aberto de quem acerta (`cash:operate`): o que o entregador recebeu vira **pagamento dos pedidos nesse caixa** (forma declarada pelo entregador, conferida pelo operador); dinheiro e comprovantes de cartão contados contra o esperado (`settlementSummary`). Falta ou sobra de dinheiro corrige a gaveta com sangria ou suprimento ("Falta/Sobra no acerto do entregador"). Só saídas sem entregas em aberto entram; a saída fica `SETTLED`.
- **Remuneração** configurável na loja e por entregador (o entregador sobrepõe a da loja): por entrega, % da taxa de entrega e **diária** — paga uma vez por dia de negócio, no primeiro acerto do dia. Entrega não realizada não remunera.
- **Saldo corrente** (`CourierLedgerEntry`): cada acerto lança a remuneração; a falta de dinheiro pode ser **descontada** do que a loja deve; cada pagamento abate. No acerto o operador escolhe **"Pagar agora"** (sangria auditada, `courier.payout`) ou **"Acumular"**; o acerto mostra o saldo anterior e o novo. Pagamento avulso do saldo (ex.: semanal) também sai como sangria. Saldo positivo = a loja deve ao entregador; falta não descontada fica registrada no acerto ("entregador deve à loja").
- **Relatório de entregas:** taxa de entrega separada do valor dos produtos; por área e por entregador: entregas, não entregues, tempo médio saída → entrega e pedido → entrega, atrasos (acima do tempo da área); "quem deve a quem" (saldos e faltas do período).
- **Preparado para depois:** o acompanhamento pelo cliente e o cardápio digital reaproveitam a área, o tempo e as paradas (horários de saída e entrega).

## D032 — Cardápio digital: marca do restaurante, desempenho e SEO
- **A marca é do restaurante:** nome, logo, cor principal (`Store.brandColor`, `#RRGGBB`), capa e descrição. A cor vira `--primary` com o texto calculado por contraste (`readableForeground`); sem cor, tema neutro — nunca a nossa cor. A nossa marca aparece só no rodapé ("feito com {BRAND.name}", lido do `brand.ts`).
- **Renderização no servidor** (Next, `apps/menu`), com cache por restaurante: as páginas usam a tag `store:{slug}` e a API pede a atualização (`POST /api/revalidate` no app do cardápio, segredo `MENU_REVALIDATE_SECRET`) depois de mudanças no cardápio, na loja ou nas áreas de entrega (interceptor nas rotas de escrita, com debounce). Rede de segurança: 5 minutos. Aberto/fechado e "esgotado" são recalculados no aparelho; o servidor confere tudo de novo no pedido.
- **Leve no celular:** nada de Zod nem de biblioteca de cache no navegador (as regras puras saíram dos arquivos de schema: `domain/opening-hours.ts`, `orders/payment-methods.ts`); as gavetas de item e de carrinho carregam no primeiro toque. Medido no roteiro com 3G simulado: LCP ~0,9 s e ~171 KB de JS transferidos (a maior parte é a base do React/Next). Imagens em WebP (miniatura de 240 px na lista) com carregamento preguiçoso.
- **SEO e compartilhamento:** título, descrição, canonical, Open Graph e Twitter por restaurante, imagem de prévia gerada (`opengraph-image`, 1200×630, com a cor, o logo e a capa), JSON-LD `Restaurant` com horários e endereço, `sitemap.xml` (lista pública de slugs) e `robots.txt` (acompanhamento fora dos buscadores).
- **Aberto ou fechado:** horários e pausas de sempre. Fechado: o cardápio continua navegável com "Fechado · abre hoje às 18:00" (`storeOpenState`, inclusive turnos que passam da meia-noite) e o pedido fica bloqueado; "recebimento pausado" (`digitalMenuEnabled` desligado) mostra o cardápio sem pedidos. **Pedido agendado fica para uma etapa própria.**
- **Carrinho e preços:** item montado com as mesmas funções do painel (`priceCatalogItem`, complementos, pizza com sabores, combos); o carrinho fica no aparelho e é conferido contra o cardápio atual (`cartChanges`); a prévia (`POST /public/{slug}/cart`) é calculada pelo servidor (cupom, área, mínimo, "grátis acima de"); no envio, total diferente do mostrado responde 409 com os valores novos.

## D033 — Pedido pelo cardápio: identificação, pagamento e abuso
- **Sem cadastro:** nome e celular com DDD. Nome, telefone e endereço ficam salvos **só no aparelho**; nunca mostramos endereços a partir do telefone (qualquer um poderia digitar o número de outra pessoa). "Não é você? Limpar meus dados" apaga o que está salvo no navegador.
- **Pagamento na entrega ou na retirada:** dinheiro (troco para quanto), cartão na maquininha do restaurante e PIX. O QR do PIX estático aparece no acompanhamento **só depois do aceite**; "Já paguei" grava `pixReportedAt` e mostra "PIX informado pelo cliente · conferir" no kanban, no detalhe, no caixa e na tela do entregador — a confirmação continua manual (caixa ou acerto). Pagamento online entra depois pelo `PaymentGateway` (`Payment ONLINE` já existe, sem caixa).
- **Abuso** (configurável por restaurante em Configurações › Cardápio digital): **por telefone é a proteção principal** (2 pedidos em andamento, 10 por dia); por IP é largo de propósito (30 por hora — operadoras usam CGNAT), guardado só como hash; máximo de 20 pedidos do cardápio aguardando aceite; campo armadilha (honeypot) e tempo mínimo de preenchimento (1,5 s). Telefones bloqueados (`BlockedPhone`) recebem uma mensagem neutra ("ligue para o restaurante"). Idempotência pela `Idempotency-Key` do checkout. Verificação por código (SMS/WhatsApp, `OtpProvider`) e captcha ficam como opção futura.
- **Recebimento:** o pedido chega `PENDING` com o som do kanban; aceite automático configurável. **Recusa** (`orders:cancel`) com motivo pronto voltado ao cliente (item esgotado, fora do horário de entrega, restaurante muito movimentado, endereço fora da área, outro com texto) e observação interna separada, que o cliente nunca vê; opção de bloquear o telefone na hora.
- **Entrega:** CEP com ViaCEP, área, taxa, mínimo (bloqueante no cardápio), "grátis acima de" e prazo pelas funções de D029. Fora da área, área suspensa e endereço não localizado têm mensagens próprias; essas buscas entram em `DeliveryQuoteMiss` e aparecem em "Bairros sem área".

## D034 — Acompanhamento e LGPD
- **Acompanhamento** em `/{slug}/pedido/{token}`: `Order.trackingToken` aleatório de 128 bits (o `publicCode` de 8 caracteres continua como referência e txid do PIX). Mostra número, linha do tempo, prazo, itens, total, forma de pagamento e só o bairro — sem telefone, endereço completo ou dados do entregador. Tempo real pelo namespace público `/tracking` (entra só na sala do próprio token; transmite status e versão), com polling de 30 s como reserva. Fica acessível por 7 dias depois de encerrado; `noindex`.
- **LGPD:** o restaurante é o controlador. Aviso de privacidade com modelo preenchido com os dados da loja (`privacyNoticeTemplate`) e texto próprio editável — a tela avisa que é um **modelo** e que o restaurante deve revisá-lo, de preferência com apoio jurídico. Consentimento obrigatório no pedido, registrado no cliente com data e versão (`privacyAcceptedAt`, `privacyVersion`); opt-in de marketing separado e desmarcado. Os clientes são por unidade (tenant): o mesmo telefone em dois restaurantes são dois cadastros, sem cruzamento. O geocodificador recebe só o endereço (D029).

## D035 — Impressão automática: agente local por computador
- **Substitui D012** para a impressão automática; o navegador (`window.print`) continua como alternativa manual em toda tela que imprime (sem agente ou sem impressora do caixa).
- **Agente próprio** (`apps/print-agent`, Node 24 empacotado como executável único) instalado como **serviço do Windows** (WinSW: inicia com o Windows e reinicia sozinho em falha) pelo `instalar-impressao.exe` (Inno Setup). Comparado com QZ Tray (Java, certificado e confirmação por site) e a impressão silenciosa do Chrome (sem ESC/POS nem guilhotina, depende do navegador aberto), o agente imprime em segundo plano com o navegador fechado e fala ESC/POS direto.
- **Vários agentes por unidade** (ex.: PC do caixa e PC da cozinha), cada um com as **suas impressoras**; o painel mostra o estado de cada um (conectado, versão, memória, último contato, impressoras instaladas no Windows).
- **Segurança:** papel interno `PRINT_AGENT` (como `KDS_DEVICE`, nunca membership), que só arrenda, confirma e informa status (`print:agent`): não lê pedidos, clientes nem o painel, e não entra na sala de tempo real da unidade (só `print-agent:{id}`, com avisos sem conteúdo). Vínculo por código de 6 dígitos com os mesmos limites do KDS (10 minutos, 5 erros por código, 20 por unidade em 15 minutos, auditoria). Credencial longa (365 dias, renovada no uso, **sem rotação** — um PC que desliga no meio da renovação não perde o vínculo), guardada pelo Windows com **DPAPI** e revogável no painel com efeito imediato. Só conexões de saída; a página local (`127.0.0.1:9180`) escuta só no próprio PC, confere o `Host` (contra DNS rebinding) e usa token de formulário.
- **Conexões:** rede (TCP 9100, consulta o sensor de papel com `DLE EOT` antes de imprimir), USB ou compartilhada pelo spooler do Windows em modo RAW (PowerShell com P/Invoke, processo curto) e virtual (arquivo de texto, para desenvolvimento e demonstração).
- **Perfis por marca e modelo** (`PRINTER_PROFILES`: Elgin, Bematech, Epson, Daruma, Tanca e genéricos ESC/POS com página 860, 850 ou 1252): página de código, largura padrão, guilhotina, texto invertido (com a alternativa `*** texto ***`), bipe, QR e status. "Imprimir sem acentos" é o último recurso. A página de teste traz "Pão, maçã, açaí, coração" para conferir os acentos.
- **PC modesto:** meta de memória do agente **até 80 MB**; medido no executável final ~45 MB parado, ~54 MB conectado e ~59 MB depois de 40 comandas. Requisito mínimo **Windows 10 (1809 ou mais novo) ou 11, 64 bits** (o do Node 24).
- **Assinatura de código** só para produção (ROADMAP): sem ela o Windows mostra o alerta do SmartScreen na instalação.

## D036 — Fila de impressão (outbox) e entrega pelo menos uma vez
- **Outbox no banco** (`PrintJob`): o trabalho é gravado **na mesma transação** do evento (pedido aceito, rodada enviada, item cancelado), com o documento pronto (`PrintDocument` do shared: o que foi enviado, não o estado atual). Trabalhos automáticos têm `dedupeKey` única por unidade (`ticket:{rodada}:{setor}`, `delivery:{pedido}`, `cancel:...`): repetir a operação nunca duplica.
- **Quando imprime:** comanda por setor quando o pedido é aceito (pedidos do cardápio pendentes só imprimem no aceite) e a cada rodada enviada; via de entrega no aceite do delivery (configurável, ligado por padrão, 1–3 vias); item cancelado depois de impresso gera "CANCELADO" no setor (configurável, ligado); se a comanda ainda não saiu, ela é reescrita sem o item (ou descartada, sem aviso). Cada setor aponta para uma impressora com 1–3 vias; a impressora do caixa recebe pré-conta, via de entrega, fechamento de caixa e acerto do entregador.
- **Arrendamento e confirmação:** o agente recebe um aviso pelo tempo real (o heartbeat de 30 s cobre avisos perdidos), arrenda até 10 trabalhos por 60 s (atualização condicional: dois arrendamentos nunca pegam o mesmo trabalho) e confirma cada um com o número da tentativa (resposta atrasada de uma tentativa antiga é ignorada). Falha → nova tentativa em 5 s, 15 s, 30 s e depois a cada minuto, com o status da impressora (sem papel, desligada, erro).
- **Pelo menos uma vez, com marcas:** arrendamento vencido sem resposta volta à fila marcado **"POSSÍVEL 2ª VIA – confira"**; trabalho com mais de 2 minutos sai como **"IMPRESSÃO ATRASADA – Pedido das 19:42"**; mais velho que o limite (30 minutos, configurável) fica **retido** e o painel pergunta: imprimir (marcado como atrasado) ou descartar (auditado). Reimpressão manual sai como **"2ª VIA"** (auditada).
- **Alertas no painel:** ícone de impressora no topo com a contagem — computador sem contato há mais de 90 s, impressora sem papel/desligada/com erro, trabalhos retidos e trabalhos esperando há mais de 2 minutos ("Tentar agora").

## D037 — Documentos impressos
- Construídos por funções puras do shared (`printing/documents.ts`), iguais na prévia do painel e no agente: **comanda de produção** (setor, número grande, tipo e mesa/cliente — invertido no delivery —, rodada, hora, garçom, itens grandes com sabores, complementos, **remoções em branco no preto** como no KDS e observação), **"CANCELADO"**, **via de entrega** (endereço, referência, telefone, o que cobrar, troco a levar, "PAGO – NÃO COBRAR", "PIX informado pelo cliente: conferir", QR da rota), **pré-conta** (contas da mesa, divisão, QR do PIX), **fechamento de caixa**, **acerto do entregador** e **página de teste**. Documentos para o cliente dizem "Não é documento fiscal" (a NFC-e fica na etapa fiscal).
- 58 mm = 32 colunas, 80 mm = 48 colunas; quebra por palavra e colunas alinhadas; o codificador ESC/POS (`encodeEscPos`) aplica o perfil da impressora e repete as vias.
- O servidor monta os documentos sob demanda com os próprios dados (nunca um documento enviado pelo navegador).
