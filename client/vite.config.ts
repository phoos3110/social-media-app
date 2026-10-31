import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4180',
      '/uploads': 'http://127.0.0.1:4180',
      '/socket.io': { target: 'http://127.0.0.1:4180', ws: true },
    },
  },
});
