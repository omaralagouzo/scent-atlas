// The private admin dashboard: a second Vite entry (admin.html) sharing the site's design system.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import './admin.css'
import { AdminApp } from './app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
)
