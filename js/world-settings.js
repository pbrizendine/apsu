(() => {
  const form = document.getElementById('world-rating-form'),
    status = document.getElementById('world-rating-status'),
    input = document.getElementById('world-min-age');
  const world = new URLSearchParams(location.search).get('world');
  document.querySelector('[data-panel="world-settings"]').addEventListener('click', async () => {
    const { data, error } = await supabaseClient
      .from('worlds')
      .select('minimum_age')
      .eq('id', world)
      .maybeSingle();

    if (error) status.textContent = 'World age ratings need the prepared database update.';
    else if (data) input.value = String(data.minimum_age);
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');

    if (
      input.value === '18' &&
      !(await APSUUI.confirm({
        title: 'Restrict this world to adults?',
        message: 'Players under 18 will be disconnected and unable to enter this world.',
        confirmLabel: 'Set to 18+',
        cancelLabel: 'Keep current rating',
      }))
    )
      return;

    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc('set_world_minimum_age', {
        p_world: world,
        p_age: Number(input.value),
      });

      if (error) throw error;

      status.textContent = 'World age rating saved.';
    } catch (e) {
      status.textContent =
        e.code === 'PGRST202' ? 'World age ratings need the prepared database update.' : e.message;
    } finally {
      button.disabled = false;
    }
  };
})();
