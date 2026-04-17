---
name: manipulation-pptx
description: >
  Review and repair PPTX presentations rendered by the deterministic slide renderer.
  Covers layout validation, fixing overlap/overflow issues, and patching infrastructure files.
---

# PPTX Layout Review & Repair Skill

Review, validate, and repair PowerPoint presentations rendered by the deterministic slide renderer (`slide_renderer.py`).

This skill handles:

1. **Review** — Inspect rendered output for layout issues (overlap, text overflow, out-of-bounds shapes).
2. **Repair** — Patch infrastructure files (`layout-input.json`, `layout-specs.json`, `slide-assets.json`) and re-render.

This skill is **not** responsible for generating Python code. All PPTX rendering is handled automatically by the deterministic renderer.

## CRITICAL: Do NOT Generate Python Code

The LLM must NEVER output Python code blocks for PPTX rendering. The deterministic renderer handles all rendering automatically. Instead, use the available tools:

- `patch_layout_infrastructure` — Modify layout specs, slide assets, or layout input when fixes are needed.
- `rerun_pptx` — Re-render the presentation after making changes.

If you feel the urge to write `python-pptx` code, STOP. Use the tools instead.

## How Rendering Works

The deterministic renderer (`slide_renderer.py`) reads three JSON files from the workspace:

1. `previews/layout-input.json` — Slide content (titles, bullets, key messages, layout types)
2. `previews/layout-specs.json` — Precomputed geometry (title_rect, content_rect, cards, stats, etc.)
3. `previews/slide-assets.json` — Icon names, image paths, and metadata per slide

The renderer produces PPTX directly from these files using fixed layout functions. No LLM-generated code is involved. The renderer handles:

- Background fills and design language (panels, shadows, stripes, accent bars)
- Text placement with adaptive font sizing and overflow prevention
- Icon fetching from Iconify and placement
- Image tiling and positioning
- Theme color application with contrast safety
- Style-specific rendering (glassmorphism, brutalism, etc.)

## Layout Specs Reference

Each slide in `layout-specs.json` contains a `LayoutSpec` with these fields:

- `title_rect`, `key_message_rect`, `accent_rect`, `icon_rect`, `content_rect`, `notes_rect`
- `summary_box`, `hero_rect`, `chips_rect`, `footer_rect`, `sidebar_rect`
- `max_items`, `row_step`
- `cards` (CardsSpec), `stats` (StatsSpec), `timeline` (TimelineSpec), `comparison` (ComparisonSpec)

All coordinates are in inches. The slide is 13.333" × 7.5" (widescreen 16:9).

## Common Layout Issues and Fixes

### Overlap Errors
- **Cause**: Two shapes share overlapping (x, x+w) AND (y, y+h) ranges.
- **Fix**: Adjust coordinates in `layout-specs.json` — reduce width, shift x/y, or increase spacing.

### Text Overflow Errors
- **Cause**: Text content exceeds the allocated box height.
- **Fix**: Increase box height in `layout-specs.json`, reduce bullet count in `layout-input.json`, or shorten text.

### Out-of-Bounds Errors
- **Cause**: Shape extends past slide boundaries (x+w > 13.333 or y+h > 7.5).
- **Fix**: Reduce x+w or y+h values in `layout-specs.json`.

### Missing Images/Icons
- **Cause**: Invalid paths in `slide-assets.json`.
- **Fix**: Update paths or remove invalid entries via `patch_layout_infrastructure`.

### Content Density Issues
- **Cause**: Too many bullets crammed into a small content_rect.
- **Fix**: Reduce bullet count in `layout-input.json`, or switch layout type to one with more space (e.g., `cards` or `two_content`).

## Repair Workflow

1. Review the validation error output.
2. Use `patch_layout_infrastructure` to fix the relevant JSON file.
3. Use `rerun_pptx` to re-render and verify the fix.
4. Report the result briefly — no verbose explanations, no code blocks.

## Quality Checklist

- [ ] No ERROR-level validation issues after rendering
- [ ] All approved images and icons are present
- [ ] Text is readable (adequate contrast, no overflow)
- [ ] Composition is visually consistent across slides
- [ ] No shapes extend past slide boundaries
---
name: manipulation-pptx
description: >
  Review and repair PPTX presentations rendered by the deterministic slide renderer.
  Covers layout validation, fixing overlap/overflow issues, and patching infrastructure files.
---

# PPTX Layout Review & Repair Skill

Review, validate, and repair PowerPoint presentations rendered by the deterministic slide renderer (`slide_renderer.py`).

This skill handles:

1. **Review** — Inspect rendered output for layout issues (overlap, text overflow, out-of-bounds shapes).
2. **Repair** — Patch infrastructure files (`layout-input.json`, `layout-specs.json`, `slide-assets.json`) and re-render.

This skill is **not** responsible for generating Python code. All PPTX rendering is handled automatically by the deterministic renderer.

## Output Format

Do NOT return Python code blocks. Use the available tools instead:

- `patch_layout_infrastructure` — Modify layout specs, slide assets, or layout input when fixes are needed.
- `rerun_pptx` — Re-render the presentation after making changes.

## How Rendering Works

The deterministic renderer (`slide_renderer.py`) reads three JSON files from the workspace:

1. `previews/layout-input.json` — Slide content (titles, bullets, key messages, layout types)
2. `previews/layout-specs.json` — Precomputed geometry (title_rect, content_rect, cards, stats, etc.)
3. `previews/slide-assets.json` — Icon names, image paths, and metadata per slide

The renderer produces PPTX directly from these files using fixed Python functions — no LLM-generated code is involved.

## Theme Contract

`PPTX_THEME` is a dictionary with 6-digit hex color strings. The theme is injected at render time via environment variables. The renderer uses these values automatically.

Key slots: `BG`, `TEXT`, `DARK`, `DARK2`, `LIGHT`, `LIGHT2`, `ACCENT1`–`ACCENT6`, `PRIMARY`, `SECONDARY`, `BORDER`.

## Layout Specs Reference

Each slide in `layout-specs.json` contains a `LayoutSpec` with these fields:

- `title_rect`, `key_message_rect`, `accent_rect`, `icon_rect`, `content_rect`, `notes_rect`
- `summary_box`, `hero_rect`, `chips_rect`, `footer_rect`, `sidebar_rect`
- `max_items`, `row_step`
- `cards` (CardsSpec), `stats` (StatsSpec), `timeline` (TimelineSpec), `comparison` (ComparisonSpec)

All coordinates are in inches. The slide is 13.333" × 7.5" (widescreen 16:9).

## Common Layout Issues and Fixes

### Overlap Errors
- **Cause**: Two shapes share overlapping (x, x+w) AND (y, y+h) ranges.
- **Fix**: Adjust coordinates in `layout-specs.json` — reduce width, shift x/y, or increase spacing.

### Text Overflow Errors
- **Cause**: Text content exceeds the allocated box height.
- **Fix**: Increase box height in `layout-specs.json`, or reduce content in `layout-input.json`.

### Out-of-Bounds Errors
- **Cause**: Shape extends past slide boundaries (x+w > 13.333 or y+h > 7.5).
- **Fix**: Reduce x+w or y+h values in `layout-specs.json`.

### Missing Images/Icons
- **Cause**: Invalid paths in `slide-assets.json`.
- **Fix**: Update paths or remove invalid entries via `patch_layout_infrastructure`.

## Repair Workflow

1. Review the validation error output.
2. Use `patch_layout_infrastructure` to fix the relevant JSON file.
3. Use `rerun_pptx` to re-render and verify the fix.
4. Report the result briefly — no verbose explanations.

## Design Guidelines

These guidelines inform how the renderer already works. They are for review context, not code generation:

- Each slide's layout type determines the rendering function (title, bullets, cards, stats, comparison, timeline, etc.)
- The renderer uses `StyleConfig` to apply design language (panel fills, shadows, stripes, accent bars, etc.)
- Contrast safety is enforced automatically via `ensure_contrast()`
- Icons are fetched live from Iconify and placed per `icon_rect` or fallback positions
- Font sizing is adaptive — titles and body text scale down when text is dense

## Quality Checklist

- [ ] No ERROR-level validation issues after rendering
- [ ] All approved images and icons are present
- [ ] Text is readable (adequate contrast, no overflow)
- [ ] Composition is visually consistent across slides
- [ ] No shapes extend past slide boundaries
        safe_add_picture(slide.shapes, icon_path,
            Inches(spec.icon_rect.x), Inches(spec.icon_rect.y),
            width=Inches(spec.icon_rect.w), height=Inches(spec.icon_rect.h))
    else:
        # Place in upper-right or sidebar when no icon_rect is defined
        safe_add_picture(slide.shapes, icon_path,
            Inches(10.5), Inches(0.5), width=Inches(1.8), height=Inches(1.8))
```

### Text Overflow Prevention (Critical)

**Free textboxes** (created by `add_textbox` or `shapes.add_textbox`) must use `MSO_AUTO_SIZE.NONE` — NOT `TEXT_TO_FIT_SHAPE`. The `flow_layout_spec()` system already computes correct heights for title and key_message rects based on the actual text content and font size. Using `TEXT_TO_FIT_SHAPE` on textboxes causes PowerPoint to shrink fonts unpredictably, creating visual mismatches where the key_message overlaps the title.

**Panel shapes** (rounded rectangles, cards) should use `MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE` because their height is fixed and text must fit inside.

```python
# ✅ CORRECT: free textbox with flow-computed height
tf = box.text_frame
tf.word_wrap = True
tf.auto_size = MSO_AUTO_SIZE.NONE  # height is already correct from flow_layout_spec

# ✅ CORRECT: panel/card shape
tf = panel.text_frame
tf.word_wrap = True
tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE  # shrink text to fit fixed shape
```

**Rule:** For textboxes placed using `flow_layout_spec` rects (title, key_message, notes), always use `MSO_AUTO_SIZE.NONE`. For panels/cards with fixed dimensions, use `TEXT_TO_FIT_SHAPE`.

### Layout Principles

1. **Slide title = assertion**: Use the scenario `keyMessage` as the slide title text
2. **Layout variety**: Never use the same layout 3 slides in a row
3. **Data-first**: When numbers exist, use a stats-oriented composition to make them prominent
4. **Parallel comparison**: For Before/After or options, use `cards` layout side by side
5. **One message per slide**: Do not over-pack
6. **Palette breadth**: Across the deck, try to surface at least 4 accent slots when the theme provides them

### Layout Correction Rules

- If a slide would require body text below 14pt, the composition is wrong. Reduce copy, convert bullets into cards/stats, or split the content.
- Do not shrink the whole slide to fit more text. Recompose the layout instead.
- Avoid repeating the same tiny icon placement at the top edge of slides. Repeated `x < 1.2`, `y < 1.2`, `w <= 0.6`, `h <= 0.6` icon placement is usually a poor layout.
- On `title`, `section`, `diagram`, and `comparison` slides, reserve a meaningful visual area instead of making the slide text-only.
- Do not stack shapes at `y=0` or bunch everything in the top 2 inches of the slide.
- No two content shapes should share overlapping `(x, x+w)` AND `(y, y+h)` ranges.
- When using `notes_rect` from the spec, always create the notes text box with `name = "notes_body"` so the layout repair engine skips it.

### Card Pattern Metadata

When `spec.cards` exists, treat `spec.cards.pattern` as a rendering instruction for the card interior, not just a geometry hint.

- `standard`: plain content cards, no extra chrome required.
- `icon_card`: each card should include one strong icon integrated into the card body. Place the icon inside the card, usually near the top-left or centered in a dedicated icon block, at a size that reads as a primary visual anchor.
- `header_icon_card`: each card should reserve a slim header band and place one or more small icons inside that header area. The icons are supporting accents, not the hero element.

Use the metadata fields consistently:

- `spec.cards.icon_size`: preferred icon size in inches for the card pattern.
- `spec.cards.header_band_h`: reserved header band height for `header_icon_card`.
- `spec.cards.header_icon_count`: target icon count for the header band. Use one icon for process cards and multiple small icons for richer summary cards.

Pattern rules:

- Do not place tiny decorative icons floating above the card edge. If the pattern is icon-based, the icon must feel structurally attached to the card.
- For `icon_card`, keep the icon bold and the text block clearly separated below or beside it.
- For `header_icon_card`, use a clean top band with small icons plus a short heading, then place body copy below the divider.
- Preserve readability: the header band should not consume so much height that body text is forced below 14pt.
- Do not place body/content shapes at Y positions that could overlap the notes zone (`spec.notes_rect.y` onwards). Reserve the bottom region.

### Layout Template System

The runtime injects `PRECOMPUTED_LAYOUT_SPECS` — a `list[LayoutSpec]` (one per slide) computed by the hybrid layout engine using **Pillow text measurement + kiwisolver constraint solver**. These specs provide content-aware coordinates based on measured text heights. **Never use literal float coordinates. Every x, y, w, h must reference a `spec.*` field or be computed relative to one.**

Available on `LayoutSpec`: `title_rect`, `key_message_rect`, `accent_rect`, `icon_rect`, `content_rect`, `notes_rect`, `summary_box`, `hero_rect`, `chips_rect`, `footer_rect`, `sidebar_rect`, `max_items`, `row_step`, `cards`, `stats`, `timeline`, `comparison`.

```python
# Always use PRECOMPUTED_LAYOUT_SPECS
spec = PRECOMPUTED_LAYOUT_SPECS[slide_index]
# Then use spec.title_rect, spec.content_rect, etc. as usual
```

#### Mandatory: No Hardcoded Coordinates

**HARD RULE:** Do NOT write literal positioning like `hero_x = 8.85` or `chip_y = 4.85`. Instead, derive positions from spec rects:

```python
# ✅ CORRECT: derive from spec
hero = spec.hero_rect
chip_area = spec.chips_rect
footer = spec.footer_rect
body_y = spec.content_rect.y
sidebar = spec.sidebar_rect

# ❌ WRONG: hardcoded coordinates
hero_x = 8.85  # NEVER
chip_y = 4.85  # NEVER
body_y = 5.52  # NEVER
```

When you need a sub-position within a spec rect, compute it:

```python
# Inside content_rect, place 3 rows
for idx in range(3):
    row_y = spec.content_rect.y + idx * (row_h + gap)

# Icon inside hero_rect
icon_x = spec.hero_rect.x + 0.2
icon_y = spec.hero_rect.y + 0.3

# Chips at spec.chips_rect
for idx, text in enumerate(chip_texts):
    cx = spec.chips_rect.x + idx * (chip_w + gap)
    cy = spec.chips_rect.y
```

#### Sub-Zone Reference

| Layout   | hero_rect  | chips_rect | footer_rect | sidebar_rect |
| -------- | ---------- | ---------- | ----------- | ------------ |
| title    | Right-side hero panel | Horizontal label chips | Body text below chips | — |
| agenda   | —          | —          | —           | Right-side decoration |
| stats    | —          | —          | Bottom summary bar | — |
| diagram  | —          | —          | —           | Right-side callout area |
| others   | —          | —          | —           | — |

All sub-zones are pre-computed by the hybrid layout engine and included in `PRECOMPUTED_LAYOUT_SPECS`.

Generated code must produce the final layout directly: reserve notes/footer space, keep aligned layouts aligned, and split or simplify content instead of crowding. The app's layout repair tooling exists as a fallback for edge cases — do not rely on it as a primary strategy.
- Prefer 3-5 bullets per slide. If content is denser than that, convert it into two-column cards, stats, or a comparison structure.
- **Maximum 5 content shapes per slide** (excluding slide title, key message, accent bar, and notes/footer). If more are needed, split the content across two slides or collapse items into a grid/card layout.
- **Long titles are handled by the hybrid engine.** The pre-computed specs already account for title text wrapping — no additional `flow_layout_spec()` call is needed.
- **Notes and footer shapes must be named with a `notes_` or `footer_` prefix** (e.g., `notes_body`, `footer_citation`). The layout engine skips these shapes entirely so they are never repositioned. Always place notes/footer shapes last in the slide-building code.
- **Preserve alignment intentionally.** If a slide uses a grid, mirrored comparison, stacked sidebar, or evenly aligned cards, do not introduce compensating offsets per box. Reduce content instead of breaking the alignment system.
- **Reserve `notes_rect` as a hard boundary.** No content shape may start at or extend into `spec.notes_rect.y` or below.
- **Height-budget every text box before placement.** Use `estimate_text_height_in()` for body copy, card copy, sidebars, and summary panels before you finalize `h`.
- **Chip text expansion is handled by the hybrid engine.** The pre-computed specs already account for chip text heights. Example:
  ```python
  spec = PRECOMPUTED_LAYOUT_SPECS[slide_index]
  # spec.chips_rect is already sized for the chip text content
  ```
  ```
- **Use two-tier density scaling in `write_panel_text`.** When estimated text height exceeds ~85% of available height (dense), reduce font by 0.4–0.8pt. When it exceeds ~105% (severe), reduce by up to 1.8pt for title and 1.4pt for body, and tighten line spacing to 1.16. Never go below 12pt title / 11pt body.
- **Do not place paragraph text into shallow boxes.** A text box with 2+ lines of body copy should usually be at least `0.95in` tall. A card with a title plus paragraph body should usually be at least `1.45in` tall.
- **Treat 85% text fill as the danger zone.** If estimated text height uses more than ~85% of a box height, the slide is too dense. Reduce content or split the slide.
- **For stacked rows, prefer fewer rows with taller boxes.** Four readable rows are better than six compressed rows.

Example height budgeting:

```python
needed_h = estimate_text_height_in(body_text, target_rect.w - 0.25, 16) + 0.12
body_h = max(target_rect.h, needed_h)
```

If the computed height no longer fits cleanly on the slide, reduce the number of elements or split the content. Do not keep the same number of boxes and rely on auto-size to shrink away the problem.

### Visual Sizing Rules

- `title` slides: use a hero title block plus a dominant icon/visual zone that occupies roughly 20-35% of the slide.
- `section` slides: use large section typography and a bold icon/shape treatment; section icons should usually be around `1.2-1.8in`, not `0.5in`.
- `cards` slides: card icons should usually be around `0.45-0.75in` and integrated inside the card body, not detached above the slide.
- `diagram` and `comparison` slides: visuals should occupy roughly 25-40% of the slide width when an icon or diagram motif is used.
- Do not place images/icons in a tiny strip at the very top unless the design specifically calls for a header badge.
- A slide with fewer elements and larger type is better than a cramped slide with tiny text.

### Font Sizes

The font size table below is a **starting guide only**. Always enable auto-size on text frames so PowerPoint shrinks text to fit the shape when content is longer than expected. Never rely on a fixed font size if it would cause text to overflow or overlap.

```python
# REQUIRED: Enable auto-size appropriately
# For free textboxes (title, key_message):
tf = txBox.text_frame
tf.word_wrap = True
tf.auto_size = MSO_AUTO_SIZE.NONE  # flow_layout_spec computed the height

# For panel/card shapes:
tf = panel.text_frame
tf.word_wrap = True
tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE  # shrink to fit fixed shape
```

| Usage              | Initial Size | Weight  | Auto-size |
| ------------------ | ------------ | ------- | --------- |
| Slide title        | 28–32pt      | Bold    | Required  |
| Section title      | 36–44pt      | Bold    | Required  |
| Body text          | 16–20pt      | Regular | Required  |
| Bullet points      | 16–18pt      | Regular | Required  |
| Card body text     | 14–16pt      | Regular | Required  |
| Card title         | 15–17pt      | Bold    | Required  |
| Stats number       | 32–48pt      | Bold    | Required  |
| Caption            | 11–12pt      | Regular | Required  |
| Header band text   | 9–10pt       | Regular | Required  |
| Footer             | 8pt          | Regular | Required  |

**Rule:** For free textboxes (title, key_message, notes), set `text_frame.auto_size = MSO_AUTO_SIZE.NONE` and rely on the flow-computed height from `flow_layout_spec()`. For panel/card shapes, set `text_frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE`. This prevents the primary text-overlap bug where titles and key_messages visually collide.

**Order rule:** Text layout is display-order driven. Measure/reserve title space first, then key message, then start the body/content zone below them. Do not place body panels at a fixed Y coordinate when the title can wrap.

## Execution Template

```python
from pptx import Presentation

def build_presentation(output_path, theme, title):
    prs = apply_widescreen(Presentation())
    blank = prs.slide_layouts[6]

    slide = prs.slides.add_slide(blank)

    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = rgb_color(theme.get('BG'), 'FFFFFF')

    # Use PRECOMPUTED_LAYOUT_SPECS for text placement
    spec = PRECOMPUTED_LAYOUT_SPECS[0]
    txBox = slide.shapes.add_textbox(
        Inches(spec.title_rect.x), Inches(spec.title_rect.y),
        Inches(spec.title_rect.w), Inches(spec.title_rect.h))
    tf = txBox.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE  # height is from flow_layout_spec

    # MANDATORY: add icon
    icon_path = fetch_icon('mdi:brain', color_hex=theme.get('ACCENT1', '0078D4'))
    if icon_path and spec.icon_rect:
        safe_add_picture(slide.shapes, icon_path,
            Inches(spec.icon_rect.x), Inches(spec.icon_rect.y),
            width=Inches(spec.icon_rect.w), height=Inches(spec.icon_rect.h))

    prs.save(output_path)
```

## Input Assumptions

- The current workspace slide list is already approved.
- Each slide already contains the content that should be rendered.
- `keyMessage` should drive the visual headline.
- `notes` should still inform layout and emphasis when available.

## Content Rules

- **No emoji**: `💡` `🔄` `✅` can render inconsistently in PowerPoint exports
- **Arrows ok**: `→` `↑` in text fields are fine
- **Checkmarks**: Use `✔` (U+2714) not emoji
- **Line spacing**: Japanese text should use `lineSpacingMultiple: 1.5`
- **Minimum font**: Never go below 8pt
- Match the user's language for all slide content
- Append original terms for jargon (e.g., "Retrieval-Augmented Generation (RAG)")

### Font Selection for Non-English Content

Use `resolve_font(text, base_font)` to keep the selected presentation font consistent across all text. This function is pre-injected into the execution namespace.

```python
# resolve_font returns the selected base font unchanged
# default base_font is PPTX_FONT_FAMILY (user-selected), NOT hardcoded 'Calibri'
font = resolve_font(slide_data['title'])
run.font.name = font
```

**Rules:**
- For non-English body text, use `resolve_font(text)` or `PPTX_FONT_FAMILY` instead of hardcoding locale-specific font names like `Yu Mincho`
- `resolve_font()` already defaults to `PPTX_FONT_FAMILY` — no need to pass `'Calibri'` explicitly
- Display/title fonts (Georgia, Bebas Neue, etc.) may be kept for Latin-only slides, but multilingual decks should stay on the selected base font
- Monospace labels (Consolas, Space Mono) are fine for Latin-only labels and numbers
- PowerPoint handles glyph substitution for missing characters at render time

## Quality Checklist

- [ ] Output is a complete `python-pptx` code block
- [ ] The script saves a `.pptx` file
- [ ] The script uses `PPTX_THEME` rather than hardcoded palette choices where practical
- [ ] Main body text is not below 14pt except for captions/footer-like metadata
- [ ] Icons/images are not all tiny badges clustered at the top edge of slides
- [ ] Key slides (`title`, `section`, `diagram`, `comparison`) use deliberate visual composition, not just stacked text
- [ ] Every slide calls `fetch_icon()` at least once to add a visual icon
- [ ] Free textboxes (title, key_message) use `MSO_AUTO_SIZE.NONE`, panels use `TEXT_TO_FIT_SHAPE`
- [ ] No title/key_message text overlap — `flow_layout_spec()` is used for every slide with title > 60 chars

## Workflow

1. Read the current approved slide story from workspace context.
2. Convert each slide into direct `python-pptx` slide-building code.
3. Use the active theme values instead of hardcoded palette choices where possible.
4. Save the finished deck to `output_path` or `OUTPUT_PATH`.
5. Output only the final code block with no explanation before or after it.

---

## Layout Repair Workflow

When PPTX generation fails with layout validation errors (overlap, text overflow, out-of-bounds), the app provides repair tooling to fix the underlying layout infrastructure and re-run without regenerating the entire code.

### Repair steps

1. Inspect the relevant layout file (`layout_specs.py` for coordinates, `layout_validator.py` for validation thresholds) to understand the current values.
2. Identify the dimension or threshold causing the error.
3. Patch the value (e.g., reduce a card width from 5.9 to 4.5 to eliminate overlap).
4. Rerun the PPTX render to verify the fix.

### Common fixes

- **Overlap errors**: Adjust layout dimensions in `layout_specs.py`, then rerun the render.
- **Text overflow errors**: Increase box heights or adjust validator thresholds in `layout_validator.py`.
- **Out-of-bounds errors**: Reduce x+w or y+h values so shapes stay within 13.33" × 7.5".
