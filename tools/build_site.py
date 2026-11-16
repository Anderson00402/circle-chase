#!/usr/bin/env python3
"""Build the website with every version of the game, for GitHub Pages.

    /               the home page: every version in tabs, played right there in a frame
                    (/?v=<name> opens that version, so each one has a link to share)
    /v/main/        main, the real game (the home page shows it first)
    /v/<branch>/    each other branch in this repository
    /pr/<number>/   each open pull request (not reviewed or merged yet)
    /versions/      a plain list of them all
    /versions.json  the same list for scripts (the workflow checks it is live)

.github/workflows/pages.yml runs this after fetching every branch and pull request into
refs/remotes/origin/* and refs/remotes/pr/*. It only copies files out of git; it never runs
code from a branch or pull request. On the home page, pull requests run in a sandboxed frame,
so code nobody has reviewed yet can't touch the home page or the other versions' saved scores.

Usage: python3 tools/build_site.py <output folder>
"""
import datetime
import html
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import urllib.request

REPO = os.environ.get('GITHUB_REPOSITORY', 'Anderson00402/circle-chase')
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '_site')

# What each version is, in a sentence, for the home page. A branch that isn't listed shows its
# latest commit message instead, and a pull request shows its title.
NOTES = {
    'main': 'The real game. Eat every dot; after a power dot you can catch the ghosts for a few seconds.',
    'Scream': ('Scared ghosts scream when you eat a power dot and keep wailing while you are close, '
               'and an evil laugh warns you the power-up is about to run out.'),
    'fortnite': ("Made to play two sound clips that are only on the owner's computer. "
                 'Here it uses the built-in sounds, so it plays like the main game.'),
    'play-as-ghost': ('You steer the pink ghost and the computer plays the circle. '
                      'Catch it 3 times before it eats every dot, and run when it eats a power dot.'),
    'two-player': ('Two players on one keyboard: WASD against the arrow keys. '
                   'Each has their own score and lives, and most points wins.'),
    'dash': 'Shift, X or a tap gives a short burst of speed, then it takes 3 seconds to recharge.',
    'fog': ("The maze is dark except the light around your circle. "
            'A power dot lights up everything for a few seconds.'),
}

# Game modes: branches that change how the game plays. Their tabs sit together at the right end
# of the tab row, in this order; every other version stays on the left.
RIGHT_SIDE = ['play-as-ghost', 'two-player', 'dash', 'fog']

FONTS = ('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700'
         '&family=Atkinson+Hyperlegible+Mono:wght@400;600&family=Major+Mono+Display&display=swap')

# A label in the corner of each version's own page, linking to it on the home page. Inside the
# home page's frame it removes itself, since the tabs already say which version is playing.
BADGE = ('<a id="cc-version-badge" href="../../?v={key}" target="_top" style="position:fixed;left:10px;'
         'bottom:10px;z-index:99;font:600 12px/1.3 ui-monospace,Menlo,monospace;background:#000;'
         'color:#ffd84a;border:1px solid #1c6cfc;border-radius:4px;padding:6px 9px;text-decoration:none">'
         '{label} &middot; all versions</a>'
         '<script>try{if(window.top!==window.self)document.getElementById("cc-version-badge").remove()}'
         'catch(e){}</script>')


def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout


def open_pulls():
    headers = {'Accept': 'application/vnd.github+json'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    url = f'https://api.github.com/repos/{REPO}/pulls?state=open&per_page=100'
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as r:
        return json.load(r)


def export(ref, dest):
    """Copy the files of a commit into dest: no .git, and nothing can land outside dest."""
    data = subprocess.run(['git', 'archive', '--format=tar', ref], check=True, capture_output=True).stdout
    os.makedirs(dest, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        t.extractall(dest, filter='data')


def last_commit(ref):
    """(subject, date) of the newest commit on ref."""
    subject, date = git('log', '-1', '--format=%s%x00%cs', ref).rstrip('\n').split('\x00')
    return subject, date


def short_date(iso):
    d = datetime.date.fromisoformat(iso)
    return f'{d:%b} {d.day}, {d.year}'


def add_badge(dest, key, label):
    """Label a version's own page so players can tell which one it is and find the others."""
    page = os.path.join(dest, 'index.html')
    if not os.path.isfile(page):
        return False
    with open(page, encoding='utf-8', errors='replace') as f:
        text = f.read()
    tag = BADGE.replace('{key}', html.escape(key)).replace('{label}', html.escape(label))
    at = text.lower().rfind('</body>')
    text = text[:at] + tag + text[at:] if at >= 0 else text + tag
    with open(page, 'w', encoding='utf-8') as f:
        f.write(text)
    return True


def slug(name, taken):
    s = re.sub(r'[^A-Za-z0-9._-]+', '-', name).strip('-.') or 'version'
    if re.fullmatch(r'pr-\d+', s):  # those names belong to pull requests on the home page
        s = 'branch-' + s
    base, n = s, 2
    while s in taken:
        s, n = f'{base}-{n}', n + 1
    taken.add(s)
    return s


def script_json(value):
    """JSON that is safe inside a <script> element."""
    return json.dumps(value, ensure_ascii=False).replace('<', '\\u003c')


# ---------------------------------------------------------------------------------------------
# The home page

HOME = '''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Circle Chase</title>
<meta name="description" content="Circle Chase, a maze game. Play the main game or any version of it.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="__FONTS__">
<style>
  :root {
    color-scheme: dark;
    --desk: #0a1b3d;
    --panel: #0e2858;
    --rule: rgba(219, 231, 255, 0.22);
    --ink: #eef3ff;
    --ink-dim: #a3b6de;
    --accent: #ff8a4c;
    --you: #ffd84a;
    --wall: #1c6cfc;
    --font-display: "Major Mono Display", "Courier New", monospace;
    --font-body: "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: "Atkinson Hyperlegible Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --gutter-l: max(16px, env(safe-area-inset-left, 0px));
    --gutter-r: max(16px, env(safe-area-inset-right, 0px));
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--desk); color: var(--ink); }
  body {
    display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden;
    font: 15px/1.5 var(--font-body);
  }
  a { color: var(--you); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* The title block: name, links, and a tab for each version sitting on its bottom rule. */
  header {
    flex: none; background: var(--panel); border-bottom: 1px solid var(--rule);
    padding: calc(10px + env(safe-area-inset-top, 0px)) var(--gutter-r) 0 var(--gutter-l);
  }
  .bar { max-width: 1160px; margin: 0 auto; }
  .top { display: flex; align-items: baseline; gap: 6px 16px; flex-wrap: wrap; }
  .brand {
    margin: 0; font: 400 24px/1.1 var(--font-display); color: var(--ink); letter-spacing: 0.01em;
  }
  .brand i {
    display: inline-block; width: 0.62em; height: 0.62em; margin-right: 0.28em; border-radius: 50%;
    background: var(--you); vertical-align: -0.02em;
  }
  .links { margin-left: auto; display: flex; gap: 16px; font-family: var(--font-mono); font-size: 12.5px; }
  .links a { color: var(--ink-dim); text-decoration: none; }
  .links a:hover { color: var(--ink); text-decoration: underline; }

  .tabs {
    display: flex; gap: 6px; margin: 10px 0 -1px; padding: 0; list-style: none;
    overflow-x: auto; scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    display: flex; align-items: baseline; gap: 7px; white-space: nowrap; text-decoration: none;
    font: 600 13.5px/1.2 var(--font-mono); color: var(--ink-dim);
    padding: 8px 13px 9px; border: 1px solid var(--rule); border-bottom-color: transparent;
    border-radius: 4px 4px 0 0; background: transparent;
  }
  .tab:hover { color: var(--ink); background: rgba(166, 196, 255, 0.07); }
  .tab[aria-current="page"] {
    color: var(--ink); background: var(--desk); border-bottom-color: var(--desk);
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .tab .kind {
    font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--you);
  }
  /* The game modes start here and sit at the right end of the row. On a narrow screen the row
     scrolls, and they simply follow the other tabs. */
  .tabs .group {
    margin-left: auto; align-self: center; padding: 0 4px 0 14px; white-space: nowrap;
    font: 600 10px/1 var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-dim);
  }

  /* One line about the version that is playing. */
  .about {
    flex: none; max-width: 1192px; width: 100%; margin: 0 auto;
    padding: 9px var(--gutter-r) 0 var(--gutter-l);
    display: flex; align-items: baseline; gap: 4px 14px; flex-wrap: wrap;
    font-size: 13.5px; color: var(--ink-dim);
  }
  .about p { margin: 0; flex: 1 1 320px; min-width: 0; }
  .about strong { color: var(--ink); font-weight: 700; }
  .about .meta { font-family: var(--font-mono); font-size: 12px; white-space: nowrap; }
  .about .meta a { text-decoration: none; }
  .about .meta a:hover { text-decoration: underline; }
  .notice {
    flex: none; max-width: 1160px; width: calc(100% - 32px); margin: 8px auto 0;
    padding: 7px 10px; border: 1px solid var(--accent); color: var(--ink); font-size: 13.5px;
  }

  .stage { flex: 1; min-height: 0; position: relative; }
  .stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: var(--desk); }

  @media (max-width: 560px) {
    .brand { font-size: 20px; }
    .links .wide { display: none; }
    .tab { padding: 7px 11px 8px; font-size: 13px; }
    .about { font-size: 13px; }
    .about p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .about .meta { white-space: normal; }
    .about .meta a { white-space: nowrap; }
  }
</style>
</head>
<body>
<header>
  <div class="bar">
    <div class="top">
      <h1 class="brand"><i aria-hidden="true"></i>circle chase</h1>
      <nav class="links" aria-label="More">
        <a class="wide" href="versions/">List of versions</a>
        <a href="__README__">Make your own</a>
      </nav>
    </div>
    <nav aria-label="Versions">
      <ul class="tabs" id="tabs">__TABS__</ul>
    </nav>
  </div>
</header>
<div class="notice" id="notice" role="status" hidden></div>
<div class="about" id="about" aria-live="polite"></div>
<div class="stage" id="stage">
  <noscript><p style="padding:16px"><a href="v/main/">Play the main game</a> &middot; <a href="versions/">every version</a></p></noscript>
</div>
<script type="application/json" id="versions-data">__DATA__</script>
<script>
(() => {
  const versions = JSON.parse(document.getElementById('versions-data').textContent);
  const byKey = new Map(versions.map(v => [v.key, v]));
  const main = versions[0];
  const stage = document.getElementById('stage');
  const about = document.getElementById('about');
  const notice = document.getElementById('notice');
  const tabs = [...document.querySelectorAll('#tabs a')];
  let current = null;

  const urlFor = v => (v === main ? location.pathname : location.pathname + '?v=' + encodeURIComponent(v.key));

  function show(v, focus) {
    current = v;
    tabs.forEach(a => {
      if (a.dataset.key === v.key) { a.setAttribute('aria-current', 'page'); a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else a.removeAttribute('aria-current');
    });
    document.title = v === main ? 'Circle Chase' : v.name + ' \\u00b7 Circle Chase';

    about.replaceChildren();
    const p = document.createElement('p');
    const name = document.createElement('strong');
    name.textContent = v.name;
    p.append(name, ' \\u2014 ' + v.note);
    const meta = document.createElement('span');
    meta.className = 'meta';
    const own = document.createElement('a');
    own.href = v.path;
    own.target = '_blank';
    own.rel = 'noopener';
    own.textContent = 'Open on its own page \\u2197';
    meta.append(v.updated ? 'Updated ' + v.updated + ' \\u00b7 ' : '', own);
    about.append(p, meta);

    // A fresh frame each time: the last version's game and sounds stop, and switching doesn't
    // add steps to the browser's Back button (only the address bar does).
    const frame = document.createElement('iframe');
    frame.title = v.name + ' (game)';
    frame.allow = 'autoplay; fullscreen';
    if (v.sandbox) frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    frame.addEventListener('load', () => { if (focus) frame.focus(); }, { once: true });
    frame.src = v.path;
    stage.querySelectorAll('iframe').forEach(f => f.remove());
    stage.append(frame);
  }

  function pick(key, push) {
    const v = byKey.get(key);
    if (!v || v === current) return;
    notice.hidden = true;
    if (push) history.pushState({ key }, '', urlFor(v));
    show(v, true);
  }

  tabs.forEach(a => a.addEventListener('click', ev => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return; // new tab or window
    ev.preventDefault();
    pick(a.dataset.key, true);
  }));

  addEventListener('popstate', () => {
    const v = byKey.get(new URLSearchParams(location.search).get('v')) || main;
    if (v !== current) show(v, true);
  });

  const asked = new URLSearchParams(location.search).get('v');
  const first = asked === null ? main : byKey.get(asked);
  if (first) {
    show(first, true);
  } else {
    notice.textContent = 'There is no version called \\u201c' + asked + '\\u201d any more, so here is the main game.';
    notice.hidden = false;
    history.replaceState(null, '', urlFor(main));
    show(main, true);
  }
})();
</script>
</body></html>
'''


def write_home(versions):
    def tab(v):
        return (f'<li><a class="tab" href="{html.escape(v["href"])}" data-key="{html.escape(v["key"])}">'
                + (f'<span class="kind">{html.escape(v["kind_label"])}</span>' if v['kind_label'] else '')
                + f'{html.escape(v["tab"])}</a></li>')

    modes = lambda v: v['kind'] == 'branch' and v['name'] in RIGHT_SIDE
    left = [v for v in versions if not modes(v)]
    right = sorted(filter(modes, versions), key=lambda v: RIGHT_SIDE.index(v['name']))
    versions = left + right
    tabs = ''.join(map(tab, left))
    if right:
        tabs += '<li class="group" aria-hidden="true">Game modes</li>' + ''.join(map(tab, right))
    data =[{k: v[k] for k in ('key', 'name', 'kind', 'path', 'note', 'updated', 'sandbox')} for v in versions]
    page = (HOME.replace('__FONTS__', html.escape(FONTS))
                .replace('__README__', html.escape(f'https://github.com/{REPO}#make-your-own-version'))
                .replace('__TABS__', tabs)
                .replace('__DATA__', script_json(data)))
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    with open(os.path.join(OUT, 'versions.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------------------------------------
# The plain list at /versions/

def items(rows, empty):
    if not rows:
        return f'<p class="empty">{html.escape(empty)}</p>'
    return '<ul>' + ''.join(
        f'<li><a href="../{html.escape(v["href"])}">{html.escape(v["name"])}</a>'
        f'<span>{html.escape(v["note"])}</span>'
        f'<span class="own"><a href="../{html.escape(v["path"])}">its own page</a>'
        + (f' &middot; updated {html.escape(v["updated"])}' if v['updated'] else '')
        + '</span></li>'
        for v in rows) + '</ul>'


def write_versions_page(versions):
    by_kind = {k: [v for v in versions if v['kind'] == k] for k in ('main', 'branch', 'pr')}
    readme = html.escape(f'https://github.com/{REPO}#make-your-own-version')
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Circle Chase versions</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; background: #000; color: #eef3ff; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
  main {{ max-width: 680px; margin: 0 auto; padding: 32px 16px; }}
  h1 {{ font-size: 28px; margin: 0 0 4px; }}
  h2 {{ font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: #a3b6de; margin: 28px 0 8px; }}
  p {{ margin: 0 0 8px; color: #a3b6de; }}
  ul {{ list-style: none; margin: 0; padding: 0; }}
  li {{ border: 1px solid #1c6cfc; border-radius: 6px; padding: 10px 12px; margin: 0 0 8px; box-shadow: 0 0 8px rgba(28, 108, 252, .35); }}
  li span {{ display: block; color: #a3b6de; font-size: 14px; overflow-wrap: anywhere; }}
  li .own a {{ font-weight: 400; }}
  a {{ color: #ffd84a; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }}
  a:hover {{ text-decoration: underline; }}
  .empty {{ font-style: italic; }}
</style></head>
<body><main>
<h1>Circle Chase versions</h1>
<p>Every version of the game you can play. Main is the real game; the others are ideas being tried out.
You can also switch between them on the <a href="../">home page</a>.</p>
<h2>Main</h2>
{items(by_kind['main'], '')}
<h2>Versions</h2>
{items(by_kind['branch'], 'No other versions right now.')}
<h2>Pull requests</h2>
{items(by_kind['pr'], 'No open pull requests right now.')}
<p style="margin-top:28px">Want to make your own? <a href="{readme}">Here is how</a>.</p>
</main></body></html>
'''
    os.makedirs(os.path.join(OUT, 'versions'), exist_ok=True)
    with open(os.path.join(OUT, 'versions', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)


def version(key, kind, name, tab, path, note, date, kind_label='', sandbox=False):
    return {
        'key': key, 'kind': kind, 'name': name, 'tab': tab, 'kind_label': kind_label,
        'path': path, 'href': '?v=' + key if kind != 'main' else './',
        'note': note, 'updated': short_date(date) if date else '', 'sandbox': sandbox,
    }


def main():
    if os.path.exists(OUT):
        raise SystemExit(f'{OUT} already exists')
    os.makedirs(OUT)

    ref = 'refs/remotes/origin/main'
    export(ref, os.path.join(OUT, 'v', 'main'))
    if not add_badge(os.path.join(OUT, 'v', 'main'), 'main', 'Main game'):
        raise SystemExit('main has no index.html')
    versions = [version('main', 'main', 'Main game', 'Main game', 'v/main/', NOTES['main'], last_commit(ref)[1])]

    taken = {'main'}
    for b in sorted(git('for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/').split(), key=str.lower):
        if b in ('main', 'HEAD'):
            continue
        ref, s = f'refs/remotes/origin/{b}', slug(b, taken)
        dest = os.path.join(OUT, 'v', s)
        export(ref, dest)
        if add_badge(dest, s, f'Version: {b}'):
            subject, date = last_commit(ref)
            versions.append(version(s, 'branch', b, b, f'v/{s}/', NOTES.get(b, subject), date))

    for pr in sorted(open_pulls(), key=lambda p: p['number']):
        n, ref = pr['number'], f'refs/remotes/pr/{pr["number"]}'
        if subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref], capture_output=True).returncode:
            continue
        dest = os.path.join(OUT, 'pr', str(n))
        export(ref, dest)
        if add_badge(dest, f'pr-{n}', f'Pull request #{n} (not merged)'):
            note = f'{pr["title"]} — by {pr["user"]["login"]}, not reviewed or merged yet.'
            versions.append(version(f'pr-{n}', 'pr', f'Pull request #{n}', f'#{n}', f'pr/{n}/', note,
                                    last_commit(ref)[1], kind_label='PR', sandbox=True))

    write_home(versions)
    write_versions_page(versions)
    branches = sum(v['kind'] == 'branch' for v in versions)
    pulls = sum(v['kind'] == 'pr' for v in versions)
    print(f'home page + main + {branches} version(s) + {pulls} pull request(s) -> {OUT}')


if __name__ == '__main__':
    main()
