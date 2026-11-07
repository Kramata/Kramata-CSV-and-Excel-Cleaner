"""Set page dates from git: sitemap <lastmod>, Article datePublished/dateModified and the
visible "Updated <date>" line on blog posts.

datePublished = the page's first commit. dateModified / lastmod = the last commit that changed
the page's *content*. Changes to site chrome (nav/footer links, the analytics tag) and to these
date/schema lines themselves don't count, so a site-wide footer link doesn't re-date every page.

Run after committing content changes, then commit the result:
    python tools/update-dates.py
"""
import json, os, re, subprocess, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Diff lines that are not page content.
IGNORE = [re.compile(p) for p in (
    r'<script defer src="/assets/track\.js"></script>',
    r'<nav>', r'<div class="links">',
    r'^\s*<a href="/merge-csv-files">Free CSV merge tool</a>\s*$',
    r'class="post-updated"',
    r'"@type": ?"Article"',
)]
# Older commits that only touched schema/dates (made before the patterns above existed).
SKIP = {'36c1272'}

MONTHS = 'January February March April May June July August September October November December'.split()


def git(*a):
    return subprocess.run(['git', *a], capture_output=True, text=True, encoding='utf-8').stdout


def dates(p):
    commits = [l.split() for l in git('log', '--follow', '--format=%H %aI', '--', p).splitlines()]
    if not commits:
        return None
    first, last = commits[-1][1], None
    for h, d in commits:
        if h[:7] in SKIP:
            continue
        diff = git('log', '-1', '-p', '-w', '--ignore-blank-lines', '--format=', '--follow', h, '--', p)
        body = [l for l in diff.splitlines() if l[:1] in '+-' and not l.startswith(('+++', '---'))]
        if any(l[1:].strip() and not any(r.search(l[1:]) for r in IGNORE) for l in body):
            last = d
            break
    return first, last or first


def rw(p, fn):
    raw = open(p, 'rb').read()
    crlf = b'\r\n' in raw
    s = raw.decode('utf-8').replace('\r\n', '\n')
    t = fn(s)
    if t != s:
        open(p, 'wb').write((t.replace('\n', '\r\n') if crlf else t).encode('utf-8'))
        print('updated', p)


def url_for(p):
    if p == 'index.html':
        return 'https://kramata.com/'
    if p == 'blog/index.html':
        return 'https://kramata.com/blog/'
    return 'https://kramata.com/' + p[:-5]


pages = ['index.html', 'privacy.html', 'merge-csv-files.html'] + sorted(x.replace(os.sep, '/') for x in glob.glob('blog/*.html'))
found = {p: dates(p) for p in pages}

for p, d in found.items():
    if not d or not p.startswith('blog/') or p == 'blog/index.html':
        continue
    pub, mod = d
    human = f'{MONTHS[int(mod[5:7]) - 1]} {int(mod[8:10])}, {mod[:4]}'

    def fix(s):
        s = re.sub(r'"datePublished": "[^"]*"', f'"datePublished": "{pub}"', s, count=1)
        s = re.sub(r'"dateModified": "[^"]*"', f'"dateModified": "{mod}"', s, count=1)
        return re.sub(r'Updated <time datetime="[^"]*">[^<]*</time>', f'Updated <time datetime="{mod[:10]}">{human}</time>', s, count=1)
    rw(p, fix)


def sitemap(s):
    for p, d in found.items():
        if not d:
            continue
        s, n = re.subn(rf'(<loc>{re.escape(url_for(p))}</loc><lastmod>)[^<]*', rf'\g<1>{d[1][:10]}', s)
        if not n:
            print('WARNING: not in sitemap:', url_for(p))
    return s


rw('sitemap.xml', sitemap)
