(function () {
  'use strict';
  var P = window.PORTAL || {};
  var L = P.links || {};
  var API = String(P.api || '').replace(/\/+$/, '');
  var FACT = {};
  (P.factions || []).forEach(function (f) { FACT[f.id] = f; });

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDate(d) {
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : d;
  }
  function fmtTs(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function tgChip(nick, extra) {
    var n = String(nick).replace(/[^A-Za-z0-9_]/g, '');
    return '<a class="chip' + (extra ? ' ' + extra : '') + '" href="https://t.me/' + n + '" target="_blank" rel="noopener">@' + esc(n) + '</a>';
  }
  function facLabel(id) { var f = FACT[id]; return f ? f.icon + ' ' + esc(f.name) : esc(id || '—'); }
  function viewActive(name) { var v = document.querySelector('[data-view="' + name + '"]'); return v && v.classList.contains('active'); }
  function reveal(root) { root.querySelectorAll('.card, .row').forEach(function (el) { el.classList.add('in'); }); }

  // ---- Повідомлення ----
  var toastTimer;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind === 'err' ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
  }

  // ---- Стан входу ----
  var S = { token: '', me: null, apps: [] };
  try { S.token = localStorage.getItem('brp_token') || ''; } catch (e) {}
  function setToken(t) {
    S.token = t || '';
    try { if (t) localStorage.setItem('brp_token', t); else localStorage.removeItem('brp_token'); } catch (e) {}
  }
  function isAdmin() { return !!(S.me && (S.me.role === 'admin' || S.me.role === 'owner')); }
  function isOwner() { return !!(S.me && S.me.role === 'owner'); }
  function logout() { setToken(''); S.me = null; S.apps = []; ADM = null; updateNav(); }

  function api(path, body) {
    if (!API) return Promise.reject(new Error('Сервер ще не підключено'));
    var opts = { method: body === undefined ? 'GET' : 'POST', headers: {} };
    if (S.token) opts.headers.Authorization = 'Bearer ' + S.token;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var err = new Error(d.error || 'Помилка сервера');
          err.status = r.status;
          if (S.me && (r.status === 401 || d.banned)) { logout(); renderAccount(); renderFactions(); }
          throw err;
        }
        return d;
      });
    }, function () { throw new Error('Немає зв\'язку з сервером. Спробуйте пізніше'); });
  }
  function loadMe() {
    return api('/api/me').then(function (d) { S.me = d.user; S.apps = d.apps || []; });
  }
  function updateNav() {
    $('navAdmin').hidden = !isAdmin();
  }

  // ---- Кнопки з посиланнями ----
  function setLink(id, url, offText) {
    var el = $(id);
    if (!el) return;
    if (url) { el.href = url; return; }
    if (offText) { el.textContent = offText; el.classList.add('is-off'); el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
    else { el.hidden = true; }
  }
  setLink('btn-roblox', L.roblox);
  setLink('btn-telegram', L.telegram);
  setLink('btn-discord', L.discord);
  setLink('btn-rules', L.rules, 'Правила скоро');

  // ---- Публічні дані (склад фракцій, лідери, адміністрація) ----
  var pub = { members: {}, leaders: {}, staff: [] };
  function loadPublic() {
    if (!API) return Promise.resolve();
    return api('/api/state').then(function (d) {
      pub = { members: d.members || {}, leaders: d.leaders || {}, staff: d.staff || [] };
      renderFactions();
      renderTeam();
    }).catch(function () {});
  }

  // ---- Фракції ----
  var grid = $('factionGrid');
  function renderFactions() {
    grid.innerHTML = '';
    (P.factions || []).forEach(function (f) {
      var mem = pub.members[f.id] || [];
      var leader = pub.leaders[f.id];
      var mine = S.me && S.me.faction === f.id;
      var pending = (S.apps || []).some(function (a) { return a.status === 'pending' && a.faction === f.id; });
      var btn;
      if (!API) btn = '<span class="btn btn-ghost btn-small is-off">Анкета скоро</span>';
      else if (mine) btn = '<span class="btn btn-ghost btn-small is-off">Ви у цій фракції</span>';
      else if (pending) btn = '<span class="btn btn-ghost btn-small is-off">Анкета на розгляді</span>';
      else btn = '<button type="button" class="btn btn-primary btn-small" data-apply="' + esc(f.id) + '">Подати анкету</button>';

      var card = document.createElement('article');
      card.className = 'card';
      card.innerHTML =
        '<div class="card-head">' +
          '<div class="card-icon" aria-hidden="true">' + f.icon + '</div>' +
          '<div class="card-info">' +
            '<h3>' + esc(f.name) + '</h3>' +
            '<p class="full">' + esc(f.full) + '</p>' +
            '<p class="leader">👑 Лідер: ' + (leader ? tgChip(leader, 'leader-chip') : '<span class="muted">не призначено</span>') + '</p>' +
          '</div>' +
        '</div>' +
        '<p class="text">' + esc(f.text) + '</p>' +
        '<div class="members">' +
          '<div class="members-title">Склад фракції: <b>' + mem.length + '</b></div>' +
          '<div class="people">' + (mem.length ? mem.map(function (n) { return tgChip(n); }).join('') : '<span class="muted">Поки нікого. Стань першим!</span>') + '</div>' +
        '</div>' + btn;
      grid.appendChild(card);
    });
    if (viewActive('factions')) reveal(grid);
  }
  grid.addEventListener('click', function (e) {
    var b = e.target.closest('[data-apply]');
    if (b) openApply(b.getAttribute('data-apply'));
  });

  // ---- Команда ----
  var team = $('teamList');
  function renderTeam() {
    team.innerHTML = '';
    (P.team || []).forEach(function (t, i) {
      var row = document.createElement('div');
      row.className = 'row' + (i < 2 ? ' top' : '');
      var list = (t.people || []).map(function (u) {
        return tgChip(String(u).replace(/^@/, '').replace(/[<>"']/g, ''));
      });
      var empty = Math.max((t.slots || 1) - list.length, list.length ? 0 : 1);
      for (var k = 0; k < empty; k++) list.push('<span class="chip empty">@юзернейм</span>');
      row.innerHTML = '<div class="role">' + esc(t.role) + '</div><div class="people">' + list.join('') + '</div>';
      team.appendChild(row);
    });
    if (pub.staff.length) {
      var row2 = document.createElement('div');
      row2.className = 'row top';
      row2.innerHTML = '<div class="role">Адміністрація порталу</div><div class="people">' +
        pub.staff.map(function (s) { return tgChip(s.nick, s.role === 'owner' ? 'owner-chip' : ''); }).join('') + '</div>';
      team.appendChild(row2);
    }
    if (viewActive('team')) reveal(team);
  }
  renderFactions();
  renderTeam();

  // ---- Новини (найсвіжіша зверху) ----
  var newsBox = $('newsList');
  var news = (P.news || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  if (!news.length) {
    newsBox.innerHTML = '<div class="empty-box">Новин поки немає. Перша з\'явиться тут.</div>';
  } else {
    news.forEach(function (n, i) {
      var a = document.createElement('article');
      a.className = 'news-item' + (i === 0 ? ' newest' : '');
      a.innerHTML = '<div class="news-meta">' + (i === 0 ? '<span class="badge">Нове</span>' : '') +
        '<time>' + esc(fmtDate(n.date)) + '</time></div><h3>' + esc(n.title) + '</h3><p>' + esc(n.text) + '</p>';
      newsBox.appendChild(a);
    });
  }

  // ---- Зірки ----
  var stars = $('stars');
  if (stars) {
    for (var i = 0; i < 70; i++) {
      var s = document.createElement('i');
      s.className = 'star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 70 + '%';
      s.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
      s.style.animationDuration = (2.5 + Math.random() * 3).toFixed(2) + 's';
      stars.appendChild(s);
    }
  }

  // ---- Меню на телефоні ----
  var toggle = document.querySelector('.nav-toggle');
  var menu = $('menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { menu.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
    });
  }

  // =====================================================
  //  КАБІНЕТ: реєстрація, вхід, профіль
  // =====================================================
  var authTab = 'login';
  var ROLE = { owner: 'Власник', admin: 'Адміністратор', player: 'Гравець' };
  var ST = { pending: 'На розгляді', approved: 'Схвалено', rejected: 'Відхилено' };
  var accBox = $('accountBox');

  function notice(t) { return '<div class="empty-box">' + esc(t) + '</div>'; }

  function renderAccount() {
    if (!API) { accBox.innerHTML = notice('Реєстрація ще не підключена. Адміністрація налаштовує сервер.'); return; }
    if (S.me) renderProfile(); else renderAuth();
  }

  function renderAuth() {
    var reg = authTab === 'reg';
    accBox.innerHTML =
      '<div class="tabs">' +
        '<button type="button" class="tab' + (!reg ? ' on' : '') + '" data-tab="login">Вхід</button>' +
        '<button type="button" class="tab' + (reg ? ' on' : '') + '" data-tab="reg">Реєстрація</button>' +
      '</div>' +
      '<form class="panel auth" id="authForm" novalidate>' +
        '<div class="field"><label for="a-tg">Нік у Telegram</label>' +
          '<input class="inp" id="a-tg" name="tg" placeholder="@your_username" autocomplete="username" autocapitalize="off" spellcheck="false" required>' +
          (reg ? '<span class="hint">Той самий нік, що в Telegram: латиниця, цифри та _ (5–32 символи).</span>' : '') + '</div>' +
        '<div class="field"><label for="a-pw">Пароль</label>' +
          '<input class="inp" id="a-pw" name="password" type="password" autocomplete="' + (reg ? 'new-password' : 'current-password') + '" required>' +
          (reg ? '<span class="hint">Від 6 символів. Не використовуй пароль від інших сайтів: адміністрація бачить паролі гравців.</span>' : '') + '</div>' +
        (reg ? '<div class="field"><label for="a-pw2">Повтори пароль</label><input class="inp" id="a-pw2" name="password2" type="password" autocomplete="new-password" required></div>' : '') +
        '<p class="msg" id="authMsg" hidden></p>' +
        '<button class="btn btn-primary" type="submit">' + (reg ? 'Зареєструватись' : 'Увійти') + '</button>' +
      '</form>';
  }

  function renderProfile() {
    var m = S.me;
    var apps = (S.apps || []).map(function (a) {
      return '<div class="arow"><div><b>' + facLabel(a.faction) + '</b> <span class="tag st-' + esc(a.status) + '">' + (ST[a.status] || a.status) + '</span></div>' +
        '<time>' + esc(fmtTs(a.created)) + '</time>' +
        (a.note ? '<p class="note">Коментар адміністрації: ' + esc(a.note) + '</p>' : '') + '</div>';
    }).join('');
    accBox.innerHTML =
      '<div class="panel auth">' +
        '<h3 class="ph">@' + esc(m.nick) + '</h3>' +
        '<p><span class="tag role-' + esc(m.role) + '">' + (ROLE[m.role] || 'Гравець') + '</span></p>' +
        '<p>Фракція: <b>' + (m.faction ? facLabel(m.faction) : 'ще не обрано') + '</b></p>' +
        '<h4 class="sub">Мої анкети</h4>' +
        (apps || '<p class="muted">Ви ще не подавали анкет.</p>') +
        '<div class="btns">' +
          (m.faction ? '' : '<a class="btn btn-primary btn-small" href="#factions">Обрати фракцію</a>') +
          (isAdmin() ? '<a class="btn btn-ghost btn-small" href="#admin">Адмін-панель</a>' : '') +
          '<button type="button" class="btn btn-ghost btn-small" data-logout>Вийти</button>' +
        '</div>' +
      '</div>';
  }

  accBox.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (t) { authTab = t.getAttribute('data-tab'); renderAuth(); return; }
    if (e.target.closest('[data-logout]')) { logout(); renderAccount(); renderFactions(); toast('Ви вийшли з акаунта'); }
  });
  accBox.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var msg = $('authMsg');
    var reg = authTab === 'reg';
    function say(t) { msg.textContent = t; msg.hidden = false; }
    var tg = f.elements.tg.value.trim().replace(/^@/, '');
    var pw = f.elements.password.value;
    if (!/^[A-Za-z0-9_]{5,32}$/.test(tg)) { say('Нік у Telegram: 5–32 символи, лише латиниця, цифри та _'); return; }
    if (pw.length < 6) { say('Пароль має бути від 6 символів'); return; }
    if (reg && pw !== f.elements.password2.value) { say('Паролі не збігаються'); return; }
    var btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    msg.hidden = true;
    api(reg ? '/api/register' : '/api/login', { tg: tg, password: pw }).then(function (d) {
      setToken(d.token);
      S.me = d.user;
      return loadMe();
    }).then(function () {
      updateNav(); renderAccount(); renderFactions();
      toast('Вітаємо, @' + S.me.nick + '!');
    }).catch(function (err) { btn.disabled = false; say(err.message); });
  });

  // =====================================================
  //  АНКЕТА (вікно)
  // =====================================================
  var modal = $('modal'), modalBody = $('modalBody');
  function closeModal() { modal.hidden = true; document.body.style.overflow = ''; }
  $('modalX').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  function openApply(fid) {
    var f = FACT[fid];
    if (!f) return;
    if (!S.me) { toast('Спочатку увійдіть або зареєструйтесь', 'err'); location.hash = '#account'; return; }
    if (S.me.faction) { toast('Ви вже перебуваєте у фракції', 'err'); return; }
    if ((S.apps || []).some(function (a) { return a.status === 'pending'; })) { toast('У вас уже є анкета на розгляді', 'err'); return; }
    var qs = (P.commonQuestions || []).concat((f.questions || []).map(function (q) { return { q: q }; }));
    var html = '<h3 id="modalTitle" class="ph">' + f.icon + ' Анкета: ' + esc(f.name) + '</h3>' +
      '<p class="hint">' + esc(f.full) + '. Відповідай чесно й розгорнуто, усі поля обов\'язкові.</p>' +
      '<form id="applyForm" novalidate>';
    qs.forEach(function (q, i) {
      html += '<div class="field"><label for="q' + i + '">' + (i + 1) + '. ' + esc(q.q) + '</label>' +
        (q.short ? '<input class="inp" id="q' + i + '" maxlength="200">' : '<textarea class="inp" id="q' + i + '" maxlength="1500" rows="3"></textarea>') + '</div>';
    });
    html += '<p class="msg" id="applyMsg" hidden></p>' +
      '<div class="btns"><button class="btn btn-primary" type="submit">Надіслати анкету</button>' +
      '<button class="btn btn-ghost" type="button" id="applyCancel">Скасувати</button></div></form>';
    modalBody.innerHTML = html;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.modal-box').scrollTop = 0;
    $('applyCancel').addEventListener('click', closeModal);
    $('applyForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('applyMsg');
      var answers = [], bad = false;
      qs.forEach(function (q, i) {
        var v = $('q' + i).value.trim();
        if (!v) bad = true;
        answers.push({ q: q.q, a: v });
      });
      if (bad) { msg.textContent = 'Заповніть усі поля анкети'; msg.hidden = false; return; }
      var btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      api('/api/apply', { faction: fid, answers: answers }).then(function () { return loadMe(); }).then(function () {
        closeModal(); renderFactions(); renderAccount();
        toast('Анкету надіслано! Очікуйте рішення адміністрації.');
        location.hash = '#account';
      }).catch(function (err) { btn.disabled = false; msg.textContent = err.message; msg.hidden = false; });
    });
  }

  // =====================================================
  //  АДМІН-ПАНЕЛЬ
  // =====================================================
  var ADM = null, admTab = 'apps', admQ = '';
  var admBox = $('adminBox');

  function loadAdmin() {
    if (!isAdmin()) { admBox.innerHTML = notice('Немає доступу.'); return; }
    admBox.innerHTML = notice('Завантаження…');
    api('/api/admin/data').then(function (d) { ADM = d; renderAdmin(); })
      .catch(function (err) { admBox.innerHTML = notice(err.message); });
  }
  function admDo(path, body, okMsg) {
    return api(path, body).then(function () {
      toast(okMsg || 'Готово');
      return api('/api/admin/data');
    }).then(function (d) { ADM = d; renderAdmin(); loadPublic(); })
      .catch(function (err) { toast(err.message, 'err'); });
  }

  function renderAdmin() {
    if (!ADM) return;
    var pend = ADM.apps.filter(function (a) { return a.status === 'pending'; }).length;
    admBox.innerHTML =
      '<div class="tabs">' +
        '<button type="button" class="tab' + (admTab === 'apps' ? ' on' : '') + '" data-atab="apps">Заявки' + (pend ? ' <b class="count">' + pend + '</b>' : '') + '</button>' +
        '<button type="button" class="tab' + (admTab === 'players' ? ' on' : '') + '" data-atab="players">Гравці <b class="count">' + ADM.users.length + '</b></button>' +
        '<button type="button" class="tab' + (admTab === 'factions' ? ' on' : '') + '" data-atab="factions">Фракції й лідери</button>' +
      '</div><div id="admBody"></div>';
    if (admTab === 'apps') renderAdmApps();
    else if (admTab === 'players') renderAdmPlayers();
    else renderAdmFactions();
  }

  function renderAdmApps() {
    var body = $('admBody');
    var pend = ADM.apps.filter(function (a) { return a.status === 'pending'; });
    var done = ADM.apps.filter(function (a) { return a.status !== 'pending'; }).sort(function (a, b) { return String(b.decided).localeCompare(String(a.decided)); }).slice(0, 40);
    var h = '<h3 class="sub">Нові заявки</h3>';
    if (!pend.length) h += '<div class="empty-box">Нових заявок немає.</div>';
    pend.forEach(function (a) {
      h += '<article class="panel app" data-id="' + a.id + '">' +
        '<div class="app-top"><div><b>' + tgChip(a.nick) + '</b> → ' + facLabel(a.faction) + '</div><time>' + esc(fmtTs(a.created)) + '</time></div>' +
        '<dl class="qa">' + a.answers.map(function (x) { return '<dt>' + esc(x.q) + '</dt><dd>' + esc(x.a) + '</dd>'; }).join('') + '</dl>' +
        '<input class="inp note-inp" placeholder="Коментар гравцю (необов\'язково)" maxlength="300">' +
        '<div class="btns">' +
          '<button type="button" class="btn btn-primary btn-small" data-act="approve">Схвалити</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-act="reject">Відхилити</button>' +
        '</div></article>';
    });
    h += '<h3 class="sub">Історія рішень</h3>';
    if (!done.length) h += '<p class="muted">Поки порожньо.</p>';
    done.forEach(function (a) {
      h += '<div class="arow"><div>' + tgChip(a.nick) + ' → ' + facLabel(a.faction) + ' <span class="tag st-' + esc(a.status) + '">' + (ST[a.status] || '') + '</span></div>' +
        '<time>' + esc(fmtTs(a.decided)) + (a.by ? ' · @' + esc(a.by) : '') + '</time>' +
        (a.note ? '<p class="note">' + esc(a.note) + '</p>' : '') + '</div>';
    });
    body.innerHTML = h;
  }

  function renderAdmPlayers() {
    $('admBody').innerHTML =
      '<div class="field"><input class="inp" id="admSearch" type="search" placeholder="Пошук за ніком…" value="' + esc(admQ) + '"></div>' +
      '<div id="plist"></div>';
    renderPList();
  }
  function renderPList() {
    var q = admQ.trim().toLowerCase().replace(/^@/, '');
    var users = ADM.users.filter(function (u) { return !q || u.nick.toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return a.nick.toLowerCase() < b.nick.toLowerCase() ? -1 : 1; });
    var owner = isOwner();
    var h = users.length ? '' : '<div class="empty-box">Нікого не знайдено.</div>';
    users.forEach(function (u) {
      var protectedRole = u.role === 'owner' || (u.role === 'admin' && !owner);
      var opts = '<option value="">— без фракції —</option>' + (P.factions || []).map(function (f) {
        return '<option value="' + esc(f.id) + '"' + (u.faction === f.id ? ' selected' : '') + '>' + esc(f.icon + ' ' + f.name) + '</option>';
      }).join('');
      h += '<div class="prow' + (u.banned ? ' is-banned' : '') + '" data-nick="' + esc(u.nick) + '">' +
        '<div><b>@' + esc(u.nick) + '</b> <span class="tag role-' + esc(u.role) + '">' + (ROLE[u.role] || 'Гравець') + '</span>' +
          (u.banned ? ' <span class="tag st-rejected">Бан</span>' : '') +
          (u.banned && u.banReason ? '<div class="hint">Причина: ' + esc(u.banReason) + '</div>' : '') + '</div>' +
        (owner ? '<div class="pw">Пароль: <code>' + esc(u.password || '—') + '</code></div>' : '<div class="pw muted">Пароль приховано</div>') +
        '<div><select class="inp" data-act="setfac" aria-label="Фракція">' + opts + '</select></div>' +
        '<div class="btns tight">' +
          (protectedRole ? '' : (u.banned
            ? '<button type="button" class="btn btn-ghost btn-small" data-act="unban">Розбанити</button>'
            : '<button type="button" class="btn btn-danger btn-small" data-act="ban">Забанити</button>')) +
          (owner && u.role !== 'owner'
            ? '<button type="button" class="btn btn-ghost btn-small" data-act="role" data-role="' + (u.role === 'admin' ? 'player' : 'admin') + '">' + (u.role === 'admin' ? 'Зняти адміна' : 'Зробити адміном') + '</button>' : '') +
        '</div></div>';
    });
    $('plist').innerHTML = h;
  }

  function renderAdmFactions() {
    var h = '<p class="section-lead">Нік лідера показується на картці фракції на сайті. Лідером можна призначити будь-кого за ніком у Telegram.</p>';
    (P.factions || []).forEach(function (f) {
      var mem = ADM.users.filter(function (u) { return u.faction === f.id; });
      h += '<article class="panel fac" data-fac="' + esc(f.id) + '">' +
        '<div class="app-top"><b class="fac-name">' + esc(f.icon + ' ' + f.name) + '</b><span class="muted">Учасників: ' + mem.length + '</span></div>' +
        '<div class="leader-edit"><input class="inp leader-inp" placeholder="@нік лідера" maxlength="33" value="' + esc(ADM.leaders[f.id] ? '@' + ADM.leaders[f.id] : '') + '" aria-label="Лідер ' + esc(f.name) + '">' +
        '<button type="button" class="btn btn-primary btn-small" data-act="leader">Зберегти</button></div>' +
        '<div class="people">' + (mem.length ? mem.map(function (u) {
          return '<span class="chip">@' + esc(u.nick) + ' <button type="button" class="chip-x" data-act="rmfac" data-nick="' + esc(u.nick) + '" title="Виключити з фракції" aria-label="Виключити @' + esc(u.nick) + '">×</button></span>';
        }).join('') : '<span class="muted">Склад порожній</span>') + '</div></article>';
    });
    $('admBody').innerHTML = h;
  }

  admBox.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-atab]');
    if (tab) { admTab = tab.getAttribute('data-atab'); renderAdmin(); return; }
    var b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    var act = b.getAttribute('data-act');
    var appEl = b.closest('.app'), rowEl = b.closest('.prow'), facEl = b.closest('.fac');
    if (act === 'approve' || act === 'reject') {
      var note = appEl.querySelector('.note-inp').value.trim();
      b.disabled = true;
      admDo('/api/admin/decide', { id: Number(appEl.getAttribute('data-id')), decision: act, note: note }, act === 'approve' ? 'Анкету схвалено, гравця додано у фракцію' : 'Анкету відхилено');
    } else if (act === 'ban') {
      var reason = window.prompt('Причина бану (можна залишити порожньою):', '');
      if (reason === null) return;
      admDo('/api/admin/ban', { nick: rowEl.getAttribute('data-nick'), banned: true, reason: reason }, 'Гравця заблоковано');
    } else if (act === 'unban') {
      admDo('/api/admin/ban', { nick: rowEl.getAttribute('data-nick'), banned: false }, 'Гравця розблоковано');
    } else if (act === 'role') {
      admDo('/api/admin/role', { nick: rowEl.getAttribute('data-nick'), role: b.getAttribute('data-role') }, 'Роль змінено');
    } else if (act === 'leader') {
      admDo('/api/admin/leader', { faction: facEl.getAttribute('data-fac'), leader: facEl.querySelector('.leader-inp').value.trim() }, 'Лідера збережено');
    } else if (act === 'rmfac') {
      admDo('/api/admin/setfaction', { nick: b.getAttribute('data-nick'), faction: '' }, 'Гравця виключено з фракції');
    }
  });
  admBox.addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-act="setfac"]');
    if (!sel) return;
    admDo('/api/admin/setfaction', { nick: sel.closest('.prow').getAttribute('data-nick'), faction: sel.value }, 'Фракцію змінено');
  });
  admBox.addEventListener('input', function (e) {
    if (e.target.id === 'admSearch') { admQ = e.target.value; renderPList(); }
  });

  // =====================================================
  //  Розділи: один за раз
  // =====================================================
  var views = document.querySelectorAll('.view');
  var navLinks = document.querySelectorAll('[data-nav]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var booted = !S.token;

  function show(name) {
    var found = false;
    views.forEach(function (v) { if (v.dataset.view === name) found = true; });
    if (!found) name = 'home';
    if (name === 'admin' && booted && !isAdmin()) name = 'account';
    views.forEach(function (v) {
      var on = v.dataset.view === name;
      v.classList.toggle('active', on);
      if (on) {
        var items = v.querySelectorAll('.reveal, .card, .row, .news-item');
        items.forEach(function (el) { el.classList.remove('in'); });
        void v.offsetWidth;
        items.forEach(function (el, i) {
          setTimeout(function () { el.classList.add('in'); }, reduce ? 0 : 80 + i * 60);
        });
      }
    });
    navLinks.forEach(function (a) { a.classList.toggle('current', a.dataset.nav === name); });
    window.scrollTo({ top: 0, behavior: 'instant' });
    var link = document.querySelector('[data-nav="' + name + '"]');
    document.title = name === 'home' ? 'Буковель РП' : (link ? link.textContent : name) + ' | Буковель РП';

    if (name === 'account') renderAccount();
    if (name === 'admin') loadAdmin();
    if (name === 'factions' || name === 'team') loadPublic();
  }

  function route() { show((location.hash || '#home').replace('#', '')); }
  window.addEventListener('hashchange', route);
  route();

  // ---- Запуск: перевіряємо збережений вхід, тягнемо склад фракцій ----
  loadPublic();
  if (S.token && API) {
    loadMe().catch(function (err) { S.me = null; if (err.status === 401) setToken(''); }).then(function () {
      booted = true;
      updateNav(); renderFactions(); route();
    });
  } else {
    booted = true;
  }
})();
