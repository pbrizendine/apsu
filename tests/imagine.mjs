import assert from 'node:assert/strict';
import { imagine } from '../worker/index.mjs';
const env = {
  SUPABASE_URL: 'https://backend.example.test',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  IMAGINE_LIMIT: { limit: async () => ({ success: true }) },
};
const good = { prompt: 'A quiet fantasy courtyard.', key: 'sk-' + 'a'.repeat(32) };
const req = (body = good, extras = {}) =>
  new Request('https://apsu.test/api/imagine', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer mock-session',
      'Content-Type': 'application/json',
      Origin: 'https://apsu.test',
      ...extras,
    },
    body: JSON.stringify(body),
  });
let calls = [];
const transport = async (url, options) => {
  calls.push({ url, options });
  if (url.endsWith('/user')) return Response.json({ id: 'player' });
  if (url.includes('get_account_eligibility'))
    return Response.json({ confirmed: true, adult: true });
  return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
};
assert.equal((await imagine(req(good, { Authorization: '' }), env, transport)).status, 401);
assert.equal(calls.length, 0);
assert.equal(
  (await imagine(req(good, { Origin: 'https://evil.test' }), env, transport)).status,
  403,
);
assert.equal(
  (await imagine(req({ ...good, prompt: 'x'.repeat(25000) }), env, transport)).status,
  400,
);
assert.equal((await imagine(req(), env, transport)).status, 200);
const sent = JSON.parse(calls.at(-1).options.body);
assert.equal(sent.n, 1);
assert.equal(sent.model, 'gpt-image-1-mini');
assert(!('key' in sent));
assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer ' + good.key);
calls = [];
assert.equal(
  (
    await imagine(
      req(),
      { ...env, IMAGINE_LIMIT: { limit: async () => ({ success: false }) } },
      transport,
    )
  ).status,
  429,
);
assert.equal(calls.length, 2);
const young = async (url, opts) =>
  url.includes('eligibility')
    ? Response.json({ confirmed: true, adult: false })
    : transport(url, opts);
assert.equal((await imagine(req(), env, young)).status, 403);
const denied = async () => new Response('', { status: 401 });
assert.equal((await imagine(req(), env, denied)).status, 401);
console.log(
  'PASS: Imagine denies invalid auth/origins/oversize/underage/rate-limited requests; bounds one image and keeps API key out of provider body. No live API call.',
);

assert.equal((await imagine(req(), {}, transport)).status, 503);
