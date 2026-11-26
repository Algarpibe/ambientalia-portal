import type { Evento, Vista } from './tipos';

// Datos ficticios para las pruebas de la invitación (el repo es público).

export const YO = '00000000-0000-4000-8000-00000000000a';
export const BRUNO = '00000000-0000-4000-8000-00000000000b';
export const CARLA = '00000000-0000-4000-8000-00000000000c';

export function eventoDePrueba(cambios: Partial<Evento> = {}): Evento {
  return {
    id: 'fin-de-ano-2026',
    titulo: 'Almuerzo de fin de año 2026',
    inicio: '2026-12-18T12:30:00-05:00',
    fin: '2026-12-18T16:00:00-05:00',
    lugar: 'Restaurante Anfitriona',
    direccion: 'Cl. 83 Bis #24-09, Bogotá D.C.',
    vestimenta: 'Smart casual',
    cierreConfirmaciones: '2026-12-04T23:59:59-05:00',
    confirmacionesAbiertas: true,
    votosAbiertos: true,
    cualidades: ['Liderazgo', 'Empatía', 'Compromiso', 'Creatividad', 'Trabajo en equipo'],
    preferencias: [
      { codigo: 'general', texto: 'Menú general (sin restricciones)' },
      { codigo: 'vegetariano', texto: 'Opción vegetariana' },
    ],
    maxCualidades: 3,
    ...cambios,
  };
}

export function vistaDePrueba(cambios: Partial<Vista> = {}): Vista {
  return {
    evento: eventoDePrueba(),
    yo: YO,
    esAdmin: false,
    equipo: [
      { userId: YO, nombre: 'Ana Ruiz', avatar: null, cualidades: [] },
      {
        userId: BRUNO,
        nombre: 'Bruno Díaz',
        avatar: null,
        cualidades: [
          { cualidad: 'Empatía', votos: 4 },
          { cualidad: 'Liderazgo', votos: 2 },
        ],
      },
      { userId: CARLA, nombre: 'Carla Gómez', avatar: null, cualidades: [] },
    ],
    miRespuesta: null,
    misVotos: {},
    ...cambios,
  };
}
