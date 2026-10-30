/*
 * AUTOVANT book engine: turns a list of page elements into a book with 3D page turns.
 *
 * Wide screens ("spread" mode): every leaf has a front and a back, so two pages show at once.
 *   Page 0 is the front cover and the last page is the back cover. The page count must be even.
 * Narrow screens ("single" mode): each page is its own leaf and turns away to the left.
 *
 * state = how many leaves have been turned.
 *   spread: 0 = closed front cover, 1..L-1 = open spread (pages 2s-1 and 2s), L = closed back cover
 *   single: state is the index of the page on show
 */
(function () {
  'use strict';
  var h = AV.h;

  function Book(wrap, pages, opts) {
    opts = opts || {};
    this.wrap = wrap;
    this.pages = pages.slice();
    this.spread = !!opts.spread;
    this.turnMs = opts.turnMs == null ? 1000 : opts.turnMs;
    this.onChange = opts.onChange || function () {};
    this.leaves = [];
    this.state = 0;
    this.timers = [];
    this.endTimer = null;

    this.el = h('div', { class: 'book ' + (this.spread ? 'is-spread' : 'is-single'), 'data-pos': 'front' });
    this.el.style.setProperty('--turn', this.turnMs + 'ms');
    this.el.append(h('div', { class: 'book__under book__under--l', 'aria-hidden': 'true' }));
    this.el.append(h('div', { class: 'book__under book__under--r', 'aria-hidden': 'true' }));

    var p = this.pages;
    var i;
    if (this.spread) {
      for (i = 0; i < p.length; i += 2) this.addLeaf(p[i], p[i + 1] || null);
    } else {
      for (i = 0; i < p.length; i++) this.addLeaf(p[i], null);
    }
    this.maxState = this.spread ? this.leaves.length : this.leaves.length - 1;
    wrap.append(this.el);
    this.layout();
  }

  Book.prototype.addLeaf = function (front, back) {
    var leaf = h('div', { class: 'leaf' });
    front.classList.add('page--right');
    leaf.append(h('div', { class: 'leaf__face leaf__face--front' }, front));
    if (back) {
      back.classList.add('page--left');
      leaf.append(h('div', { class: 'leaf__face leaf__face--back' }, back));
    } else {
      leaf.append(h('div', { class: 'leaf__face leaf__face--back leaf__face--blank' }));
    }
    this.leaves.push(leaf);
    this.el.append(leaf);
  };

  Book.prototype.visiblePages = function () {
    var s = this.state;
    var n = this.pages.length;
    if (!this.spread) return [s];
    if (s === 0) return [0];
    if (s === this.leaves.length) return [n - 1];
    return [2 * s - 1, 2 * s];
  };

  Book.prototype.position = function () {
    if (this.state === 0) return 'front';
    if (this.spread && this.state === this.leaves.length) return 'back';
    return 'open';
  };

  // Put every leaf in its resting place. Called after each change and after the animation ends.
  Book.prototype.layout = function () {
    var L = this.leaves.length;
    var s = this.state;
    var visible = this.visiblePages();
    // Only leaves near the reader are drawn. Every leaf is its own 3D layer, and a magazine
    // with dozens of them at once runs a phone out of memory.
    var near = this.spread ? 3 : 2;
    this.leaves.forEach(function (leaf, k) {
      leaf.classList.toggle('flipped', k < s);
      leaf.style.zIndex = String(k < s ? k : L - k);
      leaf.style.display = Math.abs(k - s) <= near ? '' : 'none';
    });
    this.pages.forEach(function (page, i) {
      var on = visible.indexOf(i) > -1;
      page.inert = !on;
      page.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    this.el.setAttribute('data-pos', this.position());
  };

  Book.prototype.later = function (fn, ms) {
    var t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  };

  Book.prototype.flip = function (i, forward) {
    var L = this.leaves.length;
    var leaf = this.leaves[i];
    if (!leaf) return;
    leaf.style.zIndex = String(L + 10 + (forward ? i : L - i));
    leaf.classList.add('turning');
    leaf.classList.toggle('flipped', forward);
    this.later(function () { leaf.classList.remove('turning'); }, this.turnMs);
  };

  Book.prototype.goTo = function (target, animate) {
    target = Math.max(0, Math.min(this.maxState, target));
    if (target === this.state) return;
    var from = this.state;
    this.state = target;

    clearTimeout(this.endTimer);
    var self = this;

    // A long jump would have to draw every leaf in between: skip the animation instead.
    if (Math.abs(target - from) > 3) animate = false;

    if (!animate || this.turnMs === 0) {
      this.layout();
      this.onChange(this);
      return;
    }

    var forward = target > from;
    for (var q = Math.min(from, target) - 1; q <= Math.max(from, target) + 1; q++) {
      if (this.leaves[q]) this.leaves[q].style.display = '';
    }
    var order = [];
    var k;
    if (forward) { for (k = from; k < target; k++) order.push(k); }
    else { for (k = from - 1; k >= target; k--) order.push(k); }

    var stagger = order.length > 1 ? Math.min(150, 800 / order.length) : 0;
    order.forEach(function (leafIndex, n) {
      self.later(function () { self.flip(leafIndex, forward); }, n * stagger);
    });

    // Move the book and hide the pages that are no longer on show right away.
    var visible = this.visiblePages();
    this.pages.forEach(function (page, i) {
      var on = visible.indexOf(i) > -1;
      page.inert = !on;
      page.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    this.el.setAttribute('data-pos', this.position());

    this.endTimer = setTimeout(function () { self.layout(); }, this.turnMs + (order.length - 1) * stagger + 60);
    this.onChange(this);
  };

  Book.prototype.next = function () { this.goTo(this.state + 1, true); };
  Book.prototype.prev = function () { this.goTo(this.state - 1, true); };

  // The state that shows a given page.
  Book.prototype.stateForPage = function (index) {
    if (!this.spread) return Math.max(0, Math.min(index, this.pages.length - 1));
    if (index <= 0) return 0;
    if (index >= this.pages.length - 1) return this.leaves.length;
    return Math.ceil(index / 2);
  };

  Book.prototype.goToPage = function (index, animate) { this.goTo(this.stateForPage(index), animate); };

  Book.prototype.destroy = function () {
    this.timers.forEach(clearTimeout);
    clearTimeout(this.endTimer);
    this.el.remove();
  };

  AV.Book = Book;
})();
