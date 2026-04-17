# Layout Engine — Technical Whitepaper

## End-to-End Overview

The layout system runs as part of a larger PPTX generation pipeline. In end-to-end order, the flow is:

1. **Storyboard + asset selection** produce slide content and approved image/icon metadata.
2. **Pre-generation layout computation** computes `LayoutSpec` coordinates before the PPTX renderer runs.
3. **Runtime loading** gives the Python rendering pipeline access to `PRECOMPUTED_LAYOUT_SPECS` and related helpers.
4. **PPTX generation** writes the deck using the precomputed rectangles.
5. **Post-generation processing** repairs, validates, and optionally renders preview images.

```
slide storyboard + assets
        │
        ├──▶ previews/layout-input.json
        ├──▶ previews/slide-assets.json
        │
        ▼
hybrid_layout.py
        │
        ├──▶ layout_blueprint.py      (design tokens + zones)
        ├──▶ font_text_measure.py     (default Pillow measurement)
        ├──▶ estimate_text_height_in  (last-resort heuristic)
        └──▶ constraint_solver.py     (kiwisolver / Cassowary)
        │
        ▼
previews/layout-specs.json
        │
        ▼
pptx-python-runner.py
        │
        ├──▶ load PRECOMPUTED_LAYOUT_SPECS + helpers
        ├──▶ run the deterministic slide renderer
        ├──▶ overflow repair using Pillow measurement
        ├──▶ contrast repair
        ├──▶ validate_presentation(prs)
        └──▶ optional preview image rendering
```

The layout engine itself is the pre-generation part of that pipeline. Its job is to convert declarative slide intent into deterministic rectangles that the renderer can consume safely.

When the hybrid engine is unavailable or precomputation fails, the runtime raises a `RuntimeError`. The renderer must always use `PRECOMPUTED_LAYOUT_SPECS`.

---

## JSON Contract Between Processes

The layout engine runs as a subprocess (`hybrid_layout.py`) and communicates through JSON artifacts stored in `previews/`.
It solves geometry from slide content only; render-time styling choices such as
rounded panel corners are applied later by `slide_renderer.py` and are not part
of the solver contract.

### Input Artifacts

The Electron app writes `layout-input.json` as soon as the slide scenario is set in the workspace, then refreshes it again before layout computation. Each slide is serialized as `SlideContent`:

```json
{
  "layout_type": "cards",
  "title_text": "Quarterly Results",
  "key_message_text": "Revenue grew 15% YoY",
  "bullets": ["North America", "EMEA", "APAC"],
  "notes": "Speaker notes",
  "item_count": 3,
  "has_icon": true,
  "font_family": "Calibri"   // defaults to user-selected PPTX_FONT_FAMILY
}
```

Empty text is not measured. In that case the solver falls back to each zone's `preferred_h` from the blueprint.

The workspace also stores `slide-assets.json` beside `layout-input.json`. That artifact is not part of the solver itself, but it travels with the same contract so the Python runner can receive the approved per-slide image set, primary image path, image queries, and selected icon collection context used during PPTX generation.

### Output Artifact

The engine returns one serialized `LayoutSpec` per slide and writes the results to `layout-specs.json`. Important fields include:

| Field | Meaning |
|-------|---------|
| `title_rect`, `key_message_rect`, `accent_rect`, `icon_rect`, `content_rect`, `notes_rect` | Absolute top-level zones |
| `hero_rect`, `chips_rect`, `footer_rect`, `sidebar_rect` | Optional sub-zones for specific layouts |
| `summary_box`, `cards`, `stats`, `timeline`, `comparison` | Variant-specific geometry objects |
| `max_items` | Maximum recommended item count for the layout |
| `row_step` | Agenda/timeline stepping aid for sequential placement |
| `solve_quality` | Diagnostic metadata from the constraint solver (compression ratios, relaxation pass flag) |

The serialized specs are injected into the Python runner through the `PPTX_LAYOUT_SPECS_JSON` environment variable. `hybrid_layout.py` also exposes `serialize_specs()` / `deserialize_specs()` so the runner can round-trip them without re-solving.

---

## Pre-Generation Layout Computation

The pre-generation layout pipeline is a three-stage process that produces slide element coordinates:

```
┌─────────────────┐     ┌──────────────────────────────┐     ┌──────────────────┐
│ Layout Blueprint │ ──▶ │ Text Measurement           │ ──▶ │ Constraint Solver │ ──▶ LayoutSpec JSON
│ (design tokens)  │     │ (Pillow + heuristic)       │     │ (kiwisolver)      │
└─────────────────┘     └──────────────────────────────┘     └──────────────────┘
```

1. **Layout Blueprint** (`layout_blueprint.py`) defines design tokens, margins, zone roles, and layout-family structure.
2. **Text Measurement** uses Pillow to measure text heights at the actual target widths. The shared heuristic is used only when Pillow is unavailable for a given path.
3. **Constraint Solver** (`constraint_solver.py`) feeds blueprint zones + measured heights into a Cassowary solver to produce final `LayoutSpec` coordinates.

The output `LayoutSpec` provides `RectSpec(x, y, w, h)` for every element zone such as title, key message, content area, cards, icons, and footer. `hybrid_layout.py` is the orchestration layer around these stages: it batches measurement requests, solves each slide in order, then serializes the resulting specs to JSON for injection into the Python runner.

### Slide Coordinate System

- **Slide dimensions**: 13.333″ × 7.5″ (widescreen 16:9)
- **Unit**: inches (converted to EMU via `× 914400` when writing to PPTX)
- **Origin**: top-left corner `(0, 0)`
- **X-axis**: left → right
- **Y-axis**: top → bottom

```
(0, 0) ─────────────────────────────── (13.333, 0)
  │                                         │
  │            Slide Area                    │
  │                                         │
(0, 7.5) ──────────────────────────── (13.333, 7.5)
```

### Safe Margins

| Constant | Value | Purpose |
|----------|-------|---------|
| `SAFE_MARGIN_IN` | 0.30″ | Minimum clearance from slide edge |
| `CONTENT_LEFT_IN` | 0.50″ | Left margin for content |
| `CONTENT_RIGHT_IN` | 0.50″ | Right margin for content |
| `MIN_GAP_EMU` | 0.15″ | Minimum gap between adjacent shapes |
| `OVERLAP_TOLERANCE_EMU` | 0.05″ | Edge-touch tolerance (not counted as overlap) |

---

## Stage 1: Blueprint Model

The solver does not start from raw coordinates. It starts from a declarative `LayoutBlueprint` that describes what zones exist on a slide and how they should behave.

### Core Types

- `DesignTokens` — reusable geometry constants such as margins, gaps, header width ratio, icon corner offsets, and the fixed notes band.
- `ZoneRole` — semantic region identifiers such as `TITLE`, `KEY_MESSAGE`, `ACCENT`, `CONTENT`, `SUMMARY_BOX`, `CHIPS`, `FOOTER`, and `NOTES`.
- `ZoneDef` — per-zone declaration containing `min_h`, `preferred_h`, measurement font size, bold flag, fixed height, and whether the zone should stretch.
- `CardsVariant` / `StatsVariant` / `TimelineVariant` / `ComparisonVariant` — layout-family metadata for per-layout subdivision of the solved content zone.
- `LayoutBlueprint` — top-level declaration for one layout type. It contains an ordered tuple of zones plus optional structural metadata such as `cards`, `stats`, `timeline`, `comparison`, `has_hero`, and `has_sidebar`.

### Zone Semantics

The most important fields in `ZoneDef` are:

| Field | Meaning |
|-------|---------|
| `min_h` | Hard lower bound. Solver must never shrink below this height. |
| `preferred_h` | Soft target height used when no measurement is available. |
| `font_pt` / `bold` | Measurement hint sent to the active text-measurement backend for text-bearing zones. |
| `fixed_h` | Exact height. Used for rules, accent lines, and notes bands. |
| `stretch` | Marks a zone that absorbs remaining vertical space. Usually the content zone. |
| `width_fraction` | Width as fraction of available content width. Used by `content_caption` / `picture_caption` to narrow title and key-message zones to the left ~35% narration column. The constraint solver's `_build_layout_spec` applies this via the caption-layout post-processing path. |

### Registered Layout Types

The blueprint catalog currently defines these layout families:

| Layout | Structural trait |
|--------|------------------|
| `title` | Accent + title + key message + chips + footer + hero image option |
| `section` | Large title / subtitle divider slide |
| `agenda` | Header + content with sidebar |
| `bullets` | Standard stacked body content |
| `cards` | Two-column card grid |
| `stats` | Three-up stats row + footer |
| `comparison` | Left/right split comparison (with sub-headers) |
| `timeline` | Vertical timeline spine + node text |
| `summary` | Summary box followed by content |
| `diagram` | Content with sidebar for diagram support |
| `chart` | Large content zone for chart rendering + caption footer |
| `table` | Native PowerPoint table from pipe/tab/comma-delimited bullet rows |
| `closing` | Thank-you / end slide — centered title + footer |
| `photo_fullbleed` | Full-bleed hero image with overlaid title |
| `multi_column` | Three-to-five equal-width content columns |
| `content_caption` | Left narration (~35%) + right content area (~65%) — split layout |
| `picture_caption` | Left narration (~35%) + right hero picture (~65%) — split layout |
| `two_content` | Two equal content columns without comparison sub-headers |
| `title_only` | Title bar + open canvas for freeform placement |
| `quote` | Wide-margin centered quotation with attribution footer |
| `big_number` | Single dominant KPI (large font) + context subtitle + supporting content |
| `process` | Horizontal process flow — single-row card grid (3–6 steps) |
| `pyramid` | Pyramid / funnel tiers along a vertical centre spine |

The key design principle is: **blueprints define intent, not final geometry**. Final geometry is always solved from blueprint + measured content.

---

## Stage 2: Text Measurement

Text measurement is the bridge between declarative layout intent and the solver's hard geometry constraints.

### Available Backends

- `font_text_measure.py` — primary cross-platform backend using Pillow TrueType font metrics and glyph-aware word wrapping.
- `estimate_text_height_in()` — shared heuristic used only when Pillow is unavailable, plus a few narrow helper cases.

### Measurement Strategy by Layout Family

Not every layout measures text the same way.

| Layout family | Measurement rule |
|---------------|------------------|
| Plain stacked layouts (`bullets`, `agenda`, `summary`, `diagram`, `title_only`) | Measure the entire content block once at the content width |
| `cards` / `stats` / `comparison` / `two_content` / `process` / `multi_column` | Measure each bullet independently at the actual per-column width |
| `timeline` / `pyramid` | Measure each bullet independently at the actual node text width (`text_w`) |
| `content_caption` / `picture_caption` | Title and key-message measured at left-column width (~4.30"); content measured at right-column width (~7.16") |
| `quote` / `big_number` | Measured at wide-margin content width (margin_x = 1.5–1.8") |
| `chart` / `closing` / `photo_fullbleed` | Minimal measurement — header zones only; content area is fixed or absent |
| `table` | Header zones only — table content height is determined by the stretch content zone; no per-cell measurement |

This distinction matters because measuring a whole bullet list at full slide width systematically underestimates height for narrow card columns or timeline labels.

### Content-Adaptive Measurement

Per-item text measurement prevents overflow-driven collisions:

1. Each bullet/card text is measured at its actual column width, not the full slide width.
2. The maximum measured height across items determines `card_measured_h`.
3. `card_measured_h` is passed to the solver, which computes `content_h = card_measured_h × rows + gap_y × (rows - 1)`.
4. The solver adjusts all zones to accommodate that content height.

For timelines: `step_y = card_measured_h / 0.85` because the node rect uses 85% of step height. Content height = `step_y × item_count`.

Measurement is batched deck-wide. `hybrid_layout.py` builds one queue of title/key-message/content/notes requests, sends them through the Pillow backend in a single batch, then splits the results back by slide and zone.

One small exception exists outside the main backend path: chip text uses the shared `estimate_text_height_in()` heuristic with a tighter `line_height=1.12` when computing chip-band height.

---

## Stage 3: Constraint Solver

The constraint solver prevents collisions before PPTX generation by computing non-overlapping coordinates. It uses the Cassowary algorithm (kiwisolver) with four strength levels.

### Strength Hierarchy

| Strength | Purpose | Examples |
|----------|---------|---------|
| `required` | Hard constraints — must never be violated | Slide bounds, minimum zone heights, sequential ordering |
| `strong` | Stretch goals — fill remaining space | Content zones expand to use available height |
| `medium` | Preferred positions from blueprint | Preferred y-positions and gap sizes |
| `weak` | Aesthetic balance | Equal spacing, visual centering |

### Vertical Zone Chain

Zones are ordered top-to-bottom as a non-overlapping chain:

```
required: first_zone.y >= margin_top
required: notes_zone.y == tokens.notes_y
required: curr.y >= prev.y + prev.h + (accent_gap if prev is ACCENT else gap_y)
required: zone.h >= zone.min_h
required: zone.h >= measured_h   # when the active text backend returns a larger value
required: zone.y + zone.h <= SLIDE_HEIGHT
```

This chain structure guarantees no vertical overlap between zones. On top of that, `CONTENT`, `FOOTER`, `CHIPS`, and `SUMMARY_BOX` are strongly constrained to end above the fixed notes band, and any zone marked `stretch=True` is strongly encouraged to absorb the remaining height up to that boundary.

The Cassowary solver then assigns exact y-positions that satisfy all constraints simultaneously, preferring `medium`-strength preferred heights and `weak`-strength visual balance when possible.

### Horizontal Layout (Deterministic)

Horizontal positions are computed directly from design tokens; no solver is needed:

```
body_width   = SLIDE_WIDTH - 2 × margin_x
header_width = body_width - (icon_size + icon_margin if has_icon)

For cards:    card_w = (body_width - (columns - 1) × gap_x) / columns
For stats:    box_w  = (body_width - (count - 1) × gap_x) / count
For timeline: text_w = body_width - (text_x - margin_x)
```

When a slide includes a corner icon, the icon only narrows the **header band**
(`title_rect` / `key_message_rect`). The main body is pushed below the icon
bottom so the slide does not keep an unused full-height gutter on the right.

Card positions within a grid are:

```text
card_x = start_x + col × (card_w + gap_x)
card_y = start_y + row × (card_h + gap_y)
```

Since all cards share the same grid formula and the solver ensures the content zone has sufficient height for all rows, no horizontal or vertical card-to-card collision is possible.

### Caption Layout Split (`content_caption` / `picture_caption`)

Caption layouts use a post-solve adjustment that overrides the default full-width zones with a left/right split:

```text
narration_w = 4.30"
right_x     = narration_w + margin_x + gap_x
right_w     = SLIDE_WIDTH - right_x - margin_x

title_rect and key_message_rect are narrowed to narration_w (left column)
content_rect is repositioned to (right_x, body_top, right_w, body_h)
hero_rect (picture_caption only) mirrors the content_rect position
```

This layout is modelled after PowerPoint's built-in "Content with Caption" and "Picture with Caption" slide masters, which place a ~35% narration column on the left and ~65% content/picture area on the right.

### Two-Pass Solving with Relaxation

Inspired by matplotlib's `_constrained_layout.py` (which runs its solver twice because decorations change size after the first reposition), the constraint solver uses a two-pass strategy:

1. **Pass 1** — Solve with original measured heights.
2. **Quality check** — Compare solved heights against targets. For each non-fixed zone, compute a compression ratio: `(target - solved_h) / (target - min_h)`. If any zone's ratio exceeds 25%, the layout is flagged as overcrowded.
3. **Pass 2 (conditional)** — If overcrowded, relax non-essential zones (`KEY_MESSAGE`, `CHIPS`, `FOOTER`) by removing their measured height overrides so the solver falls back to `min_h`. Re-solve. This claws back vertical space for the stretch (content) zone.

```text
Pass 1:  title=1.80  key=1.50  content=1.92  (content compressed 0.86)
         → overcrowded! trigger relaxation
Pass 2:  title=1.80  key=0.30  content=3.12  (key relaxed → content +62%)
```

The quality metrics are attached to each `LayoutSpec` via the `solve_quality` field:

| Field | Meaning |
|-------|---------|
| `compressed_zones` | Zone role names that were squeezed below their target |
| `max_compression_ratio` | Worst-case ratio (0 = perfect fit, 1 = squeezed to min_h) |
| `is_overcrowded` | True when any zone exceeds the 25% compression threshold |
| `relaxation_pass` | True when a second solve pass was used |

This metadata is serialized into `layout-specs.json` and is available to the Python runner, enabling future adaptive behaviour such as reducing item counts or switching to a denser layout type.

---

## Runtime Integration

The final Python rendering stage does not talk to the layout engine directly. Instead, `pptx-python-runner.py` loads the geometry + helper contract once, then passes it into the deterministic renderer and validation helpers.

### Geometry Objects Injected at Runtime

| Symbol | Purpose |
|--------|---------|
| `PRECOMPUTED_LAYOUT_SPECS` | Required list of measured `LayoutSpec` objects from the hybrid engine |
| `flow_layout_spec()` | Cascade helper used internally by the layout engine |
| `LayoutSpec`, `RectSpec`, `CardsSpec`, `StatsSpec`, `TimelineSpec`, `ComparisonSpec` | Dataclasses used by the renderer and validator |
| `SLIDE_ASSETS`, `slide_assets()`, `slide_image_paths()` | Approved per-slide asset metadata and helpers for selected images |
| `PPTX_ICON_COLLECTION` | Active icon collection identifier enforced by the runtime |

### String Constants Injected at Runtime

| Constant | Purpose |
|----------|---------|
| `OUTPUT_PATH` | Absolute path where the generated PPTX is written |
| `PPTX_TITLE` | Presentation title string |
| `PPTX_THEME` | Serialized theme palette JSON |
| `PPTX_COLOR_TREATMENT` | Fill behavior: `solid`, `gradient`, or `mixed` |
| `PPTX_TEXT_BOX_STYLE` | Panel behavior: `plain`, `with-icons`, or `mixed` |
| `WORKSPACE_DIR` | Absolute path to the active workspace directory |
| `IMAGES_DIR` | Absolute path to `<workspace>/images/` |

### Content / Asset Helpers Injected at Runtime

| Helper | Signature | Purpose |
|--------|-----------|---------|
| `safe_add_picture()` | `(shapes, path, left_emu, top_emu, width_emu, height_emu) → Picture` | Adds images safely preserving aspect ratio and handling icon scaling. First arg must be `slide.shapes`, never `slide`. |
| `safe_image_path()` | `(path) → str` | Validates and normalizes image paths |
| `fetch_icon()` | `(icon_id, color_hex) → path_or_None` | Fetches an icon from Iconify at runtime; rejects names outside the selected icon collection |
| `resolve_font()` | `(text, fallback_name) → font_name_str` | Returns the selected base font unchanged. PowerPoint handles glyph substitution for missing characters at render time. |
| `estimate_text_height_in()` | `(text, width_in, font_size_pt) → float` | Shared text height heuristic (CJK-aware) used by the renderer and validator |
| `contrast_ratio()` / `ensure_contrast()` | `ensure_contrast(fg_hex, bg_hex) → hex_str` | Contrast helpers for choosing readable text colors on filled panels |
| `apply_widescreen()` | `(prs) → prs` | Forces 16:9 slide dimensions on the presentation object. Used for blank decks (`apply_widescreen(Presentation())`). |
| `set_fill_transparency()` | `(shape, value_0_to_1) → None` | Sets fill transparency without touching internal XML proxies directly |

### Chart Namespace Injected at Runtime

The following names are available to the rendering runtime for chart slides:

| Symbol | Source | Purpose |
|--------|--------|---------|
| `add_native_chart()` | runtime helper | Adds a standard business chart (bar, line, pie, etc.) inside `spec.content_rect` |
| `add_chart_picture()` | runtime helper | Renders a complex chart via matplotlib/seaborn and inserts the resulting image |
| `CategoryChartData` | `pptx.chart.data` | Data container for category-based charts |
| `XyChartData` | `pptx.chart.data` | Data container for XY scatter charts |
| `XL_CHART_TYPE` | `pptx.enum.chart` | Chart type enum |
| `plt` | `matplotlib.pyplot` | Matplotlib pyplot module |
| `sns` | `seaborn` | Seaborn module |
| `np` | `numpy` | NumPy module |

### Table Layout

The `table` layout type renders native PowerPoint tables from structured bullet data. Unlike other content layouts where bullets become text panels or cards, table slides parse each bullet line into cells and construct an `a:tbl` element directly.

#### Data Encoding

Table data is encoded in the slide's `bullets` array. Each bullet becomes one row. Cells within a row are delimited by one of three syntaxes (auto-detected in priority order):

| Syntax | Example | When to use |
|--------|---------|-------------|
| Pipe-delimited | `Region \| Q1 \| Q2 \| Q3` | Preferred — markdown-compatible |
| Tab-delimited | `Region\tQ1\tQ2\tQ3` | Useful for pasted spreadsheet data |
| Comma-delimited | `Region, Q1, Q2, Q3` | Fallback for simple data |

The first bullet is always treated as the **header row**. Markdown separator rows (e.g. `---|---|---`) are automatically skipped. Rows with fewer cells than the widest row are padded with empty strings.

#### Rendering Behavior

The deterministic renderer (`_render_table_slide`) produces a styled native table with these features:

| Feature | Behavior |
|---------|----------|
| **Header row** | Accent-colored fill, centered bold text, white/contrasted font |
| **Zebra stripes** | Alternating body rows use a 92%-lightened tint of the accent color |
| **Auto column widths** | First column is ~25% wider (label column); remaining columns share equally |
| **Numeric alignment** | Columns where ≥60% of data cells are numeric are right-aligned |
| **Adaptive font sizing** | 12pt for ≤12 cells, 11pt ≤24, 10pt ≤40, 9pt for dense tables |
| **Cell margins** | 0.10″ horizontal, 0.04″ vertical |
| **Banded rows** | XML-level `bandRow="1"` attribute for theme-aware rendering in PowerPoint |

#### Blueprint

The table blueprint uses a standard header (title + key message + accent) with a stretch content zone:

```text
┌─────────────────────────────────────────────────┐
│  Title                                          │  min_h=0.40
├─────────────────────────────────────────────────┤
│  Key Message                                    │  min_h=0.30
├─────────────────────────────────────────────────┤
│  ═══ accent rule ═══                            │  fixed_h=0.04
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────┬────────┬────────┬────────┐         │
│  │ Header  │ Col A  │ Col B  │ Col C  │         │
│  ├─────────┼────────┼────────┼────────┤         │  content (stretch, min_h=2.8)
│  │ Row 1   │  ...   │  ...   │  ...   │         │
│  │ Row 2   │  ...   │  ...   │  ...   │         │
│  └─────────┴────────┴────────┴────────┘         │
│                                                 │
├─────────────────────────────────────────────────┤
│  Footer                                         │  fixed_h=0.22
├─────────────────────────────────────────────────┤
│  Notes                                          │  fixed_h=0.70
└─────────────────────────────────────────────────┘
```

#### Measurement Strategy

Table slides skip content text measurement entirely. The `hybrid_layout.py` orchestrator returns an empty string for table content zones, so the solver falls back to the blueprint's `preferred_h` (4.2″). Only the title and key-message zones are measured for text height.

### Asset-Grounding Rule

Generated PPTX code should treat runtime asset metadata as authoritative:

- `slide_image_paths(slide_index)` returns the approved local image paths for that slide in priority order.
- `slide_assets(slide_index)` returns the full metadata object, including `imageQueries`, `primaryImagePath`, and the raw `selectedImages` entries.
- `fetch_icon()` is constrained by `PPTX_ICON_COLLECTION`, so out-of-collection icon names return `None` instead of silently falling back to another set.

This keeps the generated deck aligned with the user's chosen images and icon set instead of relying on prompt text alone.

### Execution Rule

Generated code should prefer:

```python
spec = PRECOMPUTED_LAYOUT_SPECS[i]
```

The hybrid engine always computes specs before generation. `PRECOMPUTED_LAYOUT_SPECS` is guaranteed to be available.

### Text Frame Rule

The runtime contract distinguishes between two classes of text containers:

- **Free textboxes** (`title`, `key_message`, `notes`) should use `MSO_AUTO_SIZE.NONE` because their height is already computed by the layout system.
- **Panel/card shapes** should use `MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE` because their geometry is fixed and PowerPoint may need to shrink text.

That distinction is also enforced by the validator's auto-correction pass, which only turns on `TEXT_TO_FIT_SHAPE` for non-textbox shapes.

---

## Post-Generation Processing

After the generated Python writes the PPTX file, `pptx-python-runner.py` performs post-generation steps in this order:

1. Text overflow repair when a measurement backend is available.
2. Auto-size flags when no measurement backend is available.
3. Contrast repair.
4. Layout validation.
5. Preview image rendering when requested.

```
Generated python-pptx code
        │
        ▼
  Write PPTX file
        │
        ▼
  validate_and_fix_output(output_path)
        │
    ├── Text overflow fix (normal PPTX export path)
    │     Measure overflow and repair text-bearing shapes using Pillow
    │     Falls back to the shared heuristic only if Pillow is unavailable
    │     Runs in up to 2 bounded passes, becoming slightly more aggressive on the second pass
    │
    ├── Auto-size path (when no measurement backend is available)
    │     Enable `TEXT_TO_FIT_SHAPE` on panel/card shapes only
    │
    ├── Contrast fix
    │     Repair low-contrast text/fill combinations on glass panels/cards
    │
    └── validate_presentation(prs)
      │
      ├── No issues → Success
      ├── INFO/WARNING only → Report (non-blocking)
      ├── ≤ 2 blocking issues without text overflow → Tolerated as incomplete layout
      └── > 2 blocking issues → Raise runtime error
```

The `PPTX_SKIP_TEXT_OVERFLOW_FIX=1` environment variable can be set to skip the overflow-repair phase, keeping only contrast repair + validation. This is used during preview rendering to speed up the feedback loop.

If validation still finds blocking issues that exceed tolerance, or any blocking text-overflow issue, the runner raises a `RuntimeError`.

---

## Layout Validation and Collision Detection

The layout validator (`layout_validator.py`) emits four issue types after PPTX generation: `TEXT_OVERFLOW`, `OUT_OF_BOUNDS`, `OVERLAP`, and `CRAMPED`. Those checks are built on Axis-Aligned Bounding Box (AABB) geometry in EMU coordinates plus a small set of exclusion heuristics for decorative shapes.

### 1. Shape Bounding Box Extraction

Every shape is converted to a `ShapeBox`:

```python
@dataclass
class ShapeBox:
    left: int    # EMU from left edge
    top: int     # EMU from top edge
    width: int   # EMU
    height: int  # EMU

    @property
    def right(self) -> int:   return self.left + self.width
    @property
    def bottom(self) -> int:  return self.top + self.height
```

**Exclusion filters** — these shapes are skipped before collision testing:
- **Background fills**: shapes covering ≥95% of slide width AND height
- **Decorative frames**: text-free rectangles or rounded rectangles with no solid fill that cover at least 50% of slide width AND height
- **Decorative ovals**: text-free shapes whose generated name starts with `Oval`
- **Named decorations**: shapes whose `name` starts with `bg_blob`

### 2. AABB Overlap Test

Two bounding boxes overlap if and only if they intersect on both axes simultaneously. A tolerance of `OVERLAP_TOLERANCE_EMU` (0.05″ = 45720 EMU) prevents edge-touching shapes from being flagged.

```text
Overlap condition (both must be true):
  A.right  - tolerance > B.left   AND  B.right  - tolerance > A.left
  A.bottom - tolerance > B.top    AND  B.bottom - tolerance > A.top
```

Visually:

```text
No overlap (horizontal separation):
  ┌───A───┐        ┌───B───┐
  │       │        │       │
  └───────┘        └───────┘
  A.right ≤ B.left  →  no collision

Overlap (both axes intersect):
  ┌───A───┐
  │    ┌──┼──B───┐
  └────┼──┘      │
       └─────────┘
  overlap_area = (min(A.right, B.right) - max(A.left, B.left))
               × (min(A.bottom, B.bottom) - max(A.top, B.top))
```

### 3. Overlap Area & Severity Classification

The overlap is quantified as a ratio of the smaller shape's area:

```text
overlap_ratio = overlap_area / min(A.area, B.area)
```

| Overlap Ratio | Severity | Meaning |
|---------------|----------|---------|
| ≤ 5% | (ignored) | Sub-pixel or trivial — not reported |
| 5% – 25% | WARNING | Minor incursion — may be intentional |
| > 25% | ERROR | Significant collision — layout is broken |

**Severity downgrades** (ERROR → WARNING):

| Condition | Rationale |
|-----------|-----------|
| Small non-text shape overlapping a larger shape (area < 35% of larger) | Decorative overlay (icon badge, accent rule) |
| One shape fully contained within the other | Intentional parent-child nesting (caption inside image frame) |
| `image_caption*` shape overlapping a `Picture*` shape | Intentional captioned-image pattern |

### 4. Out-of-Bounds Detection

Each shape is tested against slide boundaries:

```text
OOB conditions (any triggers WARNING):
  shape.left   < 0
  shape.top    < 0
  shape.right  > SLIDE_WIDTH_EMU  + OVERLAP_TOLERANCE_EMU
  shape.bottom > SLIDE_HEIGHT_EMU + OVERLAP_TOLERANCE_EMU
```

Auto-correction clamps the shape inside slide bounds while preserving dimensions when possible. If the shape is wider or taller than the slide, it is shrunk to fit within safe margins.

### 5. Cramped Spacing Detection

For non-overlapping shapes that share a horizontal or vertical band, the validator checks that the gap meets `MIN_GAP_EMU` (0.15″):

```text
Shapes share a vertical band (horizontally adjacent):
  NOT (A.bottom ≤ B.top OR B.bottom ≤ A.top)
  → check horizontal gap: min(B.left - A.right, A.left - B.right)

Shapes share a horizontal band (vertically adjacent):
  NOT (A.right ≤ B.left OR B.right ≤ A.left)
  → check vertical gap: min(B.top - A.bottom, A.top - B.bottom)
```

Gaps below `MIN_GAP_EMU` are flagged as `INFO` severity.

### 6. Text Overflow Detection

For shapes with text, the validator estimates required height with the shared `estimate_text_height_in()` helper from `layout_specs.py`. The current estimator is CJK-aware and uses weighted visual character widths instead of a raw `len(text)` approximation:

```python
def estimate_text_height_in(text, width_in, font_size_pt, line_height=1.22):
  em_per_line = max(width_in / (font_size_pt / 72.0), 3.0)
  visual_w = sum(1.0 if is_wide_char(ord(ch)) else 0.52 for ch in paragraph)
  lines = sum(max(ceil(visual_w / em_per_line), 1) for paragraph in paragraphs)
  base = lines * (font_size_pt / 72.0) * line_height
  cushion = 0.06 + 0.02 * max(lines - 1, 0)
  if font_size_pt >= 24:
    cushion += 0.08
  return base + cushion
```

The validator then adds a small extra pad for real slide conditions:

- `+0.08"` when the text appears to be bulleted
- text-frame top/bottom margins from the shape itself
- `+0.04"` as a general text-frame safety margin

| Height Ratio (required / available) | Severity | Meaning |
|--------------------------------------|----------|---------|
| > 1.12 | ERROR (or WARNING if auto-size enabled) | Text overflows its box |
| 0.92 – 1.12 | WARNING | Box is text-dense, at risk of overflow |
| ≤ 0.92 | (ok) | Sufficient space |

Shapes with `MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE` get a downgrade to WARNING because PowerPoint will auto-shrink the font at render time.

### 7. Two-Phase Shape Model (Shape Role Classification)

Shapes on a slide belong to one of two semantic roles. The validator classifies every shape before running checks, so that **template/design elements do not trigger general collision or cramped-spacing issues** against blueprint-managed content.

**Architecture**

The classifier uses a **layered resolution model** with three tiers. Each tier is tried in order; the first match wins:

1. **Shape Semantic Registry** (authoritative) — an in-memory `Dict[int, str]` keyed by `shape.shape_id`, populated at creation time by runtime helpers (`tag_as_design`, `safe_add_picture`, `add_design_shape`, `add_managed_shape`, `add_managed_textbox`). The registry is the single source of truth when available.
2. **Blueprint Geometry Match** — the validator compares each shape's bounding box against the `PRECOMPUTED_LAYOUT_SPECS` rects for its slide (within ±0.12″ tolerance). A match positively classifies the shape as `LAYOUT_MANAGED`.
3. **Name-Based And Heuristic Classification** — name-prefix conventions, geometric heuristics, the `includeImagesInLayout` flag, and the default `LAYOUT_MANAGED` classification cover shapes that are not resolved by the registry or blueprint geometry.

| Role | Included In | Excluded From | Examples |
|------|-------------|---------------|----------|
| `TEMPLATE_DESIGN` | Out-of-bounds, text overflow | General overlap, cramped spacing | Backgrounds, decorative borders, brand glyphs, watermarks, accent blobs |
| `LAYOUT_MANAGED` | All checks | (none) | Title, key message, content cards, charts, hero images placed from `PRECOMPUTED_LAYOUT_SPECS` |

**Classification priority** (first match wins):

1. **Registry entry** — `_SHAPE_ROLE_REGISTRY[shape.shape_id]` → `TEMPLATE_DESIGN` or `LAYOUT_MANAGED`
2. **Blueprint geometry match** — shape bounding box matches a `LayoutSpec` rect (±0.12″) → `LAYOUT_MANAGED`
3. **Explicit icon prefix** — shape names starting with `icon_`, `design_icon_`, or `decor_icon_` → `TEMPLATE_DESIGN`
4. **Explicit design prefix** — shape names starting with `tmpl_`, `design_`, `bg_blob`, `bg_`, or `decor_` → `TEMPLATE_DESIGN`
5. **Heuristic detection** — background fills (≥95% slide area), decorative frames (unfilled, ≥50%), text-free ovals → `TEMPLATE_DESIGN`
6. **Picture shape + `includeImagesInLayout` flag** — when the flag is off, Picture shapes default to `TEMPLATE_DESIGN`
7. **Default** → `LAYOUT_MANAGED`

**Important exception**

Decorative icons embedded inside text-box compositions are not treated as layout-managed items, but they are still checked against the textbox's usable text area. In other words:

- decorative icons are excluded from slide-level collision checks
- decorative icons must still not overlap rendered text space inside a textbox

### 7.1 Shape Semantic Registry

The registry (`_SHAPE_ROLE_REGISTRY`) lives in [scripts/pptx-python-runner.py](scripts/pptx-python-runner.py) as a module-level `dict[int, str]`. It is:

- **Reset** at the start of every generation run (in `build_namespace()`).
- **Populated** by every shape-creation helper as it creates or tags a shape.
- **Consumed** by `validate_presentation()` which receives `shape_role_registry=get_shape_role_registry()`.

Because classification happens via integer shape IDs rather than string names, the registry is immune to naming convention violations and works even when the LLM bypasses prefix rules.

### 7.2 Blueprint Geometry Match

When the registry has no entry for a shape, the validator tries to match the shape's bounding box against the `LayoutSpec` rects for its slide. This layer provides strong classification for blueprint-placed content even when shapes were created by direct `add_shape()` / `add_textbox()` calls that bypassed the wrappers.

The match uses a tolerance of ±0.12″ per coordinate to absorb minor rounding effects. The following spec fields are checked:

- Simple rects: `title_rect`, `key_message_rect`, `icon_rect`, `content_rect`, `notes_rect`, `summary_box`, `hero_rect`, `chips_rect`, `footer_rect`, `sidebar_rect`
- Card grid: `cards.rects[*]`
- Stats row: `stats.boxes[*]`
- Timeline nodes: `timeline.nodes[*]`
- Comparison panels: `comparison.left`, `comparison.right`

`accent_rect` is deliberately excluded from positive blueprint matching because accent shapes can be either structural or purely decorative depending on context.

### 7.3 Blueprint Item Mapping

The table below describes the **intended classification of blueprint-resolved items**. These are the items generated from `PRECOMPUTED_LAYOUT_SPECS` and should normally be treated as `LAYOUT_MANAGED`.

| Blueprint / Runtime Item | Source Field | Intended Classification | Notes |
|--------------------------|--------------|-------------------------|-------|
| Title textbox | `spec.title_rect` | `LAYOUT_MANAGED` | Structural text zone |
| Key message textbox | `spec.key_message_rect` | `LAYOUT_MANAGED` | Structural text zone |
| Accent rule / accent panel | `spec.accent_rect` | `LAYOUT_MANAGED` when used as a real structural band; otherwise `TEMPLATE_DESIGN` if purely decorative | Context-dependent — use registry to disambiguate |
| Reserved icon zone | `spec.icon_rect` | `LAYOUT_MANAGED` for the zone itself | The icon picture inside it may still be decorative |
| Main content zone | `spec.content_rect` | `LAYOUT_MANAGED` | Parent zone for most slide content |
| Notes zone | `spec.notes_rect` | `LAYOUT_MANAGED` | Reserved structural text zone |
| Summary box | `spec.summary_box` | `LAYOUT_MANAGED` | Structured content block |
| Hero image zone | `spec.hero_rect` | `LAYOUT_MANAGED` | Usually a real content image target |
| Chips zone | `spec.chips_rect` | `LAYOUT_MANAGED` | Structured content tokens |
| Footer zone | `spec.footer_rect` | `LAYOUT_MANAGED` | Structural footer content |
| Sidebar zone | `spec.sidebar_rect` | `LAYOUT_MANAGED` | Structured side content |
| Cards grid | `spec.cards` | `LAYOUT_MANAGED` | Card rectangles are part of collision-managed layout |
| Stats row | `spec.stats` | `LAYOUT_MANAGED` | Structured metric boxes |
| Timeline nodes | `spec.timeline` | `LAYOUT_MANAGED` | Structured sequential content |
| Comparison panels | `spec.comparison.left/right` | `LAYOUT_MANAGED` | Structured side-by-side content |

### 7.4 Non-Blueprint Item Mapping

The following items are **not** primarily determined by the constraint solver and therefore rely on the registry or validator classification logic.

| Item Type | Classification | How It Is Decided |
|-----------|----------------|-------------------|
| Template background fills | `TEMPLATE_DESIGN` | Registry via `add_design_shape()` / `tag_as_design()`; heuristics cover unregistered shapes |
| Decorative borders / frames | `TEMPLATE_DESIGN` | Registry via `add_design_shape()`; heuristics cover unregistered shapes |
| Watermarks / brand marks | `TEMPLATE_DESIGN` | Registry via `tag_as_design()` |
| Accent blobs / glow ovals | `TEMPLATE_DESIGN` | Registry via `add_design_shape()`; heuristics cover unregistered shapes |
| Hero/content images | `LAYOUT_MANAGED` | Registry via `safe_add_picture()`; slide configuration also informs picture classification when needed |
| Decorative inline icons | `TEMPLATE_DESIGN` | Registry via `safe_add_picture()` auto-detection of icon assets |
| Decorative inline icons vs textbox text area | Special-case overlap validation | Decorative for layout, but still checked against text-content box |

### 7.5 Runtime Helpers for Generated Code

| Helper | Phase | Purpose |
|--------|-------|---------|
| `add_design_shape(shapes, type, left, top, w, h, name="")` | 1 | Creates an auto-shape and registers it as `TEMPLATE_DESIGN`. Use for backgrounds, borders, accent blobs. |
| `safe_add_design_picture(shapes, path, left, top, w, h)` | 1 | Adds an image and registers it as `TEMPLATE_DESIGN`. |
| `tag_as_design(shape, name="")` | 1 | Retroactively registers an existing shape as `TEMPLATE_DESIGN`. |
| `add_managed_shape(shapes, type, left, top, w, h, name="")` | 2 | Creates an auto-shape and registers it as `LAYOUT_MANAGED`. Use for cards, panels, stat boxes. |
| `add_managed_textbox(shapes, left, top, w, h, name="")` | 2 | Creates a textbox and registers it as `LAYOUT_MANAGED`. Use for title, key message, notes. |
| `safe_add_picture(shapes, path, left, top, w, h)` | 2 | Adds a picture; auto-registers as `TEMPLATE_DESIGN` for icon assets, `LAYOUT_MANAGED` otherwise. |

Generated code should follow a two-phase pattern:

```
Phase 1 — Template / design composition
  Add background fills, decorative borders, brand elements, watermarks.
  Use add_design_shape() or safe_add_design_picture() for each element.
  Use tag_as_design() for shapes created by other means.
  These do NOT need to respect PRECOMPUTED_LAYOUT_SPECS geometry.

Phase 2 — Blueprint-driven content placement
  Position title, key message, content, cards, charts, images using
  PRECOMPUTED_LAYOUT_SPECS[slide_index].{title_rect, content_rect, ...}.
  Use add_managed_textbox() for text zones.
  Use add_managed_shape() for structural panels (cards, stat boxes).
  Use safe_add_picture() for content images.
  These shapes are LAYOUT_MANAGED and participate in collision detection.
```

### 7.6 Ownership and Data Flow

```
pptx-python-runner.py                  layout_validator.py
┌──────────────────────┐              ┌──────────────────────────────┐
│ _SHAPE_ROLE_REGISTRY │──────────────▶│ shape_role_registry param    │
│ (Dict[int, str])     │              │   ↓ 1st tier: registry lookup│
│                      │              │                              │
│ _LOADED_LAYOUT_SPECS │──────────────▶│ layout_specs param           │
│ (list[LayoutSpec])   │              │   ↓ 2nd tier: geometry match │
│                      │              │                              │
│ (name prefixes)      │ ─ ─ ─ ─ ─ ─ ▶│   ↓ 3rd tier: prefix/heur. │
└──────────────────────┘              └──────────────────────────────┘
```

- [scripts/pptx-python-runner.py](scripts/pptx-python-runner.py) — owns the registry and creation wrappers; passes both registry and specs to the validator
- [scripts/layout/layout_validator.py](scripts/layout/layout_validator.py) — consumes registry + specs + classification rules; owns classification logic and validation checks
- [electron/ipc/llm/chat-handler.ts](electron/ipc/llm/chat-handler.ts) — workflow control plane that can trigger reruns or infrastructure patching when validation fails

---

## Auto-Correction Policy

The post-generation validator is intentionally conservative. It does not try to redesign the slide after the fact.

### What It Fixes Automatically

- Enables `TEXT_TO_FIT_SHAPE` for panel/card shapes so PowerPoint may shrink overflowing text
- Clamps shapes that extend outside slide boundaries back inside safe margins

### What It Does Not Fix Automatically

- Reposition overlapping content blocks
- Recompute a broken grid or timeline
- Split dense content into additional slides
- Reflow the entire slide after an LLM hardcodes invalid coordinates

Those cases are escalated back to the agent via infrastructure patch tools or a full PPTX regeneration.

---

## Known Limitations and Trade-Offs

No layout engine can make arbitrary generated code safe in all cases. The current system intentionally optimizes for determinism and repairability rather than unlimited flexibility.

### 1. Horizontal Layout Is Mostly Token-Based

Only vertical positions are solved by Cassowary. Horizontal placement is deterministic math from margins, widths, and gaps. This keeps the solver simple and stable, but means an LLM can still create horizontal collisions by ignoring the provided `spec.*` rectangles.

### 2. Measurement Uses a Single Declared Font Family

Measurement uses the slide's declared `font_family` (set to `PPTX_FONT_FAMILY`, user-selected, defaults to Calibri) through the active backend. Runtime code also keeps that selected font unchanged via `resolve_font()`. PowerPoint may still substitute missing glyphs at render time, which can introduce small residual differences in line breaks.

### 3. Post-Generation Validation Is Geometric, Not Semantic

The validator knows whether two boxes overlap. It does not know whether the slide is visually elegant, whether the headline hierarchy is strong enough, or whether a chart is too small to be readable.

### 4. Decorative Heuristics Are a Last-Resort Classifier

Shapes are classified primarily through the semantic registry and blueprint geometry matching. Name-prefix and geometric heuristics (`Oval*`, `bg_blob*`, background fill, decorative frame) are only used for shapes that were not created through the registry-aware helpers. If rendering code bypasses all wrappers and creates shapes with unexpected names, heuristics may still misclassify them.

### 5. Auto-Size Is a Safety Net, Not the Primary Layout Strategy

`TEXT_TO_FIT_SHAPE` can save a deck from catastrophic overflow, but it may reduce fonts to unreadable sizes. The preferred strategy remains: measure first, solve geometry second, render third.

### 6. Import Path Must Use Bare Module Names

External callers must use bare imports (`from layout_blueprint import ...`) after adding `scripts/layout/` to `sys.path`. Mixing qualified paths (`scripts.layout.layout_blueprint`) with the layout modules' bare imports creates duplicate `ZoneRole` enum classes, silently disabling all role-based solver constraints. See the Import Convention section below for details.

---

## Practical Guidance for Renderer Integrations

The engine works best when the rendering layer follows a small set of strict rules:

1. Use `PRECOMPUTED_LAYOUT_SPECS[i]` whenever available.
2. Never invent raw `x`, `y`, `w`, `h` coordinates for major elements.
3. Place all content relative to `spec.title_rect`, `spec.content_rect`, `spec.cards`, `spec.timeline`, and related sub-rectangles.
4. For title/key-message/notes textboxes, keep `MSO_AUTO_SIZE.NONE`; for fixed panels, use `TEXT_TO_FIT_SHAPE`.
5. When a slide has many images, create a real multi-image composition instead of reusing one image placeholder.
6. Treat title, key message, notes, and footer as reserved structural zones; do not place content into them opportunistically.
7. If validation reports blocking issues, reduce density, reserve more space, or regenerate; do not keep stacking more shapes into the same space.
8. Treat the app-level layout repair and rerun tooling as external to the layout engine API contract — they are fallback mechanisms, not part of the engine itself.

---

## Constants Quick Reference

| Constant | Value | File |
|----------|-------|------|
| `SLIDE_WIDTH_IN` | 13.333″ | `layout_specs.py` |
| `SLIDE_HEIGHT_IN` | 7.5″ | `layout_specs.py` |
| `SAFE_MARGIN_IN` | 0.3″ | `layout_specs.py` |
| `HEADER_WIDTH_RATIO` | 0.95 | `layout_specs.py` |
| `gap_y` | 0.08″ | `layout_blueprint.py` default tokens |
| `accent_gap` | 0.18″ | `layout_blueprint.py` default tokens |
| `notes_y` | 6.18″ | `layout_blueprint.py` default tokens |
| `notes_h` | 0.70″ | `layout_blueprint.py` default tokens |
| `SLIDE_WIDTH_EMU` | `Inches(13.333)` | `layout_validator.py` |
| `SLIDE_HEIGHT_EMU` | `Inches(7.5)` | `layout_validator.py` |
| `SAFE_MARGIN_EMU` | `Inches(0.3)` | `layout_validator.py` |
| `MIN_GAP_EMU` | `Inches(0.15)` | `layout_validator.py` |
| `OVERLAP_TOLERANCE_EMU` | `Inches(0.05)` | `layout_validator.py` |
| EMU per inch | 914400 | python-pptx standard |

---

## Import Convention (Critical)

The layout modules (`layout_blueprint.py`, `layout_specs.py`, `constraint_solver.py`, `hybrid_layout.py`, `font_text_measure.py`) all live in `scripts/layout/` and import each other using bare module names:

```python
from layout_blueprint import ZoneRole, get_blueprint
from layout_specs import LayoutSpec, flow_layout_spec
from constraint_solver import solve_layout
```

Any external caller that needs the layout engine must add `scripts/layout/` to `sys.path` and use the same bare imports. Never mix qualified (`scripts.layout.layout_blueprint`) and bare (`layout_blueprint`) import paths in the same process.

**Why**: Python treats `scripts.layout.layout_blueprint` and `layout_blueprint` as two separate modules, even though they point to the same file. This creates two independent copies of every class and enum. `ZoneRole.NOTES` from one copy is not equal to `ZoneRole.NOTES` from the other, which silently breaks all role-based constraint solver logic such as notes pinning, accent gap, and stretch targeting.

```python
# CORRECT — add scripts/layout/ to sys.path, use bare imports
import sys
sys.path.insert(0, str(Path('scripts/layout')))
from layout_blueprint import ZoneRole, get_blueprint
from constraint_solver import solve_layout

# WRONG — qualified import creates a second module identity
from scripts.layout.layout_blueprint import ZoneRole  # different ZoneRole!
from scripts.layout.constraint_solver import solve_layout  # solver uses bare ZoneRole
```

---
