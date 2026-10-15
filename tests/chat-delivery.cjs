const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  path = require('node:path');
function element() {
  return {
    value: '',
    disabled: false,
    children: [],
    classList: { add() {} },
    querySelector(selector) {
      return this.children.find((c) => c.className === selector.slice(1));
    },
    handlers: {},
    dataset: {},
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 100,
    addEventListener(n, f) {
      this.handlers[n] = f;
    },
    setAttribute() {},
    append(...x) {
      this.children.push(...x);
    },
    appendChild(x) {
      this.children.push(x);
    },
    replaceChildren() {
      this.children = [];
    },
  };
}
(async () => {
  const nodes = new Map(),
    events = {},
    channels = [],
    records = new Map(),
    timers = [];
  let serial = 0,
    now = Date.now(),
    calls = [],
    resolveSend,
    hold = true,
    lose = false;
  const el = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const client = {
    removeChannel() {},
    channel() {
      const c = {
        on(n, f, cb) {
          this.receive = cb;
          return this;
        },
        subscribe(cb) {
          this.state = cb;
          return this;
        },
      };
      channels.push(c);
      return c;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'touch_chat') return { data: true };
      if (name.startsWith('send_')) {
        if (hold) await new Promise((r) => (resolveSend = r));
        records.set(args.p_id, {
          id: args.p_id,
          character_id: 'c',
          character_name: 'Tester',
          chat_kind: args.p_kind,
          body: args.p_body,
          created_at: new Date().toISOString(),
        });
        if (lose) {
          lose = false;
          throw Error('Response lost');
        }
      }
      return { data: true };
    },
    from() {
      let id;
      return {
        select() {
          return this;
        },
        contains() {
          return this;
        },
        order() {
          return this;
        },
        eq(k, v) {
          id = v;
          return this;
        },
        range: async () => ({ data: [] }),
        then(done) {
          return Promise.resolve({ data: records.has(id) ? [records.get(id)] : [] }).then(done);
        },
      };
    },
  };
  const context = {
    console,
    document: {
      getElementById: el,
      createElement: element,
      createTextNode: (text) => ({ textContent: text }),
    },
    window: {
      addEventListener(n, f) {
        events[n] = f;
      },
    },
    navigator: { onLine: true },
    crypto: { randomUUID: () => String(++serial) },
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setInterval() {},
    clearInterval() {},
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout() {},
  };
  vm.createContext(context);
  for (const file of ['database-api.js', 'chat-commands.js', 'room-chat.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../js/chat-attention.js'), 'utf8'),
    context,
  );
  context.window.APSUAttention.composer = () => null;
  const chat = context.createRoomChat(client);
  await chat.showRoom({ id: 'c', name: 'Tester', playerId: 'p', worldId: 'w', location: 'roomA' });
  channels[0].state('SUBSCRIBED');
  await new Promise(setImmediate);
  const submit = (text) => {
    el('chat-input').value = text;
    el('chat-form').handlers.submit({ preventDefault() {} });
  };
  submit('Hello');
  assert.equal(el('chat-input').value, '', 'Composer clears before network response');
  assert(
    el('chat-messages').children.some((r) => r.children[2]?.textContent === 'Hello'),
    'Local echo appears immediately',
  );
  submit('can you hear me?');
  assert.equal(el('chat-input').value, '');
  assert(
    el('chat-messages').children.some((r) => r.children[2]?.textContent === 'can you hear me?'),
  );
  now += 2000;
  hold = false;
  resolveSend();
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.deepEqual(
    calls.filter((c) => c.name === 'send_chat_message').map((c) => c.args.p_body),
    ['Hello', 'can you hear me?'],
  );
  assert.equal(records.size, 2);
  assert.equal(el('chat-messages').children.length, 2, 'Confirmation replaces optimistic rows');
  now += 2000;
  lose = true;
  submit('uncertain');
  await new Promise(setImmediate);
  assert.equal(records.size, 3);
  const row = el('chat-messages').children.find((r) => r.children[2]?.textContent === 'uncertain');
  assert(row.children.some((c) => c.textContent === 'Retry'));
  events.online();
  await new Promise(setImmediate);
  now += 2000;
  row.children.find((c) => c.textContent === 'Retry').onclick();
  await new Promise(setImmediate);
  assert.equal(records.size, 3, 'Retry reuses message ID');
  context.navigator.onLine = false;
  events.offline();
  el('chat-input').value = 'Offline draft';
  assert.equal(el('chat-send').disabled, true);
  assert.equal(el('chat-input').disabled, false);
  context.navigator.onLine = true;
  events.online();
  await new Promise(setImmediate);
  assert.equal(el('chat-input').value, 'Offline draft');
  const visitId = calls.find((c) => c.name === 'enter_chat').args.p_visit;
  const incoming = (id, type, target = 'c', kind = 'ic', body = 'hello') =>
    channels[0].receive({
      new: {
        id,
        world_id: 'w',
        visit_ids: [visitId],
        chat_kind: kind,
        message_type: type,
        recipient_character: target,
        character_id: 'other',
        character_name: 'Other',
        body,
        created_at: new Date().toISOString(),
      },
    });
  el('chat-ooc').handlers.click();
  incoming('whisper-1', 'whisper');
  incoming('whisper-1', 'whisper');
  assert.equal(
    el('chat-ic').querySelector('.notification-count').textContent,
    1,
    'Whisper notifications deduplicate',
  );
  incoming('directed-other', 'directed', 'someone-else');
  assert.equal(
    el('chat-ic').querySelector('.notification-count').textContent,
    1,
    'Only the addressee is notified',
  );
  incoming('directed-me', 'directed');
  assert.equal(el('chat-ic').querySelector('.notification-count').textContent, 2);
  el('chat-ic').handlers.click();
  assert.equal(
    el('chat-ic').querySelector('.notification-count').hidden,
    true,
    'Opening IC clears its counter',
  );
  incoming('mention-me', 'chat', null, 'ooc', '@Tester hello');
  assert.equal(
    el('chat-ooc').querySelector('.notification-count').textContent,
    1,
    'Character mentions notify OOC',
  );
  el('chat-ooc').handlers.click();
  assert.equal(el('chat-ooc').querySelector('.notification-count').hidden, true);
  await chat.stop();
  channels[0].state('SUBSCRIBED');
  assert.equal(el('chat-send').disabled, true);
  console.log(
    'PASS: immediate echo and clear, rapid separate drafts, reconciliation, uncertain retry deduplication, offline drafts, stale events.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
