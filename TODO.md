# TODO — Deploy BentoPDF Simple a Cloudflare Pages

Leyenda: ✅ completado / 🔄 en progreso / ⬜ pendiente / ⏸️ omitido / ❌ falló

- ✅ Crear TODO.md
- ✅ Crear `public/_headers` (COOP/COEP + caché + reglas para chunks de LibreOffice)
- ✅ Crear `wrangler.jsonc` (`pages_build_output_dir: "dist"`)
- ✅ `npm install` (881 paquetes)
- ✅ `npm install -D wrangler` + scripts `build:simple` y `deploy` en package.json
- ✅ Build #1 con `SIMPLE_MODE=true` (BUILD OK, 3083 HTML)
- ❌ Deploy #1: **FALLÓ** — "Pages only supports files up to 25 MiB" (soffice.data.gz / soffice.wasm.gz)
- ✅ **Decidido: Opción C — Split** (la que sugiere la docs oficial)
- ✅ Crear `scripts/split-large-files.mjs` (parte >24MB en chunks de 16MB en dist/)
- ✅ Patch `src/js/utils/libreoffice-loader.ts` (fallback a chunks `.001`... en 404, concatena y descomprime)
- ✅ `SITE_URL=https://bentopdf.opcruz.dev` en `build-simple.ps1` (canonicals, hreflang, sitemap, og:url)
- ✅ Fix hardcodeado: `public/robots.txt` → bentopdf.opcruz.dev
- ✅ Fix hardcodeado: `scripts/generate-blog.mjs` ahora lee `SITE_URL` del env
- ✅ Build #2 (con SITE_URL) — falló solo `seo-audit` por `blog/author-alam.html` (archivo estático con dominio viejo)
- ✅ Fix hardcodeado: `blog/author-alam.html` → bentopdf.opcruz.dev (5 URLs, fuente + dist)
- ✅ `seo-audit.mjs` pasó (3083 HTML OK, sitemap limpio) + `split-large-files.mjs` (data→2 chunks, wasm→3 chunks)
- ✅ Verificar dist/: 0 archivos >25MB, chunks < 16MB, canonical/hreflang/robots/sitemap = bentopdf.opcruz.dev, `_headers` OK
- ✅ Deploy #2: `npm run deploy` — **EXITOSO** (4860 archivos, 28.56s) → https://e187c740.bentopdf-dgg.pages.dev
- ✅ Probar sitio online: index simple OK, robots/sitemap/canonical = bentopdf.opcruz.dev, 5 chunks 200 OK con COOP/COEP,
  originales .gz dan 404 (fallback activo), reensamblaje validado (wasm 140.6MB \0asm, data 95.1MB PK — gzip válido)
- ✅ Commit `3bac7b3` en rama `deploy` (sin push, repo ajeno)
- ✅ Commit `14448a4`: DEPLOY.md (guía completa)
- 🔄 Mejora: manifest `chunks.json` (el usuario no quiere 404s en consola) - `split-large-files.mjs` escribe `chunks.json` con conteos exactos - `libreoffice-loader.ts` lee manifest y baja chunks **en paralelo** (sin probing 404) - `public/libreoffice-wasm/chunks.json` = `{}` por defecto (dev/Docker usa archivo intacto) - `_headers`: chunks.json con cache 5 min
- 🔄 Build #3 OK (manifest: {"soffice.data.gz":2,"soffice.wasm.gz":3}) + Deploy #3 corriendo
- ⬜ Verificar manifest + chunks en vivo (sin 404s)
- ⬜ Commit manifest + DEPLOY.md updates
- ⬜ Manual (dashboard): dominio custom `bentopdf.opcruz.dev`

Omitido a pedido:

- ⏸️ Bugfix null-guards en `src/js/ui.ts` (`switchView` accede a heroSection/featuresSection
  que no existen en simple mode — puede romper "Back to Tools"; se omite por ahora)
