#!/usr/bin/env python3
"""Tiny static file server for the banking web UI.
- /login becomes login.html (links without .html work)
- no-cache headers, so a normal refresh always shows your latest edits
Usage: python3 serve.py [port]    (default 3000)
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        resolved = super().translate_path(path)
        if not os.path.exists(resolved) and not os.path.splitext(resolved)[1]:
            if os.path.isfile(resolved + ".html"):
                return resolved + ".html"
        return resolved

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    handler = partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print("Serving " + ROOT + " on http://localhost:" + str(port))
        server.serve_forever()
