// Small vanilla-JS helpers shared by login.html and dashboard.html — no build
// step, no framework, on purpose: this admin UI is served directly by the
// inference-service FastAPI app as static files.

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var Auth = {
  getToken: function () { return localStorage.getItem('is_token'); },
  getUser: function () {
    try { return JSON.parse(localStorage.getItem('is_user') || 'null'); } catch (e) { return null; }
  },
  setSession: function (token, user) {
    localStorage.setItem('is_token', token);
    localStorage.setItem('is_user', JSON.stringify(user));
  },
  clear: function () {
    localStorage.removeItem('is_token');
    localStorage.removeItem('is_user');
  },
  requireAuthOrRedirect: function () {
    if (!Auth.getToken()) {
      window.location.href = 'login.html';
      throw new Error('redirecting');
    }
  },
};

var Api = {
  request: async function (method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = Auth.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var res = await fetch(path, {
      method: method,
      headers: headers,
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });

    // A 401 from the login endpoint itself means "wrong email/password", not
    // "your session expired" — it must fall through to the normal error path
    // below so login.html can show it. Redirecting to login.html here (as for
    // every OTHER 401) was the bug: on the login page that's a same-page
    // reload, wiping out the error message before it could ever be seen —
    // from the user's perspective, submitting the form just silently bounced
    // back to a blank login page.
    var isLoginCall = path === '/api/auth/login';
    if (res.status === 401 && !isLoginCall) {
      Auth.clear();
      window.location.href = 'login.html';
      throw new Error('Session expirée, veuillez vous reconnecter.');
    }

    if (res.status === 204) return null;

    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }

    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && data.error) || ('Erreur HTTP ' + res.status));
    }
    return data;
  },
  get: function (path) { return Api.request('GET', path); },
  post: function (path, body) { return Api.request('POST', path, body); },
  put: function (path, body) { return Api.request('PUT', path, body); },
  patch: function (path, body) { return Api.request('PATCH', path, body); },
  del: function (path) { return Api.request('DELETE', path); },
};
