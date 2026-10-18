/**
 * Renders the full visual vocabulary legend (#493) to a standalone SVG so it can
 * be reviewed — and screenshotted — without a browser. The palette here is
 * deliberately greyscale: the whole point of the vocabulary is that every entry
 * is distinguishable without colour.
 *
 * Usage: node --experimental-strip-types scripts/render-legend.mjs [outfile]
 */

import { writeFileSync } from 'node:fs';
import {
  EDGE_KIND_ORDER,
  NODE_KIND_ORDER,
  WRITE_MARK_ORDER,
  renderLegend,
} from '../packages/visualiser/src/vocabulary.ts';

const GREYSCALE = {
  ground: '#ffffff',
  node: '#e6e6e6',
  nodeText: '#111111',
  edge: '#333333',
  muted: '#666666',
  accent: '#000000',
  write: '#444444',
  read: '#777777',
  observed: '#333333',
  focus: '#000000',
};

const rowHeight = 26;
const padding = 12;
const width = 320;
const rows = NODE_KIND_ORDER.length + EDGE_KIND_ORDER.length + WRITE_MARK_ORDER.length;
const height = padding * 2 + rows * rowHeight + 30;

const legend = renderLegend([...NODE_KIND_ORDER, ...EDGE_KIND_ORDER, ...WRITE_MARK_ORDER], {
  idPrefix: 'legend',
  padding,
  rowHeight,
  width,
});

const declarations = Object.entries(GREYSCALE)
  .map(
    ([name, value]) => `--viz-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`,
  )
  .join(' ');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagram legend in greyscale">
  <style>
    :root { ${declarations} }
    text { font-family: 'IBM Plex Mono', 'DejaVu Sans Mono', monospace; font-size: 12px; }
    .viz-legend-label { fill: #111111; }
  </style>
  <rect width="${width}" height="${height}" fill="${GREYSCALE.ground}"/>
  <text x="${padding}" y="18" font-size="13" font-weight="bold">Diagram legend (greyscale)</text>
  <g transform="translate(0, 30)">${legend}</g>
</svg>
`;

const outfile = process.argv[2] ?? 'docs/images/visualiser/legend-greyscale.svg';
writeFileSync(outfile, svg);
console.log(`wrote ${outfile}`);
