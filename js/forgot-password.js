(() => {
  const form = document.getElementById('auth-form'),
    button = document.getElementById('submit-button'),
    status = document.getElementById('auth-status');
  let nextRequest = 0;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    if (Date.now() < nextRequest) {
      status.textContent = 'Please wait a minute before requesting another link.';
      return;
    }
    if (!/^https?:$/.test(location.protocol)) {
      status.textContent =
        'Open APSU through its website or localhost to request a password reset.';
      return;
    }

    button.disabled = true;
    status.textContent = 'Requesting reset link…';
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(
        document.getElementById('email').value.trim(),
        { redirectTo: new URL('reset-password.html', location.href).href },
      );

      if (error) throw error;

      nextRequest = Date.now() + 60000;
      status.textContent =
        'If an account exists for that email, a reset link will be sent. Check your inbox and spam folder.';
    } catch {
      status.textContent = 'Unable to request a reset link. Please wait a minute and try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
