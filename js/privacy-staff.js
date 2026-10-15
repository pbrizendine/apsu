(async () => {
  const list = document.getElementById('privacy-queue'),
    status = document.getElementById('queue-status');

  async function load() {
    const { data, error } = await supabaseClient.rpc('review_privacy_requests');

    if (error) {
      status.textContent =
        error.code === 'PGRST202'
          ? 'The privacy queue needs the prepared database update.'
          : error.message;
      return;
    }

    list.replaceChildren();
    for (const r of data || []) {
      const row = document.createElement('article'),
        heading = document.createElement('h2'),
        body = document.createElement('p'),
        person = document.createElement('a');
      heading.textContent = r.kind + ' · ' + r.status;
      body.textContent = r.details || 'No additional details.';
      person.textContent = 'View requesting player';
      person.href = 'profile.html?id=' + encodeURIComponent(r.player_id);
      person.target = '_blank';
      person.rel = 'noopener';
      row.append(heading, body, person);
      if (!['completed', 'cancelled'].includes(r.status))
        for (const [text, state] of [
          ['Start review', 'reviewing'],
          ['Mark fulfilled', 'completed'],
        ]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.onclick = async () => {
            if (
              state === 'completed' &&
              !(await APSUUI.confirm({
                title: 'Has this request been fulfilled?',
                message:
                  'This only updates the tracking status. It does not delete, export, or correct any player data. Complete the requested work first.',
                confirmLabel: 'Mark fulfilled',
                cancelLabel: 'Not yet',
              }))
            )
              return;

            b.disabled = true;
            const { error } = await supabaseClient.rpc('review_privacy_requests', {
              p_id: r.id,
              p_status: state,
            });

            if (error) {
              status.textContent = error.message;
              b.disabled = false;
            } else await load();
          };
          row.append(b);
        }

      list.append(row);
    }

    status.textContent = data?.length ? '' : 'No privacy requests.';
  }

  await load();
})();
