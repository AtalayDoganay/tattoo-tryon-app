# Debug AR / MediaPipe Issues

When AR tracking is broken:
1. Check MediaPipe CDN scripts loaded in correct order:
   camera_utils → control_utils → holistic
2. Stale closure pattern REQUIRED for all MediaPipe callbacks
   Every state var used in onResults needs a paired ref:
   const xRef = useRef(x); 
   useEffect(() => { xRef.current = x; }, [x]);
3. Body segmentation uses offscreen canvas with destination-in compositing
4. Hand orientation: crossZ product detects palm vs back of hand
5. Mirror detection: auto-detects from wrist positions, manual toggle available
6. 3D debug overlay: rotation°, distance scale, visibility%, hand detection

Landmarks used:
- Chest: 11+12 shoulders midpoint
- Left Arm: hand landmarks[0,5,17] or pose 13,15
- Right Arm: hand landmarks[0,5,17] or pose 14,16
- Left Shoulder: landmark 11
- Right Shoulder: landmark 12
- Neck: between shoulders, above midpoint

Common fixes:
- Tattoo goes opposite direction → mirror X: use (1-landmark.x)*width
- Tattoo doesnt follow body → check pendingConfirmRef pattern
- Canvas blank → check loadScripts() promise chain
- No body detected → check camera permissions in browser
