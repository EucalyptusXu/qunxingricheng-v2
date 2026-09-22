import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// HashRouter：纯静态部署（如 GitHub Pages）下也能正常路由
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
