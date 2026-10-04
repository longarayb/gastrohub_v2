# Prompt inicial — GastroHub V2 (para Claude Code)

> Abra o terminal em `D:\GastroHub_v2`, inicie o Claude Code (`claude`) e cole tudo abaixo da linha.

---

Você é um engenheiro de software sênior e arquiteto de produto especializado em sistemas para food service no Brasil. Vamos construir juntos o **GastroHub V2**, um sistema SaaS de gestão para restaurantes, bares, lanchonetes, pizzarias e deliveries, no mesmo segmento de produtos como Saipos e Suitable.

O projeto será desenvolvido **em fases**. Nesta primeira sessão, quero que você monte a fundação sólida do sistema e entregue o MVP (Fase 1) funcionando de ponta a ponta. As fases seguintes serão pedidas depois, então a arquitetura precisa estar preparada para crescer sem retrabalho.

## 0. Ambiente e repositório

- **Pasta do projeto:** `D:\GastroHub_v2` (Windows). Esta é a raiz do monorepo. Não crie uma subpasta extra dentro dela.
- **Repositório remoto:** `https://github.com/longarayb/gastrohub_v2` (público, atualmente vazio). Branch principal: `main`.
- **Sistema operacional:** Windows. Considere isso em tudo:
  - Scripts do `package.json` devem funcionar no PowerShell e no Git Bash (use `cross-env`, `rimraf` e similares; nada de `rm -rf`, `export` ou `&&` dependente de shell Unix em scripts).
  - Use caminhos relativos e `path.join` no código; nunca caminhos absolutos fixos.
  - Docker roda via **Docker Desktop com WSL2**. Documente no README os pré-requisitos (Node LTS, pnpm via `corepack`, Docker Desktop, Git).
  - Crie um `.gitattributes` com `* text=auto eol=lf` para evitar problemas de quebra de linha entre Windows e containers Linux, e configure o Prettier com `endOfLine: "lf"`.
  - Se precisar de scripts auxiliares, forneça versão `.ps1` (PowerShell) ou use scripts Node, em vez de apenas `.sh`.
- **Configuração inicial do Git** (faça isso antes do primeiro commit):
  1. Verifique se a pasta já é um repositório (`git status`). Se não for, rode `git init -b main`.
  2. Configure o remoto: `git remote add origin https://github.com/longarayb/gastrohub_v2.git` (ou atualize com `git remote set-url` se já existir).
  3. Crie `.gitignore` adequado para Node/Next/NestJS/Prisma/Turborepo (incluindo `node_modules`, `.next`, `dist`, `.turbo`, `coverage`, `.env*` exceto `.env.example`).
  4. Primeiro commit apenas com a estrutura base, `.gitignore`, `.gitattributes`, `README.md` e `CLAUDE.md`, e faça `git push -u origin main`.
- **Segurança (repositório público):** nunca commite `.env`, senhas, tokens, chaves de API ou dados reais de clientes. Use apenas `.env.example` com valores fictícios. Antes de cada push, confira que nenhum segredo entrou no commit. As credenciais do seed devem ser claramente de demonstração.
- **Fluxo de trabalho no Git:** a partir da fundação, desenvolva cada etapa em uma branch (`feat/auth`, `feat/menu`, `feat/orders` etc.), com commits pequenos em Conventional Commits. Ao concluir e validar uma etapa (lint, testes e build passando), faça merge na `main` e push. Peça minha confirmação antes de qualquer `push --force` ou reescrita de histórico.

## 0.1 Nome provisório

"GastroHub V2" é apenas um **codinome de desenvolvimento**. O nome comercial ainda será definido, então a marca precisa ser fácil de trocar depois:

- Centralize nome, slogan, cores, logo e favicon em um único arquivo de configuração de marca (`packages/shared/src/brand.ts`, com os assets em `packages/ui/assets/brand/`). Nenhuma tela, e-mail, cupom impresso ou título de página deve ter o nome escrito diretamente no código.
- Use um escopo neutro para os pacotes internos do monorepo (`@app/shared`, `@app/ui`, `@app/config`, `@app/api`, `@app/web`, `@app/menu`), não `@gastrohub/...`.
- Nomes de banco, containers e variáveis de ambiente também devem ser neutros (ex.: `app_db`, `APP_NAME`).
- Registre no `CLAUDE.md` que o nome é provisório e onde trocá-lo.

## 1. Antes de escrever código

1. Leia este prompt inteiro.
2. Apresente um **plano de implementação** resumido (estrutura de pastas, modelo de dados principal, ordem de construção) e aguarde minha aprovação.
3. Se algo estiver ambíguo, faça no máximo 5 perguntas objetivas antes de começar. Caso contrário, assuma o padrão mais comum no mercado brasileiro e registre a decisão em `docs/DECISOES.md`.

## 2. Contexto do produto

- **Público:** restaurantes pequenos e médios no Brasil, com atendimento em salão, balcão e delivery (próprio e via marketplaces).
- **Idioma da interface:** português do Brasil. Código, nomes de variáveis e commits em inglês.
- **Padrões locais:** moeda BRL (R$ 1.234,56), fuso `America/Sao_Paulo`, CPF/CNPJ com validação, CEP com busca de endereço (ViaCEP), telefone com DDD, PIX como forma de pagamento de primeira classe.
- **Multiempresa (multi-tenant):** cada restaurante é um tenant isolado; um mesmo dono pode ter várias unidades.
- **Tempo real é essencial:** novos pedidos, mudança de status, cozinha e mesas devem atualizar instantaneamente em todas as telas.

## 3. Stack técnica

- **Monorepo:** Turborepo + pnpm.
- **Backend:** Node.js + TypeScript com NestJS, API REST documentada com Swagger/OpenAPI, WebSockets (Socket.IO) para tempo real.
- **Banco de dados:** PostgreSQL com Prisma ORM; isolamento por `tenantId` em todas as tabelas de negócio, aplicado de forma centralizada (middleware/extension do Prisma), nunca manualmente em cada query.
- **Cache e filas:** Redis + BullMQ (impressões, notificações, integrações).
- **Frontend administrativo e PDV:** Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui, TanStack Query, React Hook Form + Zod.
- **Cardápio digital:** app Next.js separado, otimizado para mobile, SEO e carregamento rápido.
- **Pacote compartilhado:** tipos, schemas Zod e utilitários (formatação de moeda, CPF/CNPJ, telefone) em `packages/shared`.
- **Autenticação:** JWT com refresh token, senhas com argon2, RBAC por papel.
- **Infra local:** Docker Compose (Postgres, Redis) para os serviços de infraestrutura, com as aplicações rodando via `pnpm dev` no Windows para hot reload rápido. Também ofereça um perfil do Compose que sobe tudo em containers. Um único comando deve subir o ambiente de desenvolvimento.
- **Recursos da máquina:** o ambiente de desenvolvimento é Windows com memória limitada. Mantenha concorrência baixa em testes e builds (`pnpm check` com concorrência 2, build do Next com 2 workers) e use Playwright em modo headless, com um navegador e sem paralelismo.
- **Qualidade:** ESLint, Prettier, testes unitários (Vitest/Jest) para regras de negócio e testes e2e da API para os fluxos críticos de pedido.

Se você tiver uma razão técnica forte para trocar alguma peça, proponha no plano antes de implementar.

## 4. Estrutura esperada

```
D:\GastroHub_v2/
├── apps/
│   ├── api/          # NestJS
│   ├── web/          # Painel admin + PDV + KDS (Next.js)
│   └── menu/         # Cardápio digital público (Next.js)
├── packages/
│   ├── shared/       # tipos, schemas Zod, utils
│   ├── ui/           # componentes compartilhados
│   └── config/       # eslint, tsconfig, tailwind
├── docs/
│   ├── ARQUITETURA.md
│   ├── DECISOES.md
│   └── ROADMAP.md
├── docker-compose.yml
└── CLAUDE.md
```

## 5. Escopo da Fase 1 (MVP)

### 5.1 Conta, empresa e usuários
- Cadastro do restaurante (razão social, nome fantasia, CNPJ, endereço, horários de funcionamento por dia da semana, logo).
- Usuários com papéis: **Dono**, **Gerente**, **Caixa**, **Garçom**, **Cozinha**, **Entregador**. Permissões aplicadas no backend e refletidas no frontend.
- Login, logout, recuperação de senha e troca de unidade ativa.

### 5.2 Cardápio
- Produto e categoria pausáveis com um clique ("acabou"); opções de complemento pausáveis individualmente.
- Setor de produção por produto (cozinha, bar, pizzaria), código interno para busca no PDV e código de integração externo opcional.
- Imagens redimensionadas e convertidas para WebP, armazenadas atrás de uma interface `StorageProvider` (local agora, S3/R2 depois).
- Itens de pedido guardam uma cópia (snapshot) de nome, preço e complementos no momento da venda; alterações de preço vão para a auditoria.
- Categorias ordenáveis, produtos com foto, descrição, preço, preço promocional, código interno e disponibilidade (ativo/pausado).
- **Grupos de complementos** reutilizáveis (ex.: "Escolha o ponto", "Adicionais") com mínimo/máximo de escolhas e preço por opção.
- **Produtos com variações de tamanho** e **pizza meio a meio / até N sabores**, com regra de preço configurável (maior valor ou média).
- Disponibilidade por canal (salão, balcão, delivery, cardápio digital) e por horário.

### 5.3 Pedidos (núcleo do sistema)
- Tipos de pedido: **Mesa**, **Balcão/Retirada**, **Delivery**.
- Ciclo de status: `PENDING → ACCEPTED → PREPARING → READY → DISPATCHED → DELIVERED`, com `CANCELED` a partir de qualquer etapa (exige motivo e permissão). Toda mudança registrada em histórico com usuário e horário.
- Itens com complementos, observações, quantidade e desconto por item ou no pedido.
- Taxa de entrega, taxa de serviço (configurável, padrão 10% no salão) e cupom simples de desconto.
- Numeração sequencial diária por unidade.
- **Tela de gestão de pedidos** em tempo real, estilo kanban por status, com alerta sonoro para pedido novo.

### 5.4 Salão e mesas
- Cadastro de mesas e áreas (salão, varanda etc.).
- Mapa de mesas com estado: livre, ocupada, aguardando pagamento.
- Abrir mesa, lançar itens, transferir itens entre mesas, juntar mesas e dividir a conta (por igual ou por itens).

### 5.5 PDV / Caixa
- Abertura e fechamento de caixa com valor inicial, sangria e suprimento.
- Pagamentos: dinheiro (com cálculo de troco), PIX, cartão de crédito, cartão de débito, vale-refeição. Um pedido pode ter múltiplos pagamentos.
- Relatório de fechamento de caixa com totais por forma de pagamento e diferença entre esperado e informado.

### 5.6 KDS (tela da cozinha)
- Tela otimizada para tablet/TV, mostrando itens a preparar por pedido, com tempo decorrido e destaque visual quando passar do tempo limite.
- Cozinha marca itens/pedidos como prontos, atualizando o pedido em tempo real.
- Possibilidade de setores de produção (ex.: cozinha, bar, pizzaria) e roteamento de itens por setor.

### 5.7 Delivery
- Cadastro de clientes (nome, telefone, endereços, histórico de pedidos), com busca rápida pelo telefone.
- Áreas de entrega por **bairro** ou **raio em km**, cada uma com taxa e tempo estimado.
- Cadastro de entregadores e atribuição do entregador ao pedido.

### 5.8 Cardápio digital (app `menu`)
- URL pública por restaurante (`/{slug}`), mostrando cardápio, horários e se está aberto ou fechado.
- Carrinho com complementos, identificação do cliente por telefone, escolha de retirada ou entrega, cálculo de taxa pela área de entrega e escolha de forma de pagamento (pagamento na entrega nesta fase).
- O pedido cai em tempo real na tela de gestão como `PENDING`. O cliente acompanha o status por uma página de acompanhamento.

### 5.9 Impressão
- Geração de comanda e cupom não fiscal em layout para impressora térmica 80mm (HTML/CSS para impressão via navegador nesta fase).
- Deixe a arquitetura preparada (fila + interface `PrintProvider`) para, em fase futura, um agente local ESC/POS imprimir direto por setor.

### 5.10 Dashboard e relatórios básicos
- Dashboard do dia: faturamento, número de pedidos, ticket médio, pedidos por canal e por status.
- Relatório de vendas por período, por produto e por forma de pagamento, com exportação CSV.

## 6. Fora do escopo da Fase 1 (preparar a arquitetura, não implementar)

Deixe interfaces, enums e pontos de extensão prontos para:
- Integrações com marketplaces (iFood, 99Food, Aiqfome, Open Delivery) via padrão de **adapters**.
- Emissão fiscal NFC-e/NF-e.
- Pagamento online (PIX dinâmico e cartão via gateway) e TEF com maquininhas.
- Controle de estoque e ficha técnica.
- Financeiro (contas a pagar/receber, DRE).
- CRM, fidelidade, campanhas e robô de WhatsApp.
- Apps do garçom, do entregador, totem de autoatendimento.
- Roteirização de entregas e mapa.

## 7. Requisitos não funcionais

- Toda regra de negócio de valores (subtotal, taxas, descontos, total, troco, divisão de conta) deve ficar em **serviços de domínio puros e testados**, e valores monetários armazenados como **inteiros em centavos**.
- Operações críticas (fechar pedido, registrar pagamento, fechar caixa) dentro de transações.
- Logs estruturados e trilha de auditoria para cancelamentos, descontos e alterações de preço.
- Interface responsiva, rápida e pensada para uso intenso: atalhos de teclado no PDV, botões grandes no KDS, modo escuro.
- Validação com Zod compartilhada entre front e back.
- Tratamento de erros padronizado na API e mensagens amigáveis em português na interface.

## 8. Dados de demonstração

Crie um **seed** com um restaurante de exemplo ("GastroHub Demo"), usuários de cada papel (credenciais documentadas no README), cardápio realista (lanches, pizzas meio a meio, bebidas, sobremesas com complementos), mesas, áreas de entrega, clientes e pedidos dos últimos 30 dias para o dashboard ter dados.

## 9. Documentação e continuidade

Como este projeto será evoluído em várias sessões, crie e mantenha:
- **`CLAUDE.md`** na raiz com: visão do produto, stack, ambiente (Windows, `D:\GastroHub_v2`, repositório GitHub e fluxo de branches), comandos (instalar, rodar, testar, migrar, seed), convenções de código, estrutura de pastas e regras importantes (multi-tenant, centavos, status de pedido). Este arquivo é a memória do projeto para as próximas sessões.
- **`docs/ROADMAP.md`** com as fases futuras e o status de cada módulo (feito / em andamento / pendente).
- **`docs/DECISOES.md`** com as decisões técnicas e o motivo de cada uma.
- **`README.md`** com instruções de instalação e uso.

## 10. Forma de trabalho

- Construa em etapas incrementais, seguindo o fluxo de branches e commits descrito na seção 0.
- Ordem sugerida: fundação do monorepo e Docker → autenticação e multi-tenant → cardápio → pedidos e tempo real → mesas e PDV → KDS → delivery → cardápio digital → impressão → dashboard → seed e documentação.
- Ao final de cada etapa, rode lint, testes e build, corrija os erros, faça merge na `main` e push para o GitHub antes de seguir.
- Ao terminar, me entregue um resumo com: o que foi implementado, como rodar, credenciais de teste, limitações conhecidas e sugestão do que atacar na Fase 2.

Comece apresentando o plano de implementação.
