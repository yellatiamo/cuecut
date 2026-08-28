const { defineConfig } = require('vite');
const { attachExportApi } = require('./server/ffmpeg-api.js');

module.exports = defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    host: true,
    strictPort: false,
  },
  preview: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'cuecut-export-api',
      configureServer(server) {
        attachExportApi(server.middlewares);
      },
      configurePreviewServer(server) {
        attachExportApi(server.middlewares);
      },
    },
  ],
});
