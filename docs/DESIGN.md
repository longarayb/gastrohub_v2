# Design do painel

Especificação visual validada pelo usuário em 2026-10-08, a partir de uma referência que não é versionada (contém dados de terceiros). **Fonte da verdade** para o redesign do painel (`apps/web`).

- **Agora (`feat/dashboard`):** os componentes do dashboard e dos relatórios seguem esta estrutura e usam **só tokens do tema**. Os tokens novos ficam em `packages/ui/src/styles/globals.css`.
- **Depois do MVP (etapa de redesign):** o tema completo (fundo, cards, barra lateral, tipografia de todo o painel) é aplicado ao resto das telas, trocando os valores dos tokens. Nenhuma tela deve usar cor, raio ou fonte soltos (regra já vigente; ver CLAUDE.md, "Tema").

O cardápio digital (`apps/menu`) não segue este documento: usa a marca do restaurante (D032).

## Tema

O **escuro é o padrão** do painel; o claro é a versão equivalente (alternável pelo usuário, como hoje).

| Token (papel) | Escuro | Claro |
|---|---|---|
| Fundo principal (`--background`) | `#0B111C` | `#F3F6FA` |
| Barra lateral (degradê vertical) | `#0D1B30` → `#0F2442` | `#FFFFFF` → `#EEF3FA` |
| Card (`--card`) | `#151F31` | `#FFFFFF` |
| Borda do card (`--border`) | `#22304A` | `#D6DFEA` |
| Raio do card | 18 px | 18 px |
| Texto principal (`--foreground`) | `#E8EEF7` | `#0F1B2D` |
| Texto apagado (`--muted-foreground`) | `#9AAAC2` | `#52627A` |
| Trilho das barras (`--track`) | `#1E2A40` | `#E7ECF3` |
| Série comparativa (`--chart-compare`) | `#3A4A66` | `#9AA9BF` |
| Item ativo do menu: fundo | `#0F3B3A` | `#DCF3EA` |
| Item ativo do menu: texto | `#FFFFFF` | `#0B3D2E` |
| Item ativo do menu: borda esquerda (4 px) | `#2EBD85` | `#13865A` |

### Cores de destaque e semânticas

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `--accent-blue` (principal) | `#4C8DF6` | `#2F6FDB` | destaque, série "hoje" |
| `--accent-green` | `#2EBD85` | `#13865A` | |
| `--accent-purple` | `#A06CD5` | `#7E46B8` | só em barras/faixas e texto grande |
| `--accent-orange` | `#F59E0B` | `#B86E00` | |
| `--signal-attention` (alerta) | `#F5A524` | `#A86400` | "Atenção agora", atrasos |
| `--signal-critical` (crítico) | `#FF6B5E` | `#D23A2E` | piora, crítico |
| `--signal-positive` (positivo) | `#3FCF8E` | `#13865A` | melhora, ok |
| `--chart-1` … `--chart-5` | azul, verde, roxo, laranja, crítico (valores acima) | idem, versão clara | séries de gráficos, nesta ordem |

### Contraste (WCAG AA)

Medido com a fórmula do WCAG 2.x:

| Combinação | Escuro | Claro |
|---|---|---|
| Texto apagado sobre o card | 7,00 : 1 | 6,20 : 1 |
| Texto apagado sobre o fundo | 8,01 : 1 | 5,72 : 1 |
| Texto apagado sobre o trilho | 6,10 : 1 | 5,22 : 1 |
| Texto principal sobre o card | 14,15 : 1 | 17,28 : 1 |
| Azul sobre o card | 5,07 : 1 | 4,75 : 1 |
| Roxo sobre o card | 4,40 : 1 (só texto grande ou gráfico) | 6,08 : 1 |
| Crítico / alerta / positivo sobre o card | 5,91 / 8,09 / 8,27 : 1 | 4,79 / 4,68 / 4,58 : 1 |
| Série comparativa sobre o card | 1,85 : 1 | 2,39 : 1 |

A série comparativa é de propósito discreta e fica abaixo de 3 : 1. Para cumprir o contraste de elementos gráficos (WCAG 1.4.11), cada coluna comparativa tem um **traço de 2 px no topo na cor do texto apagado** (≥ 3 : 1), e os valores aparecem na legenda e na tabela equivalente do gráfico.

## Tipografia

- **Nunito Sans** (Google Fonts, via `next/font`), pesos 400 a 800.
- **Algarismos tabulares** (`font-variant-numeric: tabular-nums`) em todos os números.
- **Escala:**

| Elemento | Tamanho | Peso |
|---|---|---|
| Título da página | 34 px | 800 |
| Valor do KPI | 38 px | 800 |
| Número do "Atenção agora" | 34 px | 800 |
| Rótulo do KPI | 13 px, maiúsculas, espaçamento entre letras 0,1em, cor apagada | 700 |
| Linha de apoio | 14 px | 400 |

- Nesta etapa a fonte vale para os componentes do dashboard (`--font-display`). No redesign, passa a ser a fonte de todo o painel.

## Estrutura

### Menu lateral (redesign)

- **Topo:** logo e nome do `brand.ts`, com o nome da unidade ativa como subtítulo.
- **Itens:** 46 px de altura, raio 12, ícones Lucide de traço fino (nunca emojis).
- **Item ativo:** fundo e texto da tabela acima, texto em negrito, borda esquerda de 4 px.
- **Rodapé:** card do usuário com avatar redondo verde (inicial do nome), nome e papel em maiúsculas.

### Cabeçalho da página

- Título 34 px / 800.
- Subtítulo apagado com a data e o dia de negócio (ex.: "quarta-feira, 8 de outubro · dia de negócio 08/10").
- À direita, os atalhos de período (Hoje, 7 dias, 30 dias, …) como botões de 44 px de altura.

### KpiCard

- Card com **faixa de 4 px na borda esquerda** na cor semântica do indicador.
- Rótulo, valor e linha de apoio com a tipografia acima.
- **Comparação** com seta:
  - ▲ na cor positiva quando melhora;
  - ▼ na cor crítica quando piora.
  - O que é "melhorar" depende do indicador: para tempo e cancelamentos, subir é ruim.
- **Ícone de ajuda (ⓘ)** com a definição do indicador (D038).
- **Grade** `auto-fit` com mínimo de 230 px, sem card sozinho deixando buraco: o último da linha ocupa o espaço que sobra.

### AttentionStrip ("Atenção agora")

- Logo abaixo dos cartões.
- Itens lado a lado, quebrando linha no celular.
- Cada item: número de 34 px colorido (laranja atenção, vermelho crítico, verde ok) seguido do rótulo.
- Itens:
  - pedidos aguardando aceite;
  - tickets atrasados no KDS;
  - impressoras offline;
  - itens esgotados.
- Cada item é um link para a tela correspondente.

### BarList

- **Cabeçalho:** título à esquerda e resumo à direita (ex.: "5 canais · 346 pedidos").
- **Cada linha:** rótulo; trilho (`--track`) de 26 px de altura com raio 8; barra proporcional ao **maior** valor da lista; valor principal em negrito e secundário apagado à direita.
- **Uso:** vendas por canal e mais vendidos.

### Gráfico por hora

- Colunas lado a lado por hora: hoje na cor de destaque, o comparativo em `--chart-compare` com o traço de contraste.
- Legenda no cabeçalho.
- Em telas estreitas, rolagem horizontal **só dentro do card**.

### Ordem do dashboard do dia

1. Cabeçalho.
2. Cartões: faturamento, pedidos, ticket médio, em aberto, cancelados.
3. Atenção agora.
4. Vendas por canal e mais vendidos, lado a lado.
5. Pedidos por hora.

## Acessibilidade

- Contraste mínimo **WCAG AA** em todos os textos, inclusive os apagados (tabela acima).
- **Áreas de toque de pelo menos 44 px.**
- Gráficos em SVG com título e uma tabela equivalente (leitores de tela e CSV); cor nunca é a única forma de informação (setas, rótulos e valores acompanham).
