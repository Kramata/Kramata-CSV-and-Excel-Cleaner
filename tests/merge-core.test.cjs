// Unit tests for the free CSV merge tool's merge logic. Run: node --test tests/
// Uses the same Papa Parse build the page loads (assets/vendor), with no npm install.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Load the browser scripts exactly as shipped (UMD), independent of any parent package.json "type".
function loadUmd(rel) {
  const module = { exports: {} }
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8')
  vm.runInThisContext(`(function (module, exports) {${src}\n})`, { filename: rel })(module, module.exports)
  return module.exports
}
const Papa = loadUmd('../assets/vendor/papaparse.min.js')
const M = loadUmd('../assets/merge-csv/merge-core.js')

const FIX = path.join(__dirname, 'fixtures')

// Read like the browser does: UTF-8 decode (FileReader keeps a BOM; Papa strips it).
const read = (name) => fs.readFileSync(path.join(FIX, name)).toString('utf8')

async function merge(names, opts) {
  const m = new M.Merger(opts)
  for (const n of names) await M.parseInto(Papa, read(n), m, n)
  const result = m.finish()
  const csv = M.toCsvParts(result).join('')
  const back = Papa.parse(csv, { header: false, skipEmptyLines: true }).data
  return { result, csv, header: back[0], rows: back.slice(1) }
}

test('identical headers: one header row, rows stacked in file order', async () => {
  const { csv, header, rows } = await merge(['same-a.csv', 'same-b.csv'])
  assert.deepEqual(header, ['Name', 'Amount'])
  assert.deepEqual(rows, [['Alice', '1'], ['Bob', '2'], ['Cara', '3']])
  assert.equal(csv.split('Name,Amount').length - 1, 1)
})

test('different column order is matched by name', async () => {
  const { rows } = await merge(['same-a.csv', 'order-b.csv'])
  assert.deepEqual(rows[2], ['Cara', '3'])
})

test('different column sets: union of headers, blanks where missing, report per file', async () => {
  const { result, header, rows } = await merge(['sets-a.csv', 'sets-b.csv'])
  assert.deepEqual(header, ['Name', 'Region', 'Email'])
  assert.deepEqual(rows, [['Alice', 'North', ''], ['Bob', '', 'bob@example.com']])
  assert.deepEqual(result.files.map((f) => f.missing), [['Email'], ['Region']])
})

test('header case and spaces are ignored; first spelling is kept', async () => {
  const { result, header, rows } = await merge(['case-a.csv', 'case-b.csv'])
  assert.deepEqual(header, ['First Name', 'Amount'])
  assert.deepEqual(rows, [['Alice', '1'], ['Bob', '2']])
  assert.deepEqual(result.files[1].matched, [['first name', 'First Name'], ['AMOUNT', 'Amount']])
})

test('UTF-8 BOM does not leak into the first column name', async () => {
  const { header, rows } = await merge(['bom.csv', 'same-b.csv'])
  assert.deepEqual(header, ['Name', 'Amount'])
  assert.deepEqual(rows, [['Dee', '4'], ['Cara', '3']])
})

test('semicolon, tab and pipe delimiters are detected', async () => {
  const { header, rows } = await merge(['semicolon.csv', 'tab.tsv.txt', 'pipe.txt'])
  assert.deepEqual(header, ['Name', 'Amount', 'Note'])
  assert.deepEqual(rows, [['Eve', '5', 'a, b'], ['Fay', '6', 'c'], ['Gus', '7', ''], ['Hal', '8', '']])
})

test('quoted commas, quotes and newlines survive and are re-quoted', async () => {
  const { csv, rows } = await merge(['quoted.csv'])
  assert.deepEqual(rows, [['Smith, John', 'line one\r\nline two'], ['Q "quoted"', 'plain']])
  assert.ok(csv.includes('"Smith, John","line one\r\nline two"'))
  assert.ok(csv.includes('"Q ""quoted""",plain'))
})

test('a file without a trailing newline does not glue onto the next file', async () => {
  const { rows } = await merge(['no-newline.csv', 'same-b.csv'])
  assert.deepEqual(rows, [['Alice', '1'], ['Bob', '2'], ['Cara', '3']])
})

test('an empty file is skipped with a note', async () => {
  const { result, rows } = await merge(['same-a.csv', 'empty.csv', 'same-b.csv'])
  assert.equal(result.files[1].status, 'empty')
  assert.equal(result.mergedFiles, 2)
  assert.equal(rows.length, 3)
})

test('duplicate column names within one file get _2 suffixes', async () => {
  const { result, header, rows } = await merge(['dup-headers.csv'])
  assert.deepEqual(header, ['Name', 'Amount', 'name_2', 'Amount_2'])
  assert.deepEqual(rows, [['Alice', '1', 'A', '10']])
  assert.equal(result.files[0].renamed.length, 2)
})

test('dedupe option removes exact duplicate rows across files (after matching columns)', async () => {
  const off = await merge(['dupes-a.csv', 'dupes-b.csv'])
  assert.equal(off.rows.length, 5)
  const on = await merge(['dupes-a.csv', 'dupes-b.csv'], { dedupe: true })
  assert.deepEqual(on.rows, [['Alice', '1'], ['Bob', '2'], ['Cara', '3']])
  assert.equal(on.result.duplicatesRemoved, 2)
})

test('source file column is added last with each row’s file name', async () => {
  const { header, rows } = await merge(['same-a.csv', 'same-b.csv'], { addSource: true })
  assert.deepEqual(header, ['Name', 'Amount', 'Source file'])
  assert.deepEqual(rows.map((r) => r[2]), ['same-a.csv', 'same-a.csv', 'same-b.csv'])
})

test('a binary file is rejected without adding its columns', async () => {
  const m = new M.Merger()
  await M.parseInto(Papa, read('same-a.csv'), m, 'a.csv')
  await M.parseInto(Papa, 'PK\u0003\u0004\u0000\u0000junk,more\n\u0000\u0001,x\n', m, 'book.xlsx')
  const r = m.finish()
  assert.equal(r.files[1].status, 'error')
  assert.deepEqual(r.columns, ['Name', 'Amount'])
  assert.equal(r.totalRows, 2)
})

test('row buckets for analytics', () => {
  assert.equal(M.rowBucket(999), '<1k')
  assert.equal(M.rowBucket(1000), '1k-100k')
  assert.equal(M.rowBucket(100000), '100k+')
})
