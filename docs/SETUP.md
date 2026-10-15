# Local setup and hosting

## Single-player quick start

1. Install Node.js 22 or newer.
2. Open a terminal in this repository.
3. Run `node scripts/solo-dev.mjs`.
4. Open `http://127.0.0.1:8787/launchpad.html#single-player`.
5. Start an authored world without an account. Connect your own OpenRouter key only if you want AI features.

If port 8787 is occupied, run `APSU_SOLO_PORT=8790 node scripts/solo-dev.mjs` on macOS/Linux. On PowerShell use `$env:APSU_SOLO_PORT=8790` before running the command. Then open that port. A different port has a separate browser-save origin.

The preview listens on loopback only. It is a development server, not a public production server. Stop it with Ctrl+C. Do not bypass browser security or share API keys to troubleshoot requests.

## Verification

Run `node scripts/check.mjs` for mocked regression checks, then `node scripts/build-site.mjs` to create `dist`. These do not verify live provider availability or a new multiplayer database. Local route validation tests can run without an API key.

## Your own multiplayer configuration

`js/apsu-config.js` defaults to blank values. Only after preparing and testing your own compatible Supabase schema, replace `supabaseUrl` and `supabasePublishableKey` with your project's public settings. They are browser-visible. Never use a service-role/secret key.

Configure authentication redirects, email delivery, storage policies, realtime publication, SQL permissions, and row-level security in your own project. See `supabase/README.md` for limitations. There is no verified one-command multiplayer install yet.

## Optional Cloudflare hosting

The included `wrangler.jsonc` has a generic Worker name and no account ID. Build `dist`, install/configure Wrangler in your own environment using Cloudflare's current instructions, authenticate to your own account, review the Worker name and bindings, then deploy from that configuration. See https://developers.cloudflare.com/workers/wrangler/configuration/ .

The Worker needs the `ASSETS`, `SOLO_LIMIT`, and `IMAGINE_LIMIT` bindings declared in the configuration. Solo relay routes work without Supabase. The authenticated multiplayer `/api/imagine` route additionally requires Worker bindings `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, matching your browser settings; it returns 503 when not configured. These are public configuration, not service-role credentials.

Public hosting makes the guest relay reachable by others. Its rate limits are only prototype protections; review abuse controls, provider costs, policies, and deployment permissions before inviting traffic. Do not log request bodies or provider keys. No deployment is performed by the local-start command.
