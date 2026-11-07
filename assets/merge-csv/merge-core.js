/* Kramata free CSV merge: the merge logic, with no DOM code, so tests can run it in Node.
 * Files are merged by column NAME (trimmed, case-insensitive), not by position:
 * the output header is the union of every file's columns in first-seen order. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KramataMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SOURCE_COLUMN = 'Source file';

  // Papa Parse settings shared by the page and the tests.
  var PARSE_CONFIG = {
    header: false,
    dynamicTyping: false,
    delimiter: '',                               // auto-detect…
    delimitersToGuess: [',', ';', '\t', '|'],    // …among these
    skipEmptyLines: true
  };

  function key(name) { return String(name).trim().toLowerCase(); }

  /** Header cells → clean names: trimmed, BOM removed, blanks named, repeats suffixed _2, _3. */
  function cleanHeader(row) {
    var names = [], seen = {}, renamed = [];
    for (var i = 0; i < row.length; i++) {
      var raw = row[i] == null ? '' : String(row[i]);
      if (i === 0) raw = raw.replace(/^﻿/, '');
      var name = raw.trim() || 'Column ' + (i + 1);
      if (seen[key(name)]) {
        var n = 2;
        while (seen[key(name + '_' + n)]) n++;
        renamed.push([name, name + '_' + n]);
        name = name + '_' + n;
      }
      seen[key(name)] = true;
      names.push(name);
    }
    return { names: names, renamed: renamed };
  }

  function Merger(opts) {
    opts = opts || {};
    this.addSource = !!opts.addSource;
    this.dedupe = !!opts.dedupe;
    this.columns = [];          // output column names (first spelling seen)
    this.index = {};            // key → column position
    this.rows = [];             // { f: file number, v: values by column position }
    this.files = [];            // per-file report
    this.cur = null;
  }

  Merger.prototype.beginFile = function (name) {
    this.cur = {
      name: name, header: null, map: null, rows: 0, extraValues: 0,
      renamed: [], matched: [], warnings: [], status: 'ok',
      _rowStart: this.rows.length, _colStart: this.columns.length
    };
  };

  /** Feed parsed rows (arrays of strings) for the current file; the first row is its header. */
  Merger.prototype.addRows = function (rows) {
    var cur = this.cur;
    if (!cur || cur.status !== 'ok') return;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!cur.map) {
        if (looksBinary(row)) { this.failFile("This doesn't look like a text CSV file."); return; }
        var h = cleanHeader(row);
        cur.header = h.names; cur.renamed = h.renamed; cur.map = [];
        for (var i = 0; i < h.names.length; i++) {
          var k = key(h.names[i]);
          if (!(k in this.index)) { this.index[k] = this.columns.length; this.columns.push(h.names[i]); }
          else if (this.columns[this.index[k]] !== h.names[i]) cur.matched.push([h.names[i], this.columns[this.index[k]]]);
          cur.map.push(this.index[k]);
        }
        continue;
      }
      var out = [];
      for (var c = 0; c < row.length; c++) {
        if (c >= cur.map.length) { if (row[c] !== '') cur.extraValues++; continue; }
        out[cur.map[c]] = row[c];
      }
      this.rows.push({ f: this.files.length, v: out });
      cur.rows++;
    }
  };

  /** Drop everything the current file added (rows and new columns) and mark it as failed. */
  Merger.prototype.failFile = function (message) {
    var cur = this.cur;
    this.rows.length = cur._rowStart;
    for (var i = cur._colStart; i < this.columns.length; i++) delete this.index[key(this.columns[i])];
    this.columns.length = cur._colStart;
    cur.status = 'error'; cur.error = message; cur.rows = 0;
  };

  Merger.prototype.warn = function (message) { if (this.cur) this.cur.warnings.push(message); };

  Merger.prototype.endFile = function () {
    var cur = this.cur;
    if (cur.status === 'ok' && !cur.map) cur.status = 'empty';
    if (cur.extraValues) cur.warnings.push(cur.extraValues + ' value(s) sat past the last header column and were left out.');
    this.files.push(cur);
    this.cur = null;
  };

  /** Finish: dedupe if asked, add the source column, and report what each file was missing. */
  Merger.prototype.finish = function () {
    var width = this.columns.length, removed = 0, rows = this.rows;
    if (this.dedupe) {
      var seen = new Set(), kept = [];
      for (var i = 0; i < rows.length; i++) {
        var parts = [];
        for (var c = 0; c < width; c++) parts.push(rows[i].v[c] == null ? '' : rows[i].v[c]);
        var k = parts.join('\u001f');
        if (seen.has(k)) { removed++; continue; }
        seen.add(k); kept.push(rows[i]);
      }
      rows = kept;
    }
    var columns = this.columns.slice(), sourceName = null;
    if (this.addSource) {
      sourceName = SOURCE_COLUMN;
      var n = 2;
      while (key(sourceName) in this.index) sourceName = SOURCE_COLUMN + '_' + n++;
      columns.push(sourceName);
    }
    var self = this, merged = this.files.filter(function (f) { return f.status === 'ok'; });
    merged.forEach(function (f) {
      var has = {};
      f.header.forEach(function (h) { has[key(h)] = true; });
      f.missing = self.columns.filter(function (c) { return !has[key(c)]; });
    });
    return {
      columns: columns, width: width, rows: rows, files: this.files, fileNames: this.files.map(function (f) { return f.name; }),
      mergedFiles: merged.length, totalRows: rows.length, duplicatesRemoved: removed, sourceColumn: sourceName
    };
  };

  function looksBinary(row) {
    for (var i = 0; i < row.length; i++) if (String(row[i]).indexOf('\u0000') !== -1) return true;
    return false;
  }

  function csvField(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvRow(values) { return values.map(csvField).join(',') + '\r\n'; }

  /** The merged file as an array of string chunks (for a Blob), without the BOM. */
  function toCsvParts(result) {
    var parts = [csvRow(result.columns)], buf = '', width = result.width;
    for (var i = 0; i < result.rows.length; i++) {
      var r = result.rows[i], vals = new Array(width);
      for (var c = 0; c < width; c++) vals[c] = r.v[c] == null ? '' : r.v[c];
      if (result.sourceColumn) vals.push(result.fileNames[r.f]);
      buf += csvRow(vals);
      if (buf.length > 1 << 20) { parts.push(buf); buf = ''; }
    }
    if (buf) parts.push(buf);
    return parts;
  }

  /** One row of the output as plain values (for the preview table). */
  function outputRow(result, i) {
    var r = result.rows[i], vals = [];
    for (var c = 0; c < result.width; c++) vals.push(r.v[c] == null ? '' : r.v[c]);
    if (result.sourceColumn) vals.push(result.fileNames[r.f]);
    return vals;
  }

  /** Parse one input (a File in the page, a string in tests) into the merger with Papa Parse. */
  function parseInto(Papa, input, merger, name, extra) {
    return new Promise(function (resolve) {
      merger.beginFile(name);
      var replacement = false, quoteWarned = false, done = false;
      var finish = function () { if (done) return; done = true; merger.endFile(); resolve(); };
      var cfg = {};
      for (var k in PARSE_CONFIG) cfg[k] = PARSE_CONFIG[k];
      for (k in extra || {}) cfg[k] = extra[k];
      cfg.chunk = function (results) {
        (results.errors || []).forEach(function (e) {
          if (e.type === 'Quotes' && !quoteWarned) { quoteWarned = true; merger.warn('A quote mark is never closed (near row ' + ((e.row || 0) + 1) + '); check that file.'); }
        });
        if (!replacement) {
          for (var i = 0; i < results.data.length && i < 200 && !replacement; i++) {
            if (results.data[i].join('').indexOf('�') !== -1) replacement = true;
          }
          if (replacement) merger.warn("Some characters couldn't be read as UTF-8, so the file may be saved in another encoding.");
        }
        merger.addRows(results.data);
      };
      cfg.complete = finish;
      cfg.error = function (err) {
        if (!merger.cur) return;
        merger.failFile("Couldn't read this file" + (err && err.message ? ' (' + err.message + ')' : '') + '.');
        finish();
      };
      try { Papa.parse(input, cfg); }
      catch (e) { merger.failFile("Couldn't read this file."); finish(); }
    });
  }

  function rowBucket(n) { return n < 1000 ? '<1k' : n < 100000 ? '1k-100k' : '100k+'; }

  return {
    PARSE_CONFIG: PARSE_CONFIG, SOURCE_COLUMN: SOURCE_COLUMN, key: key, cleanHeader: cleanHeader,
    Merger: Merger, parseInto: parseInto, toCsvParts: toCsvParts, outputRow: outputRow,
    csvField: csvField, rowBucket: rowBucket
  };
});
