import { Star } from 'lucide-react';

export default function FavoriteStar({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={active ? 'Quitar de favoritos' : 'Añadir a favoritos'}
      className="p-1 text-gray-300 hover:text-amber-400"
    >
      <Star size={16} className={active ? 'fill-amber-400 text-amber-400' : ''} />
    </button>
  );
}
