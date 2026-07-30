# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## ⚠️ Background removal is intentionally disabled

The AI background-removal feature is **switched off in production on purpose**,
and will stay off until `bg_server` is redeployed.

The Flask service that powered it is not currently running — its host answers
`404 Application not found`. Rather than let the UI advertise a feature that
fails on use, the app now:

- **hides the entry point.** The "Remove tattoo backgrounds" banner on the home
  screen is gone.
- **keeps the `/removebg` route**, so an old link or bookmark lands on a plain
  "Background removal is temporarily unavailable." message rather than a 404.
- **makes no network request from that screen.** No health check, no upload, and
  the backend URL is not read there at all — so there is no hanging request, no
  console error, and no hostname shown to the user.

Nothing else is affected. Shops, galleries, tattoo detail, try-on, and the
manager dashboard all work normally.

### Restoring it

1. Deploy `bg_server` (Dockerfile + Gunicorn via `wsgi.py`) and give it a Redis
   service for distributed rate limiting — **not** `memory://`.
2. Set `EXPO_PUBLIC_BG_SERVER_URL` in the Vercel production environment to the
   new public URL.
3. Restore the previous screen implementation, which is preserved in git:
   `git show 5b4d718:app/removebg.tsx`
4. Restore the home-screen banner — see the comment left in place at its old
   location in `app/(tabs)/index.tsx`.
5. Work through [`docs/PRODUCTION_SECURITY_CHECKLIST.md`](docs/PRODUCTION_SECURITY_CHECKLIST.md)
   §1 before pointing the app at the new service.

**Note:** `/removebg` was also the only screen linking to `/tryon-statue` and
`/tryon-webcam`. Those routes still exist and still work, but nothing in the UI
navigates to them while background removal is disabled.

## Environment Setup

1. Copy `.env.example` to `.env`
2. Fill in your Supabase URL and anon key from your Supabase project settings
3. Never commit `.env` to git — it contains secrets

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
