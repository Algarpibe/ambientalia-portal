import { COLORES } from './marca';

// Confeti con los colores del logo, en un lienzo fijo que no tapa los clics y
// se quita solo al terminar. No hace nada si el sistema pide menos movimiento.

interface Particula {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tam: number;
  color: string;
  rot: number;
  vRot: number;
}

let lienzo: HTMLCanvasElement | null = null;
let particulas: Particula[] = [];
let animando = false;

export function prefiereMenosMovimiento(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function lanzarConfeti(cantidad = 85): void {
  if (prefiereMenosMovimiento()) return;
  if (!lienzo) {
    lienzo = document.createElement('canvas');
    lienzo.setAttribute('aria-hidden', 'true');
    Object.assign(lienzo.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '60',
    });
    document.body.appendChild(lienzo);
  }
  const ctx = lienzo.getContext('2d');
  if (!ctx) {
    lienzo.remove();
    lienzo = null;
    return;
  }
  lienzo.width = window.innerWidth;
  lienzo.height = window.innerHeight;
  for (let i = 0; i < cantidad; i++) {
    particulas.push({
      x: Math.random() * lienzo.width,
      y: -10 - Math.random() * 80,
      vx: (Math.random() - 0.5) * 5,
      vy: 2.5 + Math.random() * 4.5,
      tam: 6 + Math.random() * 6,
      color: COLORES[Math.floor(Math.random() * COLORES.length)],
      rot: Math.random() * 360,
      vRot: (Math.random() - 0.5) * 10,
    });
  }
  if (!animando) {
    animando = true;
    window.requestAnimationFrame(() => paso(ctx));
  }
}

function paso(ctx: CanvasRenderingContext2D): void {
  const actual = lienzo;
  if (!actual) {
    animando = false;
    return;
  }
  ctx.clearRect(0, 0, actual.width, actual.height);
  particulas = particulas.filter((p) => p.y < actual.height + 20);
  for (const p of particulas) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vRot;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.tam / 2, -p.tam / 2, p.tam, p.tam * 0.6);
    ctx.restore();
  }
  if (particulas.length > 0) {
    window.requestAnimationFrame(() => paso(ctx));
  } else {
    animando = false;
    actual.remove();
    lienzo = null;
  }
}
