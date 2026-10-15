// Shared chronological rendering and local, extractive scene context. No AI request.
(() => {
  const ordered = (messages) => [...messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  function summary(world) {
    const current = ordered(world.messages).filter(
      (m) => m.visible !== false && (!m.room || m.room === world.player.room),
    );
    const selected = new Set([
      ...current.filter((m) => m.who !== 'Story').slice(-6),
      ...current.filter((m) => m.who === 'Story').slice(-4),
    ]);
    const recent = current.filter((m) => selected.has(m));

    if (!recent.length) return 'No recent conversation in this room.';

    return recent
      .map(
        (m) =>
          (m.who === 'Story'
            ? 'Verified event'
            : (m.who === 'Player' ? world.player.name : m.who) + ' says or attempts') +
          ': ' +
          m.text.replace(/\s+/g, ' ').slice(0, 240),
      )
      .join('\n');
  }

  globalThis.APSUSoloTimeline = { ordered, summary };
})();
