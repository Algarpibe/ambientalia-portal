// Avatar circular: muestra la imagen si existe, o las iniciales del nombre.
export default function Avatar({
  src,
  name,
  size = 40,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt="Avatar"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials =
    (name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return (
    <div
      className="rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold select-none"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials}
    </div>
  );
}
