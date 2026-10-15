// Private notices and world roles are fetched through a permission-checked RPC.
function startWorldModeration(client, worldId, chat, onExit) {
  // Keep one database-issued boundary for this page, including chat reconnects.
  const seen = new Set();
  let started = null,
    stopped = false,
    busy = false,
    staff = [];
  const link = document.getElementById('admin-panel-link');

  async function poll(initial = false) {
    if (stopped || busy) return;

    busy = true;
    try {
      const { data, error } = await client.rpc('moderation_status', {
        p_world: worldId,
        p_since: started,
      });

      if (error) throw error;
      if (stopped) return;
      if (started === null) {
        if (typeof data.since !== 'string' || !Number.isFinite(Date.parse(data.since)))
          throw new Error('Unable to establish the world session.');

        started = data.since;
      }

      staff = data.staff;
      link.dataset.rank = data.rank;
      link.hidden = !data.rank;
      link.href = 'admin.html?world=' + encodeURIComponent(worldId);
      if (data.banned || data.kicked) {
        stopped = true;
        clearInterval(timer);
        await onExit(
          data.banned
            ? 'You are banned from this world.'
            : 'An admin disconnected you from this world.',
        );

        return;
      }
      for (const n of data.notices) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          chat.addSystem(n.body, n.target ? 'local' : 'world');
        }
      }
    } catch (error) {
      if (['AP013', 'AP018'].includes(error.code)) {
        stopped = true;
        clearInterval(timer);
        await onExit(error.message);

        return;
      }
      if (initial) {
        stopped = true;
        clearInterval(timer);
        throw error;
      }
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => poll(), 5000);
  const ready = poll(true);

  return {
    ready,
    roleFor(id) {
      const roles = staff.filter((s) => (s.characters || []).includes(id)).map((s) => s.role);
      return roles.includes('APSU Founder')
        ? 'APSU Founder'
        : roles.includes('Server Owner')
          ? 'Server Owner'
          : roles.includes('Lead Admin')
            ? 'Lead Admin'
            : roles.includes('Admin')
              ? 'Admin'
              : '';
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
