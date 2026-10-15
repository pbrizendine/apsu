Whisper database history

Already working database: do not rerun the migrations.
For a database with the existing chat, OOC, and shared-world schema:
1. Run 001-create.sql once.
2. Run 002-sender-visibility.sql once.
3. Run tests.sql to verify. It rolls back all test data.

002 replaces the same send_room_whisper function; it does not add a
second whisper service. Keep both migrations for existing installations.

Active browser logic: ../../js/room-chat.js
Appearance: ../../css/theme.css, --whisper-accent
Local checks: ../../tests/whispers-ui.cjs and whispers-logs.cjs

Behavior: room-specific stable IDs; /w and /whisper; sender and recipient
see the private message; other room occupants see a public notice at most
once per minute per pair. Whisper records use the existing 24-hour IC logs.
