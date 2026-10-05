// The panel's B / I / S buttons: put (or take off) the marks around the selected
// text of a text box. The marks are the ones the site understands (see richText
// in build.js): **bold**, *italic*, ~~strikethrough~~.
//
//   GavnaFormat.toggle(value, start, end, 'bold' | 'italic' | 'strike')
//     -> { value, start, end }   the new text and the new selection, or null
//                                when nothing is selected
//
// How it works: a mark never reaches across a line, so a selection of several
// lines is handled line by line, and the spaces at the ends of a line stay
// outside the marks (a mark with a space next to it isn't shown). For each line
// it reads every mark that already surrounds the text (whether the selection
// includes them or not), flips the one asked for, and writes all of them back in
// one fixed order (~~ outside, then the stars), so stacking bold, italic and
// strikethrough in any order always gives text the site shows correctly. If
// every selected line already has the mark it is taken off; otherwise it is put
// on the lines that lack it.
// Works in the browser (window.GavnaFormat) and in Node (for the tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GavnaFormat = factory();
})(this, function () {
  'use strict';

  var KINDS = { bold: 1, italic: 1, strike: 1 };
  function isMark(c) { return c === '*' || c === '~'; }
  function count(s, ch) { var n = 0; for (var i = 0; i < s.length; i++) if (s.charAt(i) === ch) n++; return n; }

  // the selected text split by lines, without the spaces at the ends of each
  function lines(v, start, end) {
    var out = [], ls = start;
    for (var i = start; i <= end; i++) {
      if (i === end || v.charAt(i) === '\n') {
        var a = ls, b = i;
        while (a < b && /[ \t\r]/.test(v.charAt(a))) a++;
        while (b > a && /[ \t\r]/.test(v.charAt(b - 1))) b--;
        if (b > a) out.push({ a: a, b: b });
        ls = i + 1;
      }
    }
    return out;
  }

  // One line: where the marks around its text are, and which ones are on.
  //   [l0, l1)  the marks before the text (they may start before the selection)
  //   [r1, r0)  the marks after it (they may end after the selection)
  function read(v, a, b) {
    var l0 = a, l1 = a, r1 = b, r0 = b;
    while (l0 > 0 && isMark(v.charAt(l0 - 1))) l0--;
    while (l1 < b && isMark(v.charAt(l1))) l1++;
    while (r1 > a && isMark(v.charAt(r1 - 1))) r1--;
    while (r0 < v.length && isMark(v.charAt(r0))) r0++;
    var seg = { l0: l0, l1: l1, r1: r1, r0: r0, bold: false, italic: false, strike: false };
    if (l1 >= r1) { seg.l0 = seg.l1 = a; seg.r1 = seg.r0 = b; return seg; } // only marks in there: plain text
    var left = v.slice(l0, l1), right = v.slice(r1, r0);
    var s = count(left, '*'), t = count(left, '~');
    // marks that don't match on both sides aren't ours: treat them as plain text
    if (s !== count(right, '*') || t !== count(right, '~') || s > 3 || (t !== 0 && t !== 2)) {
      seg.l0 = seg.l1 = a; seg.r1 = seg.r0 = b; return seg;
    }
    seg.bold = s >= 2; seg.italic = s % 2 === 1; seg.strike = t === 2;
    return seg;
  }

  function wrap(seg) {
    var stars = seg.bold && seg.italic ? '***' : seg.bold ? '**' : seg.italic ? '*' : '';
    var tilde = seg.strike ? '~~' : '';
    return { left: tilde + stars, right: stars + tilde };
  }

  function toggle(value, start, end, kind) {
    if (!KINDS[kind] || typeof value !== 'string') return null;
    if (start > end) { var t = start; start = end; end = t; }
    var segs = lines(value, start, end).map(function (l) { return read(value, l.a, l.b); });
    if (!segs.length) return null;
    var removing = segs.every(function (s) { return s[kind]; });

    var out = '', at = 0;
    segs.forEach(function (s) {
      s[kind] = !removing;
      var w = wrap(s);
      out += value.slice(at, s.l0);
      s.nl0 = out.length; out += w.left;
      s.nt0 = out.length; out += value.slice(s.l1, s.r1);
      s.nt1 = out.length; out += w.right;
      s.nr0 = out.length;
      at = s.r0;
    });
    out += value.slice(at);

    var first = segs[0], last = segs[segs.length - 1];
    // one line: the selection stays on its text. Several lines: it takes in the
    // marks too, so that pressing the button again sees every line the same way.
    if (segs.length > 1) return { value: out, start: first.nl0, end: last.nr0 };
    return { value: out, start: first.nt0, end: first.nt1 };
  }

  return { toggle: toggle };
});
