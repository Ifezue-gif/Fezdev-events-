/*
  Optional enhancement for index.html.
  The site works fully without this file — it only adds two small
  progressive-enhancement touches:
    1. Highlights the current section's nav link while scrolling.
    2. Fades sections in gently as they enter the viewport.

  To use it: keep this file in the same folder as index.html, then
  uncomment the <script src="enhance.js"></script> line near the
  bottom of index.html.
*/

(function () {
  if (!('IntersectionObserver' in window)) return;

  var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = document.querySelectorAll('main section[id]');

  if (sections.length && navLinks.length) {
    var linkFor = {};
    navLinks.forEach(function (link) {
      linkFor[link.getAttribute('href').slice(1)] = link;
    });

    var navObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var link = linkFor[entry.target.id];
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach(function (l) { l.style.color = ''; });
            link.style.color = 'var(--lime)';
          }
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );

    sections.forEach(function (section) { navObserver.observe(section); });
  }

  var revealTargets = document.querySelectorAll('section');
  revealTargets.forEach(function (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  });

  var revealObserver = new IntersectionObserver(
    function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'none';
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  revealTargets.forEach(function (el) { revealObserver.observe(el); });
})();
