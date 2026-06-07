// lib/faceJeeliz.ts
//
// Web-only live face-tattoo try-on via Jeeliz FaceFilter (Apache-2.0) + Three.js.
//
// Jeeliz provides head POSE ONLY per frame (detected, x, y, s, rx/ry/rz) — no face
// mesh — so the tattoo is rendered as a tracked, gently-curved textured plane in our
// own Three.js scene, posed each frame from the tracker. It bends over that plane and
// tracks head turn/tilt/lean in WebGL (no canvas-2D flicker); it does NOT mold to the
// user's exact face (expected with pose-only tracking).
//
// Jeeliz (its own canonical CDN, UMD), its neural-net model, and Three.js (CDN ESM) are
// lazy-loaded on first use, so body-only sessions never download them. The MediaPipe
// Pose body/forearm path lives in app/tryon-webcam.tsx and is untouched by this module.
//
// FACE MODE IS WEB ONLY. Jeeliz's native path is an Android-WebView hack — out of scope.
//
// FIRST INCREMENT: tracked curved plane. The richer raycast + DecalGeometry "stick to
// the exact surface" layer is a deliberate follow-up once tracking is confirmed.
//
// All Three.js / Jeeliz handles below are untyped (CDN ESM / UMD globals), so the casts
// are `any` by necessity — each is annotated.

import { Platform } from 'react-native';

// Jeeliz's own canonical CDN: UMD build (sets window.JEELIZFACEFILTER) + its NN model dir.
const JEELIZ_SCRIPT_URL = 'https://appstatic.jeeliz.com/faceFilter/jeelizFaceFilter.js';
const JEELIZ_NN_PATH = 'https://appstatic.jeeliz.com/faceFilter/';
// Three.js as a CDN ES module — deliberately NOT an app dependency, so it isn't bundled
// into body-only sessions; pulled only when a face tattoo is first placed.
const THREE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

// Bundler-opaque dynamic import so Metro doesn't try to resolve the CDN URL at build time.
function importESM(url: string): Promise<any> {
  // any: a CDN ES module ships no types
  const dynImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
  return dynImport(url);
}

// Inject a classic <script> for the Jeeliz UMD build — same pattern as the Pose loader.
function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

export function isFaceTattooSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
}

export type FaceTattooStartOpts = {
  jeelizCanvas: HTMLCanvasElement; // Jeeliz GL + camera-video output
  threeCanvas: HTMLCanvasElement;  // transparent Three.js overlay (the tattoo)
  videoElement: HTMLVideoElement;  // SHARED with the Pose camera (videoSettings.videoElement)
  width: number;
  height: number;
  onReady: () => void;
  onError: (code: unknown) => void;
};

export type FaceTattooPlacement = {
  image: HTMLImageElement; // the tattoo PNG (transparent)
  dropXNorm: number;       // drop point, 0..1 across the canvas, in face-space (un-mirrored)
  dropYNorm: number;       // drop point, 0..1 down the canvas
  scale: number;           // user scale multiplier
  rotationRad: number;     // user rotation
};

// One live face-tattoo session: owns the Jeeliz tracker + a Three.js overlay scene.
export class FaceTattooSession {
  // Untyped CDN/UMD handles — `any` is unavoidable; see file header.
  private THREE: any = null;          // Three.js ESM module
  private jeeliz: any = null;         // window.JEELIZFACEFILTER (UMD global)
  private renderer: any = null;
  private scene: any = null;
  private camera: any = null;
  private faceAnchor: any = null;     // Object3D posed from detectState each frame
  private tattooMesh: any = null;
  private tattooMaterial: any = null;
  private lastDetect: any = null;     // most recent detectState (for placement math)
  private pendingDrop: { dropXNorm: number; dropYNorm: number } | null = null;
  private aspect = 1;
  private opacity = 1;
  private fade = 0;                   // smoothed detected → opacity
  private destroyed = false;

  async start(opts: FaceTattooStartOpts): Promise<void> {
    if (!isFaceTattooSupported()) { opts.onError('unsupported'); return; }
    try {
      const [THREE] = await Promise.all([
        importESM(THREE_MODULE_URL),
        loadScript(JEELIZ_SCRIPT_URL),
      ]);
      if (this.destroyed) return;
      this.THREE = THREE;
      const jeeliz = (window as any).JEELIZFACEFILTER; // any: untyped UMD global
      if (!jeeliz) { opts.onError('jeeliz_global_missing'); return; }
      this.jeeliz = jeeliz;
      this.aspect = opts.width / Math.max(1, opts.height);

      // Transparent Three overlay scene; ortho box x∈[-aspect,aspect], y∈[-1,1] (y up),
      // matching Jeeliz's viewport coordinate convention.
      this.renderer = new THREE.WebGLRenderer({ canvas: opts.threeCanvas, alpha: true, antialias: true });
      this.renderer.setSize(opts.width, opts.height, false);
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-this.aspect, this.aspect, 1, -1, 0.01, 100);
      this.camera.position.z = 10;
      this.faceAnchor = new THREE.Object3D();
      this.scene.add(this.faceAnchor);

      // Init Jeeliz on the SHARED <video> — no second getUserMedia, so no camera handoff.
      jeeliz.init({
        canvas: opts.jeelizCanvas,
        NNCPath: JEELIZ_NN_PATH,
        videoSettings: { videoElement: opts.videoElement },
        callbackReady: (errCode: unknown) => {
          if (errCode) { opts.onError(errCode); return; }
          opts.onReady();
        },
        callbackTrack: (detectState: any) => this.onTrack(detectState), // any: Jeeliz detectState
      });
    } catch (e) {
      opts.onError(e);
    }
  }

  private onTrack(detectState: any): void {
    const J = this.jeeliz;
    if (!J || this.destroyed) return;
    this.lastDetect = detectState;
    // Draw the camera frame onto the Jeeliz canvas.
    if (J.render_video) J.render_video();

    const detected = (detectState?.detected ?? 0) > 0.5;
    this.fade += ((detected ? 1 : 0) - this.fade) * 0.3;

    if (this.faceAnchor) {
      this.faceAnchor.position.set(detectState.x * this.aspect, detectState.y, 0);
      this.faceAnchor.rotation.set(detectState.rx, detectState.ry, detectState.rz);
      const s = detectState.s || 1;
      this.faceAnchor.scale.set(s, s, s);
    }
    // First detected frame after placement: convert the canvas drop point into a
    // face-local offset so the tattoo sits where it was dropped. callbackReady fires
    // before any detection, so doing this at placeTattoo time lands it at the nose.
    if (this.pendingDrop && this.tattooMesh && detected) {
      const dropVX = (this.pendingDrop.dropXNorm * 2 - 1) * this.aspect;
      const dropVY = -(this.pendingDrop.dropYNorm * 2 - 1);
      const s = detectState.s || 1;
      this.tattooMesh.position.set(
        (dropVX - detectState.x * this.aspect) / s,
        (dropVY - detectState.y) / s,
        0.2
      );
      this.pendingDrop = null;
    }
    if (this.tattooMaterial) {
      this.tattooMaterial.opacity = this.opacity * Math.max(0, Math.min(1, this.fade));
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  placeTattoo(p: FaceTattooPlacement): void {
    const THREE = this.THREE;
    if (!THREE || !this.faceAnchor) return;
    if (this.tattooMesh) { this.faceAnchor.remove(this.tattooMesh); this.tattooMesh = null; }

    const tex = new THREE.Texture(p.image);
    tex.needsUpdate = true;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    this.tattooMaterial = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: this.opacity,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    // Gently convex plane so the tattoo bends over the face surface. Base is generous
    // because it's multiplied by detectState.s (small for a normally-framed face); the
    // Scale control set during positioning fine-tunes it. NOTE: tune this magnitude.
    const size = 2.5 * p.scale; // face-local units (anchor is scaled by detectState.s)
    const geo = new THREE.PlaneGeometry(size, size, 8, 8);
    const posAttr = geo.attributes.position;
    const bulge = size * 0.25;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const r2 = (x * x + y * y) / (size * size);
      posAttr.setZ(i, bulge * (1 - r2));
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.tattooMaterial);
    mesh.position.set(0, 0, 0.2); // real offset applied on the first detected frame
    mesh.rotation.z = p.rotationRad;
    this.tattooMesh = mesh;
    this.faceAnchor.add(mesh);
    // NOTE: the offset magnitude is the main thing to tune against a live camera.
    this.pendingDrop = { dropXNorm: p.dropXNorm, dropYNorm: p.dropYNorm };
  }

  setOpacity(o: number): void { this.opacity = o; }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    this.aspect = width / Math.max(1, height);
    if (this.camera) {
      this.camera.left = -this.aspect;
      this.camera.right = this.aspect;
      this.camera.updateProjectionMatrix();
    }
    if (this.renderer) this.renderer.setSize(width, height, false);
    if (this.jeeliz && this.jeeliz.resize) this.jeeliz.resize();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    try { if (this.jeeliz && this.jeeliz.destroy) await this.jeeliz.destroy(); } catch {}
    try { if (this.renderer && this.renderer.dispose) this.renderer.dispose(); } catch {}
    this.jeeliz = null;
    this.renderer = null;
    this.scene = null;
    this.faceAnchor = null;
    this.tattooMesh = null;
    this.tattooMaterial = null;
  }
}
