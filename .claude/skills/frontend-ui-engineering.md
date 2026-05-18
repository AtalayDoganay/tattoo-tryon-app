# Frontend UI Engineering

Source: https://github.com/addyosmani/agent-skills/tree/main/skills/frontend-ui-engineering

## Core Principles

**Component Architecture**
- Colocate related files (component + styles + tests)
- Prefer composition over configuration
- Separate data fetching from presentation logic
- Keep components focused and single-purpose

**State Management Hierarchy**
1. Local state (`useState`) — simplest, use by default
2. Lifted state — when siblings need to share
3. Context — for cross-cutting concerns (theme, auth)
4. Global store — only when context is insufficient

Choose the simplest approach that works.

**Design System Adherence**
Always use the project's design system. For this app: `AppTheme` from `constants/theme.ts`.

Anti-patterns to avoid:
- Excessive gradients
- Uniform border-radius on everything
- Oversized padding
- Arbitrary colors not in the design system
- Inline styles (use `StyleSheet.create`)

## Accessibility (WCAG 2.1 AA)

- Every interactive element needs `accessibilityLabel`
- Minimum touch target: 44×44pt
- Meaningful empty and error states (never show a blank screen)
- Test with VoiceOver (iOS) / TalkBack (Android)
- Sufficient color contrast (4.5:1 for text)

## Responsive Design

- Mobile-first
- Never hard-code pixel widths; use `Dimensions`, `flexbox`, `%`
- Test at multiple screen sizes
- Use `useSafeAreaInsets` for notch/home-indicator padding

## React Native Specifics

- Prefer `FlatList` / `SectionList` over `ScrollView` for long lists
- Use `useCallback` / `useMemo` to prevent unnecessary re-renders in list items
- `StyleSheet.create` is required — no inline style objects (they allocate on every render)
- `Platform.OS === 'web'` guard all browser-only APIs (`document`, `window`, `canvas`)
- Images: always set explicit `width` + `height` or use `flex: 1` with `resizeMode`

## Pre-Ship Checklist

- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No inline styles (all in `StyleSheet.create`)
- [ ] All colors from `AppTheme`
- [ ] Loading + error + empty states handled
- [ ] Accessible (labels, contrast, touch targets)
- [ ] Tested on both light and dark theme
- [ ] No `console.log` left in production paths
