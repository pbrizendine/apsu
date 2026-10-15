// Optional guest image relay. Credentials are request-scoped; never saved or logged.
import { jsonWithin } from './request-utils.mjs';

export async function soloImagine(request, env, transport = fetch) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  const error = (status, message) => Response.json({ error: message }, { status, headers });

  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return error(403, 'Use Imagine from APSU.');
  if (request.method !== 'POST') return error(405, 'Use POST.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return error(415, 'Use JSON.');

  let body;

  try {
    body = await jsonWithin(request, 24000);
    if (
      body.adult !== true ||
      body.approveCharge !== true ||
      !/^sk-or-v1-[\w-]{20,250}$/.test(body.key) ||
      typeof body.model !== 'string' ||
      body.model.length > 160 ||
      !/^[a-z0-9-]+\/[a-z0-9][a-z0-9._:-]*$/i.test(body.model) ||
      typeof body.prompt !== 'string' ||
      !body.prompt.trim() ||
      body.prompt.length > 8000
    )
      return error(400, 'Choose an image model, enter its key, and approve this image request.');

    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.key))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');

    if (
      !env.IMAGINE_LIMIT ||
      !(
        await env.IMAGINE_LIMIT.limit({ key: 'solo-ip:' + request.headers.get('CF-Connecting-IP') })
      ).success ||
      !(await env.IMAGINE_LIMIT.limit({ key: 'solo-key:' + hash })).success
    )
      return error(429, 'Wait one minute before generating another image.');
    if (body.model === 'inclusionai/ming-image-0.1-design') {
      const prices = await transport(
        'https://openrouter.ai/api/v1/images/models/inclusionai/ming-image-0.1-design/endpoints',
        { signal: AbortSignal.timeout(10000) },
      );

      if (!prices.ok)
        return error(503, 'Unable to verify free image pricing. No generation was requested.');

      const catalog = await jsonWithin(prices, 100000);
      const endpoints = catalog.endpoints || catalog.data?.endpoints;

      if (
        !Array.isArray(endpoints) ||
        !endpoints.length ||
        !endpoints.every(
          (e) =>
            Array.isArray(e.pricing) &&
            e.pricing.length &&
            e.pricing.every((p) => p.cost_usd === 0),
        )
      )
        return error(409, 'This model could not be verified as free. No generation was requested.');
    }

    const response = await transport('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + body.key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(150000),
      body: JSON.stringify({
        model: body.model,
        prompt: body.prompt,
        n: 1,
        provider: { allow_fallbacks: false, data_collection: 'deny' },
      }),
    });

    if (!response.ok) {
      await response.body?.cancel();
      return error(
        response.status === 429 ? 429 : 502,
        'Image provider rejected the request. Check your model, credits and privacy settings. No automatic retry.',
      );
    }

    const result = await jsonWithin(response, 16000000),
      image = result.data?.[0];

    if (
      !image ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.media_type) ||
      typeof image.b64_json !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json)
    )
      throw Error('image');

    return Response.json(
      {
        data: [{ b64_json: image.b64_json, media_type: image.media_type }],
        cost:
          typeof result.usage?.cost === 'number' &&
          Number.isFinite(result.usage.cost) &&
          result.usage.cost >= 0
            ? result.usage.cost
            : null,
      },
      { headers },
    );
  } catch {
    return error(
      502,
      'Image generation did not finish. Check provider usage before retrying; the request may have been charged.',
    );
  } finally {
    if (body) body.key = '';
  }
}
