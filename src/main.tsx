import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installAuthFetchInterceptor } from './lib/auth'

// Attach the session token to every /.netlify/functions/* request (covers raw
// fetch() call sites that bypass apiRequest) before the app makes any call.
installAuthFetchInterceptor()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
