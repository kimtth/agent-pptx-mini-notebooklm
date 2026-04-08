---
name: Post-Staging QA Workflow
description: Automated quality-assurance pass that runs after create-pptx to detect and correct contrast violations, missing icons/images, layout overlaps, and text overflows.
engine: copilot
tools:
  github:
    toolsets: [default]
---

# Post-Staging QA Workflow

Review the generated PPTX deck for visual quality issues and either confirm the deck is ready or drive corrective action.

## Objective

After the create-pptx workflow produces a deck, inspect the structured QA report for four categories of defect — color contrast violations, missing icons or images, overlapping shapes, and text overflow — and decide whether to accept the result or trigger a targeted fix-and-regenerate cycle.

## Inputs

- **QA Report** — structured findings from the PPTX pipeline covering:
  - `contrastFixes` — number of low-contrast text/fill pairs auto-corrected during generation.
  - `missingIcons` — list of icon IDs that `fetch_icon()` could not resolve, with slide context.
  - `missingImages` — list of approved images omitted from the generated slides.
  - `layoutIssues` — overlap, out-of-bounds, cramped spacing, and text overflow findings from the layout validator, each with severity (`error` | `warning` | `info`).
- Approved slide panel content (same source of truth used by create-pptx).
- Current theme, palette, icon set, and attached images.

## Required Process

1. **Receive QA Report** — the app injects the structured QA findings into the chat context automatically after deck generation succeeds.
2. **Classify Findings** — sort each finding into one of the four categories and assign a severity:
   - **Blocking** — any missing approved image, any missing icon, any ERROR-level overlap or text overflow.
   - **Actionable** — WARNING-level overlap or cramped spacing, unresolved contrast issues that survived the automatic Python fix.
   - **Informational** — INFO-level spacing notices, successfully applied contrast fixes.
3. **Report Summary** — present a concise per-slide summary to the user:
   - ✅ slides that passed with zero or only informational findings.
   - ⚠️ slides with actionable warnings.
   - ❌ slides with blocking issues.
4. **Decide Corrective Action** — based on the category of the worst finding:
   - **No blocking or actionable issues** → Confirm the deck is ready. Stop.
   - **Missing images or icons (blocking)** → Regenerate the affected slide code, ensuring ALL approved images are placed via `slide_image_paths()` / `safe_add_picture()` and ALL icons are fetched via `fetch_icon()`. Output the corrected python-pptx code block.
   - **Layout overlap or text overflow (blocking)** → Use `patch_layout_infrastructure` to read the current layout specs or validator thresholds, patch as needed, then call `rerun_pptx` to re-execute.
   - **Unresolved contrast (actionable)** → Regenerate the affected slide code with explicit `ensure_contrast()` calls for the flagged text/background pairs. Output the corrected python-pptx code block.
5. **Verify Fix** — after corrective action, the pipeline automatically re-runs post-staging. If the new QA report still contains blocking or actionable issues, repeat from step 2 (up to the app's auto-retry limit).

## Rules

- Do NOT re-generate the entire deck when only specific slides have issues. Target the minimal fix.
- Do NOT dismiss missing icons or images as cosmetic — they are blocking defects because the user explicitly approved those assets.
- Contrast fixes applied automatically by the Python pipeline are informational only. Only escalate contrast findings that survived the automatic fix.
- Preserve the existing theme, palette, and design style during any corrective regeneration.
- Do NOT output slide listings, narrative brainstorming, or status updates. Output only the corrective action (code block or tool call) or the final acceptance confirmation.

## Output Contract

- When all findings are clear: output a short confirmation message summarizing the QA pass (e.g. "All 8 slides passed post-staging QA — deck is ready.").
- When corrective action is needed: output either:
  - A complete, self-contained python-pptx code block targeting the affected slides. Do not output a partial snippet or diff. The block must be executable as-is so the app can detect it and regenerate the deck.
  - A `patch_layout_infrastructure` + `rerun_pptx` tool sequence for layout issues.

## Success Criteria

- Zero blocking findings after post-staging completes.
- Zero actionable findings after post-staging completes (or explicitly accepted by the user).
- The user sees a clear per-slide QA summary before any corrective action is taken.
