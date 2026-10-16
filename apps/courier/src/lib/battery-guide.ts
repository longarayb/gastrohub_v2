/**
 * Battery saving guides (D050): Android itself asks once to leave the app out of battery
 * optimization, but some brands add their own killers on top. Steps per brand, in the words of
 * each phone's settings. Pure data (tested); the screen opens the settings pages.
 */

export type BatteryBrand = 'samsung' | 'xiaomi' | 'motorola' | 'other';

export interface BatteryGuide {
  brand: BatteryBrand;
  title: string;
  steps: string[];
}

export function brandOf(manufacturer: string | null | undefined): BatteryBrand {
  const m = (manufacturer ?? '').toLowerCase();
  if (m.includes('samsung')) return 'samsung';
  if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) return 'xiaomi';
  if (m.includes('motorola') || m.includes('lenovo')) return 'motorola';
  return 'other';
}

export function batteryGuide(
  manufacturer: string | null | undefined,
  appName: string,
): BatteryGuide {
  const brand = brandOf(manufacturer);
  switch (brand) {
    case 'samsung':
      return {
        brand,
        title: 'Samsung',
        steps: [
          `Configurações › Aplicativos › ${appName} › Bateria › marque "Sem restrições".`,
          'Configurações › Cuidados com o dispositivo › Bateria › Limites de uso em segundo plano: tire o app de "Apps em suspensão" e de "Apps em suspensão profunda".',
          `No mesmo lugar, em "Apps nunca suspensos", toque em + e adicione o ${appName}.`,
        ],
      };
    case 'xiaomi':
      return {
        brand,
        title: 'Xiaomi, Redmi e POCO',
        steps: [
          `Configurações › Apps › Gerenciar apps › ${appName} › Economia de bateria › marque "Sem restrições".`,
          'Na mesma tela do app, ligue "Início automático".',
          'Abra os apps recentes, segure o cartão do app e toque no cadeado para travá-lo (o sistema não o fecha ao limpar a memória).',
        ],
      };
    case 'motorola':
      return {
        brand,
        title: 'Motorola',
        steps: [
          `Configurações › Apps › ${appName} › Bateria › marque "Sem restrições".`,
          'Se existir "Otimização de bateria" no menu do app, escolha "Não otimizar".',
        ],
      };
    default:
      return {
        brand,
        title: 'Outros celulares',
        steps: [
          `Configurações › Apps › ${appName} › Bateria › marque "Sem restrições" (ou "Não otimizar").`,
          'Se o celular tiver um gerenciador de bateria próprio, deixe o app fora dele. O site dontkillmyapp.com tem o passo a passo de cada marca.',
        ],
      };
  }
}
