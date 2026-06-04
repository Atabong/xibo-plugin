#!/usr/bin/env node
/**
 * Assemble the broadcast render styles into the two places that carry CSS:
 *
 *   1. modules/crowdaq-widget-v2.xml  — the live player path (<style> in the
 *      stencil). This is what the snap Chromium renders on the bar.
 *   2. tests/e2e/harness.html         — the headless-proof path (its own <style>),
 *      so the e2e screenshots reflect the SAME design the player gets.
 *
 * The CSS is the concatenation of:
 *   - src/templates/fonts.css.gen   (base64-inlined @font-face — Saira family)
 *   - src/templates/broadcast.css   (the hand-maintained design system)
 *
 * Both targets carry a marker pair:
 *   /* CROWDAQ:STYLES:BEGIN *\/ ... /* CROWDAQ:STYLES:END *\/
 * and everything between is replaced. Idempotent — safe to re-run.
 *
 * Run from modules/widget-v2:  node tools/assemble-styles.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetRoot = resolve(here, '..');
const repoRoot = resolve(widgetRoot, '..', '..');

const FONTS = resolve(widgetRoot, 'src', 'templates', 'fonts.css.gen');
const BROADCAST = resolve(widgetRoot, 'src', 'templates', 'broadcast.css');
const XML = resolve(repoRoot, 'modules', 'crowdaq-widget-v2.xml');
const HARNESS = resolve(widgetRoot, 'tests', 'e2e', 'harness.html');

const BEGIN = '/* CROWDAQ:STYLES:BEGIN */';
const END = '/* CROWDAQ:STYLES:END */';

const css = `${readFileSync(FONTS, 'utf8')}\n${readFileSync(BROADCAST, 'utf8')}`;

function inject(file, label) {
  const src = readFileSync(file, 'utf8');
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b < 0 || e < 0 || e < b) {
    throw new Error(`[assemble] ${label}: missing ${BEGIN} … ${END} marker pair`);
  }
  const next = src.slice(0, b + BEGIN.length) + '\n' + css + '\n' + src.slice(e);
  writeFileSync(file, next, 'utf8');
  console.log(`[assemble] ${label}: injected ${css.length} bytes of CSS`);
}

inject(XML, 'module XML <style>');
inject(HARNESS, 'e2e harness.html <style>');
console.log('[assemble] done');
