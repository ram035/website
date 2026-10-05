// Mobile menu: the ☰ button shows and hides the navigation; picking a link
// closes it again. Drop-downs (Products) open on click - and on hover with a
// mouse, from the CSS - and close with Esc or a click anywhere else.
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  if (!toggle || !nav) return;
  function set(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeDrops(except) {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-drop.is-open'), function (d) {
      if (d === except) return;
      d.classList.remove('is-open');
      d.querySelector('.nav-drop-btn').setAttribute('aria-expanded', 'false');
    });
  }
  toggle.addEventListener('click', function () { set(!nav.classList.contains('is-open')); });
  nav.addEventListener('click', function (e) {
    var btn = e.target.closest('.nav-drop-btn');
    if (btn) {
      var drop = btn.parentNode, open = !drop.classList.contains('is-open');
      closeDrops(drop);
      drop.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    if (e.target.closest('a')) { closeDrops(); set(false); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.nav-drop')) closeDrops(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrops(); });
})();
