import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// NEON VELOCITY — modular Three.js arcade driving game
const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b19);
scene.fog = new THREE.FogExp2(0x070b19, 0.014);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 260);
camera.position.set(0, 7.3, 13.5);
camera.lookAt(0, 0, -7);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const clock = new THREE.Clock();
const COLORS = { cyan: 0x53f6ff, pink: 0xff4fa3, violet: 0x916bff, road: 0x11182b };
const mat = (color, roughness = .45, metalness = .25, emissive = 0x000000, intensity = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: intensity });
const mats = {
  asphalt: mat(0x11182b, .9, .05), lane: mat(0x53eaff, .45, .2, 0x1aaabb, .5),
  cyan: mat(0x53f6ff, .25, .6, 0x24ddeb, 1.7), pink: mat(0xff4fa3, .3, .45, 0xff237e, 1.4),
  dark: mat(0x10182a, .4, .6), glass: new THREE.MeshPhysicalMaterial({ color: 0x142c48, metalness: .65, roughness: .16, clearcoat: 1 }),
  white: mat(0xeafaff, .3, .55), tire: mat(0x080a10, .95, .02), gold: mat(0xffc857, .25, .6, 0xff9d18, 1.5)
};

let gameState = 'menu', score = 0, distance = 0, credits = 0, nitro = 100, speed = 0;
let bestDistance = Number(localStorage.getItem('nvBestDistance') || 0);
let boostActive = false, spawnClock = 0, coinClock = 0, shake = 0, hitCooldown = 0;
const keys = new Set();
const worldObjects = [], traffic = [], pickups = [], particles = [], roadSegments = [];
const lanes = [-3.15, 0, 3.15];
let player, playerWheels = [], playerGlow;

function addLights() {
  scene.add(new THREE.HemisphereLight(0x9bbaff, 0x10101c, 1.45));
  const key = new THREE.DirectionalLight(0xc4e9ff, 2.1);
  key.position.set(-8, 15, 7); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -20; key.shadow.camera.right = 20; key.shadow.camera.top = 20; key.shadow.camera.bottom = -20;
  scene.add(key);
  const pink = new THREE.PointLight(0xff318f, 24, 45); pink.position.set(10, 7, -16); scene.add(pink);
  const blue = new THREE.PointLight(0x24dfff, 20, 42); blue.position.set(-11, 6, -30); scene.add(blue);
}
addLights();

function box(parent, size, position, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position); mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
}
function cylinder(parent, radiusTop, radiusBottom, height, position, material, segments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(...position); mesh.castShadow = true; parent.add(mesh); return mesh;
}
function createCar(primary = 0x23c9e8, isPlayer = false) {
  const root = new THREE.Group();
  const paint = mat(primary, .24, .72, primary, .23);
  const body = box(root, [1.75, .55, 3.45], [0, .68, 0], paint);
  body.geometry = new THREE.BoxGeometry(1.75, .55, 3.45);
  // sculpted hood and cabin
  box(root, [1.55, .22, 1.0], [0, .99, -.98], paint);
  const cabin = box(root, [1.35, .7, 1.62], [0, 1.22, .28], mats.glass);
  cabin.scale.x = .9;
  box(root, [1.58, .12, .7], [0, .87, 1.42], paint);
  // bumpers, side skirts, neon trim
  box(root, [1.82, .16, .22], [0, .49, -1.72], mats.dark);
  box(root, [1.82, .16, .22], [0, .49, 1.72], mats.dark);
  box(root, [1.82, .045, 2.8], [0, .37, 0], isPlayer ? mats.cyan : mats.pink, false, false);
  // headlights
  for (const x of [-.58, .58]) {
    const lamp = box(root, [.32, .12, .06], [x, .76, -1.76], mats.white, false, false);
    const light = new THREE.PointLight(0x9cefff, isPlayer ? 2.2 : .5, 9); light.position.set(x, .7, -2); root.add(light);
    box(root, [.3, .11, .06], [x, .72, 1.76], mats.pink, false, false);
  }
  const wheels = [];
  for (const x of [-.94, .94]) for (const z of [-1.08, 1.08]) {
    const wheel = cylinder(root, .39, .39, .23, [x, .42, z], mats.tire, 20);
    wheel.rotation.z = Math.PI / 2; wheels.push(wheel);
    const hub = cylinder(root, .18, .18, .24, [x, .42, z], mats.cyan, 12); hub.rotation.z = Math.PI / 2;
  }
  if (isPlayer) {
    const under = new THREE.PointLight(0x27dfff, 3.5, 7); under.position.set(0, .2, 0); root.add(under);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.4), new THREE.MeshBasicMaterial({ color: 0x21dcff, transparent: true, opacity: .15, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = .08; root.add(glow);
    playerGlow = glow;
  }
  root.userData.wheels = wheels;
  return root;
}

function createRoad() {
  const road = new THREE.Mesh(new THREE.PlaneGeometry(13, 260), mats.asphalt);
  road.rotation.x = -Math.PI / 2; road.position.set(0, -.03, -95); road.receiveShadow = true; scene.add(road);
  // road edges
  for (const x of [-6.65, 6.65]) {
    const rail = box(scene, [.13, .16, 260], [x, .05, -95], mats.cyan, false);
    rail.material = mat(0x48dfff, .35, .4, 0x1dc9ff, 1.4);
  }
  // repeating lane markers
  for (let z = -220; z < 20; z += 10) {
    for (const x of [-1.58, 1.58]) {
      const marker = box(scene, [.055, .025, 4.2], [x, .015, z], mats.lane, false, false);
      roadSegments.push(marker);
    }
  }
  // city skyline on both sides
  for (let side of [-1, 1]) {
    for (let i = 0; i < 35; i++) {
      const h = THREE.MathUtils.randFloat(5, 24), w = THREE.MathUtils.randFloat(3, 7), d = THREE.MathUtils.randFloat(4, 9);
      const x = side * THREE.MathUtils.randFloat(10, 24), z = -i * 8 - THREE.MathUtils.randFloat(0, 8);
      const building = new THREE.Group();
      const base = box(building, [w, h, d], [0, h / 2, 0], mat(i % 3 === 0 ? 0x182443 : 0x101a31, .8, .2), true);
      // lit windows in horizontal strips
      const windowMat = mat(i % 2 ? 0x42eaff : 0xff4caa, .35, .2, i % 2 ? 0x19b9ff : 0xd51d80, .9);
      for (let yy = 1.5; yy < h - 1; yy += 2.2) {
        for (let xx = -w / 2 + .65; xx < w / 2 - .3; xx += 1.15) {
          if (Math.random() > .27) box(building, [.42, .72, .035], [xx, yy, d / 2 + .02], windowMat, false, false);
        }
      }
      building.position.set(x, 0, z); scene.add(building); worldObjects.push({ mesh: building, speed: 1.0 });
    }
  }
}
createRoad();

player = createCar(0x1acbe8, true);
player.position.set(0, 0, 5.5); scene.add(player);

function makeTraffic() {
  const palette = [0xff3c8e, 0x8c6cff, 0xffb84d, 0x36d7a5, 0xe6f2ff];
  const car = createCar(palette[Math.floor(Math.random() * palette.length)]);
  const lane = lanes[Math.floor(Math.random() * lanes.length)];
  car.position.set(lane, 0, -125);
  const scale = THREE.MathUtils.randFloat(.88, 1.05); car.scale.setScalar(scale);
  scene.add(car); traffic.push({ mesh: car, zSpeed: THREE.MathUtils.randFloat(.75, 1.2), lane });
}
function makePickup() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.48, .12, 10, 24), mats.gold); ring.rotation.x = Math.PI / 2; group.add(ring);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.2, 1), mats.white); group.add(core);
  const glow = new THREE.PointLight(0xffbd4d, 1.5, 4); group.add(glow);
  group.position.set(lanes[Math.floor(Math.random() * 3)], 1.55, -125); scene.add(group);
  pickups.push({ mesh: group, spin: Math.random() * 6 });
}
function makeSparks(position, color = 0x53f6ff, count = 12) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(.045, 5, 5), new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.copy(position); scene.add(mesh);
    particles.push({ mesh, vel: new THREE.Vector3(THREE.MathUtils.randFloatSpread(1.5), Math.random() * 1.5, THREE.MathUtils.randFloatSpread(1.5)), life: 1 });
  }
}
function setScreen(id) {
  ['menuScreen', 'pauseScreen', 'gameOverScreen'].forEach(s => $(s).classList.toggle('active', s === id));
}
function resetRun() {
  score = 0; distance = 0; credits = 0; nitro = 100; speed = 0; spawnClock = 0; coinClock = 0; hitCooldown = 0; shake = 0;
  traffic.forEach(o => scene.remove(o.mesh)); traffic.length = 0;
  pickups.forEach(o => scene.remove(o.mesh)); pickups.length = 0;
  particles.forEach(o => scene.remove(o.mesh)); particles.length = 0;
  player.position.set(0, 0, 5.5); player.rotation.set(0, 0, 0);
  updateHud(); gameState = 'playing'; setScreen('');
}
function startRun() { resetRun(); }
function updateHud() {
  $('speedValue').textContent = String(Math.round(speed)).padStart(3, '0');
  $('speedBar').style.width = `${Math.min(100, speed / 260 * 100)}%`;
  $('distanceValue').textContent = distance.toFixed(2);
  $('scoreValue').textContent = String(Math.floor(score)).padStart(6, '0');
  $('coinValue').textContent = String(credits).padStart(3, '0');
  $('nitroPercent').textContent = `${Math.round(nitro)}%`;
  $('nitroBar').style.width = `${nitro}%`;
  $('bestValue').textContent = `${bestDistance.toFixed(2)} KM`;
  $('missionProgress').textContent = `${Math.min(distance, 1.5).toFixed(2)} / 1.5 KM`;
}
function showToast(text) {
  const el = $('toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => el.classList.remove('show'), 900);
}
function crash() {
  if (hitCooldown > 0) return;
  hitCooldown = 1.35; shake = .55; nitro = Math.max(0, nitro - 18);
  makeSparks(player.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xff4f8b, 24);
  $('damageFlash').classList.remove('hit'); void $('damageFlash').offsetWidth; $('damageFlash').classList.add('hit');
  speed = Math.max(55, speed * .55);
  if (speed <= 58) finishRun();
}
function finishRun() {
  gameState = 'over';
  bestDistance = Math.max(bestDistance, distance); localStorage.setItem('nvBestDistance', bestDistance.toFixed(2));
  $('finalScore').textContent = Math.floor(score).toLocaleString();
  $('finalDistance').textContent = `${distance.toFixed(2)} KM`;
  $('finalCoins').textContent = credits;
  updateHud(); setScreen('gameOverScreen');
}
function pause() { if (gameState === 'playing') { gameState = 'paused'; setScreen('pauseScreen'); } }
function resume() { if (gameState === 'paused') { gameState = 'playing'; setScreen(''); clock.getDelta(); } }

function updatePlayer(dt) {
  const steer = (keys.has('ArrowLeft') || keys.has('KeyA') ? -1 : 0) + (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
  const accelerating = keys.has('ArrowUp') || keys.has('KeyW');
  const braking = keys.has('ArrowDown') || keys.has('KeyS');
  boostActive = (keys.has('ShiftLeft') || keys.has('ShiftRight') || touchNitro) && nitro > 0;
  const target = boostActive ? 255 : accelerating ? 205 : braking ? 78 : 150;
  speed = THREE.MathUtils.damp(speed, target, boostActive ? 2.5 : 1.5, dt);
  if (boostActive) nitro = Math.max(0, nitro - 28 * dt); else nitro = Math.min(100, nitro + 8 * dt);
  const maxX = 4.75;
  player.position.x = THREE.MathUtils.clamp(player.position.x + steer * 10.5 * dt, -maxX, maxX);
  player.position.y = Math.sin(performance.now() * .009) * .012;
  player.rotation.z = THREE.MathUtils.damp(player.rotation.z, -steer * .13, 7, dt);
  player.rotation.y = THREE.MathUtils.damp(player.rotation.y, -steer * .08, 6, dt);
  player.userData.wheels.forEach(w => w.rotation.x -= speed * dt * .025);
  playerGlow.material.opacity = boostActive ? .28 : .13;
  camera.position.x = THREE.MathUtils.damp(camera.position.x, player.position.x * .22, 2.2, dt);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, 7.2 + (boostActive ? .3 : 0), 2, dt);
  camera.lookAt(player.position.x * .12, 0, -7);
  if (boostActive && Math.random() < .18) makeSparks(player.position.clone().add(new THREE.Vector3(0, .35, 2)), 0x48eaff, 1);
  hitCooldown = Math.max(0, hitCooldown - dt);
}

function updateWorld(dt) {
  const worldSpeed = speed * .095;
  roadSegments.forEach(m => { m.position.z += worldSpeed * dt * 13; if (m.position.z > 12) m.position.z -= 230; });
  worldObjects.forEach(o => { o.mesh.position.z += worldSpeed * dt * 13 * o.speed; if (o.mesh.position.z > 25) o.mesh.position.z -= 300; });
  spawnClock += dt; coinClock += dt;
  const trafficInterval = Math.max(.62, 1.65 - distance * .012);
  if (spawnClock > trafficInterval) { spawnClock = 0; makeTraffic(); }
  if (coinClock > 1.15) { coinClock = 0; makePickup(); }
  traffic.forEach((o) => {
    o.mesh.position.z += worldSpeed * dt * 13 * o.zSpeed;
    o.mesh.userData.wheels.forEach(w => w.rotation.x -= speed * dt * .018);
    if (Math.abs(o.mesh.position.z - player.position.z) < 2.55 && Math.abs(o.mesh.position.x - player.position.x) < 1.65) crash();
  });
  for (let i = traffic.length - 1; i >= 0; i--)if (traffic[i].mesh.position.z > 18) { scene.remove(traffic[i].mesh); traffic.splice(i, 1); score += 150; }
  pickups.forEach(o => {
    o.mesh.position.z += worldSpeed * dt * 13; o.mesh.rotation.y += dt * 1.8; o.mesh.rotation.z += dt * .8;
    if (Math.abs(o.mesh.position.z - player.position.z) < 1.8 && Math.abs(o.mesh.position.x - player.position.x) < 1.35) {
      credits++; score += 500; nitro = Math.min(100, nitro + 12); makeSparks(o.mesh.position, 0xffc857, 14); o.collected = true; showToast('+500 CREDITS');
    }
  });
  for (let i = pickups.length - 1; i >= 0; i--)if (pickups[i].collected || pickups[i].mesh.position.z > 18) { scene.remove(pickups[i].mesh); pickups.splice(i, 1); }
  particles.forEach(p => { p.life -= dt * 1.8; p.mesh.position.addScaledVector(p.vel, dt); p.vel.y -= dt * 2.5; p.mesh.scale.setScalar(Math.max(.01, p.life)); });
  for (let i = particles.length - 1; i >= 0; i--)if (particles[i].life <= 0) { scene.remove(particles[i].mesh); particles.splice(i, 1); }
  distance += speed * dt / 3600; score += speed * dt * .42;
  if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - .5) * shake * .7; }
  updateHud();
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .04);
  if (gameState === 'playing') { updatePlayer(dt); updateWorld(dt); }
  else if (gameState === 'menu') {
    player.position.y = Math.sin(performance.now() * .0015) * .025;
    player.rotation.y = Math.sin(performance.now() * .0007) * .025;
  }
  renderer.render(scene, camera);
}
animate();

// Input: keyboard + pointer controls for touch devices.
let touchNitro = false;
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyP' || e.code === 'Escape') pause();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (gameState === 'playing') pause(); });
$('startButton').addEventListener('click', startRun);
$('resumeButton').addEventListener('click', resume);
$('pauseRestart').addEventListener('click', startRun);
$('retryButton').addEventListener('click', startRun);
$('menuButton').addEventListener('click', () => { gameState = 'menu'; setScreen('menuScreen'); });
let audioOn = true;
$('audioButton').addEventListener('click', () => { audioOn = !audioOn; $('audioLabel').textContent = audioOn ? 'AUDIO ON' : 'AUDIO OFF'; });
document.querySelectorAll('.mobile-controls button').forEach(button => {
  const control = button.dataset.control;
  const code = control === 'left' ? 'ArrowLeft' : control === 'right' ? 'ArrowRight' : null;
  const down = e => { e.preventDefault(); if (control === 'nitro') touchNitro = true; else keys.add(code); };
  const up = e => { e.preventDefault(); if (control === 'nitro') touchNitro = false; else keys.delete(code); };
  button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up); button.addEventListener('pointerleave', up);
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
});

// Lightweight boot sequence and saved best distance.
let progress = 0;
const bootTimer = setInterval(() => {
  progress = Math.min(100, progress + Math.floor(Math.random() * 17 + 8));
  $('bootProgress').style.width = progress + '%';
  if (progress >= 100) { clearInterval(bootTimer); setTimeout(() => $('boot').classList.add('done'), 250); }
}, 130);
updateHud();
