# TattooAR Platform — Claude Context

## Motto
"Try on your ink before it's permanent"

## Stack
- Expo 54 + React Native + TypeScript
- Expo Router (file-based routing)  
- Supabase (auth, PostgreSQL, storage)
- Python Flask (bg_server/) → AI background removal via rembg
- MediaPipe Holistic (CDN) → body/hand AR tracking

## Current Status
MVP. One artist live: Frog God Tattoo.
Priority: deploy publicly (Railway + EAS).

## Key Files
app/(tabs)/index.tsx — home screen (shop list + slideshow)
app/removebg.tsx — AI background removal
app/tryon-webcam.tsx — AR webcam try-on (MediaPipe Holistic)
app/tryon-statue.tsx — 3D statue try-on (Sketchfab embed)
app/manager/index.tsx — manager dashboard
app/_layout.tsx — root navigator, ALL routes registered here
bg_server/server.py — Python Flask AI server (rembg)
lib/supabase.ts — Supabase client
constants/theme.ts — AppTheme colors (SINGLE SOURCE OF TRUTH)
components/AuthProvider.tsx — auth context

## Database
Tables: shops, tattoos
Supabase project: bntoeowrvvhuaypddxnl
Auth: manager login only, RLS blocks cross-shop edits
Storage bucket: tattoo-images (public)

## Coding Rules — NON NEGOTIABLE
- ALL colors from AppTheme — no raw hex in components
- ALL styles in StyleSheet.create — no inline style objects
- TypeScript strict — no any without comment explaining why
- Platform.OS === 'web' guard before ANY browser API
- Every new screen registered in app/_layout.tsx
- Stale closure pattern for ALL MediaPipe/canvas callbacks

### Stale Closure Pattern (critical for MediaPipe callbacks)
`onResults` is registered once — it always sees stale state.
Pair every state var used in callbacks with a ref synced via useEffect:
```tsx
const xRef = useRef(x);
useEffect(() => { xRef.current = x; }, [x]);
// Use xRef.current inside onResults, never x directly
```

### CSS-only Properties Exception
backgroundImage, backgroundPosition, backgroundSize, filter, accentColor
must be inline: `Platform.OS === 'web' ? { ...cssProps } as object : {}`

## AR Architecture
- MediaPipe Holistic loaded via CDN (3 scripts sequential)
- Scripts: camera_utils → control_utils → holistic
- Offscreen canvas for segmentation mask compositing
- Stale closure: every state var needs paired useRef + useEffect sync
- Hand orientation: cross product of wrist→index × wrist→pinky vectors
- Body parts: Chest(11+12), L.Arm(hand or 13+15), R.Arm(hand or 14+16),
  L.Shoulder(11), R.Shoulder(12), Neck(above shoulder midpoint)
- Mirror detection: auto from wrist positions + manual toggle button

## Python Server
Location: bg_server/server.py
Port: 5001
Health check: GET http://localhost:5001/health
Start: cd bg_server && python server.py
Deploy target: Railway.app

## Next Priorities
1. Deploy bg_server to Railway
2. Photo try-on feature  
3. Artist onboarding flow
4. Booking system

## Running Locally
```bash
npx expo start --web --clear     # Expo dev server
cd bg_server && python server.py  # Python AI server (separate terminal)
```

## Skills Reference
See .claude/skills/ for detailed guides:
- frontend-ui-engineering.md — React Native UI best practices
- performance-optimization.md — profiling and optimization
- debugging-and-error-recovery.md — systematic debugging (stale closures)
- code-review-and-quality.md — five-axis review checklist
- security-and-hardening.md — Supabase RLS, secrets, file upload validation

## Commands Reference
See .claude/commands/ for task-specific guides:
- deploy.md — production deployment checklist
- newfeature.md — pattern for adding new screens/features
- ar-debug.md — MediaPipe/canvas debugging guide
- supabase.md — RLS policies, storage, auth patterns
- artist-onboard.md — onboarding flow for new artists
