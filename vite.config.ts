import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ninaHost = env.NINA_HOST || 'Starrunner.local';
  const ninaPort = env.NINA_PORT || '1888';
  const stellariumHost = env.STELLARIUM_HOST || '127.0.0.1';
  const stellariumPort = env.STELLARIUM_PORT || '8090';
  const ninaTarget = `http://${ninaHost}:${ninaPort}`;
  const ninaWsTarget = `ws://${ninaHost}:${ninaPort}`;
  const stellariumTarget = `http://${stellariumHost}:${stellariumPort}`;

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/nina-api': {
          target: ninaTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/nina-api/, '/v2/api')
        },
        '/nina-ws': {
          target: ninaWsTarget,
          ws: true,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/nina-ws/, '/v2/socket')
        },
        '/nina-tppa': {
          target: ninaWsTarget,
          ws: true,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/nina-tppa/, '/v2/tppa')
        },
        '/stellarium-api': {
          target: stellariumTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/stellarium-api/, '/api')
        }
      }
    }
  };
});
