import { Star } from 'lucide-react';

export default function FavoriteStar({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={active ? 'Quitar de favoritos' : 'Añadir a favoritos'}
      className={active ? 'p-1' : 'p-1 text-gray-300 hover:text-[#EE7A21]'}
    >
      <Star size={16} className={active ? 'fill-[#EE7A21] text-[#EE7A21]' : ''} />
    </button>
  );
}
