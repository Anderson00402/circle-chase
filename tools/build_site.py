#!/usr/bin/env python3
"""Build the website with every version of the game, for GitHub Pages.

    /              main, the real game
    /v/<branch>/   each other branch in this repository
    /pr/<number>/  each open pull request (not reviewed or merged yet)
    /versions/     a page that lists them all

.github/workflows/pages.yml runs this after fetching every branch and pull request into
refs/remotes/origin/* and refs/remotes/pr/*. It only copies files out of git; it never runs
code from a branch or pull request.

Usage: python3 tools/build_site.py <output folder>
"""
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

BADGE = ('<a href="../../versions/" style="position:fixed;left:10px;bottom:10px;z-index:99;'
         'font:600 12px/1.3 ui-monospace,Menlo,monospace;background:#000;color:#ffd84a;'
         'border:1px solid #1c6cfc;border-radius:4px;padding:6px 9px;text-decoration:none">'
         '{label} &middot; all versions</a>')


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
    subject, date = git('log', '-1', '--format=%s%x00%cs', ref).rstrip('\n').split('\x00')
    return f'{subject} ({date})'


def add_badge(dest, label):
    """Label a version page so players can tell it is not the main game."""
    page = os.path.join(dest, 'index.html')
    if not os.path.isfile(page):
        return False
    with open(page, encoding='utf-8', errors='replace') as f:
        text = f.read()
    tag = BADGE.format(label=html.escape(label))
    at = text.lower().rfind('</body>')
    text = text[:at] + tag + text[at:] if at >= 0 else text + tag
    with open(page, 'w', encoding='utf-8') as f:
        f.write(text)
    return True


def slug(name, taken):
    s = re.sub(r'[^A-Za-z0-9._-]+', '-', name).strip('-.') or 'version'
    base, n = s, 2
    while s in taken:
        s, n = f'{base}-{n}', n + 1
    taken.add(s)
    return s


def items(rows, empty):
    if not rows:
        return f'<p class="empty">{html.escape(empty)}</p>'
    return '<ul>' + ''.join(
        f'<li><a href="{html.escape(href)}">{html.escape(name)}</a><span>{html.escape(note)}</span></li>'
        for href, name, note in rows) + '</ul>'


def write_versions_page(branches, pulls):
    main_row = [('../', 'Main game', last_commit('refs/remotes/origin/main'))]
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
  a {{ color: #ffd84a; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }}
  a:hover {{ text-decoration: underline; }}
  .empty {{ font-style: italic; }}
</style></head>
<body><main>
<h1>Circle Chase versions</h1>
<p>Every version of the game you can play. Main is the real game; the others are ideas being tried out.</p>
<h2>Main</h2>
{items(main_row, '')}
<h2>Versions</h2>
{items(branches, 'No other versions right now.')}
<h2>Pull requests</h2>
{items(pulls, 'No open pull requests right now.')}
<p style="margin-top:28px">Want to make your own? <a href="{readme}">Here is how</a>.</p>
</main></body></html>
'''
    os.makedirs(os.path.join(OUT, 'versions'), exist_ok=True)
    with open(os.path.join(OUT, 'versions', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)


def main():
    if os.path.exists(OUT):
        raise SystemExit(f'{OUT} already exists')
    export('refs/remotes/origin/main', OUT)

    branches, pulls, taken = [], [], {'main'}
    for b in sorted(git('for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/').split()):
        if b in ('main', 'HEAD'):
            continue
        ref, s = f'refs/remotes/origin/{b}', slug(b, taken)
        dest = os.path.join(OUT, 'v', s)
        export(ref, dest)
        if add_badge(dest, f'Version: {b}'):
            branches.append((f'../v/{s}/', b, last_commit(ref)))

    for pr in sorted(open_pulls(), key=lambda p: p['number']):
        n, ref = pr['number'], f'refs/remotes/pr/{pr["number"]}'
        if subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref], capture_output=True).returncode:
            continue
        dest = os.path.join(OUT, 'pr', str(n))
        export(ref, dest)
        if add_badge(dest, f'Pull request #{n} (not merged)'):
            pulls.append((f'../pr/{n}/', f'#{n} {pr["title"]}', f'by {pr["user"]["login"]}, not reviewed yet'))

    write_versions_page(branches, pulls)
    print(f'main + {len(branches)} version(s) + {len(pulls)} pull request(s) -> {OUT}')


if __name__ == '__main__':
    main()
