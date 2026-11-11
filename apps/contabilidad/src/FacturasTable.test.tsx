import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FacturasTable, { ORDEN_POR_DEFECTO } from './FacturasTable';
import type { FacturaContable } from './api';

const HOY = '2026-11-11';

const factura = (invoiceNumber: string, fechaVencimiento: string, porCobrar: number): FacturaContable => ({
  invoiceNumber, razonSocial: 'ACME', qt: '', fechaFactura: '2026-03-01', fechaVencimiento,
  ov: 'OV-1', trato: '', ticket: '', total: 100, iva: 19, totalConIva: 119, cobradoPct: 0,
  cobrado: 0, porCobrar, retenciones: 0, participacion: 1, cartera: 'nota antigua', unidadesPorDespachar: 0,
});

function pintar(facturas: FacturaContable[]) {
  render(
    <FacturasTable
      facturas={facturas}
      hoy={HOY}
      orden={ORDEN_POR_DEFECTO}
      esVisible={() => true}
      anchoDe={() => undefined}
      onRedimensionar={vi.fn()}
      onRestablecerAncho={vi.fn()}
    />,
  );
}

/** Celda de la columna CARTERA de la fila de esa factura. */
function celdaCartera(invoiceNumber: string): HTMLElement {
  const cabeceras = screen.getAllByRole('columnheader');
  const idx = cabeceras.findIndex((h) => /CARTERA/.test(h.textContent ?? ''));
  const fila = screen.getAllByRole('row').find((r) => within(r).queryByText(invoiceNumber));
  return within(fila!).getAllByRole('cell')[idx];
}

describe('columna CARTERA: días en cartera', () => {
  it('factura vencida con saldo: días desde el vencimiento', () => {
    pintar([factura('FV-1', '2026-09-27', 500)]);
    const celda = celdaCartera('FV-1');
    expect(celda).toHaveTextContent('45');
    expect(celda).toHaveAttribute('title', 'Vencida hace 45 días');
  });

  it('factura con saldo aún por vencer: días negativos', () => {
    pintar([factura('FV-2', '2026-11-21', 500)]);
    const celda = celdaCartera('FV-2');
    expect(celda).toHaveTextContent('-10');
    expect(celda).toHaveAttribute('title', 'Vence en 10 días');
  });

  it('factura que vence hoy', () => {
    pintar([factura('FV-3', HOY, 500)]);
    expect(celdaCartera('FV-3')).toHaveAttribute('title', 'Vence hoy');
  });

  it('factura pagada: sin días y sin la nota manual antigua', () => {
    pintar([factura('FV-4', '2026-01-01', 0)]);
    const celda = celdaCartera('FV-4');
    expect(celda).toHaveTextContent('—');
    expect(celda).not.toHaveTextContent('nota antigua');
  });

  it('ya no es editable', () => {
    pintar([factura('FV-5', '2026-09-27', 500)]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('ordena por días: descendente pone primero la más vencida y las pagadas al final', () => {
    pintar([
      factura('FV-PAGADA', '2026-01-01', 0),
      factura('FV-10', '2026-11-01', 500),
      factura('FV-45', '2026-09-27', 500),
      factura('FV-MENOS5', '2026-11-16', 500),
    ]);
    const boton = screen.getByRole('button', { name: /CARTERA/ });
    fireEvent.click(boton); // ascendente
    fireEvent.click(boton); // descendente
    const facturas = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getByText(/^FV-/).textContent);
    expect(facturas).toEqual(['FV-45', 'FV-10', 'FV-MENOS5', 'FV-PAGADA']);
  });
});
