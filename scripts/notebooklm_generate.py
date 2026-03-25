"""
NotebookLM artifact generator — called by Electron IPC.

Usage:
  python notebooklm_generate.py <command> <json_args>

Commands:
  auth_status   — Check if the user is authenticated
  list          — List all notebooks
  infographic   — Generate an infographic from a notebook
  slide_deck    — Generate a slide deck from a notebook
  download      — Download a generated artifact

JSON args are passed as a single argument string.
"""

from __future__ import annotations

import asyncio
import json
import sys


async def auth_status() -> dict:
    from notebooklm import NotebookLMClient

    try:
        async with await NotebookLMClient.from_storage() as client:
            notebooks = await client.notebooks.list()
            return {"authenticated": True, "notebookCount": len(notebooks)}
    except Exception as exc:
        return {"authenticated": False, "error": str(exc)}


async def list_notebooks() -> dict:
    from notebooklm import NotebookLMClient

    async with await NotebookLMClient.from_storage() as client:
        notebooks = await client.notebooks.list()
        return {
            "notebooks": [
                {"id": nb.id, "title": getattr(nb, "title", nb.id)}
                for nb in notebooks
            ]
        }


async def generate_infographic(args: dict) -> dict:
    from notebooklm import NotebookLMClient

    notebook_id: str = args["notebookId"]
    output_path: str = args["outputPath"]
    orientation: str = args.get("orientation", "landscape")
    detail_level: str = args.get("detailLevel", "standard")

    async with await NotebookLMClient.from_storage() as client:
        status = await client.artifacts.generate_infographic(
            notebook_id,
            orientation=orientation,
            detail_level=detail_level,
        )
        await client.artifacts.wait_for_completion(notebook_id, status.task_id)
        await client.artifacts.download_infographic(notebook_id, output_path)

    return {"success": True, "path": output_path}


async def generate_slide_deck(args: dict) -> dict:
    from notebooklm import NotebookLMClient

    notebook_id: str = args["notebookId"]
    output_path: str = args["outputPath"]
    fmt: str = args.get("format", "pptx")

    async with await NotebookLMClient.from_storage() as client:
        status = await client.artifacts.generate_slide_deck(notebook_id)
        await client.artifacts.wait_for_completion(notebook_id, status.task_id)

        if fmt == "pptx":
            await client.artifacts.download_slide_deck(notebook_id, output_path)
        else:
            await client.artifacts.download_slide_deck(
                notebook_id, output_path
            )

    return {"success": True, "path": output_path}


async def download_artifact(args: dict) -> dict:
    from notebooklm import NotebookLMClient

    notebook_id: str = args["notebookId"]
    artifact_type: str = args["artifactType"]
    output_path: str = args["outputPath"]

    async with await NotebookLMClient.from_storage() as client:
        downloader = getattr(
            client.artifacts, f"download_{artifact_type}", None
        )
        if downloader is None:
            return {
                "success": False,
                "error": f"Unknown artifact type: {artifact_type}",
            }
        await downloader(notebook_id, output_path)

    return {"success": True, "path": output_path}


COMMANDS = {
    "auth_status": lambda _: auth_status(),
    "list": lambda _: list_notebooks(),
    "infographic": lambda a: generate_infographic(a),
    "slide_deck": lambda a: generate_slide_deck(a),
    "download": lambda a: download_artifact(a),
}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command"}))
        sys.exit(1)

    command = sys.argv[1]
    args: dict = {}
    if len(sys.argv) >= 3:
        args = json.loads(sys.argv[2])

    handler = COMMANDS.get(command)
    if handler is None:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)

    result = asyncio.run(handler(args))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
