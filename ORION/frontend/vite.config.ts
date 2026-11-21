import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: { proxy: { '/backend-api': { target: env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true, rewrite: path => path.replace(/^\/backend-api/, '') } } }
  };
});
