// Lottie animations in "Portada" blocks (played by lottie-light.js -
// lottie-web, MIT, license in lottie-web-LICENSE.md). Each one is a
// <div class="hero-art-anim" data-anim="ID"> with its animation in
// <script type="application/json" id="ID">. With data-glow="galaxy", the
// layer whose name has "galaxy" gets a glow: an SVG filter (a strong white
// rim, short falloff). Animations stand still for people who ask their system
// for less motion, and pause while off screen.
(function () {
  if (!window.lottie) return;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  function node(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.hero-art-anim[data-anim]'), function (box, n) {
    var src = document.getElementById(box.getAttribute('data-anim'));
    if (!src) return;
    var data;
    try { data = JSON.parse(src.textContent); } catch (err) { return; }
    var glow = box.getAttribute('data-glow');
    var filterId = 'anim-glow-' + n;

    // tag the glowing layer so it can be found in the drawn SVG
    if (glow) {
      var match = new RegExp(glow, 'i');
      (data.assets || []).forEach(function (a) {
        (a.layers || []).forEach(function (l) { if (match.test(l.nm || '')) l.cl = 'anim-glow'; });
      });
      (data.layers || []).forEach(function (l) { if (match.test(l.nm || '')) l.cl = 'anim-glow'; });
    }

    var anim = window.lottie.loadAnimation({
      container: box, renderer: 'svg', loop: true, autoplay: !still, animationData: data,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
    });

    anim.addEventListener('DOMLoaded', function () {
      var svg = box.querySelector('svg');
      var target = glow && svg && svg.querySelector('.anim-glow');
      if (target) {
        var defs = svg.querySelector('defs') || svg.insertBefore(node('defs', {}), svg.firstChild);
        var f = node('filter', { id: filterId, x: '-60%', y: '-60%', width: '220%', height: '220%', 'color-interpolation-filters': 'sRGB' }, defs);
        // a tight, bright white rim hugging the shape, over a short soft falloff
        node('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '2.6', result: 'nearBlur' }, f);
        node('feFlood', { 'flood-color': '#ffffff', 'flood-opacity': '1', result: 'white' }, f);
        node('feComposite', { in: 'white', in2: 'nearBlur', operator: 'in', result: 'rim' }, f);
        node('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '6.5', result: 'farBlur' }, f);
        node('feFlood', { 'flood-color': '#ffffff', 'flood-opacity': '0.75', result: 'white2' }, f);
        node('feComposite', { in: 'white2', in2: 'farBlur', operator: 'in', result: 'soft' }, f);
        var merge = node('feMerge', {}, f);
        ['soft', 'rim', 'rim', 'rim', 'SourceGraphic'].forEach(function (i) { node('feMergeNode', { in: i }, merge); });
        target.setAttribute('filter', 'url(#' + filterId + ')');
        // Lottie clips every composition to its frame; the glow reaches past it
        for (var g = target; g && g !== svg; g = g.parentNode) g.removeAttribute('clip-path');
      }
      box.classList.add('is-ready');
      if (still) anim.goToAndStop(0, true);
    });

    if (!still && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) anim.play(); else anim.pause();
      }).observe(box);
    }
  });
})();
