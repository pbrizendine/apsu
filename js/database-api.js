// Only a missing endpoint may use an older API. Never bypass a permission error.
window.APSUDatabase = {
  async call(client, name, args) {
    const result = await client.rpc(name, args);

    if (result.error?.code !== 'PGRST202') return result;
    if (name === 'send_chat_message' && !args.p_images?.length) {
      return client.rpc(args.p_kind === 'ooc' ? 'send_world_ooc' : 'send_visit_message', {
        p_id: args.p_id,
        p_visit: args.p_visit,
        p_body: args.p_body,
      });
    }
    if (name === 'create_owned_world_room' && !args.p_owner) {
      const { p_owner, ...legacy } = args;
      return client.rpc('create_world_room', legacy);
    }

    return {
      ...result,
      error: {
        ...result.error,
        message: 'This feature needs the latest world database update. Please contact an admin.',
      },
    };
  },
};
