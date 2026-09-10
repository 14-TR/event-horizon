import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLayout } from './layout.js';
import { createInfall } from './motion.js';
import { FlightControls } from './flight.js';
import { pointVertex, pointFragment } from './shaders.js';
import { BlackHoleRenderer } from './black-hole.js';
import { StarTrails } from './star-trails.js';
import { DiskRadiance } from './disk-radiance.js';

/** Low, slightly rolled framing; narrow screens keep the disk, not UI margins. */
export function openingFrame(width, height) {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const depth = Math.max(19, 25 / aspect);
  return { position: [0, depth * 0.235, depth], target: [0, depth * 0.052, 0], up: [0.10, 1, 0] };
}

/** All artwork is generated locally. No external textures, fonts or network services. */
export class Observatory {
  constructor(host, graph, { paused = false, quality = host.clientWidth < 700 ? 'mobile' : 'desktop', onProject = () => {}, onPick = () => {}, onUnavailable = () => {} } = {}) {
    this.host = host;
    this.graph = graph;
    this.layout = buildLayout(graph);
    this.infall = createInfall(this.layout);
    this.paused = paused;
    this.quality = quality;
    this.onProject = onProject;
    this.onUnavailable = onUnavailable;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 250);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!this.renderer.capabilities.isWebGL2 || !this.renderer.extensions.has('EXT_color_buffer_float')) {
      this.renderer.dispose();
      throw new Error('Required WebGL2 floating-point render targets are unavailable.');
    }
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = () => { this.shaderError = new Error('A rendering shader could not compile.'); };
    this.renderer.setClearColor(0x030407, 1);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D knowledge observatory. Orbit: drag and scroll. Fly: WASD moves, Q/E down/up, drag to look. Warped arcs are noninteractive repeated note light. Inspect direct stars or select the Event Horizon title to open the complete sector and node controls.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    const opening = openingFrame(host.clientWidth, host.clientHeight);
    this.camera.up.fromArray(opening.up).normalize();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !paused;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 100;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.7;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.homePosition = new THREE.Vector3(...opening.position);
    this.homeTarget = new THREE.Vector3(...opening.target);
    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
    this.controls.saveState();
    this.orbital = new THREE.Group();
    this.navigationMode = 'orbit';
    this.flyControls = new FlightControls(this.camera, this.renderer.domElement);
    this.scene.add(this.orbital);
    this.clusterObjects = new Map();
    this.addBlackHole();
    this.addConstellations();
    this.addTrails();
    this.updateInfall(0);
    this.pointerAbort = new AbortController();
    const canvas = this.renderer.domElement;
    const signal = this.pointerAbort.signal;
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.unavailable(); }, { signal });
    let down;
    canvas.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; }, { signal });
    canvas.addEventListener('pointerup', event => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const node = this.pick(event.clientX, event.clientY);
      if (node) onPick(node);
      down = null;
    }, { signal });
    canvas.addEventListener('pointercancel', () => { down = null; }, { signal });
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    try { this.drawFrame(); } catch (error) { this.dispose(); throw error; }
    this.lastTime = performance.now();
    this.frame = this.frame.bind(this);
    this.frameId = requestAnimationFrame(this.frame);
    host.dataset.renderer = 'webgl';
  }

  points(positions, colors, sizes, opacity = 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    return new THREE.Points(geometry, new THREE.ShaderMaterial({
      vertexShader: pointVertex, fragmentShader: pointFragment,
      uniforms: { uPixelRatio: { value: this.renderer.getPixelRatio() }, uOpacity: { value: opacity } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  }

  addBlackHole() {
    this.blackHole = new BlackHoleRenderer({ quality: this.quality || (this.host.clientWidth < 700 ? 'mobile' : 'desktop'), exposure: 1.35, glow: 0.24 });
  }

  addConstellations() {
    const positions = new Map(this.layout.nodes.map(node => [node.id, node]));
    // The budget applies to real edges only: no invented constellation links.
    this.visibleEdgeCount = 0;
    const sectorNodes = new Map(this.layout.clusters.map(cluster => [cluster.id, []]));
    const sectorEdges = new Map(this.layout.clusters.map(cluster => [cluster.id, []]));
    for (const node of this.layout.nodes) sectorNodes.get(node.cluster).push(node);
    for (const [a, b] of this.graph.edges) {
      if (this.visibleEdgeCount >= 8000) break;
      const na = positions.get(a), nb = positions.get(b);
      if (na && nb && na.cluster === nb.cluster) {
        sectorEdges.get(na.cluster).push(na, nb);
        this.visibleEdgeCount++;
      }
    }
    for (const cluster of this.layout.clusters) {
      const group = new THREE.Group();
      const nodes = sectorNodes.get(cluster.id);
      const p = [], c = [], s = [];
      const color = new THREE.Color(cluster.color);
      for (const node of nodes) {
        p.push(...node.position);
        c.push(color.r, color.g, color.b);
        s.push(nodes.length <= 4 ? 16 : 10 + (Number(node.id.slice(-3)) % 9 === 0 ? 5 : 0));
      }
      const points = this.points(p, c, s);
      points.userData.nodes = nodes;
      group.add(points);
      const lines = sectorEdges.get(cluster.id);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines.flatMap(node => node.position), 3));
      points.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.035, depthWrite: false }));
      line.visible = false; // Reveal real connections on isolation, not a web over the disk.
      group.add(line);
      this.orbital.add(group);
      this.clusterObjects.set(cluster.id, { group, points, line, cluster, edgeNodes: lines });
    }
    if (this.host?.dataset) this.host.dataset.noteStars = String([...this.clusterObjects.values()].reduce((sum, { points }) => sum + points.geometry.attributes.position.count, 0));
  }

  addTrails() {
    this.diskRadiance?.dispose();
    if (this.trails) { this.orbital.remove(this.trails.mesh); this.trails.dispose(); }
    this.trails = new StarTrails(this.layout, this.quality);
    this.trails.selectedCluster = this.selectedCluster ?? null;
    this.orbital.add(this.trails.mesh);
    this.trails.update(this.time);
    this.reportTrails();
    this.diskRadiance = new DiskRadiance([...this.clusterObjects.values()].map(({ points }) => points), this.trails.mesh, this.quality);
    this.blackHole.setDiskRadiance(this.diskRadiance);
    this.host.dataset.diskSourceStars = String(this.diskRadiance.noteCount);
    this.host.dataset.diskImageSize = String(this.diskRadiance.target.width);
    this.host.dataset.lensedLight = 'noninteractive';
  }

  reportTrails() {
    this.host.dataset.trailStars = String(this.trails.entries.length);
    this.host.dataset.trailSegments = String(this.trails.mesh.geometry.drawRange.count / 2);
  }

  updateInfall(time) {
    const tracked = this.navigationMode === 'orbit' && this.layout.clusters.find(cluster => cluster.id === this.selectedCluster);
    const previous = tracked ? new THREE.Vector3(...tracked.center) : null;
    this.infall(time);
    if (this.trails) { this.trails.update(time); this.reportTrails(); }
    if (tracked) {
      const shift = new THREE.Vector3(...tracked.center).sub(previous);
      this.camera.position.add(shift);
      this.controls.target.add(shift);
      if (this.flight) {
        for (const key of ['fromPosition', 'fromTarget', 'position', 'target']) this.flight[key].add(shift);
      }
    }
    for (const { points, line, edgeNodes } of this.clusterObjects.values()) {
      const positions = points.geometry.attributes.position;
      points.userData.nodes.forEach((node, index) => positions.setXYZ(index, ...node.position));
      positions.needsUpdate = true;
      points.geometry.computeBoundingSphere(); // Raycasting and culling must move too.
      const endpoints = line.geometry.attributes.position;
      edgeNodes.forEach((node, index) => endpoints.setXYZ(index, ...node.position));
      endpoints.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.18;
    raycaster.setFromCamera(pointer, this.camera);
    const points = [...this.clusterObjects.values()].filter(item => item.group.visible).map(item => item.points);
    const hits = raycaster.intersectObjects(points, false).sort((a, b) => a.distanceToRay - b.distanceToRay);
    for (const hit of hits) {
      const node = hit.object.userData.nodes[hit.index];
      const world = new THREE.Vector3(...node.position).applyMatrix4(this.orbital.matrixWorld);
      try {
        if (!this.blackHole?.isOccluded(this.renderer, this.camera, world)) return node;
      } catch { this.unavailable(); return null; }
    }
    return null;
  }

  reportQuality() {
    const settings = this.blackHole.settings;
    this.host.dataset.quality = settings.name;
    this.host.dataset.raySteps = String(settings.steps);
    this.host.dataset.rayPixels = String(settings.width * settings.height);
  }

  setQuality(name) {
    if (name === this.quality) return;
    this.blackHole.setQuality(name);
    this.quality = name;
    this.addTrails();
    this.reportQuality();
  }

  setPaused(value) {
    this.paused = value;
    this.controls.enableDamping = !value;
    if (value) this.flight = null;
  }

  setNavigationMode(mode) {
    this.navigationMode = mode;
    this.flight = null;
    this.controls.enabled = mode === 'orbit';
    this.flyControls.setEnabled(mode === 'fly');
    if (mode === 'orbit') {
      const target = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(13).add(this.camera.position);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  selectCluster(id) {
    this.selectedCluster = id;
    this.selectedNode = null;
    this.trails.selectedCluster = id;
    this.trails.reset();
    this.trails.update(this.time);
    this.reportTrails();
    for (const [clusterId, objects] of this.clusterObjects) {
      objects.group.visible = id === null || id === clusterId;
      objects.line.visible = id !== null;
    }
    if (id === null) {
      this.setNavigationMode('orbit');
      this.flight = null;
      this.controls.reset();
      this.camera.position.copy(this.homePosition);
      this.controls.target.copy(this.homeTarget);
      this.controls.update();
      return;
    }
    const cluster = this.clusterObjects.get(id)?.cluster;
    if (!cluster) return;
    const target = new THREE.Vector3(...cluster.center).applyMatrix4(this.orbital.matrixWorld);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const distance = cluster.count > 4 ? this.homePosition.length() : this.host.clientWidth < 700 ? 18 : 13;
    const position = target.clone().addScaledVector(direction, distance);
    if (this.paused) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    } else {
      this.flight = { start: performance.now(), fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), position, target };
    }
  }

  selectNode(id) {
    this.selectedNode = this.layout.nodes.find(node => node.id === id) || null;
  }

  project(position, checkOcclusion = false) {
    const world = new THREE.Vector3(...position).applyMatrix4(this.orbital.matrixWorld);
    const v = world.clone().project(this.camera);
    const inView = v.z < 1 && v.z > 0 && Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.86;
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight, visible: inView && (!checkOcclusion || !this.blackHole.isOccluded(this.renderer, this.camera, world)) };
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.blackHole.resize(width, height, this.renderer.getPixelRatio());
    this.reportQuality();
    const atHome = this.navigationMode === 'orbit' && this.selectedCluster == null
      && this.camera.position.distanceToSquared(this.homePosition) < 1e-8
      && this.controls.target.distanceToSquared(this.homeTarget) < 1e-8;
    const opening = openingFrame(width, height);
    this.homePosition.fromArray(opening.position);
    this.homeTarget.fromArray(opening.target);
    // Reframe only an untouched home view; never teleport orbit/flight input.
    if (atHome) {
      this.camera.position.copy(this.homePosition);
      this.controls.target.copy(this.homeTarget);
      this.controls.update();
      this.controls.saveState();
    }
  }

  drawFrame() {
    this.blackHole.render(this.renderer, this.camera, this.time, this.scene);
    if (this.shaderError) throw this.shaderError;
  }

  unavailable() {
    if (this.failed || this.disposed) return;
    this.failed = true;
    cancelAnimationFrame(this.frameId);
    this.onUnavailable();
  }

  frame(now) {
    if (this.failed || this.disposed) return;
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (!this.paused && !document.hidden) {
      this.time += delta;
      this.updateInfall(this.time);
    }
    if (this.flight) {
      const t = Math.min(1, (now - this.flight.start) / 1050);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.flight.fromPosition, this.flight.position, ease);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.target, ease);
      if (t === 1) this.flight = null;
    }
    if (this.navigationMode === 'fly') this.flyControls.update(delta);
    else this.controls.update();
    try {
      this.drawFrame();
      this.onProject(this.layout.clusters.map(cluster => ({ id: cluster.id, ...this.project(cluster.center) })), this.selectedNode ? this.project(this.selectedNode.position, true) : null);
    } catch { this.unavailable(); return; }
    this.frameId = requestAnimationFrame(this.frame);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.observer.disconnect();
    this.pointerAbort.abort();
    this.controls.dispose();
    this.flyControls.dispose();
    this.diskRadiance.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (object.material) object.material.dispose();
    });
    this.blackHole.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
