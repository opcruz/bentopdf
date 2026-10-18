#!/usr/bin/env node
/**
 * Split large files in dist/ into numbered chunks so every uploaded file
 * stays under Cloudflare Pages' 25 MiB per-file limit.
 *
 *   soffice.wasm.gz -> soffice.wasm.gz.001, soffice.wasm.gz.002, ...
 *
 * The original file is removed after splitting. The browser reassembles the
 * chunks at runtime (src/js/utils/libreoffice-loader.ts tries the intact
 * file first and falls back to chunks on 404), so local/Docker deployments
 * that keep the intact files keep working unchanged.
 */
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const MAX_BYTES = 24 * 1024 * 1024; // 24 MiB — safely below Pages' 25 MiB limit
const CHUNK_BYTES = 16 * 1024 * 1024; // 16 MiB chunks

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let splitCount = 0;
// Chunk counts per directory, written as chunks.json next to the split
// files so the loader knows exactly how many parts to fetch (no 404 probing).
const manifests = new Map();

for (const file of walk(DIST)) {
  const { size } = statSync(file);
  if (size <= MAX_BYTES) continue;

  const buffer = readFileSync(file);
  const total = Math.ceil(buffer.length / CHUNK_BYTES);
  for (let i = 0; i < total; i++) {
    const part = buffer.subarray(
      i * CHUNK_BYTES,
      Math.min((i + 1) * CHUNK_BYTES, buffer.length)
    );
    const chunkPath = `${file}.${String(i + 1).padStart(3, '0')}`;
    writeFileSync(chunkPath, part);
    console.log(
      `  ${relative(DIST, chunkPath)} (${(part.length / 1024 / 1024).toFixed(1)} MB)`
    );
  }
  unlinkSync(file);
  const dir = dirname(file);
  if (!manifests.has(dir)) manifests.set(dir, {});
  manifests.get(dir)[basename(file)] = total;
  console.log(
    `split: ${relative(DIST, file)} (${(size / 1024 / 1024).toFixed(1)} MB) -> ${total} chunks (original removed)`
  );
  splitCount++;
}

for (const [dir, entries] of manifests) {
  writeFileSync(join(dir, 'chunks.json'), JSON.stringify(entries, null, 2));
  console.log(
    `[split-large-files] wrote ${relative(DIST, join(dir, 'chunks.json'))}: ${JSON.stringify(entries)}`
  );
}

console.log(
  splitCount
    ? `[split-large-files] ${splitCount} file(s) split`
    : '[split-large-files] no files above 24 MiB'
);
