import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  getInventoryConsolidationData,
  mapConsolidacion,
  type LineaComprometidaRow,
} from './inventoryConsolidation.js';

// El Consolidador de Inventario genera el mismo xlsx que con las 3 exportaciones de
// Zoho (Resumen de inventario + Comprometido FACT + Comprometido ENV), pero desde la
// réplica. El SQL solo reporta números y estados; quién cuenta como "por facturar" o
// "por enviar" lo decide mapConsolidacion() — aquí se prueba esa regla.

const linea = (over: Partial<LineaComprometidaRow>): LineaComprometidaRow => ({
  sku: '3200043641',
  item_name: 'Filtro X',
  transaction: 'OV-2026-018',
  status: 'open',
  order_status: 'open',
  shipped_status: 'pending',
  por_facturar: '0',
  por_enviar: '0',
  ...over,
});

describe('mapConsolidacion', () => {
  it('inventario: numérico y con las claves que lee el Consolidador', () => {
    const r = mapConsolidacion([{ sku: 'A', item_name: 'Art A', quantity_available: '12.5' }], []);
    expect(r.inventory).toEqual([{ sku: 'A', item_name: 'Art A', quantity_available: 12.5 }]);
  });

  it('inventario: stock vacío/nulo cuenta como 0', () => {
    const r = mapConsolidacion([{ sku: 'A', item_name: 'Art A', quantity_available: null }], []);
    expect(r.inventory[0].quantity_available).toBe(0);
  });

  it('ejemplo real: 3200043641 → OV-2026-018 fact 8 / env 6, OV-2026-050 solo env 1', () => {
    const r = mapConsolidacion([], [
      linea({ transaction: 'OV-2026-018', por_facturar: '8', por_enviar: '6' }),
      linea({ transaction: 'OV-2026-050', status: 'invoiced', por_facturar: '0', por_enviar: '1' }),
    ]);
    expect(r.fact).toEqual([{ sku: '3200043641', item_name: 'Filtro X', quantity: 8, transaction: 'OV-2026-018' }]);
    expect(r.env).toEqual([
      { sku: '3200043641', item_name: 'Filtro X', quantity: 6, transaction: 'OV-2026-018' },
      { sku: '3200043641', item_name: 'Filtro X', quantity: 1, transaction: 'OV-2026-050' },
    ]);
  });

  // Caso real (comparación con Zoho, 30/09/26): OVI-2026-005 está invoiced + closed +
  // fulfilled, pero su factura AMI-2026-005 sigue en 'approved' y Zoho aún la cuenta
  // como comprometida contable. Manda lo que reporta la línea, no el estado de la orden.
  it('una OV cerrada/facturada/despachada sigue aportando lo que reporten sus líneas', () => {
    const r = mapConsolidacion([], [linea({
      transaction: 'OVI-2026-005', status: 'invoiced', order_status: 'closed',
      shipped_status: 'fulfilled', por_facturar: '1', por_enviar: '0',
    })]);
    expect(r.fact).toEqual([{ sku: '3200043641', item_name: 'Filtro X', quantity: 1, transaction: 'OVI-2026-005' }]);
    expect(r.env).toEqual([]);
  });

  it('cantidades 0 o vacías no generan fila', () => {
    const r = mapConsolidacion([], [linea({ por_facturar: '0', por_enviar: null })]);
    expect(r.fact).toEqual([]);
    expect(r.env).toEqual([]);
  });
});

describe('getInventoryConsolidationData', () => {
  it('lanza 2 consultas (inventario + líneas) y devuelve inventory/fact/env/generatedAt', async () => {
    const query = vi.fn(async (sql: string) =>
      /salesorder_line_items/.test(sql)
        ? { rows: [linea({ por_facturar: '2', por_enviar: '1' })] }
        : { rows: [{ sku: '3200043641', item_name: 'Filtro X', quantity_available: '10' }] });
    const d = await getInventoryConsolidationData({ query } as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(2);
    expect(d.inventory).toHaveLength(1);
    expect(d.fact[0].quantity).toBe(2);
    expect(d.env[0].quantity).toBe(1);
    expect(typeof d.generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(d.generatedAt))).toBe(false);
  });

  it('SQL: incluye artículos inactivos (el Resumen de inventario de Zoho los lista)', async () => {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [] }; });
    await getInventoryConsolidationData({ query } as unknown as Pool);
    const inv = sqls.find((s) => !/salesorder_line_items/.test(s))!;
    expect(inv).not.toMatch(/inactive/);
  });

  it('SQL: lo facturado en facturas "approved" sigue pendiente de facturar (Zoho no descuenta hasta enviarla)', async () => {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [] }; });
    await getInventoryConsolidationData({ query } as unknown as Pool);
    const lin = sqls.find((s) => /salesorder_line_items/.test(s))!;
    expect(lin).toMatch(/books\.invoice_line_items/);
    expect(lin).toMatch(/i\.status = 'approved'/);
  });

  it('SQL: solo artículos con seguimiento de inventario, OV confirmadas y saldos por línea con GREATEST', async () => {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [] }; });
    await getInventoryConsolidationData({ query } as unknown as Pool);
    const [inv, lin] = [sqls.find((s) => !/salesorder_line_items/.test(s))!, sqls.find((s) => /salesorder_line_items/.test(s))!];
    expect(inv).toMatch(/stock_on_hand/);
    expect(inv).toMatch(/track_inventory/);
    expect(lin).toMatch(/track_inventory/);
    expect(lin).toMatch(/so\.status NOT IN \('void', 'draft', 'pending_approval'\)/);
    expect(lin).toMatch(/quantity_invoiced/);
    expect(lin).toMatch(/quantity_delivered/);
    expect(lin).toMatch(/quantity_cancelled/);
    expect(lin).toMatch(/GREATEST\(/);
    expect(lin).toMatch(/GROUP BY/);
  });
});
