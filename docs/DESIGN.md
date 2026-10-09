# Design do painel

Especificação visual validada pelo usuário em 2026-10-08, a partir de uma referência que não é versionada (contém dados de terceiros). **Fonte da verdade** para o redesign do painel (`apps/web`).

- **Aplicado em todo o painel na `feat/redesign` (D039).** Os tokens ficam em `packages/ui/src/styles/globals.css` (claro em `:root`, escuro em `.dark`); a cor principal vem do `brand.ts`. Nenhuma tela usa cor, raio ou fonte soltos (ver CLAUDE.md, "Tema").
- **Contraste conferido por teste:** `packages/ui/src/styles/contrast.test.ts` reprova o build se algum par de texto ficar abaixo de 4,5 : 1 ou um elemento (borda de campo, foco, traço de gráfico) abaixo de 3 : 1, nos dois temas. Conferência visual em `/referencia-visual` (desenvolvimento).

O cardápio digital (`apps/menu`) não segue este documento: usa a marca do restaurante (D032).

## Tema

O **escuro é o padrão** do painel; o claro é a versão equivalente. A troca é por aparelho, no botão "Tema" do cabeçalho (Escuro, Claro ou Sistema, que acompanha o sistema operacional ao vivo).

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

Medido com a fórmula do WCAG 2.x (a lista completa de pares está no teste de contraste):

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

- **Nunito Sans**, peso variável, **embutida no build** (`next/font/local`, arquivo e licença OFL em `packages/ui/assets/fonts`): nada é baixado do Google, nem no build nem no uso.
- **Algarismos tabulares** (`font-variant-numeric: tabular-nums`) em todos os números.
- **Escala:**

| Elemento | Tamanho | Peso |
|---|---|---|
| Título da página | 34 px | 800 |
| Valor do KPI | 38 px | 800 |
| Número do "Atenção agora" | 34 px | 800 |
| Rótulo do KPI | 13 px, maiúsculas, espaçamento entre letras 0,1em, cor apagada | 700 |
| Linha de apoio | 14 px | 400 |

- É a fonte de todo o painel (`--font-app`).

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

## Componentes base (`@app/ui`)

Todos com os tokens do tema; a página `/referencia-visual` mostra cada um, com os estados.

| Componente | Regras |
|---|---|
| Botão (`button`) | 44 px (padrão); `sm` e `icon-sm` medem 36 px com área de toque estendida a 44 px; `lg` 48, `xl` 56; raio 12; peso 600 |
| Campos (`input`, `textarea`, `select`, `checkbox`) | 44 px, fundo do card, borda `--input` (3 : 1); erro com `aria-invalid` e mensagem em texto |
| Foco | contorno global de 3 px em `--ring`, com afastamento (`:focus-visible` em `globals.css`); não usar `outline-none` nem anéis próprios |
| Abas (`Tabs`) e controle segmentado (`Segmented`) | 44 px; aba ativa como card com texto em negrito; segmentado com a escolhida na cor principal |
| Tabela (`Table`) | cabeçalho em maiúsculas apagadas; `stack` vira cartões abaixo de 768 px, com o nome da coluna em cada célula (`TableCell label`) |
| Badge de status (`OrderStatusBadge`) | ícone + texto + cor do status; nunca só a cor |
| Avisos na página (`Notice`) | informação, atenção, erro e sucesso: texto em contraste total, o tom na faixa de 4 px e no ícone |
| Avisos flutuantes (`toast`) | faixa de 4 px na cor do tipo; texto do tema |
| Diálogo e painel lateral | fundo `--popover`, raio 18 (diálogo), botão de fechar de 44 px |
| Menus e seletores | itens de 36 px no mouse e 44 px no toque (`pointer: coarse`) |
| Estados | `EmptyState` (ícone, título, ajuda e ação), `Skeleton`/`ListSkeleton` no trilho, `LoadingArea` |
| Cabeçalho de página (`PageHeader`) | título de 34 px (30 px no celular), subtítulo apagado, ações à direita |
| Atalho (`Kbd`) | tecla com borda inferior mais grossa |

## Acessibilidade

- Contraste mínimo **WCAG AA** em todos os textos, inclusive os apagados, nos dois temas (teste de contraste).
- **Foco visível** em tudo o que recebe o teclado, inclusive no alto contraste do Windows (contorno, não sombra).
- Com "reduzir movimento" ligado no sistema, as animações são cortadas.
- **Áreas de toque de pelo menos 44 px.**
- Gráficos em SVG com título e uma tabela equivalente (leitores de tela e CSV); cor nunca é a única forma de informação (setas, rótulos e valores acompanham).
