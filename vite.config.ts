import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [],
  server: {
    // PORT definido (ex.: pré-visualização do Claude): usa essa porta e não abre outro browser
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    open: !process.env.PORT,
  },
  build: {
    outDir: "dist",
  },
});
