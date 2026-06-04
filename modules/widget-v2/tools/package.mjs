#!/usr/bin/env node
/**
 * Package the CROWDAQ Widget v2 into a CMS-installable module XML + zip.
 *
 * Steps:
 *   1. read the built bundle (dist/crowdaq-widget-v2.global.js — run `npm run
 *      build` first; this script also runs it when --build is passed);
 *   2. read the module XML template (modules/crowdaq-widget-v2.xml);
 *   3. replace the `__CROWDAQ_WIDGET_V2_BUNDLE__` marker inside <onRender> with
 *      the bundle source (so the IIFE is inlined and self-contained);
 *   4. write the packaged XML to build/crowdaq-widget-v2.packaged.xml;
 *   5. zip it into build/crowdaq-widget-v2-<sha7>.zip (the artifact the CMS
 *      custom-module import consumes).
 *
 * The zip layout mirrors the v1 plugin: a single module XML at the zip root.
 * Run from modules/widget-v2:  node tools/package.mjs [--build]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url)); // modules/widget-v2/tools
const widgetRoot = resolve(here, '..'); // modules/widget-v2
const repoRoot = resolve(widgetRoot, '..', '..'); // xibo-plugin

const BUNDLE = resolve(widgetRoot, 'dist', 'crowdaq-widget-v2.global.js');
const XML_TEMPLATE = resolve(repoRoot, 'modules', 'crowdaq-widget-v2.xml');
const BUILD_DIR = resolve(repoRoot, 'build');
const MARKER = '/* __CROWDAQ_WIDGET_V2_BUNDLE__ */';

// Always re-assemble the <style> blocks from the CSS sources first, so the
// packaged XML carries the current broadcast design (fonts + broadcast.css)
// and never a stale hand-edited block (S9).
console.log('[package] assembling styles…');
execSync('node tools/assemble-styles.mjs', { cwd: widgetRoot, stdio: 'inherit' });

if (process.argv.includes('--build') || !existsSync(BUNDLE)) {
  console.log('[package] building bundle…');
  execSync('npm run build', { cwd: widgetRoot, stdio: 'inherit' });
}

const bundle = readFileSync(BUNDLE, 'utf8');
const xml = readFileSync(XML_TEMPLATE, 'utf8');

if (!xml.includes(MARKER)) {
  console.error(`[package] ERROR: marker ${MARKER} not found in ${XML_TEMPLATE}`);
  process.exit(1);
}

// The bundle is JS going INTO a CDATA section. CDATA cannot contain the
// literal sequence "]]>"; the minified bundle has no XML, but guard anyway by
// splitting any accidental "]]>" across the CDATA boundary.
const safeBundle = bundle.replaceAll(']]>', ']]]]><![CDATA[>');

const packaged = xml.replace(MARKER, safeBundle);

mkdirSync(BUILD_DIR, { recursive: true });
const sha = createHash('sha256').update(packaged).digest('hex');
const sha7 = sha.slice(0, 7);

const packagedXmlPath = resolve(BUILD_DIR, 'crowdaq-widget-v2.packaged.xml');
writeFileSync(packagedXmlPath, packaged, 'utf8');

// Zip the packaged XML at the zip root. Use the system `zip` where available,
// else fall back to a minimal store-only zip writer (no external dep).
const zipPath = resolve(BUILD_DIR, `crowdaq-widget-v2-${sha7}.zip`);
writeZipSingleFile(zipPath, 'crowdaq-widget-v2.xml', packaged);

const bundleSha = createHash('sha256').update(bundle).digest('hex');
console.log('[package] done');
console.log(`  bundle:        ${BUNDLE} (${bundle.length} bytes, sha256 ${bundleSha})`);
console.log(`  packaged XML:  ${packagedXmlPath} (${packaged.length} bytes)`);
console.log(`  zip:           ${zipPath}`);
console.log(`  packaged sha7: ${sha7}`);

/**
 * Minimal store-only (no compression) ZIP writer for a single file. Avoids an
 * external dependency; the CMS import only needs a valid zip with the XML at
 * the root. Store method (0) keeps it dependency-free + deterministic.
 */
function writeZipSingleFile(zipFilePath, entryName, content) {
  const data = Buffer.from(content, 'utf8');
  const crc = crc32(data);
  const nameBuf = Buffer.from(entryName, 'utf8');

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // method = store
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18); // compressed size
  localHeader.writeUInt32LE(data.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra len

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(0, 10); // method
  centralHeader.writeUInt16LE(0, 12); // mod time
  centralHeader.writeUInt16LE(0, 14); // mod date
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra
  centralHeader.writeUInt16LE(0, 32); // comment
  centralHeader.writeUInt16LE(0, 34); // disk number
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(0, 42); // local header offset

  const localOffset = 0;
  centralHeader.writeUInt32LE(localOffset, 42);

  const localPart = Buffer.concat([localHeader, nameBuf, data]);
  const centralPart = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk w/ central dir
  eocd.writeUInt16LE(1, 8); // entries this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralPart.length, 12); // central dir size
  eocd.writeUInt32LE(localPart.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment len

  const out = createWriteStream(zipFilePath);
  out.write(localPart);
  out.write(centralPart);
  out.write(eocd);
  out.end();
}

/** CRC-32 (IEEE 802.3) over a buffer, for the ZIP entry. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
