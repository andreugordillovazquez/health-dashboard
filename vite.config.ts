import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const chunkMap: Record<string, string> = {
  recharts: 'recharts',
  leaflet: 'leaflet',
  'react-leaflet': 'leaflet',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          for (const [pkg, chunk] of Object.entries(chunkMap)) {
            if (id.includes(`node_modules/${pkg}/`)) return chunk
          }
        },
      },
    },
    sourcemap: false,
  },
})
