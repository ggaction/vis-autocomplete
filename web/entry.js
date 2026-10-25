import { accountSession } from './cloud/session.js';
import { initializeAccountViewPreferences } from './view-preferences.js';

const $ = id => document.getElementById(id);
const gate = $('auth-gate'), root = $('editor-root'), fields = $('auth-fields');
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
  $('auth-description').textContent = signup ? 'A place for your data, charts, and next ideas.' : reset ? 'We’ll email you a link to reset your password.' : recovery ? 'Choose a password with at least 10 characters.' : 'Sign in to start creating and save your work.';
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
  message();
}

async function run(action) {
  fields.disabled = true; message();
  try { await action(); }
  catch (error) { message(error.message || 'Please try again.', true); }
  finally { if (!loadingEditor) fields.disabled = false; }
}

$('auth-switch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
$('auth-forgot').addEventListener('click', () => { setMode('reset'); $('auth-email').focus(); });
$('auth-retry').addEventListener('click', () => location.reload());
$('auth-google').addEventListener('click', () => run(async () => {
  await account.google(); message('Opening Google sign in…');
}));
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
      await account.signUp(email, password);
      if (!loadingEditor) message('Check your email to confirm your account, then return here to sign in.');
    } else {
      try { await account.signIn(email, password); }
      catch { throw new Error('Could not sign in. Check your details or reset your password.'); }
      message('Opening your workspace…');
    }
  });
});

function lockEditor() {
  root.hidden = true; root.inert = true; gate.hidden = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
async function openEditor(user) {
  if (loadingEditor || !user) return;
  loadingEditor = true; editorOwner = user.id;
  fields.disabled = true; message('Opening your workspace…');
  stopPreferences = initializeAccountViewPreferences(account);
  root.append($('editor-template').content.cloneNode(true));
  // Measure the restored chart at its real viewport size while the landing
  // page remains visible. display:none would initialize canvases at zero size.
  root.classList.add('editor-loading'); root.hidden = false;
  try {
    // No editor, recommendation workers, datasets, or draft reads before auth.
    await import('./app.js');
    if (account.user?.id !== editorOwner) return;
    root.classList.remove('editor-loading'); root.inert = false; gate.hidden = true;
    window.dispatchEvent(new Event('resize'));
  } catch {
    lockEditor(); message('Your workspace could not load. Please try again.', true); $('auth-retry').hidden = false;
  }
}
function identityChanged(state) {
  if (editorOwner && state.user?.id !== editorOwner) {
    stopPreferences?.();
    // Unmount workers, shortcuts and in-memory private charts together. A new
    // identity always starts a fresh editor, including sign-out in another tab.
    lockEditor(); location.reload(); return;
  }
  if (state.recovery) { setMode('recovery'); fields.disabled = false; return; }
  if (mode !== 'recovery' && state.user) void openEditor(state.user);
}

try {
  const session = await accountSession(); account = session.account;
  if (!account.configured) throw new Error('Sign in is not configured. Please contact the site owner.');
  session.subscribe(identityChanged);
  fields.disabled = false; message(); identityChanged(session.state);
} catch (error) {
  lockEditor(); fields.disabled = true;
  message(error.message || 'Sign in is temporarily unavailable. Please try again.', true);
  $('auth-retry').hidden = false;
}
