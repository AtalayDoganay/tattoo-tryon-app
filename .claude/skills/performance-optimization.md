# Performance Optimization

Source: https://github.com/addyosmani/agent-skills/tree/main/skills/performance-optimization

## Core Rule

**Measure first. Never optimize without profiling.** Guessing leads to premature optimization that adds complexity without improving what matters.

Workflow: **measure → identify → fix → verify → guard**

## React Native Performance

### Re-render Prevention
```tsx
// Memoize expensive components
const TattooCard = React.memo(({ tattoo }: { tattoo: Tattoo }) => { ... });

// Stable callbacks for list items
const handlePress = useCallback((id: string) => {
  router.push(`/tattoo/${id}`);
}, []);

// Avoid creating objects/arrays in render
// BAD: style={{ flex: 1 }}  ← new object every render
// GOOD: StyleSheet.create({ ... })
```

### List Performance
- Use `FlatList` with `keyExtractor`, `getItemLayout` when item height is fixed
- Set `removeClippedSubviews` on long lists
- Use `initialNumToRender` and `maxToRenderPerBatch` to tune
- Avoid anonymous functions in `renderItem`

### Image Performance
- Use `expo-image` (not `Image` from React Native) for caching + blurhash
- Always provide explicit dimensions
- Use appropriate `resizeMode`
- Compress images server-side before storing in Supabase Storage

### Canvas / MediaPipe (tryon-webcam)
- `canvas.width = canvas.offsetWidth` only when size changes, not every frame
- Avoid `ctx.getImageData` in tight loops
- Use `requestAnimationFrame` cadence (MediaPipe Camera handles this)
- `ctx.filter = 'none'` after blurred draws — always reset

## Supabase Query Optimization
```tsx
// Select only needed columns
const { data } = await supabase
  .from('tattoos')
  .select('id, name, image_url')  // not select('*')
  .limit(20);

// Use indexes on filtered columns
// Filter server-side, not client-side
```

## Bundle Size
- Avoid large dependencies — check with `npx expo export --dump-assetmap`
- Dynamic imports for heavy screens
- Tree-shake: import `{ specific }` not `import * as`

## Web Vitals Targets (web build)
- LCP ≤ 2.5s
- INP ≤ 200ms
- CLS ≤ 0.1
- JS bundle < 200KB gzipped

## Pre-Ship Checklist
- [ ] Profiled with React DevTools Profiler or Flipper
- [ ] No unnecessary re-renders on list scroll
- [ ] Images properly sized and cached
- [ ] Supabase queries select only needed columns
- [ ] No synchronous operations on the JS thread
- [ ] Canvas/MediaPipe: filter reset after each frame
