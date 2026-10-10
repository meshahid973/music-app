import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Vite's default host is localhost. Do not expose the dev server to the
    // local network unless a developer explicitly opts in via the CLI.
    port: 3000,
  },
})
