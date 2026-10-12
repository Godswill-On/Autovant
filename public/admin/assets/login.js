import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Replace with your actual Supabase Project details from Project Settings > API
const SUPABASE_URL = 'https://ijfbywnlygjmebblqwrh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmJ5d25seWdqbWViYmxxd3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MTI5OTYsImV4cCI6MjEwNzM4ODk5Nn0.73jEbITrBDxUCeIyMdm9FpCtNHLAE9bc_yzq8V6sutE';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form') || document.querySelector('form');

  if (!loginForm) return;

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('email') || loginForm.querySelector('input[type="email"]');
    const passwordInput = document.getElementById('password') || loginForm.querySelector('input[type="password"]');

    const email = emailInput?.value.trim();
    const password = passwordInput?.value.trim();

    if (!email || !password) {
      alert('Please enter both email and password.');
      return;
    }

    try {
      // Authenticate via Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert('Login failed: ' + error.message);
        return;
      }

      // Save token in localStorage for authenticated sessions
      if (data?.session) {
        localStorage.setItem('sb_access_token', data.session.access_token);
      }

      // Redirect to the admin editor dashboard
      window.location.href = '/admin/editor.html';

    } catch (err) {
      console.error('Authentication error:', err);
      alert('An unexpected error occurred during login.');
    }
  });
});