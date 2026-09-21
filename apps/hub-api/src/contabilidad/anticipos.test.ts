import { describe, it, expect } from 'vitest';
import { extraerOV } from './anticipos.js';

describe('extraerOV', () => {
  // Esta tabla ES la especificación de cómo se escribe un anticipo en Zoho. Una forma nueva
  // que aparezca en los datos reales se añade aquí primero.
  it.each([
    ['Anticipo OV-2026-167', ['OV-2026-167']],
    ['anticipo ov-2026-167', ['OV-2026-167']],
    ['Anticipo OV 2026-167', ['OV-2026-167']],
    ['Anticipo OV2026-167', ['OV-2026-167']],
    ['Anticipo OV-2026-0167', ['OV-2026-167']],
    ['Anticipo OV–2026–167', ['OV-2026-167']],
    ['Anticipo OV-2026-5', ['OV-2026-005']],
    ['Anticipo OV-2026-1000', ['OV-2026-1000']],
    ['Anticipo OV-2026-150 y OV-2026-151', ['OV-2026-150', 'OV-2026-151']],
    ['Anticipo OV-2026-167 | OV-2026-167', ['OV-2026-167']],
    ['Anticipo 50% del pedido', []],
    ['MOV-2026-167', []],
    ['Anticipo OV-26-167', []],
    ['', []],
  ])('%s → %j', (texto, esperado) => {
    expect(extraerOV(texto)).toEqual(esperado);
  });
});
