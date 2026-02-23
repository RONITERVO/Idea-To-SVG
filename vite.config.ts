import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const buildTarget = process.env.BUILD_TARGET ?? env.BUILD_TARGET;
    const isCapacitor = buildTarget === 'capacitor';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      base: isCapacitor ? '/' : '/Idea-To-SVG/',
      define: {
        // Only include dev fallback in development mode
        ...(mode === 'development' && env.GEMINI_API_KEY ? {
          'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
        } : {})
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
