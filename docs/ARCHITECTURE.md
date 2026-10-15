# Architecture

## A single-player turn

`solo.html` and `js/solo-page.js` coordinate input, display, and delivery. `js/solo-connection.js` manages the provider connection. Requests go to local/Worker `/api/solo-chat`, where `worker/solo-context.mjs` checks context and `worker/solo-dialogue-request.mjs` assembles the request. `worker/solo-dialogue-prompts.mjs` holds dialogue guidance.

The model produces dialogue and proposed actions. Scenario rules in `js/solo-engine.js`, `js/solo-mercer.js`, `js/solo-generated.js`, and `js/solo-simulation.js` check inventory, movement, payment, and combat transitions. The model is not the authoritative inventory or bank balance.

## Creation, storage, and visuals

- `js/solo-blueprint.js` and `js/solo-generation.js`: schema, normalization, staged generation.
- `worker/solo-create.mjs`: world-generation relay.
- `js/solo-store.js`, `js/solo-generation-store.js`: local worlds and unfinished creation.
- `js/solo-timeline.js`, `js/solo-checkpoints.js`: message ordering and rollback.
- `js/solo-world-ui.js`, `js/solo-editor.js`: maps, profiles, world editing.
- `js/solo-imagine.js`, `js/solo-gallery.js`, `worker/solo-imagine.mjs`: optional images.

## Multiplayer

`js/room-page.js`, `js/room-chat.js`, `js/inventory-ui.js`, and shared modules use Supabase authentication, database functions, realtime, and storage. Multiplayer authorization belongs in database policies and functions, not hidden buttons. `supabase/` contains historical migrations and fixtures.

## Running and building

`scripts/solo-dev.mjs` serves an allowlisted browser surface and local solo API routes. `worker/index.mjs` routes production API requests and static assets. `scripts/build-site.mjs` copies browser assets only. `scripts/check.mjs` runs syntax, reference, and behavioral regression checks.
