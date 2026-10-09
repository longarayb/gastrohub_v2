# Roteiros visuais (Playwright)

Roteiros que percorrem as telas do painel como um usuário, contra o **build de produção** e o seed de demonstração. Não fazem parte do workspace pnpm nem do `pnpm check`.

Usam o Microsoft Edge instalado no Windows e o Chromium do Playwright no Linux/WSL (`browser.mjs`), headless, um navegador só e sem paralelismo (máquinas com pouca memória).

Passam a qualquer hora: o seed deixa a unidade aberta e no mesmo dia de negócio por 3 horas. Para simular um horário (Linux/WSL), use `fake-clock.sh` (docs/SETUP.md, "Relógio simulado").

**Capturas do redesign:** `SHOTS=<pasta> node screens.mjs` captura as telas principais nos dois temas, no computador e no celular (avisa rolagem lateral), em `docs/screenshots/redesign/<pasta>/` (fora do git). Com `SHOTS_DIR=../../docs/screenshots/final DEVICES=computador ONLY=login,painel,pedidos,pedidos-novo,caixa,mesas,kds,relatorios-vendas` grava o conjunto versionado.

**Acessibilidade:** `npm run a11y` (precisa de `pnpm start:lite --menu`) passa o axe-core (WCAG 2.1 A e AA) nas telas principais, nos dois temas, no computador e no celular; falha com violação séria ou crítica (`ONLY=login,caixa` limita as telas).

```powershell
cd tools/ui-walkthrough
npm install            # só na primeira vez (playwright-core e @axe-core/playwright)
cd ../..
pnpm db:seed           # dados limpos (os roteiros alteram pedidos)
pnpm start:lite        # em outro terminal: API 3333 + painel 3000
cd tools/ui-walkthrough
npm run orders         # ou: npm run auth / menu / keyboard / pos / kds / delivery / digital-menu / printing / dashboard
```

Cada roteiro imprime `PASS`/`FAIL` por passo e os erros HTTP/console vistos; capturas de tela ficam em `screenshots/`.

- `auth.mjs`: cadastro, login, empresa, horários, usuários, papéis, tema escuro (cria unidades `cantina-ui-teste-*`).
- `menu.mjs`: cardápio, complementos, pizza, pausa, pré-visualização, upload de foto.
- `orders.mjs`: kanban, novo pedido, tempo real, conflito 409, cancelamentos, mesas, cupons e permissões.
- `pos.mjs`: caixa (abertura, fechamento cego, sangria, relatório, reabertura), recebimento com troco, divisão e PIX, delivery a receber, pré-conta, dividir por itens, transferir/trocar/juntar/separar mesas, estorno e chave PIX. A impressão é simulada (`window.print` vira o evento `afterprint`).
- `kds.mjs`: limites por setor, tela nova com código, vínculo do tablet (código errado e certo) sem login, iniciar/pronto/desfazer, ticket novo e cancelamento em tempo real com os sons conferidos (`AudioContext` instrumentado), remoções em destaque, consolidado, "Acabou", expedição (entregue e saiu para entrega), revogação imediata e layout de TV.

- `delivery.mjs`: áreas (bairros sem área, nova área, suspender e retomar), taxa da área no novo pedido com redução e motivo, detalhe com mapas, saída com vários pedidos, não entregue, app do entregador no celular (só a própria rota, entregue com PIX, volta), acerto no caixa (falta descontada, pagar agora e acumular), extrato com pagamento semanal, relatório, tema escuro e celular.

- `digital-menu.mjs` (precisa de `pnpm start:lite --menu`): celular com 3G simulado (mede LCP e JS transferido), marca do restaurante, montagem de item e pizza, checkout com área, PIX e consentimento, acompanhamento em tempo real com o aceite no painel e "Já paguei", recusa com motivo para o cliente, "Não é você?", configurações, loja fechada e imagem de prévia do link.

- `printing.mjs` (precisa do bundle do agente: `pnpm --filter @app/print-agent build`, e do Docker para envelhecer um trabalho): computador novo com código, vínculo pela página local do agente real em modo virtual (código errado e certo), impressoras (validação do IP, modelo, 58 mm), página de teste com acentos, setores com vias e impressora do caixa, comandas por setor conferidas nos arquivos, 2ª via e histórico no detalhe do pedido, pré-conta direto no caixa, trabalho retido com o agente desligado e liberado pelo alerta (sai como atrasado), tema escuro, celular e desvínculo imediato; no fim remove as impressoras.

- `keyboard.mjs`: novo pedido só com o teclado (busca com foco, setas e Enter, quantidade, complementos, observação, F2/F6/F7/F9, mapa de atalhos com "?"), sem nenhum clique depois do login; F9 duas vezes cria um pedido só e, no caixa, registra o pagamento sem fechar a conta (trava de 1 s).

- `dashboard.mjs`: dashboard do dia (indicadores, ⓘ, ticket total/só produtos, média de 4 semanas, pedido novo em tempo real, conciliação), celular sem rolagem lateral e áreas de toque ≥ 44 px, tema escuro, Vendas (90 dias, curva ABC, mapa de calor, CSV com BOM, impressão A4), Controle de perdas (por usuário, "depois da produção"), Tempos (limite de 120 dias) e permissões (caixa sem acesso, gerente sem a visão da rede). Usa o histórico de 90 dias do seed.

Rode `pnpm db:seed` antes de cada roteiro: eles alteram pedidos e saídas.

Os roteiros podem rodar em sequência: o `.env` de desenvolvimento eleva o limite de login (`LOGIN_RATE_LIMIT_PER_MINUTE=300`; em produção é 10).

Se aparecer 429 no login, confira se o seu `.env` tem `LOGIN_RATE_LIMIT_PER_MINUTE` (veja o `.env.example`) e reinicie a API.
