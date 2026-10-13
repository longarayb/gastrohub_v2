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

## D038 — Dashboard e relatórios: definições, conciliação e desempenho
- **Dia de negócio do pedido:** o pedido conta no dia em que foi **concluído** (`Order.closedBusinessDate`, gravado no `changeStatus` ao entregar/fechar ou cancelar), como no caixa. Mesa aberta antes da meia-noite e fechada depois conta no dia do fechamento. `businessDate` continua sendo o dia da numeração.
- **Faturamento** = pedidos concluídos (`DELIVERED`) do dia: produtos brutos (itens não cancelados) − descontos (item, pedido, cupom) = produtos líquidos; + taxa de serviço + taxa de entrega = total; − estornos de pedidos concluídos **feitos no dia** (como no caixa). Pedidos em andamento e cancelados ficam fora (cancelados vão para Controle de perdas). Delivery entregue e não pago conta e aparece também como **"a receber"** (total − tudo o que já foi pago; estorno não "reabre" a dívida; o "a receber" do caixa, `GET /orders?receivable=true`, usa a mesma regra). Ticket médio = faturamento ÷ pedidos concluídos, com a visão "só produtos" alternável no cartão.
- **Recebido** = pagamentos do dia − estornos do dia, por forma. Pagamento e estorno guardam o dia de negócio (`Payment.businessDate`, `refundBusinessDate`): o do caixa que recebeu (bate com o fechamento) ou o dia corrente (online). **Conciliação exata**, mostrada na tela e testada no e2e: recebido = faturamento − a receber − pago em outros dias (pedidos concluídos hoje) + recebido de pedidos de dias anteriores + recebido de pedidos ainda abertos + (pagos e estornados de cancelados). O e2e monta um dia com todos os casos (mesa aberta ontem e fechada hoje, delivery de ontem pago hoje, estorno, cancelado pago e estornado) e confere diferença zero, a soma dos caixas e o relatório de entregas (que também passou a contar pelo dia de conclusão).
- **Definições em um lugar só:** funções puras em `shared/domain/reports.ts` (`salesBreakdown`, `reconcile`, `compare` com direção do "melhor", `abcCurve`, `heatmap`, `durationStats`, `businessDayWindow`) e os textos do ⓘ (`REPORT_HELP`).
- **Comparação:** mesmo dia da semana anterior **até o mesmo momento do dia de negócio** (`sameMomentOn`), ou média das 4 semanas como opção.
- **Rede:** o dono de várias unidades da mesma organização vê o consolidado e cada unidade; cada unidade é calculada no **próprio contexto de tenant** e somada no servidor (nenhuma consulta cruza tenants). Gerente vê só a dele.
- **Curva ABC:** classe A enquanto o acumulado ANTES do item é < 80% (o item que cruza 80% ainda é A), B < 95%, C o resto.
- **Desempenho medido no Surface (8 GB) com 365 dias de histórico (23.740 pedidos):** dia ~100 ms; vendas 90 dias ~170 ms e 12 meses ~370 ms; perdas 12 meses ~240 ms; tempos 120 dias ~390 ms. Critério combinado (12 meses abaixo de 500 ms) atendido **sem tabelas de resumo**: formatador `Intl` em cache (criar um por chamada custava segundos), janela exata de instantes do período (`businessDayWindow`) em vez de converter cada linha, totais e canais agregados no banco, garçons agregados por rodada. Índices novos: `Order(tenantId, closedBusinessDate, status)`, `Payment(tenantId, businessDate)` e `(tenantId, refundBusinessDate)`, `ProductionTask(tenantId, sentAt)`, `AuditLog(tenantId, action, createdAt)`. Tabelas de resumo por dia ficam como plano se o volume crescer.
- **Limites:** períodos até 1 ano; tempos de preparo até 120 dias (usam todas as tarefas); a lista de eventos de perdas mostra os 500 mais recentes (totais, usuários, motivos e o CSV usam todos).
- **CSV** para Excel pt-BR (`;`, vírgula decimal, UTF-8 com BOM — o download no navegador recoloca o BOM, que o `res.text()` remove — e proteção contra fórmula). **Impressão A4** pela página nomeada `report` (`@page report`), sem mexer na impressão de cupom de 80 mm.
- **Visual:** componentes do dashboard seguem [DESIGN.md](DESIGN.md) só com tokens (`accent-*`, `signal-*`, `chart-1…5`, `chart-compare`, `track`, `rounded-card`, `font-display` = Nunito Sans); o tema completo do painel vem na etapa de redesign.
- **Seed:** 90 dias de histórico determinístico (sexta e sábado mais fortes, picos no almoço e no jantar, popularidade variada, cancelamentos concentrados num usuário, descontos, taxas retiradas, estornos, diferenças de caixa, tempos do KDS e de entrega), inserido em lote (`jsonb_populate_recordset`) e com limpeza rápida (`session_replication_role = replica` na transação, quando o usuário do banco é superusuário): seed completo em ~15 s. `HISTORY_DAYS=365` gera um ano para medir desempenho.


## D039 — Redesign do painel: tema, componentes base e telas de operação

Aprovada em 2026-10-08, em fases (A: menu lateral, layout e kanban; B: componentes; C: telas de operação; D: cozinha, login e fechamento), com aprovação visual ao fim de cada uma. Só muda a aparência: lógica, API, regras e textos ficam como estão.

- **Tema:** valores do [DESIGN.md](DESIGN.md) nos dois temas, em `packages/ui/src/styles/globals.css`. **Escuro é o padrão**; "Sistema" é uma opção que acompanha o sistema operacional ao vivo. A escolha fica **por aparelho** (`localStorage` do `next-themes`): o computador do caixa pode ficar no claro e o do escritório no escuro. A troca tem botão próprio no cabeçalho ("Tema deste aparelho"). A barra do navegador no celular acompanha o tema.
- **Cor principal:** o azul do DESIGN.md, trocado no `brand.ts` (continua a única fonte da marca; logo e favicon também). Escuro `#5694F7` com texto escuro (6,3 : 1); claro `#2A66CC` com texto branco (5,4 : 1), ajustados na fase D para passar também como texto sobre o fundo e o trilho (antes `#4C8DF6` e `#2F6FDB`). **O laranja fica só para atenção** (um botão principal laranja parecia um alerta).
- **Fontes embutidas:** Nunito Sans (painel) e Inter (cardápio digital) por `next/font/local`, com os arquivos `woff2` e a licença OFL em `packages/ui/assets/fonts`. Nada é baixado do Google nem no build nem no uso (internet instável, LGPD). Subconjunto latino (cobre o português).
- **Foco e toque:** contorno de 3 px na cor `--ring` com afastamento, global (`:focus-visible`), visível nos dois temas e no alto contraste do Windows (contorno, não sombra). Botões e campos de 44 px; o tamanho pequeno mede 36 px, com área de toque de 44 px.
- **Bordas de campo** com 3 : 1 sobre o cartão (`--input`); linhas decorativas continuam discretas (`--border`). Cores de status do pedido com 4,5 : 1 sobre o cartão nos dois temas (o roxo do "em preparo" no escuro é mais claro que o roxo dos gráficos).
- **Página de referência** `/referencia-visual`: todos os componentes e estados, o contraste medido na própria página, os dois temas e a largura de celular. Só com `NEXT_PUBLIC_UI_REFERENCE=1` (desenvolvimento) e para quem tem `store:manage`.
- **Capturas:** `tools/ui-walkthrough/screens.mjs` captura as telas principais nos dois temas, no computador e no celular, e avisa rolagem lateral da página. As capturas de cada fase ficam em `docs/screenshots/redesign/` (fora do git); só o conjunto final enxuto vai para `docs/screenshots/final/`.

- **Roteiros em qualquer horário:** o seed grava os horários da unidade demo ajustados ao momento em que roda (`demoHoursAround` em `prisma/seed/hours.ts`): a unidade fica **aberta e no mesmo dia de negócio por pelo menos 3 horas** (um fechamento passa para mais tarde, uma abertura para mais cedo, ou entra um turno curto). O histórico de 90 dias continua gerado com os horários semanais (determinístico). Testado com o relógio simulado (`tools/ui-walkthrough/fake-clock.sh`: `libfaketime` na API, no seed e no Node dos roteiros; o navegador recebe o mesmo deslocamento pelo `browser.mjs`): os 9 roteiros passam numa terça às 23:37, depois do fechamento das 23:30, e começando às 23:55, atravessando a meia-noite. Com os horários antigos, o `pos` falhava no mesmo horário. O teste achou defeitos reais: "Caixas do dia" e o relatório de entregadores começavam na data do calendário, não no **dia de negócio** (`useBusinessDateState`); e o seed, que grava direto no banco, não pedia ao cardápio digital para atualizar as páginas em cache (agora pede no fim, como a API). Fora do teste: no `pnpm dev`, o painel e o cardápio não liam o `.env` da raiz (o `@next/env` devolvia o ambiente já carregado); o `next.config.ts` força a releitura e o painel passa as `NEXT_PUBLIC_*` pelo `env`. Os roteiros que dependiam do relógio do banco (`now()` no SQL) ou de uma corrida de 20 ms na impressão foram ajustados sem mudar o que conferem.
- **Fase C (telas de operação):** teclado completo no novo pedido (tabela em [DESIGN.md](DESIGN.md), "Telas de operação"; o roteiro `keyboard.mjs` lança um pedido inteiro sem mouse); o menu lateral fica fixo só a partir de 1280 px, para o tablet na horizontal (1024×768) ter espaço; capturas em computador, celular e tablet. Achados no caminho: o F9 da janela do item também criava o pedido (a janela fechava e os atalhos da tela recebiam a mesma tecla; agora a janela para a tecla e o `useHotkeys` ignora teclas já tratadas); o caixa rolava 72 px para o lado no celular (a coluna do grid crescia até a linha mais larga; agora `minmax(0,1fr)`).
- **Fase D (cozinha, entrada, acessibilidade):** tela da cozinha com as colunas do kanban, tipo do pedido por ícone e faixa, tempo com ícone e sem tickets esmaecidos; login e cadastro com o painel da marca na superfície do menu lateral e o formulário em cartão. **Checagem automática de acessibilidade** com axe-core (`tools/ui-walkthrough/a11y.mjs`, WCAG 2.1 A e AA, 48 combinações de tela, tema e aparelho; falha com violação séria ou crítica). Ela achou contraste de texto colorido sobre o fundo da página (o teste de contraste passou a medir também fundo e trilho; tons do claro um pouco mais escuros, azul do escuro um pouco mais claro), `aria-controls` inválido nas abas usadas como filtro, gráficos que rolam sem teclado, um seletor sem nome e cores do tema claro dentro da cozinha escura (apelidos de cor declarados de novo em `.dark`). **Capturas finais** versionadas em `docs/screenshots/final/{escuro,claro}/computador` (8 telas: login, painel, pedidos, novo pedido, caixa, mesas, cozinha, vendas).
- **Mapa único de atalhos** (aprovado em 2026-10-09): ver DESIGN.md, "Mapa de atalhos". F6 e F7 testados no Edge e no Chrome do Windows; F9 com trava de 1 s contra toque duplo.
- **Tablet da cozinha revogado:** a API responde 403 enquanto o token ainda vale; a tela trata esse 403 como o aviso em tempo real (uma vez só) e a página de vínculo mostra **"Dispositivo desvinculado"**.

### O que o cartão do kanban mostra (nada pode sumir no redesign)

Levantado no cartão antes do redesign (`components/orders/order-card.tsx`) e conferido no cartão novo:

1. **Status**, pela faixa colorida à esquerda (e pela coluna).
2. **Pedido novo ainda não aberto:** contorno de destaque; agora também o selo "Novo" (antes era só cor).
3. **Tipo** (mesa, balcão/retirada, delivery): ícone, com o nome para leitores de tela.
4. **Número** do pedido.
5. **Tempo decorrido:** desde a criação; no "Pronto", desde que ficou pronto.
6. **Título:** mesa(s) e nome da conta, cliente, "Balcão" ou "Cliente".
7. **Delivery:** bairro e entregador.
8. **Quantidade de itens** e **origem** quando não é o PDV (cardápio digital, iFood…).
9. **Total.**
10. **Forma de pagamento prevista** (delivery e cardápio digital), inclusive "Pagamento online".
11. **Entrega não realizada:** motivo, observação e horário.
12. **PIX informado pelo cliente · conferir** (enquanto o pedido não está pago).
13. **Itens não enviados** para a cozinha (rodada em aberto), com a quantidade.
14. **Ação principal** (com permissão): aceitar, iniciar preparo, marcar como pronto, saiu, entregue; "Receber" quando a mesa ou o balcão precisa ser pago antes de concluir; "Reenviar" depois de uma entrega não realizada.

O cartão antigo não mostrava atraso nem saldo; os dois foram acrescentados a pedido do usuário depois da fase A (as rodadas ficam fora do cartão, também por decisão dele):

15. **Atraso** (`orderDeadline`/`deadlineState` em `shared/domain/order-board.ts`, sempre com ícone e texto). O prazo é a estimativa que o pedido já tem: na **retirada/balcão**, o `estimatedReadyAt` (criação + tempo de retirada da unidade), até o pedido ficar **pronto**; no **delivery**, o tempo da área contado do aceite (a mesma estimativa que o cliente vê no acompanhamento), até ser **entregue**. Faltando **5 minutos ou menos**: atenção, "Prazo em 4 min". **Passou do prazo**: crítico, "Atrasado 6 min" (no mínimo 1 min). Pedidos de mesa e deliveries sem tempo de área não têm prazo e não mudam.
16. **"A receber R$ X"** (`showsBalanceFlag`), decidido pelo usuário depois da fase B: com saldo em aberto, aparece **a partir de "Pronto"** (pronto, saiu para entrega, entregue — este na lista de finalizados) e, **em qualquer etapa, quando houve pagamento parcial**. Pedido em andamento sem nenhum pagamento não mostra o selo (mesas e deliveries costumam pagar no fim). Saldo (`openBalanceCents`) do pedido em andamento: total − pagamentos confirmados (um estorno reabre a dívida). Pedido entregue: a regra da D038, total − tudo o que já foi pago, estornos incluídos (estorno depois de concluído é devolução, não dívida). Cancelado não tem saldo. O cálculo é da API (`balanceCents` e `deadlineAt` no resumo do pedido); o painel só formata.

## D040 — Ordem de criação vem do banco, não de relógio

Decidida em 2026-10-09, depois que o relógio do WSL (que salta para trás) inverteu listas nos testes. Vale para produção: duas instâncias da API com relógios diferentes, ou um ajuste de hora no servidor, teriam o mesmo efeito.

- **Como era:** o Prisma preenche `@default(now())` com o relógio **da aplicação** (conferido: o `INSERT` leva o horário como parâmetro), e vários horários são gravados com `new Date()` (`sentAt`, `readyAt`, `dispatchedAt`...). As listas ordenavam por esses horários, e algumas sem desempate.
- **Fonte única da ordem:** as tabelas de eventos ganharam `seq` (`BIGSERIAL`, sequência do Postgres, sempre crescente): `OrderStatusHistory`, `OrderRound`, `OrderItem`, `DeliveryStop`, `PrintJob`, `ProductionTask`, `CourierLedgerEntry`, `CashMovement`, `Payment` e `AuditLog`. A migration `event_sequence` numera as linhas existentes na ordem em que foram criadas. **Toda lista na ordem dos acontecimentos ordena por `seq`**: histórico do pedido, itens, pagamentos, paradas (a "última tentativa" é a de maior `seq`), fila de impressão, tarefas e tickets da cozinha (o ticket carrega a `seq` da primeira tarefa), extrato do entregador (o saldo acumulado depende da ordem), movimentos do caixa e auditoria.
- **Pedidos** ordenam por dia de negócio e número diário (`businessDate`, `number`), que também vêm do banco (sequência diária com trava). Kanban, KDS e mesas usam essa ordem.
- **Desempate estável:** listas de cadastro ordenadas por `createdAt` (impressoras, computadores, telas da cozinha, cupons, áreas, endereços, unidades) desempatam por `id`; listas montadas em memória com eventos de várias tabelas (movimentos + pagamentos do caixa, eventos do controle de perdas) desempatam por um campo fixo.
- **Horários continuam** para exibir e para regras de tempo (atraso, "há 12 min"), com a precisão do relógio; não decidem ordem.
- **Teste:** `test/ordering.e2e.test.ts` volta o relógio da API 10 min e depois mais 5 no meio do fluxo (o segundo item fica com hora anterior ao primeiro) e confere rodadas no KDS, itens, histórico e kanban na ordem certa.
- **Regra para código novo:** tabela de eventos nova ganha `seq`; lista de eventos ordena por `seq`; nunca ordenar só por um horário gravado pela aplicação.

## D041 — Painel da plataforma: separação, login e acesso entre restaurantes

Aprovada em 2026-10-11 (etapa `feat/platform-admin`).

- **App próprio** `apps/admin` (porta 3002), com o mesmo tema do redesign (D039). Nada do painel do restaurante abre o da plataforma, e vice-versa: segredo de token próprio (`PLATFORM_JWT_SECRET`, `aud: platform`), cookie de refresh próprio (`app_platform_refresh`, só em `/api/platform/auth`, `sameSite: strict`) e tabelas próprias (`PlatformAdmin`, `PlatformSession`...), que **não** são de tenant.
- **Login em dois passos, 2FA obrigatório:** senha → desafio de 5 min → código TOTP (RFC 6238, janela ±30 s, o mesmo código não vale duas vezes) ou código de recuperação (10, formato `XXXXX-XXXXX`, guardados com hash, cada um vale uma vez). Sem 2FA cadastrado, o primeiro login obriga o cadastro (QR + códigos). Token de acesso de 10 min; sessão de no máximo 12 h, com rotação do refresh. Bloqueio de 15 min depois de 5 falhas seguidas; limite por IP (`PLATFORM_LOGIN_RATE_LIMIT_PER_MINUTE`) e lista opcional de IPs (`PLATFORM_ALLOWED_IPS`).
- **Segredo do TOTP cifrado** (AES-256-GCM) com `PLATFORM_SECRETS_KEY`, que fica só no servidor. **Precisa de cópia fora do servidor** (SETUP.md): sem ela, nenhum segredo pode ser lido e todos os admins precisam do comando de emergência.
- **Comando de emergência fora da API:** `platform-admin.js reset-2fa --email ... --reason ...`, rodado no servidor, apaga o autenticador, os códigos e as sessões do admin e grava na auditoria; o próximo login cadastra o 2FA de novo. `create` cria admins com **senha temporária** (impressa uma vez): ela **vence em 24 h** se não for usada e precisa ser **trocada logo depois do 2FA**, antes de qualquer outra tela (até a troca, a API responde 403 `PASSWORD_CHANGE_REQUIRED` a tudo, exceto `auth/me` e `auth/password`; a nova senha precisa ser diferente). `reset-password` gera outra senha temporária (esquecida ou vencida), encerra as sessões e mantém o 2FA. Tudo na auditoria. Não existe rota HTTP para esses comandos (decidido em 2026-10-12, depois do teste pelo celular).
- **Auditoria da plataforma** (`PlatformAuditLog`) de tudo: logins (inclusive falhos), cadastros, mudanças de plano, pagamentos, suporte, configurações. Só inclusão: um gatilho no banco recusa `UPDATE` e `DELETE`.
- **Um papel só** (`PlatformAdminRole.SUPERADMIN`, coluna `role` do `PlatformAdmin`), com espaço para outros papéis no futuro.
- **Acesso entre restaurantes por um caminho só:** `PlatformDirectoryService` é o único serviço que lê dados de várias organizações (client raw, só leitura de cadastro e contagens). O resto da API continua com o isolamento por tenant (D002). Uma regra do ESLint e um teste de varredura (`isolation.test.ts`) recusam importar o miolo da plataforma fora dos pontos de integração (`billing-access.service`, `billing.decorators`, `platform.keys`, `platform.module`).

## D042 — Cobrança da plataforma e modo somente leitura

- **Cobrança por organização** (não por unidade). O plano tem preço por período (mensal, trimestral ou anual), limite de unidades e, opcional, valor por unidade adicional (sem ele, o limite bloqueia a criação de unidade com mensagem em pt-BR). Módulos do plano: cardápio digital, delivery, cozinha, impressão, marketplaces; o menu do painel esconde os módulos fora do plano e a API responde 403 `PLAN_LIMIT` (`@RequiresModule`).
- **Assinatura com histórico** (`SubscriptionChange`: plano, preço combinado, suspensão, reativação, cancelamento, sempre com motivo). Mensalidades (`PlatformInvoice`) geradas por período a partir do dia âncora (`addMonthsToDate`, dia 31 vira o último do mês); uma por período (único por assinatura + início).
- **Pagamento manual** nesta fase (PIX, boleto, cartão, transferência, dinheiro, com observação). A interface `BillingProvider` (implementação `Manual`) é o ponto de extensão para Asaas, Mercado Pago ou Pagar.me (ROADMAP).
- **Prazos em America/Sao_Paulo**, qualquer que seja o fuso da unidade: aviso **5 dias** antes do vencimento, **7 dias** de tolerância depois (padrões configuráveis; tolerância também por cliente).
- **Somente leitura nunca no meio do expediente** (`readOnlyStartsAt`): quando a organização fica elegível (tolerância vencida, suspensão ou cancelamento), cada unidade entra em somente leitura ao fim do dia de negócio em andamento; se ainda não abriu, imediatamente; sem horários cadastrados, às 04:00. O painel mostra "agendado" (`SCHEDULED`) com o horário.
- **O que o somente leitura bloqueia:** só o que cria venda (`@CreatesSale`: criar pedido, lançar itens, abrir caixa, pedido do cardápio digital) → 403 `READ_ONLY_MODE`. Consultas, relatórios, fechar o que já está aberto e receber pagamentos continuam. O cardápio digital aparece fechado para pedidos. Nos marketplaces (futuro), a loja deve aparecer fechada (ROADMAP).
- **Liberação imediata:** registrar o pagamento invalida o cache de acesso (30 s) e avisa o painel em tempo real (`notices.updated`) e o cardápio digital.
- **Status do cliente** (`subscriptionStatus`): em teste, ativo, atrasado, suspenso (somente leitura), cancelado. Receita recorrente (MRR) conta ativos e atrasados ainda na tolerância, no equivalente mensal.

## D043 — Cadastro de clientes, convite e termos

- **Cadastro só por convite por padrão.** A plataforma cadastra organização (com dados para nota fiscal: CNPJ/CPF, razão social, endereço, inscrição municipal opcional, e-mail para nota), primeira unidade, dono e assinatura; o dono recebe um convite por e-mail (token `INVITE`, 7 dias) e define a senha em `/convite`. Reenvio pelo painel da plataforma.
- **Opção "aberto, com período de teste"** (configurações): o cadastro público volta a funcionar e cria a assinatura em teste (padrão 14 dias) no plano escolhido; sem plano, a opção não salva. Fechado, `/cadastro` mostra "Cadastro por convite".
- **Termos de uso e privacidade:** o dono aceita no primeiro acesso (versão, data, IP, usuário em `TermsAcceptance`); quando a versão muda (`PLATFORM_TERMS_VERSION`/`PLATFORM_PRIVACY_VERSION`), o aceite é pedido de novo. Outros papéis não são bloqueados. Os textos (`shared/platform/legal.ts`) são provisórios e marcados **"revisar com apoio jurídico"**.
- **Emissão de NFS-e** e **encerramento de cliente pela LGPD** (exportação, retenção, exclusão/anonimização) ficam no ROADMAP.

## D044 — Acesso de suporte ao painel do restaurante

- **Sempre com motivo, prazo e aviso:** o admin escolhe a unidade, escreve o motivo (mínimo de 10 caracteres) e o prazo (30 min por padrão, de 15 a 60); o dono recebe e-mail. **Somente leitura por padrão**; edição exige confirmação explícita.
- **Como funciona:** a API emite um token de suporte (sessão `SupportSession`, papel interno `PLATFORM_SUPPORT` com as permissões de gerente, usuário global "Suporte da plataforma"). O painel da plataforma abre `/suporte#token=...` numa aba nova (o token vai no fragmento, nunca em log de servidor); a aba guarda o token só no `sessionStorage`, não tem refresh e termina no horário marcado ou quando o admin encerra (a API recusa na hora).
- **No painel do restaurante:** faixa fixa "Suporte da plataforma conectado", com o modo, o fim e o motivo. Em somente leitura, a API aceita só `GET`; trocar de unidade, mudar senha e `/auth/me` são recusados ao suporte (`@DenySupport`).
- **Auditoria dos dois lados:** início e fim na auditoria da plataforma; tudo o que o suporte fizer no restaurante vai para o `AuditLog` da unidade com `supportSessionId`.

## D045 — Modo demonstração da unidade Demo pública

Aprovado em 2026-10-13 com a hospedagem. As credenciais da Demo ficam públicas, então a unidade tem um **modo demonstração** (`Store.demoMode`), ligado só pelo comando `demo-reset`:

- **Bloqueado pela API** (não só escondendo botões): rotas marcadas com `@BlockedInDemo()` respondem 403 `DEMO_MODE` com a mensagem "Indisponível no ambiente de demonstração…". Entram: usuários, troca de senha, dados e configurações da empresa, chave PIX, logo, horários, nova unidade, configuração de impressão, configurações, capa e telefones bloqueados do cardápio digital, exclusões de cadastro, **envio de imagens** e **pedidos reais do cardápio digital**. O e-mail de recuperação de senha não é enviado a usuários da Demo (mesma resposta, sem revelar nada).
- **Livre:** pedidos, caixa, mesas, cozinha, entregas e relatórios. Tirar um item não enviado de um pedido é venda (`@AllowedInDemo()`); um teste recusa qualquer rota `DELETE` sem uma das duas marcas.
- **Na tela:** faixa "Ambiente de demonstração" (restaurado toda noite) no painel; no checkout do cardápio digital, aviso de que o pedido não é enviado. Os visitantes nunca são chamados a aceitar os termos (a Demo não é cliente).
- **Restauração:** `node dist/cli/demo-reset.js --yes` (só com `DEMO_RESET_ENABLED=true`), toda noite às 04:00 de Brasília. Mantém a unidade e a organização (a plataforma aponta para elas), esvazia e recria tudo dentro da unidade, restaura **todas** as colunas da unidade (teste falha quando `Store` ganha coluna que o reset não define), 30 dias de histórico e horário aberto das 04:30 às 04:00. Nunca toca a plataforma nem outros clientes (conferido contra um banco com seed).
- O seed de desenvolvimento e o `demo-reset` usam o mesmo código (`apps/api/src/demo`); o seed de desenvolvimento recusa `NODE_ENV=production` e bancos que não sejam locais.

## D046 — Hospedagem: arquitetura e publicação

Proposta aprovada em 2026-10-13 ([PROPOSTA_HOSPEDAGEM.md](PROPOSTA_HOSPEDAGEM.md), decisões no fim); passo a passo em [DEPLOY.md](DEPLOY.md).

- **VM Contabo (US East), Docker Compose, PostgreSQL 17 fora do Docker** (PGDG, cluster em `/mnt/dados/postgresql/17/main`), alcançado pelos containers no gateway `172.30.0.1` da rede `app_net` (criada fora do Compose, sub-rede fixa). A 5432 só escuta em `localhost` e no gateway; o ufw tem uma regra só para a sub-rede do Docker. O Postgres sobe depois do Docker e só com `/mnt/dados` montado.
- **Dois usuários no banco:** `app_owner` (dono das tabelas, só nas migrations) e `app` (só dados, a API). Conferido no ensaio: `app` não cria tabela.
- **Cada app chama a API pelo próprio endereço** (`painel.<base>/api`, `/socket.io`), repassado pelo Caddy: as imagens não carregam domínio (`NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_MENU_URL` vazios no build), o cookie de sessão fica no mesmo site e não há CORS. O cardápio lê o próprio endereço ao rodar (`MENU_PUBLIC_URL`) e usa o endereço da requisição nos links.
- **Imagens no GitHub Actions**, públicas no GHCR, marcadas com o commit; **`deploy.sh` manual** (backup rápido, migrations num container de uso único antes dos apps, verificação de saúde e volta automática). As migrations saíram do início do container da API. Containers como usuário sem privilégios.
- **Produção recusa iniciar** com segredo de desenvolvimento (as marcas do `.env.example`, conferidas por teste que lê o arquivo), segredo vazio ou curto, senha de desenvolvimento do banco, endereço `localhost` ou e-mail sem TLS. SMTP com usuário, senha e `starttls`/`tls`.
- **Backup diário** cifrado com `age` (só a chave pública no servidor) para o B2 por `rclone`, com prefixos `daily/`, `weekly/` e `monthly/` e retenção pelas regras do bucket (a chave do servidor não apaga); teste de restauração num banco temporário. **Monitoramento** pelo Healthchecks.io. **Servidor em UTC, agendamentos no horário de Brasília** por timers do systemd.
- **Ensaio local de produção** (`deploy/local-check.sh`, 21 conferências, e `tools/ui-walkthrough/prod-smoke.mjs` num navegador): achou que a imagem da API nunca montava com o Prisma 7 (o `postinstall` sem o schema; o cliente gerado sem o `tsconfig` importava arquivos `.ts`) e que o `.env` era lido como código de shell; corrigidos antes de qualquer servidor.
