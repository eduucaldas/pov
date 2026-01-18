import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// Configuration
const STAR_COUNT = 800; // Sample from horse vertices
const CAMERA_DISTANCE = 100;
const ANIMATION_DURATION = 3000; // ms
const SECRET_THETA = 142;
const SECRET_PHI = 68;
const COORDINATE_TOLERANCE = 1; // degrees

// Viewing vectors (direction camera looks FROM to see the shape)
// Horse: visible from initial position (theta=0, phi=90)
const HORSE_THETA = 0;
const HORSE_PHI = 90;
// Ring: visible from secret coordinates
const RING_THETA = SECRET_THETA;
const RING_PHI = SECRET_PHI;

// Random depth range for scattered stars
const DEPTH_RANGE = 30;

// Camouflage stars
const CAMOUFLAGE_STAR_COUNT = 2500;

// State
let currentTheta = 0;
let currentPhi = 90;
let isAnimating = false;
let isDragging = false;
let previousMouseX = 0;
let previousMouseY = 0;
let isLoaded = false;
let horseLoaded = false;
let ringLoaded = false;

// Three.js objects
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let stars: THREE.Points;
let ringStars: THREE.Points;

// DOM elements
const app = document.getElementById("app")!;
const thetaInput = document.getElementById("theta") as HTMLInputElement;
const phiInput = document.getElementById("phi") as HTMLInputElement;
const goButton = document.getElementById("go-button")!;
const currentThetaSpan = document.getElementById("current-theta")!;
const currentPhiSpan = document.getElementById("current-phi")!;
const proposalMessage = document.getElementById("proposal-message")!;
const loadingOverlay = document.getElementById("loading-overlay")!;
const controls = document.getElementById("controls")!;
const mobileCoords = document.getElementById("mobile-coords")!;
const mobileThetaSpan = document.getElementById("mobile-theta")!;
const mobilePhiSpan = document.getElementById("mobile-phi")!;
const mobileHint = document.getElementById("mobile-hint")!;

function init(): void {
  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  updateCameraPosition();

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  app.appendChild(renderer.domElement);

  // Load horse model and ring model
  loadHorseModel();
  createRingConstellation();

  // Event listeners
  goButton.addEventListener("click", handleGo);
  window.addEventListener("resize", handleResize);

  // Mouse drag controls
  renderer.domElement.addEventListener("mousedown", handleMouseDown);
  renderer.domElement.addEventListener("mousemove", handleMouseMove);
  renderer.domElement.addEventListener("mouseup", handleMouseUp);
  renderer.domElement.addEventListener("mouseleave", handleMouseUp);

  // Touch controls for mobile
  renderer.domElement.addEventListener("touchstart", handleTouchStart);
  renderer.domElement.addEventListener("touchmove", handleTouchMove);
  renderer.domElement.addEventListener("touchend", handleTouchEnd);

  // Start render loop
  animate();
}

function checkAllLoaded(): void {
  if (!horseLoaded || !ringLoaded || isLoaded) return;

  isLoaded = true;

  // Create camouflage stars now that everything is loaded
  createCamouflageStars();

  // Fade out loading overlay
  loadingOverlay.classList.add("hidden");

  // Show controls after a short delay
  setTimeout(() => {
    controls.classList.add("visible");
    mobileCoords.classList.add("visible");
    mobileHint.classList.add("visible");

    // Hide hint after 4 seconds
    setTimeout(() => {
      mobileHint.classList.remove("visible");
    }, 4000);
  }, 500);
}

function loadHorseModel(): void {
  const loader = new OBJLoader();
  loader.load(
    "horse/16267_American_Paint_Horse_Nuetral_new.obj",
    (object) => {
      // Collect all vertices from the loaded model
      const allVertices: THREE.Vector3[] = [];

      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const geometry = child.geometry;
          const positions = geometry.getAttribute("position");

          for (let i = 0; i < positions.count; i++) {
            allVertices.push(
              new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
              )
            );
          }
        }
      });

      // Create stars from sampled vertices
      createHorseStars(allVertices);
      horseLoaded = true;
      checkAllLoaded();
    },
    undefined,
    (error) => {
      console.error("Error loading horse model:", error);
      // Fallback to random stars
      createRandomStars();
      horseLoaded = true;
      checkAllLoaded();
    }
  );
}

// Convert theta/phi to a unit direction vector (pointing FROM camera TO origin)
function getViewDirection(theta: number, phi: number): THREE.Vector3 {
  const thetaRad = (theta * Math.PI) / 180;
  const phiRad = (phi * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(phiRad) * Math.cos(thetaRad),
    Math.cos(phiRad),
    Math.sin(phiRad) * Math.sin(thetaRad)
  );
}

// Project vertices onto a plane and scatter along the view direction
function projectAndScatter(
  vertices: THREE.Vector3[],
  viewDir: THREE.Vector3,
  modelScale: number
): Float32Array {
  const positions = new Float32Array(vertices.length * 3);

  // Create orthonormal basis for the projection plane
  // planeX and planeY are the two axes of the plane perpendicular to viewDir
  const up = Math.abs(viewDir.y) < 0.99
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const planeX = new THREE.Vector3().crossVectors(up, viewDir).normalize();
  const planeY = new THREE.Vector3().crossVectors(viewDir, planeX).normalize();

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;

    // Project vertex onto the plane (get 2D coordinates on the plane)
    const projX = v.dot(planeX);
    const projY = v.dot(planeY);

    // Random depth along the view direction
    const depth = (Math.random() - 0.5) * DEPTH_RANGE;

    // Reconstruct 3D position: 2D projection + random depth
    const point = new THREE.Vector3()
      .addScaledVector(planeX, projX * modelScale)
      .addScaledVector(planeY, projY * modelScale)
      .addScaledVector(viewDir, depth);

    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
  }

  return positions;
}

function createHorseStars(vertices: THREE.Vector3[]): void {
  // Sample vertices
  const sampledVertices: THREE.Vector3[] = [];
  const step = Math.max(1, Math.floor(vertices.length / STAR_COUNT));

  for (let i = 0; i < vertices.length && sampledVertices.length < STAR_COUNT; i += step) {
    sampledVertices.push(vertices[i]!);
  }

  // Center the vertices
  const box = new THREE.Box3();
  sampledVertices.forEach((v) => box.expandByPoint(v));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  // Center vertices and swap Y/Z to stand upright
  const centeredVertices = sampledVertices.map((v) =>
    new THREE.Vector3(
      v.x - center.x,
      v.z - center.z,  // Swap Y and Z for upright orientation
      -(v.y - center.y)
    )
  );

  // Get viewing direction for horse
  const viewDir = getViewDirection(HORSE_THETA, HORSE_PHI);
  const modelScale = 50 / maxDim;

  // Project and scatter
  const positions = projectAndScatter(centeredVertices, viewDir, modelScale);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  });

  stars = new THREE.Points(geometry, material);
  scene.add(stars);
}

function createRandomStars(): void {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 40 + Math.random() * 20;

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
  });

  stars = new THREE.Points(geometry, material);
  scene.add(stars);
}

function createCamouflageStars(): void {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(CAMOUFLAGE_STAR_COUNT * 3);

  for (let i = 0; i < CAMOUFLAGE_STAR_COUNT; i++) {
    // Random position in a cube around the origin
    positions[i * 3] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
  });

  const camouflageStars = new THREE.Points(geometry, material);
  scene.add(camouflageStars);
}

function createRingConstellation(): void {
  const loader = new OBJLoader();
  loader.load(
    "ring/the_crowned_ring.obj",
    (object) => {
      const allVertices: THREE.Vector3[] = [];

      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const geometry = child.geometry;
          const positions = geometry.getAttribute("position");

          for (let i = 0; i < positions.count; i++) {
            allVertices.push(
              new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
              )
            );
          }
        }
      });

      createRingStars(allVertices);
      ringLoaded = true;
      checkAllLoaded();
    },
    undefined,
    (error) => {
      console.error("Error loading ring model:", error);
      ringLoaded = true;
      checkAllLoaded();
    }
  );
}

function createRingStars(vertices: THREE.Vector3[]): void {
  // Sample vertices
  const ringStarCount = 200;
  const sampledVertices: THREE.Vector3[] = [];
  const step = Math.max(1, Math.floor(vertices.length / ringStarCount));

  for (let i = 0; i < vertices.length && sampledVertices.length < ringStarCount; i += step) {
    sampledVertices.push(vertices[i]!);
  }

  // Center the vertices
  const box = new THREE.Box3();
  sampledVertices.forEach((v) => box.expandByPoint(v));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  // Center vertices
  const centeredVertices = sampledVertices.map((v) =>
    new THREE.Vector3(
      v.x - center.x,
      v.y - center.y,
      v.z - center.z
    )
  );

  // Get viewing direction for ring
  const viewDir = getViewDirection(RING_THETA, RING_PHI);
  const modelScale = 15 / maxDim;

  // Project and scatter
  const positions = projectAndScatter(centeredVertices, viewDir, modelScale);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  });

  ringStars = new THREE.Points(geometry, material);
  scene.add(ringStars);
}

// Mouse controls
function handleMouseDown(event: MouseEvent): void {
  if (!isLoaded || isAnimating) return;
  isDragging = true;
  previousMouseX = event.clientX;
  previousMouseY = event.clientY;
  renderer.domElement.style.cursor = "grabbing";
}

function handleMouseMove(event: MouseEvent): void {
  if (!isLoaded || !isDragging || isAnimating) return;

  const deltaX = event.clientX - previousMouseX;
  const deltaY = event.clientY - previousMouseY;

  // Adjust sensitivity (degrees per pixel)
  const sensitivity = 0.3;

  currentTheta -= deltaX * sensitivity;
  currentPhi += deltaY * sensitivity;

  // Normalize theta to 0-360
  currentTheta = ((currentTheta % 360) + 360) % 360;

  // Clamp phi to 1-179 (avoid gimbal lock at poles)
  currentPhi = Math.max(1, Math.min(179, currentPhi));

  updateCameraPosition();

  previousMouseX = event.clientX;
  previousMouseY = event.clientY;
}

function handleMouseUp(): void {
  if (isDragging) {
    isDragging = false;
    renderer.domElement.style.cursor = "grab";
    checkProposalReveal();
  }
}

// Touch controls
function handleTouchStart(event: TouchEvent): void {
  if (!isLoaded || isAnimating || event.touches.length !== 1) return;
  isDragging = true;
  const touch = event.touches[0]!;
  previousMouseX = touch.clientX;
  previousMouseY = touch.clientY;

  // Hide hint on first interaction
  mobileHint.classList.remove("visible");
}

function handleTouchMove(event: TouchEvent): void {
  if (!isLoaded || !isDragging || isAnimating || event.touches.length !== 1) return;
  event.preventDefault();

  const touch = event.touches[0]!;
  const deltaX = touch.clientX - previousMouseX;
  const deltaY = touch.clientY - previousMouseY;

  const sensitivity = 0.3;

  currentTheta -= deltaX * sensitivity;
  currentPhi += deltaY * sensitivity;

  currentTheta = ((currentTheta % 360) + 360) % 360;
  currentPhi = Math.max(1, Math.min(179, currentPhi));

  updateCameraPosition();

  previousMouseX = touch.clientX;
  previousMouseY = touch.clientY;
}

function handleTouchEnd(): void {
  if (isDragging) {
    isDragging = false;
    checkProposalReveal();
  }
}

function updateCameraPosition(): void {
  // Convert spherical to Cartesian
  // theta: azimuthal angle (0-360, around Y axis)
  // phi: polar angle (0-180, from top)
  const thetaRad = (currentTheta * Math.PI) / 180;
  const phiRad = (currentPhi * Math.PI) / 180;

  camera.position.x = CAMERA_DISTANCE * Math.sin(phiRad) * Math.cos(thetaRad);
  camera.position.y = CAMERA_DISTANCE * Math.cos(phiRad);
  camera.position.z = CAMERA_DISTANCE * Math.sin(phiRad) * Math.sin(thetaRad);

  camera.lookAt(0, 0, 0);

  // Update display
  currentThetaSpan.textContent = Math.round(currentTheta).toString();
  currentPhiSpan.textContent = Math.round(currentPhi).toString();
  mobileThetaSpan.textContent = Math.round(currentTheta).toString();
  mobilePhiSpan.textContent = Math.round(currentPhi).toString();

  // Check if we should show/hide the proposal
  checkProposalReveal();
}

function handleGo(): void {
  if (!isLoaded || isAnimating) return;

  const targetTheta = parseFloat(thetaInput.value) || 0;
  const targetPhi = parseFloat(phiInput.value) || 90;

  animateTo(targetTheta, targetPhi);
}

function animateTo(targetTheta: number, targetPhi: number): void {
  isAnimating = true;
  goButton.textContent = "...";

  const startTheta = currentTheta;
  const startPhi = currentPhi;
  const startTime = performance.now();

  // Normalize theta difference for shortest path
  let deltaTheta = targetTheta - startTheta;
  if (deltaTheta > 180) deltaTheta -= 360;
  if (deltaTheta < -180) deltaTheta += 360;

  function step(currentTime: number): void {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

    // Ease in-out cubic
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    currentTheta = startTheta + deltaTheta * eased;
    currentPhi = startPhi + (targetPhi - startPhi) * eased;

    // Normalize theta
    if (currentTheta < 0) currentTheta += 360;
    if (currentTheta >= 360) currentTheta -= 360;

    updateCameraPosition();

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      isAnimating = false;
      goButton.textContent = "Go!";
      checkProposalReveal();
    }
  }

  requestAnimationFrame(step);
}

function checkProposalReveal(): void {
  const thetaDiff = Math.abs(currentTheta - SECRET_THETA);
  const phiDiff = Math.abs(currentPhi - SECRET_PHI);

  // Account for theta wrapping
  const thetaDiffWrapped = Math.min(thetaDiff, 360 - thetaDiff);

  if (
    thetaDiffWrapped <= COORDINATE_TOLERANCE &&
    phiDiff <= COORDINATE_TOLERANCE
  ) {
    proposalMessage.classList.add("visible");
  } else {
    proposalMessage.classList.remove("visible");
  }
}

function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(): void {
  requestAnimationFrame(animate);

  // Subtle star twinkling
  if (stars) {
    const time = performance.now() * 0.001;
    const material = stars.material as THREE.PointsMaterial;
    material.opacity = 0.7 + Math.sin(time) * 0.1;
  }

  renderer.render(scene, camera);
}

// Start the app
init();
