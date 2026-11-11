// «Escanear S/N»: busca un equipo en todo el taller por su número de serie, escrito a mano o leído con la
// cámara (BarcodeDetector del navegador, sin librerías). Sin lector, queda la entrada manual. Solo lectura.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Tarjeta } from './nucleo';

interface Detector { detect(origen: HTMLVideoElement): Promise<{ rawValue: string }[]> }
type ConstructorDetector = new () => Detector;

const limpiar = (s: string) => s.trim().toUpperCase();
const hayLector = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** Enciende la cámara mientras `activa` y llama a `onLeido` con el primer código; la apaga al terminar. */
function useCamara(activa: boolean, onLeido: (codigo: string) => void, onFallo: () => void) {
  const video = useRef<HTMLVideoElement>(null);
  const alLeer = useRef(onLeido);
  const alFallar = useRef(onFallo);
  alLeer.current = onLeido;
  alFallar.current = onFallo;
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    let ciclo: ReturnType<typeof setInterval> | undefined;
    let flujo: MediaStream | undefined;
    const apagar = () => { clearInterval(ciclo); flujo?.getTracks().forEach((t) => t.stop()); };
    (async () => {
      try {
        const detector = new (window as unknown as { BarcodeDetector: ConstructorDetector }).BarcodeDetector();
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!vivo) return apagar();
        if (video.current) video.current.srcObject = flujo;
        ciclo = setInterval(async () => {
          const codigos = await detector.detect(video.current!).catch(() => []);
          if (vivo && codigos[0]) { apagar(); alLeer.current(codigos[0].rawValue); }
        }, 500);
      } catch {
        if (vivo) alFallar.current();
      }
    })();
    return () => { vivo = false; apagar(); };
  }, [activa]);
  return video;
}

export default function EscanearSerial({ tarjetas, onCerrar, mostrar }: { tarjetas: Tarjeta[]; onCerrar: () => void; mostrar: (t: Tarjeta) => React.ReactNode }) {
  const [valor, setValor] = useState('');
  const [buscado, setBuscado] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const [fallo, setFallo] = useState(false);
  const video = useCamara(
    camara,
    (c) => { setCamara(false); setValor(limpiar(c)); setBuscado(limpiar(c)); },
    () => { setCamara(false); setFallo(true); },
  );
  const hallados = buscado ? tarjetas.filter((t) => limpiar(t.sn) === buscado) : [];
  const enviar = (e: FormEvent) => { e.preventDefault(); setBuscado(limpiar(valor)); };

  return (
    <section className="tt-mis-escaner" aria-label="Escanear S/N">
      <form onSubmit={enviar} className="tt-mis-escaner-forma">
        <input className="tt-mis-campo tt-mono" aria-label="Número de serie" value={valor} onChange={(e) => setValor(e.target.value)} autoComplete="off" />
        <button type="submit" className="tt-mis-boton">Buscar</button>
      </form>
      {hayLector() ? <button type="button" className="tt-mis-boton" onClick={() => { setFallo(false); setCamara(true); }}>Usar la cámara</button> : null}
      {camara ? <video ref={video} className="tt-mis-video" autoPlay playsInline muted aria-label="Vista de la cámara" /> : null}
      {fallo ? <p role="alert" className="tt-mensaje">No se pudo abrir la cámara. Escribe el S/N a mano.</p> : null}
      {buscado !== null ? (
        <section aria-label="Resultado de la búsqueda" className="tt-mis-grupo">
          {hallados.length ? hallados.map(mostrar) : <p className="tt-mensaje">{`No hay un equipo con el S/N ${buscado}.`}</p>}
        </section>
      ) : null}
      <button type="button" className="tt-mis-boton" onClick={onCerrar}>Cerrar</button>
    </section>
  );
}
