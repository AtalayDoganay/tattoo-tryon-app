import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';
import {
  FACE_TRIANGULATION,
  FACE_CHEEK_LEFT,
  FACE_CHEEK_RIGHT,
} from '@/constants/faceMesh';
import { FaceTattooSession, isFaceTattooSupported } from '@/lib/faceJeeliz';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTROLS_HEIGHT = 240;
const CANVAS_HEIGHT = SCREEN_HEIGHT - CONTROLS_HEIGHT;
const BASE_SHOULDER_WIDTH = 200; // px at normal standing distance

const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
];

// MediaPipe Tasks-Vision (Face Landmarker) — loaded lazily from CDN on the first face
// placement so body-only sessions never download it. Version pinned; re-confirm against
// npm if it ever 404s (a load failure degrades to abandoning the face placement).
const FACE_VISION_BUNDLE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
const FACE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Distance from point (px,py) to the segment (ax,ay)–(bx,by), in screen pixels.
function distToSegment(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Even–odd point-in-polygon for a small screen-space ring (the torso quad).
function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

type PlacementRegion = { kind: 'torso' | 'forearm' | 'none' | 'face'; anchorIdx: number };

// Route a placement tap to a body region from Pose landmarks. The torso is treated
// as an AREA (shoulders+hips quad), so a chest tap resolves to torso even when a
// single arm point is the closest landmark — that crude single-nearest behaviour is
// what regressed torso placement after forearm tracking was added. Head/face taps
// return 'none' (Pose exposes only sparse face points, no surface to wrap on).
// `any`: MediaPipe landmarks are untyped CDN globals (no shipped types).
function resolvePlacementRegion(
  px: number,
  py: number,
  landmarks2d: any[],
  canvasHeight: number,
  mX: (x: number) => number
): PlacementRegion {
  const sx = (i: number) => mX(landmarks2d[i].x);
  const sy = (i: number) => landmarks2d[i].y * canvasHeight;
  const vis = (i: number) => landmarks2d[i].visibility ?? 1;
  const nearestOf = (ids: number[]): number => {
    let best = ids[0];
    let bestD = Infinity;
    for (const i of ids) {
      const d = Math.hypot(px - sx(i), py - sy(i));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  // 1. Inside the torso quad (L/R shoulder + R/L hip) ⇒ definitively torso.
  const torsoIdx = [11, 12, 24, 23];
  const torsoTracked = torsoIdx.every((i) => vis(i) > 0.3);
  let quad: { x: number; y: number }[] | null = null;
  if (torsoTracked) {
    quad = torsoIdx.map((i) => ({ x: sx(i), y: sy(i) }));
    if (pointInPolygon(px, py, quad)) {
      return { kind: 'torso', anchorIdx: nearestOf([11, 12, 23, 24]) };
    }
  }

  // 2. Inside the head circle (and outside the torso) ⇒ face placement, handled by
  // the Face Landmarker mesh path rather than the Pose anchor system.
  if (vis(0) > 0.5 && (vis(7) > 0.5 || vis(8) > 0.5)) {
    const noseX = sx(0), noseY = sy(0);
    const headRadius = 1.3 * Math.max(
      Math.hypot(noseX - sx(7), noseY - sy(7)),
      Math.hypot(noseX - sx(8), noseY - sy(8))
    );
    if (Math.hypot(px - noseX, py - noseY) < headRadius) {
      return { kind: 'face', anchorIdx: -1 };
    }
  }

  // 3. Otherwise pick the nearest surface: torso edge vs either forearm segment.
  const dTorso = quad
    ? Math.min(
        distToSegment(px, py, quad[0].x, quad[0].y, quad[1].x, quad[1].y),
        distToSegment(px, py, quad[1].x, quad[1].y, quad[2].x, quad[2].y),
        distToSegment(px, py, quad[2].x, quad[2].y, quad[3].x, quad[3].y),
        distToSegment(px, py, quad[3].x, quad[3].y, quad[0].x, quad[0].y)
      )
    : Infinity;
  const dForeL = vis(13) > 0.3 && vis(15) > 0.3
    ? distToSegment(px, py, sx(13), sy(13), sx(15), sy(15)) : Infinity;
  const dForeR = vis(14) > 0.3 && vis(16) > 0.3
    ? distToSegment(px, py, sx(14), sy(14), sx(16), sy(16)) : Infinity;

  const minD = Math.min(dTorso, dForeL, dForeR);
  if (!isFinite(minD)) {
    return torsoTracked
      ? { kind: 'torso', anchorIdx: nearestOf([11, 12, 23, 24]) }
      : { kind: 'none', anchorIdx: -1 };
  }
  // Prefer torso on ties so chest taps never fall through to a limb.
  if (minD === dTorso) return { kind: 'torso', anchorIdx: nearestOf([11, 12, 23, 24]) };
  if (minD === dForeL) return { kind: 'forearm', anchorIdx: nearestOf([13, 15]) };
  return { kind: 'forearm', anchorIdx: nearestOf([14, 16]) };
}

// Forearm 3D warp (Pose landmarks): orient the tattoo along the elbow→wrist axis
// and foreshorten along it from the world-landmark z — the same poseWorldLandmarks
// source the torso warp uses. Feeds the same draw3d transform as the chest, just
// with a limb-derived anchor/axis/normal. `any`: MediaPipe landmarks are untyped
// CDN globals (no shipped types), matching the region helpers above.
function computeForearmWarp(
  landmarks2d: any[],
  landmarks3d: any[] | undefined,
  elbowIdx: number,
  wristIdx: number,
  canvasHeight: number,
  mX: (x: number) => number
): { alignAngle: number; compressionX: number; compressionY: number; fadeVisibility: number } {
  const elbow = landmarks2d[elbowIdx];
  const wrist = landmarks2d[wristIdx];
  const ex = mX(elbow.x);
  const ey = elbow.y * canvasHeight;
  const wx = mX(wrist.x);
  const wy = wrist.y * canvasHeight;

  // Orient the tattoo's local x-axis along the limb in screen space (mirror-aware via mX)
  const alignAngle = Math.atan2(wy - ey, wx - ex);

  // Foreshorten along the limb: cos(pitch) from the 3D axis. 1 = limb across the
  // image plane (full length), → 0 as it points toward/away from the camera.
  let alongFactor = 1;
  if (landmarks3d) {
    const e3 = landmarks3d[elbowIdx];
    const w3 = landmarks3d[wristIdx];
    const dx = w3.x - e3.x;
    const dy = w3.y - e3.y;
    const dz = w3.z - e3.z;
    const planar = Math.hypot(dx, dy);
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-4) alongFactor = planar / len;
  }

  return {
    alignAngle,
    compressionX: alongFactor, // along-limb (local x after rotate(alignAngle))
    compressionY: 1,           // across-limb stays full; segmentation clips the curve
    fadeVisibility: Math.min(elbow.visibility ?? 1, wrist.visibility ?? 1),
  };
}

// ── Face try-on geometry (piecewise-affine triangle warp) ───────────────────────
// A tattoo "stuck" to the face mesh: the covered triangles + the tattoo image's UV
// coords at each triangle vertex, captured once at placement, re-warped each frame.
type FaceTriangle = { a: number; b: number; c: number; uv: [number, number][] };
type FacePlacement = { triangles: FaceTriangle[] };
// The flat tattoo footprint at placement time, in screen px: center, size, rotation.
type FaceFootprint = { cx: number; cy: number; size: number; rot: number };

// Capture which mesh triangles the tattoo covers and each vertex's UV (0..1) inside
// the tattoo footprint. screenPts are the live face landmarks mapped to canvas px.
function captureFaceTriangles(
  footprint: FaceFootprint,
  screenPts: { x: number; y: number }[]
): FaceTriangle[] {
  const cos = Math.cos(-footprint.rot);
  const sin = Math.sin(-footprint.rot);
  const toUV = (p: { x: number; y: number }): [number, number] => {
    const dx = p.x - footprint.cx;
    const dy = p.y - footprint.cy;
    const lx = dx * cos - dy * sin; // un-rotate into the tattoo's local frame
    const ly = dx * sin + dy * cos;
    return [(lx + footprint.size / 2) / footprint.size, (ly + footprint.size / 2) / footprint.size];
  };
  const tris: FaceTriangle[] = [];
  for (let i = 0; i < FACE_TRIANGULATION.length; i += 3) {
    const a = FACE_TRIANGULATION[i];
    const b = FACE_TRIANGULATION[i + 1];
    const c = FACE_TRIANGULATION[i + 2];
    const ua = toUV(screenPts[a]);
    const ub = toUV(screenPts[b]);
    const uc = toUV(screenPts[c]);
    // Keep the triangle if its UV bbox meets the unit square; the tattoo PNG's own
    // alpha (and the image bounds) clip whatever falls outside the footprint.
    if (Math.max(ua[0], ub[0], uc[0]) < 0 || Math.min(ua[0], ub[0], uc[0]) > 1) continue;
    if (Math.max(ua[1], ub[1], uc[1]) < 0 || Math.min(ua[1], ub[1], uc[1]) > 1) continue;
    tris.push({ a, b, c, uv: [ua, ub, uc] });
  }
  return tris;
}

// Warp one image-space triangle (src px) onto a screen-space triangle (dst px) via an
// affine transform + clip — the canvas-2D equivalent of textured UV mapping. dst is
// inflated ~0.6px from its centroid to hide the hairline seams between triangles.
function drawWarpedTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s0x: number, s0y: number, s1x: number, s1y: number, s2x: number, s2y: number,
  d0x: number, d0y: number, d1x: number, d1y: number, d2x: number, d2y: number
): void {
  const gx = (d0x + d1x + d2x) / 3;
  const gy = (d0y + d1y + d2y) / 3;
  const push = (x: number, y: number): [number, number] => {
    const vx = x - gx, vy = y - gy;
    const l = Math.hypot(vx, vy) || 1;
    const k = (l + 0.6) / l;
    return [gx + vx * k, gy + vy * k];
  };
  const [e0x, e0y] = push(d0x, d0y);
  const [e1x, e1y] = push(d1x, d1y);
  const [e2x, e2y] = push(d2x, d2y);

  const denom = s0x * (s2y - s1y) + s1x * (s0y - s2y) + s2x * (s1y - s0y);
  if (Math.abs(denom) < 1e-6) return;
  const a = (e0x * (s2y - s1y) + e1x * (s0y - s2y) + e2x * (s1y - s0y)) / denom;
  const b = (e0y * (s2y - s1y) + e1y * (s0y - s2y) + e2y * (s1y - s0y)) / denom;
  const c = (e0x * (s1x - s2x) + e1x * (s2x - s0x) + e2x * (s0x - s1x)) / denom;
  const d = (e0y * (s1x - s2x) + e1y * (s2x - s0x) + e2y * (s0x - s1x)) / denom;
  const e = (e0x * (s2x * s1y - s1x * s2y) + e1x * (s0x * s2y - s2x * s0y) + e2x * (s1x * s0y - s0x * s1y)) / denom;
  const f = (e0y * (s2x * s1y - s1x * s2y) + e1y * (s0x * s2y - s2x * s0y) + e2y * (s1x * s0y - s0x * s1y)) / denom;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(e0x, e0y);
  ctx.lineTo(e1x, e1y);
  ctx.lineTo(e2x, e2y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export default function TryOnWebcamScreen() {
  const insets = useSafeAreaInsets();
  const { tattooBase64 } = useLocalSearchParams<{ tattooBase64: string }>();

  const [userScale, setUserScale] = useState(1.0);
  const [userRotation, setUserRotation] = useState(0);
  const [opacity, setOpacity] = useState(1.0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'no_body'>('loading');
  const [manualX, setManualX] = useState(Dimensions.get('window').width / 2);
  const [manualY, setManualY] = useState((Dimensions.get('window').height - 300) / 2);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [anchorSet, setAnchorSet] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true);
  const [hasPlaced, setHasPlaced] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceMode, setFaceMode] = useState(false); // Jeeliz WebGL face path active (web-only)

  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const tattooImageRef = useRef<any>(null);
  const offscreenCanvas = useRef<any>(null);

  // Stale-closure refs — every state var used in onResults needs a paired ref
  const userScaleRef = useRef(1.0);
  const userRotationRef = useRef(0);
  const opacityRef = useRef(1.0);
  const manualXRef = useRef(Dimensions.get('window').width / 2);
  const manualYRef = useRef((Dimensions.get('window').height - 300) / 2);
  const isConfirmedRef = useRef(false);
  const anchorSetRef = useRef(false);
  const anchorLandmarkIdx = useRef(11); // default left shoulder
  const anchorOffsetX = useRef(0);
  const anchorOffsetY = useRef(0);
  const pendingConfirmRef = useRef(false);
  const lastDrawnX = useRef(0);
  const lastDrawnY = useRef(0);
  const isMirroredRef = useRef(true);
  const showTattooRef = useRef(false); // becomes true on first drag / confirm — gates drawing

  // Face try-on (MediaPipe Tasks Face Landmarker) — lazy, runs only for a face tattoo
  const faceLandmarkerRef = useRef<any>(null);          // any: FaceLandmarker from untyped CDN ESM module
  const faceLandmarkerLoadingRef = useRef(false);
  const faceEngagedRef = useRef(false);                 // a face tattoo is loading/active → use the face path
  const pendingFaceCaptureRef = useRef<FaceFootprint | null>(null);
  const facePlacementRef = useRef<FacePlacement | null>(null);
  const faceFadeRef = useRef(1);                        // smoothed track / turn-away fade
  const faceOffscreenRef = useRef<any>(null);           // any: offscreen HTMLCanvasElement (web-only)

  // Jeeliz WebGL face path (web-only) — supersedes the MediaPipe face refs above, which
  // are now dormant (kept reversible until the Jeeliz path is verified).
  const faceSessionRef = useRef<FaceTattooSession | null>(null);
  const cameraRef = useRef<any>(null);                  // any: camera_utils Camera (web-only)
  const faceVideoCanvasRef = useRef<any>(null);         // any: Jeeliz <canvas> (web-only)
  const faceThreeCanvasRef = useRef<any>(null);         // any: Three.js overlay <canvas> (web-only)
  // any: image is an HTMLImageElement (web-only)
  const pendingFacePlacementRef = useRef<{ dropXNorm: number; dropYNorm: number; image: any; scale: number; rotationRad: number } | null>(null);

  // Drag state refs
  const isDragging = useRef(false);
  const dragOffsetX = useRef(0);
  const dragOffsetY = useRef(0);
  const lastPinchDist = useRef(0);

  useEffect(() => { userScaleRef.current = userScale; }, [userScale]);
  useEffect(() => { userRotationRef.current = userRotation; }, [userRotation]);
  useEffect(() => {
    opacityRef.current = opacity;
    if (faceSessionRef.current) faceSessionRef.current.setOpacity(opacity);
  }, [opacity]);
  useEffect(() => { manualXRef.current = manualX; }, [manualX]);
  useEffect(() => { manualYRef.current = manualY; }, [manualY]);
  useEffect(() => { isConfirmedRef.current = isConfirmed; }, [isConfirmed]);
  useEffect(() => { anchorSetRef.current = anchorSet; }, [anchorSet]);
  useEffect(() => { isMirroredRef.current = isMirrored; }, [isMirrored]);

  useEffect(() => {
    if (!tattooBase64 || typeof window === 'undefined') return;
    const img = new window.Image();
    img.src = tattooBase64;
    tattooImageRef.current = img;
  }, [tattooBase64]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;

    async function loadScripts() {
      for (const src of MEDIAPIPE_SCRIPTS) {
        await new Promise<void>((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
          const script = document.createElement('script');
          script.src = src;
          script.crossOrigin = 'anonymous';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Failed: ${src}`));
          document.head.appendChild(script);
        });
      }
    }

    loadScripts()
      .then(() => { if (!cancelled) initPose(); })
      .catch((e) => { console.error('MediaPipe load error:', e); setStatus('no_body'); });

    return () => { cancelled = true; };
  }, []);

  // Window-level mouse drag — the preview box and canvas are siblings, so once the
  // cursor leaves the box mid-drag the canvas never sees the move. Listening on
  // window catches move/up anywhere. Refs update synchronously so onResults (which
  // reads them each frame) tracks the cursor without waiting on async React state.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onWindowMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left - dragOffsetX.current;
      const y = e.clientY - rect.top - dragOffsetY.current;
      setManualX(x);
      setManualY(y);
      manualXRef.current = x;
      manualYRef.current = y;
    }

    function onWindowMouseUp() {
      if (isDragging.current && showTattooRef.current) {
        isDragging.current = false;
        setShowConfirm(true);
      }
    }

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, []);

  // Jeeliz WebGL face session lifecycle (web-only) — created once its canvases are laid
  // out (faceMode → true) and torn down on exit. Pose body/forearm path is unaffected.
  useEffect(() => {
    if (Platform.OS !== 'web' || !faceMode) return;
    const jc = faceVideoCanvasRef.current;
    const tc = faceThreeCanvasRef.current;
    const video = videoRef.current;
    if (!jc || !tc || !video) return;
    const w = jc.offsetWidth || canvasRef.current?.offsetWidth || 1;
    const h = jc.offsetHeight || CANVAS_HEIGHT;
    let cancelled = false;
    const session = new FaceTattooSession();
    faceSessionRef.current = session;
    session.setOpacity(opacityRef.current);
    session.start({
      jeelizCanvas: jc,
      threeCanvas: tc,
      videoElement: video,
      width: w,
      height: h,
      onReady: () => {
        if (cancelled) return;
        const p = pendingFacePlacementRef.current;
        if (p && p.image) session.placeTattoo(p);
        setFaceLoading(false);
      },
      onError: (code) => {
        if (cancelled) return;
        console.error('Jeeliz face tracking failed:', code);
        faceEngagedRef.current = false;
        pendingFacePlacementRef.current = null;
        setFaceLoading(false);
        setFaceMode(false);
        setIsConfirmed(false);
      },
    });
    return () => {
      cancelled = true;
      const cam = cameraRef.current;
      session.destroy().finally(() => {
        // Jeeliz tears down the shared <video> on destroy — restart the Pose camera so
        // the body/forearm path gets live frames again (avoids "no body detected").
        if (cam && cam.start) { try { cam.start(); } catch {} }
      });
      if (faceSessionRef.current === session) faceSessionRef.current = null;
    };
  }, [faceMode]);

  // Enter the Jeeliz WebGL face path: snapshot the (locked) drop point, flip on face
  // mode; the effect above builds the session once the canvases are sized.
  function enterFaceMode() {
    if (!isFaceTattooSupported()) { setIsConfirmed(false); return; }
    const canvas = canvasRef.current;
    if (!canvas) { setIsConfirmed(false); return; }
    const w = canvas.offsetWidth || 1;
    const h = canvas.offsetHeight || 1;
    let dropXNorm = manualXRef.current / w;
    const dropYNorm = manualYRef.current / h;
    if (isMirroredRef.current) dropXNorm = 1 - dropXNorm; // → face space (un-mirrored)
    pendingFacePlacementRef.current = {
      dropXNorm,
      dropYNorm,
      image: tattooImageRef.current,
      scale: userScaleRef.current,
      rotationRad: (userRotationRef.current * Math.PI) / 180,
    };
    faceEngagedRef.current = true;
    setFaceLoading(true);
    setFaceMode(true);
  }

  function exitFaceMode() {
    faceEngagedRef.current = false;
    pendingFacePlacementRef.current = null;
    setFaceLoading(false);
    setFaceMode(false);
  }

  function onResults(results: any) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw camera feed (mirrored or straight)
    if (isMirroredRef.current) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }

    // A face placement is loading/active — the Face Landmarker path renders the tattoo;
    // the Pose path only paints the camera feed (no body warp on the face).
    if (faceEngagedRef.current) return;

    if (!results.poseLandmarks) { setStatus('no_body'); return; }
    setStatus('ready');

    // Keep the tattoo hidden until the user first interacts with it. showTattooRef
    // is flipped on in the drag handlers / on confirm and read here on the animation
    // loop — one ref both sides share, so the loop always sees the latest value.
    if (!showTattooRef.current) return;

    // Mirror-aware X converter
    const mX = (lx: number) => isMirroredRef.current
      ? (1 - lx) * canvas.width
      : lx * canvas.width;

    const landmarks2d = results.poseLandmarks;
    const landmarks3d = results.poseWorldLandmarks;
    const segMask = results.segmentationMask;

    const ls = landmarks2d[11]; // left shoulder
    const rs = landmarks2d[12]; // right shoulder
    const lh = landmarks2d[23]; // left hip
    const rh = landmarks2d[24]; // right hip

    // Auto-detect mirroring each frame from wrist positions
    const rightWrist = landmarks2d[16];
    const leftWrist = landmarks2d[15];
    if (rightWrist.visibility > 0.7 && leftWrist.visibility > 0.7) {
      const detectedMirror = rightWrist.x < leftWrist.x;
      if (detectedMirror !== isMirroredRef.current) setIsMirrored(detectedMirror);
    }

    const screenShoulderWidth = Math.abs(mX(rs.x) - mX(ls.x));

    // 3D perspective — decompose body rotation from world landmarks
    let compressionX = 1; // 1=facing camera, 0=fully sideways
    let compressionY = 1; // 1=upright, <1=leaning
    let skewFactor = 0;   // perspective slant left/right
    let rotationY = 0;    // body yaw in radians; 0 = facing camera
    const distanceScale = screenShoulderWidth / BASE_SHOULDER_WIDTH;
    const clampedDistScale = Math.max(0.3, Math.min(3.0, distanceScale));

    if (landmarks3d) {
      const ls3d = landmarks3d[11];
      const rs3d = landmarks3d[12];
      const lh3d = landmarks3d[23];
      const rh3d = landmarks3d[24];

      const shoulderDX = rs3d.x - ls3d.x;
      const shoulderDZ = rs3d.z - ls3d.z;
      rotationY = Math.atan2(shoulderDZ, shoulderDX);

      const shoulderMidZ = (ls3d.z + rs3d.z) / 2;
      const hipMidZ = (lh3d.z + rh3d.z) / 2;
      const shoulderMidY = (ls3d.y + rs3d.y) / 2;
      const hipMidY = (lh3d.y + rh3d.y) / 2;
      const rotationX = Math.atan2(hipMidZ - shoulderMidZ, hipMidY - shoulderMidY);

      compressionX = Math.cos(rotationY);
      compressionY = Math.cos(rotationX);
      skewFactor = Math.sin(rotationY) * 0.15;
    }

    // Fade tattoo when landmarks leave frame
    const avgVisibility = (
      (ls.visibility ?? 1) + (rs.visibility ?? 1) +
      (lh.visibility ?? 1) + (rh.visibility ?? 1)
    ) / 4;

    // On confirm: resolve which body region the tattoo was dropped on, then anchor
    // to it — torso taps lock to a torso landmark (torso warp), forearm taps to the
    // elbow/wrist (forearm warp). Head/face taps have no surface on Pose, so they
    // don't place.
    if (pendingConfirmRef.current) {
      const region = resolvePlacementRegion(
        manualXRef.current, manualYRef.current,
        landmarks2d, canvas.height, mX
      );
      pendingConfirmRef.current = false;
      if (region.kind === 'none') {
        // No valid surface — revert to positioning so the tattoo stays draggable.
        setIsConfirmed(false);
      } else if (region.kind === 'face') {
        // Hand off to the Jeeliz WebGL face path (web-only). Drag is locked once
        // confirmed, so enterFaceMode snapshots the drop point; the faceMode effect
        // builds the Jeeliz session and places the tattoo when tracking is ready.
        enterFaceMode();
      } else {
        const anchor = landmarks2d[region.anchorIdx];
        anchorLandmarkIdx.current = region.anchorIdx;
        anchorOffsetX.current = manualXRef.current - mX(anchor.x);
        anchorOffsetY.current = manualYRef.current - anchor.y * canvas.height;
        setAnchorSet(true);
      }
    }

    // Determine tattoo anchor position — track the chosen landmark when confirmed
    let x = 0, y = 0;
    if (isConfirmedRef.current && anchorSetRef.current) {
      const anchorLm = landmarks2d[anchorLandmarkIdx.current];
      x = mX(anchorLm.x) + anchorOffsetX.current;
      y = anchorLm.y * canvas.height + anchorOffsetY.current;
    } else {
      x = manualXRef.current;
      y = manualYRef.current;
    }

    lastDrawnX.current = x;
    lastDrawnY.current = y;

    // Which surface is the tattoo on? Default to the torso warp computed above; if
    // it's anchored to a forearm landmark (13/15 left, 14/16 right), re-derive the
    // warp from that limb instead. alignAngle stays 0 for the torso so draw3d is
    // byte-identical there. (Hand surface is a follow-up — hand landmarks fall back
    // to the torso warp for now.)
    let alignAngle = 0;
    let surfaceVisibility = avgVisibility; // torso: shoulders + hips
    let useTorsoTurnFade = true;           // torso fades as it yaws toward its back
    if (isConfirmedRef.current && anchorSetRef.current) {
      const idx = anchorLandmarkIdx.current;
      const isLeftForearm = idx === 13 || idx === 15;
      const isRightForearm = idx === 14 || idx === 16;
      if (isLeftForearm || isRightForearm) {
        const warp = computeForearmWarp(
          landmarks2d, landmarks3d,
          isLeftForearm ? 13 : 14,
          isLeftForearm ? 15 : 16,
          canvas.height, mX
        );
        alignAngle = warp.alignAngle;
        compressionX = warp.compressionX;
        compressionY = warp.compressionY;
        skewFactor = 0;
        surfaceVisibility = warp.fadeVisibility;
        useTorsoTurnFade = false;
      }
    }

    const img = tattooImageRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;

    // Size scales with a fixed base × user scale × distance from camera
    const baseSize = 100 * userScaleRef.current * clampedDistScale;

    // The body-tracking fades below only make sense once the tattoo is locked to
    // the body. While the user is still positioning it (it follows the cursor, not
    // a landmark) keep it fully visible so it can't vanish mid-drag — only the
    // opacity slider applies. isConfirmedRef is the placed-vs-positioning signal.
    const isPlacing = !isConfirmedRef.current;

    // Fade as the surface leaves the frame / loses tracking: 0 below 0.2, full at 0.5+
    const visibilityFade = isPlacing
      ? 1
      : Math.min(1, Math.max(0, (surfaceVisibility - 0.2) / 0.3));

    // Torso only: fade as the person turns away — full until 60°, gone by 90°.
    // Past 90° compressionX flips negative, so fading out first hides that flip.
    // The forearm relies on its own foreshorten + visibility fade, not this yaw fade.
    const absRotation = Math.abs(rotationY);
    const rotationFade = isPlacing || !useTorsoTurnFade || absRotation <= Math.PI / 3
      ? 1.0
      : Math.max(0, 1 - (absRotation - Math.PI / 3) / (Math.PI / 6));

    const finalAlpha = opacityRef.current * visibilityFade * rotationFade;

    // Fully faded (turned around / out of frame) — skip every tattoo layer so
    // no ink or shadow ghost lingers over the camera feed.
    if (finalAlpha <= 0.01) return;

    // Apply 3D perspective matrix + draw tattoo centered at (px, py)
    const draw3d = (targetCtx: any, px: number, py: number) => {
      targetCtx.translate(px, py);
      targetCtx.rotate((userRotationRef.current * Math.PI) / 180 + alignAngle);
      targetCtx.transform(
        compressionX, skewFactor,
        -skewFactor * 0.3, compressionY,
        0, 0
      );
      if (compressionX < 0) targetCtx.scale(-1, 1);
      targetCtx.drawImage(img, -baseSize / 2, -baseSize / 2, baseSize, baseSize);
    };

    // ── Body / torso drawing ──
    if (isConfirmedRef.current) {
      // Drop shadow
      ctx.save();
      ctx.globalAlpha = 0.15 * finalAlpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'blur(4px)';
      draw3d(ctx, x + 2, y + 3);
      ctx.restore();
      ctx.filter = 'none';

      // Main ink layer — optionally clipped to body silhouette
      if (segMask) {
        if (!offscreenCanvas.current) {
          offscreenCanvas.current = document.createElement('canvas');
        }
        offscreenCanvas.current.width = canvas.width;
        offscreenCanvas.current.height = canvas.height;
        const offCtx = offscreenCanvas.current.getContext('2d');
        if (offCtx) {
          offCtx.clearRect(0, 0, canvas.width, canvas.height);
          offCtx.save();
          offCtx.globalAlpha = finalAlpha;
          draw3d(offCtx, x, y);
          offCtx.restore();

          offCtx.globalCompositeOperation = 'destination-in';
          if (isMirroredRef.current) {
            offCtx.save();
            offCtx.scale(-1, 1);
            offCtx.drawImage(segMask, -canvas.width, 0, canvas.width, canvas.height);
            offCtx.restore();
          } else {
            offCtx.drawImage(segMask, 0, 0, canvas.width, canvas.height);
          }
          offCtx.globalCompositeOperation = 'source-over';

          ctx.globalCompositeOperation = 'multiply';
          ctx.drawImage(offscreenCanvas.current, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
        }
      } else {
        ctx.save();
        ctx.globalAlpha = finalAlpha;
        ctx.globalCompositeOperation = 'multiply';
        draw3d(ctx, x, y);
        ctx.restore();
      }

      // Skin texture overlay — samples the camera at the tattoo location and
      // blends it back over the ink so it reads as embedded in the skin
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.06 * finalAlpha;
      ctx.translate(x, y);
      ctx.rotate((userRotationRef.current * Math.PI) / 180 + alignAngle);
      ctx.transform(compressionX, skewFactor, -skewFactor * 0.3, compressionY, 0, 0);
      if (compressionX < 0) ctx.scale(-1, 1);
      ctx.drawImage(
        results.image,
        x - baseSize / 2, y - baseSize / 2, baseSize, baseSize,
        -baseSize / 2, -baseSize / 2, baseSize, baseSize
      );
      ctx.restore();

      // Inner shadow
      ctx.save();
      ctx.globalAlpha = 0.12 * finalAlpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'blur(3px)';
      draw3d(ctx, x + 1, y + 2);
      ctx.restore();
      ctx.filter = 'none';

    } else {
      // Positioning mode: shadow + ink
      ctx.save();
      ctx.globalAlpha = 0.15 * finalAlpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'blur(4px)';
      draw3d(ctx, x + 2, y + 3);
      ctx.restore();
      ctx.filter = 'none';

      ctx.save();
      ctx.globalAlpha = finalAlpha;
      ctx.globalCompositeOperation = 'multiply';
      draw3d(ctx, x, y);
      ctx.restore();
    }
  }

  async function ensureFaceLandmarker() {
    if (Platform.OS !== 'web') return;
    if (faceLandmarkerRef.current || faceLandmarkerLoadingRef.current) return;
    faceLandmarkerLoadingRef.current = true;
    try {
      // Bundler-opaque dynamic import so Metro doesn't try to resolve the CDN URL at
      // build time — this stays a real runtime browser import (web-only path).
      const importESM = new Function('u', 'return import(u)') as (u: string) => Promise<any>; // any: untyped CDN ESM
      const vision: any = await importESM(FACE_VISION_BUNDLE_URL); // any: MediaPipe tasks-vision module
      const fileset = await vision.FilesetResolver.forVisionTasks(FACE_WASM_URL);
      faceLandmarkerRef.current = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    } catch (e) {
      console.error('Face Landmarker load failed:', e);
      // Degrade gracefully: abandon the face placement, back to positioning.
      faceEngagedRef.current = false;
      pendingFaceCaptureRef.current = null;
      setFaceLoading(false);
      setIsConfirmed(false);
    } finally {
      faceLandmarkerLoadingRef.current = false;
    }
  }

  // Face render path — runs INSTEAD of Pose while a face tattoo is engaged. Draws the
  // camera feed, detects the mesh, captures the footprint once, then warps the tattoo
  // onto the live triangles and composites it as skin ink (multiply).
  function renderFaceFrame(video: HTMLVideoElement) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    const landmarker = faceLandmarkerRef.current;
    if (!ctx || !landmarker) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Camera feed (mirror-aware, identical to the Pose path)
    if (isMirroredRef.current) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    let result: any; // any: MediaPipe FaceLandmarkerResult (untyped CDN module)
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch {
      return; // detector mid-init this frame
    }
    const face: any = result?.faceLandmarks?.[0] ?? null; // any: array of {x,y,z}

    // Fade: 0 with no face, else fade as the head turns away (cheek z-depth gap).
    let target = 0;
    if (face) {
      const dz = Math.abs(face[FACE_CHEEK_LEFT].z - face[FACE_CHEEK_RIGHT].z);
      target = Math.min(1, Math.max(0, 1 - (dz - 0.04) / 0.06)); // full < 0.04, gone > 0.10
    }
    faceFadeRef.current += (target - faceFadeRef.current) * 0.3;
    if (!face) return;

    const w = canvas.width;
    const h = canvas.height;
    const screenPts = face.map((p: { x: number; y: number }) => ({
      x: isMirroredRef.current ? (1 - p.x) * w : p.x * w,
      y: p.y * h,
    }));

    // One-time "stick it on": capture covered triangles + UV from the drop footprint.
    if (pendingFaceCaptureRef.current) {
      facePlacementRef.current = { triangles: captureFaceTriangles(pendingFaceCaptureRef.current, screenPts) };
      pendingFaceCaptureRef.current = null;
      setFaceLoading(false);
    }

    const placement = facePlacementRef.current;
    const img = tattooImageRef.current;
    const fade = faceFadeRef.current;
    if (!placement || !img || !img.complete || img.naturalWidth === 0 || fade <= 0.01) return;

    // Warp onto an offscreen canvas (opaque), then composite once with multiply so it
    // reads as ink under the skin — the same blend the body path uses.
    if (!faceOffscreenRef.current) faceOffscreenRef.current = document.createElement('canvas');
    const off = faceOffscreenRef.current;
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d') as CanvasRenderingContext2D | null;
    if (!offCtx) return;
    offCtx.clearRect(0, 0, w, h);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    for (const t of placement.triangles) {
      const da = screenPts[t.a];
      const db = screenPts[t.b];
      const dc = screenPts[t.c];
      drawWarpedTriangle(
        offCtx, img,
        t.uv[0][0] * iw, t.uv[0][1] * ih,
        t.uv[1][0] * iw, t.uv[1][1] * ih,
        t.uv[2][0] * iw, t.uv[2][1] * ih,
        da.x, da.y, db.x, db.y, dc.x, dc.y
      );
    }

    ctx.save();
    ctx.globalAlpha = opacityRef.current * fade;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  function initPose() {
    const win = window as any;
    const pose = new win.Pose({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    pose.setOptions({
      modelComplexity: 2,
      smoothLandmarks: true,
      enableSegmentation: true,
      smoothSegmentation: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    pose.onResults(onResults);

    const camera = new win.Camera(videoRef.current, {
      onFrame: async () => {
        if (!videoRef.current) return;
        // In face mode, Jeeliz reads the SHARED <video> and drives its own render loop,
        // so the Pose model sits idle (never two trackers at once). Otherwise → Pose.
        if (faceEngagedRef.current) return;
        // Guarded: right after exiting face mode the camera may be mid-restart.
        try { await pose.send({ image: videoRef.current }); } catch {}
      },
      width: 1280,
      height: 720,
    });

    cameraRef.current = camera;
    camera.start();
    setStatus('ready');
  }

  function handleScreenshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob: Blob | null) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-tattoo.png';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleMouseDown(e: any) {
    if (isConfirmedRef.current) return;
    // Reveal the centered tattoo on first interaction so the user can see and grab it
    showTattooRef.current = true;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const tx = manualXRef.current;
    const ty = manualYRef.current;
    if (Math.sqrt((mouseX - tx) ** 2 + (mouseY - ty) ** 2) < 100) {
      isDragging.current = true;
      dragOffsetX.current = mouseX - tx;
      dragOffsetY.current = mouseY - ty;
      e.preventDefault();
    }
  }

  function handleWheel(e: any) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setUserScale((s) => Math.max(0.2, Math.min(3, parseFloat((s + delta).toFixed(1)))));
  }

  function handleTouchStart(e: any) {
    if (isConfirmedRef.current) return;
    // Reveal the centered tattoo on first interaction so the user can see and grab it
    showTattooRef.current = true;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tx = manualXRef.current;
      const ty = manualYRef.current;
      isDragging.current = true;
      dragOffsetX.current = e.touches[0].clientX - rect.left - tx;
      dragOffsetY.current = e.touches[0].clientY - rect.top - ty;
    }
  }

  function handleTouchMove(e: any) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (dist - lastPinchDist.current) * 0.01;
      setUserScale((s) => Math.max(0.2, Math.min(3, parseFloat((s + delta).toFixed(2)))));
      lastPinchDist.current = dist;
    } else if (e.touches.length === 1 && isDragging.current) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.touches[0].clientX - rect.left - dragOffsetX.current;
      const y = e.touches[0].clientY - rect.top - dragOffsetY.current;
      setManualX(x);
      setManualY(y);
      manualXRef.current = x;
      manualYRef.current = y;
    }
  }

  function handleDragEnd() {
    if (isDragging.current) {
      isDragging.current = false;
      setShowConfirm(true);
    }
  }

  // Mobile fallback
  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.comingSoon}>
          AR try-on works on desktop browser.{'\n'}Mobile AR coming soon!
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }: { pressed: boolean }) => [
            styles.backBtnOutline,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.backBtnOutlineText}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  const statusMessage = faceLoading
    ? 'Loading face tracking…'
    : isConfirmed
    ? 'Tattoo placed — looks real! 🔥'
    : status === 'loading'
    ? 'Loading AR... please wait'
    : status === 'no_body'
    ? 'No body detected'
    : 'Drag to position your tattoo';

  return (
    <View style={styles.container}>
      {/* Hidden video — MediaPipe reads frames from this */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' } as any}
      />

      {/* Canvas — camera feed + tattoo (Pose body/forearm 2D path). Hidden in face mode. */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleDragEnd}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: CANVAS_HEIGHT,
          backgroundColor: '#111',
          display: faceMode ? 'none' : 'block',
          cursor: isConfirmed ? 'default' : isDragging.current ? 'grabbing' : 'grab',
        } as any}
      />

      {/* Jeeliz WebGL face path (web-only): camera video on one canvas, the transparent
          3D tattoo overlay on a second. Shown only in face mode; CSS-mirrored to match
          the selfie feed. */}
      <canvas
        ref={faceVideoCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: CANVAS_HEIGHT,
          backgroundColor: '#111',
          display: faceMode ? 'block' : 'none',
          transform: isMirrored ? 'scaleX(-1)' : 'none',
        } as any}
      />
      <canvas
        ref={faceThreeCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: CANVAS_HEIGHT,
          display: faceMode ? 'block' : 'none',
          transform: isMirrored ? 'scaleX(-1)' : 'none',
          pointerEvents: 'none',
        } as any}
      />

      {/* Status badge — hidden during confirm and pre-placement (the preview box
          guides that step); still surfaces Loading / No body detected feedback */}
      {!showConfirm && (hasPlaced || status !== 'ready') && (
        <View style={styles.statusBadge}>
          <Text style={[styles.statusText, isConfirmed && styles.statusTextConfirmed]}>
            {statusMessage}
          </Text>
        </View>
      )}

      {/* Tattoo preview box — drag source. Disappears once the tattoo is placed. */}
      {!hasPlaced && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            width: 100,
            height: 100,
            border: '2px solid #E24B4A',
            borderRadius: 12,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'grab',
            zIndex: 10,
            padding: 8,
          } as any}
          onMouseDown={(e: any) => {
            // Grab the tattoo out of the box at the cursor; window listeners drive
            // the rest of the drag. Sync refs now so onResults tracks immediately.
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            showTattooRef.current = true;
            isDragging.current = true;
            const startX = e.clientX - rect.left;
            const startY = e.clientY - rect.top;
            setManualX(startX);
            setManualY(startY);
            manualXRef.current = startX;
            manualYRef.current = startY;
            dragOffsetX.current = 0;
            dragOffsetY.current = 0;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <img
            src={tattooBase64}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
            } as any}
          />
        </div>
      )}

      {/* Hint under the preview box */}
      {!hasPlaced && (
        <div
          style={{
            position: 'absolute',
            top: 130,
            left: 10,
            color: 'white',
            fontSize: 11,
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: '4px 8px',
            borderRadius: 8,
            zIndex: 10,
            textAlign: 'center',
            width: 110,
          } as any}
        >
          Drag to your body
        </div>
      )}

      {/* Confirmation popup overlay */}
      {showConfirm && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Place tattoo here?</Text>
            <Text style={styles.confirmSub}>This will lock it to your skin</Text>
            <View style={styles.confirmButtons}>
              <Pressable
                onPress={() => {
                  setHasPlaced(true);
                  setIsConfirmed(true);
                  setShowConfirm(false);
                  showTattooRef.current = true;
                  pendingConfirmRef.current = true;
                }}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.confirmYes,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.confirmYesText}>✓ Yes, place it here</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowConfirm(false)}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.confirmNo,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.confirmNoText}>Keep adjusting</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Controls panel */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 8 }]}>

        {/* Row 1: Scale */}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Scale</Text>
          <Pressable
            onPress={() => setUserScale((s) => Math.max(0.2, parseFloat((s - 0.1).toFixed(1))))}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>−</Text>
          </Pressable>
          <Text style={styles.readout}>{Math.round(userScale * 100)}%</Text>
          <Pressable
            onPress={() => setUserScale((s) => Math.min(3, parseFloat((s + 0.1).toFixed(1))))}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>+</Text>
          </Pressable>
        </View>

        {/* Row 2: Rotate */}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Rotate</Text>
          <Pressable
            onPress={() => setUserRotation((r) => r - 15)}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>↺</Text>
          </Pressable>
          <Text style={styles.readout}>{((userRotation % 360) + 360) % 360}°</Text>
          <Pressable
            onPress={() => setUserRotation((r) => r + 15)}
            style={({ pressed }: { pressed: boolean }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.iconBtnText}>↻</Text>
          </Pressable>
        </View>

        {/* Row 3: Opacity slider */}
        <View style={styles.sliderRow}>
          <Text style={styles.rowLabel}>Opacity</Text>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(opacity * 100)}
            onChange={(e: any) => setOpacity(parseInt(e.target.value) / 100)}
            style={{ flex: 1, accentColor: '#E24B4A', cursor: 'pointer', margin: '0 8px' } as any}
          />
          <Text style={styles.readoutFixed}>{Math.round(opacity * 100)}%</Text>
        </View>

        {/* Row 4: Back | Move | Save */}
        <View style={styles.row}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }: { pressed: boolean }) => [styles.rowBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.rowBtnText}>← Back</Text>
          </Pressable>

          {isConfirmed && (
            <Pressable
              onPress={() => {
                setIsConfirmed(false);
                setAnchorSet(false);
                anchorOffsetX.current = 0;
                anchorOffsetY.current = 0;
                setManualX(lastDrawnX.current);
                setManualY(lastDrawnY.current);
                manualXRef.current = lastDrawnX.current;
                manualYRef.current = lastDrawnY.current;
                // Exit the WebGL face path if this was a face placement (tears down
                // the Jeeliz session via the faceMode effect cleanup).
                exitFaceMode();
              }}
              style={({ pressed }: { pressed: boolean }) => [styles.repositionBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.repositionBtnText}>✎ Move</Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleScreenshot}
            style={({ pressed }: { pressed: boolean }) => [styles.screenshotBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.screenshotBtnText}>📸 Save</Text>
          </Pressable>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    backgroundColor: AppTheme.bg,
    paddingHorizontal: 32,
  },
  statusBadge: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  statusText: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },
  statusTextConfirmed: {
    backgroundColor: 'rgba(40,140,60,0.85)',
  },
  confirmOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  confirmCard: {
    backgroundColor: '#1a1914',
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 32,
    borderWidth: 1,
    borderColor: AppTheme.accent,
    gap: 12,
  },
  confirmTitle: {
    color: AppTheme.text,
    fontSize: 20,
    fontFamily: 'Georgia',
    textAlign: 'center',
    fontWeight: '700',
  },
  confirmSub: {
    color: AppTheme.muted,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    textAlign: 'center',
  },
  confirmButtons: {
    gap: 10,
  },
  confirmYes: {
    backgroundColor: AppTheme.accent,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmYesText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  confirmNo: {
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmNoText: {
    color: AppTheme.muted,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CONTROLS_HEIGHT,
    backgroundColor: AppTheme.surface,
    borderTopWidth: 1,
    borderTopColor: AppTheme.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowLabel: {
    width: 52,
    color: AppTheme.muted,
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  iconBtn: {
    width: 44,
    height: 40,
    backgroundColor: AppTheme.bg,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  iconBtnText: {
    color: AppTheme.text,
    fontSize: 20,
    fontWeight: '700',
  },
  readout: {
    flex: 1,
    textAlign: 'center',
    color: AppTheme.muted,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700',
  },
  readoutFixed: {
    width: 40,
    textAlign: 'right',
    color: AppTheme.muted,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700',
  },
  rowBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowBtnText: {
    color: AppTheme.text,
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  repositionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AppTheme.accent,
    backgroundColor: 'rgba(226,75,74,0.1)',
  },
  repositionBtnText: {
    color: AppTheme.accent,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  screenshotBtn: {
    flex: 2,
    backgroundColor: AppTheme.accent,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  screenshotBtnText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700',
  },
  backBtnOutline: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: AppTheme.border,
    borderRadius: 10,
  },
  backBtnOutlineText: {
    color: AppTheme.text,
    fontSize: 15,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  comingSoon: {
    color: AppTheme.muted,
    fontSize: 16,
    fontFamily: Fonts?.sans ?? 'system-ui',
    textAlign: 'center',
    lineHeight: 26,
  },
});
