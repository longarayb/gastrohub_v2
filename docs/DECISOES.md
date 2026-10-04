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
