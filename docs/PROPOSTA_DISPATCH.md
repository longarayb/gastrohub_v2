# Proposta: despacho com mapa e rotas (`feat/dispatch`)

> **Status: aprovada em 2026-10-15**, com as decisões no fim deste arquivo. Implementação na branch `feat/dispatch`, em 3 fases com aprovação visual ao fim de cada uma.

## 0. O que já existe e continua valendo

Entregas hoje (D029–D031): **saída** (`DeliveryRun`) com várias **paradas** (`DeliveryStop`, com `sequence`), um entregador por saída e uma saída aberta por entregador; `DispatchService` é a única porta para "Saiu para entrega"; "não entregue" com motivo volta o pedido para Pronto; **acerto** no caixa (dinheiro, comprovantes, remuneração, saldo); app do entregador em `/entregas` (só a própria rota); geocodificação pelo Nominatim só com o endereço (LGPD), usada hoje apenas nas áreas por raio.

**Nada disso muda de regra.** O despacho novo monta a mesma saída pelo mesmo `DispatchService` (só passa a ordem das paradas); entregue, não entregue e acerto continuam iguais. O diálogo atual de "Saiu para entrega" no kanban continua existindo para quem não quiser o mapa.

## 1. Tela de despacho (caixa)

Nova tela **Despacho** (`/despacho`, permissão de despachar já existente), feita para a tela grande do caixa:

- **Mapa** com a loja e os pedidos de delivery **prontos** como **pinos numerados** (o número do pedido), com a cor do atraso do kanban (`deadlineState`: no prazo, perto, atrasado) e ícone, nunca só cor. Pedidos "em preparo" aparecem esmaecidos, para o caixa já planejar.
- **Lista lateral**: pedidos prontos (número, bairro, tempo, valor, forma de pagamento, "a receber") e **entregadores**: livres (sem saída aberta) e em rota (com a última posição, quantas paradas faltam e a previsão de volta).
- **Montar a saída**: selecionar vários pedidos (clique no pino ou na lista), escolher o entregador e **"Sugerir ordem"**: a rota aparece desenhada, com distância e tempo totais e a previsão de cada parada. O caixa **reordena arrastando** na lista (a rota e as previsões se refazem) e confirma com **F9** (mapa único de atalhos) ou o botão.
- **Endereço errado**: o caixa **arrasta o pino** para o lugar certo. A coordenada nova vale para o pedido e, se ele marcar, para o endereço do cliente (próximos pedidos já saem certos). Fica na auditoria; a **taxa já cobrada não muda** (se o ponto sair da área, a tela avisa).
- **Sem localização**: pedidos cujo endereço não foi encontrado ficam numa seção "Marcar no mapa" (o caixa clica no ponto).
- **Celular e tablet**: no tablet horizontal, mapa e lista lado a lado; no celular, abas Mapa/Lista (o despacho é do caixa, mas precisa funcionar).

## 2. Acompanhamento em tempo real

- **Posição do entregador** no mapa enquanto a saída está aberta, com a hora do último sinal ("sem sinal há 3 min" quando parar de chegar).
- **Status de cada parada** (a caminho, entregue, não entregue) e **previsão de chegada** de cada uma, recalculada a partir da posição atual quando uma parada é concluída ou a cada poucos minutos (não a cada sinal, para não gastar o serviço de rotas).
- **Sem recarregar**: os mesmos eventos de tempo real de hoje (`delivery.updated`) mais um evento de posição para a sala da loja; o painel atualiza o mapa e a lista.
- O **cliente** (acompanhamento do cardápio digital) continua vendo o status; mostrar a previsão de chegada para ele fica como opção futura, **sem a posição do entregador** (LGPD, seção 6).

## 3. App do entregador

O entregador **recebe a rota quando ela é atribuída (com notificação)**, vê as paradas na ordem, abre a **navegação** para cada uma, marca **"Entregue"** e **"Não entregue"** como hoje e **envia a localização só durante a rota**.

- **Navegação**: botão que abre o **Google Maps** ou o **Waze** já com o destino (links públicos, sem custo de API). Não reinventamos navegação curva a curva.
- **Localização só durante a rota**: começa quando a saída é atribuída e termina quando ele volta (saída encerrada); fora disso o app não lê o GPS.

### PWA (o `/entregas` de hoje) ou app nativo?

| | PWA (navegador) | App nativo Android (React Native com Expo) |
|---|---|---|
| Instalação | nenhuma (link) | APK instalado à mão no início; Play Store depois (US$ 25, uma vez) |
| Localização com a tela apagada ou **com o Waze/Maps em primeiro plano** | **não funciona**: o navegador para de entregar a posição quando a página sai da frente ou a tela apaga ([Chromium](https://groups.google.com/a/chromium.org/g/chromium-bugs/c/LgjuEMklAbQ), [PWA](https://progressier.com/pwa-capabilities/geolocation)) | **funciona**, com um serviço em primeiro plano e a notificação fixa "Rota em andamento" ([Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)) |
| Notificação de rota nova | Web Push funciona no Android; no iPhone só com o app adicionado à tela inicial | push confiável (Firebase Cloud Messaging) |
| GPS exige https | sim (no teste local, pelo túnel) | não para o GPS; a API em http na rede local precisa de liberação no app de teste |
| Manutenção | a que já temos | um app a mais (Expo, TypeScript, reaproveita `@app/shared`) |

O ponto decisivo: o entregador costuma rodar com o **Waze ou o Google Maps na frente** e o celular no suporte ou no bolso. Nessa situação a PWA **não envia a posição**, então o rastreamento ficaria cego justamente durante a rota. **Recomendação:** app **nativo Android** (Expo) para quem faz entregas, e o `/entregas` atual continua como alternativa (iPhone ou quem não instalar), com a localização só enquanto a página estiver aberta e a tela acesa (Wake Lock). Cuidados do Expo a respeitar: iniciar o rastreamento por um toque do entregador (o Android não deixa iniciar o serviço com o app em segundo plano) e testar a atualização do app com a rota aberta (há um defeito conhecido do SDK 56 nesse caso, [expo#47595](https://github.com/expo/expo/issues/47595)).

## 4. Mapa, endereço e rotas: serviços comparados

| Serviço | Para quê | Grátis por mês | Precisão no Brasil | Observações |
|---|---|---|---|---|
| **Google Maps Platform** | mapa, geocodificação, rotas, matriz, otimização | por SKU desde mar/2025: **10 mil** (Essentials: mapa dinâmico, geocodificação, rotas), 5 mil (Pro), mil (Enterprise) ([Google](https://developers.google.com/maps/billing-and-pricing/overview)); a franquia é **da conta inteira**, não por restaurante | **a melhor** para número de casa | **exige conta de faturamento com cartão** mesmo no gratuito ([Google Cloud](https://docs.cloud.google.com/free)); acima da franquia, ~US$ 5 por mil geocodificações e ~US$ 7 por mil carregamentos de mapa ([tabela de terceiros](https://mapatlas.eu/blog/google-maps-api-pricing-2026)); otimização cobrada por entrega (preço atual não confirmado) |
| **Mapbox** | mapa, geocodificação, rotas | 50 mil carregamentos de mapa web, 100 mil geocodificações temporárias, 100 mil rotas ([fontes de terceiros](https://storerocket.io/learn/mapbox-pricing)) | boa nas capitais, a medir | fontes divergem sobre cartão; sem teto de gasto automático |
| **MapLibre GL + OpenStreetMap** | só o desenho do mapa | biblioteca livre; mapas do **OpenFreeMap** sem chave nem conta, ou **Protomaps** servido por nós | o mapa em si é bom | sem custo por carregamento; nada de servidor de mapas do próprio OSM (a política de uso proíbe uso intenso) |
| **Nominatim (OSM)** | geocodificação (já usamos) | grátis (público com limite de 1/s) ou próprio | **fraca para número de casa**: muitos endereços caem no meio da rua, sobretudo fora das capitais ([Geofabrik](https://geofabrik.de/data/geocoding.html), [OSM](https://help.openstreetmap.org/questions/27672/lots-of-address-in-brazil-that-dont-get-geocoordinates-by-nominatim-api)) | por isso o pino arrastável é obrigatório |
| **OSRM** | rota, tempo de viagem, matriz entre pontos | software livre, servido por nós (extrato do OSM da região, Geofabrik) | bom (malha viária do OSM) | o processamento do Brasil inteiro pede muita memória ([relato](https://lists.openstreetmap.org/pipermail/osrm-talk/2019-June/001774.html)); um estado ou o Sudeste cabe melhor; o servidor público de demonstração serve só para testes leves |
| **VROOM / GraphHopper** | otimização de várias paradas | livres, servidos por nós | — | VROOM usa a matriz do OSRM; útil se um dia houver janelas de horário e vários entregadores ao mesmo tempo |

### Recomendação (custo quase zero por restaurante)

- **Mapa:** **MapLibre GL** com o estilo do **OpenFreeMap** (sem chave). O despacho fica aberto o dia todo e o app do entregador também: cobrança por carregamento de mapa seria o maior custo.
- **Endereço → coordenada:** atrás do `GeocodingProvider` que já existe, com **cache por endereço normalizado** (cada endereço é geocodificado uma vez). Dois provedores: **Nominatim** (padrão, sem cartão) e **Google Geocoding** (opcional, quando houver conta; muito mais preciso para número de casa). Em ambos, o **pino arrastável** corrige o que vier errado e a correção fica salva no endereço do cliente.
- **Ordem das paradas e previsões:** a **matriz de tempos** vem de um `RoutingProvider` novo (**OSRM** servido por nós em produção; o servidor de demonstração do OSRM no desenvolvimento; linha reta com velocidade média nos testes). A **ordem** é calculada por uma **função pura nossa** em `shared/domain` (exata até ~10 paradas, heurística acima), testada como as outras regras de valor. Sem pagar API de otimização.
- **Por que não tudo no Google:** a franquia é da conta inteira. Um restaurante com ~40 entregas por dia consome ~7 mil elementos de matriz por mês; com o segundo restaurante passaria da franquia, e a matriz custaria dezenas de dólares por restaurante por mês. Geocodificação com cache, ao contrário, fica em ~400 consultas por restaurante por mês: a franquia do Google cobre ~25 restaurantes.

**Custo estimado:** com MapLibre/OpenFreeMap, OSRM próprio e Nominatim, **zero por restaurante** (o OSRM ocupa memória no servidor: a medir com o extrato da região). Com o Google para geocodificação, **zero até ~25 restaurantes** e depois ~US$ 2 por restaurante por mês. Valores de terceiros: conferir nas páginas oficiais antes de contratar.

## 5. Notificações

- **App nativo:** push pelo Firebase Cloud Messaging (conta gratuita, plano Spark, sem cartão) através do serviço de push do Expo (gratuito). Som e vibração quando uma rota é atribuída.
- **PWA:** Web Push com chaves VAPID geradas por nós (sem conta de terceiros).

## 6. LGPD e limites do rastreamento

- **Só durante a rota**: a coleta começa quando a saída é atribuída e o entregador toca em "Iniciar rota"; para quando a saída é encerrada. Nunca fora de uma saída aberta; o servidor recusa posição sem saída aberta.
- **Transparência**: na primeira vez, o app explica o que é coletado (posição, precisão, velocidade), quando, para quê (despacho e previsão de chegada), quem vê e por quanto tempo fica guardado; o aceite é registrado com versão e data (como os termos, D043). Durante a rota, um aviso visível "Localização compartilhada com <restaurante>" e, no Android, a notificação fixa do serviço.
- **Quem vê**: só caixa, gerente e dono da unidade. O cliente **não** vê a posição.
- **Minimização e retenção**: uma posição a cada ~10–15 s (ou a cada ~50 m); as posições brutas são **apagadas em 7 dias** (configurável); fica só o resumo da saída (distância, tempos) para os relatórios de entrega.
- **O próprio entregador** vê o que foi registrado das suas rotas.
- O rastreamento de quem presta serviço (autônomo ou CLT) merece **revisão jurídica** antes de clientes reais, como os termos de uso.

## 7. Simulação

Um **entregador simulado** que anda pela rota, para testar e demonstrar sem ninguém na rua:

- No painel (só no desenvolvimento, no servidor de casa e na Demo pública): numa saída aberta, "Simular entregador" move a posição pela geometria da rota na velocidade escolhida (normal, 5x, 20x), passando pela **mesma API** que o app usa, e marca cada parada como entregue ao chegar (ou "não entregue" numa delas, para testar).
- Também como comando (`pnpm dispatch:simular`) para os roteiros visuais e o e2e.
- Na Demo pública, uma saída fica sempre em andamento com o entregador simulado, para quem visita ver o mapa vivo.

## 8. Como testar sem hospedagem

- **Despacho, mapa, sugestão de ordem e simulação**: no Surface (servidor de casa) ou no desenvolvimento, abertos do desktop; tudo com o Nominatim e o servidor de demonstração do OSRM (sem conta). Sem internet, o modo de teste usa linha reta.
- **GPS real no seu celular com a PWA**: `pnpm servidor:tunel` dá o endereço https; o `/entregas` envia a posição enquanto a tela estiver aberta.
- **App nativo no seu celular**: build de desenvolvimento do Expo instalado pelo cabo USB ou por QR Code, apontando para o servidor de casa pela rede local (ou pelo túnel). Dá para montar sem conta, com o Android Studio, ou com o EAS do Expo (conta gratuita, poucas montagens por mês).
- **Contas**, nenhuma obrigatória para começar:

  | Conta | Para quê | Cartão? | Quando |
  |---|---|---|---|
  | Expo | montar o app na nuvem (EAS) e enviar push | não | ao começar o app nativo (ou montar local, sem conta) |
  | Firebase (Google) | push no Android | não (plano gratuito) | ao testar notificações do app |
  | Google Cloud (Maps) | geocodificação mais precisa | **sim**, mesmo no gratuito | opcional; dá para começar sem |
  | Google Play | publicar o app na loja | US$ 25, uma vez | só na distribuição; o APK basta para testar |

## 9. O que muda no código (resumo)

- **Modelo**:
  - `CourierPosition`: saída, entregador, latitude, longitude, precisão, velocidade, direção, hora (com a retenção);
  - na parada: ordem planejada, previsão e distância e tempo do trecho;
  - na saída: geometria da rota e totais planejados;
  - no endereço do pedido e do cliente: origem da coordenada (Google, Nominatim ou manual) e precisão (casa ou rua);
  - aceite do rastreamento pelo entregador;
  - token de push do aparelho.
- **Shared**: `orderStops` (ordem das paradas, função pura), previsões por trecho e regras do rastreamento (quando aceitar posição).
- **API**:
  - `RoutingProvider` (OSRM, Google, linha reta) ao lado do `GeocodingProvider` (Nominatim, Google);
  - rotas: sugestão de rota, correção de pino (auditada), posições (só o entregador da saída aberta, com limite de frequência), aceite do rastreamento;
  - eventos de tempo real;
  - o `DispatchService` recebe a ordem das paradas;
  - limpeza diária das posições antigas.
- **Painel**: tela `/despacho` (MapLibre), mapa ao vivo e a simulação.
- **Entregador**: `/entregas` melhorado (rota, navegação, aviso de rastreamento, Wake Lock) e o app nativo `apps/courier` (Expo, Android primeiro).
- **Testes**: funções puras, e2e (rota, pino, posições, recusa fora da rota, retenção) e roteiro visual do despacho com o entregador simulado.

## 10. Fases (com aprovação visual ao fim de cada uma)

1. **Despacho e rota:** tela de despacho, pinos, sugestão e ajuste da ordem, pino arrastável, `RoutingProvider`/`GeocodingProvider` com cache, a saída criada pelo `DispatchService` com a ordem, previsões; **entregador simulado** já aqui (para ver o mapa vivo sem app).
2. **Acompanhamento e PWA:** posição ao vivo no despacho, previsões recalculadas, `/entregas` com rota, navegação, aviso de rastreamento e localização enquanto aberto (testado pelo túnel no seu celular), Web Push.
3. **App nativo Android (Expo):** login do entregador, rota com notificação, navegação, entregue/não entregue, localização em segundo plano só durante a rota, aceite do rastreamento; teste no seu celular.

## OSRM próprio na produção: memória e disco

Tamanhos atuais no Geofabrik (2026-10-14): **Região Sul 407 MB**, **Brasil 1,95 GB** (`.osm.pbf`). Regras práticas da comunidade do OSRM (perfil de carro): o **preparo** (extract, partition, customize) chega a cerca de **5 vezes** o tamanho do arquivo em memória, e o **servidor no ar** usa mais ou menos o tamanho dos arquivos preparados (bem menos que o preparo) ([wiki do OSRM](https://github-wiki-see.page/m/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements), [relato de operador](https://lists.openstreetmap.org/pipermail/osrm-talk/2021-May/001997.html), [estimativa de 2x a 5x](https://ask.openrouteservice.org/t/requirements-based-on-osm-data/2016)).

| | Região Sul | Brasil inteiro |
|---|---|---|
| Arquivo do Geofabrik | 0,4 GB | 2 GB |
| Preparo (pico de memória) | ~2 GB | ~10 GB |
| Disco dos arquivos preparados | ~1,5–2 GB | ~8–10 GB |
| Memória do servidor no ar | ~1–1,5 GB | ~5–6 GB |
| Cabe na VM planejada (12 GB, com ~2 GB de containers e ~2 GB do Postgres)? | **sim**, inclusive o preparo | o servidor no ar fica apertado; o preparo **não cabe** junto com o sistema (prepararia em outra máquina e enviaria os arquivos) |

**Recomendação para a produção:** só o extrato da região atendida (a Sul, ou um estado), preparado mensalmente (o mapa do OSM muda) e trocado sem parar o serviço. Os números acima são estimativas: medir no desktop com o extrato da Sul antes da publicação na Contabo. No desenvolvimento e na demonstração, o servidor público do OSRM.

## Decisões (aprovadas em 2026-10-15)

1. **Mapa:** MapLibre com OpenFreeMap (estilo público, sem chave nem conta, com a atribuição do OpenStreetMap), atrás de uma interface que permita trocar o provedor de mapas depois.
2. **Geocodificação:** Nominatim com **cache** por endereço e **pino arrastável**, salvando a correção no cadastro do cliente; Google como opção futura. **Política de uso do Nominatim público:** no máximo 1 consulta por segundo (fila única na API), identificação própria (User-Agent da aplicação e e-mail de contato), nada de geocodificação em lote, resultado guardado no cache.
3. **Rotas:** OSRM, com a **ordem calculada pela nossa função**, atrás de uma interface `RoutingProvider`. O servidor público do OSRM só no desenvolvimento e na demonstração. **Se o serviço de rotas falhar**, o despacho continua funcionando com **estimativa em linha reta e ordem pela distância**.
4. **App do entregador:** nativo Android com Expo, mantendo o `/entregas` como alternativa. Para começar, **distribuição pelo APK**, sem a Play Store. A publicação na Play Store (com a justificativa exigida para localização em segundo plano) e o app para iPhone ficam como etapas futuras (ROADMAP).
5. **Posições:** guardadas por **7 dias**.
6. **Entregador simulado na Demo pública:** sim, **identificado como "simulado"** na tela, **sem consumir** geocodificação nem rotas a cada volta (rota pré-calculada e guardada).
7. **Fases**, com aprovação visual ao fim de cada uma: **1) despacho e rota com a simulação; 2) tempo real e PWA; 3) app Android.** Ao fim de cada fase: merge na `main`, `pnpm servidor:atualizar` e os endereços para testar de outra máquina.
