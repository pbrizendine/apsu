const playerPicture = createPlayerPicture(
  document.getElementById('player-picture-preview'),
  supabaseClient,
);
const launchpadStatus = document.getElementById('launchpad-status');
const worldList = document.getElementById('world-list');
const accountMenu = document.getElementById('account-menu');
const profileDialog = document.getElementById('profile-dialog');
const logoutButton = document.getElementById('log-out');
const retryButton = document.getElementById('retry');
let playerId = null;
let leavingPage = false;
let loading = false;
let countTimer = null;
let countRequest = 0;

async function refreshPlayerCounts() {
  if (leavingPage || !playerId || document.getElementById('multiplayer-panel').hidden) return;

  const request = ++countRequest;

  try {
    const { data, error } = await supabaseClient.rpc('connected_player_counts');

    if (leavingPage || request !== countRequest) return;
    if (error) throw error;

    const counts = new Map(data.map((row) => [row.world_id, row.player_count]));

    for (const label of worldList.querySelectorAll('[data-world-count]')) {
      const count = Number(counts.get(label.dataset.worldCount) || 0);
      label.textContent = count + ' player' + (count === 1 ? '' : 's') + ' connected';
    }
  } catch {
    if (leavingPage || request !== countRequest) return;
    for (const label of worldList.querySelectorAll('[data-world-count]'))
      label.textContent = 'Player count unavailable';
  }
}

function startPlayerCounts() {
  clearInterval(countTimer);
  refreshPlayerCounts();
  countTimer = setInterval(refreshPlayerCounts, 15000);
}

window.addEventListener('pagehide', () => {
  clearInterval(countTimer);
  countRequest++;
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) startPlayerCounts();
});

function returnToLogin() {
  playerId = null;
  clearInterval(countTimer);
  worldList.replaceChildren();
  accountMenu.hidden = true;
  profileDialog.close();
  document.getElementById('guest-login').hidden = false;
  launchpadStatus.textContent = apsuMultiplayerConfigured
    ? 'Log in to join a multiplayer world, or choose Single Player to play locally.'
    : 'This copy runs independently. Choose Single Player; multiplayer requires your own backend setup.';
}

// World names come from Supabase. Routes stay in our code, not in database text.
function renderWorlds(worlds) {
  worldList.replaceChildren();
  for (const world of worlds) {
    const card = document.createElement('article');
    card.className = 'world-card';
    const title = document.createElement('h2');
    title.textContent = world.name;
    const rating = document.createElement('p');
    rating.textContent = (world.minimum_age || 13) + '+';
    card.append(rating);
    const actions = document.createElement('div');
    actions.className = 'world-actions';
    const enter = document.createElement('button');
    enter.type = 'button';
    enter.textContent = 'Enter';
    // Only Alska Mogue has a room screen implemented so far.
    enter.disabled = world.id !== 'alska-mogue';
    enter.addEventListener('click', function () {
      if (world.id === 'alska-mogue' && !leavingPage) {
        window.location.href = 'world.html?world=' + encodeURIComponent(world.id);
      }
    });
    const forum = document.createElement('button');
    forum.type = 'button';
    forum.textContent = 'View Forum';
    forum.disabled = true;
    forum.title = 'World forums are coming later';
    actions.appendChild(enter);
    actions.appendChild(forum);
    const count = document.createElement('p');
    count.dataset.worldCount = world.id;
    count.textContent = 'Checking connected players…';
    card.appendChild(title);
    card.appendChild(count);
    card.appendChild(actions);
    worldList.appendChild(card);
  }
}

async function loadLaunchpad() {
  if (loading || leavingPage) return;

  loading = true;
  retryButton.hidden = true;
  launchpadStatus.textContent = 'Loading worlds…';
  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (!sessionData.session) {
      returnToLogin();
      return;
    }

    const { data: account, error: authError } = await supabaseClient.auth.getUser();

    if (leavingPage) return;
    if (authError) {
      if (
        authError.name === 'AuthSessionMissingError' ||
        authError.status === 401 ||
        authError.status === 403
      ) {
        returnToLogin();
        return;
      }

      throw authError;
    }
    if (!account.user) {
      returnToLogin();
      return;
    }
    // Eligibility is enforced when entering world.html; browsing solo stays available.

    const user = account.user;
    playerId = user.id;
    const username = user.user_metadata?.username;
    const name = typeof username === 'string' && username.trim() ? username : 'Player';
    playerPicture.load(user.id, false, null, name);
    document.getElementById('account-name').textContent = name;
    document.getElementById('profile-name').textContent = name;
    const joined = new Date(user.created_at);
    document.getElementById('profile-joined').textContent = Number.isNaN(joined.getTime())
      ? 'Not available'
      : joined.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('full-profile-link').href =
      'profile.html?id=' + encodeURIComponent(user.id);
    accountMenu.hidden = false;
    document.getElementById('guest-login').hidden = true;
    const { data: worlds, error } = await supabaseClient
      .from('worlds')
      .select('id, name, minimum_age')
      .order('name');

    if (leavingPage) return;
    if (error) throw error;

    renderWorlds(worlds);
    startPlayerCounts();
    launchpadStatus.textContent = worlds.length
      ? 'Choose a world to enter.'
      : 'No worlds are available yet.';
  } catch (error) {
    if (leavingPage) return;

    worldList.replaceChildren();
    launchpadStatus.textContent = 'Unable to load worlds. Please try again.';
    retryButton.hidden = false;
  } finally {
    loading = false;
  }
}

retryButton.addEventListener('click', loadLaunchpad);
document.getElementById('view-profile').addEventListener('click', function () {
  accountMenu.open = false;
  profileDialog.showModal();
});
document.addEventListener('click', function (event) {
  if (!accountMenu.contains(event.target)) accountMenu.open = false;
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && accountMenu.open) {
    accountMenu.open = false;
    accountMenu.querySelector('summary').focus();
  }
});
logoutButton.addEventListener('click', async function () {
  if (logoutButton.disabled) return;

  logoutButton.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' });

    if (error) throw error;

    returnToLogin();
  } catch (error) {
    launchpadStatus.textContent = 'Unable to log out. Please try again.';
  } finally {
    logoutButton.disabled = false;
  }
});
supabaseClient.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT') returnToLogin();
  if (event === 'SIGNED_IN' && !playerId) setTimeout(loadLaunchpad, 0);
  if (playerId && session?.user && session.user.id !== playerId) {
    leavingPage = true;
    worldList.replaceChildren();
    accountMenu.hidden = true;
    profileDialog.close();
    window.location.reload();
  }
});
loadLaunchpad();

const exitNotice = sessionStorage.getItem('apsu-world-exit');

if (exitNotice) {
  sessionStorage.removeItem('apsu-world-exit');
  const p = document.createElement('p');
  p.setAttribute('role', 'status');
  p.textContent = exitNotice;
  document.querySelector('main').prepend(p);
}
