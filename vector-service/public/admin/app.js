// Small vanilla-JS helpers shared by login.html and dashboard.html — no build
// step, no framework, on purpose: this admin UI is served directly by the
// quotation-service Express app as static files.

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var Auth = {
  getToken: function () { return localStorage.getItem('qs_token'); },
  getUser: function () {
    try { return JSON.parse(localStorage.getItem('qs_user') || 'null'); } catch (e) { return null; }
  },
  setSession: function (token, user) {
    localStorage.setItem('qs_token', token);
    localStorage.setItem('qs_user', JSON.stringify(user));
  },
  clear: function () {
    localStorage.removeItem('qs_token');
    localStorage.removeItem('qs_user');
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

    if (res.status === 401) {
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
