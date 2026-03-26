"""
NotebookLM API bridge — long-lived stdio JSON-RPC server for Electron IPC.

Runs as a persistent child process. Reads newline-delimited JSON requests
from stdin, writes newline-delimited JSON responses to stdout.

Request format:  {"id": 1, "command": "list", "args": {}}
Response format: {"id": 1, "result": {...}}  or  {"id": 1, "error": "..."}

The NotebookLMClient session is kept alive across requests to avoid
repeated auth/connection overhead.

Commands:
  auth_status      — Check if the user is authenticated
  list             — List all notebooks
  create_notebook  — Find or create the fixed 'pptx-slide-agent' notebook
  upload_sources   — Upload files/text/URLs to a notebook
  infographic      — Generate an infographic
  slide_deck       — Generate a slide deck
  download         — Download an artifact
"""

from __future__ import annotations

import asyncio
import json
import os
import sys


def _login_command() -> str:
    return f'"{sys.executable}" -m notebooklm login'


FIXED_NOTEBOOK_TITLE = "pptx-slide-agent"


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------

async def cmd_auth_status(client, _args: dict) -> dict:
    """Check authentication by listing notebooks."""
    try:
        notebooks = await client.notebooks.list()
        return {"authenticated": True, "notebookCount": len(notebooks)}
    except Exception as exc:
        error_type = exc.__class__.__name__
        return {
            "authenticated": False,
            "error": str(exc),
            "errorType": error_type,
            "suggestion": f"Session may be stale. Run: {_login_command()}",
            "loginCommand": _login_command(),
        }


async def cmd_list(client, _args: dict) -> dict:
    notebooks = await client.notebooks.list()
    return {
        "notebooks": [
            {"id": nb.id, "title": getattr(nb, "title", nb.id)}
            for nb in notebooks
        ]
    }


async def cmd_create_notebook(client, _args: dict) -> dict:
    """Delete and recreate the fixed 'pptx-slide-agent' notebook to start fresh."""
    notebooks = await client.notebooks.list()
    for nb in notebooks:
        if getattr(nb, "title", "") == FIXED_NOTEBOOK_TITLE:
            await client.notebooks.delete(nb.id)
    nb = await client.notebooks.create(FIXED_NOTEBOOK_TITLE)
    return {"success": True, "notebookId": nb.id, "title": FIXED_NOTEBOOK_TITLE}


async def cmd_upload_sources(client, args: dict) -> dict:
    notebook_id: str = args["notebookId"]
    files: list[dict] = args.get("files", [])
    texts: list[dict] = args.get("texts", [])
    urls: list[str] = args.get("urls", [])

    uploaded: list[dict] = []
    errors: list[dict] = []

    for f in files:
        file_path = f.get("path", "")
        mime = f.get("mime", None)
        if not file_path or not os.path.isfile(file_path):
            errors.append({"path": file_path, "error": "File not found"})
            continue
        try:
            if not mime:
                ext = os.path.splitext(file_path)[1].lower()
                mime_map = {
                    ".pdf": "application/pdf",
                    ".csv": "text/csv",
                    ".txt": "text/plain",
                    ".md": "text/markdown",
                    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                }
                mime = mime_map.get(ext, "text/plain")
            src = await client.sources.add_file(notebook_id, file_path, mime_type=mime, wait=True, wait_timeout=120)
            uploaded.append({"type": "file", "path": file_path, "sourceId": src.id, "title": getattr(src, "title", file_path)})
        except Exception as exc:
            errors.append({"path": file_path, "error": str(exc)})

    for t in texts:
        title = t.get("title", "Untitled")
        content = t.get("content", "")
        if not content.strip():
            continue
        try:
            src = await client.sources.add_text(notebook_id, title=title, content=content, wait=True, wait_timeout=120)
            uploaded.append({"type": "text", "title": title, "sourceId": src.id})
        except Exception as exc:
            errors.append({"title": title, "error": str(exc)})

    for url in urls:
        if not url.strip():
            continue
        try:
            src = await client.sources.add_url(notebook_id, url=url.strip(), wait=True, wait_timeout=120)
            uploaded.append({"type": "url", "url": url, "sourceId": src.id, "title": getattr(src, "title", url)})
        except Exception as exc:
            errors.append({"url": url, "error": str(exc)})

    return {
        "success": len(uploaded) > 0,
        "uploaded": uploaded,
        "errors": errors,
        "uploadedCount": len(uploaded),
        "errorCount": len(errors),
    }


async def cmd_infographic(client, args: dict) -> dict:
    from notebooklm import InfographicOrientation, InfographicDetail

    notebook_id: str = args["notebookId"]
    output_path: str = args["outputPath"]

    orientation_map = {
        "landscape": InfographicOrientation.LANDSCAPE,
        "portrait": InfographicOrientation.PORTRAIT,
        "square": InfographicOrientation.SQUARE,
    }
    detail_map = {
        "concise": InfographicDetail.CONCISE,
        "standard": InfographicDetail.STANDARD,
        "detailed": InfographicDetail.DETAILED,
    }
    orientation = orientation_map.get(args.get("orientation", "landscape"), InfographicOrientation.LANDSCAPE)
    detail_level = detail_map.get(args.get("detailLevel", "standard"), InfographicDetail.STANDARD)

    status = await client.artifacts.generate_infographic(
        notebook_id, orientation=orientation, detail_level=detail_level,
    )
    await client.artifacts.wait_for_completion(notebook_id, status.task_id)
    await client.artifacts.download_infographic(notebook_id, output_path)
    return {"success": True, "path": output_path}


async def cmd_slide_deck(client, args: dict) -> dict:
    notebook_id: str = args["notebookId"]
    output_path: str = args["outputPath"]

    status = await client.artifacts.generate_slide_deck(notebook_id)
    await client.artifacts.wait_for_completion(notebook_id, status.task_id)
    await client.artifacts.download_slide_deck(notebook_id, output_path)
    return {"success": True, "path": output_path}


async def cmd_download(client, args: dict) -> dict:
    notebook_id: str = args["notebookId"]
    artifact_type: str = args["artifactType"]
    output_path: str = args["outputPath"]

    downloader = getattr(client.artifacts, f"download_{artifact_type}", None)
    if downloader is None:
        return {"success": False, "error": f"Unknown artifact type: {artifact_type}"}
    await downloader(notebook_id, output_path)
    return {"success": True, "path": output_path}


COMMANDS: dict[str, object] = {
    "auth_status": cmd_auth_status,
    "list": cmd_list,
    "create_notebook": cmd_create_notebook,
    "upload_sources": cmd_upload_sources,
    "infographic": cmd_infographic,
    "slide_deck": cmd_slide_deck,
    "download": cmd_download,
}


# ---------------------------------------------------------------------------
# Stdio JSON-RPC server (long-lived process)
# ---------------------------------------------------------------------------

async def _handle_request(client, req: dict) -> dict:
    """Process a single JSON-RPC request with a live client."""
    req_id = req.get("id")
    command = req.get("command", "")
    args = req.get("args", {})

    handler = COMMANDS.get(command)
    if handler is None:
        return {"id": req_id, "error": f"Unknown command: {command}"}

    try:
        result = await handler(client, args)
        return {"id": req_id, "result": result}
    except Exception as exc:
        return {"id": req_id, "error": f"{exc.__class__.__name__}: {exc}"}


async def serve_stdio() -> None:
    """Run as a long-lived stdio server, keeping the NotebookLM session open."""
    import io
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding='utf-8')
    if isinstance(sys.stderr, io.TextIOWrapper):
        sys.stderr.reconfigure(encoding='utf-8')

    from notebooklm import NotebookLMClient

    print(json.dumps({"status": "starting"}), flush=True)

    try:
        client = await NotebookLMClient.from_storage()
        await client.__aenter__()
    except Exception as exc:
        # If auth is missing, still start the server — auth_status will report
        # the error, and setupAuth is handled Node-side.
        print(json.dumps({"status": "ready", "authenticated": False, "error": str(exc)}), flush=True)
        # Run in unauthenticated mode — reconnect on each request
        await _serve_loop(None)
        return

    print(json.dumps({"status": "ready", "authenticated": True}), flush=True)

    try:
        await _serve_loop(client)
    finally:
        await client.__aexit__(None, None, None)


async def _serve_loop(client) -> None:
    """Read requests from stdin, dispatch, write responses to stdout."""
    from notebooklm import NotebookLMClient

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    # Read stdin in a thread — avoids ProactorEventLoop pipe issues on Windows
    def _reader() -> None:
        try:
            for raw in sys.stdin.buffer:
                line = raw.decode("utf-8", errors="replace").strip()
                if line:
                    loop.call_soon_threadsafe(queue.put_nowait, line)
        except (OSError, ValueError):
            pass
        loop.call_soon_threadsafe(queue.put_nowait, None)

    import threading
    threading.Thread(target=_reader, daemon=True).start()

    while True:
        line = await queue.get()
        if line is None:
            break  # stdin closed — parent process exited

        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"id": None, "error": f"Invalid JSON: {exc}"}), flush=True)
            continue

        # If we have no client (auth failed at startup), try reconnecting
        if client is None:
            command = req.get("command", "")
            try:
                new_client = await NotebookLMClient.from_storage()
                await new_client.__aenter__()
                client = new_client  # promote to permanent session
            except Exception as exc:
                if command == "auth_status":
                    error_type = exc.__class__.__name__
                    if error_type in ('FileNotFoundError', 'StorageNotFoundError'):
                        suggestion = f'No saved session. Run: {_login_command()}'
                    else:
                        suggestion = f'Run: {_login_command()} then retry.'
                    resp = {"id": req.get("id"), "result": {
                        "authenticated": False,
                        "error": str(exc),
                        "errorType": error_type,
                        "suggestion": suggestion,
                        "loginCommand": _login_command(),
                    }}
                else:
                    resp = {"id": req.get("id"), "error": f"Not authenticated: {exc}"}
                print(json.dumps(resp), flush=True)
                continue

        resp = await _handle_request(client, req)
        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    # Windows ProactorEventLoop has broken pipe transport support that causes
    # OSError: [WinError 6] in _ProactorReadPipeTransport._loop_reading().
    # Force SelectorEventLoop to avoid IOCP-related crashes.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(serve_stdio())
