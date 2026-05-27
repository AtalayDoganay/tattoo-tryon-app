# Supabase Patterns for TattooAR

Project URL: https://bntoeowrvvhuaypddxnl.supabase.co

RLS rules:
- anon role: SELECT only on shops and tattoos
- authenticated role: SELECT + INSERT + UPDATE + DELETE 
  on own shop's data only
- Policy check: auth.uid() must match shops.owner_user_id
- tattoos INSERT: EXISTS (SELECT 1 FROM shops WHERE 
  shops.id = shop_id AND shops.owner_user_id = auth.uid())

Storage:
- Bucket: tattoo-images (public)
- Upload path: {user_id}/{timestamp}.{ext}
- Get public URL: supabase.storage.from('tattoo-images').getPublicUrl(path)

Tables:
shops: id, name, slug, owner_user_id, created_at
tattoos: id, shop_id, name, style, description, image_url, created_at

Auth pattern:
- Login: supabase.auth.signInWithPassword({ email, password })
- Session check: supabase.auth.getSession()
- Sign out: supabase.auth.signOut()
- Auth context: components/AuthProvider.tsx

When writing new RLS policy, always test with anon key AND authenticated.
Never use service role key in Expo app — only in Edge Functions or bg_server.
