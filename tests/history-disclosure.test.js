import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraph } from '../src/graph.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const disclosure = 'UNMAPPED legacy stars and connections are retained. Their original note mappings are unavailable and they may overlap currently tracked notes. Star totals are cumulative atlas records, not a unique current-note count.';
const html = read('index.html');

test('cumulative history has an independent scene button and identical full disclosures', () => {
  assert.match(html, /<button\b[^>]*id="history-notice"[^>]*>Cumulative atlas · legacy may overlap current notes<\/button>/);
  const asideEnd = html.indexOf('</aside>');
  assert.ok(html.indexOf('id="history-notice"') > asideEnd, 'scene notice must not be inside hidden/inert tools');
  for (const id of ['history-disclosure', 'about-history-disclosure']) {
    assert.ok(html.includes(`id="${id}">${disclosure}</p>`), `${id} preserves the complete approved disclosure`);
  }
  assert.match(html, /aria-controls="about-dialog"/);
  assert.match(html, /CUMULATIVE STARS/);
  assert.match(html, /CUMULATIVE CONNECTIONS/);
  assert.match(html, /STARS IN DISK/);
});

test('public copy does not equate cumulative stars with unique current notes', () => {
  const main = read('src/main.js');
  assert.doesNotMatch(html + main, /Every (?:colored )?star in the disk is (?:an actual )?note|ALL NOTES FORM THE DISK|notes in this disk stream|sector notes/);
  assert.match(main, /Connected stars|stars/);
  assert.match(html, /Topology is not guaranteed anonymity/);
  assert.match(read('README.md'), /persistent display sectors/);
});

test('anonymous parser retains every cumulative atlas record without source deduplication', () => {
  const raw = JSON.parse(read('public/graph.json'));
  const graph = parseGraph(raw);
  assert.ok(graph.nodes.length > 0);
  assert.equal(graph.nodes.length, raw.nodes.length);
  assert.equal(graph.edges.length, raw.edges.length);
  assert.deepEqual(Object.keys(graph.nodes[0]).sort(), ['cluster', 'id']);
  const cumulative = parseGraph({ version: 1, nodes: [{ id: 'n000001', cluster: 0 }, { id: 'n000002', cluster: 0 }], edges: [['n000001', 'n000002']], clusters: [{ id: 0, count: 2 }] });
  assert.deepEqual(cumulative.nodes.map(node => node.id), ['n000001', 'n000002']);
  assert.equal(cumulative.totals.nodes, 2, 'distinct atlas IDs remain distinct; the public schema cannot infer source equivalence');
});
