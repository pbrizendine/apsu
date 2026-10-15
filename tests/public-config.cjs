const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/supabase-client.js'), 'utf8');

(async () => {
  let connections = 0;
  const window = {
    APSU_CONFIG: {},
    supabase: {
      createClient() {
        connections++;
        return { auth: {} };
      },
    },
  };
  const context = vm.createContext({ window, location: { pathname: '/launchpad.html' } });
  vm.runInContext(source, context);
  const client = vm.runInContext('supabaseClient', context);
  assert.equal(connections, 0);
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.equal((await client.auth.getUser()).data.user, null);
  assert.match((await client.auth.signInWithPassword({})).error.message, /not configured/);
  assert.equal((await client.auth.signOut()).error, null);
  assert(client.storage.from('player-pictures'));
  client.auth.onAuthStateChange(() => {}).data.subscription.unsubscribe();

  window.APSU_CONFIG = {
    supabaseUrl: 'https://backend.example.test',
    supabasePublishableKey: 'test-publishable-key',
  };
  vm.runInNewContext(source, { window, location: { pathname: '/launchpad.html' } });
  assert.equal(connections, 1);

  for (const name of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    if (html.includes('js/supabase-client.js')) {
      assert(html.indexOf('js/apsu-config.js') < html.indexOf('js/supabase-client.js'), name);
    }
  }
  console.log(
    'PASS: guest startup avoids backend connections, auth fails clearly, and configured copies create their own client.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
