import { describe, expect, it } from 'vitest';
import { batteryGuide, brandOf } from './battery-guide';

describe('battery saving guides', () => {
  it('recognizes the common brands by the manufacturer the phone reports', () => {
    expect(brandOf('samsung')).toBe('samsung');
    expect(brandOf('Xiaomi')).toBe('xiaomi');
    expect(brandOf('Redmi')).toBe('xiaomi');
    expect(brandOf('POCO')).toBe('xiaomi');
    expect(brandOf('motorola')).toBe('motorola');
    expect(brandOf('Google')).toBe('other');
    expect(brandOf(null)).toBe('other');
  });

  it('names the app in the steps', () => {
    const guide = batteryGuide('samsung', 'Entregas');
    expect(guide.title).toBe('Samsung');
    expect(guide.steps[0]).toContain('Aplicativos › Entregas › Bateria');
    expect(batteryGuide('xiaomi', 'Entregas').steps.join(' ')).toContain('Início automático');
  });
});
