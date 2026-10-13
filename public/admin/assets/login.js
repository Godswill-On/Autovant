/* AUTOVANT editor sign-in (Supabase Auth). */
(function () {
  'use strict';

  var form = document.getElementById('login-form');
  if (!form) return;

  var msg = document.createElement('p');
  msg.className = 'form-msg';
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  form.append(msg);

  function say(text) { msg.textContent = text; msg.hidden = !text; }

  // Already signed in: go straight to the editor.
  AVD.getSession().then(function (s) {
    if (s) window.location.replace('/admin/editor.html');
  }).catch(function () {});

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    if (!email || !password) { say('Enter your email and password.'); return; }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    say('');
    AVD.signIn(email, password).then(function () {
      window.location.href = '/admin/editor.html';
    }).catch(function (err) {
      btn.disabled = false;
      say(/invalid login/i.test(err.message) ? 'That email or password is not right.' : err.message);
    });
  });
})();
