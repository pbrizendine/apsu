(() => {
  const $ = (id) => document.getElementById(id),
    engine = APSUSoloEngine,
    store = APSUSoloStore;

  let world,
    key = '',
    automaticallyRestored = false,
    provider = 'openrouter',
    model = 'apodex/apodex-1.1-mini:free',
    reportedCost = 0,
    costReceipts = 0,
    attemptedCalls = 0,
    sneakUntil = 0,
    typing = false,
    busy = false,
    dirty = false,
    queue = Promise.resolve(),
    inactivity,
    renderedCount = 0;
  window.addEventListener('focus', async () => {
    if (!world || busy || dirty) return;

    const id = world.id,
      revision = world.revision;

    try {
      const latest = await store.get(id);

      if (
        latest &&
        !busy &&
        !dirty &&
        world.id === id &&
        world.revision === revision &&
        latest.revision > revision
      ) {
        world = latest;
        render();
      }
    } catch (error) {
      $('solo-error').textContent = error.message;
    }
  });
  let lastTurn = null;
  const outbox = [];

  async function restoreLastTurn(turn) {
    const restored = engine.validate(turn.before);
    restored.revision = world.revision;
    restored.usage = structuredClone(world.usage); // Undo never erases billed usage.
    renderedCount = -1;
    outbox.splice(0);
    await commit(restored);
    if (!$('solo-message').value.trim()) {
      $('solo-message').value = turn.text;
      $('solo-message').oninput();
    }

    lastTurn = null;
    $('solo-error').textContent = 'Latest exchange undone. Provider usage cannot be refunded.';
  }

  $('solo-undo').onclick = () => {
    const turn = lastTurn;

    if (!turn || dirty) return;
    if (turn.active) {
      turn.cancelled = true;
      turn.controller.abort();
      return;
    }
    if (busy || turn.revision !== world.revision) return;

    busy = true;
    enqueue(async () => {
      try {
        await restoreLastTurn(turn);
      } catch (e) {
        $('solo-error').textContent = e.message;
      } finally {
        busy = false;
        render();
      }
    });
  };
  let previousOpponent = null;
  let selectedNPC = 'mara',
    replyingNPC = null,
    profileNPC = null,
    lockTarget = null,
    lastReactionAt = 0,
    wholeMap = false;

  const roomData = () => engine.roomsFor(world);

  const actors = () =>
    engine.actors(world).filter((n) => !world.sim || world.sim.people[n.id]?.hp > 0);

  const picks = () => engine.inventory(world).filter((i) => i.kind === 'lockpick');

  const actorName = (id) => actors().find((n) => n.id === id)?.name || 'Character';

  function refreshOutbox() {
    renderedCount = -1;
    render();
  }

  const lockDialog = $('lockpick-dialog'),
    frame = $('solo-lock-frame');

  function enqueue(work) {
    queue = queue.then(work).catch((e) => {
      $('solo-error').textContent = e.message;
    });
    return queue;
  }

  function button(label, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = busy || dirty;
    b.onclick = () => enqueue(action);

    return b;
  }

  async function commit(next) {
    $('save-status').textContent = 'Saving…';
    try {
      world = await store.save(next);
      dirty = false;
      $('solo-error').textContent = '';
      $('save-status').textContent = 'Saved on this device';
      $('retry-save').hidden = true;
    } catch (e) {
      world = next;
      dirty = true;
      $('save-status').textContent = 'Not saved — download a backup';
      $('retry-save').hidden = false;
      throw e;
    } finally {
      render();
    }
  }

  async function action(name, value) {
    if (busy || dirty) return;

    await commit(
      engine.act(
        world,
        name,
        name === 'move' && Date.now() < sneakUntil ? { room: value, quiet: true } : value,
      ),
    );
  }

  function render() {
    if ($('solo-undo')) {
      $('solo-undo').hidden =
        !lastTurn || (!lastTurn.active && lastTurn.revision !== world?.revision);
      $('solo-undo').textContent = lastTurn?.active ? 'Cancel reply' : 'Undo last message';
      $('solo-undo').disabled = dirty || !!lastTurn?.cancelled;
    }
    if (!world) return;

    window.APSUTheme?.setWorld(world);
    imagine?.refresh?.();
    $('solo-layout').hidden = false;
    $('download-save').disabled = false;
    $('room-title').textContent = roomData()[world.player.room].name;
    $('room-description').textContent =
      roomData()[world.player.room].description +
      (world.sim?.housing?.[world.player.room]?.tenant === 'player' ? '\nYour rented home' : '');
    $('solo-world-heading').textContent = 'Single Player / ' + world.title;
    $('solo-world-name').textContent = world.title;
    const currentRoom = world.blueprint?.rooms.find((r) => r.id === world.player.room);
    const currentBuilding = currentRoom
      ? APSUSoloBlueprint.buildingFor(world.blueprint, currentRoom.zone)
      : null;
    const currentArea = world.blueprint?.zones.find((z) => z.id === currentRoom?.zone);
    $('solo-location-context').textContent = currentBuilding
      ? 'Inside ' +
        currentBuilding.name +
        (currentArea.id !== currentBuilding.id ? ' · ' + currentArea.name : '')
      : currentArea
        ? 'Area · ' + currentArea.name
        : '';
    $('solo-location-context').hidden = !currentArea;
    $('solo-map-heading').textContent = wholeMap
      ? world.title + ' · Streets & buildings'
      : (currentBuilding?.name || currentArea?.name || world.title) +
        ' · ' +
        (currentBuilding ? 'Interior plan' : 'Local map');
    $('map-area-mode').textContent = currentBuilding ? 'Inside this building' : 'This area';
    $('map-world-mode').textContent = 'Streets & buildings';
    const nearby = actors().filter((n) => n.room === world.player.room);
    const roster = $('room-characters');
    roster.replaceChildren();
    const own = document.createElement('button');
    own.type = 'button';
    own.className = 'solo-own-character';
    own.textContent =
      '[1] ' + world.player.name + ' · View / edit your character' + roleSuffix('player');
    own.onclick = openPlayer;
    roster.append(own);
    for (const n of nearby) {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.characterId = n.id;
      row.dataset.characterName = n.name;
      const name = document.createElement('span'),
        detail = document.createElement('span');
      name.className = 'solo-character-name';
      name.textContent = '[' + n.number + '] ' + n.name;
      detail.className = 'solo-character-detail';
      detail.textContent =
        (world.sim?.people[n.id]?.knockedOutUntil
          ? 'Unconscious · recovering'
          : n.following
            ? 'Following you'
            : 'View character profile') + roleSuffix(n.id);
      row.append(name, detail);
      row.onclick = () => openCharacter(n.id);
      roster.append(row);
    }

    const audible = actors().filter(
      (n) =>
        (!world.sim || APSUSoloSimulation.conscious(world, n.id)) &&
        (n.room === world.player.room || roomData()[world.player.room].exits.includes(n.room)),
    );
    const opponent = world.sim?.combat?.enemy || null;

    if (opponent && opponent !== previousOpponent) selectedNPC = opponent;

    previousOpponent = opponent;
    if (selectedNPC !== 'all' && !audible.some((n) => n.id === selectedNPC))
      selectedNPC =
        world.sim?.combat?.enemy ||
        audible.find((n) => n.room === world.player.room)?.id ||
        audible[0]?.id ||
        '';

    $('solo-recipient').replaceChildren();
    if (world.scenario === 'mercer' || world.scenario === 'generated') {
      const all = document.createElement('option');
      all.value = 'all';
      all.textContent = 'Everyone in this room · up to 2 replies';
      $('solo-recipient').append(all);
    }
    for (const n of audible) {
      const o = document.createElement('option');
      o.value = n.id;
      o.textContent =
        '[' +
        n.number +
        '] ' +
        n.name +
        (n.room !== world.player.room ? ' · adjacent room (shout)' : '');
      $('solo-recipient').append(o);
    }

    $('solo-recipient').value = selectedNPC;
    $('solo-typing').textContent =
      typing && replyingNPC ? actorName(replyingNPC) + ' is typing…' : '';
    renderWorldMap($('solo-map'), engine.mapFor?.(world) || roomData(), world.player.room, {
      nearby: true,
      explorer: true,
      building: currentBuilding,
    });
    renderWorldMap(
      $('solo-expanded-map'),
      engine.mapFor?.(world, wholeMap) || roomData(),
      wholeMap && world.blueprint ? currentBuilding?.id || world.player.room : world.player.room,
      {
        explorer: true,
        zones: world.blueprint?.zones,
        building: wholeMap ? null : currentBuilding,
        overview: wholeMap,
      },
    );
    $('solo-exits').replaceChildren();
    for (const r of roomData()[world.player.room].exits)
      $('solo-exits').append(
        button(
          roomData()[r].name +
            (world.scenario === 'generated' && world.doors[r] ? ' · Locked' : ''),
          async () => {
            if (
              world.scenario === 'generated'
                ? world.doors[r] === true
                : r === (world.scenario === 'mercer' ? 'supply' : 'archive') && world.doorLocked
            )
              openLock(r);
            else await action('move', r);
          },
        ),
      );
    if (world.scenario === 'generated') {
      for (const r of roomData()[world.player.room].exits.filter((r) => world.doors[r])) {
        const matching = world.items.some(
          (i) => i.owner === 'player' && i.kind === 'key' && i.opens === r,
        );

        if (matching)
          $('solo-exits').append(
            button('Unlock ' + roomData()[r].name + ' with key', () =>
              action('key-door', { room: r }),
            ),
          );
      }
    }

    const doorFeedback = document.createElement('p');
    doorFeedback.id = 'solo-door-feedback';
    doorFeedback.setAttribute('role', 'alert');
    $('solo-exits').append(doorFeedback);
    $('room-items').textContent = engine.inventory(world, world.player.room).length
      ? ''
      : 'No items to pick up here.';
    inventoryUI.render();
    inventoryUI.refreshGround();
    $('solo-story-actions').replaceChildren();
    if (world.scenario === 'mercer') {
      if (
        world.items.some((i) => i.kind === 'fuel' && i.owner === 'player') &&
        ((world.player.room === 'workshop' && !world.generatorPowered) ||
          (world.player.room === 'street' && !world.vanFueled))
      )
        $('solo-story-actions').append(
          button(world.player.room === 'workshop' ? 'Fuel the generator' : 'Fuel the van', () =>
            action('use-fuel'),
          ),
        );
      if (
        world.player.room === 'workshop' &&
        !world.generatorPowered &&
        world.items.some((i) => i.kind === 'battery' && i.owner === 'player')
      )
        $('solo-story-actions').append(
          button('Connect battery to workshop lights', () => action('use-battery')),
        );

      $('solo-objective').textContent =
        world.generatorPowered && world.vanFueled
          ? 'The workshop has light, and the van has fuel.'
          : world.generatorPowered
            ? 'The workshop has power. The van still needs fuel.'
            : world.vanFueled
              ? 'The van is fueled. The workshop is still dark.'
              : 'One fuel can, two competing needs. Talk, negotiate, or choose your own direction.';
    } else if (world.scenario === 'generated') {
      $('solo-objective').textContent = world.blueprint.premise;
    } else {
      $('solo-objective').textContent = world.completed
        ? 'The recording is with Elias.'
        : 'Recover the recording and give it to Elias.';
    }

    $('solo-usage').textContent =
      `AI usage in this save: ${world.usage.calls} replies · ${world.usage.input.toLocaleString()} input / ${world.usage.output.toLocaleString()} output tokens. Failed requests may also be charged.`;
    $('solo-cost').textContent = attemptedCalls
      ? `OpenRouter cost reported this tab: $${reportedCost.toFixed(4)} (${costReceipts} of ${attemptedCalls} attempts have a cost receipt). Missing receipts and purchase fees are not included; check provider billing for the full total.`
      : 'No AI requests this tab. Story actions are free of AI charges.';
    $('connection-status').textContent = busy
      ? 'Connected'
      : key
        ? `${provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} · ${model} · ready to send.`
        : 'AI disconnected · story actions remain available.';
    $('dialogue-connection').textContent = key
      ? 'Configured: ' + model
      : 'Not connected. Enter a key to connect.';
    $('solo-send').disabled =
      busy || dirty || (world.sim && !APSUSoloSimulation.conscious(world, 'player'));
    globalThis.APSUSoloWorldUI?.render(world);
    if (
      $('solo-death-dialog') &&
      world.sim?.people.player.hp === 0 &&
      !$('solo-death-dialog').open
    ) {
      $('solo-respawn').disabled = !world.combatCheckpoint;
      $('solo-respawn-description').textContent = world.combatCheckpoint
        ? 'Return to the automatic save made before this combat. The fight and its dialogue will be undone, restoring everyone’s previous health, possessions, memories, and location. AI usage already incurred is not refunded.'
        : 'This older encounter has no pre-combat save. Quit to the launchpad, or restore a manual checkpoint if you made one. Future encounters save automatically before combat.';
      $('solo-death-dialog').showModal();
    }
    if (renderedCount !== world.messages.length) {
      $('solo-chat').replaceChildren();
      for (const m of [
        ...[...world.messages]
          .filter((m) => m.visible !== false)
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          .slice(-200),
        ...outbox,
      ]) {
        const p = document.createElement('p'),
          name = document.createElement('strong');
        name.textContent =
          (m.who === 'Player' ? world.player.name : m.who === 'Story' ? 'System' : m.who) + ': ';
        let cmd;

        if (m.who === 'Player') {
          try {
            cmd = APSUCommands.parse(m.text);
          } catch {}
        }
        if (cmd && ['action', 'possessive', 'description'].includes(cmd.kind)) {
          name.textContent =
            cmd.kind === 'possessive'
              ? world.player.name + '’s '
              : cmd.kind === 'description'
                ? ''
                : world.player.name + ' ';
          p.classList.add('solo-emote');
          p.append(
            name,
            APSUActionText.render(
              cmd.body + (cmd.kind === 'description' ? ' (' + world.player.name + ')' : ''),
            ),
          );
        } else if (cmd?.kind === 'whisper') {
          const marker = document.createElement('strong');
          marker.textContent = '[!] ';
          marker.style.color = '#df872f';
          const recipient = actors().find((n) => n.number === cmd.target)?.name || 'Character';
          name.textContent = world.player.name + ' whispers to ' + recipient + ': ';
          p.append(marker, name, APSUActionText.render(cmd.body));
        } else if (cmd && ['directed', 'shout'].includes(cmd.kind)) {
          name.textContent =
            world.player.name +
            (cmd.kind === 'directed'
              ? ' (to ' +
                (actors().find((n) => n.number === cmd.target)?.name || 'Character') +
                '): '
              : ' shouts: ');
          p.append(name, APSUActionText.render(cmd.body));
        } else
          p.append(
            name,
            m.who === 'Story' ? document.createTextNode(m.text) : APSUActionText.render(m.text),
          );
        if (m.delivery === 'failed') {
          const status = document.createElement('small');
          status.className = 'solo-delivery';
          status.textContent = 'Not delivered · no automatic retry';
          p.append(status);
          if (m.delivery === 'failed') {
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.textContent = 'Restore draft';
            restore.onclick = () => {
              if ($('solo-message').value.trim()) {
                $('solo-error').textContent =
                  'Your composer already contains a draft. Keep or clear it before restoring this message.';
                return;
              }

              $('solo-message').value = m.text;
              $('solo-message').oninput();
              outbox.splice(outbox.indexOf(m), 1);
              refreshOutbox();
              $('solo-message').focus();
            };
            p.append(restore);
          }
        }
        if (m.who === 'Story') p.className = 'story-message';
        if (m.at) {
          p.dataset.timestamp = m.at;
          p.title = new Date(m.at).toLocaleString();
        }

        $('solo-chat').append(p);
      }

      renderedCount = world.messages.length;
      $('solo-chat').scrollTop = $('solo-chat').scrollHeight;
    }
  }

  document
    .querySelectorAll('.room-details > section, .room-sidebar > section')
    .forEach((panel, n) => {
      panel.dataset.panelId ||= 'solo-' + n;
    });
  const layout = createPanelLayout({
    left: document.querySelector('.room-details'),
    right: document.querySelector('.room-sidebar'),
    key: 'apsu-solo-layout-v1',
    minimizedKey: 'apsu-solo-minimized-v1',
  });
  $('reset-solo-layout').onclick = () => {
    layout.restore(layout.defaults);
    for (const panel of layout.panels.values())
      if (panel.classList.contains('panel-collapsed'))
        panel.querySelector('.panel-minimize').click();

    layout.save();
  };
  const imagine = createSoloImagine(
    () => world,
    () => key,
  );
  const inventoryUI = createInventoryUI({
    notifySuccess: false,
    onGiven: ({ target, message, itemName, quantity }) => {
      if (!key || !world.npcs) {
        $('solo-error').textContent = 'Item given. Connect AI to receive a character response.';
        return;
      }

      const actor = actors().find((n) => n.id === target);

      if (actor)
        sendTurns(
          message || 'React to the verified handover of ' + quantity + ' × ' + itemName + '.',
          [actor],
          { trigger: 'handover', replyOnly: !message },
        );
    },
    client: {
      async rpc(name, args) {
        try {
          if (name === 'room_ground_items')
            return { data: engine.inventory(world, world.player.room) };

          const work = queue.then(async () => {
            if (busy || dirty) throw Error('Finish your current interaction first.');

            await commit(
              engine.act(world, 'inventory', {
                ids: args.p_items || [args.p_item],
                verb: name === 'show_inventory_item' ? 'show' : args.p_action,
                target: args.p_target,
              }),
            );
          });
          queue = work.catch(() => {});
          await work;

          return {};
        } catch (e) {
          return { error: e };
        }
      },
    },
    getCharacter: () => world?.player,
    getWorld: () => ({ rooms: roomData() }),
    getItems: () => (world ? engine.inventory(world) : []),
    reload: async () => {},
    onUse: (item) => {
      if (item.usableKey) {
        enqueue(() => action('key-door', { room: item.opens }));
        return;
      }
      if (item.equippable) {
        enqueue(() => action('equip', item.id));
        return;
      }
      if (item.consumable) {
        enqueue(() => action('consume', item.id));
        return;
      }

      const target = roomData()[world.player.room].exits.find((r) =>
        world.scenario === 'generated'
          ? world.doors[r] === true
          : r === (world.scenario === 'mercer' ? 'supply' : 'archive') && world.doorLocked,
      );

      if (target) openLock(target);
      else $('solo-error').textContent = 'There is no locked entrance here.';
    },
    notify: (text) => enqueue(() => commit(engine.act(world, 'notice', text))),
    isBusy: () => busy || dirty || !!world?.activePick,
  });

  function roleSuffix(id) {
    const names = (world.blueprint?.roles || [])
      .filter((r) => r.holder === id)
      .map((r) => r.name + (r.scope ? ' · ' + r.scope : ''));
    return names.length ? ' · ' + names.join(' · ') : '';
  }

  $('solo-death-dialog').addEventListener('cancel', (e) => e.preventDefault());
  $('solo-respawn').onclick = () =>
    enqueue(async () => {
      await action('respawn');
      $('solo-death-dialog').close();
    });
  $('solo-quit-dead').onclick = () => {
    location.href = 'launchpad.html#single-player';
  };

  function relationshipFields() {
    const r = world.sim?.relationships[profileNPC]?.[$('relationship-target').value];
    $('relationship-met').checked = r?.met || false;
    $('relationship-name').checked = r?.knowsName || false;
    $('relationship-romance').checked = r?.romance || false;
    $('relationship-trust').value = r?.trust || 0;
    $('relationship-affection').value = r?.affection || 0;
    $('relationship-feelings').value = r?.feelings || '';
    const target = $('relationship-target').selectedOptions[0]?.textContent || 'this person';
    $('relationship-status').value = !r
      ? 'No relationship recorded toward ' + target + ' yet.'
      : [
          'Toward ' + target + ': ' + (r.met ? 'Acquainted' : 'Not yet met'),
          r.knowsName ? 'Knows their name' : 'Name not yet known',
          'Trust: ' + r.trust + ' / Affection: ' + r.affection + ' (−100 to 100)',
          r.romance ? 'Romantic interest recorded' : 'No romantic interest recorded',
          r.feelings || 'No private feelings recorded yet.',
        ].join('\n');
  }

  $('relationship-target').onchange = relationshipFields;
  $('save-relationship').onclick = () =>
    enqueue(async () => {
      await action('relationship', {
        source: profileNPC,
        target: $('relationship-target').value,
        met: $('relationship-met').checked,
        knowsName: $('relationship-name').checked,
        romance: $('relationship-romance').checked,
        trust: Number($('relationship-trust').value),
        affection: Number($('relationship-affection').value),
        feelings: $('relationship-feelings').value,
      });
      relationshipFields();
      $('npc-inspector-status').textContent = 'Relationship saved.';
    });

  function openPlayer() {
    $('solo-player-name').value = world.player.name;
    $('solo-player-appearance').value = world.player.description;
    $('solo-player-roles').textContent = roleSuffix('player').slice(3) || 'No assigned roles';
    $('solo-player-edit-roles').hidden = !world.blueprint;
    $('solo-player-status').textContent = '';
    $('solo-player-dialog').showModal();
  }

  $('solo-player-close').onclick = () => $('solo-player-dialog').close();
  $('solo-player-edit-roles').onclick = () => {
    $('solo-player-dialog').close();
    window.open(
      'solo-editor.html?save=' + encodeURIComponent(world.id) + '#roles',
      '_blank',
      'noopener',
    );
  };
  $('solo-player-form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('solo-player-name').value.trim(),
      description = $('solo-player-appearance').value.trim();

    if (!name) {
      $('solo-player-status').textContent = 'Enter a character name.';
      return;
    }
    if (busy || dirty) {
      $('solo-player-status').textContent = 'Finish the current action first.';
      return;
    }

    busy = true;
    enqueue(async () => {
      try {
        const next = engine.validate(world);
        next.player.name = name;
        next.player.description = description;
        await commit(engine.validate(next));
        $('solo-player-status').textContent = 'Character saved.';
      } catch (error) {
        $('solo-player-status').textContent = error.message;
      } finally {
        busy = false;
        render();
      }
    });
  };

  function profileTab(ooc) {
    $('npc-character-panel').hidden = ooc;
    $('npc-ooc-panel').hidden = !ooc;
    for (const [id, selected] of [
      ['npc-character-tab', !ooc],
      ['npc-ooc-tab', ooc],
    ]) {
      $(id).setAttribute('aria-selected', String(selected));
      $(id).tabIndex = selected ? 0 : -1;
    }
  }

  $('npc-character-tab').onclick = () => profileTab(false);
  $('npc-ooc-tab').onclick = () => profileTab(true);
  for (const id of ['npc-character-tab', 'npc-ooc-tab'])
    $(id).onkeydown = (e) => {
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const ooc = id === 'npc-character-tab';
        profileTab(ooc);
        $(ooc ? 'npc-ooc-tab' : 'npc-character-tab').focus();
      }
    };

  function openCharacter(id) {
    const n = actors().find((n) => n.id === id);

    if (!n) return;

    profileNPC = id;
    $('relationship-target').replaceChildren();
    for (const person of [{ id: 'player', name: world.player.name }, ...actors()].filter(
      (n) => n.id !== id,
    )) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      $('relationship-target').append(option);
    }

    $('relationship-target').value = 'player';
    relationshipFields();
    $('solo-npc-name').textContent = n.name;
    $('solo-npc-description').textContent = n.description;
    $('solo-npc-roles').textContent = roleSuffix(id).slice(3) || 'No assigned roles';
    $('npc-goal').value = n.goal;
    $('npc-character-depth').textContent =
      [
        n.backstory ? 'Backstory: ' + n.backstory : '',
        n.motivations?.length ? 'Motivations: ' + n.motivations.join('; ') : '',
        n.traits
          ? 'Traits (0–100): ' +
            Object.entries(n.traits)
              .map(([k, v]) => k + ' ' + v)
              .join(', ')
          : '',
        ...Object.entries(n.preferences || {})
          .filter(([, v]) => v.length)
          .map(([k, v]) => k + ': ' + v.join('; ')),
      ]
        .filter(Boolean)
        .join('\n\n') || 'No additional background recorded.';
    $('npc-goal-development').textContent =
      [
        n.goalCandidate
          ? 'Considering: ' + n.goalCandidate.goal + ' — ' + n.goalCandidate.reason
          : '',
        ...(n.goalHistory || []).map(
          (h) => 'Goal changed from “' + h.from + '” to “' + h.to + '”: ' + h.reason,
        ),
      ]
        .filter(Boolean)
        .join('\n') || 'No recorded goal changes.';
    $('npc-memory').value = n.memory;
    $('solo-npc-items').replaceChildren();
    const characterItems = engine.inventory(world, id);

    if (!characterItems.length) $('solo-npc-items').textContent = 'No items';
    for (const item of characterItems) {
      const line = document.createElement('span');
      line.className = 'npc-item-line';
      line.textContent = APSUItems.name(item, { rooms: roomData() }) + ' ';
      if (item.valueLabel) {
        const value = document.createElement('span');
        value.className = 'item-value';
        value.textContent = item.valueLabel;
        line.append(value);
      }

      $('solo-npc-items').append(line);
    }

    $('npc-location').textContent =
      'Location: ' +
      roomData()[n.room].name +
      (world.sim
        ? ' · ' +
          world.sim.people[id].hp +
          ' / ' +
          world.sim.people[id].maxHp +
          ' HP · ' +
          APSUSoloSimulation.money(world, world.sim.people[id].money)
        : '');
    $('save-npc-state').hidden = !world.npcs;
    $('npc-inspector-status').textContent = '';
    profileTab(false);
    $('solo-npc-dialog').showModal();
  }

  $('save-npc-state').onclick = () =>
    enqueue(async () => {
      try {
        await action('edit-npc', {
          id: profileNPC,
          goal: $('npc-goal').value,
          memory: $('npc-memory').value,
        });
        $('npc-inspector-status').textContent = 'Saved.';
      } catch (e) {
        $('npc-inspector-status').textContent = e.message;
      }
    });
  if ($('map-area-mode')) {
    $('map-area-mode').onclick = () => {
      wholeMap = false;
      render();
    };
    $('map-world-mode').onclick = () => {
      wholeMap = true;
      render();
    };
  }

  $('solo-recipient').onchange = () => {
    selectedNPC = $('solo-recipient').value;
  };
  $('close-npc').onclick = () => $('solo-npc-dialog').close();
  $('add-solo-prop').onclick = () => $('solo-prop-dialog').showModal();
  $('close-prop').onclick = () => $('solo-prop-dialog').close();
  $('solo-prop-form').onsubmit = (e) => {
    e.preventDefault();
    enqueue(async () => {
      await action('add-prop', {
        name: $('prop-name').value,
        description: $('prop-description').value,
      });
      $('solo-prop-dialog').close();
    });
  };

  function resetIdle() {
    clearTimeout(inactivity);
    inactivity = setTimeout(() => enqueue(closeLock), 30000);
  }

  function openLock(target) {
    lockTarget = target;

    const feedback = (message) => {
      const local = $('solo-door-feedback');
      (local || $('solo-error')).textContent = message;
    };

    if (busy || dirty) return;
    if (world.sim) {
      try {
        APSUSoloSimulation.guard(world, 'insert', { room: target });
      } catch (e) {
        feedback(e.message);
        return;
      }
    }

    const usablePicks = picks().filter((i) => i.capacity > 0);

    if (!usablePicks.length) {
      feedback(
        'This door is locked. Use its matching key, ask its owner to open it, or bring a working lockpick.',
      );
      return;
    }

    frame.src =
      'lockpick.html?difficulty=moderate&picks=' + encodeURIComponent(JSON.stringify(usablePicks));
    lockDialog.showModal();
    resetIdle();
  }

  async function closeLock() {
    if (!lockDialog.open) return;

    clearTimeout(inactivity);
    lockDialog.close();
    frame.removeAttribute('src');
    if (world.activePick) await commit(engine.act(world, 'cancel'));
  }

  $('cancel-lock').onclick = () => enqueue(closeLock);
  lockDialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    enqueue(closeLock);
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || !lockDialog.open)
      return;

    const type = e.data?.type;

    if (type === 'apsu-lock-activity') {
      resetIdle();
      return;
    }

    const actions = {
      'apsu-lockpick-inserted': 'insert',
      'apsu-lockpick-damaged': 'damage',
      'apsu-lockpick-broken': 'break',
      'apsu-lockpick-success': 'unlock',
    };

    if (type === 'apsu-lockpick-cancel') {
      enqueue(closeLock);
      return;
    }
    if (!actions[type]) return;

    enqueue(async () => {
      if (!lockDialog.open || dirty) return;

      await commit(
        engine.act(
          world,
          actions[type],
          world.scenario === 'generated'
            ? { item: e.data.itemId, room: lockTarget }
            : e.data.itemId,
        ),
      );
      if (['break', 'unlock'].includes(actions[type])) await closeLock();
    });
  });

  const openCommands = () =>
    APSUCommands.open(3, {
      descriptions: {
        me: 'Perform a visible action and invite a character response. Tracked item transfers still require validation.',
        my: 'Narrate a possessive action locally.',
        do: 'Describe an observation locally.',
        w: 'Whisper to a nearby character using /w ID message. Uses one request to your connected AI model.',
        to: 'Address a nearby character using /to ID message. Uses one request to your connected AI model.',
        shout: 'Speak to the selected character in this room or an adjacent room.',
        sneak: 'Suppress your local movement notice for 30 seconds. Does not hide you from NPCs.',
        admins: 'Explain the absence of human admins in this local world.',
        help: 'Multiplayer-only: no staff request is sent from solo mode.',
        report: 'Multiplayer-only: no staff report is sent from solo mode.',
        warn: 'Multiplayer-only: player warnings do not apply to this local world.',
        mute: 'Multiplayer-only: human player moderation is unavailable in solo mode.',
        kick: 'Multiplayer-only: human player moderation is unavailable in solo mode.',
        ban: 'Multiplayer-only: human player moderation is unavailable in solo mode.',
        global: 'Write a local System announcement in your single-player world.',
      },
    });

  $('solo-commands').onclick = openCommands;
  $('expand-solo-map').onclick = () => $('solo-map-dialog').showModal();
  $('close-solo-map').onclick = () => $('solo-map-dialog').close();
  $('solo-map-dialog').onclick = (e) => {
    if (e.target === e.currentTarget) {
      const r = e.currentTarget.getBoundingClientRect();

      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        e.currentTarget.close();
    }
  };
  $('download-save').onclick = () =>
    enqueue(() => {
      if (world) store.download(world);
    });
  $('retry-save').onclick = () => enqueue(() => commit(world));

  function updateProviderFields() {
    const router = $('solo-provider').value === 'openrouter';
    $('solo-router-options').hidden = !router;
    $('solo-custom-model-field').hidden = $('solo-model').value !== 'custom';
    $('solo-key-label').textContent = router ? 'OpenRouter API key' : 'OpenAI API key';
    $('solo-provider-note').textContent = router
      ? 'Your message, character description, relevant memories and recent conversation pass through APSU’s relay to OpenRouter and the selected model provider. The free model is the default. Selecting a paid model uses your OpenRouter credits; free-model request limits still apply. Providers that collect data are excluded; your OpenRouter privacy settings also apply. Your world stays on this device.'
      : 'OpenAI · GPT-4.1 mini. Your message, character description, relevant memories and recent conversation pass through APSU’s relay to OpenAI. OpenAI bills your API account. Your world stays on this device.';
  }

  $('solo-provider').onchange = () => {
    $('solo-api-key').value = '';
    $('solo-ai-consent').checked = false;
    updateProviderFields();
  };
  $('solo-model').onchange = updateProviderFields;
  updateProviderFields();
  const aiTabs = ['dialogue', 'images'];

  function selectAITab(name) {
    for (const tab of aiTabs) {
      const selected = tab === name;
      $('ai-tab-' + tab).setAttribute('aria-selected', String(selected));
      $('ai-tab-' + tab).tabIndex = selected ? 0 : -1;
      $('ai-panel-' + tab).hidden = !selected;
    }
  }

  aiTabs.forEach((name, index) => {
    $('ai-tab-' + name).onclick = () => selectAITab(name);
    $('ai-tab-' + name).onkeydown = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;

      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : (index + 1) % 2;
      selectAITab(aiTabs[next]);
      $('ai-tab-' + aiTabs[next]).focus();
    };
  });
  $('close-ai-settings').onclick = () => $('solo-ai-dialog').close();
  $('ai-settings').onclick = () => {
    selectAITab('dialogue');
    $('solo-ai-consent').checked = !!key;
    $('solo-ai-error').textContent = '';
    if (!busy) $('solo-ai-dialog').showModal();
  };
  $('close-ai').onclick = () => $('solo-ai-dialog').close();
  $('solo-ai-dialog').addEventListener('close', () => {
    $('solo-api-key').value = '';
    $('solo-ai-consent').checked = false;
  });

  const automaticFailure = (message) => {
    $('auto-connection-error').textContent = message;
    if (!$('auto-connection-dialog').open) $('auto-connection-dialog').showModal();
  };

  $('auto-connection-close').onclick = () => $('auto-connection-dialog').close();
  $('solo-ai-disconnect').onclick = () => {
    try {
      globalThis.APSUSoloConnection?.forget();
    } catch {
      $('solo-ai-error').textContent =
        'Could not remove the saved key. Check browser storage settings.';
      return;
    }

    $('solo-remember-key').checked = false;
    automaticallyRestored = false;
    key = '';
    $('solo-ai-dialog').close();
    render();
  };
  $('solo-ai-form').onsubmit = (e) => {
    e.preventDefault();
    if (busy) return;

    const nextProvider = $('solo-provider').value;
    const nextModel =
      nextProvider === 'openai'
        ? 'gpt-4.1-mini'
        : $('solo-model').value === 'custom'
          ? $('solo-custom-model').value.trim()
          : $('solo-model').value;
    const entered = $('solo-api-key').value.trim() || key;

    if (
      nextProvider === 'openrouter' &&
      (!/^sk-or-v1-[\w-]{20,250}$/.test(entered) ||
        !/^[a-z0-9-]+\/[a-z0-9][a-z0-9._:-]*$/i.test(nextModel))
    ) {
      $('solo-ai-error').textContent =
        'Enter an OpenRouter key and a model ID such as apodex/apodex-1.1-mini:free.';
      return;
    }
    if (nextProvider === 'openai' && entered.startsWith('sk-or-')) {
      $('solo-ai-error').textContent = 'Select OpenRouter to use an OpenRouter key.';
      return;
    }
    if (!/^sk-[\w-]{20,300}$/.test(entered) || !$('solo-ai-consent').checked) {
      $('solo-ai-error').textContent =
        'Check the consent box and enter an API key if no key is connected yet.';
      return;
    }
    try {
      if ($('solo-remember-key').checked)
        APSUSoloConnection.save({
          key: entered,
          provider: nextProvider,
          model: nextModel,
          consent: true,
        });
      else globalThis.APSUSoloConnection?.forget();
    } catch {
      $('solo-ai-error').textContent =
        'Could not save this connection. Uncheck Remember to use it for this tab.';
      return;
    }

    automaticallyRestored = false;
    key = entered;
    provider = nextProvider;
    model = nextModel;
    $('solo-ai-dialog').close();
    $('solo-ai-error').textContent = '';
    render();
  };
  $('solo-message').oninput = () => {
    $('solo-counter').textContent = $('solo-message').value.length + ' characters';
  };
  $('solo-message').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      $('solo-chat-form').requestSubmit();
    }
  };
  $('solo-chat-form').onsubmit = (e) => {
    e.preventDefault();
    if (busy || dirty || !world) return;

    let text = $('solo-message').value.trim();

    if (!text) return;

    let command;

    try {
      command = /^\/[^/\n]+\/(?=\s|$|[.,!?])/.test(text) ? null : APSUCommands.parse(text);
    } catch {
      $('solo-error').textContent = 'Invalid Command';
      return;
    }
    if (command?.kind === 'command_list') {
      openCommands();
      $('solo-message').value = '';
      $('solo-message').oninput();

      return;
    }
    if (command?.kind === 'action' && APSUActionText.actionBody)
      text = '/me ' + APSUActionText.actionBody(command.body, world.player.name);

    const localNotice = command && (command.moderation || command.kind === 'sneak');
    const narration = command && ['action', 'possessive', 'description'].includes(command.kind);

    if (localNotice || (narration && !key)) {
      const localTurn = {
        before: engine.validate(world),
        text,
        revision: world.revision,
        active: false,
      };
      lastTurn = localTurn;
      outbox.splice(0, outbox.length);
      renderedCount = -1;
      let note = 'This command is multiplayer-only. No report or moderation action was sent.';

      if (command.kind === 'admins')
        note = 'This is a local single-player world; no human admins are connected.';
      if (command.kind === 'global') note = command.body;
      if (command.kind === 'sneak') {
        sneakUntil = Date.now() + 30000;
        note = 'Movement notices hidden for 30 seconds. NPCs can still see and follow you.';
      }

      busy = true;
      enqueue(async () => {
        try {
          await commit(
            engine.act(world, narration ? 'narrate' : 'notice', narration ? text : note),
          );
          localTurn.revision = world.revision;
          if ($('solo-message').value.trim() === text) {
            $('solo-message').value = '';
            $('solo-message').oninput();
          }

          $('solo-error').textContent = '';
        } finally {
          busy = false;
          render();
        }
      });

      return;
    }

    const candidates = command?.target
      ? actors().filter((n) => n.number === command.target && n.room === world.player.room)
      : selectedNPC === 'all'
        ? actors()
            .filter((n) => n.room === world.player.room)
            .slice(0, 2)
        : actors().filter((n) => n.id === selectedNPC);

    if (!candidates.length) {
      $('solo-error').textContent = 'No selected character is in this room.';
      return;
    }
    if (
      candidates.some(
        (n) =>
          n.room !== world.player.room &&
          !(command?.kind === 'shout' && roomData()[world.player.room].exits.includes(n.room)),
      )
    ) {
      $('solo-error').textContent =
        'That character moved. Follow them or use /shout; your AI connection is still active.';
      return;
    }
    if (!key) {
      $('solo-ai-dialog').showModal();
      return;
    }

    sendTurns(text, candidates, {
      trigger: candidates.length > 1 ? 'group' : 'player',
      private: command?.kind === 'whisper',
    });
  };
  // One initiating turn, at most two replies. Never recurse or run an idle timer.

  function sendTurns(text, candidates, options = {}) {
    if (world?.sim && !options.replyOnly && !busy && !dirty) {
      const payment = APSUSoloSimulation.explicitPayment(world, text, candidates[0]?.id);

      if (payment) {
        try {
          APSUSoloSimulation.playerPayment(structuredClone(world), payment);
        } catch (error) {
          $('solo-message').value = '';
          $('solo-message').oninput();
          outbox.splice(0, outbox.length);
          busy = true;
          enqueue(async () => {
            try {
              await commit(engine.act(world, 'void-payment', error.message));
            } finally {
              busy = false;
              render();
            }
          });

          return;
        }
      }
    }

    if (busy || dirty || world.sim?.people.player.hp === 0) return;

    const turnState = {
      before: engine.validate(world),
      text,
      revision: world.revision,
      active: true,
      cancelled: false,
      controller: new AbortController(),
    };

    if (!options.replyOnly) lastTurn = turnState;

    outbox.splice(0, outbox.length); // An older failed draft never trails newer messages.
    const pending = options.replyOnly ? null : { who: 'Player', text, delivery: 'pending' };

    if (pending) outbox.push(pending);
    if (!options.replyOnly) {
      $('solo-message').value = '';
      $('solo-message').oninput();
    }

    busy = true;
    typing = true;
    replyingNPC = candidates[0].id;
    refreshOutbox();
    $('solo-error').textContent = '';
    enqueue(async () => {
      let committed = !!options.replyOnly,
        currentReply = null;

      try {
        const turns = candidates
          .slice(0, 2)
          .map((n) => ({ id: n.id, trigger: options.trigger || 'player' }));

        if (
          turns.length === 1 &&
          !options.private &&
          world.npcs &&
          !options.noExpansion &&
          $('solo-reactions').checked &&
          Date.now() - lastReactionAt >= 30000
        ) {
          const other = actors().find((n) => n.id !== turns[0].id && n.room === world.player.room);

          if (other) {
            turns.push({ id: other.id, trigger: 'reaction' });
            lastReactionAt = Date.now();
          }
        }
        for (const turn of turns) {
          if (turnState.cancelled) break;

          const actor = actors().find((n) => n.id === turn.id);

          if (
            !actor ||
            (actor.room !== world.player.room &&
              !(
                /^\/shout\s/i.test(text) && roomData()[world.player.room].exits.includes(actor.room)
              ))
          )
            continue;

          currentReply = { name: actor.name, trigger: turn.trigger };
          replyingNPC = actor.id;
          render();
          attemptedCalls++;
          const context = engine.context(world, text, actor.id, { trigger: turn.trigger });
          const response = await fetch('/api/solo-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key,
              provider,
              model,
              adult: true,
              allowPaid: !model.endsWith(':free'),
              context,
            }),
            signal: AbortSignal.any([turnState.controller.signal, AbortSignal.timeout(65000)]),
          });

          if (!response.headers.get('content-type')?.includes('application/json'))
            throw Error('AI relay unavailable. Use the local solo development server.');

          const result = await response.json();

          if (
            typeof result.usage?.cost === 'number' &&
            Number.isFinite(result.usage.cost) &&
            result.usage.cost >= 0
          ) {
            reportedCost += result.usage.cost;
            costReceipts++;
          }
          if (!response.ok) {
            if (automaticallyRestored && response.status === 401) {
              automaticFailure(
                'The provider rejected your saved API key. Open AI settings to update it. No automatic retry was made.',
              );
              automaticallyRestored = false;
              key = '';
            }

            throw Error(result.error || actor.name + ' could not respond.');
          }

          automaticallyRestored = false;
          if (turnState.cancelled) break;

          const next = engine.conversation(world, text, result, actor.id, {
            replyOnly: committed,
            trigger: turn.trigger,
          });

          if (pending && outbox.includes(pending)) outbox.splice(outbox.indexOf(pending), 1);

          renderedCount = -1;
          await commit(next);
          turnState.revision = world.revision;
          committed = true;
          if (world.messages.at(-1)?.voidedTurn) break;
          if (
            !turnState.cancelled &&
            (result.newCharacter || result.expansion) &&
            !options.noExpansion &&
            !options.private &&
            world.sim?.evolving &&
            !world.sim.combat &&
            !world.activePick &&
            world.sim.turn - world.sim.lastExpansion >= 6
          ) {
            typing = false;
            render();
            try {
              if (result.newCharacter) {
                const role = result.newCharacter.role;
                const exists =
                  world.blueprint.characters.some(
                    (c) => c.name.toLowerCase() === role.toLowerCase(),
                  ) ||
                  world.blueprint.roles.some((r) => r.name.toLowerCase() === role.toLowerCase());

                if (!exists)
                  await expandWorld(
                    'The current scene calls for one missing local person. Role: ' +
                      role +
                      '. Context: ' +
                      result.newCharacter.reason +
                      '. Latest player turn: ' +
                      text,
                    true,
                    role,
                  );
              } else await expandWorld(result.expansion, true);
            } catch (e) {
              $('solo-error').textContent = 'Dialogue saved. ' + e.message;
            }

            break; // One dialogue plus one generation request; never chain expansions.
          }
        }
      } catch (error) {
        if (
          automaticallyRestored &&
          !turnState.cancelled &&
          ['TypeError', 'TimeoutError'].includes(error.name)
        ) {
          automaticallyRestored = false;
          automaticFailure(
            'The saved settings were restored, but the AI request could not connect. Check the local server and network. Your key is retained; no automatic retry was made.',
          );
        }
        if (pending && outbox.includes(pending)) {
          pending.delivery = 'failed';
          renderedCount = -1;
        }

        $('solo-error').textContent =
          (currentReply?.trigger === 'reaction'
            ? currentReply.name +
              ' could not chime in. Your message and the first reply are saved. '
            : '') +
          (error.name === 'TimeoutError' ? 'The request timed out.' : error.message) +
          (committed ? ' Earlier actions and replies are saved.' : '') +
          ' No automatic retry.' +
          (key ? ' Your AI settings are retained.' : ' Update your API key in AI settings.') +
          ' Check provider usage before retrying.';
      } finally {
        if (turnState.cancelled) {
          try {
            await restoreLastTurn(turnState);
          } catch (e) {
            $('solo-error').textContent = e.message;
          }
        }

        turnState.active = false;
        turnState.revision = world.revision;
        busy = false;
        typing = false;
        render();
      }
    });
  }

  async function expandWorld(prompt, automatic = false, encounter = null) {
    if (!world.sim) throw Error('World expansion is available in prompt-created worlds.');
    if (!key) throw Error('Connect your OpenRouter key in AI connection first.');
    if (!prompt.trim()) throw Error('Describe a place or person to add.');
    if (world.sim.combat || world.activePick) throw Error('Finish the encounter first.');

    const anchor = world.player.room;
    await commit(engine.act(world, 'expansion-attempt'));
    attemptedCalls++;
    const response = await fetch('/api/solo-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(100000),
      body: JSON.stringify({
        mode: 'expand',
        ...(encounter ? { encounter } : {}),
        key,
        model: 'apodex/apodex-1.1-mini:free',
        adult: true,
        prompt: prompt.slice(0, 3000),
        anchor,
        blueprint: world.blueprint,
      }),
    });
    const data = await response.json();

    if (typeof data.usage?.cost === 'number') {
      reportedCost += data.usage.cost;
      costReceipts++;
    }
    if (!response.ok) throw Error(data.error || 'Expansion failed. No automatic retry.');

    await commit(engine.act(world, 'expand-world', { anchor, patch: data.patch }));
  }

  globalThis.APSUSoloWorldUI?.mount({
    available: () => !!world && !busy && !dirty,
    error: (message) => {
      $('solo-error').textContent = message;
    },
    act: (name, value) => {
      const work = queue.then(async () => {
        if (busy || dirty) throw Error('Finish the current action first.');

        const enemyId = world.sim?.combat?.enemy || value?.target;

        if (name === 'combat' && value?.verb === 'start') selectedNPC = value.target;

        await commit(engine.act(world, name, value));
        if (
          name === 'combat' &&
          value?.verb !== 'intent' &&
          key &&
          $('combat-dialogue').checked &&
          APSUSoloSimulation.conscious(world, 'player')
        ) {
          const enemy = actors().find(
            (n) =>
              n.id === enemyId &&
              APSUSoloSimulation.conscious(world, n.id) &&
              n.room === world.player.room,
          );

          if (enemy)
            sendTurns(
              'React briefly to the latest code-recorded combat events. This is not new player speech.',
              [enemy],
              { replyOnly: true, trigger: 'combat', noExpansion: true, private: false },
            );
        }
      });
      queue = work.catch(() => {});
      return work;
    },
    expand: (prompt) => {
      const work = queue.then(async () => {
        if (busy || dirty) throw Error('Finish the current action first.');

        busy = true;
        try {
          await expandWorld(prompt);
        } finally {
          busy = false;
          render();
        }
      });
      queue = work.catch(() => {});
      return work;
    },
  });
  if (globalThis.APSUSoloCheckpoints)
    APSUSoloCheckpoints.mount({
      getWorld: () => world,
      available: () => world && !busy && !dirty && !world.activePick,
      restore: (saved) => {
        const work = queue.then(async () => {
          if (busy || dirty || world.activePick) throw Error('Finish the current action first.');

          await APSUSoloCheckpoints.keep(world, 'Before restoring a checkpoint');
          const restored = engine.validate(saved);
          restored.id = world.id;
          restored.revision = world.revision;
          outbox.length = 0;
          renderedCount = -1;
          await commit(restored);
        });
        queue = work.catch(() => {});
        return work;
      },
    });

  window.addEventListener('beforeunload', (e) => {
    if (dirty || busy || world?.activePick) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) key = '';

    clearTimeout(inactivity);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      render();
      if (lockDialog.open) enqueue(closeLock);
    }
  });
  enqueue(async () => {
    world = await store.get(new URLSearchParams(location.search).get('save'));
    if (!world) {
      $('save-status').textContent = 'Save not found on this device.';
      throw Error('Return to the launchpad to create a world or import your save.');
    }
    try {
      const saved = globalThis.APSUSoloConnection?.load();

      if (saved) {
        key = saved.key;
        provider = saved.provider;
        model = saved.model;
        automaticallyRestored = true;
        $('solo-provider').value = provider;
        const options = Array.from($('solo-model').options || []);
        $('solo-model').value = options.some((o) => o.value === model) ? model : 'custom';
        $('solo-custom-model').value = model;
        $('solo-remember-key').checked = true;
        updateProviderFields();
      }
    } catch {
      automaticFailure(
        'Saved AI settings could not be restored. Open AI settings and enter your key again.',
      );
    }
    if (world.activePick) await commit(engine.act(world, 'cancel'));
    else {
      $('save-status').textContent = 'Saved on this device';
      render();
    }
  });
})();
