// Written with AI assistance (Claude / GitHub Copilot)
// Classic script: original low-poly models as A-Frame components, built from primitives (no downloads, no logos).
//   <a-entity mars-rover="scale: 1"></a-entity>    six-wheel science rover, ~3 m long at scale 1, origin = ground under its centre
//   <a-entity mars-habitat="scale: 1"></a-entity>  surface habitat: dome module, airlock, solar array, antenna, landing pad
// Units are metres at scale 1. The main 3D view uses a large scale so they read from kilometres away (labelled "not to scale").
(function () {
  if (!window.AFRAME) { console.error('models.js: AFRAME not found'); return; }
  if (AFRAME.components['mars-rover']) return;

  const C = { hull: '#ece6dc', dark: '#3b3733', wheel: '#7d7770', metal: '#b9b3aa', panel: '#24324a', gold: '#c9a24a', glow: '#ff8a3d' };

  function part(parent, tag, attrs) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  }
  const mat = (color, extra = '') => `color: ${color}; roughness: 0.85; metalness: 0.1${extra}`;

  function buildRover(root) {
    // wheels: 3 per side on a rocker-bogie, radius 0.26 m
    for (const z of [-1.0, 1.0]) {
      for (const x of [-1.05, 0, 1.05]) {
        part(root, 'a-cylinder', { radius: 0.26, height: 0.24, rotation: '90 0 0', position: `${x} 0.26 ${z}`, material: mat(C.wheel), 'segments-radial': 14 });
        part(root, 'a-cylinder', { radius: 0.1, height: 0.26, rotation: '90 0 0', position: `${x} 0.26 ${z}`, material: mat(C.dark) });
      }
      part(root, 'a-box', { width: 2.2, height: 0.07, depth: 0.07, position: `0 0.62 ${z * 0.92}`, rotation: '0 0 4', material: mat(C.metal) });
      part(root, 'a-box', { width: 0.07, height: 0.38, depth: 0.07, position: `-1.05 0.44 ${z * 0.92}`, material: mat(C.metal) });
      part(root, 'a-box', { width: 0.07, height: 0.38, depth: 0.07, position: `1.05 0.44 ${z * 0.92}`, material: mat(C.metal) });
    }
    // body + deck
    part(root, 'a-box', { width: 2.0, height: 0.5, depth: 1.5, position: '0 0.95 0', material: mat(C.hull) });
    part(root, 'a-box', { width: 2.05, height: 0.05, depth: 1.55, position: '0 1.22 0', material: mat(C.metal) });
    // RTG power unit, angled at the back
    part(root, 'a-cylinder', { radius: 0.22, height: 0.75, rotation: '0 0 -55', position: '-1.25 1.15 0', material: mat(C.dark) });
    for (const dz of [-0.24, 0, 0.24]) part(root, 'a-box', { width: 0.6, height: 0.02, depth: 0.12, rotation: '0 0 -55', position: `-1.25 1.15 ${dz}`, material: mat(C.dark) });
    // mast with camera head
    part(root, 'a-cylinder', { radius: 0.05, height: 1.0, position: '0.75 1.72 0.45', material: mat(C.metal) });
    part(root, 'a-box', { width: 0.22, height: 0.18, depth: 0.42, position: '0.78 2.28 0.45', material: mat(C.hull) });
    part(root, 'a-cylinder', { radius: 0.05, height: 0.04, rotation: '0 0 90', position: '0.9 2.3 0.33', material: mat(C.dark) });
    part(root, 'a-cylinder', { radius: 0.05, height: 0.04, rotation: '0 0 90', position: '0.9 2.3 0.57', material: mat(C.dark) });
    // high-gain antenna (flat hexagonal plate) and robotic arm stowed at the front
    part(root, 'a-cylinder', { radius: 0.3, height: 0.03, 'segments-radial': 6, rotation: '20 0 0', position: '-0.3 1.42 -0.45', material: mat(C.metal) });
    part(root, 'a-box', { width: 0.08, height: 0.08, depth: 1.1, position: '1.1 0.85 0', material: mat(C.metal) });
    part(root, 'a-box', { width: 0.2, height: 0.2, depth: 0.2, position: '1.15 0.85 -0.6', material: mat(C.gold) });
  }

  // Compact crew habitat: 8 m dome (~5.5 m tall) on a 20 m pad. The 1.8 m airlock door is the human-size reference.
  function buildHabitat(root) {
    // landing pad
    part(root, 'a-cylinder', { radius: 10, height: 0.15, position: '0 0.07 0', material: mat('#8f7f70'), 'segments-radial': 48 });
    part(root, 'a-ring', { 'radius-inner': 9.1, 'radius-outer': 9.5, rotation: '-90 0 0', position: '0 0.16 0', material: `color: ${C.glow}; shader: flat` });
    // main module: base ring + dome
    part(root, 'a-cylinder', { radius: 4, height: 1.4, position: '0 0.85 0', material: mat(C.hull), 'segments-radial': 32 });
    part(root, 'a-sphere', { radius: 4, 'theta-length': 90, position: '0 1.55 0', material: mat(C.hull), 'segments-width': 32, 'segments-height': 12 });
    part(root, 'a-torus', { radius: 4.02, 'radius-tubular': 0.1, rotation: '90 0 0', position: '0 1.55 0', material: mat(C.metal) });
    for (const a of [30, 150, 270]) { // windows
      const r = a * Math.PI / 180;
      part(root, 'a-box', { width: 1, height: 0.3, depth: 0.1, rotation: `0 ${90 - a} 0`, position: `${3.92 * Math.cos(r)} 2.4 ${-3.92 * Math.sin(r)}`, material: `color: ${C.glow}; shader: flat` });
    }
    // airlock tunnel + door module
    part(root, 'a-cylinder', { radius: 1.1, height: 2.6, rotation: '0 0 90', position: '5 1.3 0', material: mat(C.hull) });
    part(root, 'a-box', { width: 2.4, height: 2.6, depth: 2.6, position: '7.4 1.3 0', material: mat(C.hull) });
    part(root, 'a-box', { width: 0.05, height: 1.8, depth: 1, position: '8.62 1.1 0', material: mat(C.dark) });
    // solar array: two wings on posts
    for (const z of [-7, 7]) {
      part(root, 'a-cylinder', { radius: 0.1, height: 1.6, position: `-2.5 0.8 ${z}`, material: mat(C.metal) });
      part(root, 'a-box', { width: 6, height: 0.08, depth: 2.6, rotation: '25 0 0', position: `-2.5 1.7 ${z}`, material: mat(C.panel, '; metalness: 0.4; roughness: 0.4') });
    }
    // antenna mast + dish
    part(root, 'a-cylinder', { radius: 0.1, height: 6, position: '-5.5 3 -3', material: mat(C.metal) });
    part(root, 'a-cone', { 'radius-bottom': 1.1, 'radius-top': 0.15, height: 0.4, rotation: '-60 0 0', position: '-5.5 6.1 -3', material: mat(C.hull) });
    part(root, 'a-sphere', { radius: 0.2, position: '-5.5 6.35 -3', material: `color: ${C.glow}; shader: flat` });
  }

  function register(name, build) {
    AFRAME.registerComponent(name, {
      schema: { scale: { type: 'number', default: 1 } },
      init() {
        this.root = document.createElement('a-entity');
        build(this.root);
        this.el.append(this.root);
        this.update();
      },
      update() { if (this.root) this.root.object3D.scale.setScalar(this.data.scale); },
      remove() { this.root?.remove(); }
    });
  }
  register('mars-rover', buildRover);
  register('mars-habitat', buildHabitat);
})();
