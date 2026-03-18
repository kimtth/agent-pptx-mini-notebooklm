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
5. If layout validation fails, use `patch_layout_infrastructure` to fix layout_specs.py or layout_validator.py, then call `rerun_pptx`.
6. Return only the final python code block for the app's rendering pipeline.

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