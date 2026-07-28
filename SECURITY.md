# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.** A public
issue tells everyone about the weakness before there is a fix.

Report privately instead, using either route:

1. **GitHub private vulnerability reporting** (preferred)
   Go to the [Security tab](https://github.com/AtalayDoganay/tattoo-tryon-app/security)
   → **Report a vulnerability**. This opens a private thread visible only to
   the maintainer.

2. **Email** — doganayatalay12@gmail.com with `SECURITY` in the subject line.

Please include:

- what the issue is and roughly how severe you think it is
- the steps to reproduce it
- the affected component (Expo app, web build, Supabase, or the
  background-removal API)
- any proof-of-concept you have

### Do not include in a report

Reports are read by a human and may be quoted in a fix commit. Never paste:

- API keys, tokens, passwords, or `.env` file contents
- `Authorization` headers, JWTs, or session cookies
- database connection strings
- production logs containing other people's personal data or photographs

If demonstrating the issue genuinely requires a credential, say so and we will
arrange a private channel. **Redact the value in the report itself.**

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement | within 5 days |
| Initial assessment | within 14 days |
| Fix or mitigation for a confirmed high-severity issue | within 30 days |

This is a small, single-maintainer hobby project — these are honest targets,
not a contractual SLA. You will get a straight answer either way.

We will credit you in the fix unless you would rather stay anonymous.

## Supported versions

Only the code currently on the `main` branch, and the deployments built from
it, receive security fixes. There are no long-term support branches and no
backports to older tags.

| Version | Supported |
| --- | --- |
| `main` (current deployment) | Yes |
| Any older commit or tag | No |

## Scope

In scope:

- the Expo / React Native application (`app/`, `components/`, `lib/`)
- the Expo web build as deployed to Vercel
- the Flask background-removal API (`bg_server/`)
- the Supabase Edge Function (`supabase/functions/`)
- Supabase Row Level Security policies (`supabase/migrations/`)

Out of scope:

- vendored agent tooling under `.agents/` and `.claude/`, which is development
  scaffolding and is not shipped to users
- findings that require a compromised device or a physically present attacker
- missing hardening headers with no demonstrated impact
- third-party services themselves (Supabase, Railway, Vercel, Sketchfab,
  Hugging Face) — report those to the respective vendor

## A note on the Supabase publishable key

The Supabase project URL and the publishable (anon) key are embedded in the
client bundle **by design**. They are public, and finding them in the JavaScript
bundle or in git history is not a vulnerability.

Those values grant nothing on their own: every read and write is gated by
Row Level Security in Postgres. If you find a query that returns data RLS
should have blocked, or a write that succeeds without the right ownership,
**that** is the vulnerability and we want to hear about it.

The keys that genuinely matter — `service_role` / `sb_secret_*`, the JWT
signing secret, the database password, and deployment tokens — are never
present in this repository. If you ever find one here, treat it as a critical
incident and report it privately and immediately.

## If a credential is exposed

For maintainers, in order:

1. **Revoke or rotate first.** A credential in a public repository must be
   assumed compromised the moment it is pushed. Rewriting history does not
   un-leak it; clones, forks, and scrapers already have it.
2. Rotate in the provider dashboard (Supabase → Settings → API; Railway →
   Variables; Vercel → Environment Variables; GitHub → Settings → Tokens).
3. Update the deployment environments with the new value.
4. Check provider logs for use of the old credential.
5. Only then consider cleaning git history, and warn every collaborator before
   a force push.
