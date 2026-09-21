import './style.css';
import { parseGraph } from './graph.js';
import { SECTOR_COLORS } from './layout.js';
import { Observatory } from './scene.js';
import { createExploration, connectionPreview } from './exploration.js';
import { locateSelection } from './inspection-space.js';
import { bindFlightPad } from './flight-pad.js';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('en-US').format(value);
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const narrowQuery = matchMedia('(max-width: 700px)');
$('neighbor-explorer').open = !narrowQuery.matches;
let scene;
let flightPad;
let graph;
let paused = motionQuery.matches;
let selectedCluster = null;
let selectedNode = null;
let navigationMode = 'orbit';
let cinematic = true;
let quality = innerWidth < 700 ? 'mobile' : 'desktop';
try {
  const stored = localStorage.getItem('eh-render-quality');
  if (['mobile', 'desktop', 'cinematic'].includes(stored)) quality = stored;
} catch { /* Storage may be unavailable in private/embedded contexts. */ }
$('quality-select').value = quality;
const hud = [...document.querySelectorAll('[data-hud]')];

function setCinematic(value, { focus = true } = {}) {
  cinematic = value;
  flightPad?.clear();
  scene?.flyControls.clear();
  $('app').dataset.cinematic = String(value);
  for (const element of hud) element.inert = value;
  $('explore-tools').hidden = value;
  $('explore-tools').inert = value;
  $('title-toggle').setAttribute('aria-expanded', String(!value));
  $('title-toggle').setAttribute('aria-label', `Event Horizon — ${value ? 'open' : 'close'} exploration controls`);
  $('cinematic-button').setAttribute('aria-pressed', String(value));
  if (focus) $('title-toggle').focus({ preventScroll: true });
}
$('cinematic-button').addEventListener('click', () => setCinematic(true));
$('close-tools').addEventListener('click', () => setCinematic(true));
function setToolsPanel(panel) {
  $('explore-tools').dataset.panel = panel;
  $('explore-tools').scrollTop = 0;
}
$('browse-button').addEventListener('click', () => {
  setToolsPanel('browse');
  $('sector-list').focus({ preventScroll: true });
  $('sector-list').scrollIntoView({ block: 'nearest' });
});
$('resume-inspection').addEventListener('click', () => {
  setToolsPanel('inspect');
  $('node-select').focus({ preventScroll: true });
  locateSelected({ compact: true });
});
$('title-toggle').addEventListener('click', () => setCinematic(!cinematic));
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  setCinematic(false, { focus: false });
  setToolsPanel('browse');
  $('sector-list').focus({ preventScroll: true });
  $('sector-list').scrollIntoView({ block: 'nearest' });
});
setCinematic(true, { focus: false });
$('quality-select').addEventListener('change', event => {
  quality = event.target.value;
  scene?.setQuality(quality);
  try { localStorage.setItem('eh-render-quality', quality); } catch { /* Optional preference only. */ }
});
let explorer;
const markers = new Map();
const clusterName = id => graph?.clusters.find(cluster => cluster.id === id)?.label || 'all streams';

function renderNeighbors({ reveal = false } = {}) {
  const result = explorer.neighbors();
  $('node-degree').textContent = format(result.total);
  $('connection-summary').textContent = `${format(result.within)} within stream · ${format(result.cross)} cross-sector`;
  $('neighbor-total').textContent = format(result.total);
  $('neighbor-filter').value = explorer.current.filter;
  $('neighbor-range').textContent = `${format(result.start)}–${format(result.end)} of ${format(result.filtered)}`;
  $('neighbor-page').value = result.page + 1;
  $('neighbor-page').max = result.pages;
  $('neighbor-page-total').textContent = `/ ${format(result.pages)}`;
  $('neighbor-prev').disabled = result.page === 0;
  $('neighbor-next').disabled = result.page === result.pages - 1;
  $('neighbor-paging').hidden = result.filtered === 0;
  $('neighbor-empty').hidden = result.filtered !== 0;
  $('neighbor-empty').textContent = result.total ? 'No connections in this scope. Try all connections.' : 'No connections. This note is an isolated star.';
  const list = $('neighbor-list');
  list.start = result.start;
  list.replaceChildren();
  for (const node of result.items) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.dataset.neighbor = node.id;
    button.className = 'neighbor-button';
    button.setAttribute('aria-label', `Follow ${node.id}, ${clusterName(node.cluster)}${node.cluster !== selectedCluster ? ', cross-sector' : ''}`);
    const id = document.createElement('span');
    id.textContent = node.id;
    const sector = document.createElement('small');
    sector.textContent = `${clusterName(node.cluster)}${node.cluster !== selectedCluster ? ' ↗' : ''}`;
    button.append(id, sector);
    button.addEventListener('click', () => {
      const sourceId = selectedNode.id;
      if (!explorer.follow(node.id)) return;
      applyContext({ sourceId, locate: true });
      $('history-back').focus({ preventScroll: true });
    });
    item.append(button);
    list.append(item);
  }
  if (reveal) revealFirstNeighbor();
}

function revealFirstNeighbor({ focus = true } = {}) {
  const first = $('neighbor-list').querySelector('[data-neighbor]');
  if (!first || !$('neighbor-explorer').open) return;
  const body = first.closest('.neighbor-body');
  const scroller = getComputedStyle(body).overflowY === 'auto' ? body : $('explore-tools');
  const port = scroller.getBoundingClientRect();
  const row = first.getBoundingClientRect();
  const top = Math.max(0, port.top + scroller.clientTop) + 5;
  const bottom = Math.min(innerHeight, port.bottom, port.top + scroller.clientTop + scroller.clientHeight) - 5;
  if (row.top < top || row.bottom > bottom) {
    // Disclosure keeps native focus/context and scrolls only as far as needed.
    // Page/scope changes align the first result. Round away from clipping the
    // 5px focus outline: scrollTop can quantize fractional layout coordinates.
    scroller.scrollTop = !focus && row.top >= top
      ? Math.ceil(scroller.scrollTop + row.bottom - bottom)
      : Math.floor(scroller.scrollTop + row.top - top);
  }
  // Focus last: blurring a changed page input can synchronously rerender.
  if (focus) first.focus({ preventScroll: true });
}

function applyContext({ sourceId = null, reset = false, locate = false } = {}) {
  const next = explorer.current;
  const clusterChanged = selectedCluster !== next.clusterId;
  if (clusterChanged || reset) {
    setNavigationMode('orbit');
    scene?.selectCluster(next.clusterId);
  }
  selectedCluster = next.clusterId;
  selectedNode = graph.nodes.find(node => node.id === next.nodeId) || null;
  scene?.selectNode(selectedNode?.id);
  const context = scene?.setConnectionContext?.(selectedNode?.id || null, sourceId);
  const preview = connectionPreview(context);
  $('connection-preview').textContent = preview;
  $('connection-preview').hidden = !selectedNode || !preview;
  $('app').dataset.selected = String(selectedCluster !== null);
  $('app').dataset.inspectNode = String(Boolean(selectedNode));
  $('selection-description').hidden = Boolean(selectedNode);
  $('resume-inspection').hidden = !selectedNode;
  $('resume-inspection').textContent = selectedNode ? `Return to ${selectedNode.id} ↗` : '';
  $('locate-button').disabled = !selectedNode || !scene?.locateNode;
  setToolsPanel(selectedCluster !== null ? 'inspect' : 'browse');
  for (const button of document.querySelectorAll('.sector-button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.cluster) === selectedCluster));
  }
  const cluster = graph.clusters.find(item => item.id === selectedCluster);
  const nodes = graph.nodes.filter(node => selectedCluster === null || node.cluster === selectedCluster);
  $('sector-status').textContent = scene ? (cluster ? 'ONE STREAM ISOLATED' : 'ALL NOTES FORM THE DISK') : 'ACCESSIBLE TOPOLOGY INDEX';
  $('render-count').textContent = `${format(scene ? nodes.length : 0)} / ${format(graph.nodes.length)}`;
  $('node-details').hidden = !cluster;
  $('node-facts').hidden = !selectedNode;
  $('neighbor-explorer').hidden = !selectedNode;
  $('interaction-guide').hidden = Boolean(cluster);
  $('view-name').textContent = cluster ? cluster.label.toUpperCase() : 'ALL SYSTEMS';
  $('selection-title').textContent = cluster?.label || 'The whole, connected.';
  $('selection-description').textContent = cluster
    ? `${format(cluster.count)} notes in this disk stream. Select a star, or choose an anonymous ID below.`
    : 'Every star in the disk is a note. Warped arcs repeat their light. Isolate a colored stream to explore its connections.';
  if (cluster) {
    if (clusterChanged || $('node-select').options.length < 2) {
      $('node-select').replaceChildren(new Option('Choose an anonymous ID', ''));
      for (const node of nodes) $('node-select').append(new Option(`${node.id} · ${cluster.label}`, node.id));
    }
    $('node-select').value = selectedNode?.id || '';
    $('sector-render-count').textContent = `${format(nodes.length)} / ${format(cluster.count)} sector notes ${scene ? 'in the disk' : 'listed'}.`;
    $('explore-tools').scrollTop = 0;
  }
  const previous = explorer.previous;
  $('history-back').disabled = !previous;
  $('history-context').textContent = previous ? `Return to ${previous.nodeId || clusterName(previous.clusterId)}.` : 'No previous selection.';
  if (selectedNode) {
    $('node-id').textContent = selectedNode.id;
    $('reticle-label').textContent = selectedNode.id;
    renderNeighbors();
    $('announcement').textContent = `${selectedNode.id}, ${cluster.label}. ${format(explorer.neighbors().total)} total connections.`;
    if (locate) locateSelected({ compact: true });
  } else {
    $('node-reticle').hidden = true;
    $('announcement').textContent = cluster ? `${cluster.label} isolated. ${format(cluster.count)} notes.` : 'View reset. All sectors visible.';
  }
}

function inspectNode(id) {
  if (!explorer?.visit({ clusterId: selectedCluster, nodeId: id || null })) return;
  applyContext({ locate: Boolean(id) });
  // Wide, short viewports already have open connections; selection discloses
  // their results without a details toggle. Do not do this on ordinary Back.
  if (id) revealFirstNeighbor({ focus: false });
}

function selectCluster(id) {
  if (!explorer?.visit({ clusterId: id })) return;
  applyContext({ reset: id === null });
  $(id === null ? 'sector-list' : 'node-select').focus({ preventScroll: true });
}

function locateSelected({ announce = false, compact = false } = {}) {
  if (!selectedNode) return false;
  if (compact && narrowQuery.matches) $('neighbor-explorer').open = false;
  const blockers = ['.intro', '#explore-tools', '#flight-pad', '#fallback'].map(selector => document.querySelector(selector))
    .filter(element => element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
    .map(element => element.getBoundingClientRect());
  const located = locateSelection(scene, selectedNode.id, $('observatory').getBoundingClientRect(), blockers);
  if (announce) $('announcement').textContent = located ? `Locating ${selectedNode.id} in the open scene.` : 'Locate is unavailable. Anonymous connection browsing is still available.';
  return located;
}
$('locate-button').addEventListener('click', () => locateSelected({ announce: true, compact: true }));
$('neighbor-explorer').addEventListener('toggle', () => {
  $('neighbor-explorer').querySelector('summary').setAttribute('aria-label', $('neighbor-explorer').open ? 'Hide connections' : 'Show connections');
  if (!cinematic && $('neighbor-explorer').open) {
    revealFirstNeighbor({ focus: false });
    if (narrowQuery.matches) locateSelected();
  }
});
$('history-back').addEventListener('click', () => { const sourceId = selectedNode?.id; if (explorer?.back()) applyContext({ sourceId, locate: true }); });
$('neighbor-filter').addEventListener('change', event => { explorer.setFilter(event.target.value); renderNeighbors({ reveal: true }); });
for (const [id, step] of [['neighbor-prev', -1], ['neighbor-next', 1]]) {
  $(id).addEventListener('mousedown', event => {
    // Keep a pending edit focused until click: blur would reveal results and
    // move this button away before pointer release. Cancellation leaves editing intact.
    if (event.button === 0 && document.activeElement === $('neighbor-page')) event.preventDefault();
  });
  $(id).addEventListener('click', () => {
    if (document.activeElement === $('neighbor-page')) explorer.setPage(Number($('neighbor-page').value) - 1);
    explorer.setPage(explorer.current.page + step);
    renderNeighbors({ reveal: true });
  });
}
$('neighbor-page').addEventListener('change', event => { explorer.setPage(Number(event.target.value) - 1); renderNeighbors({ reveal: true }); });
$('neighbor-page').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault(); // Do not activate the neighbor that receives focus.
    explorer.setPage(Number(event.target.value) - 1);
    renderNeighbors({ reveal: true });
  }
});

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
  if (cinematic) setCinematic(false);
  $('quality-select').disabled = true;
  $('cinematic-button').disabled = true;
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
  if (selectedCluster !== null) applyContext();
}

async function init() {
  const response = await fetch(`${import.meta.env.BASE_URL}graph.json`, { credentials: 'omit' });
  if (!response.ok) throw new Error('Topology unavailable.');
  graph = parseGraph(await response.json());
  explorer = createExploration(graph);
  $('notes-total').textContent = format(graph.totals.nodes);
  $('links-total').textContent = format(graph.totals.edges);
  $('sectors-total').textContent = format(graph.totals.clusters).padStart(2, '0');
  $('sector-fraction').textContent = `${String(graph.clusters.length).padStart(2, '0')} DETECTED`;
  $('render-count').textContent = `${format(graph.nodes.length)} / ${format(graph.nodes.length)}`;
  $('sector-status').textContent = 'ALL NOTES FORM THE DISK';
  renderSectors();
  try {
    scene = new Observatory($('observatory'), graph, {
      paused, quality,
      onUnavailable: showWebGLFallback,
      onPick(node) {
        setCinematic(false, { focus: false });
        inspectNode(node.id);
      },
      onProject(positions, nodePosition) {
        const top = $('app').getBoundingClientRect().top;
        const blockers = ['.intro', '#explore-tools'].map(selector => document.querySelector(selector)).filter(el => el.offsetHeight).map(el => el.getBoundingClientRect());
        for (const pos of positions) {
          const marker = markers.get(pos.id);
          const covered = blockers.some(rect => pos.x + 105 > rect.left && pos.x - 44 < rect.right && pos.y - 20 > rect.top - top && pos.y - 65 < rect.bottom - top);
          marker.style.transform = `translate(${pos.x}px, ${pos.y - 65}px)`;
          marker.hidden = covered || !pos.visible || pos.id !== selectedCluster;
        }
        $('node-reticle').hidden = !nodePosition?.visible;
        if (nodePosition) $('node-reticle').style.transform = `translate(${nodePosition.x - 13}px, ${nodePosition.y - 13}px)`;
      },
    });
    $('orbit-button').disabled = false;
    $('fly-button').disabled = false;
    $('quality-select').disabled = false;
    $('cinematic-button').disabled = false;
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
  flightPad?.clear();
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
flightPad = bindFlightPad($('flight-pad'), {
  getControls: () => scene?.flyControls,
  isEnabled: () => navigationMode === 'fly' && Boolean(scene) && !$('about-dialog').open,
  // Re-entering the current mode cancels any scene transition via the existing API.
  onInput: () => scene?.setNavigationMode('fly'),
});
$('flight-exit').addEventListener('click', () => {
  setNavigationMode('orbit');
  $('title-toggle').focus({ preventScroll: true });
});
$('flight-home').addEventListener('click', () => { resetView(); setCinematic(true); });
$('fly-button').addEventListener('click', () => {
  setNavigationMode('fly');
  $('observatory').querySelector('canvas')?.focus({ preventScroll: true });
});
$('pause-button').addEventListener('click', () => setPaused(!paused));
motionQuery.addEventListener('change', event => setPaused(event.matches));
setPaused(paused);
$('node-select').addEventListener('change', event => inspectNode(event.target.value));
function resetView() { if (explorer) { explorer.reset(); applyContext({ reset: true }); } }
$('reset-button').addEventListener('click', resetView);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || $('about-dialog').open) return;
  if (!cinematic) setCinematic(true);
});

$('about-button').addEventListener('click', () => { flightPad.clear(); $('about-dialog').showModal(); });
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
