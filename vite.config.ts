import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Logger, type Plugin } from "vite";
import { numerosApresentacao } from "./src/data/numeros.ts";

/** Manifest gerado por scripts/pro_to_web.py: a fonte única dos números do concelho. */
const MANIFEST = fileURLToPath(new URL("./src/data/dourorisk-grids.json", import.meta.url));
/** Par de marcadores no HTML: <!--n:chave-->valor de reserva<!--/n--> */
const MARCA = /<!--n:([a-z0-9_]+)-->([\s\S]*?)<!--\/n-->/g;
const norm = (s: string) => s.replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

/**
 * Números do concelho no HTML (apresentação e passo Compara), lidos do manifest em dev e no build.
 * Rebenta com chave desconhecida, marcador sem fecho ou manifest sem o bloco "concelho"; avisa se o
 * valor de reserva escrito no HTML já não é o do manifest (para o atualizar).
 */
function numerosDoManifest(): Plugin {
  let logger: Logger | undefined;
  return {
    name: "numeros-do-manifest",
    configResolved(c) {
      logger = c.logger;
    },
    configureServer(server) {
      // a apresentação não importa o manifest: sem isto não recarregava depois de o pipeline correr
      server.watcher.on("change", (f) => {
        if (path.resolve(f) === path.resolve(MANIFEST)) server.ws.send({ type: "full-reload" });
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!html.includes("<!--n:")) return html;
        const v = numerosApresentacao(JSON.parse(readFileSync(MANIFEST, "utf8")));
        const out = html.replace(MARCA, (_m, k: string, antes: string) => {
          // só chaves próprias: "constructor" ou "__proto__" passam no regex e existem em qualquer objeto
          if (!Object.prototype.hasOwnProperty.call(v, k)) throw new Error(`[numeros] ${ctx.path}: marcador desconhecido "${k}" (ver src/data/numeros.ts)`);
          // um marcador sem fecho seguido de outro par: o regex junta-os, e o marcador de dentro desaparecia
          if (antes.includes("<!--n:")) throw new Error(`[numeros] ${ctx.path}: marcador "${k}" sem <!--/n-->`);
          if (antes.trim() && norm(antes) !== norm(v[k])) logger?.warn(`[numeros] ${ctx.path}: ${k} está "${antes}" no HTML; o manifest dá "${v[k]}"`);
          return v[k];
        });
        if (out.includes("<!--n:")) throw new Error(`[numeros] ${ctx.path}: marcador sem <!--/n-->`);
        return out;
      },
    },
  };
}

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
    numerosDoManifest(),
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
