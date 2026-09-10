import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLayout } from './layout.js';
import { blackHoleVertex, blackHoleFragment, pointVertex, pointFragment } from './shaders.js';

/** All artwork is generated locally. No textures, fonts or network services. */
export class Observatory {
  constructor(host, graph, { paused = false, onProject = () => {}, onPick = () => {}, onUnavailable = () => {} } = {}) {
    this.host = host;
    this.graph = graph;
    this.layout = buildLayout(graph);
    this.paused = paused;
    this.onProject = onProject;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 250);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x030407, 1);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D knowledge observatory. Drag to orbit; scroll to zoom. Sector and node controls are available alongside.');
    this.renderer.domElement.setAttribute('role', 'img');
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !paused;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 100;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.7;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.homePosition = new THREE.Vector3(-1.5, 3.8, 43);
    this.homeTarget = new THREE.Vector3(-1.5, 0, 0);
    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
    this.controls.saveState();
    this.orbital = new THREE.Group();
    this.scene.add(this.orbital);
    this.clusterObjects = new Map();
    this.addStars();
    this.addBlackHole();
    this.addConstellations();
    this.pointerAbort = new AbortController();
    const canvas = this.renderer.domElement;
    const signal = this.pointerAbort.signal;
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); onUnavailable(); }, { signal });
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

  addStars() {
    const positions = [], colors = [], sizes = [];
    let seed = 8261;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 2200; i++) {
      const z = rnd() * 2 - 1;
      const angle = rnd() * Math.PI * 2;
      const radius = 80 + rnd() * 40;
      const q = Math.sqrt(1 - z * z);
      positions.push(q * Math.cos(angle) * radius, z * radius, q * Math.sin(angle) * radius);
      const tone = rnd();
      colors.push(0.53 + tone * 0.37, 0.59 + tone * 0.3, 0.72 + tone * 0.28);
      sizes.push(rnd() < 0.04 ? 10 + rnd() * 6 : 2.8 + rnd() * 4.5);
    }
    this.scene.add(this.points(positions, colors, sizes, 0.92));

    const dustP = [], dustC = [], dustS = [];
    for (let i = 0; i < 2600; i++) {
      const angle = rnd() * Math.PI * 2;
      const radius = 4.7 + Math.pow(rnd(), 0.68) * 7.4;
      dustP.push(Math.cos(angle) * radius, (rnd() - 0.5) * 0.24, Math.sin(angle) * radius);
      dustC.push(0.9, 0.35 + rnd() * 0.25, 0.10);
      dustS.push(0.7 + rnd() * 2.0);
    }
    this.dust = this.points(dustP, dustC, dustS, 0.4);
    this.dust.rotation.z = -0.10;
    this.scene.add(this.dust);
  }

  addBlackHole() {
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), new THREE.ShaderMaterial({
      vertexShader: blackHoleVertex, fragmentShader: blackHoleFragment,
      uniforms: { uTime: { value: 0 }, uInclination: { value: 0.23 }, uRoll: { value: -0.12 } },
      transparent: true, depthWrite: false, depthTest: false,
    }));
    this.hole.scale.setScalar(1.12);
    this.hole.renderOrder = 4;
    this.scene.add(this.hole);
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
        sectorEdges.get(na.cluster).push(...na.position, ...nb.position);
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
        s.push(nodes.length <= 4 ? 16 : 5 + (Number(node.id.slice(-3)) % 9 === 0 ? 5 : 0));
      }
      const points = this.points(p, c, s);
      points.userData.nodes = nodes;
      group.add(points);
      const lines = sectorEdges.get(cluster.id);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false }));
      group.add(line);
      this.orbital.add(group);
      this.clusterObjects.set(cluster.id, { group, points, line, cluster });
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
    if (!hits.length) return null;
    return hits[0].object.userData.nodes[hits[0].index];
  }

  setPaused(value) {
    this.paused = value;
    this.controls.enableDamping = !value;
    if (value) this.flight = null;
  }

  selectCluster(id) {
    this.selectedCluster = id;
    this.selectedNode = null;
    for (const [clusterId, objects] of this.clusterObjects) {
      objects.group.visible = id === null || id === clusterId;
    }
    if (id === null) {
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
    const position = target.clone().addScaledVector(direction, this.host.clientWidth < 700 ? 15 : 13);
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

  project(position) {
    const v = new THREE.Vector3(...position).applyMatrix4(this.orbital.matrixWorld).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight, visible: v.z < 1 && v.z > 0 && Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.86 };
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    // Keep the central lens legible on a narrow screen without hiding controls.
    if (width < 700 && !this.mobileSized) {
      this.camera.position.set(-1.5, 4, 58);
      this.homePosition.copy(this.camera.position);
      this.controls.saveState();
      this.mobileSized = true;
    }
  }

  frame(now) {
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (!this.paused && !document.hidden) {
      this.time += delta;
      this.orbital.rotation.y = Math.sin(this.time * 0.016) * 0.13;
      this.orbital.rotation.z = this.time * 0.007;
      this.dust.rotation.y += delta * 0.032;
    }
    if (this.flight) {
      const t = Math.min(1, (now - this.flight.start) / 1050);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.flight.fromPosition, this.flight.position, ease);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.target, ease);
      if (t === 1) this.flight = null;
    }
    this.controls.update();
    this.hole.quaternion.copy(this.camera.quaternion);
    this.hole.material.uniforms.uTime.value = this.time;
    this.hole.material.uniforms.uInclination.value = THREE.MathUtils.clamp(0.2 + Math.abs(this.camera.position.y) * 0.006, 0.2, 0.68);
    this.renderer.render(this.scene, this.camera);
    this.onProject(this.layout.clusters.map(cluster => ({ id: cluster.id, ...this.project(cluster.center) })), this.selectedNode ? this.project(this.selectedNode.position) : null);
    this.frameId = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.observer.disconnect();
    this.pointerAbort.abort();
    this.controls.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (object.material) object.material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
