import { defineConfig } from 'vite';
import { vitePluginSwc } from 'vite-plugin-swc';

export default defineConfig({
  plugins: [
    vitePluginSwc({
      // Use experimental decorators for Lit compatibility
      decorator: {
        legacy: true,
        metadata: false,
      },
    }),
  ],
  base: '/_litro/',
  esbuild: {
    // Force experimental decorators for Lit compatibility
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    conditions: ['source', 'browser', 'module', 'import', 'default'],
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: 'app.ts',
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
