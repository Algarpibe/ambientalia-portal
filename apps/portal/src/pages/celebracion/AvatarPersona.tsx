import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { colorDe, iniciales } from './persona';
import type { Miembro } from './tipos';

interface Props {
  persona: Pick<Miembro, 'userId' | 'nombre' | 'avatar' | 'foto'>;
  /** Tamaño, margen y grosor del aro; por defecto, los del muro. */
  className?: string;
  /** Tamaño de las iniciales cuando no hay foto. */
  claseIniciales?: string;
}

/** La foto graciosa; si no hay, la de perfil; si tampoco, las iniciales sobre su color. */
export default function AvatarPersona({ persona, className = 'mb-3 h-[74px] w-[74px] p-[3px]', claseIniciales = 'text-xl' }: Props) {
  const imagen = persona.foto ?? persona.avatar;
  return (
    <div className={`mx-auto rounded-full ${className}`} style={{ background: ESPECTRO }}>
      {imagen ? (
        <img src={imagen} alt="" className="h-full w-full rounded-full bg-white object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className={`flex h-full w-full items-center justify-center rounded-full font-black text-white ${claseIniciales}`}
          style={{ background: colorDe(persona.userId), fontFamily: FUENTE_TITULOS }}
        >
          {iniciales(persona.nombre)}
        </div>
      )}
    </div>
  );
}
