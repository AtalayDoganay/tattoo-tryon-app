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

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTROLS_HEIGHT = 240;
const CANVAS_HEIGHT = SCREEN_HEIGHT - CONTROLS_HEIGHT;
const BASE_SHOULDER_WIDTH = 200; // px at normal standing distance

const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
];

// Auto-detect placement: of all 33 pose landmarks, find the one closest to
// where the user dropped the tattoo. That landmark becomes the tracking anchor.
function findNearestLandmark(
  x: number,
  y: number,
  landmarks2d: any[],
  canvas: any,
  mX: (x: number) => number
): { landmark: any; index: number; dist: number } {
  let nearest: any = null;
  let minDist = Infinity;
  let nearestIdx = 0;

  for (let i = 0; i < landmarks2d.length; i++) {
    const lx = mX(landmarks2d[i].x);
    const ly = landmarks2d[i].y * canvas.height;
    const dist = Math.sqrt((x - lx) ** 2 + (y - ly) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = landmarks2d[i];
      nearestIdx = i;
    }
  }
  return { landmark: nearest, index: nearestIdx, dist: minDist };
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

  // Drag state refs
  const isDragging = useRef(false);
  const dragOffsetX = useRef(0);
  const dragOffsetY = useRef(0);
  const lastPinchDist = useRef(0);

  useEffect(() => { userScaleRef.current = userScale; }, [userScale]);
  useEffect(() => { userRotationRef.current = userRotation; }, [userRotation]);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);
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

    // On confirm: lock the tattoo to the nearest pose landmark where it was placed
    if (pendingConfirmRef.current) {
      const nearest = findNearestLandmark(
        manualXRef.current, manualYRef.current,
        landmarks2d, canvas, mX
      );
      if (nearest.landmark) {
        anchorLandmarkIdx.current = nearest.index;
        anchorOffsetX.current = manualXRef.current - mX(nearest.landmark.x);
        anchorOffsetY.current = manualYRef.current - nearest.landmark.y * canvas.height;
        pendingConfirmRef.current = false;
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

    const img = tattooImageRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return;

    // Size scales with a fixed base × user scale × distance from camera
    const baseSize = 100 * userScaleRef.current * clampedDistScale;

    // Fade as the body leaves the frame: 0 below 0.2 visibility, full at 0.5+
    const visibilityFade = Math.min(1, Math.max(0, (avgVisibility - 0.2) / 0.3));
    const visibilityAlpha = opacityRef.current * visibilityFade;

    // Fade as the person turns away: full until 60°, gone by 90° (sideways).
    // Past 90° compressionX flips negative, so fading out first hides that flip.
    const absRotation = Math.abs(rotationY);
    const rotationFade = absRotation > Math.PI / 3
      ? Math.max(0, 1 - (absRotation - Math.PI / 3) / (Math.PI / 6))
      : 1.0;
    const finalAlpha = visibilityAlpha * rotationFade;

    // Fully faded (turned around / out of frame) — skip every tattoo layer so
    // no ink or shadow ghost lingers over the camera feed.
    if (finalAlpha <= 0.01) return;

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

      {/* Placement hint — shown until the tattoo is first placed */}
      {!hasPlaced && !showConfirm && !isDragging.current && (
        <View style={styles.placementHint}>
          <Text style={styles.placementHintText}>👆 Drag to place your tattoo</Text>
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
  placementHint: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  placementHintText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Fonts?.sans ?? 'system-ui',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
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
