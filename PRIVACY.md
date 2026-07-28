# Privacy — how this app handles your images

Plain answers to "what happens to my photo?". This describes what the code in
this repository actually does; it is not a legal privacy policy.

## Short version

| Feature | Does your image leave your device? |
| --- | --- |
| AR try-on with your camera (body / face) | **No.** Never. |
| Statue try-on | **No.** |
| Browsing the gallery | No image is uploaded. |
| Background removal | **Yes** — sent to our API, processed, returned, not stored. |
| Manager upload of a tattoo design | **Yes** — stored publicly, on purpose. |

---

## Camera and AR try-on

The live camera try-on runs **entirely in your browser**.

- The camera stream is rendered to a canvas on your device.
- Body and face tracking (MediaPipe Pose, MediaPipe Face Landmarker, Jeeliz
  FaceFilter) run locally as WebAssembly.
- **No video frame, photo, or tracking landmark is ever transmitted to us.**
- Nothing is recorded. Closing the page ends the session and the frames are
  gone.

The tracking models themselves are downloaded from public CDNs
(`cdn.jsdelivr.net`, `storage.googleapis.com`, `appstatic.jeeliz.com`). Those
requests fetch code and model files *to* you. They carry no image data.

Your browser will ask permission before the camera turns on. The app requests
camera access only on the try-on screens.

## Background removal

This is the one feature that sends an image to a server.

**What happens:**

1. You pick an image; it is encoded and sent over HTTPS to our
   background-removal API.
2. The server validates it (format, dimensions, size), removes the background,
   and returns the result.
3. The result is displayed in your browser. Saving it is a local browser
   download.

**What we do with it:**

- **Not stored.** The image exists only in the server process's memory for the
  duration of the request. Nothing is written to disk, and no database or
  bucket record is created.
- **Not logged.** Server logs record a request id, an outcome code, and timing.
  They never contain image data, your access token, or your `Authorization`
  header.
- **Not cached.** Responses are sent with `Cache-Control: no-store`, so neither
  your browser nor an intermediate proxy retains the result.
- **Not used for training.** The model (`u2net`, via `rembg`) is pre-trained and
  runs offline inside our own container. Your image is not sent to any
  third-party AI service on this path.

**Metadata is removed.** Photographs commonly carry EXIF data including GPS
coordinates, camera serial number, and timestamps. The processed image you get
back is rebuilt from raw pixels, which discards:

- EXIF (including GPS location)
- XMP and IPTC blocks
- ICC colour profiles
- PNG text chunks and JPEG comments

Your original filename is never used or stored.

**How long does anything last?** The image is discarded when the request
finishes — typically a few seconds. There is no retention period because there
is no retention.

### The alternative path

`supabase/functions/remove-background` is a second implementation that forwards
the image to Hugging Face's hosted RMBG-1.4 model. **If that path is used, your
image is processed by a third party (Hugging Face) under their terms.** The
main app currently calls the self-hosted API described above.

## Manager uploads

If you sign in as a studio manager and upload a tattoo design:

- the image **is** stored, in Supabase Storage;
- it is stored in a **public** bucket and served from a public URL — that is the
  point, it is your shop's portfolio;
- it is stored under a random filename inside a folder keyed to your user id;
- only you can write to, replace, or delete objects in your own folder;
- **do not upload anything you would not publish**, including photographs of
  clients without their consent.

## Accounts

- Manager sign-in uses Supabase Auth (email + password).
- On mobile, your session tokens are kept in the operating system's secure
  store (iOS Keychain / Android Keystore), not in plaintext.
- Passwords are never logged and never leave the sign-in request.
- Browsing the gallery and using try-on require no account and no personal data.

## Third parties involved

| Service | What it receives |
| --- | --- |
| Supabase | Manager account email and password hash; uploaded tattoo images; shop and design records |
| Railway | Hosts the background-removal API; sees images in transit, stores none |
| Vercel | Hosts the website; standard web request logs (IP, user agent) |
| Sketchfab | Embedded 3D statue viewer (an iframe); receives standard request data when that screen is open |
| jsDelivr / Google Storage / Jeeliz | Serve the tracking model files to your browser; receive no image data |

## Questions

Open an issue, or see [`SECURITY.md`](SECURITY.md) for private contact.
