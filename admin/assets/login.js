/* AUTOVANT editor sign-in */
(function () {
  'use strict';
  var form = document.getElementById('login-form');
  var input = document.getElementById('password');
  var msg = document.getElementById('login-msg');
  var btn = document.getElementById('login-btn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!input.value) {
      msg.textContent = 'Enter your password.';
      input.focus();
      return;
    }
    btn.disabled = true;
    msg.textContent = '';
    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF': '1' },
      body: JSON.stringify({ password: input.value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (res.ok) {
        window.location.href = '/admin';
        return;
      }
      msg.textContent = res.j.error || 'Could not sign in. Try again.';
      input.select();
      btn.disabled = false;
    }).catch(function () {
      msg.textContent = 'Could not reach the server. Try again.';
      btn.disabled = false;
    });
  });
})();
