const worldId = new URLSearchParams(window.location.search).get('world');
const content = document.getElementById('world-content');
const status = document.getElementById('world-status');
const retry = document.getElementById('retry');
const form = document.getElementById('character-form');
const nameInput = document.getElementById('character-name');
const createButton = document.getElementById('create-character');
const characterStatus = document.getElementById('character-status');
let playerId = null;
let characters = [];
let leaving = false;
let loading = false;
let saving = false;

function leave(url) {
  leaving = true;
  content.hidden = true;
  window.location.replace(url);
}

function renderCharacters() {
  const list = document.getElementById('character-list');
  list.replaceChildren();
  document.getElementById('character-count').textContent = characters.length + ' / 3 characters';
  form.hidden = characters.length >= 3;
  for (const character of characters) {
    const card = document.createElement('div');
    card.className = 'character-card';
    const name = document.createElement('p');
    name.textContent = character.name;
    const play = document.createElement('a');
    play.className = 'button-link';
    play.textContent = 'Play';
    play.href =
      'room.html?world=' +
      encodeURIComponent(worldId) +
      '&character=' +
      encodeURIComponent(character.id);
    card.appendChild(name);
    card.appendChild(play);
    const profile = document.createElement('a');
    profile.className = 'button-link';
    profile.textContent = 'Character Profile ↗';
    profile.target = '_blank';
    profile.rel = 'noopener';
    profile.href = 'character.html?id=' + encodeURIComponent(character.id);
    card.appendChild(profile);
    list.appendChild(card);
  }
}

async function fetchCharacters() {
  const { data, error } = await supabaseClient
    .from('characters')
    .select('id, name, slot')
    .eq('world_id', worldId)
    .eq('player_id', playerId)
    .order('slot');

  if (error) throw error;
  if (leaving) return;

  characters = data;
  renderCharacters();
}

async function loadWorld() {
  if (loading || leaving) return;
  if (worldId !== 'alska-mogue') {
    leave('launchpad.html');
    return;
  }

  loading = true;
  retry.hidden = true;
  try {
    const { data: account, error: authError } = await supabaseClient.auth.getUser();

    if (leaving) return;
    if (authError) {
      if (
        authError.name === 'AuthSessionMissingError' ||
        authError.status === 401 ||
        authError.status === 403
      ) {
        leave('login.html');
        return;
      }

      throw authError;
    }
    if (!account.user) {
      leave('login.html');
      return;
    }
    if (!(await APSUAccount.require(supabaseClient))) return;

    playerId = account.user.id;
    const moderation = await supabaseClient.rpc('moderation_status', {
      p_world: worldId,
      p_since: null,
    });

    if (moderation.error) throw moderation.error;
    if (moderation.data.banned) {
      status.textContent = 'You are banned from this world.';
      content.hidden = true;
      return;
    }

    document.getElementById('world-admin-link').hidden = !moderation.data.rank;
    document.getElementById('world-admin-link').href =
      'admin.html?world=' + encodeURIComponent(worldId);
    const { data: world, error } = await supabaseClient
      .from('worlds')
      .select('id, name, description, image_urls')
      .eq('id', worldId)
      .maybeSingle();

    if (leaving) return;
    if (error) throw error;
    if (!world) {
      status.textContent = 'World not found.';
      return;
    }

    document.title = world.name + ' | APSU';
    document.getElementById('world-title').textContent = world.name;
    document.getElementById('world-description').textContent =
      world.description || 'No description added yet.';
    const images = document.getElementById('world-images');
    images.replaceChildren();
    for (const source of world.image_urls || []) {
      // Creator images must use HTTPS; don't render arbitrary URL schemes.
      let url;

      try {
        url = new URL(source);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:') continue;

      const image = document.createElement('img');
      image.src = url.href;
      image.alt = world.name + ' world image';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', function () {
        image.remove();
        document.getElementById('image-placeholder').hidden = images.children.length > 0;
      });
      images.appendChild(image);
    }

    document.getElementById('image-placeholder').hidden = images.children.length > 0;
    await fetchCharacters();
    if (leaving) return;

    content.hidden = false;
    status.textContent = '';
  } catch (error) {
    if (!leaving) {
      status.textContent = error.message || 'Unable to load this world. Please try again.';
      retry.hidden = false;
    }
  } finally {
    loading = false;
  }
}

form.addEventListener('submit', async function (event) {
  event.preventDefault();
  if (saving || leaving || !playerId) return;

  const name = nameInput.value.trim();

  if (!name || name.length > 60) {
    characterStatus.textContent = 'Enter a name between 1 and 60 characters.';
    return;
  }

  saving = true;
  createButton.disabled = true;
  characterStatus.textContent = 'Creating character…';
  try {
    // Refresh slots first. The database's unique constraint handles concurrent submissions.
    await fetchCharacters();
    if (leaving) return;

    const slot = [1, 2, 3].find((slot) => !characters.some((character) => character.slot === slot));

    if (!slot) {
      characterStatus.textContent = 'You have reached the three-character limit for this world.';
      return;
    }

    const { error } = await supabaseClient
      .from('characters')
      .insert({ player_id: playerId, world_id: worldId, slot, name });

    if (leaving) return;
    if (error) {
      if (error.code === '23505') {
        await fetchCharacters();
        characterStatus.textContent =
          'Your character list changed in another tab. Review it before trying again.';
        return;
      }

      throw error;
    }

    form.reset();
    characterStatus.textContent = 'Character created.';
    try {
      await fetchCharacters();
    } catch {
      characterStatus.textContent =
        'Character created, but the list could not refresh. Reload this page before creating another.';
    }
  } catch (error) {
    if (!leaving)
      characterStatus.textContent =
        'Could not confirm character creation. Refresh the page to check your list before trying again.';
  } finally {
    saving = false;
    createButton.disabled = false;
  }
});
retry.addEventListener('click', loadWorld);
supabaseClient.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT') leave('login.html');
  if (playerId && session?.user && session.user.id !== playerId) leave('launchpad.html');
});
loadWorld();

supabaseClient
  .rpc('join_world', {
    p_world: new URLSearchParams(location.search).get('world') || 'alska-mogue',
  })
  .catch(() => {});
