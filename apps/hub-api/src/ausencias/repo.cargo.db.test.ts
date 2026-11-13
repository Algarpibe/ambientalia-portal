import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { fijarCargo } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// La puerta del cargo de la ficha. sembrarEmpleado siembra siempre con
// cargo 'Analista', y eso es lo que tiene que seguir ahi cuando la escritura
// NO debe cuajar.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const FANTASMA = '00000000-0000-4000-8000-000000000000';

let db: Pool;
let empleadoId: string;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
  empleadoId = await sembrarEmpleado(db, CORREO);
});

async function cargoEnBd(id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT cargo FROM portal.empleados WHERE id = $1`, [id]);
  return (rows[0] as { cargo: string | null }).cargo;
}

describe('repo.fijarCargo', () => {
  it('cambia el cargo de una ficha activa', async () => {
    expect(await fijarCargo(db, empleadoId, 'Jefa de taller')).toBe(true);
    expect(await cargoEnBd(empleadoId)).toBe('Jefa de taller');
  });

  it('con null lo borra', async () => {
    expect(await fijarCargo(db, empleadoId, null)).toBe(true);
    expect(await cargoEnBd(empleadoId)).toBeNull();
  });

  it('una ficha inactiva: false, y su cargo no se toca', async () => {
    // Mismo criterio AND activo que fijarJefe y fijarCopia: la escritura cubre
    // exactamente el conjunto que la lectura ensena.
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await fijarCargo(db, empleadoId, 'Jefa de taller')).toBe(false);
    expect(await cargoEnBd(empleadoId)).toBe('Analista');
  });

  it('un id que no existe: false', async () => {
    expect(await fijarCargo(db, FANTASMA, 'Jefa de taller')).toBe(false);
  });

  it('VARCHAR(255) cuenta caracteres: caben 255 emojis (510 unidades UTF-16)', async () => {
    // Es la razon de que normalizarCargo cuente con [...texto].length y no con
    // .length: si este test cayera, el tope del servicio estaria mal calibrado.
    const largo = '\u{1F600}'.repeat(255);
    expect(await fijarCargo(db, empleadoId, largo)).toBe(true);
    expect(await cargoEnBd(empleadoId)).toBe(largo);
  });
});
