import { describe, it, expect } from 'vitest';
import { aprobadoresDe, construirIndice, creariaCiclo, detectarCiclos } from './jerarquia.js';
import type { EnlaceJerarquia } from './jerarquia.js';

const ANA = 'ana.ruiz@ambientalia.com.co';
const XIOMARA = 'xiomara.perez@ambientalia.com.co';
const ALFONSO = 'comercial@ambientalia.com.co';

function enlace(correo: string, aprobadorCorreo: string): EnlaceJerarquia {
  return { correo, aprobadorCorreo };
}

describe('aprobadoresDe', () => {
  it('cadena de tres: firma el jefe y luego el jefe del jefe', () => {
    const r = aprobadoresDe({ correo: ANA, aprobadorCorreo: XIOMARA }, enlace(XIOMARA, ALFONSO));
    expect(r).toEqual({ primero: XIOMARA, segundo: ALFONSO });
  });

  it('el jefe no tiene ficha en el maestro: una sola firma', () => {
    // El caso real de hoy: todo el mundo cuelga de un buzón que puede no estar
    // dado de alta como empleado. Tiene que seguir funcionando igual que antes.
    const r = aprobadoresDe({ correo: ANA, aprobadorCorreo: ALFONSO }, null);
    expect(r).toEqual({ primero: ALFONSO, segundo: null });
  });

  it('el jefe tiene la ficha desactivada: una sola firma, y NO salta al abuelo', () => {
    // `enlaceDe` filtra por `activo`, así que un jefe desactivado llega como null.
    // Si esto devolviera el abuelo, desactivar a alguien mandaría las solicitudes
    // de su equipo al buzón de quien no las espera.
    const r = aprobadoresDe({ correo: ANA, aprobadorCorreo: XIOMARA }, null);
    expect(r.segundo).toBeNull();
  });

  it('el jefe es la raíz (jefe de sí mismo): una sola firma', () => {
    const r = aprobadoresDe({ correo: XIOMARA, aprobadorCorreo: ALFONSO }, enlace(ALFONSO, ALFONSO));
    expect(r).toEqual({ primero: ALFONSO, segundo: null });
  });

  it('quien es su propio jefe se aprueba a sí mismo, sin segunda firma', () => {
    const r = aprobadoresDe({ correo: ALFONSO, aprobadorCorreo: ALFONSO }, enlace(ALFONSO, ALFONSO));
    expect(r).toEqual({ primero: ALFONSO, segundo: null });
  });

  it('un ciclo de dos NO deja que el solicitante se firme a sí mismo', () => {
    // Ana es jefa de Xiomara y Xiomara es jefa de Ana. Sin el corte, el segundo
    // aprobador de Ana sería Ana: autoaprobación disfrazada de cascada.
    const r = aprobadoresDe({ correo: ANA, aprobadorCorreo: XIOMARA }, enlace(XIOMARA, ANA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null });
  });

  it('no repite firmante cuando el jefe del jefe es el mismo que firma primero', () => {
    const r = aprobadoresDe({ correo: ANA, aprobadorCorreo: XIOMARA }, enlace(XIOMARA, XIOMARA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null });
  });

  it('las mayúsculas no cambian el resultado', () => {
    const r = aprobadoresDe(
      { correo: 'Ana.Ruiz@Ambientalia.com.co', aprobadorCorreo: 'XIOMARA.perez@ambientalia.com.co' },
      enlace('xiomara.PEREZ@ambientalia.com.co', 'Comercial@ambientalia.com.co'),
    );
    expect(r).toEqual({ primero: XIOMARA, segundo: ALFONSO });
  });
});

describe('creariaCiclo', () => {
  const indice = construirIndice([
    enlace(ANA, XIOMARA),
    enlace(XIOMARA, ALFONSO),
    enlace(ALFONSO, ALFONSO),
  ]);

  it('poner como jefe a alguien que ya cuelga de ti cierra el círculo', () => {
    expect(creariaCiclo(indice, ALFONSO, ANA)).toBe(true);
  });

  it('poner como jefe a alguien de otra rama no cierra nada', () => {
    expect(creariaCiclo(indice, ANA, ALFONSO)).toBe(false);
  });

  it('autoasignarse NO es ciclo: es como se declara la raíz', () => {
    // Si esto devolviera true, el panel no dejaría crear la raíz del organigrama
    // y no habría forma de que nadie dejara de tener jefe.
    expect(creariaCiclo(indice, XIOMARA, XIOMARA)).toBe(false);
  });

  it('la raíz como jefe termina en vez de girar sobre sí misma', () => {
    expect(creariaCiclo(indice, ANA, ALFONSO)).toBe(false);
  });

  it('termina aunque ya haya un ciclo ajeno en la base de datos', { timeout: 2000 }, () => {
    // Sin el conjunto de visitados esto no falla: cuelga el handler de Express
    // para siempre. De ahí el timeout, que convierte el cuelgue en un fallo.
    const conCiclo = construirIndice([
      enlace('a@x.com', 'b@x.com'),
      enlace('b@x.com', 'c@x.com'),
      enlace('c@x.com', 'a@x.com'),
      enlace(ANA, XIOMARA),
    ]);
    expect(creariaCiclo(conCiclo, ANA, 'a@x.com')).toBe(false);
  });
});

describe('detectarCiclos', () => {
  it('un árbol sano no tiene ciclos', () => {
    const indice = construirIndice([
      enlace(ANA, XIOMARA),
      enlace(XIOMARA, ALFONSO),
      enlace(ALFONSO, ALFONSO),
    ]);
    expect(detectarCiclos(indice)).toEqual([]);
  });

  it('la raíz apuntándose a sí misma no es un ciclo', () => {
    expect(detectarCiclos(construirIndice([enlace(ALFONSO, ALFONSO)]))).toEqual([]);
  });

  it('encuentra un círculo de dos', () => {
    const indice = construirIndice([enlace(ANA, XIOMARA), enlace(XIOMARA, ANA)]);
    const ciclos = detectarCiclos(indice);
    expect(ciclos).toHaveLength(1);
    expect([...ciclos[0]].sort()).toEqual([ANA, XIOMARA].sort());
  });

  it('encuentra un círculo de tres y no lo cuenta tres veces', () => {
    // Una vez por cada punto de entrada sería tres avisos del mismo problema.
    const indice = construirIndice([
      enlace('a@x.com', 'b@x.com'),
      enlace('b@x.com', 'c@x.com'),
      enlace('c@x.com', 'a@x.com'),
    ]);
    const ciclos = detectarCiclos(indice);
    expect(ciclos).toHaveLength(1);
    expect(ciclos[0]).toHaveLength(3);
  });

  it('no confunde una rama que desemboca en un círculo con parte del círculo', () => {
    const indice = construirIndice([
      enlace(ANA, 'b@x.com'),
      enlace('b@x.com', 'c@x.com'),
      enlace('c@x.com', 'b@x.com'),
    ]);
    const ciclos = detectarCiclos(indice);
    expect(ciclos).toHaveLength(1);
    expect([...ciclos[0]].sort()).toEqual(['b@x.com', 'c@x.com']);
    expect(ciclos[0]).not.toContain(ANA);
  });
});
