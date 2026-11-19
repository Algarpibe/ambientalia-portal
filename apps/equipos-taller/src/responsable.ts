// Cambio de responsable desde la tabla (D8): se guarda al elegir, con UNA petición a la vez por visita.
// Si se elige otra cosa mientras una petición va en curso, solo cuenta la última elección y sale al terminar
// la actual: el servidor recibe los cambios en el orden del usuario y `base` es siempre lo último que confirmó.
import { useRef, type Dispatch, type SetStateAction } from 'react';
import type { ApiEquipos } from './api';
import type { ResponsableAsignado, RespuestaEquipos, TecnicoAsignable } from './nucleo';

interface EnCurso {
  /** Lo último elegido ('' = quitar). */
  id: string;
  /** Lo que se ve mientras se guarda. */
  quiere: ResponsableAsignado | undefined;
  /** Lo último que confirmó el servidor: a lo que se vuelve si falla. */
  base: ResponsableAsignado | undefined;
}

export function useAsignarResponsable(o: {
  api: ApiEquipos;
  datos: RespuestaEquipos | null;
  setDatos: Dispatch<SetStateAction<RespuestaEquipos | null>>;
  tecnicos: TecnicoAsignable[] | null;
  setAviso: (m: string) => void;
}) {
  const { api, datos, setDatos, tecnicos, setAviso } = o;
  const cola = useRef(new Map<string, EnCurso>());
  const poner = (clave: string, r: ResponsableAsignado | undefined) =>
    setDatos((d) => {
      if (!d) return d;
      const m = { ...(d.responsables ?? {}) };
      if (r) m[clave] = r;
      else delete m[clave];
      return { ...d, responsables: m };
    });

  async function asignar(clave: string, userId: string) {
    const t = tecnicos?.find((x) => x.userId === userId);
    const quiere: ResponsableAsignado | undefined = userId && t ? { userId, nombre: t.nombre, por: '', en: '' } : undefined;
    poner(clave, quiere);
    const c = cola.current.get(clave);
    if (c) { c.id = userId; c.quiere = quiere; return; } // la petición en curso mandará esto al terminar
    const reg: EnCurso = { id: userId, quiere, base: datos?.responsables?.[clave] };
    cola.current.set(clave, reg);
    try {
      let enviado: string;
      do {
        enviado = reg.id;
        reg.base = enviado ? await api.asignarResponsable(clave, enviado) : (await api.quitarResponsable(clave), undefined);
      } while (reg.id !== enviado);
    } catch (e) {
      setAviso('No se pudo cambiar el responsable: ' + (e as Error).message);
    } finally {
      cola.current.delete(clave);
      poner(clave, reg.base);
    }
  }

  /** Una foto del servidor no pisa un cambio aún sin confirmar (se vería un valor falso). */
  function conPendientes(nuevo: RespuestaEquipos): RespuestaEquipos {
    if (!cola.current.size) return nuevo;
    const m = { ...(nuevo.responsables ?? {}) };
    cola.current.forEach((v, k) => { if (v.quiere) m[k] = v.quiere; else delete m[k]; });
    return { ...nuevo, responsables: m };
  }

  return { asignar, conPendientes };
}
