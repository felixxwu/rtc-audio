import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  // HTTPS in dev so mediaDevices (a secure-context API) exists when the
  // dev server is opened via LAN IP instead of localhost.
  plugins: [react(), basicSsl()],
  // ES-module workers so the FLAC encoder worker can code-split its libflacjs
  // import (the default 'iife' format forbids code-splitting).
  worker: { format: 'es' },
})
