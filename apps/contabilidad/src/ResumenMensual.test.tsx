import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResumenMensual from './ResumenMensual';
import type { Resumen } from './api';

const resumen = (presupuesto: number | null): Resumen => ({
  meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, facturacion: 0, iva: 0, acumulado: 0 })),
  totalFacturadoSinIva: 0,
  totalIva: 0,
  presupuesto,
  cumplimientoPct: null,
  comparativos: [],
});

function montar(presupuesto: number | null) {
  const onGuardar = vi.fn();
  render(
    <ResumenMensual
      resumen={resumen(presupuesto)}
      anio={2026}
      puedeEditar
      onGuardarPresupuesto={onGuardar}
      guardandoPresupuesto={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'editar' }));
  return onGuardar;
}

// FE-415: sin presupuesto previo, un Guardar en blanco enviaba `Number('') === 0` y
// guardaba un presupuesto 0 que deja sin base el KPI de cumplimiento.
describe('ResumenMensual · edición del presupuesto (FE-415)', () => {
  it('sin presupuesto previo, Guardar en blanco no guarda nada', () => {
    const onGuardar = montar(null);
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();
    fireEvent.click(guardar);
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it.each(['0', '-100'])('no permite guardar el valor %s', (valor) => {
    const onGuardar = montar(null);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: valor } });
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();
    fireEvent.click(guardar);
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('guarda un valor positivo', () => {
    const onGuardar = montar(null);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4416000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onGuardar).toHaveBeenCalledWith(4416000000);
  });

  it('con presupuesto previo, Guardar sin tocar reenvía el mismo valor', () => {
    const onGuardar = montar(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onGuardar).toHaveBeenCalledWith(1000);
  });
});
