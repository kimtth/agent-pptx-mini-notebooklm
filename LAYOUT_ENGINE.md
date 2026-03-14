# Layout Engine — Technical Whitepaper

## Architecture Overview

The layout engine is a three-stage pipeline that produces pixel-perfect slide element coordinates:

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Layout Blueprint │ ──▶ │ COM Text Measurement │ ──▶ │ Constraint Solver │ ──▶ LayoutSpec JSON
│ (design tokens)  │     │ (PowerPoint AutoFit) │     │ (kiwisolver)       │
└─────────────────┘     └─────────────────────┘     └──────────────────┘
```

1. **Layout Blueprint** (`layout_blueprint.py`) — defines design tokens (margins, ratios, zone roles) for each slide layout type.
2. **COM Text Measurement** (`com_text_measure.py`) — uses PowerPoint COM automation to AutoFit text into a given width, returning the actual rendered text height.
3. **Constraint Solver** (`constraint_solver.py`) — feeds blueprint zones + measured heights into a Cassowary constraint solver (kiwisolver) to produce final `LayoutSpec` coordinates.

The output `LayoutSpec` provides `RectSpec(x, y, w, h)` for every element zone (title, key message, content area, cards, icons, footer, etc.).
`hybrid_layout.py` is the orchestration layer around these stages: it batches all measurement requests into one PowerPoint session, solves each slide in order, then serializes the resulting specs to JSON for injection into the Python runner.

When the hybrid engine is unavailable or precomputation fails, the runtime falls back to the static templates in `layout_specs.py` via `get_layout_spec()` and, for text-driven cascading, `flow_layout_spec()`.

---

## Blueprint Model

The solver does not start from raw coordinates. It starts from a declarative `LayoutBlueprint` that describes **what zones exist** on a slide and **how they should behave**.

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
| `font_pt` / `bold` | Measurement hint sent to PowerPoint COM for text-bearing zones. |
| `fixed_h` | Exact height. Used for rules, accent lines, and notes bands. |
| `stretch` | Marks a zone that absorbs remaining vertical space. Usually the content zone. |
| `width_fraction` | Reserved width-hint hook for zones that should use less than the full content width. |

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
| `comparison` | Left/right split comparison |
| `timeline` | Vertical timeline spine + node text |
| `summary` | Summary box followed by content |
| `diagram` | Content with sidebar for diagram support |

The key design principle is: **blueprints define intent, not final geometry**. Final geometry is always solved from blueprint + measured content.

---

## Slide Coordinate System

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

## Layout Collision Detection

The layout validator (`layout_validator.py`) emits four issue types after PPTX generation: `TEXT_OVERFLOW`, `OUT_OF_BOUNDS`, `OVERLAP`, and `CRAMPED`. Those checks are built on **Axis-Aligned Bounding Box (AABB)** geometry in EMU coordinates plus a small set of exclusion heuristics for decorative shapes.

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

Two bounding boxes overlap if and only if they intersect on **both** axes simultaneously. A tolerance of `OVERLAP_TOLERANCE_EMU` (0.05″ = 45720 EMU) prevents edge-touching shapes from being flagged.

```
Overlap condition (both must be true):
  A.right  - tolerance > B.left   AND  B.right  - tolerance > A.left
  A.bottom - tolerance > B.top    AND  B.bottom - tolerance > A.top
```

Visually:

```
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

The overlap is quantified as a ratio of the **smaller** shape's area:

```
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

```
OOB conditions (any triggers WARNING):
  shape.left   < 0
  shape.top    < 0
  shape.right  > SLIDE_WIDTH_EMU  + OVERLAP_TOLERANCE_EMU
  shape.bottom > SLIDE_HEIGHT_EMU + OVERLAP_TOLERANCE_EMU
```

Auto-correction clamps the shape inside slide bounds while preserving dimensions when possible. If the shape is wider/taller than the slide, it's shrunk to fit within safe margins.

### 5. Cramped Spacing Detection

For non-overlapping shapes that share a horizontal or vertical band, the validator checks that the gap meets `MIN_GAP_EMU` (0.15″):

```
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
- `+0.04"` as a general text-frame safety margin

| Height Ratio (required / available) | Severity | Meaning |
|--------------------------------------|----------|---------|
| > 1.12 | ERROR (or WARNING if auto-size enabled) | Text overflows its box |
| 0.92 – 1.12 | WARNING | Box is text-dense, at risk of overflow |
| ≤ 0.92 | (ok) | Sufficient space |

Shapes with `MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE` get a downgrade to WARNING because PowerPoint will auto-shrink the font at render time.

---

## Constraint Solver: How Collisions Are Prevented

The constraint solver prevents collisions **before** PPTX generation by computing non-overlapping coordinates. It uses the Cassowary algorithm (kiwisolver) with four strength levels:

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
required: zone.h >= measured_h   # when COM returns a larger value
required: zone.y + zone.h <= SLIDE_HEIGHT
```

This chain structure **guarantees** no vertical overlap between zones. On top of that, `CONTENT`, `FOOTER`, `CHIPS`, and `SUMMARY_BOX` are strongly constrained to end above the fixed notes band, and any zone marked `stretch=True` is strongly encouraged to absorb the remaining height up to that boundary.

The Cassowary solver then assigns exact y-positions that satisfy all constraints simultaneously, preferring `medium`-strength preferred heights and `weak`-strength visual balance when possible.

### Horizontal Layout (Deterministic)

Horizontal positions are computed directly from design tokens — no solver needed:

```
content_width = SLIDE_WIDTH - 2 × margin_x - (icon_size + icon_margin if has_icon)

For cards:  card_w = (content_width - (columns - 1) × gap_x) / columns
For stats:  box_w  = (content_width - (count - 1) × gap_x) / count
For timeline: text_w = content_width - (text_x - margin_x)
```

Card positions within a grid are:
```
card_x = start_x + col × (card_w + gap_x)
card_y = start_y + row × (card_h + gap_y)
```

Since all cards share the same grid formula and the solver ensures the content zone has sufficient height for all rows, **no horizontal or vertical card-to-card collision is possible**.

### Content-Adaptive Measurement

Per-item text measurement prevents overflow-driven collisions:

1. Each bullet/card text is measured at its **actual column width** (not the full slide width)
2. The maximum measured height across items determines `card_measured_h`
3. `card_measured_h` is passed to the solver, which computes `content_h = card_measured_h × rows + gap_y × (rows - 1)`
4. The solver adjusts all zones to accommodate this content height

For timelines: `step_y = card_measured_h / 0.85` (the 0.85 factor accounts for the node rect using 85% of step height). Content height = `step_y × item_count`.

Measurement is batched deck-wide. `hybrid_layout.py` builds one queue of title/key-message/content/notes requests, sends them through `measure_text_heights()` in a single PowerPoint COM session, then splits the results back by slide and zone.

### Measurement Strategy by Layout Family

Not every layout measures text the same way.

| Layout family | Measurement rule |
|---------------|------------------|
| Plain stacked layouts (`bullets`, `agenda`, `summary`, `diagram`) | Measure the entire content block once at the content width |
| `cards` / `stats` / `comparison` | Measure each bullet independently at the actual per-column width |
| `timeline` | Measure each bullet independently at the actual node text width (`text_w`) |

This distinction matters because measuring a whole bullet list at full slide width systematically underestimates height for narrow card columns or timeline labels.

---

## JSON Contract Between Processes

The layout engine runs as a subprocess (`hybrid_layout.py`) and communicates through JSON.

### Input Schema

Each slide is serialized as `SlideContent`:

```json
{
  "layout_type": "cards",
  "title_text": "Quarterly Results",
  "key_message_text": "Revenue grew 15% YoY",
  "bullets": ["North America", "EMEA", "APAC"],
  "notes": "Speaker notes",
  "item_count": 3,
  "has_icon": true,
  "font_family": "Calibri"
}
```

Empty text is not measured. In that case the solver falls back to each zone's `preferred_h` from the blueprint.

### Output Schema

The engine returns one serialized `LayoutSpec` per slide. Important fields include:

| Field | Meaning |
|-------|---------|
| `title_rect`, `key_message_rect`, `accent_rect`, `icon_rect`, `content_rect`, `notes_rect` | Absolute top-level zones |
| `hero_rect`, `chips_rect`, `footer_rect`, `sidebar_rect` | Optional sub-zones for specific layouts |
| `summary_box`, `cards`, `stats`, `timeline`, `comparison` | Variant-specific geometry objects |
| `max_items` | Maximum recommended item count for the layout |
| `row_step` | Agenda/timeline stepping aid for sequential placement |

The serialized specs are injected into the Python runner through the `PPTX_LAYOUT_SPECS_JSON` environment variable. `hybrid_layout.py` also exposes `serialize_specs()` / `deserialize_specs()` so the runner can round-trip them without re-solving.

---

## Validation Pipeline Integration

```
Generated python-pptx code
        │
        ▼
  Write PPTX file
        │
        ▼
  validate_presentation(prs)
        │
        ├── No issues → ✅ Success
        │
        └── Issues found
              │
              ├── INFO/WARNING → ⚠️ Report (non-blocking)
              │
              └── ERROR → ❌ Report to agent
                    │
                    ▼
              Agent uses patch_layout_infrastructure
              to fix layout_specs.py or layout_validator.py
                    │
                    ▼
              rerun_pptx (re-execute same code)
                    │
                    ▼
              Re-validate → repeat if needed
```

The validator runs automatically after every PPTX generation. ERROR-level issues trigger agent self-correction via the `patch_layout_infrastructure` and `rerun_pptx` tools — the agent reads the infrastructure file, makes a targeted fix, and re-runs the same code without regenerating it from scratch.

---

## Runtime Namespace Integration

The final generated Python code does not talk to the layout engine directly. Instead, `pptx-python-runner.py` builds a controlled execution namespace and injects the geometry + helpers the agent code needs.

### Geometry Objects Injected at Runtime

| Symbol | Purpose |
|--------|---------|
| `PRECOMPUTED_LAYOUT_SPECS` | Preferred list of measured `LayoutSpec` objects from the hybrid engine |
| `get_layout_spec()` | Fallback static spec generator |
| `flow_layout_spec()` | Legacy dynamic flow helper for title/key-message cascading |
| `LayoutSpec`, `RectSpec`, `CardsSpec`, `StatsSpec`, `TimelineSpec`, `ComparisonSpec` | Dataclasses used by generated code |

### Content / Asset Helpers Injected at Runtime

| Helper | Purpose |
|--------|---------|
| `safe_add_picture()` | Adds images safely, preserving aspect ratio and handling icon scaling |
| `safe_image_path()` | Validates and normalizes image paths |
| `fetch_icon()` | Loads an icon from the local icon cache |
| `resolve_font()` | Selects `Calibri` for Latin or the appropriate Noto Sans family for non-Latin text |
| `ensure_noto_fonts()` | Downloads and installs missing Noto fonts on demand |
| `estimate_text_height_in()` | Fallback text height heuristic used by generated code and validator |
| `contrast_ratio()` / `ensure_contrast()` | Contrast helpers for choosing readable text colors on filled panels |

### Execution Rule

Generated code should prefer:

```python
if PRECOMPUTED_LAYOUT_SPECS is not None:
  spec = PRECOMPUTED_LAYOUT_SPECS[i]
else:
  base_spec = get_layout_spec(layout_type, has_icon=bool(slide_icon))
  spec = flow_layout_spec(
    base_spec,
    title_text=slide_title,
    key_message_text=slide_key_message,
  )
```

This ensures the measured, solver-backed geometry is used whenever available, while preserving a safe fallback path if precomputation fails.

### Text Frame Rule

The runtime contract distinguishes between two classes of text containers:

- **Free textboxes** (`title`, `key_message`, `notes`) should use `MSO_AUTO_SIZE.NONE` because their height is already computed by the layout system.
- **Panel/card shapes** should use `MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE` because their geometry is fixed and PowerPoint may need to shrink text.

That distinction is also enforced by the validator's auto-correction pass, which only turns on `TEXT_TO_FIT_SHAPE` for non-textbox shapes.

---

## Auto-Correction Policy

The post-generation validator is intentionally conservative. It does **not** try to redesign the slide after the fact.

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

COM measurement is performed with the slide's declared `font_family` (currently `Calibri` for layout input). Runtime rendering may later substitute Noto Sans through `resolve_font()` for non-Latin scripts. In practice this is close enough, but it can introduce small residual differences in line breaks.

### 3. Post-Generation Validation Is Geometric, Not Semantic

The validator knows whether two boxes overlap. It does not know whether the slide is visually elegant, whether the headline hierarchy is strong enough, or whether a chart is too small to be readable.

### 4. Decorative Heuristics Are Best-Effort

Shapes are excluded from collision checks based on heuristics such as shape type, fill style, and name prefixes (`Oval*`, `bg_blob*`). If generated code creates decorative shapes with unexpected names or properties, the validator may classify them as real collisions.

### 5. Auto-Size Is a Safety Net, Not the Primary Layout Strategy

`TEXT_TO_FIT_SHAPE` can save a deck from catastrophic overflow, but it may reduce fonts to unreadable sizes. The preferred strategy remains: measure first, solve geometry second, render third.

### 6. Static Fallback Specs Are Legacy Templates

`get_layout_spec()` and `flow_layout_spec()` remain important fallback tools, but they are still hand-authored templates. They intentionally share the same `LayoutSpec` contract as the hybrid engine, yet some coordinates remain historical approximations rather than exact matches for the blueprint-solved path. For production-quality placement, `PRECOMPUTED_LAYOUT_SPECS` should win whenever it is present.

---

## Practical Guidance for Generated Code

The engine works best when generated code follows a small set of strict rules:

1. Use `PRECOMPUTED_LAYOUT_SPECS[i]` whenever available.
2. Never invent raw `x`, `y`, `w`, `h` coordinates for major elements.
3. Place all content relative to `spec.title_rect`, `spec.content_rect`, `spec.cards`, `spec.timeline`, etc.
4. For title/key-message/notes textboxes, keep `MSO_AUTO_SIZE.NONE`; for fixed panels, use `TEXT_TO_FIT_SHAPE`.
5. When a slide has many images, create a real multi-image composition instead of reusing one image placeholder.
6. Treat title, key message, notes, and footer as reserved structural zones — do not place content into them opportunistically.
7. If validation reports ERROR-level issues, patch the infrastructure or regenerate; do not keep stacking more shapes into the same space.

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
