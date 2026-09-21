import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture } from './fixture.js';

// Replace only the browser boundary. Run the real measurement CLI, including
// graph validation, per-graph draw checks, resource stability and ratio gate.
// These deterministic samples are unit-test inputs, NOT hardware evidence.
const browserDouble = `
const input = JSON.parse(process.env.EH_GPU_TEST_INPUT);
let run = 0;
export const chromium = { launch: async () => ({
  version: () => 'unit-test browser double (no GPU)',
  close: async () => {},
  newContext: async () => {
    const round = Math.floor(run++ / 4); // Two variants, two views per round.
    let graph, successor, respond;
    const events = new Map();
    return {
      close: async () => {},
      newPage: async () => ({
        on: (event, callback) => events.set(event, callback),
        addInitScript: async () => {},
        waitForResponse: predicate => new Promise(resolve => {
          respond = response => { if (predicate(response)) resolve(response); };
        }),
        goto: async url => {
          successor = new URL(url).hostname === 'successor.invalid';
          const changed = input.change === 'round' ? round > 0 : successor;
          graph = changed ? input.changedGraph : input.graph;
          const response = {
            url: () => new URL('graph.json', url).href, ok: () => true,
            json: async () => graph, body: async () => Buffer.from(JSON.stringify(graph)),
          };
          events.get('response')(response);
          respond(response);
        },
        waitForFunction: async () => {},
        evaluate: async callback => {
          if (callback.toString().includes('window.__gpu.start()')) return;
          return {
            samples: Array.from({ length: 120 }, () => ({
              ms: successor ? input.successorMs : 1,
              draws: input.draws ?? 4 * new Set(graph.nodes.map(node => node.cluster)).size + 4,
            })),
            disjoint: false, glErrors: [], observed: { time: 0, camera: [1], projection: [1] },
            noteStars: String(graph.nodes.length), diskSourceStars: String(graph.nodes.length),
            gpuRenderer: 'UNIT TEST DOUBLE (no GPU)',
          };
        },
      }),
    };
  },
}) };
`;

function measure({ graph = makeFixture({ sectors: 2, perSector: 3 }), changedGraph = graph, change = 'variant', successorMs = 0.5, draws } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'eh-gpu-gate-'));
  const browserURL = `data:text/javascript,${encodeURIComponent(browserDouble)}`;
  const preload = `import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      return specifier === '@playwright/test'
        ? { url: ${JSON.stringify(browserURL)}, shortCircuit: true } : next(specifier, context);
    } });`;
  try {
    const env = {
      ...process.env,
      EH_GPU_DIR: directory,
      EH_GPU_MAX_RATIO: '1.25',
      EH_GPU_VARIANTS: JSON.stringify(['base', 'successor'].map((name, i) => ({ name, url: `https://${name}.invalid/`, sha: (i ? 'b' : 'a').repeat(40) }))),
      EH_GPU_TEST_INPUT: JSON.stringify({ graph, changedGraph, change, successorMs, draws }),
    };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
      fileURLToPath(new URL('./measure-gpu.mjs', import.meta.url)),
    ], { env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    const receiptPath = join(directory, 'measurements.json');
    return { status: result.status, output: `${result.stdout}${result.stderr}`, receipt: existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('relative GPU gate rejects a smaller successor topology even with a passing timing ratio', () => {
  const result = measure({ changedGraph: makeFixture({ sectors: 2, perSector: 1 }) });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /all variants\/rounds must use exactly the same validated topology/);
  assert.equal(result.receipt.summary, undefined, 'mismatched workloads cannot publish a ratio summary');
});

for (const change of ['variant', 'round']) {
  for (const [name, mutate] of [
    ['node IDs', graph => {
      const oldId = graph.nodes[0].id;
      graph.nodes[0].id = 'n900000';
      graph.edges = graph.edges.map(edge => edge.map(id => id === oldId ? 'n900000' : id));
    }],
    ['edges', graph => { graph.edges[0] = [graph.nodes[0].id, graph.nodes[2].id]; }],
    ['sector membership', graph => { [graph.nodes[0].cluster, graph.nodes[3].cluster] = [graph.nodes[3].cluster, graph.nodes[0].cluster]; }],
  ]) {
    test(`GPU workload identity rejects ${name} changes across ${change}s with unchanged totals`, () => {
      const changedGraph = makeFixture({ sectors: 2, perSector: 3 });
      mutate(changedGraph);
      const result = measure({ changedGraph, change });
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /all variants\/rounds must use exactly the same validated topology/);
      assert.equal(result.receipt.runs.length, change === 'round' ? 4 : 1, 'stop at the first mismatched workload');
      assert.equal(result.receipt.summary, undefined);
    });
  }
}

test('identical validated GPU workloads complete every variant and round with dynamic sector draw budgets', () => {
  const graph = makeFixture({ sectors: 11, perSector: 2 });
  const changedGraph = structuredClone(graph);
  changedGraph.meta.notes = 999999;
  changedGraph.clusters.forEach(cluster => { cluster.label = 'ignored'; cluster.count = 999999; });
  const result = measure({ graph, changedGraph });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.receipt.topology.nodes, graph.nodes);
  assert.deepEqual(result.receipt.topology.edges, graph.edges);
  assert.deepEqual(result.receipt.topology.clusters.map(({ id, count }) => ({ id, count })), graph.clusters.map(({ id, count }) => ({ id, count })));
  assert.equal(result.receipt.runs.length, result.receipt.rounds * 2 * 2);
  assert.equal(result.receipt.summary.length, 2);
  assert.ok(result.receipt.runs.every(run => run.samples.every(sample => sample.draws === 4 * graph.clusters.length + 4)));
});

test('identical topology does not bypass the relative GPU slowdown gate', () => {
  const result = measure({ successorMs: 2 });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /successor\/base 2 exceeds 1.25/);
});

test('identical topology does not bypass the occupied-sector GPU draw assertion', () => {
  const result = measure({ draws: 1 });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /timer must contain every production source/);
});

test('GPU workload identity never accepts invalid topology', () => {
  const graph = makeFixture({ sectors: 2, perSector: 3 });
  graph.edges.push([graph.nodes[0].id, 'n999999']);
  const result = measure({ graph });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Invalid topology/);
  assert.equal(result.receipt, null);
});
