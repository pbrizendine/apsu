// Single-player works without a Supabase account or network connection.
const apsuConfig = window.APSU_CONFIG || {};
const apsuMultiplayerConfigured = Boolean(
  apsuConfig.supabaseUrl && apsuConfig.supabasePublishableKey,
);

function createGuestClient() {
  const unavailable = async () => ({
    data: null,
    error: {
      message:
        'Multiplayer is not configured. Use Single Player, or configure your own Supabase project.',
    },
  });

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: unavailable,
      signUp: unavailable,
      resetPasswordForEmail: unavailable,
      updateUser: unavailable,
    },
    rpc: unavailable,
    storage: {
      from: () => ({
        upload: unavailable,
        remove: unavailable,
        createSignedUrl: unavailable,
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}

const supabaseClient = apsuMultiplayerConfigured
  ? window.supabase.createClient(apsuConfig.supabaseUrl, apsuConfig.supabasePublishableKey)
  : createGuestClient();

// Capture recovery before the next script loads (the auth event may arrive quickly).
window.apsuRecoveryReady = false;
if (location.pathname.endsWith('/reset-password.html')) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) window.apsuRecoveryReady = true;
    if (event === 'SIGNED_OUT') window.apsuRecoveryReady = false;
  });
}
