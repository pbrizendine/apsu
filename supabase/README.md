# Multiplayer database source — historical, advanced setup

These SQL files document schema/function changes and rollback-oriented test fixtures from the prototype. They are supplied for understanding and future development, not as a verified install sequence for a blank database. Some depend on earlier tables, Supabase auth/storage, extensions, publications, roles, and existing seed worlds.

Do not apply the directory blindly to any live project. Do not point a fork at the original APSU backend. Use your own disposable Supabase project, review dependencies and migration order, and verify permissions with multiple test accounts. A reproducible baseline schema and seed process are still needed before independent multiplayer setup can be called supported.

Single-player does not use these files or Supabase. See `../docs/SETUP.md`.

Historical owner-email references use `owner@example.invalid` placeholders. They do not grant the original operator any rights to your backend. Review or remove privileged seed statements before using a migration.
