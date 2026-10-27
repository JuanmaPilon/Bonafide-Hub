import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3001";
  // URL pública del hub para las meta de compartir. `og:image` tiene que ser
  // absoluta (los scrapers no resuelven rutas relativas) y Vite deja el
  // placeholder literal si la variable no existe, así que el default vive acá:
  // es el dominio de producción, el mismo que ya está en `allowedHosts`.
  const siteUrl = (env.VITE_SITE_URL ?? "https://bonafide-cum.com").replace(
    /\/$/,
    "",
  );

  return {
    plugins: [
      react(),
      {
        name: "site-url-meta",
        transformIndexHtml(html) {
          return html.replace(/%VITE_SITE_URL%/g, siteUrl);
        },
      },
    ],
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
