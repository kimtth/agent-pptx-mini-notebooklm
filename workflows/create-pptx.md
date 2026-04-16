---
name: Create PPTX Workflow
description: Render the presentation using the deterministic renderer with automated layout validation, and fix any issues via tool calls.
engine: copilot
tools:
	github:
		toolsets: [default]
---

# Create PPTX Workflow

Render the presentation using the deterministic renderer and fix layout issues.

## Objective

Use the approved slide content, icons, theme, and images to render the final PPTX via the deterministic renderer. Fix any layout validation issues by patching infrastructure files and re-rendering.

## Inputs

- Approved slide panel content (layout-input.json).
- Layout specs (layout-specs.json).
- Slide assets including icons and images (slide-assets.json).
- Active theme and palette.

## Required Process

1. Use `rerun_pptx` to trigger the deterministic renderer.
2. The renderer reads layout-input.json, layout-specs.json, and slide-assets.json automatically.
3. The layout validator runs automatically after rendering.
4. If validation fails with ERROR-level issues, use `patch_layout_infrastructure` to fix the layout specs or slide assets, then use `rerun_pptx` to re-render.
5. Report the result briefly.

## Rules

- Do NOT generate Python code. All rendering is handled by the deterministic renderer.
- The layout validator runs automatically — it replaces manual review.
- Use `patch_layout_infrastructure` to modify layout-specs.json, layout-input.json, or slide-assets.json when fixes are needed.
- Use `rerun_pptx` to re-render after making changes.
- Keep chat messages short — report what was fixed and the result.
- Do not output slide listings, framework brainstorming, or narrative status updates.

## Output Contract

- Use tool calls only. No code blocks.
- Report validation results and any fixes applied.

## Success Criteria

- The rendered PPTX passes the layout validator with no ERROR-level issues.
- The composition is visually consistent across slides.
- All approved images and icons are present.
