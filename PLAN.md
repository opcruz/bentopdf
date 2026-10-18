# PLAN — Desplegar BentoPDF (versión Simple) en Cloudflare Pages

## Objetivo

Desplegar el sitio **re-clonado** de `alam00000/bentopdf` (v2.8.x) en Cloudflare Pages
(`bentopdf` → `bentopdf-dgg.pages.dev`, dominio futuro `bentopdf.opcruz.dev`) usando
**`SIMPLE_MODE=true`**, que es el mecanismo oficial del repo para la versión self-hosted.

> **Importante:** en este repo **no hay que eliminar/ocultar nada a mano**.
> `SIMPLE_MODE` ya se encarga de todo:
>
> - Usa `simple-index.html` como `index.html` (arranca directo en la grilla de herramientas).
> - Navbar solo con logo (`navbar-simple`), sin botones de navegación.
> - Footer solo logo + `© 2026` + selector de idioma (`footer-simple`), sin links ni "Follow Us".
> - Oculta hero, features, compliance, FAQ, testimonials, ribbon de donación, etc.

## Estado actual

- Repo re-clonado limpio desde `alam00000/bentopdf`, rama `deploy` existente, working tree limpio.
- **No sobrevivió ningún cambio** de la sesión anterior (repo viejo): hay que re-aplicar solo lo mínimo.
- `node_modules`, `wrangler.jsonc`, `public/_headers`, `public/_redirects` **no existen**.
- Node local: v24.21.0 / npm 11.19.0. Wrangler 4.x ya usado con la cuenta correcta.
- Proyecto Pages `bentopdf` **ya existe** en la cuenta (no hay que crearlo de nuevo).

---

## Tareas

### 1. Bugfix mínimo en `src/js/ui.ts` (requerido para SIMPLE_MODE)

`switchView()` accede a `dom.heroSection` / `dom.featuresSection` **sin null-guard**.
En SIMPLE_MODE esos elementos no existen en `simple-index.html` → `TypeError` al volver
de una herramienta a la grilla ("Back to Tools").

- [ ] Agregar guards: `dom.heroSection?.classList...` y `dom.featuresSection?.classList...`
      (líneas ~141, 142, 157, 158). Es el único cambio de código fuente.

### 2. Resolver el problema de los archivos gigantes de LibreOffice (DECISIÓN)

`public/libreoffice-wasm/` contiene archivos que **exceden el límite de 25 MB por archivo
de Cloudflare Pages**:

- `soffice.wasm.gz` → **46.5 MB** ❌
- `soffice.data.gz` → **27.3 MB** ❌

Opciones:

- **A (recomendada):** subir esos 2 archivos a un **R2 bucket público** (cuenta Cloudflare,
  sin costo de egress) y modificar `src/js/utils/libreoffice-loader.ts` para que lea
  `import.meta.env.VITE_LIBREOFFICE_BASE_URL` (fallback al path local). Los 30+ tools de
  conversión Office→PDF siguen funcionando.
- **B (más rápida):** excluir `libreoffice-wasm/` del deploy y pasar
  `DISABLE_TOOLS=<lista de ids Office→PDF>` en el build. Esas herramientas no se muestran.

Nota: el resto de los WASM (pymupdf, ghostscript, cpdf, tesseract) se descargan de
jsDelivr por defecto → sin problema.

### 3. Archivos de configuración para Pages

- [ ] `public/_headers` (contenido según `docs/self-hosting/cloudflare.md`):
  - `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
    - `Cross-Origin-Resource-Policy: cross-origin` en `/*` → **requeridos** para
      `SharedArrayBuffer` (LibreOffice WASM).
  - Caché immutable para `/*.wasm`, `no-cache` para `/sw.js`.
  - Reglas de `Content-Encoding` para los `.gz` solo si la opción A mantiene esos archivos en Pages.
- [ ] `wrangler.jsonc` mínimo con `"pages_build_output_dir": "dist"` (**sin** campo `assets`,
      rompe la validación de Pages).
- [ ] **No** crear `_redirects` con catch-all `/* /index.html 200`: este repo es **multipágina**
      (un `.html` real por herramienta + páginas i18n por idioma). Pages sirve `merge-pdf.html`
      en `/merge-pdf` nativamente; el catch-all rompería todas las rutas. `404.html` ya existe.

### 4. Instalación y build (Windows)

- [ ] `npm install`
- [ ] Build con SIMPLE_MODE. Ojo con Windows:
  - `SIMPLE_MODE=true npm run build` (script `serve:simple`) **no funciona en cmd/PowerShell**.
  - Usar PowerShell: `$env:SIMPLE_MODE="true"; npm run build`
  - El script de build usa `NODE_OPTIONS='--max-old-space-size=3072' node ...` (sintaxis Unix).
    Si falla en Windows: `$env:NODE_OPTIONS="--max-old-space-size=3072"` antes del build
    o correr los pasos manualmente (`generate-blog` → `generate-static-tool-links` → `tsc`
    → `vite build` → `enhance-seo-pages` → `generate-i18n-pages` → `generate-sitemap` →
    `generate-security-headers` → `seo-audit`).

### 5. Verificación del `dist/` antes de subir

- [ ] `dist/index.html` es el simple (arranca en "PDF Tools" / grilla, sin hero).
- [ ] Footer muestra `© 2026` y sin links sociales.
- [ ] Ningún archivo > 25 MB en `dist/` (`Get-ChildItem -Recurse dist | Where {$_.Length -gt 25MB}`).
- [ ] `dist/_headers` presente (se copia desde `public/`).

### 6. Deploy

```powershell
npm run build   # con $env:SIMPLE_MODE="true"
npx wrangler pages deploy dist --project-name=bentopdf --branch=main
```

- Si aparece el error de validación "does not support assets": borrar `dist/wrangler.json`
  (no debe generarse; el plugin de Cloudflare ya NO está en `vite.config.ts`).

### 7. Commit

- [ ] Commit de los cambios (`ui.ts` + `public/_headers` + `wrangler.jsonc` [+ loader si opción A])
      en la rama `deploy`. **Sin push** a origin (repo ajeno).

### 8. Pendiente manual (dashboard Cloudflare)

- [ ] Agregar dominio custom `bentopdf.opcruz.dev` en Workers & Pages → `bentopdf` →
      Custom domains (no se puede hacer desde wrangler).

---

## Activación / prueba local de SIMPLE_MODE

```powershell
$env:SIMPLE_MODE="true"
npm run dev          # o: npm run preview tras build
```

En Windows, `npm run serve:simple` NO funciona (sintaxis Unix de env vars); usar la
secuencia de arriba.

## Riesgos conocidos

| Riesgo                                        | Impacto                              | Mitigación                                               |
| --------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Archivos LibreOffice > 25 MB                  | Falla el deploy completo             | Opción A (R2) o B (DISABLE_TOOLS)                        |
| `switchView` sin null-guards                  | Rompe "Back to Tools" en simple      | Tarea 1                                                  |
| `tsc` en build completo                       | Puede fallar si hay errores de tipos | Corregir o usar build solo Vite si persiste              |
| Service worker (`sw.js`) cachea versión vieja | Usuarios ven build anterior          | Recargar con Ctrl+F5; el repo ya maneja versión de caché |
