import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

const vertexShader = `
  attribute vec3 targetPosition;
  attribute vec3 targetColor;
  uniform float uMorph;
  uniform float uScatter;
  uniform float uPointSize;
  uniform float uTime;
  uniform float uVisibility;
  varying vec3 vColor;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
  void main() {
    vec3 p = mix(position, targetPosition, uMorph);
    float seed = hash(position + targetPosition);
    vec3 burst = normalize(vec3(
      hash(p + 1.2) - .5,
      hash(p + 4.7) - .5,
      hash(p + 9.1) - .5
    ));
    float wave = sin(uTime * 2.0 + seed * 18.0) * .12;
    p += burst * uScatter * (1.0 + seed * 2.6 + wave);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPointSize * (5.0 / max(1.0, -mv.z));
    vColor = mix(color, targetColor, uMorph);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec3 vColor;
  uniform float uVisibility;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float d = length(uv);
    if (d > .5) discard;
    float alpha = smoothstep(.5, .16, d);
    vec3 glow = vColor * (1.35 + alpha * .55);
    gl_FragColor = vec4(glow, alpha * uVisibility);
  }
`;

function normalizeGeometry(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  geometry.translate(-center.x, -center.y, -center.z);
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  geometry.scale(1.8 / maxSize, 1.8 / maxSize, 1.8 / maxSize);
  return geometry;
}

export class PointCloudScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    this.camera.position.z = 4.7;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.points = null;
    this.morph = 0;
    this.morphTarget = 0;
    this.scatter = 0;
    this.visibility = 0;
    this.shapeIndex = 0;
  }

  async initialize() {
    const loader = new PLYLoader();
    const base = import.meta.env.BASE_URL;
    const [sphere, torus] = await Promise.all([
      loader.loadAsync(new URL(`${base}assets/01-red-sphere.ply`, location.href).href),
      loader.loadAsync(new URL(`${base}assets/02-blue-torus.ply`, location.href).href),
    ]);
    normalizeGeometry(sphere);
    normalizeGeometry(torus);
    const count = Math.min(sphere.getAttribute("position").count, torus.getAttribute("position").count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sphere.getAttribute("position").array.slice(0, count * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(sphere.getAttribute("color").array.slice(0, count * 3), 3));
    geometry.setAttribute("targetPosition", new THREE.BufferAttribute(torus.getAttribute("position").array.slice(0, count * 3), 3));
    geometry.setAttribute("targetColor", new THREE.BufferAttribute(torus.getAttribute("color").array.slice(0, count * 3), 3));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMorph: { value: 0 }, uScatter: { value: 0 }, uPointSize: { value: innerWidth < 600 ? 5.2 : 4.2 }, uTime: { value: 0 }, uVisibility: { value: 0 },
      },
      vertexShader, fragmentShader, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.group.add(this.points);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  update(signal, now) {
    if (!this.points) return;
    if (signal.released) {
      this.shapeIndex = 1 - this.shapeIndex;
      this.morphTarget = this.shapeIndex;
    }
    this.visibility += ((signal.active ? 1 : 0) - this.visibility) * .13;
    this.scatter += ((signal.active && signal.pinching ? signal.pinch : 0) * .72 - this.scatter) * .14;
    this.morph += (this.morphTarget - this.morph) * .055;
    this.points.material.uniforms.uMorph.value = this.morph;
    this.points.material.uniforms.uScatter.value = this.scatter;
    this.points.material.uniforms.uTime.value = now * .001;
    this.points.material.uniforms.uVisibility.value = this.visibility;
    if (signal.active) {
      this.group.position.x += ((((signal.screenX ?? (1 - signal.x)) - .5) * 3.0) - this.group.position.x) * .16;
      this.group.position.y += (((.5 - signal.y) * 4.2) - this.group.position.y) * .16;
      const s = signal.scale;
      this.group.scale.lerp(new THREE.Vector3(s, s, s), .13);
    }
    this.group.rotation.y += .0035;
    this.group.rotation.x = Math.sin(now * .00045) * .08;
    this.renderer.render(this.scene, this.camera);
  }
}
