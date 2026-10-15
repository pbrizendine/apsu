const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
const submitButton = document.getElementById('submit-button');

form.addEventListener('submit', async function (event) {
  // Handle the form ourselves instead of reloading the page.
  event.preventDefault();
  if (submitButton.disabled) return;

  submitButton.disabled = true;
  status.textContent = 'Creating account…';

  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const username = document.getElementById('username').value.trim();

    if (!username) {
      status.textContent = 'Please enter a username.';
      return;
    }

    const birth = document.getElementById('birth-date').value;
    const age = APSUAccount.ageOn(birth);

    if (sessionStorage.getItem('apsu-age-blocked') === '1' || (age !== null && age < 13)) {
      sessionStorage.setItem('apsu-age-blocked', '1');
      document.getElementById('birth-date').value = '';
      status.textContent = 'APSU is available to people aged 13 and older.';

      return;
    }
    if (age === null) {
      status.textContent = 'Enter a valid date of birth.';
      return;
    }
    if (!document.getElementById('terms-consent').checked) {
      status.textContent = 'Please read and agree to the Terms of Service.';
      return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { username, apsu_birth_date: birth, apsu_terms: APSUPrivacy.policyVersion },
      },
    });

    if (error) {
      status.textContent = error.message;
      return;
    }
    // Email confirmation can leave signup successful without a session.
    if (data.session) {
      window.location.href = 'launchpad.html';
    } else {
      status.textContent =
        'Check your email for a confirmation link, then return here to log in. If you already have an account, use Log in.';
      form.reset();
    }
  } catch (error) {
    status.textContent = 'Unable to connect. Check your internet connection and try again.';
  } finally {
    // Allow another attempt after either success or failure.
    submitButton.disabled = false;
  }
});
