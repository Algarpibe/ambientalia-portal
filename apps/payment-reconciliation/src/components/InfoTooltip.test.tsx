import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoTooltip } from './InfoTooltip';

describe('InfoTooltip', () => {
  it('oculto por defecto; muestra título y descripción al hover', () => {
    render(<InfoTooltip title="DSO" description="Días de cobro" />);
    expect(screen.queryByText('DSO')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByText('DSO')).toBeInTheDocument();
    expect(screen.getByText('Días de cobro')).toBeInTheDocument();
  });

  it('muestra la fórmula cuando se provee', () => {
    render(<InfoTooltip title="T" description="d" formula="a / b * 100" />);
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByText('a / b * 100')).toBeInTheDocument();
  });

  it('se oculta al salir el mouse', () => {
    render(<InfoTooltip title="T" description="d" />);
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    expect(screen.getByText('T')).toBeInTheDocument();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByText('T')).not.toBeInTheDocument();
  });
});
