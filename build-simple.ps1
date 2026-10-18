$ErrorActionPreference = "Stop"
$env:SIMPLE_MODE = "true"
$env:NODE_OPTIONS = "--max-old-space-size=3072"
$env:SITE_URL = "https://bentopdf.opcruz.dev"

$steps = @(
  "node scripts/generate-blog.mjs",
  "node scripts/generate-static-tool-links.mjs",
  "npx tsc",
  "npx vite build",
  "node scripts/enhance-seo-pages.mjs",
  "node scripts/generate-i18n-pages.mjs",
  "node scripts/generate-sitemap.mjs",
  "node scripts/generate-security-headers.mjs",
  "node scripts/seo-audit.mjs",
  "node scripts/split-large-files.mjs"
)

foreach ($s in $steps) {
  Write-Host ">>> $s" -ForegroundColor Cyan
  Invoke-Expression $s
  if ($LASTEXITCODE -ne 0) {
    Write-Host "!!! FAILED ($LASTEXITCODE): $s" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}
Write-Host ">>> BUILD OK" -ForegroundColor Green
