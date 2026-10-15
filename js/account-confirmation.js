(async () => {
  const form = document.getElementById('eligibility-form'),
    status = document.getElementById('eligibility-status');
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    location.replace('login.html');
    return;
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    const birth = document.getElementById('birth-date').value,
      age = APSUAccount.ageOn(birth),
      button = form.querySelector('button');

    if (age === null) {
      status.textContent = 'Enter a valid date of birth.';
      return;
    }
    if (age < 13 || sessionStorage.getItem('apsu-age-blocked') === '1') {
      sessionStorage.setItem('apsu-age-blocked', '1');
      status.textContent = 'APSU is available to people aged 13 and older.';
      return;
    }
    if (!document.getElementById('terms-consent').checked) {
      status.textContent = 'Read and agree to the Terms of Service before continuing.';
      return;
    }

    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc('accept_account_terms', {
        p_birth: birth,
        p_version: APSUPrivacy.policyVersion,
      });

      if (error) throw error;

      location.replace('launchpad.html');
    } catch (e) {
      status.textContent =
        e.code === 'PGRST202'
          ? 'Account confirmation needs the prepared database update.'
          : e.message;
    } finally {
      button.disabled = false;
    }
  };
})();
