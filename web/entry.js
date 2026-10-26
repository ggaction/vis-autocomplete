import { accountSession } from './cloud/session.js';
import { initializeAccountViewPreferences } from './view-preferences.js';
import { stageGuestTransfer, clearGuestTransfer } from './cloud/guest-transfer.js';

const $ = id => document.getElementById(id);
const gate = $('auth-gate'), startup = $('session-gate'), root = $('editor-root'), fields = $('auth-fields');
const status = $('auth-status');
let account, mode = 'signin', loadingEditor = false, editorOwner = null;
let stopPreferences;

function message(text = '', error = false) {
  status.textContent = text;
  status.setAttribute('role', error ? 'alert' : 'status');
}
function setMode(next) {
  mode = next;
  const signup = next === 'signup', reset = next === 'reset', recovery = next === 'recovery';
  $('auth-heading').textContent = signup ? 'Create your account' : reset ? 'Reset your password' : recovery ? 'Choose a new password' : 'Sign in';
  $('auth-description').textContent = signup ? 'A place for your data, charts, and next ideas.' : reset ? 'We’ll email you a link to reset your password.' : recovery ? 'Choose a password with at least 10 characters.' : 'Sign in to save your work, or try the editor without an account.';
  $('auth-submit').textContent = signup ? 'Create account' : reset ? 'Send reset link' : recovery ? 'Update password' : 'Sign in';
  $('auth-google').hidden = reset || recovery;
  $('auth-divider').hidden = reset || recovery;
  $('auth-email-label').hidden = recovery;
  $('auth-email').required = !recovery;
  $('auth-email').disabled = recovery;
  $('auth-password-label').hidden = reset;
  $('auth-password').disabled = reset;
  $('auth-password').required = !reset;
  $('auth-password').value = '';
  $('auth-password').minLength = signup || recovery ? 10 : 1;
  $('auth-password').autocomplete = signup || recovery ? 'new-password' : 'current-password';
  $('auth-password-hint').hidden = !signup;
  $('auth-forgot').hidden = next !== 'signin';
  $('auth-switch-prompt').textContent = signup ? 'Already have an account?' : reset ? 'Remember your password?' : 'New here?';
  $('auth-switch').textContent = signup || reset ? 'Sign in' : 'Sign up';
  document.querySelector('.auth-switch').hidden = recovery;
  $('auth-guest').hidden = recovery;
  $('auth-guest').textContent = account?.guest && editorOwner ? 'Back to your visualization' : 'Try without account';
  message();
}

async function run(action) {
  fields.disabled = true; message();
  try { await action(); }
  catch (error) { message(error.message || 'Please try again.', true); }
  finally { if (!loadingEditor || !gate.hidden) fields.disabled = false; }
}

async function prepareSignIn() {
  if (!account.guest) return;
  await account.prepareGuestTransfer?.();
  stageGuestTransfer(account.user);
  await account.drain();
}

$('auth-switch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
$('auth-forgot').addEventListener('click', () => { setMode('reset'); $('auth-email').focus(); });
$('session-retry').addEventListener('click', () => location.reload());
$('auth-google').addEventListener('click', () => run(async () => {
  await prepareSignIn();
  await account.google(); message('Opening Google sign in…');
}));
$('auth-guest').addEventListener('click', () => run(async () => {
  if (account.guest && editorOwner) {
    clearGuestTransfer(); gate.hidden = true; startup.hidden = true; root.hidden = false; root.inert = false;
    window.dispatchEvent(new Event('resize')); return;
  }
  await account.tryWithoutAccount();
}));
window.addEventListener('vis-account-access', event => {
  if (!account?.guest) return;
  lockEditor(); setMode(event.detail === 'signup' ? 'signup' : 'signin');
  fields.disabled = false; showAuth(); $('auth-email').focus();
});
$('auth-form').addEventListener('submit', event => {
  event.preventDefault();
  const requested = mode, email = $('auth-email').value.trim(), password = $('auth-password').value;
  run(async () => {
    if (requested === 'reset') {
      await account.recover(email);
      message('If an account exists, a password reset link will arrive by email.');
    } else if (requested === 'recovery') {
      await account.password(password); await openEditor(account.user);
    } else if (requested === 'signup') {
      await prepareSignIn();
      await account.signUp(email, password);
      if (!gate.hidden) message('Check your email to confirm your account, then return here to sign in.');
    } else {
      try { await prepareSignIn(); await account.signIn(email, password); }
      catch { throw new Error('Could not sign in. Check your details or reset your password.'); }
      message('Opening your workspace…');
    }
  });
});

function lockEditor() {
  root.hidden = true; root.inert = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
function showStartup(text, error = false) {
  gate.hidden = true; startup.hidden = false;
  startup.setAttribute('aria-busy', String(!error));
  $('session-status').textContent = text;
  $('session-status').setAttribute('role', error ? 'alert' : 'status');
  $('session-retry').hidden = !error;
}
function showAuth() {
  startup.hidden = true; gate.hidden = false;
}
async function openEditor(user) {
  if (loadingEditor || !user) return;
  loadingEditor = true; editorOwner = user.id;
  fields.disabled = true; showStartup('Opening your workspace…');
  stopPreferences = initializeAccountViewPreferences(account);
  root.append($('editor-template').content.cloneNode(true));
  // Keep the neutral startup screen until the verified account's chart is
  // restored. display:none would initialize canvases at zero size.
  root.classList.add('editor-loading'); root.hidden = false;
  try {
    // A verified member or guest session precedes private draft reads.
    await import('./app.js');
    if (account.user?.id !== editorOwner) return;
    root.classList.remove('editor-loading'); root.inert = false; startup.hidden = true;
    window.dispatchEvent(new Event('resize'));
  } catch {
    lockEditor(); showStartup('Your workspace could not load. Please try again.', true);
  }
}
function identityChanged(state) {
  if (editorOwner && state.user?.id !== editorOwner) {
    stopPreferences?.();
    // Unmount workers, shortcuts and in-memory private charts together. A new
    // identity always starts a fresh editor, including sign-out in another tab.
    lockEditor(); showStartup('Checking your session…'); location.reload(); return;
  }
  if (state.recovery) { setMode('recovery'); fields.disabled = false; showAuth(); return; }
  if (!state.user) { showAuth(); return; }
  if (mode !== 'recovery' && state.user) void openEditor(state.user);
}

try {
  const session = await accountSession(); account = session.account;
  if (!account.configured) throw new Error('Sign in is not configured. Please contact the site owner.');
  session.subscribe(identityChanged);
  fields.disabled = false; message(); identityChanged(session.state);
} catch (error) {
  lockEditor(); fields.disabled = true;
  showStartup(error.message || 'Could not check your session. Please try again.', true);
}
