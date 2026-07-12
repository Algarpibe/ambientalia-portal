import React from 'react';
import ReactDOM from 'react-dom/client';
// Usa directamente el entry TSX (Vite resuelve .tsx por defecto)
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
