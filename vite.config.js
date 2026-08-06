import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
  },

  plugins: [
    VitePWA({
      registerType: "autoUpdate",

      injectRegister: "auto",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],

      manifest: {
        name: "Mafia Game",
        short_name: "Mafia",

        description: "لعبة مافيا عربية لإدارة اللاعبين والأدوار والجولات.",

        lang: "ar",
        dir: "rtl",

        start_url: "/",
        scope: "/",

        display: "standalone",
        orientation: "portrait",

        background_color: "#09090d",
        theme_color: "#09090d",

        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
{
  src: "/pwa-512x512.png",
  sizes: "512x512",
  type: "image/png",
  purpose: "maskable",
},
        ],
      },

workbox: {
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  
  cleanupOutdatedCaches: true,

  skipWaiting: true,

  clientsClaim: true,

  globPatterns: [
    "**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2}",
  ],
},      devOptions: {
        enabled: true,
      },
    }),
  ],
});