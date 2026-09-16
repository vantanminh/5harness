import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_FIREBASE_API_URL || "http://127.0.0.1:5001";
  const proxyToken = env.FIREBASE_PROXY_TOKEN;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          headers: proxyToken ? { "X-Harness-Proxy": proxyToken } : undefined,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
