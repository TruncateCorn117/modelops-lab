import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const configuredBase = loadEnv(mode, ".", "VITE_").VITE_BASE_PATH || "/";
  const basePath = configuredBase.replace(/^\/+|\/+$/g, "");
  const base = basePath ? `/${basePath}/` : "/";
  return {
    base,
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "assets/modelops-[name]-[hash].js",
          chunkFileNames: "assets/modelops-[name]-[hash].js",
          assetFileNames: "assets/modelops-[name]-[hash][extname]",
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        [`${base}api`]: {
          target: "http://127.0.0.1:8000",
          rewrite: (path) => `/${path.slice(base.length)}`,
        },
        [`${base}metrics`]: {
          target: "http://127.0.0.1:8000",
          rewrite: (path) => `/${path.slice(base.length)}`,
        },
      },
    },
  };
});
