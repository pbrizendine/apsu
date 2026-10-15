const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
const submitButton = document.getElementById('submit-button');

form.addEventListener('submit', async function (event) {
  // Handle the form ourselves instead of reloading the page.
  event.preventDefault();
  if (submitButton.disabled) return;

  submitButton.disabled = true;
  status.textContent = 'Logging in…';

  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      status.textContent = error.message;
      return;
    }
    if (data.session) {
      window.location.href = 'launchpad.html';
    } else {
      status.textContent = 'Login did not create a session. Please try again.';
    }
  } catch (error) {
    status.textContent = 'Unable to connect. Check your internet connection and try again.';
  } finally {
    // Allow another attempt after either success or failure.
    submitButton.disabled = false;
  }
});
