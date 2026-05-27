# Deploy TattooAR

When asked to deploy or prepare for production:

1. Check bg_server/ has a Dockerfile and railway.json
2. Verify all env vars are in .env.example (not .env)
3. Confirm Supabase Storage bucket 'tattoo-images' is public
4. Check Expo app.json has correct bundleIdentifier and package
5. Run: npx expo export --platform web for web build
6. Remind user: Railway for Python server, Expo EAS for mobile

Stack: Expo 54 + Supabase + Python Flask on Railway
