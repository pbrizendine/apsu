// Validate and limit the context sent to dialogue providers.
import { isText } from './request-utils.mjs';

export function scene(value) {
  if (['mercer', 'generated'].includes(value?.scenario)) {
    const graph =
      value.scenario === 'generated'
        ? Object.fromEntries(Object.entries(value.rooms || {}).map(([id, r]) => [id, r.exits]))
        : {
            workshop: ['street', 'supply'],
            street: ['workshop', 'roof'],
            supply: ['workshop'],
            roof: ['street'],
          };

    if (Object.keys(graph).length > 120) throw Error('rooms');
    if (
      !(value.scenario === 'generated'
        ? /^[a-z][a-z0-9_-]{0,39}$/.test(value.actor?.id)
        : ['mara', 'leon'].includes(value.actor?.id)) ||
      !isText(value.message, 200000) ||
      !value.message.trim() ||
      !isText(value.actor.name, 60) ||
      !isText(value.actor.description, 1000) ||
      !isText(value.actor.goal, 1000) ||
      !isText(value.actor.memory, 2500) ||
      !isText(value.player?.name, 60) ||
      !graph[value.player.room] ||
      !graph[value.actor.room] ||
      (value.player.room !== value.actor.room &&
        !(
          /^\/shout\s/i.test(value.message) && graph[value.player.room].includes(value.actor.room)
        )) ||
      !Array.isArray(value.actions) ||
      value.actions.length > 100 ||
      !value.actions.every((a) => isText(a.id, 100) && isText(a.description, 250)) ||
      !Array.isArray(value.recent) ||
      !Array.isArray(value.memories)
    )
      throw Error('scene');

    const context = { ...value, memory: value.actor.memory };
    context.recent = value.recent.slice(-12);
    context.memories = value.memories.slice(-4);
    context.observedEvents = (value.observedEvents || [])
      .slice(-8)
      .map((m) => ({ who: 'Story', text: String(m.text).slice(0, 500) }));
    for (const field of ['ownedItems', 'playerItems', 'groundItems'])
      if (Array.isArray(context[field]))
        context[field] = context[field].slice(0, 30).map((i) => ({
          id: i.id,
          kind: i.kind,
          name: i.name || i.appearance?.name,
          capacity: i.capacity,
          valueMinor: i.valueMinor ?? null,
          description: (i.description || i.appearance?.description || '').slice(0, 300),
          opens: i.opens,
          template: i.template,
        }));
    if (context.rooms)
      context.rooms = Object.fromEntries(
        Object.entries(context.rooms).map(([id, r]) => [
          id,
          {
            name: r.name,
            exits: r.exits,
            locked: r.locked,
            ...(id === context.actor.room ? { description: r.description } : {}),
          },
        ]),
      );
    if (JSON.stringify(context).length - context.message.length > 16000 && context.rooms) {
      const local = new Set([
        context.actor.room,
        context.player.room,
        ...(context.rooms[context.actor.room]?.exits || []),
      ]);
      context.rooms = Object.fromEntries(
        Object.entries(context.rooms).filter(([id]) => local.has(id)),
      );
    }
    while (
      JSON.stringify(context).length - context.message.length > 16000 &&
      context.memories.length
    )
      context.memories.shift();
    while (
      JSON.stringify(context).length - context.message.length > 16000 &&
      context.recent.length > 6
    )
      context.recent.shift();
    if (JSON.stringify(context).length - context.message.length > 30000)
      throw Error('scene too large');

    return context;
  }
  if (
    !value ||
    !isText(value.message, 200000) ||
    !value.message.trim() ||
    !isText(value.room, 80) ||
    !isText(value.player?.name, 60) ||
    !isText(value.player?.description, 1000) ||
    !isText(value.player?.room, 30) ||
    (value.player.room !== value.elias?.room &&
      !(
        value.delivery === 'shout' &&
        /^\/shout\s/i.test(value.message) &&
        (
          { lobby: ['office'], office: ['lobby', 'archive'], archive: ['office'] }[
            value.player.room
          ] || []
        ).includes(value.elias?.room)
      )) ||
    !isText(value.elias?.memory, 2500) ||
    typeof value.doorLocked !== 'boolean' ||
    typeof value.completed !== 'boolean' ||
    !['archive', 'player', 'elias'].includes(value.recording) ||
    !Array.isArray(value.inventory) ||
    value.inventory.length > 10000 ||
    !Number.isSafeInteger(value.pickGifts) ||
    value.pickGifts < 0
  )
    throw Error('scene');

  function messages(list, max) {
    if (!Array.isArray(list) || list.length > max) throw Error('messages');

    return list.map((m) => {
      if (!m || !['Player', 'Elias', 'Story'].includes(m.who) || !isText(m.text, 200000))
        throw Error('message');

      return { who: m.who, text: m.text };
    });
  }
  // Bound paid context by text length, not only message count. Keep whole messages.

  function bounded(list, budget, newestFirst = false) {
    const kept = [],
      seen = new Set();

    for (const m of newestFirst ? [...list].reverse() : list) {
      const id = m.who + ':' + m.text;

      if (seen.has(id)) continue;

      const size = JSON.stringify(m).length;

      if (size > budget) {
        if (newestFirst) break;
        else continue;
      }

      budget -= size;
      seen.add(id);
      kept.push(m);
    }

    return newestFirst ? kept.reverse() : kept;
  }

  const recent = bounded(messages(value.recent, 16), 6000, true);
  const recentKeys = new Set(recent.map((m) => m.who + ':' + m.text));
  const recalled = messages(value.memories, 6).filter((m) => !recentKeys.has(m.who + ':' + m.text));
  const workingPicks = value.inventory.filter((i) => [50, 100].includes(i?.capacity)).length;

  return {
    player: { name: value.player.name, description: value.player.description },
    together: value.player.room === value.elias.room,
    delivery: value.delivery === 'shout' ? 'shout' : 'room',
    room: value.room,
    doorLocked: value.doorLocked,
    recording: value.recording,
    completed: value.completed,
    workingPicks,
    npcWorkingPicks: Array.isArray(value.eliasItems)
      ? value.eliasItems.filter((i) => [50, 100].includes(i.capacity)).length
      : Math.max(0, 3 - value.pickGifts),
    ownedItems: value.ownedItems ? JSON.stringify(value.ownedItems).slice(0, 6000) : null,
    pickGifts: value.pickGifts,
    memory: value.elias.memory,
    relevantEarlierConversation: bounded(recalled, 2000),
    recent,
    message: value.message,
  };
}
