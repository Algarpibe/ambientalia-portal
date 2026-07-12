import { useState, useEffect } from 'react';
import AuthCard from '../components/Auth/AuthCard';

export default function Auth() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Trigger fade-in animation on mount
    setIsLoaded(true);
  }, []);

  return (
    <div className={`min-h-screen w-full flex items-center justify-center transition-opacity duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      style={{
        background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8787 25%, #ffa5a5 50%, #ffb3b3 75%, #ffc5c5 100%)',
        backgroundAttachment: 'fixed'
      }}>
      <div className="w-full max-w-4xl mx-auto px-4 py-8">
        <AuthCard />
      </div>
    </div>
  );
}
