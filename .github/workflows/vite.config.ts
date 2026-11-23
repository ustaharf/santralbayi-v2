import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

const BUILD_TIMESTAMP = Date.now();

export default defineConfig(({ command }) => {
  return {
    base: command === 'build' ? './' : '/',
    define: {
      __APP_BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'write-build-meta',
        closeBundle() {
          if (command === 'build') {
            try {
              const distDir = path.resolve(__dirname, 'dist');
              fs.mkdirSync(distDir, { recursive: true });
              fs.writeFileSync(
                path.join(distDir, 'build-meta.json'),
                JSON.stringify({ buildTime: BUILD_TIMESTAMP })
              );
            } catch {}
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    esbuild: {
      charset: 'utf8',
      legalComments: 'none',
    },
    build: {
      sourcemap: false,
      cssCodeSplit: false,
    },
  };
});
