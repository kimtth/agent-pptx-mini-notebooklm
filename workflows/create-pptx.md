---
name: Create PPTX Workflow
description: Generate final python-pptx output from the approved slide plan, using the current theme, icons, and attached images with automated layout validation.
engine: copilot
tools:
	github:
		toolsets: [default]
---

# Create PPTX Workflow

Generate the final python-pptx implementation for the presentation with automated layout validation.

## Objective

Use the approved slide content, icon set, theme, colors, and slide images to generate final python-pptx code that the app can render locally for preview.

## Inputs

- Approved slide panel content.
- Selected icon set and available icons.
- Active theme, palette, and color choices.
- Images attached to each slide.
- Existing build errors, if present.

## Required Process

1. Use the current approved slide panel content as the source of truth.
2. Apply the selected theme, palette, icon set, and slide-specific attached images consistently.
3. Ensure contrast safety (no white-on-white, dark-on-dark, or mid-tone-on-mid-tone) and readability.
4. Generate the final python-pptx code. The layout validator automatically checks for overlap, out-of-bounds, and text overflow after generation.
5. If layout validation fails, inspect and repair `layout_specs.py` or `layout_validator.py` with the available app repair tooling, then rerun the render.
6. Return only the final python code block for the app's rendering pipeline.

## Efficiency Directive — No Codebase Exploration

**CRITICAL: Do NOT explore, read, or grep the application codebase during PPTX generation.**

The conversation already provides everything needed to generate python-pptx code:
- Slide content, titles, bullets, key messages, notes, and layout types
- Theme palette and OOXML slot values
- Design style rules and signature elements
- Icon names and image paths per slide
- The full runtime namespace (all available functions, variables, and classes)
- The `manipulation-pptx` skill with API contracts, code patterns, and rules

The **only** workspace files that may be read are these three small JSON artifacts:
1. `{workspace}/previews/layout-input.json` — slide content for `layout_input[]`
2. `{workspace}/previews/layout-specs.json` — precomputed geometry for `PRECOMPUTED_LAYOUT_SPECS[]`
3. `{workspace}/previews/slide-assets.json` — icon/image metadata per slide

**Prohibited during this workflow:**
- Reading `pptx-python-runner.py`, `pptx-handler.ts`, `slide_renderer.py`, or `layout_validator.py`
- Reading `AGENTS.md`, `CLAUDE.md`, or instruction files from other projects
- Grepping for function signatures, import paths, or module internals
- Running the Python runner manually or attempting to validate locally — the app handles execution and validation automatically
- Reading previously generated `generated-source.py` files from other sample workspaces (unless explicitly asked to replicate a pattern)

**Allowed efficiency shortcuts:**
- Reading one existing `generated-source.py` sample to confirm the code pattern (one-time, first generation only)
- Reading the `manipulation-pptx` SKILL.md if the skill context was not already loaded

**Target: 3 file reads → code output.** Not 15+ exploratory reads.

## Rules

- The layout validator runs automatically after code generation — it replaces manual review.
- Use attached slide images as grounded design inputs.
- Preserve theme consistency and business clarity across the full deck.
- When a design uses translucent fills, use the runtime helper `set_fill_transparency(shape, value)` or manipulate OOXML via `shape._element.spPr`. Never call XML methods on `shape.fill._fill`.
- Output only the final python-pptx implementation for this workflow.
- Do not output slide listings, framework brainstorming, or narrative status updates.
- Use runtime variables such as `OUTPUT_PATH`, `PPTX_TITLE`, and `PPTX_THEME` correctly.

## Output Contract

- Return one final python code block only.
- The code should be suitable for local preview image rendering in the app.
- The code should reflect the approved theme and attached slide imagery.

## Success Criteria

- The generated PPTX composition passes the layout validator with no ERROR-level issues.
- The composition is visually consistent across slides.
- The final code is valid for local rendering and PPTX export.
