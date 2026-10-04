# GastroHub V2

Sistema SaaS de gestão para restaurantes, bares, lanchonetes, pizzarias e deliveries no Brasil: cardápio, pedidos em tempo real, salão e mesas, PDV/caixa, KDS (cozinha), delivery e cardápio digital.

> Em desenvolvimento — Fase 1 (MVP). Veja [docs/ROADMAP.md](docs/ROADMAP.md).

## Pré-requisitos (Windows)

- [Node.js LTS](https://nodejs.org) (24.x)
- pnpm via corepack: `corepack enable pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) com backend WSL2
- [Git](https://git-scm.com)

## Estrutura

```
apps/api       API NestJS (REST + WebSocket)
apps/web       Painel administrativo, PDV, KDS (Next.js)
apps/menu      Cardápio digital público (Next.js)
packages/      shared (tipos, Zod, utils), ui, config
docs/          arquitetura, decisões, roadmap
```

Instruções completas de instalação, execução e credenciais de demonstração serão adicionadas ao concluir a fundação.
