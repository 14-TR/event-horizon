import './style.css';
import { parseGraph, sampleGraph } from './graph.js';
import { SECTOR_COLORS } from './layout.js';
import { Observatory } from './scene.js';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('en-US').format(value);
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let scene;
let graph;
let sampled;
let paused = motionQuery.matches;
let selectedCluster = null;
let selectedNode = null;
let navigationMode = 'orbit';
const adjacency = new Map();
const markers = new Map();

function inspectNode(id) {
  selectedNode = graph.nodes.find(node => node.id === id) || null;
  scene?.selectNode(selectedNode?.id);
  $('node-facts').hidden = !selectedNode;
  if (selectedNode) {
    $('node-select').value = selectedNode.id;
    $('node-id').textContent = selectedNode.id;
    $('node-degree').textContent = format(adjacency.get(selectedNode.id)?.size || 0);
    $('reticle-label').textContent = selectedNode.id;
    $('announcement').textContent = `${selectedNode.id}. ${adjacency.get(selectedNode.id)?.size || 0} total connections.`;
  } else {
    $('node-reticle').hidden = true;
  }
}

function selectCluster(id) {
  setNavigationMode('orbit');
  selectedCluster = id;
  inspectNode(null);
  scene?.selectCluster(id);
  $('app').dataset.selected = id === null ? 'false' : 'true';
  for (const button of document.querySelectorAll('.sector-button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.cluster) === id));
  }
  const cluster = graph.clusters.find(item => item.id === id);
  const visibleNodes = scene ? sampled.nodes.filter(node => id === null || node.cluster === id).length : 0;
  $('render-count').textContent = `${format(visibleNodes)} / ${format(graph.nodes.length)}`;
  $('node-details').hidden = !cluster;
  $('interaction-guide').hidden = Boolean(cluster);
  $('singularity-caption').hidden = Boolean(cluster);
  $('view-name').textContent = cluster ? cluster.label.toUpperCase() : 'ALL SYSTEMS';
  $('selection-title').textContent = cluster?.label || 'The whole, connected.';
  $('selection-description').textContent = cluster
    ? `${format(cluster.count)} notes in this constellation. Select a star, or choose an anonymous ID below.`
    : 'Individual notes become constellations. Their connections trace the space between.';
  if (cluster) {
    const nodes = sampled.nodes.filter(node => node.cluster === id);
    const select = $('node-select');
    select.replaceChildren(new Option('Choose an anonymous ID', ''));
    for (const node of nodes) select.append(new Option(node.id, node.id));
    $('sector-render-count').textContent = `${format(nodes.length)} / ${format(cluster.count)} sector notes ${scene ? 'rendered' : 'listed'}.`;
    $('announcement').textContent = `${cluster.label} isolated. ${format(cluster.count)} notes.`;
  } else {
    $('announcement').textContent = 'View reset. All sectors visible.';
  }
}

function renderSectors() {
  const list = $('sector-list');
  const markerHost = $('cluster-markers');
  for (const [index, cluster] of graph.clusters.entries()) {
    const button = document.createElement('button');
    button.className = 'sector-button';
    button.dataset.cluster = cluster.id;
    button.style.setProperty('--sector-color', SECTOR_COLORS[index % SECTOR_COLORS.length]);
    button.setAttribute('aria-label', `${cluster.label}, ${format(cluster.count)} notes`);
    button.setAttribute('aria-pressed', 'false');
    const dot = document.createElement('span');
    dot.className = 'sector-dot';
    const label = document.createElement('span');
    label.textContent = cluster.label;
    const count = document.createElement('span');
    count.className = 'sector-count';
    count.textContent = format(cluster.count);
    const arrow = document.createElement('span');
    arrow.className = 'sector-arrow';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(dot, label, count, arrow);
    button.addEventListener('click', () => selectCluster(selectedCluster === cluster.id ? null : cluster.id));
    list.append(button);
    const marker = document.createElement('button');
    marker.className = 'cluster-marker';
    marker.dataset.cluster = cluster.id;
    marker.style.setProperty('--sector-color', SECTOR_COLORS[index % SECTOR_COLORS.length]);
    marker.setAttribute('aria-label', `Isolate ${cluster.label}`);
    marker.setAttribute('tabindex', '-1'); // Equivalent keyboard controls in the sector list.
    marker.textContent = `${cluster.label.toUpperCase()} · ${format(cluster.count)}`;
    marker.addEventListener('click', () => selectCluster(cluster.id));
    markerHost.append(marker);
    markers.set(cluster.id, marker);
  }
}

function showWebGLFallback() {
  scene?.dispose();
  scene = undefined;
  setNavigationMode('orbit');
  $('orbit-button').disabled = true;
  $('fly-button').disabled = true;
  $('observatory').replaceChildren();
  $('observatory').dataset.renderer = 'fallback';
  $('cluster-markers').hidden = true;
  $('node-reticle').hidden = true;
  $('fallback').hidden = false;
  $('fallback-title').textContent = '3D is unavailable.';
  $('fallback-description').textContent = 'This device could not keep a WebGL connection. You can still explore sectors and anonymous node connections using the controls.';
  $('retry-button').textContent = 'Explore the topology';
  $('pause-button').disabled = true;
  $('view-state').textContent = 'TOPOLOGY MODE';
  $('render-count').textContent = `0 / ${format(graph.nodes.length)}`;
  $('sector-status').textContent = 'ACCESSIBLE TOPOLOGY INDEX';
  if (selectedCluster !== null) selectCluster(selectedCluster);
}

async function init() {
  const response = await fetch(`${import.meta.env.BASE_URL}graph.json`, { credentials: 'omit' });
  if (!response.ok) throw new Error('Topology unavailable.');
  graph = parseGraph(await response.json());
  for (const node of graph.nodes) adjacency.set(node.id, new Set());
  for (const [a, b] of graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  sampled = sampleGraph(graph, innerWidth < 700 ? 900 : 1800, innerWidth < 700 ? 160 : 260);
  $('notes-total').textContent = format(graph.totals.nodes);
  $('links-total').textContent = format(graph.totals.edges);
  $('sectors-total').textContent = format(graph.totals.clusters).padStart(2, '0');
  $('sector-fraction').textContent = `${String(graph.clusters.length).padStart(2, '0')} DETECTED`;
  $('render-count').textContent = `${format(sampled.nodes.length)} / ${format(graph.nodes.length)}`;
  $('sector-status').textContent = sampled.sampled ? 'BALANCED DISPLAY SAMPLE' : 'ALL NOTES IN VIEW';
  renderSectors();
  try {
    scene = new Observatory($('observatory'), sampled, {
      paused,
      onUnavailable: showWebGLFallback,
      onPick(node) {
        if (selectedCluster !== node.cluster) selectCluster(node.cluster);
        inspectNode(node.id);
      },
      onProject(positions, nodePosition) {
        const top = $('app').getBoundingClientRect().top;
        const blockers = ['.intro', '.telemetry', '.sectors-panel', '.inspector'].map(selector => document.querySelector(selector)).filter(el => el.offsetHeight).map(el => el.getBoundingClientRect());
        for (const pos of positions) {
          const marker = markers.get(pos.id);
          const covered = blockers.some(rect => pos.x + 105 > rect.left && pos.x - 44 < rect.right && pos.y - 20 > rect.top - top && pos.y - 65 < rect.bottom - top);
          marker.style.transform = `translate(${pos.x}px, ${pos.y - 65}px)`;
          marker.hidden = covered || !pos.visible || (selectedCluster !== null && pos.id !== selectedCluster);
        }
        $('node-reticle').hidden = !nodePosition?.visible;
        if (nodePosition) $('node-reticle').style.transform = `translate(${nodePosition.x - 13}px, ${nodePosition.y - 13}px)`;
      },
    });
    $('orbit-button').disabled = false;
    $('fly-button').disabled = false;
  } catch {
    showWebGLFallback();
  }
  $('loading-notice').hidden = true;
  $('app').dataset.state = 'ready';
}

function setPaused(value) {
  paused = value;
  scene?.setPaused(paused);
  $('pause-button').setAttribute('aria-pressed', String(paused));
  $('pause-button').setAttribute('aria-label', paused ? 'Resume motion' : 'Pause motion');
  $('pause-label').textContent = paused ? 'Resume motion' : 'Pause motion';
  $('pause-icon').textContent = paused ? '▷' : 'Ⅱ';
  $('view-state').textContent = paused ? 'MOTION PAUSED' : navigationMode === 'fly' ? 'LIVE FLIGHT' : 'LIVE ORBIT';
}

function setNavigationMode(mode) {
  navigationMode = mode;
  scene?.setNavigationMode(mode);
  $('app').dataset.navigation = mode;
  $('orbit-button').setAttribute('aria-pressed', String(mode === 'orbit'));
  $('fly-button').setAttribute('aria-pressed', String(mode === 'fly'));
  $('flight-help').hidden = mode !== 'fly';
  $('flight-pad').hidden = mode !== 'fly';
  if (scene) $('view-state').textContent = paused ? 'MOTION PAUSED' : mode === 'fly' ? 'LIVE FLIGHT' : 'LIVE ORBIT';
}

$('orbit-button').addEventListener('click', () => setNavigationMode('orbit'));
for (const button of document.querySelectorAll('[data-flight]')) {
  const stop = () => scene?.flyControls.thrust.delete(button.dataset.flight);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    scene?.flyControls.thrust.add(button.dataset.flight);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) button.addEventListener(type, stop);
  button.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); scene?.flyControls.thrust.add(button.dataset.flight); }
  });
  button.addEventListener('keyup', stop);
}
$('fly-button').addEventListener('click', () => {
  setNavigationMode('fly');
  $('observatory').querySelector('canvas')?.focus({ preventScroll: true });
});
$('pause-button').addEventListener('click', () => setPaused(!paused));
motionQuery.addEventListener('change', event => setPaused(event.matches));
setPaused(paused);
$('node-select').addEventListener('change', event => inspectNode(event.target.value));
$('reset-button').addEventListener('click', () => { if (graph) selectCluster(null); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('about-dialog').open && graph) selectCluster(null);
});

$('about-button').addEventListener('click', () => $('about-dialog').showModal());
for (const id of ['close-about', 'close-about-done']) $(id).addEventListener('click', () => $('about-dialog').close());

$('retry-button').addEventListener('click', () => {
  if (graph) { $('fallback').hidden = true; $('sector-list').focus(); }
  else location.reload();
});

init().catch(() => {
  $('loading-notice').hidden = true;
  $('fallback').hidden = false;
  $('fallback-description').textContent = 'The topology could not be loaded or did not pass validation. No note content is ever requested.';
  $('sector-status').textContent = 'NO TOPOLOGY LOADED';
  $('pause-button').disabled = true;
  $('reset-button').disabled = true;
  $('view-state').textContent = 'OFFLINE';
  $('app').dataset.state = 'error';
});
