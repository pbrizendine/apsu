# APSU — Any world for any story

APSU is a browser-based roleplaying platform with multiplayer systems and locally saved AI single-player worlds. This public pre-alpha snapshot can run on your own computer without connecting to the original APSU database.

## Start here

Install **Node.js 22 or newer**, download or clone this repository, then run from its folder:

```sh
node scripts/solo-dev.mjs
```

Open **http://127.0.0.1:8787/launchpad.html#single-player**. Choose **New World** and an authored scenario to try the gameplay without an account or AI key. Keep the terminal server running. No npm dependency installation is required.

To generate a world or talk with AI characters, connect your own OpenRouter key through the in-game AI settings. Provider limits, availability, and charges apply; paid models require explicit selection. Review the chosen model before sending a request. Optional image generation has separate settings. The local server relays these requests; a plain static file server cannot serve AI endpoints.

## What is included

- Authored scenarios and staged world creation from a prompt.
- Individual NPC profiles, memories, goals, relationships, and proposed actions.
- Inventory, keys, lockpicking, currency, rentals, drinks, and combat.
- Maps, world editing, local saves, and JSON import/export.
- Optional scene and room images with keep/discard controls.
- Multiplayer frontend, Worker source, database history, and regression tests for study and further development.

The application checks proposed changes before applying them. AI dialogue can still be inconsistent. This is a developing prototype, not a finished game or a general-purpose scripting engine.

## Your worlds and data

Single-player saves live in your browser's storage, not the multiplayer database. Saves are specific to the browser and site address. Export a JSON backup before clearing browser data. Image blobs are stored separately and are not included in exported JSON saves. AI features send relevant context to the provider you select. API keys are not included in exported worlds.

## Develop and verify

```sh
node scripts/check.mjs
node scripts/build-site.mjs
```

Tests use mocked responses and do not spend provider credit. Build output goes into `dist`. Browser assets and server source are separate; never deploy the repository root as an unrestricted static directory.

- [Local setup and hosting](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Worlds and gameplay extensions](docs/EXTENDING.md)
- [Multiplayer backend status](supabase/README.md)
- [Publication scope and third-party notices](docs/PUBLIC-SNAPSHOT.md)

## Multiplayer status

Multiplayer needs your own Supabase backend. This snapshot has no connection to the original project. The SQL directory preserves historical schema/function changes, not a verified fresh-install recipe. Copying credentials into the configuration does not install a database. Independent multiplayer deployment remains an advanced, unfinished setup path. Single-player is the supported starting point.

## License

[MIT](LICENSE), copyright 2026 Preston Brizendine. Bundled third-party components retain their own licenses and notices.
