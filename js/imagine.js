// Credentials live only in this dialog until submitted; never browser or database storage.
window.APSUImagine = {
  attach(dialog, client) {
    const panel = document.createElement('section');
    panel.className = 'imagine-generation';
    panel.innerHTML =
      '<h3>Generate a private scene</h3><p>OpenAI · GPT Image 1 Mini · 1024 × 1024 · low quality</p><p>Your prompt and key pass through APSU’s relay to OpenAI. They are not saved by APSU. OpenAI charges your API account. Available to 18+ accounts.</p><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener">OpenAI pricing</a><label>OpenAI API key<input type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" data-imagine-key></label><label class="imagine-consent"><input type="checkbox" data-imagine-consent> Send this preview to OpenAI and use my API credit.</label><button type="button" data-generate>Generate image</button><p role="status" data-generation-status></p><img class="imagine-result" alt="Your generated interpretation of the scene" hidden><a class="button-link" data-download download="apsu-imagined-scene.png" hidden>Download image</a>';
    dialog.append(panel);
    const input = panel.querySelector('[data-imagine-key]'),
      consent = panel.querySelector('[data-imagine-consent]'),
      button = panel.querySelector('[data-generate]'),
      status = panel.querySelector('[data-generation-status]'),
      img = panel.querySelector('img'),
      download = panel.querySelector('[data-download]');
    let busy = false,
      url = null,
      version = 0;
    dialog.addEventListener('close', () => {
      version++;
      input.value = '';
      consent.checked = false;
      if (url) URL.revokeObjectURL(url);

      url = null;
      img.hidden = true;
      img.removeAttribute('src');
      download.hidden = true;
      download.removeAttribute('href');
    });
    button.onclick = async () => {
      if (busy) return;

      const prompt = dialog.querySelector('#imagine-prompt').value.trim();

      if (!prompt) {
        status.textContent = 'Build and review the prompt preview first.';
        return;
      }
      if (!consent.checked || !input.value.trim()) {
        status.textContent = 'Enter your API key and confirm sending this preview.';
        return;
      }

      const key = input.value.trim();
      input.value = '';
      const requestVersion = ++version;
      busy = true;
      button.disabled = true;
      status.textContent =
        'Generating your scene… You can close this window, but a submitted request may still be charged.';
      try {
        const { data, error } = await client.auth.getSession();

        if (error || !data.session) throw Error('Sign in before using Imagine.');

        const endpoint = ['localhost', '127.0.0.1'].includes(location.hostname)
          ? 'https://apsu-roleplay.apsu-launchpad.workers.dev/api/imagine'
          : '/api/imagine';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + data.session.access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key, prompt }),
          signal: AbortSignal.timeout(160000),
        });
        const result = await response.json();

        if (!response.ok)
          throw Error(typeof result.error === 'string' ? result.error : 'Image generation failed.');
        if (requestVersion !== version || !dialog.open) return;

        const encoded = result.data?.[0]?.b64_json;

        if (typeof encoded !== 'string' || encoded.length > 20000000)
          throw Error('The provider returned an unsupported image.');

        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

        if (url) URL.revokeObjectURL(url);

        url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        img.src = url;
        img.hidden = false;
        download.href = url;
        download.hidden = false;
        status.textContent =
          'Your scene is ready. Download it to keep it; APSU does not save generated scenes.';
      } catch (e) {
        if (requestVersion === version)
          status.textContent =
            e.name === 'TimeoutError'
              ? 'The request timed out. Check your OpenAI usage before trying again.'
              : e.message;
      } finally {
        busy = false;
        button.disabled = false;
        consent.checked = false;
      }
    };
  },
};
