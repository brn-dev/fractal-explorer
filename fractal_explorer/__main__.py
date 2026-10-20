import argparse
import threading
import webbrowser

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="Local CUDA fractal explorer")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{args.port}")).start()
    uvicorn.run("fractal_explorer.server:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
