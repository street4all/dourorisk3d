import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {
      name: "mapa-redirect",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/mapa") {
            req.url = "/mapa/";
          }
          next();
        });
      },
    },
  ],
  server: {
    // PORT definido (ex.: pré-visualização do Claude): usa essa porta e não abre outro browser
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    open: !process.env.PORT,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        mapa: fileURLToPath(new URL("./mapa/index.html", import.meta.url)),
      },
    },
  },
});
