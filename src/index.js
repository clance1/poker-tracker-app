import React from 'react';
import ReactDOM from 'react-dom/client';
import { IconContext } from '@phosphor-icons/react';
import './index.css';
import App from './App';

// One icon family, one weight, one default size across the whole app.
const iconDefaults = { weight: 'bold', size: 16, mirrored: false };

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <IconContext.Provider value={iconDefaults}>
      <App />
    </IconContext.Provider>
  </React.StrictMode>
);
