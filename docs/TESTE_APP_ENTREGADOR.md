# Teste do app do entregador (Android)

Roteiro para testar o app nativo (D050) no seu celular Android, primeiro em casa pela rede local e depois na rua. O `/entregas` no navegador continua funcionando como alternativa (iPhone ou quem não instalar o app).

## 1. Instalar pela rede de casa

1. No Surface, com o servidor no ar (`pnpm servidor:subir`), publique o APK: `pnpm servidor:apk`. O comando mostra o endereço de download e o endereço do servidor.
2. No celular (no mesmo Wi-Fi), abra no Chrome `http://<IP do Surface>:3000/api/courier-app/download`. O download começa.
3. Abra o arquivo baixado. Na primeira vez o Android pede para **permitir instalar apps desta fonte** (o Chrome): permita e volte. Toque em **Instalar**.
   - Se aparecer o Play Protect ("app desconhecido"), toque em **Mais detalhes › Instalar mesmo assim**. É esperado: o app não vem da Play Store.
4. Abra o app **Entregas**:
   - **Endereço do servidor:** `<IP do Surface>:3000` (o mesmo do painel). O app confere o endereço antes de salvar.
   - **Login:** `entregador@demo.local` / `Demo1234` (Demo) ou o e-mail de um entregador real.

## 2. Em casa, antes de sair

No computador, abra o despacho como caixa (`http://<IP do Surface>:3000/despacho`, `caixa@demo.local`).

| # | Faça | Confira |
|---|---|---|
| 1 | No despacho, mande 2 pedidos prontos para o Gustavo (o entregador do `entregador@demo.local`). | O celular mostra a notificação "2 entregas na sua rota" (se o Firebase estiver configurado) e, ao abrir o app, as 2 entregas com a chegada prevista. Sem Firebase, puxe a tela para baixo para atualizar. |
| 2 | Toque em **Iniciar rota**. | Aparece o texto do aceite (o que é enviado, quem vê, 7 dias). Toque em **Concordo e iniciar a rota**. |
| 3 | Permissões: **Permitir durante o uso**, depois a explicação e a tela do Android: **Permitir o tempo todo**. Volte ao app. Permita as notificações. | A notificação fixa **"Compartilhando localização"** aparece na barra. |
| 4 | Se o app mostrar **"Não deixe o celular fechar o app"**: toque em **Permitir em segundo plano** e siga os passos da sua marca. | O Android pergunta se o app pode rodar em segundo plano: **Permitir**. |
| 5 | Ande pela casa ou pela rua em frente por 1 minuto. | No despacho, o Gustavo anda no mapa. |
| 6 | Apague a tela por 2 minutos. | O despacho continua mostrando a posição (sem "sem sinal"). |
| 7 | Toque em **Google Maps** numa entrega, depois volte com o botão Voltar (ou tocando na notificação fixa). | O Maps abre com a navegação até o ponto; o app volta como estava. Repita com **Waze**. |
| 8 | Ligue o **modo avião**, toque em **Entregue** numa entrega (escolha a forma de pagamento) e em **Não entregue** na outra. | O app mostra "Aguardando sinal" nas duas. No despacho, nada muda. |
| 9 | Desligue o modo avião. | Em segundos as duas ações chegam ao despacho, uma vez só (confira o histórico do pedido). A notificação fixa some sozinha: não há mais entregas. |
| 10 | Toque em **Voltei para a loja**. | O caixa vê o entregador para acerto. |

## 3. Na rua (com uma saída de verdade ou de teste)

Faça uma saída com 2 ou 3 entregas próximas (podem ser pedidos de teste na Demo do servidor de casa, com o celular no 4G e o servidor alcançável pelo túnel ou depois da publicação na Contabo).

1. **Iniciar rota** antes de sair da loja.
2. Abra o **Waze** na primeira entrega e deixe o Waze na frente o caminho todo.
3. No meio do caminho, **apague a tela** e guarde o celular no bolso por uns 5 minutos.
4. Peça para alguém acompanhar no despacho: o entregador deve andar no mapa o tempo todo, sem "sem sinal há N min", e as chegadas previstas devem se ajustar.
5. Em um lugar sem sinal (garagem, elevador), marque **Entregue**. Ao sair, confira que chegou ao despacho.
6. Na última entrega, a notificação **"Compartilhando localização"** some sozinha.
7. Em casa, confira no app: "N posições guardadas das suas rotas (apagadas em 7 dias)".

Anote a marca e o modelo do celular e, se o rastreamento parar com a tela apagada, quais passos da economia de bateria estavam feitos (é o que mais varia entre marcas).

## 4. Atualização

1. Depois de uma versão nova (`pnpm --filter @app/courier apk` com o `versionCode` maior em `apps/courier/release.json`), publique com `pnpm servidor:apk`.
2. Abra o app: aparece **"Versão nova do app"**. Toque em **Baixar e instalar**: o Android atualiza por cima, mantendo login e fila (a assinatura é a mesma).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Não encontrei o servidor nesse endereço" | Celular no mesmo Wi-Fi do Surface; o servidor no ar (`pnpm servidor:status`); o endereço com a porta `:3000`. |
| A notificação fixa some com a tela apagada | Economia de bateria da marca: no app, "Celular fechando o app? Ver economia de bateria". |
| Não chegam avisos de rota nova | O APK precisa ter sido montado com o `google-services.json`, e o servidor com a conta de serviço do Firebase (docs/SETUP.md, "App do entregador"). |
| "O app não foi instalado" ao atualizar | O APK foi assinado com outra chave: só a chave de `~/.config/app-courier/release.jks` atualiza o app instalado. |
