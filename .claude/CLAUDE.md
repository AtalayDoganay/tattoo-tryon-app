# Tattoo Try-On App

## Stack
- Expo 54 + React Native + TypeScript
- Expo Router (file-based routing)
- Supabase (auth + database + storage)
- Python Flask server for background removal (port 5001)
- MediaPipe for AR body tracking (CDN-loaded, web only)

## Key Files
- `app/(tabs)/index.tsx` — home screen (shop list)
- `app/removebg.tsx` — background removal (web only, calls Python server)
- `app/tryon-webcam.tsx` — AR webcam try-on with MediaPipe Pose
- `app/tryon-statue.tsx` — static 3D statue try-on (Sketchfab embed)
- `app/tryon/[id].tsx` — tattoo try-on screen
- `app/_layout.tsx` — root navigator, ALL routes must be registered here
- `bg_server/server.py` — Python Flask AI server (rembg + threshold)
- `lib/supabase.ts` — Supabase client
- `lib/tattoo-data.ts` — data fetching helpers
- `constants/theme.ts` — AppTheme, Fonts (single source of truth for design)
- `components/AuthProvider.tsx` — auth context

## Coding Rules

### Colors and Styles — non-negotiable
- ALL colors from `AppTheme` in `constants/theme.ts`. No raw hex strings in components.
- ALL styles in `StyleSheet.create`. No inline `style={{ ... }}` object literals in JSX.
- Dark theme: bg `#0a0908`, surface `#141210`, accent `#E24B4A`, text `#f5f0eb`, muted `#8a7f76`, border `#2a2420`
- Exception: CSS-only properties (`backgroundImage`, `backgroundPosition`, `backgroundSize`, `filter`, `accentColor`) must be inline with `Platform.OS === 'web' ? { ...cssProps } as object : {}`

### TypeScript
- Strict mode — no `any` without a comment explaining why
- Use `as any` only for Expo Router typed pathnames that haven't propagated yet
- Type all props, state, and return values

### Platform Guarding
- Always check `Platform.OS !== 'web'` before accessing `document`, `window`, `canvas`, `navigator`
- Web-only screens (MediaPipe, canvas) must show a mobile fallback UI
- `StatueViewer` component pattern: `Platform.OS === 'web'` → `<iframe>`, else `<WebView>`

### Routing
- Every new screen must be registered in `app/_layout.tsx` as `<Stack.Screen name="..." />`
- Use `useLocalSearchParams` for route params — validate them before use

### Stale Closures (critical for MediaPipe / Canvas callbacks)
- `onResults` is registered once and never re-registered — it will always see stale state
- Pattern: pair every state variable used in callbacks with a `ref` synced via `useEffect`
```tsx
const opacityRef = useRef(opacity);
useEffect(() => { opacityRef.current = opacity; }, [opacity]);
// Use opacityRef.current inside onResults, never opacity directly
```

## Architecture Notes

### Background Removal Flow
1. User picks image in `app/removebg.tsx`
2. Sends base64 to `bg_server/server.py` at `EXPO_PUBLIC_BG_SERVER_URL/remove-bg`
3. Server uses threshold (light bg) or rembg AI (dark/complex bg)
4. Returns base64 PNG with transparent background
5. User can "Try On Statue" or "Try On Yourself →"

### AR Webcam Flow (`app/tryon-webcam.tsx`)
1. MediaPipe scripts loaded sequentially from CDN
2. Hidden `<video>` streams webcam to MediaPipe Pose
3. `onResults` draws mirrored feed + tattoo on `<canvas>`
4. Tattoo placement: midpoint of shoulders + hips (auto torso center)
5. Manual override: click/drag on canvas sets `manualMode = true`
6. Blend modes: `multiply` (ink on skin) or `source-over` (floating)

### Supabase Auth
- `AuthProvider` wraps the whole app in `_layout.tsx`
- Protected screens check session via `supabase.auth.getSession()`
- Never use the service role key in the Expo app

## Running Locally
```bash
# Start Expo
npx expo start --web

# Start Python server (separate terminal)
cd bg_server
pip install -r requirements.txt
python server.py
# Runs on http://localhost:5001
# Health check: GET http://localhost:5001/health
```

## Skills Reference
See `.claude/skills/` for detailed guides on:
- `frontend-ui-engineering.md` — React Native UI best practices
- `performance-optimization.md` — profiling and optimization
- `debugging-and-error-recovery.md` — systematic debugging (especially stale closures)
- `code-review-and-quality.md` — five-axis review checklist
- `security-and-hardening.md` — Supabase RLS, secrets, file upload validation
