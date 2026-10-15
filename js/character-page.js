const id = new URLSearchParams(location.search).get('id');
const view = createCharacterProfile(document.getElementById('character-profile'), supabaseClient);
(async () => {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    location.replace('login.html');
    return;
  }
  if (!id) {
    document.getElementById('character-profile').textContent = 'Choose a character to view.';
    return;
  }

  await view.load(id);
  const { data: profile } = await supabaseClient.rpc('character_profile', { p_character: id });
  const link = document.getElementById('character-player-link');
  link.hidden = !profile;
  if (profile) {
    window.APSUMessages?.bind(document.querySelector('main'), profile.player_id);
    link.href =
      'profile.html?id=' +
      encodeURIComponent(profile.player_id) +
      '&world=' +
      encodeURIComponent(profile.world_id);
    document.title = profile.name + ' | APSU';
  }
})();
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.replace('login.html');
});
