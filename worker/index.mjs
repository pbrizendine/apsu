import { jsonWithin } from './request-utils.mjs';
import { soloCreate } from './solo-create.mjs';
import { soloImagine } from './solo-imagine.mjs';
import { soloChat } from './solo-chat.mjs';
// Private, request-scoped BYOK relay. Never log request bodies, keys, or generated images.

const MODEL = 'gpt-image-1-mini';

export async function imagine(request, env, transport = fetch) {
  const origin = request.headers.get('Origin');
  const self = new URL(request.url).origin;
  const local = origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = origin === self || local;
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };

  if (allowed) headers['Access-Control-Allow-Origin'] = origin;

  const reply = (status, error) => Response.json({ error }, { status, headers });

  if (origin && !allowed) return reply(403, 'This origin is not allowed.');
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
    });
  if (request.method !== 'POST') return reply(405, 'Use POST.');

  const SUPABASE = env.SUPABASE_URL;
  const PUBLISHABLE = env.SUPABASE_PUBLISHABLE_KEY;

  const authorization = request.headers.get('Authorization') || '';

  if (!authorization.startsWith('Bearer ')) return reply(401, 'Sign in before using Imagine.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return reply(415, 'Use JSON.');

  let body;

  try {
    body = await jsonWithin(request, 24000);
  } catch {
    return reply(400, 'The scene is missing or too long.');
  }
  if (
    typeof body.prompt !== 'string' ||
    !body.prompt.trim() ||
    body.prompt.length > 12000 ||
    typeof body.key !== 'string' ||
    !/^sk-[\w-]{20,300}$/.test(body.key)
  )
    return reply(400, 'Enter a valid OpenAI API key and a scene of up to 12,000 characters.');

  const signal = AbortSignal.timeout(150000);

  try {
    if (!SUPABASE || !PUBLISHABLE)
      return reply(503, 'Multiplayer image generation is not configured on this server.');

    const auth = await transport(SUPABASE + '/auth/v1/user', {
      headers: { apikey: PUBLISHABLE, Authorization: authorization },
      signal,
    });

    if (!auth.ok) return reply(401, 'Your session expired. Sign in again.');

    const user = await jsonWithin(auth, 64000);

    if (!user.id) return reply(401, 'Sign in before using Imagine.');

    const eligibility = await transport(SUPABASE + '/rest/v1/rpc/get_account_eligibility', {
      method: 'POST',
      headers: {
        apikey: PUBLISHABLE,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal,
    });
    const account = eligibility.ok ? await jsonWithin(eligibility, 8000) : null;

    if (!account?.confirmed)
      return reply(403, 'Complete account eligibility before using Imagine.');
    // This first BYOK release is adult-only. The rest of APSU retains its 13+ rules.
    if (!account.adult) return reply(403, 'Imagine is currently available to accounts marked 18+.');
    if (!env.IMAGINE_LIMIT || !(await env.IMAGINE_LIMIT.limit({ key: user.id })).success)
      return reply(429, 'Please wait a minute before generating another image.');

    const response = await transport('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal,
      headers: { Authorization: 'Bearer ' + body.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: body.prompt.trim(),
        n: 1,
        size: '1024x1024',
        quality: 'low',
        output_format: 'png',
      }),
    });
    body.key = '';
    if (!response.ok) {
      await response.body?.cancel();
      const messages = {
        401: 'OpenAI rejected that API key.',
        403: 'Your OpenAI project does not have access to this image model.',
        429: 'OpenAI reported a quota or rate limit. Check your API billing and limits.',
        400: 'OpenAI could not accept this scene. Check the prompt and try again.',
      };
      return reply(
        response.status >= 500 ? 502 : response.status,
        messages[response.status] || 'The image provider could not finish this request.',
      );
    }
    // Stream the base64 JSON directly; no image or credential is stored by APSU.

    return new Response(response.body, { status: 200, headers });
  } catch {
    return reply(
      502,
      'The image request did not finish. Check your OpenAI usage before trying again; it may still have been charged.',
    );
  } finally {
    if (body) body.key = '';
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/solo-create') return soloCreate(request, env);
    if (new URL(request.url).pathname === '/api/solo-imagine') return soloImagine(request, env);
    if (new URL(request.url).pathname === '/api/solo-chat') return soloChat(request, env);
    if (new URL(request.url).pathname === '/api/imagine') return imagine(request, env);

    return env.ASSETS.fetch(request);
  },
};
