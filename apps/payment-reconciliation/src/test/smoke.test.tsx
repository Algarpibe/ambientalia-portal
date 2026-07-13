import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Smoke test de la infra de tests de UI (ARQ-001 G): verifica jsdom + render +
// matcher de jest-dom. Si esto pasa, F puede escribir tests de subcomponentes.
function Hello({ name }: { name: string }) {
  return <div>Hola, {name}</div>;
}

describe('infra UI (jsdom + RTL)', () => {
  it('renderiza un componente y lo consulta en el DOM', () => {
    render(<Hello name="Ambientalia" />);
    expect(screen.getByText('Hola, Ambientalia')).toBeInTheDocument();
  });
});
