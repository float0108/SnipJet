import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        settings: resolve(__dirname, 'src/settings.html'),
        reader: resolve(__dirname, 'src/reader.html'),
        expander: resolve(__dirname, 'src/expander.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/\.css$/i.test(assetInfo.name)) {
            return 'assets/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
  },
  server: {
    // Not Vite's default 5173: that port is shared with every other Vite
    // project on the machine. scripts/dev.mjs picks a free port per run and
    // exports it as SNIPJET_DEV_PORT; this is the fallback for `npm run dev`
    // on its own, and tauri.conf.json's devUrl points at the same one.
    port: Number(process.env.SNIPJET_DEV_PORT) || 5180,
    strictPort: true
  }
});
