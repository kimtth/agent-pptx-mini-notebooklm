# pptx-slide-agent

Electron desktop app for generating PowerPoint decks from chat, files, and URLs with the GitHub Copilot SDK.

<img src="./samples/main.png" alt="main screen" width="500" />

## Documentation Index

- [Quick Start (English)](./QUICK_START.md)
- [Quick Start (Japanese)](./QUICK_START_JP.md)
- [Layout Engine Whitepaper](./LAYOUT_ENGINE.md)
- [Sample PPTX English (Web Viewer)](https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fraw.githubusercontent.com%2Fkimtth%2Fagent-cowork-pptx-creator%2Fmain%2Fsamples%2Fen%2Fpreviews%2Fpresentation-preview.pptx)

## Getting Started

Requirements:

- Node.js with `pnpm`
- `uv` and Python 3.13+
- `GITHUB_TOKEN` with Copilot access, or Azure OpenAI credentials
- Microsoft PowerPoint on Windows for local preview rendering and COM-based layout measurement

Install dependencies:

```bash
pnpm install
```

Set up the Python environment once:

```bash
pnpm setup:python-env
```

If you use Azure OpenAI instead of GitHub-hosted models, set `AZURE_OPENAI_ENDPOINT`, `MODEL_NAME`, and either `AZURE_OPENAI_API_KEY` or Azure login credentials.

Run the development server:

```bash
pnpm dev
```

Build:

```bash
pnpm dist
```

If `.venv` already exists and you only want to package:

```bash
pnpm dist:skip-venv
```

Useful check:

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
MODEL_NAME=gpt-5.4
REASONING_EFFORT=medium

# Azure only
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/openai/v1
AZURE_OPENAI_API_KEY=your_api_key
AZURE_TENANT_ID=your_tenant_id
```

Notes:

- For [GitHub-hosted models](https://models.github.ai/catalog/models), use a token with Copilot entitlement.
- For Azure, use the full base URL including `/openai/v1`.
- `MODEL_NAME` can be a GitHub-hosted model such as `gpt-5.4` or an Azure deployment/model name.

## Python Environment

Datasource ingestion and PPTX generation use a local `uv`-managed Python environment so MarkItDown and `python-pptx` stay isolated from the system Python installation.

This creates `.venv` and installs the dependencies declared in [pyproject.toml](pyproject.toml). The Electron app automatically prefers that interpreter for both content ingestion and PPTX generation.

For packaged builds, `.venv` is bundled into the app's `resources` directory. `pnpm dist:skip-venv` only skips recreating the environment; it still requires an existing `.venv` in the repo root.

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
| `layout_specs.py` | `LayoutSpec` / `RectSpec` dataclasses and `flow_layout_spec()` cascade helper |
| `layout_validator.py` | Post-generation validation (overlap, bounds, text overflow) |

Pre-computed specs are injected as `PRECOMPUTED_LAYOUT_SPECS` into the generated code namespace. Requires `kiwisolver` and `pywin32` (Windows + PowerPoint).

Hybrid layout artifacts are stored in the active workspace under `previews/`:
- `layout-input.json` — the storyboard-derived `SlideContent[]` payload written immediately when `set_scenario` runs and refreshed again before layout computation
- `layout-specs.json` — the computed `LayoutSpec[]` output written by `hybrid_layout.py`

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

- Rendered preview assets are stored under `previews/` in the configured workspace directory.
- On Windows, local rendering requires Microsoft PowerPoint and the managed Python environment.
- `Refresh Preview` reloads preview images that already exist in the workspace.

## Agentic Workflows

Prompt workflow files live here:

- [workflows/prestaging.md](workflows/prestaging.md)
- [workflows/create-pptx.md](workflows/create-pptx.md)

The runtime wiring is in [electron/ipc/copilot-runtime.ts](electron/ipc/copilot-runtime.ts).
