# Instalação em um computador Windows novo

Passo a passo para deixar um Windows 10/11 recém-instalado pronto para desenvolver o projeto, do zero até o painel aberto no navegador. Tempo estimado: 40–60 minutos (a maior parte é download).

> Os comandos são para o **PowerShell**. Quando o passo pedir **PowerShell como administrador**, abra o menu Iniciar, digite "PowerShell", clique com o botão direito → "Executar como administrador".

## 1. Ativar a virtualização (necessária para o Docker)

1. Abra o **Gerenciador de Tarefas** (Ctrl+Shift+Esc) → **Desempenho** → **CPU**. Se aparecer **Virtualização: Habilitado**, pule para o passo 2.
2. Se estiver desabilitado, reinicie o computador e entre na BIOS/UEFI (geralmente F2, F10, Del ou Esc logo ao ligar; em notebooks, consulte o fabricante).
3. Ative a opção **Intel Virtualization Technology (VT-x)** ou **AMD SVM / AMD-V** (costuma ficar em *Advanced*, *CPU Configuration* ou *Security*). Salve e reinicie.
4. Instale o WSL2 (PowerShell como administrador) e reinicie quando ele pedir:

   ```powershell
   wsl --install
   ```

## 2. Ajustar o arquivo de paginação (memória virtual)

Builds do Next.js, testes e o navegador ao mesmo tempo esgotam o limite de memória do Windows em máquinas com pouca RAM (processos morrem com o código `0xC0000409`). Aumente a memória virtual:

1. Tecla Windows → digite **"Exibir configurações avançadas do sistema"** → aba **Avançado** → em *Desempenho*, **Configurações...** → aba **Avançado** → em *Memória virtual*, **Alterar...**
2. Desmarque **"Gerenciar automaticamente o tamanho do arquivo de paginação"**.
3. Selecione a unidade **C:** → **Tamanho personalizado**: inicial **8192** MB, máximo **24576** MB (ou cerca de 3× a RAM) → **Definir** → **OK**.
4. Reinicie o computador.

Opcional, para limitar a memória que o Docker/WSL reserva: crie `C:\Users\<seu-usuário>\.wslconfig` com:

```ini
[wsl2]
memory=3GB
swap=2GB
```

## 3. Liberar scripts no PowerShell

O `pnpm` e outros comandos instalam scripts `.ps1`. Em um PowerShell normal (não precisa ser administrador):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Responda **S** (Sim) se perguntar.

## 4. Instalar as ferramentas

Em um **PowerShell como administrador** (o `winget` já vem no Windows 10/11 atualizado):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
```

Se preferir baixar os instaladores:

| Ferramenta | Versão usada | Link |
|---|---|---|
| Git for Windows | 2.4x+ (testado com 2.55) | https://git-scm.com/download/win |
| Node.js LTS | **24** (testado com 24.19) | https://nodejs.org/pt-br/download |
| Docker Desktop | com backend WSL2 (testado com 29.8) | https://www.docker.com/products/docker-desktop/ |
| Claude Code | atual | https://docs.claude.com/en/docs/claude-code/setup |

**Feche e abra o PowerShell** depois de instalar (para recarregar o PATH). Se um comando recém-instalado não for encontrado, rode:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

### pnpm via corepack

Ainda no **PowerShell como administrador** (o corepack grava na pasta do Node em *Arquivos de Programas*):

```powershell
corepack enable pnpm
```

A versão exata do pnpm (12) vem do campo `packageManager` do `package.json`; o corepack baixa sozinho na primeira execução.

### Docker Desktop

1. Abra o **Docker Desktop**, aceite os termos e espere o ícone da baleia ficar estável ("Engine running").
2. Em *Settings → General*, deixe marcado **Use the WSL 2 based engine**.
3. Opcional: *Settings → General → Start Docker Desktop when you sign in*.

### Claude Code

Em um PowerShell normal:

```powershell
irm https://claude.ai/install.ps1 | iex
```

(Alternativa: `npm install -g @anthropic-ai/claude-code`.) Depois rode `claude` e faça login. No VS Code, instale também a extensão **Claude Code**. Ao abrir a sessão na pasta do projeto, peça para ler `docs/HANDOFF.md` (o `CLAUDE.md` já aponta para ele).

Confira as versões:

```powershell
git --version; node -v; pnpm -v; docker --version
```

## 5. Clonar o repositório

Use a mesma pasta da máquina original (o `CLAUDE.md` cita `D:\GastroHub_v2`; se não houver disco D:, qualquer pasta sem espaços serve):

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
git config --global core.autocrlf false
git clone https://github.com/longarayb/gastrohub_v2.git D:\GastroHub_v2
cd D:\GastroHub_v2
```

> `core.autocrlf false`: o repositório controla as quebras de linha pelo `.gitattributes` (LF; `.ps1/.cmd` em CRLF).

## 6. Criar o `.env`

```powershell
Copy-Item .env.example .env
```

Os valores do `.env.example` são de **desenvolvimento** e funcionam sem alteração (banco `app_db`, usuário `app`/`app_dev`, Redis e Mailpit locais, segredos JWT fictícios). Nunca commite o `.env`.

As portas do Docker no computador (`POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`) vêm do `.env` e as URLs as seguem (`DATABASE_URL=...localhost:${POSTGRES_PORT}/...`). Se alguma estiver ocupada nesta máquina, veja "Problemas comuns".

## 7. Instalar dependências

```powershell
pnpm install
```

O `postinstall` gera o Prisma Client. Se aparecer aviso de "build scripts ignorados", os permitidos já estão em `pnpm-workspace.yaml` (`allowBuilds`).

## 8. Subir o Docker, rodar migrations e seed

Com o Docker Desktop aberto, um comando faz tudo (sobe Postgres, Redis e Mailpit, aplica as migrations, compila os pacotes compartilhados e popula o seed):

```powershell
pnpm bootstrap
```

Equivalente, passo a passo:

```powershell
pnpm infra:up                          # Postgres, Redis e Mailpit (cria também app_db_test)
pnpm --filter @app/api db:deploy       # gera o Prisma Client e aplica as migrations
pnpm turbo run build --filter=./packages/*
pnpm db:seed                           # unidade de demonstração (pode rodar de novo quando quiser)
```

## 9. Rodar o projeto

**Modo leve (recomendado nesta máquina):** builds de produção da API e do painel, sem watchers nem hot reload. Recompila só o que mudou.

```powershell
pnpm start:lite
```

Outros modos:

| Comando | Quando usar |
|---|---|
| `pnpm start:lite` | Navegar e testar telas gastando pouca memória (API 3333 + painel 3000) |
| `pnpm start:lite --admin` | Idem, com o painel da plataforma (3002); combina com `--menu` |
| `pnpm dev:lite` | Desenvolver com hot reload só da API e do painel (sem o cardápio digital); rode `pnpm infra:up` antes |
| `pnpm dev` | Tudo em modo watch (API, painel e cardápio digital); o mais pesado |

Para parar: **Ctrl+C** no terminal. Para desligar os containers sem apagar dados: `docker compose stop`.

## Links

| Serviço | URL |
|---|---|
| Painel (pedidos, mesas, cardápio, configurações) | http://localhost:3000 |
| API (Swagger) | http://localhost:3333/docs |
| Health check da API | http://localhost:3333/api/health |
| Mailpit (e-mails de desenvolvimento, ex.: recuperação de senha) | http://localhost:8025 |
| Cardápio digital (`pnpm start:lite --menu`) | http://localhost:3001/demo |
| Painel da plataforma (`pnpm start:lite --admin`) | http://localhost:3002 |

## Credenciais de demonstração

Criadas pelo `pnpm db:seed`. **Apenas para desenvolvimento.** Unidade **Demo** (slug `demo`), senha de todos: `Demo1234`.

| Papel | E-mail | Tela inicial |
|---|---|---|
| Dono | `dono@demo.local` | Painel |
| Gerente | `gerente@demo.local` | Painel |
| Caixa | `caixa@demo.local` | Pedidos |
| Garçom | `garcom@demo.local` | Pedidos |
| Cozinha | `cozinha@demo.local` | Pedidos |
| Entregador | `entregador@demo.local` | Minhas entregas (só a própria rota; abra no celular) |

Cupons de demonstração: `BEMVINDO10` (10%, até R$ 20) e `FRETEGRATIS` (R$ 8 acima de R$ 50).

Caixa de demonstração: a **Caixa** já entra com o caixa aberto (troco inicial R$ 200); o caixa do **Gerente** da manhã está fechado com diferença de −R$ 2,50. Há um delivery entregue "a receber" e um pedido do iFood pago online. A chave PIX de demonstração (`pix@demo.local`) gera QR Codes válidos que não pagam ninguém — troque na tela Empresa por uma chave real só em produção.

Entregas: 4 áreas ("Pinheiros" suspensa por chuva), o Gustavo (usuário `entregador@demo.local`) em rota com uma entrega, a Helena de volta com uma entrega em dinheiro e uma não entregue esperando o **acerto** (Caixa ou Entregadores), e bairros sem área na tela Áreas de entrega. A geocodificação usa o Nominatim público (`GEOCODING_PROVIDER=nominatim`; `none` desliga), só quando uma área por raio precisa das coordenadas.

Cardápio digital: `pnpm start:lite --menu` e abra http://localhost:3001/demo (de preferência no celular ou com a janela estreita). A loja demo tem a cor própria, um telefone bloqueado, um pedido recusado com motivo e o PIX "já pago" da Juliana na rota do Gustavo. Os horários do seed podem deixar a loja fechada: ajuste em Configurações › Horários. As variáveis `MENU_INTERNAL_URL`, `MENU_REVALIDATE_SECRET` e `TRUST_PROXY` estão no `.env.example`.

Tela da cozinha: abra http://localhost:3000/kds com o login da **Cozinha** (ou de qualquer papel com acesso ao KDS), ou vincule um tablet sem senha: em **Cardápio › Setores de produção › Telas da cozinha**, gere o código da "TV da cozinha" e digite-o em http://localhost:3000/kds/vincular (código da unidade: `demo`).

### Painel da plataforma (D041–D044)

`pnpm start:lite --admin` e abra http://localhost:3002. **Apenas para desenvolvimento:** o seed cria o admin com um segredo de 2FA conhecido.

| Campo | Valor |
|---|---|
| E-mail | `admin@plataforma.local` |
| Senha | `Plataforma123` |
| 2FA | cadastre no aplicativo autenticador o segredo `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` (ou use um código de recuperação de `RECUP-00001` a `RECUP-00010`, cada um vale uma vez) |

Clientes de exemplo (dono com senha `Demo1234`): **Pizzaria Bella Massa** em teste (convite pendente de um gerente), **Lanchonete do Zé** atrasada há 4 dias, **Bar do Porto** em somente leitura e **Café Central** cancelado; a **Demo** está em dia no plano Completo, com os termos aceitos. O cadastro público começa **só por convite** (Configurações do painel da plataforma); os roteiros que testam o cadastro abrem e fecham o modo sozinhos. Os convites e os avisos de suporte chegam no Mailpit.

**Chave do 2FA (`PLATFORM_SECRETS_KEY`), importante em produção:** ela cifra os segredos do 2FA dos admins e só existe no `.env` do servidor. **Guarde uma cópia fora do servidor** (gerenciador de senhas ou cofre, nunca no git). Se ela se perder ou for trocada, nenhum código do aplicativo autenticador é aceito: os dados dos clientes não se perdem, mas **todo admin precisa refazer o 2FA** com o comando de emergência, rodado no servidor (não existe rota na API para isso; fica registrado na auditoria da plataforma):

```bash
# no servidor (container da API)
node dist/cli/platform-admin.js reset-2fa --email admin@exemplo.com --reason "chave perdida" --operator "Nome de quem roda"
# criar um admin: senha temporária impressa uma vez, vale 24 h sem uso e é trocada logo depois do 2FA
node dist/cli/platform-admin.js create --email admin@exemplo.com --name "Nome"
# nova senha temporária (esquecida, ou a primeira venceu); encerra as sessões e mantém o 2FA
node dist/cli/platform-admin.js reset-password --email admin@exemplo.com --reason "esqueceu a senha"
```

Em desenvolvimento: `pnpm --filter @app/api build` e `pnpm --filter @app/api platform:admin -- <comando> ...` (ex.: `pnpm --filter @app/api platform:admin -- create --email voce@exemplo.com --name "Seu Nome"`). Para testar pelo celular: `pnpm start:lite --admin --lan` e abra o endereço `http://<IP>:3002` que ele mostra (firewall em "Testar no celular").

## Testar no celular (mesma rede Wi-Fi)

O celular precisa estar na **mesma rede** que o computador. No celular, "localhost" é o próprio celular, então os apps são compilados com o IP da máquina e os servidores escutam em todas as interfaces (`0.0.0.0`):

```powershell
pnpm start:lite --menu --lan   # compila com o IP da máquina e sobe API, painel e cardápio
pnpm lan:links                 # em outro terminal: mostra os links com o IP (ex.: http://192.168.0.92:3001/demo)
```

Em desenvolvimento (com recarga automática), use `pnpm dev --lan` no lugar do `start:lite`. O `pnpm dev` comum **não** funciona no celular: ele compila com "localhost" como endereço da API, que no celular é o próprio celular.


Na primeira vez, libere as portas no **firewall do Windows** (PowerShell **como administrador**, uma vez só):

```powershell
New-NetFirewallRule -DisplayName "App dev (rede local)" -Direction Inbound -Protocol TCP -LocalPort 3000,3001,3002,3333 -Action Allow -Profile Private
```

A regra vale só para redes **Privadas**: em Configurações › Rede e Internet › Wi-Fi › (sua rede), marque "Rede privada". Nunca use `-Profile Public` (Wi-Fi de café, aeroporto). Para remover depois: `Remove-NetFirewallRule -DisplayName "App dev (rede local)"`.

**Com o projeto no WSL (Surface):** o WSL precisa usar o mesmo IP do Wi-Fi. Em `C:\Users\<você>\.wslconfig`, na seção `[wsl2]`, acrescente `networkingMode=mirrored` e rode `wsl --shutdown` (o Docker Desktop reinicia junto; se ficar em "unable to start", `docker desktop restart`). Libere também o firewall do WSL (PowerShell como administrador, uma vez):

```powershell
New-NetFirewallHyperVRule -Name "AppDevLan" -DisplayName "App dev (rede local, WSL)" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 3000,3001,3002,3333
```

No modo espelhado o próprio Windows não abre o sistema pelo IP (só por `localhost`); outros aparelhos abrem. Trocar a rede de Pública para Privada (ou mudar de rede) reinicia o WSL: suba os servidores de novo. Para remover: `Remove-NetFirewallHyperVRule -Name "AppDevLan"`. Configurado no Surface em 2026-10-13.

Observações:

- O modo `--lan` gera um build diferente (com o IP); ao voltar para `pnpm start:lite` sem `--lan`, ele recompila o painel e o cardápio.
- Se o IP da máquina mudar (outra rede, roteador reiniciado), rode de novo com `--lan`.
- O `pnpm lan:links` ignora adaptadores virtuais (WSL, Docker, VPN). Se mostrar o IP errado, confira o IPv4 do Wi-Fi com `ipconfig`.

## Prévia do link no WhatsApp (túnel temporário, só para teste)

O WhatsApp busca a página pela internet para montar a prévia (nome, descrição e imagem do restaurante), então o endereço da rede local não serve. Para testar, use um **túnel temporário** da Cloudflare (gratuito, sem conta):

```powershell
winget install --id Cloudflare.cloudflared   # uma vez; depois abra um terminal novo
pnpm start:lite --menu                        # o cardápio precisa estar no ar
pnpm tunnel:menu                              # mostra um link https://....trycloudflare.com/demo
```

Envie o link numa conversa do WhatsApp (por exemplo, para você mesmo) e confira a prévia.

> **Atenção:** o túnel deixa o ambiente de **desenvolvimento** acessível por qualquer pessoa na internet enquanto estiver aberto. Use só para este teste, com os dados de demonstração, e encerre logo depois (Ctrl+C). O comando se encerra sozinho em 30 minutos (`pnpm tunnel:menu --minutes 10` para menos). Pelo túnel só o cardápio é exposto; pedidos e fotos usam a API local, então para testar pedidos no celular use a rede local (seção acima). O WhatsApp guarda a prévia em cache: para ver uma mudança, gere um link novo.

## Agente de impressão (impressoras térmicas)

O agente (`apps/print-agent`) é um serviço do Windows instalado no computador ligado às impressoras (caixa, cozinha). Ele só faz conexões de saída e imprime o que o painel manda (D035–D037).

**Requisitos do computador do restaurante:** Windows 10 (1809 ou mais novo) ou Windows 11, **64 bits**; qualquer PC que rode o Windows serve. **Meta de memória do agente: até 80 MB** (medido: ~45 MB parado, ~54 MB conectado, ~59 MB depois de 40 comandas). Impressoras USB e compartilhadas usam o PowerShell por alguns instantes a cada impressão; as de rede (IP) não.

**Em desenvolvimento (impressora virtual, sem hardware):**

```powershell
pnpm --filter @app/print-agent build
pnpm --filter @app/print-agent start:virtual     # página local em http://127.0.0.1:9180
```

1. No painel, **Configurações › Impressão › Adicionar computador** mostra o código da unidade e o código de 6 números.
2. Em `http://127.0.0.1:9180`, informe o endereço da API (`http://localhost:3333/api`), o código da unidade (`demo`) e o código de vínculo.
3. Cadastre as impressoras (qualquer tipo: no modo `--virtual` tudo vira arquivo), aponte os setores e a impressora do caixa.
4. As impressões caem em `apps/print-agent/.data/impressoes/` (texto do que sairia no papel, mais os bytes ESC/POS em `.bin`).

**Gerar o instalador (Windows, antes de entregar a um cliente):**

1. Instale o Inno Setup 6 uma vez (sem precisar de administrador):

   ```powershell
   winget install --id JRSoftware.InnoSetup -e --scope user
   ```

2. Gere o pacote, informando o endereço da API que os restaurantes vão usar:

   ```powershell
   pnpm --filter @app/print-agent package -- --api https://api.seu-dominio.com.br/api
   ```

   O script monta o bundle, o executável único (`print-agent.exe`, com o Node 24 desta máquina), o arquivo do serviço e o instalador. O WinSW (que transforma o agente em serviço do Windows) é baixado da release oficial no GitHub por `pnpm --filter @app/print-agent fetch:winsw`, chamado automaticamente: o arquivo só é aceito se o SHA-256 bater com o fixado no script (conferido na release oficial e no manifesto do Scoop, já que o WinSW não é assinado). Fica em `apps/print-agent/installer/vendor/`, fora do git.

3. Sai `apps/print-agent/release/instalar-impressao.exe` (~30 MB). **Assine o instalador e o `print-agent.exe` antes de distribuir** (certificado de assinatura de código; ver ROADMAP, "Antes do lançamento"); sem assinatura o Windows mostra o alerta do SmartScreen na instalação.

O instalador pede administrador, instala em `C:\Program Files\<marca> Impressao`, registra o serviço `app-print-agent` (início automático com o Windows, conta LocalSystem, reinício automático em falha) e abre a página de vínculo. Instalar uma versão nova por cima mantém o computador vinculado. Se o agente ou o próprio serviço forem encerrados à força, o Windows reinicia o serviço sozinho (10 s, 30 s e depois a cada 60 s; testado matando os dois processos): o agente sai junto quando o serviço morre e espera a porta da página local liberar ao voltar, então nunca ficam dois agentes imprimindo. A desinstalação (Configurações do Windows › Aplicativos) para e remove o serviço e apaga `C:\ProgramData\app-print-agent` (credencial, configurações e logs); depois, desvincule o computador no painel.

Para testar sem cliques (como no teste desta etapa): `instalar-impressao.exe /SILENT /LOG="%TEMP%\instalacao.log"` e, para remover, `"C:\Program Files\<marca> Impressao\unins000.exe" /SILENT`.

No restaurante: executar o instalador, avançar até o fim e, na página que abre (`http://127.0.0.1:9180`), digitar os códigos mostrados no painel. Os dados do agente ficam em `C:\ProgramData\app-print-agent` (credencial protegida pelo Windows, logs em `logs\`). Para trocar de computador: "Vincular outro computador" no painel gera um código novo.

## Conferir se está tudo certo

```powershell
pnpm check          # imports versionados + build + typecheck + lint + testes unitários (concorrência 2)
pnpm format:check
pnpm test:e2e       # e2e da API (banco app_db_test; requer Docker)
```

Roteiros visuais com Playwright (opcional): veja [tools/ui-walkthrough/README.md](../tools/ui-walkthrough/README.md).

### Relógio simulado (roteiros em qualquer horário)

O seed deixa a unidade demo aberta e no mesmo dia de negócio por pelo menos 3 horas a partir do momento em que roda (D039), então os roteiros passam a qualquer hora. Para testar um horário específico (por exemplo, depois do fechamento das 23:30), no Linux/WSL use `tools/ui-walkthrough/fake-clock.sh` (baixa a `libfaketime` do Ubuntu na primeira vez, sem `sudo`):

```bash
tools/ui-walkthrough/fake-clock.sh "2026-10-13 23:40" pnpm start:lite --menu   # num terminal (uma terça)
tools/ui-walkthrough/fake-clock.sh same pnpm --filter @app/api db:seed          # no outro
cd tools/ui-walkthrough && ./fake-clock.sh same node pos.mjs
```

O primeiro comando fixa o deslocamento; `same` reaproveita-o, para a API, o seed e o roteiro concordarem. Escolha um momento **no futuro**: o cache do cardápio digital (Next) mistura o relógio simulado com o monotônico, que continua real, e só um relógio à frente do real mantém as atualizações do cache funcionando. O seed vai com `--filter` porque o Turborepo descarta variáveis de ambiente desconhecidas; o navegador recebe o mesmo deslocamento pelo `browser.mjs`. O Postgres continua no relógio real (`now()` no SQL não é simulado). Pare os servidores antes de voltar ao relógio real: o cache do cardápio guarda horários do relógio simulado.

## Problemas comuns

- **e2e com erro de ordem só no WSL** (um registro criado depois aparece antes, por exemplo "expected [2, 1] to deeply equal [1, 2]" ou o histórico terminando no status errado): o relógio do WSL adianta e é puxado de volta em saltos de 1 a 3 s (medido no Surface em 2026-10-09: 3,4 s em 60 s). Registros feitos durante o salto ficam com hora anterior aos de antes. Não é defeito do código; rode o e2e de novo. Para conferir: `python3 -c "import time;w,m=time.time(),time.monotonic();time.sleep(60);print((time.time()-w)-(time.monotonic()-m))"` (bem diferente de zero = relógio saltando). `wsl --shutdown` no PowerShell costuma normalizar.

| Sintoma | Solução |
|---|---|
| `Docker não está rodando` | Abra o Docker Desktop e espere "Engine running" |
| `pnpm` não é reconhecido | Rode `corepack enable pnpm` como administrador e reabra o PowerShell |
| "a execução de scripts foi desabilitada" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Processo morre com `0xC0000409` / `3221226505` | Pouca memória: aumente o arquivo de paginação (passo 2), feche o navegador e use `pnpm start:lite`. No `.env` da máquina, `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1` deixam `pnpm check` e o build do Next em série |
| `port is already allocated` (5432, 6379, 1025 ou 8025) no `pnpm infra:up`/`bootstrap` | Outro serviço usa a porta (outro projeto Docker, Postgres/Redis instalado no Windows). Descubra com `docker ps` ou `Get-NetTCPConnection -LocalPort 5432 \| Select OwningProcess`. Em vez de parar o outro serviço, mude a porta **só nesta máquina**, no `.env`: `POSTGRES_PORT=5433` (ou `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`). `DATABASE_URL`, `REDIS_URL` e `SMTP_PORT` usam essas variáveis (`${POSTGRES_PORT}`), então nada mais muda. Depois: `pnpm infra:down` e `pnpm infra:up`. O `.env.example` fica com as portas padrão |
| Porta 3000/3333 em uso | Um servidor antigo ficou aberto: `Get-NetTCPConnection -LocalPort 3000 \| Select OwningProcess` e `Stop-Process -Id <pid>` |
| Taxa de entrega pede "escolha a área manualmente" | O endereço não está em nenhuma área por bairro e o mapa não o encontrou (ou o Nominatim está fora/sem internet). Escolha a área no pedido, ou inclua o bairro numa área em Áreas de entrega ("Bairros sem área") |
| Cardápio digital mostra dados antigos depois de mudar o cardápio | O cache é atualizado pela API com `MENU_REVALIDATE_SECRET` (igual nos dois apps; no `start:lite` o cardápio recebe o `.env`). Sem o segredo, a página se atualiza sozinha em até 5 minutos |
| `Could not run the pnpm binary ... pnpm-native.exe: spawnSync ... UNKNOWN`, ou "Uma política de Controle de Aplicativo bloqueou este arquivo" ao rodar `pnpm` (ou outro executável sem assinatura, como o agente de impressão) | Bloqueio do **Smart App Control** do Windows 11 (confira no PowerShell: `(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState` — `1` = ligado; o log "Microsoft-Windows-CodeIntegrity/Operational" registra os bloqueios). **Orientação do projeto: não desligue o Smart App Control** (depois de desligado, o Windows só permite religá-lo reinstalando o sistema) nem tente contornar o bloqueio. No Surface o projeto já vive no WSL ("O projeto inteiro dentro do WSL", abaixo); em outro computador com o mesmo bloqueio, siga o mesmo roteiro |
| Login responde 429 | Limite de tentativas de login por minuto e IP (`LOGIN_RATE_LIMIT_PER_MINUTE`: 10 em produção; 300 no `.env.example` de desenvolvimento). Espere 1 minuto ou reinicie a API; se o seu `.env` é antigo, acrescente a variável |

## O projeto inteiro dentro do WSL (Surface)

> **Em uso no Surface desde 2026-10-08.** O Smart App Control do Windows 11 bloqueia executáveis do Windows sem assinatura (como o `pnpm-native.exe`) e a orientação é não desligá-lo; os programas do Linux rodam dentro da máquina virtual do WSL e **não são bloqueados por ele** (confirmado: pnpm, Prisma, esbuild, Next e o Chromium do Playwright rodam normalmente). Medido no Surface: `pnpm check` em ~3,5 min, e2e em ~1 min 45 s, seed em ~20 s. A pasta `C:\GastroHub_v2` ficou como cópia antiga, sem uso (não apagar).
>
> Dicas de quem montou: o `wsl.exe -- comando` passa o comando por um shell intermediário, que expande `$variáveis` antes da hora (prefira scripts `.sh`); no Git Bash do Windows, use `MSYS_NO_PATHCONV=1` para o caminho `/mnt/c/...` não ser convertido; comandos que usam Node precisam do `nvm` carregado (num shell interativo ele já vem do `~/.bashrc`).

1. **Memória (antes de tudo).** O Surface tem 8 GB, e o WSL e o Docker Desktop dividem a mesma máquina virtual. Crie `%UserProfile%\.wslconfig`:

   ```ini
   [wsl2]
   # Deixa ~3 GB para o Windows (VS Code, navegador); o WSL usa o arquivo de troca quando precisar.
   memory=5GB
   swap=8GB
   processors=4

   [experimental]
   # Devolve ao Windows a memória que o Linux deixou de usar.
   autoMemoryReclaim=gradual
   ```

   Depois: `wsl --shutdown` (aplica a configuração). Mantenha no `.env` `CHECK_CONCURRENCY=1` e `NEXT_BUILD_CPUS=1`.
2. **Ubuntu:** `wsl --install -d Ubuntu-24.04` (PowerShell como administrador), crie o usuário e rode `sudo apt update && sudo apt install -y build-essential git curl unzip`.
3. **Docker Desktop:** Settings › Resources › WSL integration › ativar o Ubuntu. Dentro do Ubuntu, `docker ps` deve funcionar. Os containers continuam os mesmos do Docker Desktop (o projeto `C:\GastroHub`, que usa a 5432, segue convivendo: mantenha `POSTGRES_PORT=5433` no `.env`).
4. **Node e pnpm no Linux:** Node 24 LTS com o `nvm` (sem `sudo`): `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`, reabra o terminal, `nvm install 24`, `nvm alias default 24`, `corepack enable pnpm`.
5. **Código no sistema de arquivos do Linux, nunca em `/mnt/c`:** `mkdir -p ~/projetos && cd ~/projetos && git clone https://github.com/longarayb/gastrohub_v2.git GastroHub_v2`. Em `/mnt/c` tudo fica muito lento (milhares de arquivos do `node_modules`) e os watchers não recebem as mudanças. Configure o Git no Linux com a mesma identidade dos commits e o login do Windows: `git config --global user.name longarayb`, `git config --global user.email longarayb@gmail.com`, `git config --global core.autocrlf false` e `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"` (reaproveita o Git Credential Manager do Windows: nada de token novo; se não funcionar, `gh auth login`).
6. **`.env`:** copie o do Windows (`cp /mnt/c/GastroHub_v2/.env ~/projetos/GastroHub_v2/.env`) e confira as portas. Depois, o fluxo de sempre: `pnpm install`, `pnpm infra:up`, `pnpm --filter @app/api db:deploy`, `pnpm db:seed` (compila o `@app/shared` sozinho), `pnpm start:lite`. O navegador do Windows acessa `http://localhost:3000` normalmente (o WSL encaminha as portas).
7. **Claude Code no WSL:** instale dentro do Ubuntu (`curl -fsSL https://claude.ai/install.sh | bash`) e rode `claude` na pasta do projeto. No VS Code, use a extensão **WSL** e abra a pasta com `code .` a partir do Ubuntu (o editor roda no Windows, os comandos no Linux).
8. **Roteiros visuais no Linux:** usam o Chromium do Playwright (`tools/ui-walkthrough/browser.mjs`; no Windows continua o Edge). Uma vez: `cd tools/ui-walkthrough && npm install && npx playwright-core install chromium` e, com a sua senha, `sudo apt-get install -y libnss3 libnspr4 libasound2t64`. **Continua no Windows:** o agente de impressão (serviço do Windows; instalador e teste de reinicialização no desktop de casa).
9. **Uma pasta por vez:** com o projeto no WSL, não use mais `C:\GastroHub_v2` neste computador (evita duas cópias divergentes). O GitHub continua sendo a ponte com o desktop de casa.
10. **Claude Code dentro do WSL:** `curl -fsSL https://claude.ai/install.sh | bash` no Ubuntu; para abrir: `wsl -d Ubuntu-24.04`, `cd ~/projetos/GastroHub_v2`, `claude`. No VS Code: extensão **WSL** e `code .` a partir do Ubuntu (ou "WSL: Conectar à distribuição" › Ubuntu-24.04 › abrir a pasta), com a extensão do Claude Code instalada no lado do WSL.


### Relógio do WSL saltando (achado em 2026-10-16)

Dentro do WSL há dois acertadores de hora: o `systemd-timesyncd` do Ubuntu (hora da internet) e o TimeSync do Hyper-V (hora do Windows). Se o relógio do Windows estiver alguns segundos fora, os dois brigam e a hora do WSL **volta alguns segundos a cada ~30 s** (o diário mostra "Time jumped backwards": `journalctl --since today | grep -i "jumped"`). Isso faz testes falharem às vezes (um trabalho de impressão recém-liberado fica "no futuro" e não é entregue na hora) e atinge o servidor temporário, que roda no mesmo WSL. Para corrigir, uma vez:

1. No WSL, deixe só o Hyper-V acertar a hora: `sudo systemctl disable --now systemd-timesyncd`.
2. No Windows (PowerShell como administrador), acerte a hora do Windows pela internet: `w32tm /resync` (se responder que o serviço não está rodando: `net start w32time` e repita).
3. Confira: `journalctl --since "5 min ago" | grep -i jumped` não mostra nada novo depois de alguns minutos.

## Servidor temporário no Surface (rede de casa)

Até a publicação na Contabo, o Surface serve o sistema para a rede de casa. Dois cenários: **programar no Surface com o servidor parado**, ou **programar no desktop com o servidor rodando no Surface**. Os dois nunca rodam juntos no Surface (8 GB; mesmas portas 3000–3002 e 3333): o `pnpm servidor:subir` avisa e para se o desenvolvimento estiver rodando, e o `pnpm dev`/`start:lite` recusam começar com o servidor no ar.

**Como é montado** (`scripts/servidor.mjs`, dentro do WSL):

- **Pasta própria:** `~/servidor/GastroHub_v2`, um clone só da `main`, separado de `~/projetos/GastroHub_v2` (onde se programa). Trocar de branch na pasta de desenvolvimento nunca muda o que o servidor roda. Segredos em `~/servidor/.env` (gerados uma vez pelo `deploy/gen-secrets.sh`), imagens enviadas em `~/servidor/dados`, backups antes de cada atualização em `~/servidor/backups` (os 5 últimos).
- **Igual à produção:** imagens de produção montadas localmente (`local/app-*:<commit>`), `deploy/compose.prod.yml` com `deploy/home/compose.home.yml`, migrations antes dos apps com o dono das tabelas, a API com o usuário só de dados, e cada app chamando a API pelo próprio endereço (Caddy em http nas portas 3000, 3001, 3002 e 3333).
- **Banco, Redis e e-mail próprios:** projeto `servidor` do Docker, com Postgres, Redis e Mailpit em containers e volumes próprios. A porta do banco do servidor nem é publicada: o seed e o e2e do desenvolvimento (projeto `app`, porta 5433) não alcançam o servidor. A Demo vem do `demo-reset`, em modo demonstração. `LAN_SERVER=true` (só neste servidor): cookies sem `Secure` (a rede de casa é http) e e-mail para o Mailpit do servidor (`http://localhost:8026`, só no Surface); os segredos de desenvolvimento continuam recusados.

**Comandos** (no Ubuntu do Surface, de qualquer uma das duas pastas):

| Comando | O que faz |
|---|---|
| `pnpm servidor:subir` | Sobe e mostra os endereços com o IP. Na primeira vez: clona a `main`, gera os segredos, monta as imagens (~8 min), cria o banco, aplica as migrations e cria a Demo. |
| `pnpm servidor:parar` | Para tudo (banco, Redis e imagens enviadas ficam guardados). |
| `pnpm servidor:atualizar` | Pull da `main`, build de produção, backup do banco, migrations e reinício; mostra a versão que ficou no ar. Se a versão nova não responder, volta para a anterior. |
| `pnpm servidor:status` | Versão no ar, serviços, se cada endereço responde e a memória. |
| `pnpm servidor:logs [api]` | Acompanha os logs (todos ou de um serviço: `api`, `web`, `menu`, `admin`, `caddy`, `postgres`). |
| `pnpm servidor:demo` | Restaura a Demo quando quiser. |
| `pnpm servidor:admin create --email <e-mail> --name "<nome>"` | Cria um administrador do painel da plataforma (o servidor não tem o admin de demonstração do seed): mostra uma senha temporária de 24 h; no primeiro acesso, cadastre o 2FA e troque a senha. Também `reset-password` e `reset-2fa` (com `--reason`). |
| `pnpm servidor:tunel [painel\|cardapio]` | Endereço https temporário (veja abaixo). |

**Acesso pela rede de casa (uma vez):**

1. **Rede espelhada do WSL e firewall:** o mesmo passo de "Testar no celular" (com o projeto no WSL): `networkingMode=mirrored` no `.wslconfig` e as portas 3000, 3001, 3002 e 3333 liberadas no firewall do Windows e no do WSL. As regras valem **só para redes privadas**; restrinja a do WSL (PowerShell como administrador):

   ```powershell
   Set-NetFirewallHyperVRule -Name "AppDevLan" -Profiles Private
   ```

   O Wi-Fi de casa precisa estar como **Rede privada** (Configurações › Rede e Internet › Wi-Fi › sua rede).
2. **IP fixo para o Surface no roteador:** no Windows, `ipconfig /all` mostra o "Endereço Físico" (MAC) do Wi-Fi. No painel do roteador (em geral `http://192.168.0.1` ou `http://192.168.1.1`, usuário e senha na etiqueta), procure **DHCP › Reserva de endereço** (ou "IP estático", "Address Reservation") e reserve um IP para esse MAC (ex.: `192.168.0.92`). Desligue e ligue o Wi-Fi do Surface para ele pegar o IP reservado. Sem isso o IP pode mudar e os endereços mudam junto (o `servidor:subir` avisa).
3. **Não suspender na tomada:**
   - Configurações › Sistema › Energia › "Tela e suspensão": **Quando conectado: Nunca** (suspensão) e "Fechar a tampa" sem efeito na tomada (Painel de Controle › Opções de Energia › "Escolher a função de fechamento da tampa": **Não fazer nada** em "Conectado").
   - Ou no PowerShell como administrador: `powercfg /change standby-timeout-ac 0`, `powercfg /change hibernate-timeout-ac 0` e `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0; powercfg /setactive SCHEME_CURRENT`.
   - Docker Desktop: Settings › General › **Start Docker Desktop when you sign in**. Depois de um reinício do Windows é preciso entrar no Windows (o Docker Desktop roda na sessão do usuário); os containers do servidor voltam sozinhos (`restart: unless-stopped`).
   - Windows Update: em "Horário ativo", deixe o horário em que o servidor é usado, para ele não reiniciar nesse intervalo.

**Do desktop:** abra no navegador `http://<IP do Surface>:3000` (painel), `:3001/demo` (cardápio) e `:3002` (admin). O agente de impressão do desktop pode apontar para o servidor: `pnpm --filter @app/print-agent package -- --api http://<IP do Surface>:3333/api`.

**HTTPS para o celular (GPS do entregador):** o navegador só libera a localização em https. `pnpm servidor:tunel` abre um túnel temporário da Cloudflare até o painel do servidor (`pnpm servidor:tunel cardapio` para o cardápio) e mostra o endereço `https://…trycloudflare.com`; o entregador abre `<endereço>/entregas`. **Atenção:** enquanto o túnel está aberto, o sistema do servidor de casa fica acessível pela internet (com as senhas conhecidas da Demo); ele fecha sozinho em 30 minutos (`--minutos N`), e nunca deve ser usado com dados reais. Precisa do `cloudflared` (`winget install --id Cloudflare.cloudflared` no Windows; o script usa o do Windows a partir do WSL).

**Testar o entregador no celular (D049):** com o túnel aberto, entre no celular em `<endereço>/entregas` com `entregador@demo.local` / `Demo1234` (o Gustavo tem uma saída aberta na Demo). Toque em "Compartilhar localização", leia e aceite; abra o despacho no computador (`http://<IP do Surface>:3000/despacho`, caixa) e veja o Gustavo andar com você. Para os avisos: no Android, "Ativar avisos" direto no Chrome; no iPhone (iOS 16.4 ou mais novo), Compartilhar › Adicionar à Tela de Início, abrir pelo ícone, entrar e "Ativar avisos". Depois despache um pedido para o Gustavo no computador: chega "N entregas na sua rota". O endereço do túnel muda a cada vez, então no iPhone o ícone da Tela de Início vale só para aquele túnel. Com a tela apagada ou outro app na frente, o celular para de enviar a posição (o despacho mostra "sem sinal há N min"): isso só muda com o app Android da fase 3.

## App do entregador (Android, D050)

App nativo em `apps/courier` (Expo SDK 58), distribuído por APK, sem Play Store. O `/entregas` no navegador continua como alternativa. Roteiro de teste: [TESTE_APP_ENTREGADOR.md](TESTE_APP_ENTREGADOR.md).

### Preparar a máquina (uma vez, Linux ou WSL, sem `sudo`)

```bash
bash scripts/android-sdk.sh            # JDK 17 em ~/.local/jdk-17 e Android SDK em ~/Android/Sdk (aceita as licenças do SDK)
pnpm --filter @app/courier keystore    # chave de assinatura em ~/.config/app-courier (só uma vez na vida do app)
```

**Chave de assinatura:** o `keystore` cria `~/.config/app-courier/release.jks` e `signing.env` (senha e alias, permissão 600) e mostra a impressão digital SHA-256. **Guarde uma cópia dos dois no gerenciador de senhas** (veja abaixo). Para montar o APK em outra máquina, copie os dois para o mesmo lugar. **Se a chave for perdida**, nenhum celular aceita mais atualizações do app: seria preciso uma chave nova e cada entregador desinstalaria e instalaria de novo (perdendo a fila sem sinal); na Play Store, perder a chave impede atualizar o mesmo app. Nunca no repositório (o `.gitignore` e o script de commit recusam `.jks` e `signing.env`).

#### Cópia da chave em texto (gerenciador de senhas sem anexos, como o Bitwarden gratuito)

O texto em base64 da chave tem ~5.800 caracteres e cabe numa nota segura do Bitwarden (limite de 10.000). Gere-o **só** dentro da pasta `~/.config/app-courier`, nunca no repositório nem em outra pasta:

```bash
umask 077
base64 -w0 ~/.config/app-courier/release.jks > ~/.config/app-courier/release.jks.base64.txt
sha256sum ~/.config/app-courier/release.jks   # anote na nota, para conferir a cópia
```

Na nota segura, cole o conteúdo de `release.jks.base64.txt`, o de `signing.env` e o SHA-256 do arquivo. Conferida a nota, o `.txt` pode ser apagado (o `release.jks` continua).

**Reconstruir a chave a partir da nota** (Linux ou WSL). O texto entra pela entrada do comando, não pela linha de comando, para não ficar no histórico do shell:

```bash
mkdir -p ~/.config/app-courier && chmod 700 ~/.config/app-courier
umask 077
base64 -d > ~/.config/app-courier/release.jks
# cole o texto da nota, Enter, depois Ctrl+D
sha256sum ~/.config/app-courier/release.jks   # tem de ser igual ao anotado na nota
```

O `signing.env` volta do mesmo jeito: crie `~/.config/app-courier/signing.env` com o texto da nota e rode `chmod 600` nele. No Windows (PowerShell), com o texto da chave copiado da nota: `[IO.File]::WriteAllBytes("$PWD\release.jks", [Convert]::FromBase64String((Get-Clipboard -Raw).Trim()))`, e confira com `Get-FileHash release.jks`.

### Firebase (avisos de "rota nova") — o que você cria

Gratuito, **sem cartão** (plano Spark; o FCM não tem custo).

1. Em [console.firebase.google.com](https://console.firebase.google.com), **Criar projeto** (ex.: "app-entregas"); o Google Analytics pode ficar desligado.
2. Na página do projeto, **Adicionar app › Android**: nome do pacote **`app.foodservice.entregas`** (exatamente), apelido à vontade, **Registrar app**, **Baixar google-services.json**. Os passos seguintes do assistente (SDK) podem ser pulados.
3. **Configurações do projeto › Contas de serviço › Gerar nova chave privada**: baixa um JSON. **Este é secreto** (permite enviar avisos em nome do projeto).
4. Salve os dois no Surface, em `\wsl.localhost\Ubuntu-24.04\home\braian\.config\app-courier\`:
   - `google-services.json` (entra no APK: monte o APK de novo);
   - `firebase-service-account.json` (o `pnpm servidor:subir`/`atualizar` coloca no `.env` do servidor como `FCM_SERVICE_ACCOUNT`, em base64).
5. Guarde a cópia da conta de serviço no gerenciador de senhas. Na Contabo, o mesmo valor vai no `FCM_SERVICE_ACCOUNT` do `.env`.

Sem o Firebase o app funciona igual, só não avisa de rota nova (a tela se atualiza sozinha a cada 30 s com o app aberto).

### Montar e publicar o APK

```bash
pnpm servidor:parar                    # o build precisa da memória (8 GB)
pnpm --filter @app/courier apk         # APK assinado em apps/courier/dist (20–40 min na primeira vez)
pnpm servidor:subir && pnpm servidor:apk
```

- Cada APK novo precisa de `versionCode` maior em `apps/courier/release.json` (e `versionName`/`notes` para a tela de versão nova).
- Só ARM64 (celulares Android dos últimos anos); `android/` é gerado pelo `expo prebuild` e nunca vai para o git.
- O app aceita `http` (o servidor de casa); fora da rede de casa use `https`.
