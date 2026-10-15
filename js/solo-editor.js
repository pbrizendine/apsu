(async () => {
  const status = document.getElementById('editor-loading');
  let world,
    saving = false;

  try {
    world = await APSUSoloStore.get(new URLSearchParams(location.search).get('save'));
    if (!world?.blueprint) throw Error('Choose a generated world to use this editor.');

    window.APSUTheme?.setWorld(world);
    APSUSoloWorldUI.render(world);
    APSUSoloWorldUI.mount({
      available: () => !saving && !world.activePick && !world.sim.combat,
      error: (message) => {
        status.textContent = message;
      },
      act: async (action, value) => {
        if (saving) throw Error('Wait for the current save.');

        saving = true;
        try {
          world = await APSUSoloStore.save(APSUSoloEngine.act(world, action, value));
          window.APSUTheme?.setWorld(world);
          APSUSoloWorldUI.render(world);
          status.textContent = 'Saved · ' + world.title;
        } finally {
          saving = false;
        }
      },
    });
    status.textContent = world.title;
  } catch (error) {
    status.textContent = error.message;
    document.getElementById('world-editor').hidden = true;
  }
})();
