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
npm run orders         # ou: npm run auth / npm run menu
```

Cada roteiro imprime `PASS`/`FAIL` por passo e os erros HTTP/console vistos; capturas de tela ficam em `screenshots/`.

- `auth.mjs`: cadastro, login, empresa, horários, usuários, papéis, tema escuro (cria unidades `cantina-ui-teste-*`).
- `menu.mjs`: cardápio, complementos, pizza, pausa, pré-visualização, upload de foto.
- `orders.mjs`: kanban, novo pedido, tempo real, conflito 409, cancelamentos, mesas, cupons e permissões.

O login tem limite de tentativas (429): ao rodar várias vezes seguidas, reinicie a API.
