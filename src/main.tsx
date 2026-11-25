import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@patternfly/react-core/dist/styles/base.css'
import './index.css'
import App from './App'
import { ThemeProvider, initTheme } from './lib/theme'

// Applied before the first React render to avoid a light-theme flash.
initTheme()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('PriceTag UI startup failed: #root element is missing from index.html')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
