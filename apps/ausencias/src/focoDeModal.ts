import { useEffect, useRef, type RefObject } from 'react';

// El foco de un modal: lo que `aria-modal="true"` promete y no cumple.
//
// Ese atributo le dice al lector de pantalla que lo de detras no existe. Al
// foco del teclado no le dice nada: sin esto, tabular dentro de un modal acaba
// en los controles de la pagina de debajo —tapados por el overlay, pero
// perfectamente enfocables—, Escape no cierra nada y al cerrar el foco se cae
// al principio del documento. Quien no usa raton se queda escribiendo a ciegas
// en un formulario que no ve.
//
// Lo usan los dos modales de la app: EditarSolicitud (el molde) y
// PedirModificacion. Vive aparte y no dentro de uno de los dos para que no haya
// dos trampas de foco que se puedan ir separando con los meses.
//
// Se llama `use...` y no `usar...` a proposito: `rules-of-hooks` y
// `exhaustive-deps` de eslint reconocen los hooks por ese prefijo, y un nombre
// castellanizado dejaria los `useEffect` de aqui dentro sin vigilancia. El
// fichero si va en español, como `dominio.ts` o `leerExcel.ts`.

/**
 * Lo que cuenta como parada de tabulacion dentro del dialogo.
 *
 * No se filtra por visibilidad (`offsetParent`, `getClientRects`): en estos dos
 * modales nada se esconde con CSS, lo que no aplica no se renderiza —los dos
 * inputs de fecha desaparecen al anular, el resumen no sale si no hay cambios—,
 * asi que lo que devuelve el selector ya es la lista real. Un filtro de
 * visibilidad ademas seria imposible de probar: en jsdom todo mide cero.
 *
 * Lo `disabled` queda fuera porque el navegador tampoco lo tabula, y aqui eso
 * cambia sola: el boton de enviar de los dos modales esta apagado hasta que el
 * formulario es valido. Por eso la lista se recalcula en cada pulsacion y no se
 * guarda al abrir.
 */
const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Devuelve la ref que hay que poner en el nodo del dialogo. Ese nodo necesita
 * `tabIndex={-1}` para poder recibir el foco sin entrar en el ciclo de tabulacion.
 *
 * @param onCerrar el MISMO que ya usan el boton de cerrar y el clic fuera, para
 *   que las tres salidas del modal hagan exactamente lo mismo.
 */
export function useFocoDeModal<T extends HTMLElement>(onCerrar: () => void): RefObject<T | null> {
  const dialogo = useRef<T>(null);

  // `onCerrar` llega recreado en cada render del padre. Si entrara en las
  // dependencias del efecto de abajo, ese efecto se limpiaria y se volveria a
  // montar con cada render del padre: devolveria el foco fuera, lo volveria a
  // meter en el dialogo, y guardaria como «elemento anterior» el propio dialogo
  // —con lo que al cerrar de verdad el foco no volveria a ninguna parte—. Por
  // una ref el efecto se monta UNA vez y aun asi llama siempre a la ultima
  // version de la funcion.
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    const nodo = dialogo.current;
    if (!nodo) return;

    // Se lee ANTES de mover el foco: es el boton de la fila desde el que se
    // abrio el modal, y es donde tiene que volver quien cierre. Sin esto el
    // foco reaparece al principio del documento y hay que volver a bajar por
    // toda la tabla para seguir donde se estaba.
    const anterior = document.activeElement as HTMLElement | null;

    // El foco entra en el contenedor, no en el primer control. Dos razones: el
    // lector de pantalla anuncia entonces el dialogo entero y su nombre, en vez
    // de soltar «Cerrar, boton» sin decir donde se esta; y como los dos modales
    // llevan `overflow-y-auto`, enfocar un control lo arrastra a la vista y
    // puede dejar el titulo y el aviso de arriba fuera de pantalla antes de que
    // nadie los haya leido. En PedirModificacion ese aviso es la frase que
    // impide el malentendido de toda la feature.
    //
    // De propina, con `tabIndex={-1}` en el contenedor un clic sobre un texto
    // del modal enfoca el contenedor en vez de irse al `body`.
    nodo.focus();

    // Funcion flecha y no `function`: una declaracion se iza, y por eso
    // TypeScript no da por bueno dentro de ella el `if (!nodo) return` de
    // arriba —podria haberse llamado antes— y `nodo` volveria a ser `T | null`.
    const alPulsar = (ev: KeyboardEvent) => {
      // El listener cuelga de `document` y no del dialogo porque el foco puede
      // acabar en el `body` sin que nadie lo haya movido: en EditarSolicitud, el
      // «Usar N» que ofrece el conteo de dias DESAPARECE en cuanto se pulsa —ya
      // no hay diferencia que ofrecer— y el navegador deja el foco huerfano.
      // Desde el `body` no burbujea nada hasta el dialogo, asi que un listener
      // colgado del nodo se quedaria sordo justo ahi: Escape no cerraria y Tab
      // se iria a la pagina de debajo.
      //
      // En burbuja, no en captura, y respetando `defaultPrevented` para que un
      // control de dentro que necesite quedarse con la tecla —cualquier cosa que
      // se cierre sola con Escape— gane: si llama a `preventDefault()`, el modal
      // no se cierra encima de el.
      if (ev.defaultPrevented) return;

      if (ev.key === 'Escape') {
        ev.preventDefault();
        cerrar.current();
        return;
      }
      if (ev.key !== 'Tab') return;

      const lista = Array.from(nodo.querySelectorAll<HTMLElement>(ENFOCABLES));
      if (lista.length === 0) {
        // Un dialogo sin nada enfocable no puede ceder el foco a la pagina de
        // debajo: se lo queda el contenedor. Hoy no pasa —los dos tienen al
        // menos el boton de cerrar—, pero la alternativa es dejar salir el foco
        // justo en el caso en que ya no hay forma de volver a entrar.
        ev.preventDefault();
        nodo.focus();
        return;
      }

      // Solo se interviene en los EXTREMOS del ciclo; por el medio tabula el
      // navegador. Recolocar el foco a mano en cada Tab romperia el orden
      // nativo que la lista no sabe reproducir: los dos radios de
      // PedirModificacion comparten `name` y son UNA sola parada de tabulacion
      // —entre ellos se cambia con las flechas—, y aqui salen como dos.
      const indice = lista.indexOf(document.activeElement as HTMLElement);
      if (ev.shiftKey) {
        // `indice <= 0` y no `=== 0` para cubrir tambien el -1: el foco esta en
        // el contenedor (recien abierto) o se ha escapado fuera, y hacia atras
        // eso es el ultimo control del dialogo.
        if (indice <= 0) {
          ev.preventDefault();
          lista[lista.length - 1].focus();
        }
        return;
      }
      if (indice === -1 || indice === lista.length - 1) {
        ev.preventDefault();
        lista[0].focus();
      }
    };

    document.addEventListener('keydown', alPulsar);
    return () => {
      document.removeEventListener('keydown', alPulsar);
      // `isConnected` porque el elemento de vuelta puede haber desaparecido
      // mientras el modal estaba abierto. Enfocar un nodo ya suelto del
      // documento no falla ni avisa: deja el foco en la nada, que es lo mismo
      // que no haber devuelto nada. Comprobandolo antes, al menos se sabe.
      if (anterior?.isConnected) anterior.focus();
    };
    // Sin dependencias: la trampa se monta al abrir el modal y se deshace al
    // cerrarlo. Todo lo que cambia entre medias se lee en el momento de la
    // pulsacion.
  }, []);

  return dialogo;
}
