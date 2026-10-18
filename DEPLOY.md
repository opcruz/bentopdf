# DEPLOY — BentoPDF en Cloudflare Pages (bentopdf.opcruz.dev)

Guía completa para construir y desplegar BentoPDF en modo simple sobre
Cloudflare Pages, incluyendo la solución al límite de 25 MiB por archivo.

---

## Requisitos

- Node.js 20+ y npm
- PowerShell (el build usa un script `.ps1` porque npm no puede ejecutar
  `NODE_OPTIONS='...'` estilo Unix en Windows)
- Cuenta de Cloudflare con el proyecto Pages **`bentopdf`** creada
- Wrangler instalado como dependencia local (ya incluido en `package.json`)

Autenticación de Wrangler (una sola vez):

```powershell
npx wrangler login
```

---

## Comandos rápidos

| Acción                                    | Comando                                |
| ----------------------------------------- | -------------------------------------- |
| Build completo (simple + dominio + split) | `npm run build:simple`                 |
| Deploy a Cloudflare Pages                 | `npm run deploy`                       |
| Build + deploy en un solo paso            | `npm run build:simple; npm run deploy` |

---

## Cómo funciona el build (`build-simple.ps1`)

El script ejecuta 10 pasos en orden, definiendo dos variables de entorno
claves:

- `SIMPLE_MODE=true` → usa `simple-index.html` como inicio (solo logo y
  grid de herramientas; oculta marketing/features/FAQ vía el mecanismo
  oficial del repo). No se elimina nada manualmente.
- `SITE_URL=https://bentopdf.opcruz.dev` → canonicals, hreflang, og:url,
  robots.txt y sitemap.xml apuntan a tu dominio.

Pasos:

1. `node scripts/generate-blog.mjs` — genera el blog (respeta `SITE_URL`)
2. Tool links — regenera `src/partials/tool-links-static.html`
3. `npx tsc` — chequeo de tipos TypeScript
4. `npx vite build` — build de Vite → `dist/` (incluye gzip/brotli)
5. `node scripts/enhance-seo-pages.mjs` — inyecta FAQ/schema
6. `node scripts/generate-i18n-pages.mjs` — 2940 páginas en 22 idiomas
7. `node scripts/generate-sitemap.mjs` — sitemap multilingüe
8. `node scripts/generate-security-headers.mjs` — CSP local (nginx/Apache)
9. `node scripts/seo-audit.mjs` — valida canonicals y sitemap (**falla el build** si hay dominio incorrecto)
10. `node scripts/split-large-files.mjs` — parte los archivos >24 MiB

---

## El split de archivos grandes (límite 25 MiB de Pages)

### El problema

Cloudflare Pages no acepta archivos de más de 25 MiB. LibreOffice WASM
incluye dos archivos comprimidos más grandes que ese límite:

| Archivo                            | Tamaño  |
| ---------------------------------- | ------- |
| `libreoffice-wasm/soffice.data.gz` | 27.3 MB |
| `libreoffice-wasm/soffice.wasm.gz` | 46.5 MB |

### La solución (Opción C: dividir en chunks + manifest)

**En el build** — `scripts/split-large-files.mjs`:

- Recorre `dist/` y busca archivos >24 MiB
- Los parte en trozos de 16 MB numerados: `soffice.wasm.gz` →
  `soffice.wasm.gz.001`, `.002`, `.003`
- Borra el archivo original (solo en `dist/`, nunca en el repo)
- Escribe `dist/libreoffice-wasm/chunks.json` con el número exacto de
  partes de cada archivo:

```json
{
  "soffice.data.gz": 2,
  "soffice.wasm.gz": 3
}
```

```
dist/libreoffice-wasm/
├── chunks.json
├── soffice.data.gz.001   16.0 MB
├── soffice.data.gz.002   11.3 MB
├── soffice.wasm.gz.001   16.0 MB
├── soffice.wasm.gz.002   16.0 MB
└── soffice.wasm.gz.003   14.5 MB
```

**En el navegador** — `src/js/utils/libreoffice-loader.ts`
(función `fetchMaybeChunked`):

1. Lee `chunks.json` (una sola petición pequeña, cacheada 5 min)
2. Si el archivo está listado con N partes → descarga los N chunks
   **en paralelo** (`Promise.all`), concatena en orden
3. Si el manifest está vacío/ausente o el archivo no está listado
   (Docker, VPS, local) → descarga el archivo completo tal cual
4. Si los 2 primeros bytes son magic gzip (`1f 8b`), descomprime con
   `DecompressionStream('gzip')`
5. Crea el object URL y se lo pasa a LibreOffice

**Sin peticiones 404**: el manifest dice exactamente cuántos chunks hay.
Si un chunk falla de verdad, el error es claro
(`Failed to fetch chunk 2/3 of soffice.wasm.gz: HTTP 500`).

Esto es compatible con cualquier otro hosting: si el manifest no lista el
archivo, se usa el completo y los chunks se ignoran.

### Headers especiales (`public/_headers`)

Los chunks **NO** se sirven con `Content-Encoding: gzip` (son cortes de
bytes crudos de un gzip; si el navegador intentara descomprimir cada trozo
por separado fallaría). El loader concatena todo y descomprime una sola
vez. Por eso `_headers` define:

```
/libreoffice-wasm/*.gz.*
  Content-Type: application/octet-stream
  Cache-Control: public, max-age=31536000, immutable
```

Además aplica COOP/COEP/CORP (necesarios para WASM multi-thread) y
`Cache-Control: no-cache` para `sw.js`.

---

## Cómo verificar que funciona

### 1. Verificación local de los chunks (PowerShell)

Tras un build, comprueba que no quede ningún archivo >25 MiB:

```powershell
# Debe devolver vacío
Get-ChildItem dist -Recurse -File | Where-Object { $_.Length -gt 25MB }

# Debe mostrar los 5 chunks
Get-ChildItem dist\libreoffice-wasm -Filter "*.gz.*"
```

### 2. Verificación en el sitio desplegado

Sustituye `BASE` por la URL del deploy (la que imprime wrangler) o por
`https://bentopdf.opcruz.dev` tras añadir el dominio:

```powershell
$BASE = "https://e187c740.bentopdf-dgg.pages.dev"

# Los 5 chunks deben dar 200
foreach ($f in @("soffice.data.gz.001","soffice.data.gz.002","soffice.wasm.gz.001","soffice.wasm.gz.002","soffice.wasm.gz.003")) {
  try {
    $r = Invoke-WebRequest "$BASE/libreoffice-wasm/$f" -Method Head -UseBasicParsing
    Write-Host "$f -> $($r.StatusCode) OK"
  } catch { Write-Host "$f -> FALLO" }
}

# El manifest debe listar los conteos correctos (sin 404s en runtime)
(Invoke-WebRequest "$BASE/libreoffice-wasm/chunks.json" -UseBasicParsing).Content
# Esperado: {"soffice.data.gz":2,"soffice.wasm.gz":3}

# En Pages los archivos originales dan 404 (ya no se piden: el manifest los evita)
foreach ($f in @("soffice.data.gz","soffice.wasm.gz")) {
  try {
    Invoke-WebRequest "$BASE/libreoffice-wasm/$f" -Method Head -UseBasicParsing | Out-Null
    Write-Host "$f -> 200 (NO esperado en Pages)"
  } catch { Write-Host "$f -> 404 (esperado: solo existen los chunks)" }
}

# SEO: canonical, robots y sitemap deben usar tu dominio
(Invoke-WebRequest "$BASE/" -UseBasicParsing).Content | Select-String 'rel="canonical"'
(Invoke-WebRequest "$BASE/robots.txt" -UseBasicParsing).Content | Select-String 'Sitemap'
(Invoke-WebRequest "$BASE/sitemap.xml" -UseBasicParsing).Content -split "`n" | Select-String '<loc>' | Select-Object -First 3
```

### 3. Prueba de reensamblaje (simula lo que hace el navegador)

Descarga los chunks, concaténalos y verifica que el gzip resultante sea
válido:

```powershell
$BASE = "https://e187c740.bentopdf-dgg.pages.dev/libreoffice-wasm"
$ms = New-Object System.IO.MemoryStream
$i = 1
while ($true) {
  try {
    $resp = Invoke-WebRequest "$BASE/soffice.wasm.gz.$('{0:D3}' -f $i)" -UseBasicParsing
    $bytes = $resp.Content
    $ms.Write($bytes, 0, $bytes.Length)
    Write-Host "chunk $i OK ($([math]::Round($bytes.Length/1MB,1)) MB)"
    $i++
  } catch { break }
}
$all = $ms.ToArray(); $ms.Dispose()
Write-Host "Reensamblado: $([math]::Round($all.Length/1MB,1)) MB (esperado 46.5)"

# Descomprimir y validar magic bytes del WASM (\0asm = 00 61 73 6D)
$ms2 = New-Object System.IO.MemoryStream(,$all)
$gz = New-Object System.IO.Compression.GzipStream($ms2, [System.IO.Compression.CompressionMode]::Decompress)
$buf = New-Object byte[] 8
$null = $gz.Read($buf, 0, 8)
Write-Host "Magic: $(($buf | ForEach-Object { $_.ToString('X2') }) -join ' ')  (WASM válido = 00 61 73 6D)"
$gz.Dispose(); $ms2.Dispose()
```

Resultado esperado: `46.5 MB` reensamblados y magic `00 61 73 6D`.

### 4. Prueba funcional en el navegador (la definitiva)

1. Abre una herramienta Office→PDF (ej. `https://bentopdf.opcruz.dev/word-to-pdf`)
2. Abre DevTools → pestaña **Network**
3. Sube un `.docx` y conviértelo
4. Debes ver: `chunks.json` (200) + 3 chunks de wasm y 2 de data (todos 200,
   varios en paralelo) — **sin peticiones 404**
5. La conversión debe completarse y generar el PDF

---

## Deploy paso a paso

```powershell
# 1. Build (SIMPLE_MODE + SITE_URL + split)
npm run build:simple

# 2. Subir a Cloudflare Pages (rama main del proyecto "bentopdf")
npm run deploy

# 3. Wrangler imprime la URL del deploy, p.ej.:
#    https://e187c740.bentopdf-dgg.pages.dev
```

No hacer push a `origin`: el repo upstream (`alam00000/bentopdf`) no es
nuestro. Los cambios viven en la rama local `deploy`.

### Dominio personalizado (una vez, en el dashboard)

1. Cloudflare Dashboard → **Workers & Pages** → `bentopdf`
2. **Custom domains** → **Set up custom domain**
3. Añadir `bentopdf.opcruz.dev`
4. Si el zona `opcruz.dev` está en tu cuenta, el CNAME se crea solo

Tras esto, verifica los 3 pasos anteriores contra `https://bentopdf.opcruz.dev`.

---

## Solución de problemas

| Síntoma                                                         | Causa / solución                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy falla: _"Pages only supports files up to 25 MiB"_        | El paso `split-large-files.mjs` no corrió (build interrumpido antes). Re-ejecuta `node scripts/split-large-files.mjs` con `dist/` completo.         |
| `seo-audit` falla con canonical incorrecto                      | Algún HTML tiene el dominio viejo. Comprueba `SITE_URL` en el entorno y busca `bentopdf.com` hardcodeado en `public/`, `blog/` o scripts.           |
| `npm run build` falla con `NODE_OPTIONS`                        | En Windows usa siempre `npm run build:simple` (PowerShell), no `npm run build`.                                                                     |
| Conversión Office→PDF se queda cargando                         | Mira la consola del navegador: si `chunks.json` falla o un chunk da error, revisa que `_headers` no sirva los `.gz.*` con `Content-Encoding: gzip`. |
| Aviso _"working directory has uncommitted changes"_ al deployar | Inofensivo. Para silenciarlo: `npx wrangler pages deploy dist --project-name=bentopdf --branch=main --commit-dirty=true`.                           |

---

## Archivos tocados respecto al upstream

| Archivo                               | Cambio                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| `build-simple.ps1`                    | Nuevo — orquesta el build (SIMPLE_MODE, SITE_URL, split)           |
| `scripts/split-large-files.mjs`       | Nuevo — divide archivos >24 MiB y escribe `chunks.json`            |
| `src/js/utils/libreoffice-loader.ts`  | `fetchMaybeChunked()` — lee `chunks.json`, baja chunks en paralelo |
| `public/libreoffice-wasm/chunks.json` | Nuevo — manifest vacío `{}` por defecto (dev/Docker)               |
| `public/_headers`                     | Nuevo — COOP/COEP/CORP, cache, headers de chunks                   |
| `public/robots.txt`                   | Dominio → `bentopdf.opcruz.dev`                                    |
| `blog/author-alam.html`               | URLs hardcodeadas → `bentopdf.opcruz.dev`                          |
| `scripts/generate-blog.mjs`           | Lee `SITE_URL` del env (antes hardcodeado)                         |
| `wrangler.jsonc`                      | Nuevo — `pages_build_output_dir: "dist"`                           |
| `package.json`                        | `wrangler` (devDep), scripts `build:simple` y `deploy`             |
| `TODO.md`, `PLAN.md`                  | Documentación del proyecto                                         |
