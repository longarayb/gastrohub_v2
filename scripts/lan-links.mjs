// `pnpm lan:links`: links to open the panel and the digital menu on a phone on the same Wi-Fi.
// The servers must have been started with `pnpm start:lite --menu --lan` or `pnpm dev --lan`.
import { lanAddress, lanLinks, log } from './lib.mjs';

const ip = lanAddress();
if (!ip) {
  log('Não encontrei um IP de rede local (Wi-Fi ou cabo). Confira se a máquina está conectada.');
  process.exit(1);
}
const links = lanLinks(ip);
log(`IP desta máquina na rede local: ${ip}`);
console.log(`
  Cardápio digital: ${links.menu}
  Painel:           ${links.panel}
  API:              ${links.api}/api/health

  No celular, use a mesma rede Wi-Fi. Os servidores precisam estar no ar com:
    pnpm start:lite --menu --lan   (ou, em desenvolvimento: pnpm dev --lan)
  O pnpm dev comum não serve: ele compila com "localhost" como endereço da API.
  Se não abrir, libere as portas no firewall do Windows (uma vez, PowerShell como administrador):
    New-NetFirewallRule -DisplayName "App dev (rede local)" -Direction Inbound -Protocol TCP -LocalPort 3000,3001,3333 -Action Allow -Profile Private
  e confira se a rede Wi-Fi está como "Privada" nas configurações do Windows.
`);
