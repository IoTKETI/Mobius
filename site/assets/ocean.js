/*
 * Mobius guide site — shared behaviour.
 *
 * Three things: the light/dark toggle, the table-of-contents highlight that
 * follows the reader, and copy buttons on code blocks. Everything degrades to a
 * readable page when JavaScript is off.
 */
(function () {
    'use strict';

    /* ── Theme ──────────────────────────────────────────────────────────── */

    var root = document.documentElement;

    function stored(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function store(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }

    var saved = stored('mobius-theme');
    if (saved === 'light' || saved === 'dark') { root.setAttribute('data-theme', saved); }

    document.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-theme-toggle]');
        if (!btn) { return; }
        var dark = root.getAttribute('data-theme') === 'dark' ||
                   (!root.hasAttribute('data-theme') &&
                    window.matchMedia('(prefers-color-scheme: dark)').matches);
        var next = dark ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        store('mobius-theme', next);
    });

    /* ── Copy buttons ───────────────────────────────────────────────────── */

    var COPY = { ko: ['복사', '복사됨'], en: ['Copy', 'Copied'] };
    var lang = (document.documentElement.lang || 'en').slice(0, 2);
    var words = COPY[lang] || COPY.en;

    Array.prototype.forEach.call(document.querySelectorAll('.code'), function (block) {
        var pre = block.querySelector('pre');
        var head = block.querySelector('.code__head');
        if (!pre || !head || head.querySelector('.copy')) { return; }

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy';
        btn.textContent = words[0];
        head.appendChild(btn);

        btn.addEventListener('click', function () {
            // Comment-only lines are part of the explanation, not the command.
            var text = pre.innerText.replace(/ /g, ' ');
            var done = function () {
                btn.textContent = words[1];
                btn.classList.add('done');
                setTimeout(function () {
                    btn.textContent = words[0];
                    btn.classList.remove('done');
                }, 1600);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () { /* denied */ });
            } else {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); done(); } catch (e) { /* nothing to do */ }
                document.body.removeChild(ta);
            }
        });
    });

    /* ── Table of contents follows the reader ───────────────────────────── */

    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) { return; }

    var byId = {};
    var targets = [];
    links.forEach(function (a) {
        var el = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
        if (el) { byId[el.id] = a; targets.push(el); }
    });

    var visible = new Set();

    function paint() {
        // The topmost visible heading wins; if none is on screen keep the last one.
        var best = null;
        targets.forEach(function (el) {
            if (!visible.has(el.id)) { return; }
            if (!best || el.getBoundingClientRect().top < best.getBoundingClientRect().top) { best = el; }
        });
        if (!best) { return; }
        links.forEach(function (a) { a.classList.remove('is-active'); });
        var link = byId[best.id];
        if (!link) { return; }
        link.classList.add('is-active');
        // Keep the marker inside a scrolled sidebar without yanking the page.
        var toc = link.closest('.toc');
        if (toc && toc.scrollHeight > toc.clientHeight) {
            var lr = link.getBoundingClientRect(), tr = toc.getBoundingClientRect();
            if (lr.top < tr.top + 24 || lr.bottom > tr.bottom - 24) {
                toc.scrollTop += (lr.top - tr.top) - toc.clientHeight / 2;
            }
        }
    }

    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (e.isIntersecting) { visible.add(e.target.id); } else { visible.delete(e.target.id); }
        });
        paint();
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    targets.forEach(function (el) { io.observe(el); });
    paint();
}());
