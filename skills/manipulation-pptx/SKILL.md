---
name: manipulation-pptx
description: >
  Generate and manipulate PowerPoint presentations using python-pptx.
  Covers full PPTX creation from an approved slide story and theme,
  as well as programmatic editing, charts, tables, and shape manipulation.
---

# PPTX Generation & Manipulation Skill

Create, edit, and manipulate PowerPoint (.pptx) presentations using **python-pptx**.

This skill handles two use cases:

1. **Generation** — Convert an approved slide story and theme into a complete PPTX file.
2. **Manipulation** — Add, update, or extract content from existing presentations (tables, charts, shapes, images).

This skill is **not** responsible for framework recommendation, scenario creation, or slide-story planning.
Assume the current workspace slides and theme are already the approved source of truth.

## Output Format

Always return a single ` ```python ` code block.

The code must use `python-pptx` and save a `.pptx` file.

Prefer defining:

```python
def build_presentation(output_path, theme, title):
  ...
```

The runtime will call `build_presentation(output_path, theme, title)` if present.

## Primary Objective

Produce output that is robust, deterministic, and directly executable with `python-pptx`.

## Theme Contract

`PPTX_THEME` is a Python dictionary with these keys using 6-digit hex strings without `#`.

The values are runtime-dependent and come from the palette panel/theme assignment in the app.
They are not fixed to the sample values below.

Example shape only:

```json
{
  "DARK": "1B1B1B",
  "DARK2": "2D2D2D",
  "LIGHT": "FFFFFF",
  "LIGHT2": "F5F5F5",
  "ACCENT1": "0078D4",
  "ACCENT2": "005A9E",
  "ACCENT3": "107C10",
  "ACCENT4": "5C2D91",
  "ACCENT5": "008272",
  "ACCENT6": "D83B01",
  "LINK": "0078D4",
  "USED_LINK": "5C2D91",
  "PRIMARY": "0078D4",
  "SECONDARY": "005A9E",
  "BG": "FFFFFF",
  "TEXT": "1B1B1B",
  "WHITE": "FFFFFF",
  "BORDER": "E1E1E1"
}
```

Also available at runtime:

- `OUTPUT_PATH`: destination `.pptx` path
- `PPTX_TITLE`: presentation title
- `WORKSPACE_DIR`: workspace root directory
- `IMAGES_DIR`: workspace images directory (`{WORKSPACE_DIR}/images`)
- `SLIDE_WIDTH_IN`, `SLIDE_HEIGHT_IN`
- `Presentation`, `Inches`, `Pt`, `RGBColor`, `PP_ALIGN`, `MSO_ANCHOR`, `MSO_AUTO_SHAPE_TYPE`
- `rgb_color()`, `apply_widescreen()`, `safe_image_path()`, `safe_add_picture()`, `ensure_contrast()`, `set_fill_transparency()`
- `resolve_font(text, base_font)` — returns the selected base font unchanged (default base_font = `PPTX_FONT_FAMILY`)
- `PPTX_FONT_FAMILY` — the user-selected base font (e.g., `'Calibri'`, `'Arial'`); use instead of hardcoding
- `PPTX_COLOR_TREATMENT` — `'solid'`, `'gradient'`, or `'mixed'`; this is a hard requirement for how filled panels/cards should be rendered
- `PPTX_TEXT_BOX_STYLE` — `'plain'`, `'with-icons'`, or `'mixed'`; this is a hard requirement for whether major text panels should visibly pair with icons

When referencing slide images, prefer `os.path.join(IMAGES_DIR, filename)` over hardcoded absolute paths.

Always prefer these theme values over hardcoded colors.

### Theme vs. Design Style Color Conflict

If a design style skill (e.g., Neo-Brutalism, Cyberpunk Outline) specifies its own color palette, **the active theme always takes priority**. Map the style's color roles to the nearest theme slot:

- Style says "yellow background" but theme BG is `FFFFFF` → use theme BG (`FFFFFF`)
- Style says "neon green accent" but theme ACCENT1 is `0078D4` → use theme ACCENT1
- Style says "black text" but theme TEXT is `1B1B1B` → use theme TEXT

The design style defines mood, layout technique, and visual structure. The theme defines the actual colors used in the output.

## Code Rules

1. Wrap the output in ` ```python `.
2. Output a complete executable script, not pseudocode and not a fragment.
3. Use `python-pptx`, not OpenXML, not PresentationSpec JSON, and not PptxGenJS.
4. Save the final deck to `output_path` or `OUTPUT_PATH`.
5. Do not emit explanations before or after the code block.
6. Prefer a single `Presentation()` instance with widescreen size via `apply_widescreen(prs)`.
7. Use grounded local image paths for attached slide images when available.
8. Use `fetch_icon()` (pre-injected) to add icons to slides — every slide SHOULD include at least one icon.

## Design Guidelines

- Treat the approved workspace slides and design brief as the primary input.
- Each slide's `layout` / `icon` is a **creative hint, not a fixed command**
- Actively reinterpret layouts to improve rhythm, whitespace, visual hierarchy, and information flow
- Add deliberate variety when 3+ consecutive slides would have identical compositions
- Maintain the user-approved story assertions while being bold with visual design
- If `designBrief.layoutApproach` is `design-led`: choose the most expressive composition that preserves story
- If `designBrief.layoutApproach` is `structured`: respect scenario layout more closely
- Distribute color usage across the full theme whenever possible. Do not let the entire deck collapse to only `ACCENT1` and `ACCENT2` if `ACCENT3`-`ACCENT6` are available.
- Reuse one or two anchor accents for coherence, but actively bring in the remaining accent colors across cards, stats, dividers, timelines, comparison bands, callouts, and icon frames.

### Contrast & Readability Safety

- Never place white or near-white text on a light background, or dark text on a dark background.
- Avoid mid-tone text on mid-tone surfaces — maintain strong contrast.
- If an image sits behind text, add a solid or semi-transparent overlay panel; never place raw text over a busy photo.
- Body text must be readable at projection distance — avoid anything below 14pt for main content.
- If a slide looks stylish but forces effort to decode, revise it — choose readability over aesthetics.

### Fill Transparency Safety

- When applying transparency to a shape fill, use `set_fill_transparency(shape, value)`.
- Do not access `shape.fill._fill` or other private python-pptx fill proxy internals. They are proxy objects, not XML nodes.
- If direct OOXML access is required, work from `shape._element.spPr` / `shape._element.findall(...)`, not `shape.fill._fill`.

### Text Box Style Contract

- `PPTX_TEXT_BOX_STYLE == 'plain'`: major text panels, cards, and callouts should be text-led and free of decorative icon chips/badges inside the panel.
- `PPTX_TEXT_BOX_STYLE == 'with-icons'`: major text panels, cards, and callouts should visibly pair text with an icon companion when space allows, such as a side icon, icon chip, or icon badge. Choose the icon from that panel's own heading/body meaning; do not reuse one slide-level icon across every panel. Keep the icon readable at presentation distance; avoid tiny decorative icons.
- `PPTX_TEXT_BOX_STYLE == 'mixed'`: adaptive — add icon companions to cards, callouts, and feature panels where the icon adds semantic anchoring and visual variety; keep dense prose panels, narrow sidebars, and minimalist reading surfaces plain. Decide per-panel based on whether an icon genuinely aids comprehension.
- Do not treat this as a weak preference. The user expects a visible difference between the modes.

### Fill Style Contract

- `PPTX_COLOR_TREATMENT == 'solid'`: use solid fills for major reading surfaces such as cards, sidebars, ribbons, and text panels.
- `PPTX_COLOR_TREATMENT == 'gradient'`: use `apply_gradient_fill(...)` on at least one major panel, ribbon, hero surface, or background treatment per slide when that slide contains filled surfaces.
- `PPTX_COLOR_TREATMENT == 'mixed'`: adaptive — prefer gradient fills on hero, title, and large accent surfaces for dramatic effect; prefer solid fills on dense reading surfaces and small cards for clarity. Decide per-slide based on the panel's role.
- Do not leave `gradient` mode looking effectively identical to `solid` mode.

### Horizontal Row Bounds Safety

- Horizontally aligned card/stat/process/comparison rows MUST stay within slide bounds (13.333" wide).
- Always use the pre-computed spec geometry (`spec.cards.card_rect`, `spec.stats.box_rect`, `spec.comparison.left/right`) without adding decorative offsets that push the last item past the right edge.
- If content exceeds the available width, reduce copy or item count instead of widening boxes.
- **Preserve alignment intentionally.** Do not introduce per-box compensating offsets that break the equal-width grid.

### Icon Usage

Icons are fetched live from the **Iconify** public API. Use any valid ID from the selected collection (e.g., `mdi:brain`, `lucide:rocket`).

**Every slide SHOULD include at least one icon when a relevant icon exists.** If `fetch_icon()` returns `None`, continue without the icon. Icons add visual anchoring, improve scannability, and reinforce the message.

Use full Iconify IDs from supported collections such as `mdi`, `lucide`, `tabler`, `ph`, `fa6-solid`, and `fluent`.

To use an icon in python-pptx, use the pre-injected `fetch_icon()` function, which fetches from the Iconify API:

```python
# fetch_icon is already available in the execution namespace — do NOT redefine it.
# Usage:
icon_path = fetch_icon('mdi:chart-line', color_hex='4472C4')
if icon_path:
    safe_add_picture(slide.shapes, icon_path, spec.icon_rect.x_emu, spec.icon_rect.y_emu,
                     width=spec.icon_rect.w_emu, height=spec.icon_rect.h_emu)
```

**Important:** `fetch_icon(name, color_hex, size)` is pre-injected into the execution namespace. Do NOT redefine it. It fetches the icon from the Iconify API and returns `None` if the icon is unavailable.

**Icon enforcement rules:**
- **Every slide MUST call `fetch_icon()` at least once** to attempt adding a visual icon — if it returns `None`, continue without it
- Title slide: place a prominent icon in the hero zone or as a visual anchor (1.5–2.5 in)
- Section/diagram slides: icon should be 1.2–1.8 in, placed in sidebar or icon_rect
- Cards/bullets slides: choose icons per card/text box content. Different cards or callouts should usually use different icons when their meanings differ; do not stamp the same icon into every box by default.
- Stats slides: place an icon representing the metric theme
- Summary slides: place a concluding icon in the summary box or as an accent
- Choose icons that reinforce the slide's topic (e.g., `mdi:chart-line` for analytics, `mdi:shield-check` for security)
- If a slide has multiple text boxes with icons, each icon should reflect that specific box's content, not just the overall slide title.
- Color icons using theme accent colors (pass `color_hex=colors['accent4']` etc.)
- If `spec.icon_rect` is available, use it; otherwise place the icon in an appropriate zone

Example for every slide:
```python
# MANDATORY: add an icon to every slide
icon_path = fetch_icon('mdi:database', color_hex=colors['accent4'])
if icon_path:
    if spec.icon_rect:
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

The runtime injects `PRECOMPUTED_LAYOUT_SPECS` — a `list[LayoutSpec]` (one per slide) computed by the hybrid layout engine using **PowerPoint COM AutoFit + kiwisolver constraint solver**. These specs have pixel-perfect coordinates based on actual text measurements. **Never use literal float coordinates. Every x, y, w, h must reference a `spec.*` field or be computed relative to one.**

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

There is no runtime geometry repair pass. The generated code must produce the final layout directly: reserve notes/footer space, keep aligned layouts aligned, and split or simplify content instead of relying on any post-processing fix-up.
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
    # If a custom template is attached, load it instead of a blank presentation.
    # apply_widescreen() forces 16:9 dimensions regardless of the template's original size.
    if TEMPLATE_PATH:
        prs = apply_widescreen(Presentation(TEMPLATE_PATH))
        blank = get_blank_layout(prs)
    else:
        prs = apply_widescreen(Presentation())
        blank = prs.slide_layouts[6]

    slide = prs.slides.add_slide(blank)

    # Only set background fill when NOT using a custom template —
    # template slide masters already provide backgrounds.
    if not TEMPLATE_PATH:
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

### Custom Template Notes

When `TEMPLATE_PATH` is set (not `None`), the user has provided a corporate PPTX as a design template:

- **Initialization**: `prs = apply_widescreen(Presentation(TEMPLATE_PATH))` — loads the template and forces 16:9 dimensions.
- **Layout selection**: `get_blank_layout(prs)` instead of `prs.slide_layouts[6]` — finds the correct blank layout regardless of template ordering.
- **Backgrounds**: Do NOT call `slide.background.fill.solid()` — the template's slide master already provides backgrounds.
- **Placeholders**: All ignored. Use only freeform shapes positioned by `PRECOMPUTED_LAYOUT_SPECS`.
- **Theme colors**: `PPTX_THEME` is auto-populated from the template's color scheme. Use it as usual.

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

## Layout Infrastructure Tools

When PPTX generation fails with layout validation errors (overlap, text overflow, out-of-bounds), you have two tools to fix the underlying layout infrastructure and re-run without regenerating the entire code.

### `patch_layout_infrastructure`

Read or patch `layout_specs.py` (pre-computed layout coordinates) or `layout_validator.py` (validation rules).

**Parameters:**
- `action`: `"read"` to view the file, `"patch"` to search-and-replace
- `file`: `"layout_specs"` or `"layout_validator"`
- `search` (patch only): exact string to find
- `replace` (patch only): replacement string

**Workflow:**
1. Read the file to understand current values: `patch_layout_infrastructure(action="read", file="layout_specs")`
2. Identify the dimension or threshold causing the error
3. Patch it: `patch_layout_infrastructure(action="patch", file="layout_specs", search="card_w_val = 5.9", replace="card_w_val = 4.5")`
4. Re-run with `rerun_pptx`

**Common fixes:**
- **Overlap errors**: Use `patch_layout_infrastructure` to adjust layout dimensions in `layout_specs.py`, then call `rerun_pptx`
- **Text overflow errors**: Increase box heights or adjust validator thresholds in `layout_validator.py`
- **Out-of-bounds errors**: Reduce x+w or y+h values so shapes stay within 13.33" × 7.5"

### `rerun_pptx`

Re-execute the last generated python-pptx code (`generated-source.py`) with the same theme and title. Use after `patch_layout_infrastructure` to verify the fix.

**Parameters:** none

**Returns:** success message or the validation error report if the fix didn't resolve the issue.
