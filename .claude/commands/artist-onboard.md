# Artist Onboarding Flow

New artist signup needs:
1. Supabase Auth account creation (email + password)
2. INSERT into shops table:
   (name, slug, owner_user_id, location, instagram, bio)
3. Link auth.uid() to shops.owner_user_id
4. Redirect to /manager dashboard
5. Show upload prompt for first tattoo

Current artist: Frog God Tattoo
Next artists need unique slugs for gallery URL: /gallery/[slug]

Onboarding screen: app/onboard.tsx (not built yet)
Form fields: Studio name, slug, location, Instagram handle, bio
After submit: create Supabase auth user + insert shop row
