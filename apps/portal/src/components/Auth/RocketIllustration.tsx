export default function RocketIllustration() {
  return (
    <svg
      width="140"
      height="200"
      viewBox="0 0 140 200"
      className="w-32 h-48 md:w-40 md:h-56"
      style={{
        filter: 'drop-shadow(0 10px 20px rgba(0, 0, 0, 0.1))',
        animation: 'rocketFloat 3s ease-in-out infinite'
      }}>
      <defs>
        <style>{`
          @keyframes rocketFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
          }
        `}</style>
      </defs>

      {/* Rocket body */}
      <ellipse cx="70" cy="80" rx="20" ry="40" fill="none" stroke="white" strokeWidth="2" />

      {/* Rocket nose cone */}
      <path d="M 50 50 L 70 20 L 90 50 Z" fill="none" stroke="white" strokeWidth="2" />

      {/* Rocket window */}
      <circle cx="70" cy="60" r="8" fill="none" stroke="white" strokeWidth="2" />

      {/* Left fin */}
      <path
        d="M 50 120 Q 35 130 40 150"
        fill="none"
        stroke="white"
        strokeWidth="2"
      />

      {/* Right fin */}
      <path
        d="M 90 120 Q 105 130 100 150"
        fill="none"
        stroke="white"
        strokeWidth="2"
      />

      {/* Rocket base */}
      <rect x="60" y="115" width="20" height="25" fill="none" stroke="white" strokeWidth="2" />

      {/* Left flame */}
      <path
        d="M 65 140 Q 55 155 60 180 Q 65 160 65 140"
        fill="none"
        stroke="white"
        strokeWidth="2"
        opacity="0.8"
      />

      {/* Right flame */}
      <path
        d="M 75 140 Q 85 155 80 180 Q 75 160 75 140"
        fill="none"
        stroke="white"
        strokeWidth="2"
        opacity="0.8"
      />

      {/* Center flame */}
      <path
        d="M 70 140 Q 70 160 70 185"
        fill="none"
        stroke="white"
        strokeWidth="2"
        opacity="0.6"
      />

      {/* Top decorative line */}
      <line x1="65" y1="40" x2="75" y2="40" stroke="white" strokeWidth="1.5" />

      {/* Side decorative lines */}
      <line x1="48" y1="75" x2="45" y2="75" stroke="white" strokeWidth="1.5" />
      <line x1="92" y1="75" x2="95" y2="75" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
