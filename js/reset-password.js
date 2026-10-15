(() => {
  const form = document.getElementById('auth-form'),
    button = document.getElementById('submit-button'),
    status = document.getElementById('auth-status');
  let recovery = false;
  status.textContent = 'Open the password reset link from your email to continue.';

  function enableRecovery() {
    recovery = true;
    button.disabled = false;
    status.textContent = 'Choose a password with at least 8 characters.';
    history.replaceState(null, '', location.pathname);
  }

  if (window.apsuRecoveryReady) enableRecovery();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      enableRecovery();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!recovery || button.disabled) return;

    const password = document.getElementById('password').value;

    if (password.length < 8) {
      status.textContent = 'Use at least 8 characters.';
      return;
    }
    if (password !== document.getElementById('confirm-password').value) {
      status.textContent = 'The passwords do not match.';
      return;
    }

    button.disabled = true;
    try {
      const { error } = await supabaseClient.auth.updateUser({ password });

      if (error) throw error;

      recovery = false;
      form.hidden = true;
      status.textContent = 'Password updated. You can return to login.';
      await supabaseClient.auth.signOut({ scope: 'local' });
    } catch (error) {
      status.textContent =
        error.message ||
        'Unable to update your password. Request a fresh reset link and try again.';
    } finally {
      button.disabled = !recovery;
    }
  });
})();
