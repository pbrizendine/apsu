# Publication scope

This is a source snapshot with a new history, rather than a copy of the private development repository's Git history. It excludes production database configuration, account identifiers, player-specific repair SQL, internal deployment/recovery logs, private design references, backups, and untracked scratch files.

It includes browser source, Worker/local relay source, generic historical SQL and tests, an authored test-world fixture, fonts with their existing licenses, and the vendored Supabase browser client. `docs/vendor-audit.json` records the vendor source/version; upstream notices remain in the vendored file. No live player database, user-uploaded pictures, browser save data, or provider API keys are supplied.

APSU's original source in this snapshot is released under the [MIT License](../LICENSE). You may use, modify, and redistribute it subject to that license. Bundled third-party components retain their own terms and notices: the Supabase browser client is vendored with its upstream notice, and the fonts retain their accompanying OFL files.
