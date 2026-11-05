/* GA4: fire `download_click` on every download / buy button, with the page and where on
 * the page the button sits (header / inline / footer), so posts can be compared by
 * conversions. A button can set its position explicitly with data-pos="…". */
(function () {
  var MATCH = /#download|apps\.microsoft\.com|\/releases\/|gumroad\.com/i;

  function kind(href) {
    if (/gumroad\.com/i.test(href)) return 'buy';
    if (/apps\.microsoft\.com/i.test(href)) return 'store';
    if (/\/releases\//i.test(href)) return 'direct';
    return 'section';
  }

  function position(a) {
    if (a.dataset.pos) return a.dataset.pos;
    if (a.closest('header, .nav')) return 'header';
    if (a.closest('footer')) return 'footer';
    return 'inline';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || !MATCH.test(a.getAttribute('href'))) return;
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', 'download_click', {
      page: location.pathname,
      position: position(a),
      link_type: kind(a.getAttribute('href')),
      transport_type: 'beacon'
    });
  }, true);
})();
