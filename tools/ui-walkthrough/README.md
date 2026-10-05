# Roteiros visuais (Playwright)

Roteiros que percorrem as telas do painel como um usuário, contra o **build de produção** e o seed de demonstração. Não fazem parte do workspace pnpm nem do `pnpm check`.

Usam o Microsoft Edge instalado (`channel: 'msedge'`), headless, um navegador só e sem paralelismo (máquinas com pouca memória).

```powershell
cd tools/ui-walkthrough
npm install            # só na primeira vez (playwright-core)
cd ../..
pnpm db:seed           # dados limpos (os roteiros alteram pedidos)
pnpm start:lite        # em outro terminal: API 3333 + painel 3000
cd tools/ui-walkthrough
npm run orders         # ou: npm run auth / npm run menu / npm run pos / npm run kds
```

Cada roteiro imprime `PASS`/`FAIL` por passo e os erros HTTP/console vistos; capturas de tela ficam em `screenshots/`.

- `auth.mjs`: cadastro, login, empresa, horários, usuários, papéis, tema escuro (cria unidades `cantina-ui-teste-*`).
- `menu.mjs`: cardápio, complementos, pizza, pausa, pré-visualização, upload de foto.
- `orders.mjs`: kanban, novo pedido, tempo real, conflito 409, cancelamentos, mesas, cupons e permissões.
- `pos.mjs`: caixa (abertura, fechamento cego, sangria, relatório, reabertura), recebimento com troco, divisão e PIX, delivery a receber, pré-conta, dividir por itens, transferir/trocar/juntar/separar mesas, estorno e chave PIX. A impressão é simulada (`window.print` vira o evento `afterprint`).
- `kds.mjs`: limites por setor, tela nova com código, vínculo do tablet (código errado e certo) sem login, iniciar/pronto/desfazer, ticket novo e cancelamento em tempo real com os sons conferidos (`AudioContext` instrumentado), remoções em destaque, consolidado, "Acabou", expedição (entregue e saiu para entrega), revogação imediata e layout de TV.

Rodar vários roteiros seguidos estoura o limite de login (10 por minuto): espere um minuto entre eles ou reinicie a API.

O login tem limite de tentativas (429): ao rodar várias vezes seguidas, reinicie a API.
