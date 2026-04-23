// Copyright (C) 2026 CROWDAQ
// Licensed under AGPL-3.0-or-later.
//
// Extracts the <onRender> CDATA block from modules/crowdaq-widget.xml
// and writes it to build/onrender.js so ESLint can lint it in isolation.
// Pragmatic MVP: the onRender JS stays inline in the XML (that's what
// the Xibo CMS actually reads), and CI re-extracts the linted copy on
// every run. Keep the wrapper tiny.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const XML_PATH = 'modules/crowdaq-widget.xml';
const OUT_PATH = 'build/onrender.js';

const xml = readFileSync(XML_PATH, 'utf8');
const match = xml.match(/<onRender><!\[CDATA\[([\s\S]*?)\]\]><\/onRender>/);
if (!match) {
    console.error(`[extract-onrender] <onRender> CDATA not found in ${XML_PATH}`);
    process.exit(1);
}

mkdirSync('build', { recursive: true });
writeFileSync(OUT_PATH, match[1].trim() + '\n', 'utf8');
console.log(`[extract-onrender] wrote ${OUT_PATH} (${match[1].length} chars)`);
