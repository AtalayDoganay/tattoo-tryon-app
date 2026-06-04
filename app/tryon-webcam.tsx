import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTheme, Fonts } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTROLS_HEIGHT = 280;
const CANVAS_HEIGHT = SCREEN_HEIGHT - CONTROLS_HEIGHT;
const BASE_SHOULDER_WIDTH = 200; // px at normal standing distance

const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
];

type BodyPart = 'chest' | 'left_arm' | 'right_arm' | 'left_shoulder' | 'right_shoulder' | 'neck';

const BODY_PARTS: { key: BodyPart; label: string }[] = [
  { key: 'chest', label: 'Chest' },
  { key: 'left_arm', label: 'L.Arm' },
  { key: 'right_arm', label: 'R.Arm' },
  { key: 'left_shoulder', label: 'L.Shoulder' },
  { key: 'right_shoulder', label: 'R.Shoulder' },
  { key: 'neck', label: 'Neck' },
];

interface DebugInfo {
  rotY: number;
  distScale: number;
  visibility: number;
  isPalmFacing?: boolean;
  handAngleDeg?: number;
}

// Draw tattoo mapped to a detected hand — handles in-plane rotation, palm/back flip, edge compression
function drawTattooOnHand(
  ctx: any,
  handLandmarks: any[],
  isRightHand: boolean,
  canvas: any,
  img: any,
  userScale: number,
  userRotation: number,
  opacity: number,
  blendMode: 'multiply' | 'source-over',
  mX: (x: number) => number
): { isPalmFacing: boolean; handAngleDeg: number } | null {
  if (!handLandmarks || !img?.complete || img.naturalWidth === 0) return null;

  const wrist = handLandmarks[0];
  const indexMCP = handLandmarks[5];
  const pinkyMCP = handLandmarks[17];

  const wristX = mX(wrist.x);
  const wristY = wrist.y * canvas.height;
  const indexX = mX(indexMCP.x);
  const indexY = indexMCP.y * canvas.height;
  const pinkyX = mX(pinkyMCP.x);
  const pinkyY = pinkyMCP.y * canvas.height;

  // Centroid of wrist + index knuckle + pinky knuckle = hand center
  const centerX = (wristX + indexX + pinkyX) / 3;
  const centerY = (wristY + indexY + pinkyY) / 3;

  // Angle: knuckle midpoint → wrist gives "hand up" direction
  const knuckleMidX = (indexX + pinkyX) / 2;
  const knuckleMidY = (indexY + pinkyY) / 2;
  const handAngle = Math.atan2(wristY - knuckleMidY, wristX - knuckleMidX);
  const handAngleDeg = (handAngle * 180) / Math.PI;

  // Cross product of (wrist→index) × (wrist→pinky) to detect palm vs back
  const v1x = indexX - wristX;
  const v1y = indexY - wristY;
  const v2x = pinkyX - wristX;
  const v2y = pinkyY - wristY;
  const crossZ = v1x * v2y - v1y * v2x;
  // Right hand: palm facing camera → index on left of pinky → crossZ < 0
  const isPalmFacing = isRightHand ? crossZ < 0 : crossZ > 0;

  // Width of hand in pixels for scale + compression
  const handPixelWidth = Math.sqrt((indexX - pinkyX) ** 2 + (indexY - pinkyY) ** 2);
  const compressionFactor = Math.max(0.05, Math.min(1.0, handPixelWidth / 80));
  const baseSize = 90 * userScale * (handPixelWidth / 80);

  const applyHandTransform = (targetCtx: any, ox = 0, oy = 0) => {
    targetCtx.translate(centerX + ox, centerY + oy);
    targetCtx.rotate(handAngle + Math.PI / 2 + (userRotation * Math.PI) / 180);
    if (!isPalmFacing) targetCtx.scale(-1, 1); // flip to back-of-hand view
    targetCtx.scale(compressionFactor, 1);      // compress when hand is edge-on
    targetCtx.drawImage(img, -baseSize / 2, -baseSize / 2, baseSize, baseSize);
  };

  // Blurred shadow pass underneath — grounds the ink on the skin
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'blur(3px)';
  applyHandTransform(ctx, 1, 1);
  ctx.restore();
  ctx.filter = 'none';

  // Main tattoo pass — multiply + slight sepia/darken so it reads as real ink on skin
  ctx.save();
  ctx.globalAlpha = opacity * 0.85;
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = 'sepia(0.35) brightness(0.9)';
  applyHandTransform(ctx);
  ctx.restore();
  ctx.filter = 'none';

  return { isPalmFacing, handAngleDeg };
}

export default function TryOnWebcamScreen() {
  const insets = useSafeAreaInsets();
  const { tattooBase64 } = useLocalSearchParams<{ tattooBase64: string }>();

  const [userScale, setUserScale] = useState(2.5);
  const [userRotation, setUserRotation] = useState(0);
  const [opacity, setOpacity] = useState(1.0);
  const [blendMode, setBlendMode] = useState<'multiply' | 'source-over'>('multiply');
  const [status, setStatus] = useState<'loading' | 'ready' | 'no_body'>('loading');
  const [manualMode, setManualMode] = useState(true);
  const [manualX, setManualX] = useState(Dimensions.get('window').width / 2);
  const [manualY, setManualY] = useState((Dimensions.get('window').height - 300) / 2);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [anchorSet, setAnchorSet] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({ rotY: 0, distScale: 1, visibility: 0 });
  const [bodyPart, setBodyPart] = useState<BodyPart>('chest');

  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const tattooImageRef = useRef<any>(null);
  const offscreenCanvas = useRef<any>(null);

  // Stale-closure refs — every state var used in onResults needs a paired ref
  const userScaleRef = useRef(2.5);
  const userRotationRef = useRef(0);
  const opacityRef = useRef(1.0);
  const blendModeRef = useRef<'multiply' | 'source-over'>('multiply');
  const manualModeRef = useRef(true);
  const manualXRef = useRef(Dimensions.get('window').width / 2);
  const manualYRef = useRef((Dimensions.get('window').height - 300) / 2);
  const isConfirmedRef = useRef(false);
  const anchorSetRef = useRef(false);
  const anchorOffsetX = useRef(0);
  const anchorOffsetY = useRef(0);
  const pendingConfirmRef = useRef(false);
  const lastDrawnX = useRef(0);
  const lastDrawnY = useRef(0);
  const isMirroredRef = useRef(true);
  const showDebugRef = useRef(false);
  const bodyPartRef = useRef<BodyPart>('chest');
  const lastTorsoX = useRef(0);
  const lastTorsoY = useRef(0);

  // Drag state refs
  const isDragging = useRef(false);
  const dragOffsetX = useRef(0);
  const dragOffsetY = useRef(0);
  const lastPinchDist = useRef(0);
  const currentTattooX = useRef(0);
  const currentTattooY = useRef(0);

  useEffect(() => { userScaleRef.current = userScale; }, [userScale]);
  useEffect(() => { userRotationRef.current = userRotation; }, [userRotation]);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);
  useEffect(() => { blendModeRef.current = blendMode; }, [blendMode]);
  useEffect(() => { manualModeRef.current = manualMode; }, [manualMode]);
  useEffect(() => { manualXRef.current = manualX; }, [manualX]);
  useEffect(() => { manualYRef.current = manualY; }, [manualY]);
  useEffect(() => { isConfirmedRef.current = isConfirmed; }, [isConfirmed]);
  useEffect(() => { anchorSetRef.current = anchorSet; }, [anchorSet]);
  useEffect(() => { isMirroredRef.current = isMirrored; }, [isMirrored]);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);
  useEffect(() => { bodyPartRef.current = bodyPart; }, [bodyPart]);

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

    if (!results.poseLandmarks) { setStatus('no_body'); return; }
    setStatus('ready');

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

    // 2D torso center (screen pixels)
    const torsoX = (mX(ls.x) + mX(rs.x)) / 2;
    const torsoY = ((ls.y + rs.y + lh.y + rh.y) / 4) * canvas.height;
    const screenShoulderWidth = Math.abs(mX(rs.x) - mX(ls.x));

    // 3D perspective — decompose body rotation from world landmarks
    let compressionX = 1; // 1=facing camera, 0=fully sideways
    let compressionY = 1; // 1=upright, <1=leaning
    let skewFactor = 0;   // perspective slant left/right
    const distanceScale = screenShoulderWidth / BASE_SHOULDER_WIDTH;
    const clampedDistScale = Math.max(0.3, Math.min(3.0, distanceScale));
    let rotationYDeg = 0;

    if (landmarks3d) {
      const ls3d = landmarks3d[11];
      const rs3d = landmarks3d[12];
      const lh3d = landmarks3d[23];
      const rh3d = landmarks3d[24];

      const shoulderDX = rs3d.x - ls3d.x;
      const shoulderDZ = rs3d.z - ls3d.z;
      const rotationY = Math.atan2(shoulderDZ, shoulderDX);
      rotationYDeg = (rotationY * 180) / Math.PI;

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

    // Body part anchor: per-part position + size hint from pose landmarks
    const getAnchorPoint = (lm: any[], part: BodyPart, cw: number, ch: number) => {
      const mx = (x: number) => isMirroredRef.current ? (1 - x) * cw : x * cw;
      switch (part) {
        case 'chest':
          return {
            x: (mx(lm[11].x) + mx(lm[12].x)) / 2,
            y: ((lm[11].y + lm[12].y) / 2) * ch + 40,
            size: Math.abs(mx(lm[12].x) - mx(lm[11].x)) * 0.5,
          };
        case 'left_arm':
          return {
            x: (mx(lm[13].x) + mx(lm[15].x)) / 2,
            y: ((lm[13].y + lm[15].y) / 2) * ch,
            size: 80,
          };
        case 'right_arm':
          return {
            x: (mx(lm[14].x) + mx(lm[16].x)) / 2,
            y: ((lm[14].y + lm[16].y) / 2) * ch,
            size: 80,
          };
        case 'left_shoulder':
          return { x: mx(lm[11].x), y: lm[11].y * ch, size: 90 };
        case 'right_shoulder':
          return { x: mx(lm[12].x), y: lm[12].y * ch, size: 90 };
        case 'neck':
          return {
            x: (mx(lm[11].x) + mx(lm[12].x)) / 2,
            y: ((lm[11].y + lm[12].y) / 2) * ch - 40,
            size: 70,
          };
        default:
          return {
            x: (mx(lm[11].x) + mx(lm[12].x)) / 2,
            y: ((lm[11].y + lm[12].y) / 2) * ch,
            size: 100,
          };
      }
    };

    const anchor = getAnchorPoint(landmarks2d, bodyPartRef.current, canvas.width, canvas.height);

    // Capture body anchor offset on first confirmed frame
    if (pendingConfirmRef.current) {
      anchorOffsetX.current = manualXRef.current - torsoX;
      anchorOffsetY.current = manualYRef.current - torsoY;
      pendingConfirmRef.current = false;
      setAnchorSet(true);
    }

    // Determine tattoo anchor position
    let x = 0, y = 0;
    if (isConfirmedRef.current && anchorSetRef.current) {
      x = torsoX + anchorOffsetX.current;
      y = torsoY + anchorOffsetY.current;
    } else if (manualModeRef.current) {
      x = manualXRef.current;
      y = manualYRef.current;
    } else {
      x = anchor.x;
      y = anchor.y;
      currentTattooX.current = x;
      currentTattooY.current = y;
    }

    lastTorsoX.current = torsoX;
    lastTorsoY.current = torsoY;
    lastDrawnX.current = x;
    lastDrawnY.current = y;

    const img = tattooImageRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;

    // Size scales with body part hint × user scale × distance from camera
    const baseSize = anchor.size * userScaleRef.current * clampedDistScale;
    const visibilityAlpha = opacityRef.current * Math.min(1, avgVisibility * 1.5);

    // Apply 3D perspective matrix + draw tattoo centered at (px, py)
    const draw3d = (targetCtx: any, px: number, py: number) => {
      targetCtx.translate(px, py);
      targetCtx.rotate((userRotationRef.current * Math.PI) / 180);
      targetCtx.transform(
        compressionX, skewFactor,
        -skewFactor * 0.3, compressionY,
        0, 0
      );
      if (compressionX < 0) targetCtx.scale(-1, 1);
      targetCtx.drawImage(img, -baseSize / 2, -baseSize / 2, baseSize, baseSize);
    };

    // ── Hand mode: use hand-orientation-aware draw when landmarks are live ──
    const isHandMode = bodyPartRef.current === 'left_arm' || bodyPartRef.current === 'right_arm';
    const isRightHand = bodyPartRef.current === 'right_arm';
    const handLandmarks = isRightHand ? results.rightHandLandmarks : results.leftHandLandmarks;

    if (isHandMode && handLandmarks && !manualModeRef.current && !isConfirmedRef.current) {
      const handResult = drawTattooOnHand(
        ctx, handLandmarks, isRightHand,
        canvas, img, userScaleRef.current,
        userRotationRef.current, visibilityAlpha,
        blendModeRef.current, mX
      );
      if (showDebugRef.current) {
        setDebugInfo({
          rotY: rotationYDeg,
          distScale: clampedDistScale,
          visibility: avgVisibility,
          isPalmFacing: handResult?.isPalmFacing,
          handAngleDeg: handResult?.handAngleDeg,
        });
      }
      return;
    }

    // Update debug for non-hand modes
    if (showDebugRef.current) {
      setDebugInfo({ rotY: rotationYDeg, distScale: clampedDistScale, visibility: avgVisibility });
    }

    // ── Body / torso drawing ──
    if (isConfirmedRef.current) {
      // Drop shadow
      ctx.save();
      ctx.globalAlpha = 0.15;
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
          offCtx.globalAlpha = visibilityAlpha;
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
        ctx.globalAlpha = visibilityAlpha;
        ctx.globalCompositeOperation = 'multiply';
        draw3d(ctx, x, y);
        ctx.restore();
      }

      // Skin texture overlay for depth
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.08;
      ctx.translate(x, y);
      ctx.rotate((userRotationRef.current * Math.PI) / 180);
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
      ctx.globalAlpha = 0.12;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'blur(3px)';
      draw3d(ctx, x + 1, y + 2);
      ctx.restore();
      ctx.filter = 'none';

    } else {
      // Positioning mode: shadow + blend
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'blur(4px)';
      draw3d(ctx, x + 2, y + 3);
      ctx.restore();
      ctx.filter = 'none';

      ctx.save();
      ctx.globalAlpha = visibilityAlpha;
      ctx.globalCompositeOperation = blendModeRef.current;
      draw3d(ctx, x, y);
      ctx.restore();
    }
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
        if (videoRef.current) await pose.send({ image: videoRef.current });
      },
      width: 1280,
      height: 720,
    });

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
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const tx = manualModeRef.current ? manualXRef.current : currentTattooX.current;
    const ty = manualModeRef.current ? manualYRef.current : currentTattooY.current;
    if (Math.sqrt((mouseX - tx) ** 2 + (mouseY - ty) ** 2) < 100) {
      isDragging.current = true;
      setManualMode(true);
      dragOffsetX.current = mouseX - tx;
      dragOffsetY.current = mouseY - ty;
      e.preventDefault();
    }
  }

  function handleMouseMove(e: any) {
    if (!isDragging.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setManualX(e.clientX - rect.left - dragOffsetX.current);
    setManualY(e.clientY - rect.top - dragOffsetY.current);
  }

  function handleWheel(e: any) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setUserScale((s) => Math.max(0.2, Math.min(3, parseFloat((s + delta).toFixed(1)))));
  }

  function handleTouchStart(e: any) {
    if (isConfirmedRef.current) return;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tx = manualModeRef.current ? manualXRef.current : currentTattooX.current;
      const ty = manualModeRef.current ? manualYRef.current : currentTattooY.current;
      isDragging.current = true;
      setManualMode(true);
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
      setManualX(e.touches[0].clientX - rect.left - dragOffsetX.current);
      setManualY(e.touches[0].clientY - rect.top - dragOffsetY.current);
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

  const statusMessage = isConfirmed
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

      {/* Canvas — camera feed + tattoo drawn here */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
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
          cursor: isConfirmed ? 'default' : isDragging.current ? 'grabbing' : 'grab',
        } as any}
      />

      {/* Status badge — hidden while confirm popup is up */}
      {!showConfirm && (
        <View style={styles.statusBadge}>
          <Text style={[styles.statusText, isConfirmed && styles.statusTextConfirmed]}>
            {statusMessage}
          </Text>
        </View>
      )}

      {/* 3D / hand debug overlay — top-right corner */}
      {showDebug && (
        <View style={styles.debugOverlay}>
          <Text style={styles.debugText}>Rotation: {Math.round(debugInfo.rotY)}°</Text>
          <Text style={styles.debugText}>Distance: {debugInfo.distScale.toFixed(2)}x</Text>
          <Text style={styles.debugText}>Visibility: {Math.round(debugInfo.visibility * 100)}%</Text>
          {debugInfo.isPalmFacing !== undefined && (
            <Text style={styles.debugText}>Palm: {debugInfo.isPalmFacing ? 'facing' : 'back'}</Text>
          )}
          {debugInfo.handAngleDeg !== undefined && (
            <Text style={styles.debugText}>Hand: {Math.round(debugInfo.handAngleDeg)}°</Text>
          )}
        </View>
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
                  setIsConfirmed(true);
                  setShowConfirm(false);
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

        {/* Body part selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bodyPartScroll}
          contentContainerStyle={styles.bodyPartScrollContent}
        >
          {BODY_PARTS.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => { setBodyPart(key); setManualMode(false); }}
              style={({ pressed }: { pressed: boolean }) => [
                styles.bodyPartBtn,
                bodyPart === key && styles.bodyPartBtnActive,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.bodyPartBtnText, bodyPart === key && styles.bodyPartBtnTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

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

        {/* Row 4: Back | Reposition | Reset | Mirror | 3D | Ink | Screenshot */}
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
              }}
              style={({ pressed }: { pressed: boolean }) => [styles.repositionBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.repositionBtnText}>✎ Move</Text>
            </Pressable>
          )}

          {!isConfirmed && manualMode && (
            <Pressable
              onPress={() => setManualMode(false)}
              style={({ pressed }: { pressed: boolean }) => [styles.resetBodyBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.resetBodyBtnText}>Reset</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => setIsMirrored((m) => !m)}
            style={({ pressed }: { pressed: boolean }) => [
              styles.iconChip,
              isMirrored && styles.iconChipBlue,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.iconChipText, isMirrored && styles.iconChipTextBlue]}>⟳</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowDebug((d) => !d)}
            style={({ pressed }: { pressed: boolean }) => [
              styles.iconChip,
              showDebug && styles.iconChipGreen,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.iconChipText, showDebug && styles.iconChipTextGreen]}>3D</Text>
          </Pressable>

          <Pressable
            onPress={() => setBlendMode((b) => b === 'multiply' ? 'source-over' : 'multiply')}
            style={({ pressed }: { pressed: boolean }) => [
              styles.inkModeBtn,
              blendMode === 'multiply' && styles.inkModeBtnActive,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.inkModeBtnText, blendMode === 'multiply' && styles.inkModeBtnTextActive]}>
              {blendMode === 'multiply' ? 'Ink' : 'Float'}
            </Text>
          </Pressable>

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
  debugOverlay: {
    position: 'absolute',
    top: 48,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 8,
    padding: 8,
    gap: 3,
    zIndex: 5,
    borderWidth: 1,
    borderColor: 'rgba(0,220,100,0.35)',
  },
  debugText: {
    color: '#00dc64',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
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
  bodyPartScroll: {
    flexGrow: 0,
  },
  bodyPartScrollContent: {
    gap: 6,
    paddingBottom: 2,
  },
  bodyPartBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.bg,
  },
  bodyPartBtnActive: {
    backgroundColor: AppTheme.accent,
    borderColor: AppTheme.accent,
  },
  bodyPartBtnText: {
    color: AppTheme.muted,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  bodyPartBtnTextActive: {
    color: '#fff',
    fontWeight: '700',
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
  resetBodyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  resetBodyBtnText: {
    color: AppTheme.text,
    fontSize: 13,
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
  iconChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.bg,
  },
  iconChipText: {
    color: AppTheme.muted,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '700' as const,
  },
  iconChipBlue: {
    backgroundColor: 'rgba(100,180,255,0.12)',
    borderColor: '#4aabE2',
  },
  iconChipTextBlue: {
    color: '#4aabE2',
  },
  iconChipGreen: {
    backgroundColor: 'rgba(0,220,100,0.12)',
    borderColor: '#00dc64',
  },
  iconChipTextGreen: {
    color: '#00dc64',
  },
  inkModeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.bg,
  },
  inkModeBtnActive: {
    backgroundColor: 'rgba(226,75,74,0.12)',
    borderColor: AppTheme.accent,
  },
  inkModeBtnText: {
    color: AppTheme.muted,
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600',
  },
  inkModeBtnTextActive: {
    color: AppTheme.accent,
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
