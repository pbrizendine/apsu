// Home shares the existing Supabase session; it never signs the visitor out.
if (new URLSearchParams(location.search).has('character')) {
  location.replace('room.html' + location.search + location.hash);
} else {
  const nav = document.getElementById('home-account');
  let revision = 0;

  function render(user) {
    nav.replaceChildren();
    nav.setAttribute('aria-busy', 'false');
    for (const [label, href] of user
      ? [
          ['Launchpad', 'launchpad.html'],
          ['My profile', 'profile.html?id=' + encodeURIComponent(user.id)],
        ]
      : [
          ['Log in', 'login.html'],
          ['Create an account', 'signup.html'],
          ['Play solo', 'launchpad.html#single-player'],
        ]) {
      const a = document.createElement('a');
      a.className = 'button-link';
      a.textContent = label;
      a.href = href;
      nav.append(a);
    }
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    revision++;
    render(session?.user);
  });
  const request = revision;
  supabaseClient.auth
    .getSession()
    .then(({ data, error }) => {
      if (request !== revision) return;
      if (error) {
        nav.setAttribute('aria-busy', 'false');
        nav.textContent = 'Account connection unavailable. ';
        const a = document.createElement('a');
        a.href = 'launchpad.html';
        a.textContent = 'Open launchpad';
        nav.append(a);
      } else render(data.session?.user);
    })
    .catch(() => {
      if (request === revision) {
        nav.setAttribute('aria-busy', 'false');
        nav.textContent = 'Account connection unavailable. Refresh to retry.';
      }
    });
}
