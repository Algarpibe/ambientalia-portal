import { describe, it, expect } from 'vitest';
import { aprobadoresDe, construirIndice, creariaCiclo, detectarCiclos } from './jerarquia.js';
import type { EnlaceJerarquia } from './jerarquia.js';

const ANA = 'ana.ruiz@ambientalia.com.co';
const XIOMARA = 'xiomara.perez@ambientalia.com.co';
const ALFONSO = 'comercial@ambientalia.com.co';

function enlace(correo: string, aprobadorCorreo: string): EnlaceJerarquia {
  return { correo, aprobadorCorreo };
}

/** Un solicitante. Por defecto con doble firma, que es el default del SQL. */
function solicitante(correo: string, aprobadorCorreo: string, requiereSegundaFirma = true) {
  return { correo, aprobadorCorreo, requiereSegundaFirma };
}

describe('aprobadoresDe', () => {
  it('cadena de tres: firma el jefe y luego el jefe del jefe', () => {
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), enlace(XIOMARA, ALFONSO));
    expect(r).toEqual({ primero: XIOMARA, segundo: ALFONSO, informado: null });
  });

  it('el jefe no tiene ficha en el maestro: una sola firma', () => {
    // El caso real de hoy: todo el mundo cuelga de un buzón que puede no estar
    // dado de alta como empleado. Tiene que seguir funcionando igual que antes.
    const r = aprobadoresDe(solicitante(ANA, ALFONSO), null);
    expect(r).toEqual({ primero: ALFONSO, segundo: null, informado: null });
  });

  it('el jefe tiene la ficha desactivada: una sola firma, y NO salta al abuelo', () => {
    // `enlaceDe` filtra por `activo`, así que un jefe desactivado llega como null.
    // Si esto devolviera el abuelo, desactivar a alguien mandaría las solicitudes
    // de su equipo al buzón de quien no las espera.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), null);
    expect(r.segundo).toBeNull();
  });

  it('el jefe es la raíz (jefe de sí mismo): una sola firma', () => {
    const r = aprobadoresDe(solicitante(XIOMARA, ALFONSO), enlace(ALFONSO, ALFONSO));
    expect(r).toEqual({ primero: ALFONSO, segundo: null, informado: null });
  });

  it('quien es su propio jefe se aprueba a sí mismo, sin segunda firma', () => {
    const r = aprobadoresDe(solicitante(ALFONSO, ALFONSO), enlace(ALFONSO, ALFONSO));
    expect(r).toEqual({ primero: ALFONSO, segundo: null, informado: null });
  });

  it('un ciclo de dos NO deja que el solicitante se firme a sí mismo', () => {
    // Ana es jefa de Xiomara y Xiomara es jefa de Ana. Sin el corte, el segundo
    // aprobador de Ana sería Ana: autoaprobación disfrazada de cascada.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), enlace(XIOMARA, ANA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('no repite firmante cuando el jefe del jefe es el mismo que firma primero', () => {
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), enlace(XIOMARA, XIOMARA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('las mayúsculas no cambian el resultado', () => {
    const r = aprobadoresDe(
      solicitante('Ana.Ruiz@Ambientalia.com.co', 'XIOMARA.perez@ambientalia.com.co'),
      enlace('xiomara.PEREZ@ambientalia.com.co', 'Comercial@ambientalia.com.co'),
    );
    expect(r).toEqual({ primero: XIOMARA, segundo: ALFONSO, informado: null });
  });

  it('con la casilla apagada el jefe del jefe no firma: solo se le informa', () => {
    const r = aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, ALFONSO));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: ALFONSO });
  });

  it('apagar la casilla NO inventa a quien informar si el árbol ya se acababa', () => {
    // El jefe es la raíz. No hay segundo nivel, así que no hay ni firma que
    // quitar ni aviso que dar: el correo tiene que salir igual que hoy.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, XIOMARA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('un ciclo de dos no convierte al solicitante en informado de sí mismo', () => {
    // Las cuatro reglas de corte se aplican ANTES de repartir. Sin eso, apagar
    // la casilla pondría a Ana en el correo de su propia solicitud.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, ANA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('firmante e informado nunca tienen valor a la vez', () => {
    // La invariante de la que depende que nada más haya que tocarse: mientras
    // `segundo` sea null, todo lo que ya lee ese campo sigue siendo correcto.
    const casos = [
      aprobadoresDe(solicitante(ANA, XIOMARA, true), enlace(XIOMARA, ALFONSO)),
      aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, ALFONSO)),
      aprobadoresDe(solicitante(ANA, XIOMARA, false), null),
      aprobadoresDe(solicitante(ANA, ALFONSO, true), enlace(ALFONSO, ALFONSO)),
    ];
    for (const r of casos) {
      expect(r.segundo === null || r.informado === null).toBe(true);
    }
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
