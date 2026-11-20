#!/usr/bin/env python3
"""
Smoke test. Lints the PHP files and syntax-checks the script, then serves the tree with PHP's built-in server, fetches the
page and the files it loads, and checks that each answers 200 with the content it should. Standard
library only; needs `php` on PATH.

    python tests/smoke.py          exit 0 = all passed
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCROOT = os.path.join(ROOT, 'public')
PAGE = '/projects/pegsmith/'
LINT = [
    # argv after the interpreter; the first item names which interpreter ('php' or 'node')
    ('php', ['-l', 'public/projects/pegsmith/index.php']),
    ('php', ['-l', 'public/includes/head.php']),
    ('php', ['-l', 'public/includes/nav.php']),
    ('php', ['-l', 'public/includes/scripts.php']),
    ('php', ['-l', 'public/includes/escape.php']),
    ('php', ['-l', 'public/index.php']),
    ('node', ['--check', 'public/projects/pegsmith/assets/js/pegsmith.js']),
]
CHECKS = [
    # path, substring that must be in the body, content-type prefix
    (PAGE, '<title>Pegsmith</title>', 'text/html'),
    (PAGE, 'class="ps-shell"', 'text/html'),
    (PAGE, 'class="pw-strip"', 'text/html'),               # the nav stand-in rendered
    (PAGE, 'pegsmith.light.css?v=', 'text/html'),          # pw_light_css() found the companion sheet
    ('/projects/pegsmith/assets/css/pegsmith.css', '.ps-shell', 'text/css'),
    ('/projects/pegsmith/assets/css/pegsmith.light.css', 'html[data-theme="light"]', 'text/css'),
    ('/projects/pegsmith/assets/js/pegsmith.js', 'localStorage', ''),
    ('/assets/site/chrome.css', '.pw-strip', 'text/css'),
    ('/assets/site/chrome.js', 'pw-theme', ''),
]


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def lint(php):
    fail = 0
    for kind, args in LINT:
        exe = php if kind == 'php' else shutil.which('node')
        if not exe:
            print(f'skip {kind} {" ".join(args)} (node is not on PATH)')
            continue
        r = subprocess.run([exe, *args], cwd=ROOT, capture_output=True, text=True)  # noqa: S603  fixed argv, no shell
        ok = r.returncode == 0
        print(f"{'ok  ' if ok else 'FAIL'} {kind} {' '.join(args)}" + ('' if ok else '\n' + (r.stdout + r.stderr).strip()))
        fail += 0 if ok else 1
    return fail


def main():
    php = shutil.which('php')
    if not php:
        sys.exit('smoke: php is not on PATH')
    fail = lint(php)
    port = free_port()
    srv = subprocess.Popen([php, '-S', f'127.0.0.1:{port}', '-t', DOCROOT],  # noqa: S603  fixed argv, no shell
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f'http://127.0.0.1:{port}'
        for _ in range(50):
            try:
                urllib.request.urlopen(base + PAGE, timeout=2).read()  # noqa: S310  local test server
                break
            except Exception:  # noqa: BLE001  the server is still starting
                time.sleep(0.1)
        for path, needle, ctype in CHECKS:
            try:
                with urllib.request.urlopen(base + path, timeout=10) as r:  # noqa: S310  local test server
                    body = r.read()
                    status = r.status
                    got_type = r.headers.get('Content-Type', '')
            except Exception as e:  # noqa: BLE001
                print(f'FAIL {path}: {e}')
                fail += 1
                continue
            ok = status == 200 and got_type.startswith(ctype) and (needle is None or needle.encode() in body)
            print(f"{'ok  ' if ok else 'FAIL'} {path} -> {status} {got_type} {len(body)} bytes"
                  + ('' if ok or needle is None else f' (missing {needle!r})'))
            fail += 0 if ok else 1
        # the root redirects to the page
        req = urllib.request.Request(base + '/')  # noqa: S310  local test server
        try:
            opener = urllib.request.build_opener(NoRedirect)
            with opener.open(req, timeout=10) as r:
                code, loc = r.status, r.headers.get('Location', '')
        except urllib.error.HTTPError as e:
            code, loc = e.code, e.headers.get('Location', '')
        ok = code == 302 and loc == PAGE
        print(('ok  ' if ok else 'FAIL') + f' / -> {code} {loc}')
        fail += 0 if ok else 1
        # no PHP warning or notice leaked into the page
        with urllib.request.urlopen(base + PAGE, timeout=10) as r:  # noqa: S310  local test server
            page = r.read().decode('utf-8', 'replace')
        leaked = any(w in page for w in ('<b>Warning</b>', '<b>Notice</b>', '<b>Fatal error</b>', '<b>Deprecated</b>'))
        print(('FAIL' if leaked else 'ok  ') + ' no PHP warnings in the page')
        fail += 1 if leaked else 0
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except subprocess.TimeoutExpired:
            srv.kill()
    print(f'{fail} failed' if fail else 'all passed')
    sys.exit(1 if fail else 0)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


if __name__ == '__main__':
    main()
