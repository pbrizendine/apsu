import { buildDialogueRequest } from './solo-dialogue-request.mjs';
// Guest BYOK dialogue relay. No Supabase, stored credentials, or saved conversations.
// World mutations are validated by the local engine, never executed by this relay.
import { jsonWithin, isText } from './request-utils.mjs';
import { scene } from './solo-context.mjs';

export async function soloChat(request, env, transport = fetch) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };
  let billedUsage;

  const reply = (status, error) =>
    Response.json({ error, ...(billedUsage ? { usage: billedUsage } : {}) }, { status, headers });
  // Same-origin only; local development serves the site and relay together.

  const origin = request.headers.get('Origin');

  if (!origin || origin !== new URL(request.url).origin)
    return reply(403, 'Open solo play from the APSU site or local development server.');
  if (request.method !== 'POST') return reply(405, 'Use POST.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return reply(415, 'Use JSON.');

  let body, context, provider, model;

  try {
    body = await jsonWithin(request, 1000000);
    if (!/^sk-[\w-]{20,300}$/.test(body.key) || body.adult !== true) throw Error('key');
    // Paid requests require an explicit selection; free models never fall back to paid routes.
    if (
      body.provider !== 'openrouter' ||
      typeof body.model !== 'string' ||
      body.model === 'openrouter/auto' ||
      (!body.model.endsWith(':free') && body.allowPaid !== true)
    )
      return reply(
        400,
        'Choose an explicit OpenRouter model and consent to paid usage if applicable.',
      );

    provider = body.provider ?? 'openai';
    if (!['openai', 'openrouter'].includes(provider)) throw Error('provider');

    model = provider === 'openrouter' ? body.model : 'gpt-4.1-mini';
    if (
      provider === 'openrouter' &&
      (typeof model !== 'string' ||
        model.length > 160 ||
        !/^[a-z0-9-]+\/[a-z0-9][a-z0-9._:-]*$/i.test(model) ||
        !/^sk-or-v1-[\w-]{20,250}$/.test(body.key))
    )
      throw Error('model');
    if (provider === 'openai' && body.key.startsWith('sk-or-')) throw Error('key');

    context = scene(body.context);
  } catch {
    return reply(400, 'Enter a valid key, confirm adult API use, and provide a supported scene.');
  }
  try {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.key))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');

    if (
      !env.SOLO_LIMIT ||
      !(await env.SOLO_LIMIT.limit({ key: 'ip:' + request.headers.get('CF-Connecting-IP') }))
        .success ||
      !(await env.SOLO_LIMIT.limit({ key: 'key:' + hash })).success
    )
      return reply(429, 'Please wait a minute before sending more AI messages.');

    const { payload, allowedActions } = buildDialogueRequest(context);

    const router = provider === 'openrouter';
    const label = router ? 'OpenRouter' : 'OpenAI';
    const requestBody = router
      ? {
          model,
          messages: [
            {
              role: 'system',
              content:
                payload.instructions +
                '\nReturn only a JSON object matching this schema. No markdown fences or extra text. OUTPUT_SCHEMA=' +
                JSON.stringify(payload.text.format.schema),
            },
            { role: 'user', content: payload.input },
          ],
          max_tokens: 4096,
          // Dialogue must think even though world creation disables optional reasoning.
          // Scope this to our known reasoning-capable default; ordinary models must remain usable.
          ...(model === 'apodex/apodex-1.1-mini:free'
            ? { reasoning: { enabled: true, exclude: true } }
            : {}),
          ...(model === 'apodex/apodex-1.1-mini:free'
            ? { response_format: { type: 'json_object' } }
            : {}),
          // Validate actions locally even when JSON mode is supported.
          provider: {
            require_parameters: true,
            data_collection: 'deny',
            allow_fallbacks: false,
            ...(model.endsWith(':free') ? { max_price: { prompt: 0, completion: 0 } } : {}),
          },
        }
      : payload;
    const response = await transport(
      router
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + body.key, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(55000),
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      let failure = '';

      try {
        const detail = await jsonWithin(response, 16000);
        failure = String(detail.error?.message || '').toLowerCase();
      } catch {}

      const status = response.status;

      return reply(
        [400, 401, 402, 403, 404, 429].includes(status) ? status : 502,
        status === 401
          ? `${label} rejected that key.`
          : status === 402
            ? `${label} needs more API credits. Check your balance.`
            : status === 429
              ? `${label} reported a quota or rate limit. Check your API billing.`
              : [400, 404].includes(status)
                ? failure.includes('data policy') || failure.includes('privacy')
                  ? `${label} has no endpoint matching your privacy settings for this model.`
                  : failure.includes('endpoint')
                    ? `${label} has no available endpoint for ${model} with the current routing settings.`
                    : failure.includes('model')
                      ? `${label} could not find or access ${model}. Check the model ID and account access.`
                      : `${label} rejected this request (HTTP ${status}). Check the selected model and OpenRouter activity for the provider details.`
                : status === 403
                  ? `${label} denied access. Check your account and provider privacy settings.`
                  : `${label} could not finish the reply. Check provider usage before retrying.`,
      );
    }

    const data = await jsonWithin(response, 128000);

    const token = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

    billedUsage = {
      input: token(router ? data.usage?.prompt_tokens : data.usage?.input_tokens),
      output: token(router ? data.usage?.completion_tokens : data.usage?.output_tokens),
      // Missing cost is unknown, never a fabricated zero or token-based estimate.
      cost:
        router &&
        typeof data.usage?.cost === 'number' &&
        Number.isFinite(data.usage.cost) &&
        data.usage.cost >= 0
          ? data.usage.cost
          : null,
    };
    const choice = data.choices?.[0];
    const text = router
      ? choice?.message?.content
      : data.output
          ?.filter((o) => o.type === 'message')
          .flatMap((o) => o.content || [])
          .filter((c) => c.type === 'output_text')
          .map((c) => c.text)
          .join('');
    const complete = router
      ? !data.error && choice?.finish_reason === 'stop'
      : data.status === 'completed';

    if (!complete || typeof text !== 'string' || !text)
      return reply(
        502,
        choice?.finish_reason === 'length'
          ? 'The model exhausted its output budget before completing the reply. Reasoning can consume that budget. No action was applied.'
          : 'The provider did not return a complete reply. No action was applied.',
      );

    let result;

    try {
      result = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
    } catch {
      return reply(
        502,
        'The model returned malformed reply JSON. Your AI settings are still active; no action was applied.',
      );
    }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      return reply(502, 'The model returned an invalid reply structure. No action was applied.');
    if (result?.memory == null) result.memory = context.memory;
    if (result.action == null) result.action = 'none';
    if (
      !isText(result.dialogue, 2400) ||
      !result.dialogue.trim() ||
      !isText(result.memory, 2500) ||
      !allowedActions.includes(result.action)
    )
      return reply(
        502,
        !isText(result.dialogue, 2400) || !result.dialogue.trim()
          ? 'The model returned empty or overlong dialogue (maximum 2400 characters). No action was applied.'
          : !isText(result.memory, 2500)
            ? 'The model returned invalid or overlong memory (maximum 2500 characters). No action was applied.'
            : 'The model requested an unavailable action. No action was applied.',
      );

    return Response.json(
      {
        dialogue: result.dialogue,
        memory: result.memory,
        action: result.action,
        usage: billedUsage,
        ...(context.scenario === 'generated' && !['reaction', 'combat'].includes(context.trigger)
          ? { payment: result.payment || null, rentalOffer: result.rentalOffer || null }
          : {}),
        ...(context.scenario === 'generated' && Array.isArray(result.relationshipUpdates)
          ? { relationshipUpdates: result.relationshipUpdates.slice(0, 3) }
          : {}),
        ...(context.expansionAllowed &&
        result.newCharacter &&
        isText(result.newCharacter.role, 80) &&
        result.newCharacter.role.trim() &&
        isText(result.newCharacter.reason, 500) &&
        result.newCharacter.reason.trim()
          ? {
              newCharacter: {
                role: result.newCharacter.role.trim(),
                reason: result.newCharacter.reason.trim(),
              },
            }
          : {}),
        ...(context.scenario === 'generated' &&
        context.trigger !== 'reaction' &&
        result.goalReflection &&
        isText(result.goalReflection.goal, 1000) &&
        isText(result.goalReflection.reason, 600)
          ? {
              goalReflection: {
                goal: result.goalReflection.goal,
                reason: result.goalReflection.reason,
              },
            }
          : {}),
        ...(context.scenario === 'generated' &&
        context.trigger !== 'reaction' &&
        Array.isArray(result.itemValues)
          ? {
              itemValues: result.itemValues
                .slice(0, 8)
                .filter(
                  (v) =>
                    v &&
                    typeof v.id === 'string' &&
                    Number.isSafeInteger(v.valueMinor) &&
                    v.valueMinor >= 0 &&
                    v.valueMinor <= 1e12,
                ),
            }
          : {}),
        ...(context.expansionAllowed && isText(result.expansion, 500) && result.expansion.trim()
          ? { expansion: result.expansion.trim() }
          : {}),
      },
      { headers },
    );
  } catch (error) {
    return reply(
      502,
      error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'The AI provider took too long to respond. The request timed out; it may still have used credits.'
        : 'The AI provider connection failed or returned an unreadable response. Check provider usage before retrying.',
    );
  } finally {
    if (body) body.key = '';
  }
}
