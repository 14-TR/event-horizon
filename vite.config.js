import { defineConfig } from 'vite';

export default defineConfig({
  base: '/event-horizon/',
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
