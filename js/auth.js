import { supabase } from "./supabase.js";
import { showToast, showSpinner, hideSpinner } from "./ui.js";

export async function signUp(name, email, password) {
  showSpinner();
  try {
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { display_name: name } },
    });
    if (error) throw error;
    showToast(data.session ? "Account created! Welcome aboard 🎉" : "Account created. Check your email to confirm, then log in.", "success");
    return data.user;
  } catch (err) {
    showToast(friendlyError(err), "error");
    return null;
  } finally { hideSpinner(); }
}

export async function login(email, password) {
  showSpinner();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showToast(`Welcome back, ${data.user.user_metadata?.display_name || "User"}!`, "success");
    return data.user;
  } catch (err) {
    showToast(friendlyError(err), "error");
    return null;
  } finally { hideSpinner(); }
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) showToast(error.message, "error");
  else { showToast("Logged out successfully.", "info"); window.location.href = "login.html"; }
}

export async function resetPassword(email) {
  showSpinner();
  try {
    const redirectTo = new URL("forgot-password.html", window.location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showToast("Password reset email sent! Please check your inbox.", "success");
    return true;
  } catch (err) { showToast(friendlyError(err), "error"); return false; }
  finally { hideSpinner(); }
}

export async function updatePassword(password) {
  showSpinner();
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    showToast("Password updated. You can sign in now.", "success");
    await supabase.auth.signOut();
    window.location.href = "login.html";
    return true;
  } catch (err) { showToast(friendlyError(err), "error"); return false; }
  finally { hideSpinner(); }
}

export function watchAuth(onUser, onGuest) {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) onUser(data.session.user); else onGuest?.();
  });
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) onUser(session.user); else onGuest?.();
  });
  return () => subscription.unsubscribe();
}

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return new Promise(() => {}); }
  return session.user;
}

function friendlyError(err) {
  const messages = {
    "User already registered": "This email is already registered.",
    "Invalid login credentials": "Email or password is incorrect.",
    "Password should be at least 6 characters": "Password must be at least 6 characters.",
  };
  return messages[err.message] || err.message || "Something went wrong. Please try again.";
}
