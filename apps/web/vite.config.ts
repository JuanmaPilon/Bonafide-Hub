import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3001";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          target: apiTarget,
        },
      },
    },
    preview: {
      allowedHosts: [
        ".railway.app",
        "bonafide-cum.com",
        ".bonafide-cum.com",
        "localhost",
        "127.0.0.1",
      ],
      proxy: {
        "/api": {
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          target: apiTarget,
        },
      },
    },
  };
});
