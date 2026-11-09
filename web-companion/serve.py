#!/usr/bin/env python3
"""Static server for the web companion, with cross-origin isolation headers.

COOP/COEP make pages "cross-origin isolated", which browsers require before
WebAssembly may use several threads (SharedArrayBuffer). The in-browser voice
test (kitten-test.html) is several times faster with threads. Everything it
loads is served from here (web-companion/models/), so require-corp is safe.

  python3 web-companion/serve.py [--port 8730] [--bind 127.0.0.1]
"""
import argparse
import functools
import http.server
import pathlib


class IsolatedHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        # Model/runtime files never change under the same name; the app files can.
        if self.path.startswith("/models/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8730)
    ap.add_argument("--bind", default="127.0.0.1")
    args = ap.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    handler = functools.partial(IsolatedHandler, directory=str(root))
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
