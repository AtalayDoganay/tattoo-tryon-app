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

const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
];

export default function TryOnWebcamScreen() {
  const insets = useSafeAreaInsets();
  const { tattooBase64 } = useLocalSearchParams<{ tattooBase64: string }>();

  const [userScale, setUserScale] = useState(1.0);
  const [userRotation, setUserRotation] = useState(0);
  const [opacity, setOpacity] = useState(1.0);
  const [blendMode, setBlendMode] = useState<'multiply' | 'source-over'>('multiply');
  const [status, setStatus] = useState<'loading' | 'ready' | 'no_body'>('loading');
  const [manualMode, setManualMode] = useState(true);
  const [manualX, setManualX] = useState(
    Dimensions.get('window').width / 2
  );
  const [manualY, setManualY] = useState(
    (Dimensions.get('window').height - 300) / 2
  );

  // Confirmation flow state
  const [showConfirm, setShowConfirm] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [anchorSet, setAnchorSet] = useState(false);

  // Mirror state
  const [isMirrored, setIsMirrored] = useState(true);

  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const tattooImageRef = useRef<any>(null);

  // Refs to avoid stale closures in onResults
  const userScaleRef = useRef(userScale);
  const userRotationRef = useRef(userRotation);
  const opacityRef = useRef(opacity);
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
          if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
          }
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

    // Draw camera feed — mirrored or normal
    if (isMirroredRef.current) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }

    if (!results.poseLandmarks) {
      setStatus('no_body');
      return;
    }
    setStatus('ready');

    let x = 0, y = 0, size = 100;

    // Mirror-aware X converter: flips landmark X for mirrored feeds
    const mX = (lx: number) => isMirroredRef.current
      ? (1 - lx) * canvas.width
      : lx * canvas.width;

    // Always compute torso center from landmarks
    const landmarks = results.poseLandmarks;
    const ls = landmarks[11]; // left shoulder
    const rs = landmarks[12]; // right shoulder
    const lh = landmarks[23]; // left hip
    const rh = landmarks[24]; // right hip

    // Auto-detect mirroring from wrist positions each frame
    const rightWrist = landmarks[16];
    const leftWrist = landmarks[15];
    if (rightWrist.visibility > 0.7 && leftWrist.visibility > 0.7) {
      const detectedMirror = rightWrist.x < leftWrist.x;
      if (detectedMirror !== isMirroredRef.current) {
        setIsMirrored(detectedMirror);
      }
    }

    const torsoX = (mX(ls.x) + mX(rs.x)) / 2;
    const torsoY = ((ls.y + rs.y + lh.y + rh.y) / 4) * canvas.height;
    size = Math.abs(mX(rs.x) - mX(ls.x)) * 0.5;

    // Capture anchor offset on the first confirmed frame
    if (pendingConfirmRef.current) {
      anchorOffsetX.current = manualXRef.current - torsoX;
      anchorOffsetY.current = manualYRef.current - torsoY;
      pendingConfirmRef.current = false;
      setAnchorSet(true);
    }

    if (isConfirmedRef.current && anchorSetRef.current) {
      // Tattoo follows body using stored offset from torso
      x = torsoX + anchorOffsetX.current;
      y = torsoY + anchorOffsetY.current;
    } else if (manualModeRef.current) {
      x = manualXRef.current;
      y = manualYRef.current;
    } else {
      x = torsoX;
      y = torsoY;
      currentTattooX.current = x;
      currentTattooY.current = y;
    }

    lastDrawnX.current = x;
    lastDrawnY.current = y;

    const finalSize = size * userScaleRef.current;
    const img = tattooImageRef.current;

    if (img && img.complete && img.naturalWidth > 0) {
      if (isConfirmedRef.current) {
        // Locked skin blending — tattoo embedded in skin
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = opacityRef.current;
        ctx.translate(x, y);
        ctx.rotate((userRotationRef.current * Math.PI) / 180);
        ctx.drawImage(img, -finalSize / 2, -finalSize / 2, finalSize, finalSize);
        ctx.restore();

        // Skin texture overlay to look embedded
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.08;
        ctx.translate(x, y);
        ctx.rotate((userRotationRef.current * Math.PI) / 180);
        ctx.drawImage(
          results.image,
          x - finalSize / 2, y - finalSize / 2, finalSize, finalSize,
          -finalSize / 2, -finalSize / 2, finalSize, finalSize
        );
        ctx.restore();

        // Subtle inner shadow for depth
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.12;
        ctx.filter = 'blur(3px)';
        ctx.translate(x + 1, y + 2);
        ctx.rotate((userRotationRef.current * Math.PI) / 180);
        ctx.drawImage(img, -finalSize / 2, -finalSize / 2, finalSize, finalSize);
        ctx.restore();
        ctx.filter = 'none';
      } else {
        // Positioning mode — shadow + blend
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'blur(4px)';
        ctx.translate(x + 2, y + 3);
        ctx.rotate((userRotationRef.current * Math.PI) / 180);
        ctx.drawImage(img, -finalSize / 2, -finalSize / 2, finalSize, finalSize);
        ctx.restore();
        ctx.filter = 'none';

        ctx.save();
        ctx.globalAlpha = opacityRef.current;
        ctx.globalCompositeOperation = blendModeRef.current;
        ctx.translate(x, y);
        ctx.rotate((userRotationRef.current * Math.PI) / 180);
        ctx.drawImage(img, -finalSize / 2, -finalSize / 2, finalSize, finalSize);
        ctx.restore();
      }
    }
  }

  function initPose() {
    const win = window as any;

    const pose = new win.Pose({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
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
    if (isConfirmedRef.current) return; // locked — no dragging
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const tx = manualModeRef.current ? manualXRef.current : currentTattooX.current;
    const ty = manualModeRef.current ? manualYRef.current : currentTattooY.current;
    const dist = Math.sqrt((mouseX - tx) ** 2 + (mouseY - ty) ** 2);
    if (dist < 100) {
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
    if (isConfirmedRef.current) return; // locked — no dragging
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
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        } as any}
      />

      {/* Canvas — mirrored camera feed + tattoo drawn here */}
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

      {/* Status badge — hidden when confirm popup is showing */}
      {!showConfirm && (
        <View style={styles.statusBadge}>
          <Text style={[styles.statusText, isConfirmed && styles.statusTextConfirmed]}>
            {statusMessage}
          </Text>
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
            style={{
              flex: 1,
              accentColor: '#E24B4A',
              cursor: 'pointer',
              margin: '0 8px',
            } as any}
          />
          <Text style={styles.readoutFixed}>{Math.round(opacity * 100)}%</Text>
        </View>

        {/* Row 4: Back | Reposition/Reset | Ink Mode | Screenshot */}
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
              <Text style={styles.repositionBtnText}>Reposition ✎</Text>
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
              styles.mirrorBtn,
              isMirrored && styles.mirrorBtnActive,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.mirrorBtnText, isMirrored && styles.mirrorBtnTextActive]}>
              ⟳ Mirror
            </Text>
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
            <Text style={styles.screenshotBtnText}>📸 Screenshot</Text>
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
    borderColor: '#E24B4A',
    gap: 12,
  },
  confirmTitle: {
    color: '#F1EFE8',
    fontSize: 20,
    fontFamily: 'Georgia',
    textAlign: 'center',
    fontWeight: '700',
  },
  confirmSub: {
    color: '#888780',
    fontSize: 13,
    fontFamily: Fonts?.sans ?? 'system-ui',
    textAlign: 'center',
  },
  confirmButtons: {
    gap: 10,
  },
  confirmYes: {
    backgroundColor: '#E24B4A',
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
    borderColor: '#2C2C2A',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmNoText: {
    color: '#888780',
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
    paddingTop: 12,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  mirrorBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.bg,
  },
  mirrorBtnActive: {
    backgroundColor: 'rgba(100,180,255,0.12)',
    borderColor: '#4aabE2',
  },
  mirrorBtnText: {
    color: AppTheme.muted,
    fontSize: 12,
    fontFamily: Fonts?.sans ?? 'system-ui',
    fontWeight: '600' as const,
  },
  mirrorBtnTextActive: {
    color: '#4aabE2',
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
