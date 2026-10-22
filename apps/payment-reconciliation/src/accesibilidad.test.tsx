import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { InvoiceDetails, ReconciledRow } from './types';
import App from './App';
import CustomerAnalysis from './CustomerAnalysis';
import GeneralAnalysis from './GeneralAnalysis';
import SalesOrdersPending from './SalesOrdersPending';
import OpenInvoicesWidget from './widgets/OpenInvoicesWidget';

// FE-419 — el Conciliador se tiene que poder usar con teclado y lector de pantalla:
// controles con nombre, paneles que dicen si están abiertos, cabeceras ordenables que
// son botones y declaran su orden, filas que abren el detalle con Enter, y diálogos de
// verdad (nombre, foco dentro, Escape cierra y el foco vuelve a quien los abrió).

// SalesOrdersPending lee la URL del hub al cargar el módulo: hay que fijarla antes de
// los imports, de ahí el hoisted.
vi.hoisted(() => {
  vi.stubEnv('VITE_HUB_API_URL', 'http://hub.test');
});

// Recharts necesita layout real; los gráficos no son lo que se prueba aquí.
vi.mock('./YearlyTrendCharts', () => ({ default: () => null }));
vi.mock('./OverdueByClientChart', () => ({ default: () => null }));

// El detalle se queda «cargando»: lo que se prueba es el diálogo, no su contenido.
vi.mock('./detalleApi', () => ({
  fetchFacturaDetalle: () => new Promise(() => {}),
  fetchOVDetalle: () => new Promise(() => {}),
}));

vi.mock('./widgets/useReconciliationData', () => ({
  useReconciliationData: () => ({ invoices: [FACTURA], payments: [], loading: false, error: null, reload: () => {} }),
}));

const FACTURA: InvoiceDetails = {
  invoiceNumber: 'AM100', orderNumber: '', clientName: 'ACME',
  invoiceDate: '2026-09-01', dueDate: '2026-09-15', status: 'sent',
  total: 1000, balance: 1000,
};

const FILA: ReconciledRow = {
  ...FACTURA,
  invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid', balance: 0,
  paymentDates: [], paymentAmounts: [], totalPaid: 1000,
  isOverdue: false, maxDelayDays: 0, paymentDetails: [{ date: '01/01/2025', delay: 0 }],
};

const OV = {
  salesorder_number: 'OV-2026-167', date: '2026-09-01', customer_name: 'SGS', status: 'open',
  currency_code: 'COP', total: 1000, pending: 1000, shipment_date: null,
};

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/api/reconciliation/data')) return json({ invoices: [FACTURA], payments: [] });
    if (url.endsWith('/api/sales-orders/pending')) return json({ orders: [OV] });
    return new Promise(() => {});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Enfoca el elemento y pulsa la tecla, como haría quien navega con Tab. */
function pulsar(el: HTMLElement, key: string) {
  el.focus();
  fireEvent.keyDown(el, { key });
}

describe('Conciliación (FE-419)', () => {
  it('los paneles dicen si están abiertos y el estado de pago es un grupo con nombre', async () => {
    render(<App />);
    await screen.findByRole('row', { name: /AM100/ });
    const filtros = screen.getByRole('button', { name: /Filtros Avanzados/ });
    expect(filtros).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(filtros);
    expect(filtros).toHaveAttribute('aria-expanded', 'true');
    const estado = screen.getByRole('group', { name: 'Estado de Pago' });
    expect(within(estado).getAllByRole('checkbox')).toHaveLength(3);
    const columnas = screen.getByRole('button', { name: 'Columnas' });
    expect(columnas).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(columnas);
    expect(columnas).toHaveAttribute('aria-expanded', 'true');
  });

  it('las cabeceras ordenables son botones y la activa declara su sentido', async () => {
    render(<App />);
    await screen.findByRole('row', { name: /AM100/ });
    expect(screen.getByRole('columnheader', { name: /Fecha Factura/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: 'Total' }));
    expect(screen.getByRole('columnheader', { name: /Total/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Fecha Factura/ })).not.toHaveAttribute('aria-sort');
  });

  it('Enter en una fila abre el detalle como diálogo; Escape lo cierra y el foco vuelve a la fila', async () => {
    render(<App />);
    const fila = await screen.findByRole('row', { name: 'Abrir el detalle de la factura AM100' });
    pulsar(fila, 'Enter');
    const dialogo = screen.getByRole('dialog', { name: 'Factura AM100' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(fila);
  });
});

describe('Análisis por cliente (FE-419)', () => {
  it('los botones de información tienen nombre propio y abren un diálogo de verdad', () => {
    render(<CustomerAnalysis reconciledData={[FILA]} selectedCustomer="ACME" />);
    const info = screen.getByRole('button', { name: 'Ver cómo se calcula: DPD Promedio' });
    // Un <button> nativo convierte Enter en clic; jsdom no, así que se simula el clic.
    info.focus();
    fireEvent.click(info);
    const dialogo = screen.getByRole('dialog', { name: 'DPD Promedio (Days Past Due)' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(within(dialogo).getAllByRole('button', { name: 'Cerrar' })[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(info);
  });

  it('el total de facturas abre su listado con el teclado', () => {
    render(<CustomerAnalysis reconciledData={[FILA]} selectedCustomer="ACME" />);
    pulsar(screen.getByRole('button', { name: /Total Facturas/ }), 'Enter');
    const dialogo = screen.getByRole('dialog', { name: 'Detalle de Facturas' });
    fireEvent.click(within(dialogo).getAllByRole('button', { name: 'Cerrar' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('las fechas del período personalizado tienen nombre', () => {
    render(<CustomerAnalysis reconciledData={[FILA]} selectedCustomer="ACME" dateRange="custom" />);
    expect(screen.getByLabelText('Fecha de inicio')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de fin')).toBeInTheDocument();
  });
});

describe('Análisis general (FE-419)', () => {
  it('fechas, paneles, rangos y cabeceras ordenables accesibles', () => {
    render(<GeneralAnalysis reconciledData={[FILA]} dateRange="custom" />);
    expect(screen.getByLabelText('Fecha de inicio')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de fin')).toBeInTheDocument();

    expect(screen.getByRole('columnheader', { name: /Nombre de Cliente/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'DPD Promedio' }));
    expect(screen.getByRole('columnheader', { name: /DPD Promedio/ })).toHaveAttribute('aria-sort', 'ascending');

    const columnas = screen.getByRole('button', { name: 'Columnas' });
    expect(columnas).toHaveAttribute('aria-expanded', 'false');

    const filtros = screen.getByRole('button', { name: /Filtros Avanzados/ });
    expect(filtros).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(filtros);
    expect(filtros).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('group', { name: 'Estado de Pago' })).getAllByRole('checkbox')).toHaveLength(3);
    const dpd = within(screen.getByRole('group', { name: 'DPD Promedio (días)' }));
    expect(dpd.getByRole('spinbutton', { name: 'DPD promedio mínimo' })).toBeInTheDocument();
    expect(dpd.getByRole('spinbutton', { name: 'DPD promedio máximo' })).toBeInTheDocument();
    const aTiempo = within(screen.getByRole('group', { name: '% A Tiempo' }));
    expect(aTiempo.getByRole('spinbutton', { name: '% a tiempo mínimo' })).toBeInTheDocument();
    expect(aTiempo.getByRole('spinbutton', { name: '% a tiempo máximo' })).toBeInTheDocument();
  });
});

describe('OV por facturar (FE-419)', () => {
  it('filtros y botones con nombre, cabeceras botón y la fila abre el detalle con Enter', async () => {
    render(<SalesOrdersPending />);
    const fila = await screen.findByRole('row', { name: 'Abrir el detalle de la OV OV-2026-167' });
    expect(screen.getByRole('combobox', { name: 'Cliente' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Estado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Columnas' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('columnheader', { name: /Pendiente por Facturar/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: 'Cliente' }));
    expect(screen.getByRole('columnheader', { name: /Cliente/ })).toHaveAttribute('aria-sort', 'ascending');
    pulsar(fila, 'Enter');
    expect(screen.getByRole('dialog', { name: 'Orden de venta OV-2026-167' })).toBeInTheDocument();
  });
});

describe('Widget de facturas abiertas (FE-419)', () => {
  it('las cabeceras ordenables son botones y la activa declara su sentido', () => {
    render(<OpenInvoicesWidget />);
    expect(screen.getByRole('columnheader', { name: /Vencimiento/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Saldo' }));
    expect(screen.getByRole('columnheader', { name: /Saldo/ })).toHaveAttribute('aria-sort', 'ascending');
  });
});
