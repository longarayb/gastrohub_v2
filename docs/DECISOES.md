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

## D012 — Impressão via navegador na Fase 1
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
