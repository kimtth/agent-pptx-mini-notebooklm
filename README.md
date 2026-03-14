# pptx-slide-agent

Electron desktop app for AI-powered PowerPoint slide generation using the GitHub Copilot SDK.

## Getting Started

Run the development server:
```
pnpm dev
```

## Github Copilot SDK

[Getting Started](https://github.com/github/copilot-sdk?tab=readme-ov-file#getting-started)  

All SDKs communicate with the Copilot CLI server via JSON-RPC:

```
Your Application
       ↓
  SDK Client
       ↓ JSON-RPC
  Copilot CLI (server mode)
```

## Settings

**GitHub PAT permissions:**
- **Classic PAT** — no specific scope needed; the account must have an active Copilot subscription.
- **Fine-grained PAT** — Under "Permissions," click Add permissions and select **Copilot Requests**.

```env
# Required: GitHub PAT with Copilot access
GITHUB_TOKEN=your_github_token

# Required for Azure OpenAI (omit to use GitHub-hosted models)
MODEL_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com

# Optional: override the default model/deployment
MODEL_NAME=gpt-5
```

## Python Environment

Datasource ingestion and PPTX generation use a local `uv`-managed Python environment so MarkItDown and `python-pptx` stay isolated from the system Python installation.

Set it up once from the repo root:

```bash
pnpm setup:python-env
```

This creates `.venv` and installs the dependencies declared in [pyproject.toml](pyproject.toml). The Electron app automatically prefers that interpreter for both content ingestion and PPTX generation.

`pnpm setup:python-env` is available as an alias for the same environment setup.

### python-pptx

https://python-pptx.readthedocs.io/

PPTX generation runs through a bundled Python runner at [scripts/pptx-python-runner.py](scripts/pptx-python-runner.py), which executes agent-generated `python-pptx` code with the runtime variables `OUTPUT_PATH`, `PPTX_TITLE`, and `PPTX_THEME`.

### Layout Engine

Layout modules live in `scripts/layout/` and compute content-adaptive slide coordinates **before** the LLM generates `python-pptx` code.

#### Execution Order

```
pptx-handler.ts
  │
  ├─ 1. computeLayoutSpecs()          Call hybrid_layout.py as subprocess
  │       ↓
  │     hybrid_layout.py               Orchestrator (CLI entry point)
  │       ├─ layout_blueprint.py       Load declarative zone definitions
  │       ├─ com_text_measure.py       Measure text heights via PowerPoint COM
  │       └─ constraint_solver.py      Solve zone positions with kiwisolver
  │             └─ layout_specs.py     Emit LayoutSpec / RectSpec dataclasses
  │       ↓
  │     LayoutSpec JSON (stdout)
  │
  ├─ 2. executeGeneratedPythonCodeToFile()
  │       ↓  PPTX_LAYOUT_SPECS_JSON env var
  │     pptx-python-runner.py          Deserialize specs → PRECOMPUTED_LAYOUT_SPECS
  │       └─ exec(generated code)      LLM code uses specs for positioning
  │
  └─ 3. Post-generation
          layout_validator.py           Validate overlap, bounds, text overflow
```

| Module | Role |
|--------|------|
| `hybrid_layout.py` | Orchestrator + JSON serialization + CLI entry point |
| `layout_blueprint.py` | Declarative zone definitions for 10 layout types |
| `com_text_measure.py` | PowerPoint COM AutoFit text height measurement (Windows) |
| `constraint_solver.py` | Kiwisolver (Cassowary) constraint solver → `LayoutSpec` |
| `layout_specs.py` | `LayoutSpec` / `RectSpec` dataclasses and fallback `get_layout_spec()` |
| `layout_validator.py` | Post-generation validation (overlap, bounds, text overflow) |

Pre-computed specs are injected as `PRECOMPUTED_LAYOUT_SPECS` into the generated code namespace. Requires `kiwisolver` and `pywin32` (Windows + PowerPoint).

## Persistent Storage

App data is stored in the Electron `userData` directory:

| File | Path (Windows) | Description |
|------|----------------|-------------|
| `settings.json` | `%APPDATA%\pptx-slide-agent\settings.json` | API keys, model settings, and other preferences |
| `workspace.json` | `%APPDATA%\pptx-slide-agent\workspace.json` | Last-used workspace directory |

On macOS the equivalent path is `~/Library/Application Support/pptx-slide-agent/`.

### Project Files

Work can be saved and loaded as `.pptapp` project files (JSON). A project snapshot includes:
- Slide outline / story content
- Chat message history
- Full palette configuration (theme slots and tokens)

## Preview

The center preview panel renders local slide images from the generated PPTX.

- The app generates the deck through the existing Python runner and exports slide images locally for preview.
- Rendered preview assets are stored under `previews/` in the configured workspace directory.
- On Windows, local rendering requires Microsoft PowerPoint and the `pywin32` package in the managed Python environment.
- Preview rendering is local and does not require a public URL.

## Agentic Workflows

Repository-level Copilot workflow instructions live under [workflows/prestaging.md](workflows/prestaging.md) and [workflows/create-pptx.md](workflows/create-pptx.md).

- `prestaging.md` defines the planning workflow for understanding content, selecting a framework, and staging slide definitions.
- `create-pptx.md` defines the final PPTX workflow with automated layout validation and infrastructure patching tools.
- `electron/ipc/copilot-runtime.ts` defines the root workflow instruction path used by the app when building Copilot prompts.
