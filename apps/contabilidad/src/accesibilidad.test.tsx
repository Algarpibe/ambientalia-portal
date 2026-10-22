import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from './App';
import OVPendientes from './OVPendientes';
import FacturasPorEntregar from './FacturasPorEntregar';
import * as api from './api';
import type { ContabilidadData, FacturaContable, OVPendienteFacturable } from './api';

// FE-419 — la app se tiene que poder usar con teclado y lector de pantalla: filtros con
// nombre, cabeceras ordenables que son botones y declaran su orden, filas que abren el
// detalle también con Enter, y un detalle que es un diálogo modal de verdad (nombre,
// foco dentro al abrir, Escape cierra y el foco vuelve a la fila). Se prueba por roles
// y nombres accesibles, que es lo que percibe quien no usa el ratón.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return {
    ...real,
    esAdmin: () => true,
    fetchContabilidad: vi.fn(),
    fetchOVPendientes: vi.fn(),
    fetchAnticiposAtencion: vi.fn(),
    fetchPagosPorSemana: vi.fn(),
    fetchFacturasPorEntregar: vi.fn(),
    fetchFacturaDetalle: vi.fn(),
    fetchOVDetalle: vi.fn(),
  };
});

vi.mock('@suite/auth-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@suite/auth-client')>();
  return { ...real, getUserId: () => 'test-user' };
});

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
// Una promesa que nunca resuelve deja esa parte «cargando»: no pinta tablas que se
// confundan con la que se prueba ni dispara actualizaciones fuera de act().
const pendiente = () => new Promise<never>(() => {});

const FACTURA: FacturaContable = {
  invoiceNumber: 'FV-1', razonSocial: 'ACME', qt: '', fechaFactura: '2026-03-01',
  fechaVencimiento: '2026-04-01', ov: 'OV-1', trato: '', ticket: '', total: 100, iva: 19,
  totalConIva: 119, cobradoPct: 0, cobrado: 0, porCobrar: 119, retenciones: 0,
  participacion: 1, cartera: '', unidadesPorDespachar: 0,
};

const DATOS: ContabilidadData = {
  facturas: [FACTURA],
  resumen: {
    meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, facturacion: 0, iva: 0, acumulado: 0 })),
    totalFacturadoSinIva: 0, totalIva: 0, presupuesto: null, cumplimientoPct: null, comparativos: [],
  },
  anioActual: 2026,
  aniosDisponibles: [2026],
};

const OV: OVPendienteFacturable = {
  salesorder_number: 'OV-2026-167', date: '2026-09-01', customer_name: 'SGS', status: 'open',
  currency_code: 'COP', total: 1000, pending: 1000, shipment_date: null, despachada: false,
  despachoParcial: false, soloPaquete: false, ticketPorFacturar: false, paquetePorCrear: false,
  facturable: false, ticket: null, trato: '', qt: '',
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mock(api.fetchContabilidad).mockResolvedValue(DATOS);
  mock(api.fetchOVPendientes).mockImplementation(pendiente);
  mock(api.fetchAnticiposAtencion).mockImplementation(pendiente);
  mock(api.fetchPagosPorSemana).mockImplementation(pendiente);
  mock(api.fetchFacturaDetalle).mockImplementation(pendiente);
  mock(api.fetchOVDetalle).mockImplementation(pendiente);
});

/** Enfoca la fila y pulsa la tecla, como haría quien navega con Tab. */
function pulsarEnFila(fila: HTMLElement, key: string) {
  fila.focus();
  fireEvent.keyDown(fila, { key });
}

describe('Facturación (FE-419)', () => {
  it('los filtros tienen nombre accesible', async () => {
    render(<App />);
    await screen.findByRole('row', { name: /FV-1/ });
    for (const nombre of ['Año', 'Cliente', 'Estado', 'Mes']) {
      expect(screen.getByRole('combobox', { name: nombre })).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Buscar cliente, OV o factura' })).toBeInTheDocument();
  });

  it('las cabeceras ordenables son botones y la activa declara su sentido', async () => {
    render(<App />);
    await screen.findByRole('row', { name: /FV-1/ });
    // Orden inicial: fecha de factura ascendente.
    expect(screen.getByRole('columnheader', { name: /FECHA FACTURA/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'RAZÓN SOCIAL' }));
    const cabecera = screen.getByRole('columnheader', { name: /RAZÓN SOCIAL/ });
    expect(cabecera).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /FECHA FACTURA/ })).not.toHaveAttribute('aria-sort');
    fireEvent.click(within(cabecera).getByRole('button'));
    expect(cabecera).toHaveAttribute('aria-sort', 'descending');
    // La luz de entrega no se ordena: no es un botón.
    expect(screen.queryByRole('button', { name: 'ENTREGA' })).not.toBeInTheDocument();
  });

  it('Enter en una fila abre su detalle como diálogo; Escape lo cierra y el foco vuelve a la fila', async () => {
    render(<App />);
    const fila = await screen.findByRole('row', { name: 'Abrir el detalle de la factura FV-1' });
    pulsarEnFila(fila, 'Enter');
    const dialogo = screen.getByRole('dialog', { name: 'Factura FV-1' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(fila);
  });

  it('el input de cartera tiene nombre y sus teclas no abren el detalle', async () => {
    render(<App />);
    const cartera = await screen.findByRole('textbox', { name: 'Cartera de la factura FV-1' });
    fireEvent.keyDown(cartera, { key: 'Enter' });
    fireEvent.keyDown(cartera, { key: ' ' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el campo del presupuesto tiene nombre', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'editar' }));
    expect(screen.getByRole('spinbutton', { name: 'Presupuesto 2026' })).toBeInTheDocument();
  });
});

describe('OV pendientes (FE-419)', () => {
  it('filtros con nombre, cabeceras botón y la fila abre el detalle con Espacio', async () => {
    mock(api.fetchOVPendientes).mockResolvedValue([OV]);
    render(<OVPendientes />);
    const fila = await screen.findByRole('row', { name: 'Abrir el detalle de la OV OV-2026-167' });
    expect(screen.getByRole('combobox', { name: 'Estado' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Buscar OV o cliente' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /POR FACTURAR/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: 'CLIENTE' }));
    expect(screen.getByRole('columnheader', { name: /CLIENTE/ })).toHaveAttribute('aria-sort', 'ascending');
    pulsarEnFila(fila, ' ');
    expect(screen.getByRole('dialog', { name: 'Orden de venta OV-2026-167' })).toBeInTheDocument();
  });
});

describe('Facturas por entregar (FE-419)', () => {
  it('el buscador tiene nombre y la fila abre el detalle con Enter', async () => {
    mock(api.fetchFacturasPorEntregar).mockResolvedValue([
      { invoiceNumber: 'FV-9', cliente: 'ACME', fecha: '2026-09-01', ov: 'OV-9', unidadesPorDespachar: 2 },
    ]);
    render(<FacturasPorEntregar />);
    const fila = await screen.findByRole('row', { name: 'Abrir el detalle de la factura FV-9' });
    expect(screen.getByRole('textbox', { name: 'Buscar factura, cliente u OV' })).toBeInTheDocument();
    pulsarEnFila(fila, 'Enter');
    expect(screen.getByRole('dialog', { name: /Factura FV-9/ })).toBeInTheDocument();
  });
});
