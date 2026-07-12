import { useState, useEffect } from 'react';
import RocketIllustration from './RocketIllustration';

export default function AuthLeftPanel() {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      headline: 'Planifica tus actividades y controla tu progreso en línea',
      description: 'Gestiona todas tus tareas en un hermoso panel'
    },
    {
      headline: 'Colabora sin inconvenientes con tu equipo',
      description: 'Actualizaciones en tiempo real y notificaciones instantáneas'
    },
    {
      headline: 'Rastrear todo lo que importa',
      description: 'Análisis e información integral'
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % 3);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center p-12 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #1abc9c 0%, #16a085 50%, #48dbfb 100%)'
      }}>
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white opacity-10"
            style={{
              width: Math.random() * 60 + 20 + 'px',
              height: Math.random() * 60 + 20 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              animation: `float ${5 + Math.random() * 10}s ease-in-out infinite`,
              animationDelay: Math.random() * 5 + 's'
            }}
          />
        ))}
      </div>

      {/* Stars */}
      <div className="absolute inset-0">
        {[...Array(12)].map((_, i) => (
          <svg
            key={i}
            className="absolute w-2 h-2"
            style={{
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              opacity: Math.random() * 0.6 + 0.2,
              animation: `twinkle ${3 + Math.random() * 3}s ease-in-out infinite`,
              animationDelay: Math.random() * 3 + 's'
            }}
            viewBox="0 0 24 24"
            fill="white">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center">
        <RocketIllustration />

        {/* Slide content with fade transition */}
        <div className="mt-12 max-w-xs">
          <h2
            className="text-2xl md:text-3xl font-bold text-white mb-3 transition-all duration-700"
            key={`headline-${currentSlide}`}
            style={{
              animation: 'fadeIn 0.7s ease-in-out'
            }}>
            {slides[currentSlide].headline}
          </h2>
          <p
            className="text-sm md:text-base text-white text-opacity-80 transition-all duration-700"
            key={`desc-${currentSlide}`}
            style={{
              animation: 'fadeIn 0.7s ease-in-out 0.1s both'
            }}>
            {slides[currentSlide].description}
          </p>
        </div>

        {/* Carousel indicators */}
        <div className="absolute bottom-8 flex gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`h-2 rounded-full transition-all duration-300 ${
                index === currentSlide ? 'bg-white w-6' : 'bg-white bg-opacity-40 w-2'
              }`}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) translateX(0px); }
          25% { transform: translateY(-20px) translateX(10px); }
          50% { transform: translateY(-40px) translateX(-10px); }
          75% { transform: translateY(-20px) translateX(10px); }
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.8; }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
