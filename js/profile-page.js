const status = document.getElementById('profile-status');
const content = document.getElementById('profile-content');
const picture = createPlayerPicture(document.getElementById('player-picture'), supabaseClient);
let profileOwnerId = null;
let viewerId = null;
let isOwner = false;
let leavingPage = false;
let savedAbout = '';
const editAbout = document.getElementById('edit-about');
const aboutForm = document.getElementById('about-form');
const aboutInput = document.getElementById('about-input');
const aboutStatus = document.getElementById('about-status');
const saveAbout = document.getElementById('save-about');
const cancelAbout = document.getElementById('cancel-about');

function showSavedAbout() {
  document.getElementById('profile-about').textContent = savedAbout || 'No bio added yet.';
  aboutForm.hidden = true;
  editAbout.hidden = !isOwner;
}

editAbout.addEventListener('click', function () {
  if (!isOwner || !profileOwnerId || leavingPage) return;

  aboutInput.value = savedAbout;
  aboutStatus.textContent = '';
  aboutForm.hidden = false;
  editAbout.hidden = true;
  aboutInput.focus();
});
cancelAbout.addEventListener('click', function () {
  if (saveAbout.disabled) return;

  showSavedAbout();
  aboutStatus.textContent = '';
  editAbout.focus();
});

aboutForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  if (!isOwner || !profileOwnerId || leavingPage || saveAbout.disabled) return;

  const draft = aboutInput.value.trim();

  if (draft.length > 2000) {
    aboutStatus.textContent = 'Please keep your About Me to 2,000 characters.';
    return;
  }

  saveAbout.disabled = true;
  cancelAbout.disabled = true;
  aboutInput.disabled = true;
  aboutStatus.textContent = 'Saving…';
  try {
    // Recheck ownership in case the account changed in another tab.
    const { data: current, error: checkError } = await supabaseClient.auth.getUser();

    if (checkError) throw checkError;
    if (leavingPage) return;
    if (!current.user || current.user.id !== profileOwnerId) {
      returnToLogin();
      return;
    }
    // updateUser writes only to the authenticated account, never a URL-supplied ID.

    const { data, error } = await supabaseClient.auth.updateUser({ data: { about: draft } });

    if (error) throw error;
    if (leavingPage) return;
    if (data.user.id !== profileOwnerId) {
      returnToLogin();
      return;
    }

    savedAbout =
      typeof data.user.user_metadata?.about === 'string' ? data.user.user_metadata.about : '';
    showSavedAbout();
    aboutStatus.textContent = 'About Me saved.';
    editAbout.focus();
  } catch (error) {
    aboutStatus.textContent =
      'Could not save your About Me. Your draft is still here; please try again.';
  } finally {
    saveAbout.disabled = false;
    cancelAbout.disabled = false;
    aboutInput.disabled = false;
  }
});

function returnToLogin() {
  leavingPage = true;
  content.hidden = true;
  window.location.replace('login.html');
}

async function loadProfile() {
  try {
    const { data, error } = await supabaseClient.auth.getUser();

    if (leavingPage) return;
    if (error) {
      if (
        error.name === 'AuthSessionMissingError' ||
        error.status === 401 ||
        error.status === 403
      ) {
        returnToLogin();
        return;
      }

      throw error;
    }
    if (!data.user) {
      returnToLogin();
      return;
    }

    const user = data.user;
    const requestedId = new URLSearchParams(window.location.search).get('id');
    viewerId = user.id;
    const targetId = requestedId || user.id;
    const { data: profiles, error: profileError } = await supabaseClient.rpc('player_profile', {
      p_user: targetId,
    });

    if (leavingPage) return;
    if (profileError) throw profileError;

    const profile = profiles?.[0];

    if (!profile) {
      status.textContent = 'Profile unavailable.';
      return;
    }

    profileOwnerId = profile.id;
    isOwner = profileOwnerId === viewerId;
    picture.load(profileOwnerId, isOwner, null, profile.username);
    window.APSUMessages?.bind(content, profileOwnerId);
    savedAbout = profile.about;
    showSavedAbout();
    document.getElementById('profile-name').textContent = profile.username;
    document.title = profile.username + ' | APSU Profile';
    document.getElementById('profile-joined').textContent = new Date(
      profile.joined,
    ).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    content.hidden = false;
    status.textContent = '';
  } catch (error) {
    status.textContent =
      'Unable to load your profile. Check your connection and refresh to try again.';
  }
}

supabaseClient.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT') returnToLogin();
  if (viewerId && session?.user && session.user.id !== viewerId) {
    leavingPage = true;
    content.hidden = true;
    window.location.reload();
  }
});
loadProfile();
