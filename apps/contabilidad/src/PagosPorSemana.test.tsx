import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PagosPorSemana from './PagosPorSemana';
import { fetchPagosPorSemana, type SemanaDePagos } from './api';
import { formatCOP, formatMoneda } from './format';

vi.mock('./api', () => ({ fetchPagosPorSemana: vi.fn() }));
const mockFetch = fetchPagosPorSemana as unknown as ReturnType<typeof vi.fn>;

// Intl separa el símbolo de la cifra con un espacio duro (U+00A0). Testing Library normaliza
// los espacios del texto pintado, pero no los de la cadena que se le pasa: hay que hacerlo aquí.
const comoSeLee = (s: string) => s.replace(/ /g, ' ');

// Texto de las columnas ANTICIPO, OV y FACTURA de la fila de un pago.
const celdas = (numero: string) => {
  const td = screen.getByText(numero).closest('tr')!.querySelectorAll('td');
  return { anticipo: td[5].textContent, ov: td[6].textContent, factura: td[7].textContent };
};

afterEach(() => {
  vi.clearAllMocks();
});

const semana = (over: Partial<SemanaDePagos>): SemanaDePagos => ({
  anio: 2026, mes: 9, semana: 1, etiqueta: '1-6 sep 2026', desde: '2026-09-01', hasta: '2026-09-06',
  cantidadPagos: 1, totales: [{ moneda: 'COP', total: 11150331 }],
  pagos: [{
    id: 'p276', numero: 'PC-2026-276', cliente: 'SHI', fecha: '2026-09-02', modo: 'Transferencia bancaria',
    referencia: null, moneda: 'COP', importe: 11150331, sinAplicar: 0, anticipo: null,
    aplicaciones: [{ factura: 'AM1492', ov: 'OV-2026-162', importe: 11150331 }],
  }],
  ...over,
});

describe('PagosPorSemana', () => {
  it('las semanas llegan plegadas y el detalle aparece al desplegar', async () => {
    mockFetch.mockResolvedValue([semana({})]);
    render(<PagosPorSemana />);
    const boton = await screen.findByRole('button', { name: /Semana 1 · 1-6 sep 2026/ });
    expect(screen.queryByText('PC-2026-276')).toBeNull();
    fireEvent.click(boton);
    expect(screen.getByText('PC-2026-276')).toBeInTheDocument();
    expect(celdas('PC-2026-276')).toMatchObject({ anticipo: '—', ov: 'OV-2026-162', factura: 'AM1492' });
  });

  it('un pago sin aplicar enseña su saldo pendiente', async () => {
    mockFetch.mockResolvedValue([semana({
      totales: [{ moneda: 'COP', total: 800000 }],
      pagos: [{
        id: 'p9', numero: 'PC-9', cliente: 'Secolab', fecha: '2026-09-03', modo: null, referencia: null,
        moneda: 'COP', importe: 800000, sinAplicar: 500000, anticipo: null, aplicaciones: [],
      }],
    })]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 1/ }));
    expect(screen.getByText(comoSeLee(formatCOP(500000)))).toBeInTheDocument();
  });

  it('un pago anticipado ya descontado reparte anticipo, OV y factura en sus columnas, la OV una sola vez', async () => {
    mockFetch.mockResolvedValue([semana({
      pagos: [{ ...semana({}).pagos[0], anticipo: { numero: 'ANT-2026-061', ov: 'OV-2026-162' } }],
    })]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 1/ }));
    expect(celdas('PC-2026-276')).toMatchObject({ anticipo: 'ANT-2026-061', ov: 'OV-2026-162', factura: 'AM1492' });
  });

  it('un anticipo sin aplicar todavía: sin factura, y sin OV si el texto no la nombra', async () => {
    mockFetch.mockResolvedValue([semana({
      pagos: [{
        ...semana({}).pagos[0], sinAplicar: 11150331, aplicaciones: [],
        anticipo: { numero: 'ANT-2026-061', ov: null },
      }],
    })]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 1/ }));
    expect(celdas('PC-2026-276')).toMatchObject({ anticipo: 'ANT-2026-061', ov: '—', factura: '—' });
  });

  it('un pago aplicado a dos facturas de OV distintas lista las dos en cada columna', async () => {
    mockFetch.mockResolvedValue([semana({
      pagos: [{
        ...semana({}).pagos[0],
        aplicaciones: [
          { factura: 'AM1', ov: 'OV-1', importe: 1 },
          { factura: 'AM2', ov: 'OV-2', importe: 2 },
        ],
      }],
    })]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 1/ }));
    expect(celdas('PC-2026-276')).toMatchObject({ ov: 'OV-1OV-2', factura: 'AM1AM2' });
  });

  it('una semana con pagos en dos monedas muestra un total por moneda', async () => {
    mockFetch.mockResolvedValue([semana({
      cantidadPagos: 2,
      totales: [{ moneda: 'COP', total: 1000000 }, { moneda: 'USD', total: 5000 }],
    })]);
    render(<PagosPorSemana />);
    await screen.findByRole('button', { name: /Semana 1/ });
    expect(screen.getByText(comoSeLee(formatMoneda(1000000, 'COP')))).toBeInTheDocument();
    expect(screen.getByText(comoSeLee(formatMoneda(5000, 'USD')))).toBeInTheDocument();
  });

  it('se pueden tener varias semanas abiertas a la vez', async () => {
    mockFetch.mockResolvedValue([
      semana({ semana: 2, etiqueta: '7-13 sep 2026', pagos: [{ ...semana({}).pagos[0], id: 'pA', numero: 'PC-A' }] }),
      semana({ semana: 1, etiqueta: '1-6 sep 2026', pagos: [{ ...semana({}).pagos[0], id: 'pB', numero: 'PC-B' }] }),
    ]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 2/ }));
    fireEvent.click(screen.getByRole('button', { name: /Semana 1/ }));
    expect(screen.getByText('PC-A')).toBeInTheDocument();
    expect(screen.getByText('PC-B')).toBeInTheDocument();
  });

  it('si la petición falla enseña el error', async () => {
    mockFetch.mockRejectedValue(new Error('No tienes acceso a esta información.'));
    render(<PagosPorSemana />);
    expect(await screen.findByText(/No tienes acceso a esta información\./)).toBeInTheDocument();
  });

  it('sin pagos lo dice', async () => {
    mockFetch.mockResolvedValue([]);
    render(<PagosPorSemana />);
    expect(await screen.findByText('No hay pagos registrados.')).toBeInTheDocument();
  });
});
