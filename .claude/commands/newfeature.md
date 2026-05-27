# Add New Feature to TattooAR

Pattern for all new features:
- UI components go in /components with AppTheme colors 
  (black bg #0a0908, red accent #E24B4A)
- New screens go in /app/ using Expo Router file-based routing
- Register every new screen in app/_layout.tsx
- DB changes: write Supabase migration SQL + update RLS policies
- Always use TypeScript, never any types
- Fetch data via Supabase client in lib/
- Use Screen.tsx wrapper and BackHeader.tsx for consistent nav
- All styles in StyleSheet.create, never inline objects
- All colors from AppTheme in constants/theme.ts

Current tables: shops, tattoos
Auth: Supabase Auth, manager-only writes via RLS
