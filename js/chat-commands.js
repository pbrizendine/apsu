// One catalog drives parsing and the searchable, permission-filtered command list.
window.APSUCommands = (() => {
  const commands = [
    {
      names: ['my'],
      syntax: '/my action',
      description: 'Describe a possessive action, such as Henry’s hand shakes.',
      kind: 'possessive',
    },
    {
      names: ['shout'],
      syntax: '/shout message',
      description:
        'Speak to this room and directly connected rooms. Neighbours see where the shout came from.',
      kind: 'shout',
    },
    {
      names: ['admins'],
      syntax: '/admins',
      description: 'List the admins currently playing in this world.',
      kind: 'admins',
      noBody: true,
      moderation: true,
    },
    {
      names: ['help'],
      syntax: '/help message',
      description:
        'Send a private help request to this world’s admins. Replies are not guaranteed to be immediate.',
      kind: 'help',
      moderation: true,
    },

    {
      names: ['w', 'whisper'],
      syntax: '/w ID message',
      description: 'Whisper to a character in this room. Only you and they see the message.',
      target: true,
      kind: 'whisper',
    },
    {
      names: ['to'],
      syntax: '/to ID message',
      description: 'Address someone publicly. They receive a magenta attention marker.',
      target: true,
      kind: 'directed',
    },
    {
      names: ['me'],
      syntax: '/me action',
      description: 'Describe your character’s action.',
      kind: 'action',
    },
    {
      names: ['do'],
      syntax: '/do description',
      description: 'Describe something others can observe.',
      kind: 'description',
    },
    {
      names: ['sneak'],
      syntax: '/sneak',
      description:
        'Suppress your room departure notices for 30 seconds. Your character remains visible in room lists.',
      kind: 'sneak',
      noBody: true,
    },
    {
      names: ['report'],
      syntax: '/report details',
      description: 'Privately report an issue to this world’s admins.',
      moderation: true,
    },
    {
      names: ['global'],
      syntax: '/global message',
      description: 'Send a System announcement to this world.',
      moderation: true,
      rank: 1,
    },
    {
      names: ['warn'],
      syntax: '/warn ID reason',
      description: 'Save a private warning against the player in this world.',
      moderation: true,
      rank: 1,
    },
    {
      names: ['mute'],
      syntax: '/mute ID minutes reason',
      description: 'Temporarily mute a player in this world.',
      moderation: true,
      rank: 1,
    },
    {
      names: ['kick'],
      syntax: '/kick ID reason',
      description: 'Disconnect a player from this world.',
      moderation: true,
      rank: 1,
    },
    {
      names: ['ban'],
      syntax: '/ban ID reason',
      description: 'Ban a player from this world.',
      moderation: true,
      rank: 1,
    },
    {
      names: ['commands'],
      syntax: '/commands',
      description: 'Open this searchable command list.',
      kind: 'command_list',
      noBody: true,
    },
  ];

  function parse(text) {
    if (!text.startsWith('/')) return null;

    const [, name, rest = ''] = text.match(/^\/(\S+)\s*(.*)$/s) || [];
    const entry = commands.find((c) => c.names.includes(name?.toLowerCase()));

    if (!entry || (entry.noBody ? rest.trim() : !rest.trim())) throw Error('Invalid Command');

    const result = {
      kind: entry.kind || entry.names[0],
      body: rest.trim(),
      moderation: !!entry.moderation,
    };

    if (entry.target) {
      const match = rest.match(/^(?:\((\d+)\)|\[(\d+)\]|(\d+))\s+(.+)$/s);
      const target = Number(match?.[1] || match?.[2] || match?.[3]);

      if (!match || !Number.isSafeInteger(target) || target < 1 || target > 2147483647)
        throw Error('Invalid Command');

      result.target = target;
      result.body = match[4].trim();
    }

    return result;
  }

  function open(rank = 0, options = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'workspace-dialog command-dialog';
    dialog.setAttribute('aria-label', 'Command list');
    dialog.innerHTML =
      '<div class="workspace-dialog-header"><h2>Commands</h2><button type="button">Close</button></div><label>Search commands<input type="search" placeholder="Name or what you want to do" autofocus></label><div class="command-results"></div>';
    const results = dialog.querySelector('.command-results'),
      input = dialog.querySelector('input');

    function filter() {
      results.replaceChildren();
      for (const c of commands.filter(
        (c) =>
          (c.rank || 0) <= rank &&
          [c.names.join(' '), c.description]
            .join(' ')
            .toLowerCase()
            .includes(input.value.toLowerCase()),
      )) {
        const row = document.createElement('article'),
          name = document.createElement('strong'),
          detail = document.createElement('p');
        name.textContent = c.syntax;
        detail.textContent =
          (options.descriptions?.[c.names[0]] || c.description) +
          (c.names.length > 1 ? ' Alias: /' + c.names[1] + '.' : '');
        row.append(name, detail);
        results.append(row);
      }
      if (!results.children.length) results.textContent = 'No matching commands.';
    }

    input.oninput = filter;
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    filter();
    dialog.showModal();
  }

  return { parse, open, commands };
})();
