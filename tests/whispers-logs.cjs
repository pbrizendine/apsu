const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../js/room-chat.js'), 'utf8');
const fn = source.slice(
  source.indexOf('  async function downloadLogs'),
  source.indexOf("  el('chat-download-ic').addEventListener"),
);
const rows = ['ic', 'ooc'].flatMap((kind) =>
  ['Sent', 'Received'].map((body) => ({
    chat_kind: kind,
    body,
    room_id: 'roomA',
    character_name: body,
    played_character_name: 'Test Character',
    created_at: '2026-10-01',
  })),
);
rows.push({
  chat_kind: 'ic',
  message_type: 'whisper',
  sender_number: 2,
  recipient_name: 'Jane Doe',
  recipient_number: 3,
  character_name: 'John Doe',
  body: 'Private words',
  room_id: 'roomA',
  created_at: '2026-10-01',
});
let blob, filename;
const buttons = { ic: {}, ooc: {} };
const ctx = {
  el: (id) => buttons[id.endsWith('ooc') ? 'ooc' : 'ic'],
  current: { worldId: 'world' },
  generation: 1,
  mode: 'ic',
  status: {},
  client: {
    from(table) {
      let filters = {};
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters[k] = v;
          return this;
        },
        order() {
          return this;
        },
        then(done) {
          assert.equal(table, 'room_message_images');
          assert.equal(filters.message_id, 'image-message');
          return Promise.resolve({
            data: [{ position: 1, data_url: 'data:image/jpeg;base64,/9j/2Q==' }],
          }).then(done);
        },
        async range() {
          assert.equal(filters.world_id, 'world');
          assert(['ic', 'ooc'].includes(filters.chat_kind));
          return { data: rows.filter((r) => r.chat_kind === filters.chat_kind) };
        },
      };
    },
  },
  Blob,
  URL: {
    createObjectURL(b) {
      blob = b;
      return 'blob:test';
    },
    revokeObjectURL() {},
  },
  document: {
    body: { appendChild() {} },
    createElement() {
      return {
        click() {
          filename = this.download;
        },
        remove() {},
      };
    },
  },
  setTimeout() {},
};
vm.createContext(ctx);
vm.runInContext(fn, ctx);
(async () => {
  for (const kind of ['ic', 'ooc']) {
    ctx.mode = kind;
    await ctx.downloadLogs(kind);
    const text = await blob.text();
    assert(text.includes('Sent'));
    assert(text.includes('Received'));
    assert(text.includes(kind.toUpperCase() + ' ·'));
    assert(!text.includes((kind === 'ic' ? 'OOC' : 'IC') + ' ·'));
    if (kind === 'ooc') assert(text.includes('Sent (Test Character):'));
    else assert(!text.includes('(Test Character)'));
    if (kind === 'ic')
      assert(text.includes('[2] John Doe whispers to [3] Jane Doe: Private words'));
    else assert(!text.includes('Private words'));
    assert(filename.startsWith('apsu-' + kind + '-chat-'));
    assert.equal(buttons[kind].disabled, false);
  }
  rows.push({
    id: 'image-message',
    chat_kind: 'ooc',
    character_name: 'Received',
    played_character_name: 'Tyler',
    body: '<script>test</script>',
    created_at: '2026-10-02',
    image_count: 1,
  });
  await ctx.downloadLogs('ooc');
  const html = await blob.text();
  assert(filename.endsWith('.html'));
  assert(html.includes('data:image/jpeg;base64,/9j/2Q=='), 'Download embeds the image bytes');
  assert(html.includes('Received (Tyler)'));
  assert(html.includes('&lt;script&gt;test&lt;/script&gt;'));
  assert(
    !html.includes('<script>test</script>'),
    'Downloaded messages cannot become executable HTML',
  );
  assert(!html.includes('Private words'));
  console.log(
    'PASS: separate IC/OOC exports include sent and received messages, exclude the other channel, use distinct filenames, and embed image bytes with escaped text.',
  );
})();
