import * as THREE from "three";
import type { Scene, Primitive } from "../core/types.js";

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let threeScene: THREE.Scene;
let meshes: Map<string, THREE.Mesh> = new Map();

// Orbit-State (simple manuelle Implementierung)
let rotX = -0.4;
let rotY = 0.6;
let distance = 20;
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

export function initRenderer(canvas: HTMLCanvasElement): void {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0a0a0f);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  threeScene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.0);
  directional.position.set(10, 15, 10);
  directional.castShadow = true;
  threeScene.add(directional);

  // Grid
  const grid = new THREE.GridHelper(30, 30, 0x2a2a3a, 0x1a1a26);
  threeScene.add(grid);

  // Interaction
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: true });

  resize();
  window.addEventListener("resize", resize);
  animate();
}

function resize(): void {
  const parent = renderer.domElement.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function updateCamera(): void {
  camera.position.set(
    distance * Math.sin(rotY) * Math.cos(rotX),
    distance * Math.sin(-rotX) + 5,
    distance * Math.cos(rotY) * Math.cos(rotX),
  );
  camera.lookAt(0, 3, 0);
}

function animate(): void {
  requestAnimationFrame(animate);
  updateCamera();
  renderer.render(threeScene, camera);
}

// Orbit Controls (einfach)
function onPointerDown(e: PointerEvent): void {
  isDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
}

function onPointerMove(e: PointerEvent): void {
  if (!isDragging) return;
  const dx = e.clientX - lastMouse.x;
  const dy = e.clientY - lastMouse.y;
  rotY += dx * 0.008;
  rotX += dy * 0.008;
  rotX = Math.max(-1.2, Math.min(0.2, rotX));
  lastMouse = { x: e.clientX, y: e.clientY };
}

function onPointerUp(): void {
  isDragging = false;
}

function onWheel(e: WheelEvent): void {
  distance += e.deltaY * 0.02;
  distance = Math.max(5, Math.min(60, distance));
}

// Scene Sync – bringt Three.js Meshes mit der Scene in Einklang
export function syncScene(scene: Scene): void {
  const currentIds = new Set(scene.primitives.map((p) => p.id));

  // Entferne alte Meshes
  for (const [id, mesh] of meshes) {
    if (!currentIds.has(id)) {
      threeScene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      meshes.delete(id);
    }
  }

  // Füge neue Meshes hinzu / Update bestehende
  for (const prim of scene.primitives) {
    if (meshes.has(prim.id)) continue;
    const mesh = createMesh(prim);
    threeScene.add(mesh);
    meshes.set(prim.id, mesh);
  }
}

function createMesh(p: Primitive): THREE.Mesh {
  const geo = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.color),
    roughness: 0.7,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(p.position[0], p.position[1], p.position[2]);
  mesh.rotation.set(
    (p.rotation[0] * Math.PI) / 180,
    (p.rotation[1] * Math.PI) / 180,
    (p.rotation[2] * Math.PI) / 180,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Alles entfernen
export function clearRenderer(): void {
  for (const [, mesh] of meshes) {
    threeScene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  meshes.clear();
}
