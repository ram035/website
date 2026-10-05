// Contact form (home page). The page already works without this file: a
// plain form posted to Web3Forms or Netlify Forms (build.js decides). This
// adds three things on top:
//  - a country picker with flags and a search box, drawn over the real
//    <select> (which stays in the form and is what gets sent);
//  - field checks with messages in the page's language;
//  - sending without leaving the page, then a "sent" or "not sent" message.
// Every text comes from the form's data-ui attribute (build.js, CONTACT_UI).
(function () {
  var form = document.getElementById('contact-form');
  if (!form) return;
  var ui = JSON.parse(form.getAttribute('data-ui'));
  var card = form.parentNode;
  var done = card.querySelector('.contact-done');
  var alertBox = form.querySelector('.form-alert');
  var submit = form.querySelector('button[type="submit"]');
  var select = form.querySelector('.country-select');
  var tried = false; // checks show while typing only after the first send
  form.noValidate = true;

  function fill(text, values) {
    return text.replace(/\{(\w+)\}/g, function (m, k) { return values[k] != null ? values[k] : m; });
  }
  function flag(code) {
    return String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65, 0x1F1E6 + code.charCodeAt(1) - 65);
  }
  function plain(s) { // for searching: no accents, no case
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // ------------------------------------------------------------ country picker
  var picker = (function () {
    var options = Array.prototype.slice.call(select.options, 1).map(function (o) {
      return { code: o.getAttribute('data-code'), name: o.textContent, value: o.value, key: plain(o.textContent) };
    });
    var box = document.createElement('div');
    box.className = 'cp';
    box.innerHTML =
      '<button type="button" class="input cp-button" id="cf-country-button" aria-haspopup="listbox" aria-expanded="false">' +
        '<span class="cp-flag flag" aria-hidden="true"></span><span class="cp-label"></span>' +
        '<svg class="cp-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5"/></svg>' +
      '</button>' +
      '<div class="cp-panel" hidden>' +
        '<div class="cp-search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' +
        '<input class="cp-search" type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="cf-country-list" autocomplete="off" spellcheck="false"></div>' +
        '<ul class="cp-list" id="cf-country-list" role="listbox"></ul>' +
      '</div>';
    select.parentNode.insertBefore(box, select);
    select.classList.add('is-enhanced');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var button = box.querySelector('.cp-button');
    var panel = box.querySelector('.cp-panel');
    var search = box.querySelector('.cp-search');
    var list = box.querySelector('.cp-list');
    var label = select.parentNode.querySelector('label');
    label.setAttribute('for', 'cf-country-button');
    label.id = 'cf-country-label';
    list.setAttribute('aria-labelledby', 'cf-country-label');
    search.setAttribute('placeholder', ui.countrySearch);
    search.setAttribute('aria-label', ui.countrySearch);
    button.setAttribute('aria-describedby', 'cf-country-error');

    list.innerHTML = options.map(function (o) {
      return '<li role="option" id="cf-c-' + o.code + '" data-code="' + o.code + '" aria-selected="false">' +
        '<span class="flag" aria-hidden="true">' + flag(o.code) + '</span><span class="cp-name"></span></li>';
    }).join('') + '<li class="cp-empty" role="presentation" hidden></li>';
    var items = Array.prototype.slice.call(list.querySelectorAll('[role="option"]'));
    items.forEach(function (li, i) { li.querySelector('.cp-name').textContent = options[i].name; });
    var empty = list.querySelector('.cp-empty');
    empty.textContent = ui.noCountry;
    var active = -1;

    function shown() { return items.filter(function (li) { return !li.hidden; }); }
    function current() { return options.findIndex(function (o) { return o.value === select.value; }); }
    function paint() {
      var i = current();
      box.querySelector('.cp-flag').textContent = i < 0 ? '' : flag(options[i].code);
      var l = box.querySelector('.cp-label');
      l.textContent = i < 0 ? ui.countryPlaceholder : options[i].name;
      l.classList.toggle('is-placeholder', i < 0);
      items.forEach(function (li, k) { li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    }
    function setActive(i, scroll) {
      if (active >= 0) items[active].classList.remove('is-active');
      active = i;
      if (i < 0) { search.removeAttribute('aria-activedescendant'); return; }
      items[i].classList.add('is-active');
      search.setAttribute('aria-activedescendant', items[i].id);
      if (scroll) items[i].scrollIntoView({ block: 'nearest' });
    }
    function filter(q) {
      q = plain(q.trim());
      items.forEach(function (li, i) {
        var o = options[i];
        li.hidden = !!q && o.key.indexOf(q) < 0 && o.code.toLowerCase() !== q;
      });
      var vis = shown();
      empty.hidden = vis.length > 0;
      // prefer a name that starts with what was typed
      var best = q ? vis.find(function (li) { return options[items.indexOf(li)].key.indexOf(q) === 0; }) || vis[0] : null;
      setActive(best ? items.indexOf(best) : (vis.indexOf(items[current()]) >= 0 ? current() : -1), true);
    }
    function open() {
      if (!panel.hidden) return;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      box.classList.add('is-open');
      search.value = '';
      filter('');
      if (active < 0) list.scrollTop = 0;
      search.focus();
    }
    function close(focusButton) {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      box.classList.remove('is-open');
      if (focusButton) button.focus();
    }
    function choose(i) {
      select.value = options[i].value;
      paint();
      close(true);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function move(step) {
      var vis = shown();
      if (!vis.length) return;
      var at = vis.indexOf(items[active]);
      at = at < 0 ? (step > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, at + step));
      setActive(items.indexOf(vis[at]), true);
    }

    button.addEventListener('click', function () { if (panel.hidden) open(); else close(true); });
    button.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); return; }
      if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); open(); search.value = e.key; filter(e.key);
      }
    });
    search.addEventListener('input', function () { filter(search.value); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'PageDown') { e.preventDefault(); move(8); }
      else if (e.key === 'PageUp') { e.preventDefault(); move(-8); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && !items[active].hidden) choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the search box
    list.addEventListener('click', function (e) {
      var li = e.target.closest('[role="option"]');
      if (li) choose(items.indexOf(li));
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('[role="option"]');
      if (li && items.indexOf(li) !== active) setActive(items.indexOf(li), false);
    });
    document.addEventListener('mousedown', function (e) { if (!box.contains(e.target)) close(false); });
    select.addEventListener('change', paint); // browser autofill sets the <select>
    paint();

    return { focus: function () { button.focus(); }, reset: function () { select.value = ''; paint(); } };
  })();

  // ------------------------------------------------------------ checks
  var fields = {
    name: form.elements.name, country: select, email: form.elements.email,
    phone: form.elements.phone, message: form.elements.message
  };
  Object.keys(fields).forEach(function (k) {
    if (k !== 'country') fields[k].setAttribute('aria-describedby', 'cf-' + k + '-error');
  });

  function problem(k) {
    var v = (fields[k].value || '').trim();
    if (k === 'name') return v.length < 2 ? ui.errName : '';
    if (k === 'country') return v ? '' : ui.errCountry;
    if (k === 'email') return !v ? ui.errEmail : (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : ui.errEmailBad);
    if (k === 'phone') return !v || (/^\+?[\d\s().\-\/]+$/.test(v) && v.replace(/\D/g, '').length >= 6) ? '' : ui.errPhone;
    if (k === 'message') return v ? '' : ui.errMessage;
    return '';
  }
  function show(k, text) {
    var wrap = fields[k].closest('.form-field');
    wrap.classList.toggle('has-error', !!text);
    wrap.querySelector('.field-error').textContent = text;
    var target = k === 'country' ? form.querySelector('.cp-button') : fields[k];
    if (text) target.setAttribute('aria-invalid', 'true'); else target.removeAttribute('aria-invalid');
  }
  function check() {
    var first = null;
    Object.keys(fields).forEach(function (k) {
      var p = problem(k);
      show(k, p);
      if (p && !first) first = k;
    });
    return first;
  }
  Object.keys(fields).forEach(function (k) {
    var ev = k === 'country' ? 'change' : 'input';
    fields[k].addEventListener(ev, function () { if (tried) show(k, problem(k)); });
  });

  // ------------------------------------------------------------ sending
  function busy(on) {
    submit.disabled = on;
    submit.classList.toggle('is-sending', on);
    submit.querySelector('.btn-label').textContent = on ? ui.sending : ui.send;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    tried = true;
    alertBox.hidden = true;
    var first = check();
    if (first) {
      if (first === 'country') picker.focus(); else fields[first].focus();
      return;
    }
    busy(true);
    var stop = new AbortController();
    var timer = setTimeout(function () { stop.abort(); }, 20000);
    // Web3Forms (the message arrives by email) answers JSON with success;
    // Netlify Forms takes the classic form post on the site itself
    var endpoint = form.getAttribute('data-endpoint');
    var request = endpoint
      ? fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
        signal: stop.signal
      }).then(function (res) {
        return res.json().then(function (j) { if (!res.ok || !j.success) throw new Error(j.message || 'HTTP ' + res.status); });
      })
      : fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString(),
        signal: stop.signal
      }).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); });
    request.then(function () {
      var name = fields.name.value.trim().split(/\s+/)[0];
      done.querySelector('p').textContent = fill(ui.sentText, { name: name, email: fields.email.value.trim() });
      form.hidden = true;
      done.hidden = false;
      done.focus();
    }).catch(function () {
      alertBox.querySelector('p').textContent = fill(ui.failText, { email: ui.supportEmail });
      alertBox.hidden = false;
    }).then(function () {
      clearTimeout(timer);
      busy(false);
    });
  });

  done.querySelector('button').addEventListener('click', function () {
    form.reset();
    picker.reset();
    tried = false;
    Object.keys(fields).forEach(function (k) { show(k, ''); });
    done.hidden = true;
    form.hidden = false;
    fields.name.focus();
  });
})();
