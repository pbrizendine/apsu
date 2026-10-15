import * as prompts from './solo-dialogue-prompts.mjs';

// Construct dialogue instructions and response schemas for each scenario and turn type.
// The endpoint handles transport; the local game remains responsible for state changes.

export function buildDialogueRequest(context) {
  const canGive =
    context.together &&
    context.doorLocked &&
    !context.completed &&
    !context.workingPicks &&
    context.npcWorkingPicks > 0;
  const allowedActions = ['mercer', 'generated'].includes(context.scenario)
    ? context.actions.map((a) => a.id)
    : canGive
      ? ['none', 'give_pick']
      : ['none'];
  const payload = {
    model: 'gpt-4.1-mini',
    store: false,
    max_output_tokens: 1500,
    instructions: prompts.eliasDialogue,
    input: JSON.stringify(context),
    text: {
      format: {
        type: 'json_schema',
        name: 'elias_turn',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            dialogue: { type: 'string' },
            memory: { type: ['string', 'null'] },
            action: { type: 'string', enum: allowedActions },
          },
          required: ['dialogue', 'memory', 'action'],
          additionalProperties: false,
        },
      },
    },
  };

  if (['mercer', 'generated'].includes(context.scenario))
    payload.instructions = prompts.characterDialogue(context);
  if (context.scenario === 'generated') {
    payload.text.format.schema.required.push('itemValues', 'goalReflection', 'newCharacter');
    payload.text.format.schema.properties.newCharacter = {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: { role: { type: 'string' }, reason: { type: 'string' } },
          required: ['role', 'reason'],
        },
      ],
    };
    payload.instructions += prompts.castGrowth;
    payload.text.format.schema.properties.goalReflection = {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: { goal: { type: 'string' }, reason: { type: 'string' } },
          required: ['goal', 'reason'],
        },
      ],
    };
    payload.instructions += prompts.goalDevelopment;
    payload.text.format.schema.properties.itemValues = {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          valueMinor: { type: 'integer', minimum: 0, maximum: 1e12 },
        },
        required: ['id', 'valueMinor'],
      },
    };
    payload.instructions += prompts.itemAppraisal;
  }

  payload.instructions += prompts.directAnswers;
  if (['mercer', 'generated'].includes(context.scenario)) {
    payload.instructions = prompts.identityAndContinuity + payload.instructions;
  }
  if (context.scenario === 'generated' && !['reaction', 'combat'].includes(context.trigger)) {
    const nullable = (properties) => ({
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        },
      ],
    });

    payload.text.format.schema.properties.payment = nullable({
      recipient: { type: 'string' },
      amountMinor: { type: 'integer', minimum: 1 },
      room: { type: ['string', 'null'] },
      evidence: { type: 'string' },
    });
    payload.text.format.schema.properties.rentalOffer = nullable({
      room: { type: 'string' },
      priceMinor: { type: 'integer', minimum: 1 },
    });
    payload.text.format.schema.required.push('payment', 'rentalOffer');
    payload.instructions += prompts.economy;
  }
  if (['mercer', 'generated'].includes(context.scenario)) {
    payload.instructions += prompts.naturalConversation;
  }
  if (context.trigger === 'combat') {
    payload.instructions +=
      ' This is a combat reaction to observedEvents, not new player speech. Respond in 1–3 short sentences. Do not narrate another attack or decide damage, death or escape. The player may speak before the next mechanically resolved turn.';
  }
  if (context.trigger === 'reaction') {
    context.expansionAllowed = false;
    payload.input = JSON.stringify(context);
    payload.text.format.schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        dialogue: { type: 'string' },
        action: { type: 'string', enum: allowedActions },
        memory: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['dialogue', 'action', 'memory'],
    };
    payload.instructions = prompts.interjection(context);
  }
  if (context.scenario === 'generated') {
    payload.instructions += prompts.combatAndOwnership;
    payload.text.format.schema.properties.relationshipUpdates = {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          trustDelta: { type: 'integer', minimum: -5, maximum: 5 },
          affectionDelta: { type: 'integer', minimum: -5, maximum: 5 },
          feelings: { type: 'string' },
        },
        required: ['target', 'trustDelta', 'affectionDelta', 'feelings'],
        additionalProperties: false,
      },
    };
  }

  return { payload, allowedActions };
}
