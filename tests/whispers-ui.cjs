const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert');
const nodes = new Map();
function node() {
  return {
    value: '',
    disabled: false,
    textContent: '',
    children: [],
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 100,
    handlers: {},
    addEventListener(k, f) {
      this.handlers[k] = f;
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
const el = (id) => {
  if (!nodes.has(id)) nodes.set(id, node());
  return nodes.get(id);
};
let serial = 0,
  channels = [],
  calls = [];
const client = {
  rpc: async (n, p) => {
    if (n !== 'set_chat_typing') calls.push([n, p]);
    return { data: true };
  },
  removeChannel() {},
  channel() {
    const c = {
      on(_, f, cb) {
        this.event = cb;
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
  from() {
    return {
      select() {
        return this;
      },
      contains() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      range: async () => ({ data: [] }),
      then(f) {
        return Promise.resolve({ data: [] }).then(f);
      },
    };
  },
};
const context = {
  document: {
    getElementById: el,
    createElement: node,
    createTextNode: (text) => ({ textContent: text }),
  },
  window: { addEventListener() {} },
  crypto: { randomUUID: () => String(++serial) },
  setInterval() {},
  clearInterval() {},
  clearTimeout() {},
  setTimeout() {},
  console,
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(require('path').join(__dirname, '../js/database-api.js'), 'utf8'),
  context,
);
vm.runInContext(
  fs.readFileSync(require('path').join(__dirname, '../js/chat-commands.js'), 'utf8'),
  context,
);
let fakeTime = Date.now();
context.Date = class extends Date {
  static now() {
    return fakeTime;
  }
};
vm.runInContext(
  fs.readFileSync(require('path').join(__dirname, '../js/room-chat.js'), 'utf8'),
  context,
);
(async () => {
  const chat = context.createRoomChat(client);
  await chat.showRoom({ id: 'recipient', playerId: 'p', worldId: 'w', location: 'roomA' });
  channels[0].state('SUBSCRIBED');
  await new Promise(setImmediate);
  const submit = async (text) => {
    fakeTime += 2000;
    el('chat-input').value = text;
    await el('chat-form').handlers.submit({ preventDefault() {} });
    await new Promise(setImmediate);
  };
  for (const [text, kind] of [
    ['/me waves.', 'action'],
    ['/do A bell rings.', 'description'],
    ['/to [2] Hello', 'directed'],
  ]) {
    await submit(text);
    assert.equal(calls.at(-1)[0], 'send_room_command');
    assert.equal(calls.at(-1)[1].p_kind, kind);
  }
  await submit('/w 2 quiet');
  assert.equal(calls.at(-1)[0], 'send_room_whisper');
  for (const kind of ['report', 'global', 'warn', 'mute', 'ban', 'kick']) {
    await submit('/' + kind + ' 2 sample');
    assert.equal(calls.at(-1)[0], 'world_command');
    assert.equal(calls.at(-1)[1].p_kind, kind);
  }

  let n = calls.length;
  await submit('/to invalid hello');
  assert.equal(calls.length, n);
  await submit('/unknown');
  assert.equal(calls.length, n);
  assert(
    el('chat-messages').children.some((r) => r.children[2]?.textContent === 'Invalid Command'),
  );

  el('chat-ooc').handlers.click();
  await submit('/me no');
  assert.equal(calls.length, n);
  el('chat-ic').handlers.click();
  const base = {
    world_id: 'w',
    visit_ids: ['1'],
    chat_kind: 'ic',
    character_id: 'sender',
    character_name: 'Henry',
    sender_number: 1,
    recipient_name: 'Jacob',
    recipient_character: 'recipient',
    body: 'Hello',
    created_at: new Date().toISOString(),
  };
  function receive(id, type, extra = {}) {
    channels[0].event({ new: { ...base, id, message_type: type, ...extra } });
    return el('chat-messages').children.find(
      (row) =>
        row.children[2]?.textContent === extra.body || row.children[2]?.textContent === base.body,
    );
  }
  receive('a', 'directed');
  let rows = el('chat-messages').children;
  assert(rows.some((r) => r.children[0].children.some((x) => x.className === 'directed-marker')));
  receive('b', 'directed', { recipient_character: 'someone-else', body: 'Other target' });
  let other = el('chat-messages').children.find(
    (r) => r.children[2].textContent === 'Other target',
  );
  assert(!other.children[0].children.some((c) => c.className === 'directed-marker'));
  assert(other.children[0].textContent.includes('(to Jacob)'));
  receive('c', 'whisper', { body: 'Quiet' });
  let whisper = el('chat-messages').children.find((r) => r.children[2].textContent === 'Quiet');
  assert(
    whisper.children[0].children.some(
      (x) => x.className === 'whisper-marker' && x.textContent === '[!] ',
    ),
  );
  receive('d', 'action', { body: 'waves.' });
  assert(
    el('chat-messages').children.some(
      (r) => r.className === 'action-message' && r.children[2].textContent === 'Henry waves.',
    ),
  );
  receive('e', 'description', { body: 'A bell rings.' });
  assert(
    el('chat-messages').children.some((r) => r.children[2].textContent === 'A bell rings. (Henry)'),
  );
  console.log(
    'PASS: command routing, invalid/OOC guards, recipient-only marker, orange whisper marker, /me and /do formatting.',
  );
})();
