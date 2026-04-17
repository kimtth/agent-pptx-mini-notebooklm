---
name: Post-Staging QA Workflow
description: Quality-assurance and visual-fix workflow that runs after create-pptx to detect and correct contrast violations, missing icons/images, layout overlaps, text overflows, and user-requested visual changes.
engine: copilot
tools:
  github:
    toolsets: [default]
---

# Post-Staging QA Workflow

Review the generated PPTX deck for visual quality issues and apply corrective action — either from the automated QA report or from user-requested visual changes.

## Objective

After the create-pptx workflow produces a deck, inspect the structured QA report for defects — color contrast violations, missing icons or images, overlapping shapes, and text overflow — and decide whether to accept the result or trigger a targeted fix-and-regenerate cycle.  This workflow also handles user-requested cosmetic and style changes (font colors, fill behavior, design style, etc.) by patching the serialised renderer artifacts.

## Inputs

- **QA Report** (when auto-triggered) — structured findings from the PPTX pipeline.
- **User request** (when manually triggered) — a natural-language description of the desired visual change.
- Approved slide panel content (same source of truth used by create-pptx).
- Current theme, palette, icon set, and attached images.

## Available Artifacts

The following JSON files live under `previews/` and are patchable via `patch_layout_infrastructure`:

| File key        | File name              | Purpose |
|-----------------|------------------------|---------|
| `layout_input`  | `layout-input.json`    | Slide content: titles, bullets, key messages, image/icon references |
| `layout_specs`  | `layout-specs.json`    | Precomputed geometry from the constraint solver |
| `slide_assets`  | `slide-assets.json`    | Icon & image metadata per slide |
| `render_config` | `render-config.json`   | **Renderer configuration** — theme colors, font family, color treatment, text box style, corner style, design style name, show-slide-icons flag, custom background color, icon collection |

### `render-config.json` fields

```json
{
  "themeColors": { "primary": "...", "secondary": "...", ... },
  "themeExplicit": true,
  "title": "Presentation Title",
  "fontFamily": "Calibri",
  "colorTreatment": "solid | gradient | mixed",
  "textBoxStyle": "plain | with-icons | mixed",
  "textBoxCornerStyle": "square | rounded",
  "showSlideIcons": true,
  "designStyle": "Swiss International",
  "customBackgroundColor": "",
  "iconCollection": "all"
}
```

**`designStyle`** controls the visual preset (panel fills, accent bars, decorative shapes, dark mode, etc.).  To change panel fill behavior, change `designStyle` to a preset that uses the desired `panel_fill` mode, or change `colorTreatment` / `textBoxCornerStyle` for targeted overrides.

## Required Process

1. **Classify the request** — determine whether this is an automated QA pass (QA report present) or a user-driven visual fix request.
2. **Read the relevant artifact** — use `patch_layout_infrastructure` with `action="read"` to inspect the current state of the artifact you need to modify.
3. **Patch the artifact** — use `patch_layout_infrastructure` with `action="patch"` to apply the minimal change.
4. **Rerun the renderer** — call `rerun_pptx` to regenerate the deck with the patched artifacts.

## Rules

- Do NOT re-generate the entire deck when only specific slides or settings need change. Target the minimal fix.
- Do NOT inspect or patch application source files (e.g., `style_config.py`, `slide_renderer.py`). Restrict corrective work to the generated preview artifacts only.
- For visual/style changes (font, color, fill, panel behavior), patch `render_config`. For content/layout changes, patch `layout_input` or `layout_specs`.
- Missing icons stay blocking only when the aggregate missing ratio is 40% or higher; below that threshold, treat them as actionable warnings.
- Do NOT claim that a patch or rerender succeeded unless the corresponding tool call actually ran and returned success.
- If no tool was executed, explicitly say no change was applied yet.

## Output Contract

- When all findings are clear: output a short confirmation message.
- When corrective action is needed: output `patch_layout_infrastructure` action(s) followed by `rerun_pptx`.

## Success Criteria

- Zero blocking findings after post-staging completes.
- User-requested visual changes are reflected in the re-rendered deck.
