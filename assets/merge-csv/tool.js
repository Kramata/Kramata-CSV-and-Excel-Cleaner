/* Kramata free CSV merge tool: page UI. Everything runs in the browser; files are never sent anywhere.
 * Papa Parse (assets/vendor) is loaded only once the user adds files. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.KramataMerge;
  var SOFT_LIMIT = 300 * 1024 * 1024;
  var STORE = 'https://apps.microsoft.com/detail/9PH81XKFZ77D?cid=website';
  var files = [], result = null, papa = null, busy = false;

  var drop = $('mt-drop'), input = $('mt-input'), list = $('mt-list'), status = $('mt-status');
  var go = $('mt-go'), out = $('mt-result');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function size(n) {
    return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  }
  function num(n) { return n.toLocaleString('en-US'); }

  function loadPapa() {
    if (!papa) papa = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/vendor/papaparse.min.js';
      s.onload = function () { window.Papa ? resolve(window.Papa) : reject(new Error('no Papa')); };
      s.onerror = function () { papa = null; reject(new Error("Couldn't load the CSV reader. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
    return papa;
  }

  function addFiles(fileList) {
    var notes = [];
    Array.prototype.forEach.call(fileList || [], function (f) {
      if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) { notes.push(f.name + ': Excel files aren’t supported here (the Kramata desktop app opens them).'); return; }
      if (!/\.(csv|txt|tsv)$/i.test(f.name)) { notes.push(f.name + ': not a .csv or .txt file, so it was skipped.'); return; }
      if (files.some(function (g) { return g.name === f.name && g.size === f.size && g.lastModified === f.lastModified; })) return;
      files.push(f);
    });
    if (files.length) loadPapa().catch(function () {}); // warm up the parser while the user looks at the list
    render(notes);
  }

  function render(notes) {
    if (!files.length) list.innerHTML = '<li class="mt-empty">No files yet. Add two or more CSV files.</li>';
    else list.innerHTML = files.map(function (f, i) {
      return '<li><span class="mt-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="mt-size">' + size(f.size) +
        '</span><button type="button" class="mt-x" data-i="' + i + '" aria-label="Remove ' + esc(f.name) + '">×</button></li>';
    }).join('');
    var total = files.reduce(function (a, f) { return a + f.size; }, 0), msg = [];
    if (files.length) msg.push(files.length + ' file' + (files.length > 1 ? 's' : '') + ', ' + size(total));
    (notes || []).forEach(function (n) { msg.push('<span class="mt-warn">' + esc(n) + '</span>'); });
    if (total > SOFT_LIMIT) msg.push('<span class="mt-warn">Large files may be slow in a browser. Kramata handles multi-GB files on your PC. <a href="' + STORE + '">Get Kramata</a></span>');
    status.innerHTML = msg.join(' · ');
    go.disabled = busy || !files.length;
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('.mt-x');
    if (!b || busy) return;
    files.splice(+b.dataset.i, 1);
    render();
  });
  input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
  // Don't let a file dropped just outside the zone navigate away from the page.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  go.addEventListener('click', function () {
    if (busy || !files.length) return;
    busy = true; go.disabled = true; result = null;
    out.hidden = false;
    out.innerHTML = '<p class="mt-progress" id="mt-progress">Starting…</p>';
    run().catch(function (err) {
      out.innerHTML = '<p class="mt-error">Something went wrong: ' + esc(err && err.message || err) + ' Your files were not changed.</p>';
    }).then(function () { busy = false; render(); });
  });

  function run() {
    var opts = { addSource: $('mt-source').checked, dedupe: $('mt-dedupe').checked };
    var merger = new M.Merger(opts), queue = files.slice();
    return loadPapa().then(function (Papa) {
      var i = 0;
      var next = function () {
        if (i >= queue.length) return Promise.resolve();
        var f = queue[i++];
        var p = $('mt-progress');
        if (p) p.textContent = 'Reading file ' + i + ' of ' + queue.length + '…';
        return M.parseInto(Papa, f, merger, f.name, { worker: true }).then(next);
      };
      return next();
    }).then(function () {
      result = merger.finish();
      show(result, opts);
      track(result, opts);
    });
  }

  function show(r, opts) {
    var fileNotes = [];
    r.files.forEach(function (f) {
      if (f.status === 'empty') fileNotes.push('<li><b>' + esc(f.name) + '</b>: empty, skipped.</li>');
      else if (f.status === 'error') fileNotes.push('<li class="mt-bad"><b>' + esc(f.name) + '</b>: ' + esc(f.error) + ' Skipped.</li>');
      else {
        var bits = [];
        if (f.missing.length) bits.push('no ' + f.missing.map(function (c) { return '“' + esc(c) + '”'; }).join(', ') + ' (left blank)');
        if (f.matched.length) bits.push(f.matched.map(function (m) { return '“' + esc(m[0]) + '” matched to “' + esc(m[1]) + '”'; }).join(', '));
        if (f.renamed.length) bits.push('repeated column names renamed: ' + f.renamed.map(function (m) { return '“' + esc(m[1]) + '”'; }).join(', '));
        f.warnings.forEach(function (w) { bits.push(esc(w)); });
        if (bits.length) fileNotes.push('<li><b>' + esc(f.name) + '</b> (' + num(f.rows) + (f.rows === 1 ? ' row' : ' rows') + '): ' + bits.join('; ') + '.</li>');
      }
    });

    if (!r.mergedFiles) {
      out.innerHTML = '<p class="mt-error">None of the files could be merged.</p><ul class="mt-notes">' + fileNotes.join('') + '</ul>';
      return;
    }

    var stats = [
      ['Files merged', num(r.mergedFiles)], ['Rows', num(r.totalRows)], ['Columns', num(r.columns.length)]
    ];
    if (opts.dedupe) stats.push(['Duplicates removed', num(r.duplicatesRemoved)]);

    var n = Math.min(20, r.rows.length), body = '';
    for (var i = 0; i < n; i++) body += '<tr>' + M.outputRow(r, i).map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>';

    out.innerHTML =
      '<div class="mt-stats">' + stats.map(function (s) { return '<div><b>' + s[1] + '</b><span>' + s[0] + '</span></div>'; }).join('') + '</div>' +
      (fileNotes.length ? '<ul class="mt-notes">' + fileNotes.join('') + '</ul>'
        : '<p class="mt-ok">Every file had the same columns.</p>') +
      '<p class="mt-label">Preview (first ' + n + ' of ' + num(r.totalRows) + ' rows)</p>' +
      '<div class="mt-preview"><table><thead><tr>' + r.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="mt-actions"><button type="button" class="btn btn-lg btn-primary" id="mt-download">Download merged.csv</button></p>' +
      '<div class="mt-upsell"><p>Doing this every week? Kramata saves these steps as a recipe, so next week’s files are open, apply, export.</p>' +
      '<a class="btn btn-primary" href="' + STORE + '" data-pos="merge_tool_result">Get Kramata from the Microsoft Store</a></div>';
    $('mt-download').addEventListener('click', download);
  }

  function download() {
    if (!result) return;
    var blob = new Blob(['﻿'].concat(M.toCsvParts(result)), { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'merged.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // Counts only: never file names, headers or contents.
  function track(r, opts) {
    if (typeof window.gtag !== 'function' || !r.mergedFiles) return;
    var used = [];
    if (opts.addSource) used.push('source_column');
    if (opts.dedupe) used.push('dedupe');
    window.gtag('event', 'tool_merge_complete', {
      file_count: r.mergedFiles,
      row_bucket: M.rowBucket(r.totalRows),
      options_used: used.join(',') || 'none'
    });
  }

  render();
})();
