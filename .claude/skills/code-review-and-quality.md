# Code Review and Quality

Source: https://github.com/addyosmani/agent-skills/tree/main/skills/code-review-and-quality

## The Approval Standard

"Approve a change when it definitely improves overall code health, even if it isn't perfect."

## Five-Axis Review

### 1. Correctness
- Does the code do what it claims?
- Are edge cases handled? (empty arrays, null/undefined, network errors)
- Does the loading / error / empty state render correctly?
- Are types accurate (no `as any` without justification)?

### 2. Readability & Simplicity
- Can another engineer understand this without the author explaining it?
- Names describe intent (`handleRemoveBg`, not `handleClick`)
- No dead code, commented-out blocks, or `TODO` left in final state
- Functions do one thing

### 3. Architecture
- Colors/fonts from `AppTheme` / `Fonts` — not hardcoded
- Styles in `StyleSheet.create` — no inline objects
- Platform-specific code behind `Platform.OS` guard
- No business logic in UI components (keep `lib/` pure)

### 4. Security
- No secrets hardcoded (use `EXPO_PUBLIC_` env vars for public, `.env` only for server)
- Supabase queries scoped to the authenticated user (RLS + client-side filter)
- Python server: validate input type/size before processing
- No `eval()`, no `innerHTML` with user data

### 5. Performance
- No object literals in `StyleSheet` (allocates every render)
- `FlatList` for any list > 10 items
- `useCallback` / `React.memo` for list item callbacks
- Canvas `ctx.filter` reset after blurred draws

## Severity Labels

| Label | Meaning |
|-------|---------|
| **Critical** | Blocks merge — security hole, data loss, crash |
| *(none)* | Must fix before ship |
| **Nit** | Optional polish |
| **Consider** | Worth discussing |
| **FYI** | Informational, no action needed |

## Change Size Guidelines

- ~100 lines → ideal
- ~300 lines → acceptable
- ~1000 lines → split it

## This Project's Non-Negotiables

- `AppTheme` for ALL colors — no hex strings outside `constants/theme.ts`
- `StyleSheet.create` for ALL styles — no `style={{ ... }}` in JSX
- TypeScript strict — no `any` without a comment explaining why
- `Platform.OS` guard before any `window` / `document` / `canvas` access
- Routes registered in `app/_layout.tsx` before use
- Expo Router typed pathnames — use `as any` only as last resort with a comment

## Before Marking a PR Ready

- [ ] `npx tsc --noEmit` passes
- [ ] All five axes reviewed
- [ ] No critical or unlabeled findings unresolved
- [ ] Tested manually on the happy path
