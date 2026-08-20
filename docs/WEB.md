# Aeris on the web

The public website **is the Aeris app**, not a rebuild of it. `mobile/` is an Expo project, and
Expo bundles the same React Native source for the browser through `react-native-web`. One
codebase, three targets: iOS, Android, web.

```
mobile/  ──  expo export --platform web  ──▶  mobile/dist/  ──▶  Vercel / Netlify (static)
                                                                        │
                                                                 HTTPS  ▼
                                                         aeris-core-api (Render, FastAPI)
```

There is no second frontend to keep in sync. A screen fixed in `mobile/src/screens/` is fixed
on the website at the next deploy — which is the whole reason this route was chosen over
writing a separate web app.

---

## What changes on web, and why

| Concern | On device | On web | Where |
| --- | --- | --- | --- |
| BLE pairing to the portable | `react-native-ble-plx` | Web Bluetooth — same GATT contract, one device per chooser | `src/lib/ble.web.ts` |
| Station map | WebView | Longdo JS SDK loaded into the page | `src/components/LongdoMap.web.tsx` |
| Route heat map | WebView | Same SDK, polylines drawn in the page | `src/components/RouteMap.web.tsx` |
| Screen addresses | `aeris://` deep links | Real URLs (`/history/baseline`) | `src/navigation/linking.ts` |
| Layout on a large screen | n/a | Centred 460 px app frame; full-bleed under 700 px | `mobile/public/index.html` |

Pairing is the one place the platform still decides what is possible. Web Bluetooth is
implemented by Chrome and Edge on desktop and Android, and not at all by Safari or Firefox, so
on an iPhone the pairing screen says so and the portable reports **No Data** — the honest
state, and the one the UI is already built to show (TDD §6/§14). Station data over the API is
unaffected, so everything that does not depend on a paired portable works in any browser.

Nothing else is forked. There is no web-only screen, no web-only copy, and no sample data.

### The map key must allow the site's domain

The Longdo key is issued per domain. A key whose allow-list does not contain the deployed
host still returns HTTP 200 for the SDK, but the script throws `Longdo Map API Key Error`
instead of defining `window.longdo` — the map then never appears and the screen falls back to
its "could not load the map" notice. Add every host the site is served from (the production
domain, any preview domain, and `localhost` for development) in the Longdo console. To check a
host without opening a browser:

```bash
curl -s -H "Referer: https://YOUR-DOMAIN/" "https://api.longdo.com/map/?key=YOUR_KEY" | head -c 60
# a working key starts with the SDK source; a blocked one is: throw 'Longdo Map API Key Error';
```

---

## Local preview

```bash
cd mobile
npm install
npm run build:web        # → mobile/dist
npm run preview:web      # → http://localhost:4173 (with SPA fallback)
```

For a live-reload loop, `npm run web` runs the dev server instead.

---

## Deploying

`vercel.json` and `netlify.toml` at the repo root are both committed and equivalent — use
whichever host you connect. Neither needs a dashboard build override.

### Vercel

1. **Add New → Project**, import `nattawat-ootalp/aeris`.
2. Leave Root Directory as the repo root. `vercel.json` supplies the build command
   (`npm run build:web --prefix mobile`) and output directory (`mobile/dist`).
3. Add the environment variables below, for **Production** and **Preview**.
4. Deploy. Every push to `main` redeploys; every PR gets a preview URL.

### Netlify

1. **Add new site → Import an existing project**, pick the repo.
2. `netlify.toml` supplies `base = "mobile"`, the build command, and `publish = "dist"`.
3. Add the environment variables in **Site settings → Environment variables**.
4. Deploy.

### Environment variables

`EXPO_PUBLIC_*` values are **inlined into the JavaScript bundle at build time**, not read at
runtime. Three consequences: changing one requires a rebuild, none of them may be a secret, and
a stale Metro cache will happily re-emit the *previous* value — which is why `build:web` passes
`--clear`. After changing one locally, confirm it actually landed:

```bash
grep -o 'aeris-core-api.onrender.com' dist/_expo/static/js/web/*.js   # should print a match
```

Only the Supabase *anon* key appears below; the `service_role` key stays server-side, on
Render, forever.

| Variable | Value | Required |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://aeris-core-api.onrender.com` | Yes — without it the build falls back to `localhost:8000` and every screen shows No Data |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | For sign-in |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | For sign-in |
| `EXPO_PUBLIC_LONGDO_KEY` | Longdo Map API key | For the Explore map |
| `EXPO_PUBLIC_DEFAULT_DEVICE_ID` | Station id to show before pairing | Optional |

---

## The one backend change: CORS

A browser enforces same-origin rules that a native app does not, so the API must name the
website origin explicitly. `core_api/app/main.py` already reads the list from an env var — no
code change is needed, only a value.

In the **Render dashboard → aeris-core-api → Environment**, set:

```
CORS_ORIGINS=https://<your-site>.vercel.app,http://localhost:4173,http://localhost:8081
```

Then redeploy the service. Add the custom domain to the list too if you attach one, and add
each preview origin you actually want to work — Vercel preview URLs are per-deploy, so it is
usually easier to test previews against a locally-run API.

Symptoms of forgetting this: the site loads and navigates perfectly, but every screen shows
**No Data**, and the browser console reports blocked cross-origin requests. Because
`allow_credentials=True` is set, a wildcard `*` is not a valid shortcut — origins must be
listed literally.

`/ws/realtime` is a WebSocket and is not covered by CORS middleware; browsers do not apply the
same-origin policy to WebSocket handshakes, so it connects without extra configuration.

---

## URLs

Every screen has an address (`src/navigation/linking.ts`), so reloading, bookmarking and
browser Back all behave. Both host configs rewrite unknown paths to `index.html` — without
that rewrite a reload on `/history/baseline` would 404.

| Path | Screen |
| --- | --- |
| `/` | Onboarding, or Home for a returning visitor |
| `/home` · `/home/current-exposure` · `/home/data-quality` | Home stack |
| `/exposure` · `/exposure/event/:eventId` · `/exposure/daily` | Exposure stack |
| `/explore` · `/explore/destination/:lat/:lon` · `/explore/compare` | Explore stack |
| `/history` · `/history/baseline` · `/history/pattern` | History stack |
| `/profile` · `/profile/sensor-health` · `/profile/privacy` · `/profile/about` | Profile stack |
| `/sos` · `/emergency` | Emergency modals |

`/` is intentionally unmapped. The stored onboarding flag decides the first screen; giving `/`
a route would let the address bar win that race and drop a first-time visitor straight into
Home.

---

## Privacy on a public origin

Publishing the app does not publish anyone's data. `symptom_events` and all personal exposure
records remain behind Supabase Auth and RLS (TDD §9, `infra/supabase/002_rls.sql`); the web
build calls the same authenticated endpoints as the mobile app and can reach nothing an
unauthenticated visitor could not. `robots.txt` allows crawling because there is no private
route for a crawler to find — the app shell is all a signed-out visitor ever receives.

The non-diagnostic framing is unchanged and unconditional: the website carries the same
disclaimers as the app, and the `check:safety` guard runs against the same source.
