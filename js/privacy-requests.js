(async () => {
  const form = document.getElementById('request-form'),
    status = document.getElementById('request-status'),
    list = document.getElementById('request-list');
  let pending = null,
    busy = false;
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    form.hidden = true;
    status.textContent =
      'Log in to submit or view a request. The public contact address has not been configured yet.';
    return;
  }

  async function refresh() {
    const { data, error } = await supabaseClient.rpc('my_privacy_requests');

    if (error) {
      status.textContent =
        error.code === 'PGRST202'
          ? 'Request submission is not active until the prepared database update is installed. Nothing has been submitted.'
          : error.message;
      return;
    }

    list.replaceChildren();
    for (const r of data || []) {
      const card = document.createElement('article'),
        title = document.createElement('h3'),
        text = document.createElement('p');
      title.textContent = r.kind + ' · ' + r.status;
      text.textContent = new Date(r.created_at).toLocaleDateString() + ' · Request ' + r.id;
      card.append(title, text);
      if (r.status === 'pending') {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Cancel request';
        b.onclick = async () => {
          b.disabled = true;
          const { error } = await supabaseClient.rpc('cancel_privacy_request', { p_id: r.id });

          if (error) {
            status.textContent = error.message;
            b.disabled = false;
          } else await refresh();
        };
        card.append(b);
      }

      list.append(card);
    }
    if (!data?.length) list.textContent = 'No requests yet.';
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const kind = document.getElementById('request-kind').value,
      details = document.getElementById('request-details').value.trim();

    if (details.length > 2000) {
      status.textContent = 'Use up to 2000 characters.';
      return;
    }
    if (
      kind === 'deletion' &&
      !(await APSUUI.confirm({
        title: 'Request account deletion?',
        message:
          'This submits a request for APSU staff to review. It does not immediately delete your account. You can cancel while the request is pending.',
        confirmLabel: 'Submit deletion request',
        cancelLabel: 'Keep account',
      }))
    )
      return;
    if (!pending || pending.kind !== kind || pending.details !== details)
      pending = { id: crypto.randomUUID(), kind, details };

    busy = true;
    form.querySelector('button').disabled = true;
    try {
      const { error } = await supabaseClient.rpc('request_privacy_action', {
        p_id: pending.id,
        p_kind: kind,
        p_details: details,
      });

      if (error) throw error;

      pending = null;
      status.textContent =
        'Request submitted. Its status is shown below. This is a manual review, not an immediate deletion.';
      form.reset();
      await refresh();
    } catch (e) {
      status.textContent =
        e.code === 'PGRST202'
          ? 'Request submission needs the prepared database update. Nothing has been submitted.'
          : e.message;
    } finally {
      busy = false;
      form.querySelector('button').disabled = false;
    }
  };
  await refresh();
})();
