"""Content-adaptive layout orchestrator.

Combines Pillow-based text measurement with constraint solving to
produce precise ``LayoutSpec`` objects for each slide in a deck.

Pipeline
--------
1. Load blueprints for each slide's layout type
2. Collect all text zones that need measurement
3. Batch-measure all text heights via Pillow font metrics
4. For each slide: solve constraints (blueprint + measurements + content)
5. Return ``list[LayoutSpec]``

CLI usage::

    python hybrid_layout.py --input slides.json --output specs.json

JSON schema for ``--input`` (array of slide content objects)::

    [
      {
        "layout_type": "bullets",
        "title_text": "Quarterly Results",
        "key_message_text": "Revenue grew 15% YoY",
        "bullets": ["Item 1", "Item 2"],
        "notes": "",
        "item_count": 2,
        "has_icon": true,
        "font_family": "Calibri"
      }
    ]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from scripts.layout.layout_blueprint import LayoutBlueprint, ZoneRole, get_blueprint
    from scripts.layout.layout_specs import (
        CardsSpec,
        ComparisonSpec,
        LayoutSpec,
        RectSpec,
        SLIDE_WIDTH_IN,
        SolveQuality,
        StatsSpec,
        TimelineSpec,
        estimate_text_height_in,
        _rounded_corner_margin_insets,
    )
else:
    from .layout_blueprint import LayoutBlueprint, ZoneRole, get_blueprint
    from .layout_specs import (
        CardsSpec,
        ComparisonSpec,
        LayoutSpec,
        RectSpec,
        SLIDE_WIDTH_IN,
        SolveQuality,
        StatsSpec,
        TimelineSpec,
        estimate_text_height_in,
        _rounded_corner_margin_insets,
    )

if TYPE_CHECKING:
    if __package__ in {None, ''}:
        from scripts.layout.font_text_measure import TextMeasureRequest
    else:
        from .font_text_measure import TextMeasureRequest


# ---------------------------------------------------------------------------
# Input data type
# ---------------------------------------------------------------------------

@dataclass
class SlideContent:
    """Content metadata for a single slide — drives measurement + solver."""
    layout_type: str
    title_text: str = ''
    key_message_text: str = ''
    bullets: list[str] | None = None
    chip_labels: list[str] | None = None
    footer_text: str = ''
    notes: str = ''
    item_count: int = 0
    has_icon: bool = False
    has_hero_image: bool = False
    font_family: str = 'Calibri'

    @staticmethod
    def from_dict(d: dict) -> 'SlideContent':
        return SlideContent(
            layout_type=d.get('layout_type', 'bullets'),
            title_text=d.get('title_text', ''),
            key_message_text=d.get('key_message_text', ''),
            bullets=d.get('bullets'),
            chip_labels=d.get('chip_labels'),
            footer_text=d.get('footer_text', ''),
            notes=d.get('notes', ''),
            item_count=d.get('item_count', 0),
            has_icon=d.get('has_icon', False),
            has_hero_image=d.get('has_hero_image', False),
            font_family=d.get('font_family', 'Calibri'),
        )


# ---------------------------------------------------------------------------
# Measurement helpers
# ---------------------------------------------------------------------------

def _zone_text(slide: SlideContent, role: ZoneRole) -> str:
    """Return the text content for a zone role."""
    if role == ZoneRole.TITLE:
        return slide.title_text
    if role == ZoneRole.KEY_MESSAGE:
        return slide.key_message_text
    if role == ZoneRole.CHIPS:
        chip_labels = [label.strip() for label in (slide.chip_labels or []) if label.strip()]
        return '\n'.join(chip_labels)
    if role == ZoneRole.FOOTER:
        return slide.footer_text
    if role == ZoneRole.CONTENT:
        if slide.layout_type == 'table':
            return ''
        bullets = slide.bullets or []
        return '\n'.join(bullets) if bullets else ''
    if role == ZoneRole.NOTES:
        return slide.notes
    return ''


def _zone_needs_measurement(role: ZoneRole) -> bool:
    """Only text-bearing zones need measurement."""
    return role in (ZoneRole.TITLE, ZoneRole.KEY_MESSAGE, ZoneRole.CONTENT, ZoneRole.CHIPS, ZoneRole.FOOTER, ZoneRole.NOTES)


def _columnar_height_reserve(blueprint: LayoutBlueprint) -> float:
    """Extra per-item height reserve for panel chrome.

    Columnar layouts render text inside decorated panels with internal margins,
    icon badges, or header bands. Pure text measurement underestimates the final
    box height unless we reserve some space for those non-text elements.
    """
    if blueprint.cards:
        pattern = (blueprint.cards.pattern or '').strip().lower()
        if pattern == 'icon_card':
            return round(max(blueprint.cards.icon_size or 0.46, 0.34) + 0.24, 2)
        if pattern == 'header_icon_card':
            return round(max(blueprint.cards.header_band_h or 0.34, 0.28) + 0.12, 2)
        return 0.22
    if blueprint.stats:
        return 0.28
    if blueprint.comparison:
        return 0.24
    return 0.0


def _effective_blueprint(blueprint: LayoutBlueprint, slide: SlideContent) -> LayoutBlueprint:
    """Drop optional decorative zones when the slide has no matching content.

    Only the *title* layout has purely decorative CHIPS / FOOTER zones that
    should be omitted when no chip labels or footer text were supplied.
    Other layouts (stats, chart, quote, closing …) keep their FOOTER zone
    unconditionally because generated code fills it with data citations at
    runtime.
    """
    if blueprint.layout_type == 'title':
        include_chips = any(label.strip() for label in (slide.chip_labels or []))
        include_footer = bool(slide.footer_text.strip())

        zones = tuple(
            zone
            for zone in blueprint.zones
            if not (
                (zone.role == ZoneRole.CHIPS and not include_chips)
                or (zone.role == ZoneRole.FOOTER and not include_footer)
            )
        )
    else:
        zones = blueprint.zones

    has_hero = blueprint.has_hero and slide.has_hero_image

    if zones == blueprint.zones and has_hero == blueprint.has_hero:
        return blueprint

    return replace(blueprint, zones=zones, has_hero=has_hero)


def _zone_width(
    blueprint: LayoutBlueprint,
    zone,
    role: ZoneRole,
    has_icon: bool,
) -> float:
    """Compute the available width (inches) for a zone."""
    tokens = blueprint.tokens
    avail_w = SLIDE_WIDTH_IN - 2 * tokens.margin_x
    header_w = avail_w
    if has_icon and blueprint.icon_size > 0:
        header_w -= blueprint.icon_size + tokens.icon_corner_margin_x
    if zone.width_fraction < 1.0:
        w = avail_w * zone.width_fraction
    elif role in (ZoneRole.TITLE, ZoneRole.KEY_MESSAGE):
        w = header_w * tokens.header_w_ratio
    else:
        w = avail_w
    return round(w, 2)


def _column_width(blueprint: LayoutBlueprint, content_w: float) -> float | None:
    """Return per-item text width for columnar/sequential layouts.

    Returns None for non-columnar layouts.
    """
    import math as _math
    if blueprint.cards:
        v = blueprint.cards
        return _math.floor(((content_w - (v.columns - 1) * v.gap_x) / v.columns) * 100) / 100
    if blueprint.stats:
        v = blueprint.stats
        return _math.floor(((content_w - (v.columns - 1) * v.gap_x) / v.columns) * 100) / 100
    if blueprint.comparison:
        return _math.floor(((content_w - blueprint.comparison.gap_x) / 2) * 100) / 100
    if blueprint.timeline:
        # Timeline text starts at text_x; content zone starts at margin_x
        margin_x = blueprint.tokens.margin_x
        return round(content_w - (blueprint.timeline.text_x - margin_x), 2)
    return None


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def _get_measure_backend() -> tuple[type, callable]:
    """Select the active text-measurement backend.

    Returns ``(TextMeasureRequest_class, measure_text_heights_func)``.

    The layout engine always uses Pillow font metrics when available and
    falls back to the shared heuristic only if Pillow cannot be imported.
    """
    try:
        if __package__ in {None, ''}:
            from scripts.layout.font_text_measure import TextMeasureRequest, measure_text_heights
        else:
            from .font_text_measure import TextMeasureRequest, measure_text_heights
        return TextMeasureRequest, measure_text_heights
    except ImportError:
        pass

    # Heuristic fallback — synthesise a compatible measure function
    if __package__ in {None, ''}:
        from scripts.layout.font_text_measure import TextMeasureRequest
    else:
        from .font_text_measure import TextMeasureRequest

    def _heuristic_measure(requests: list) -> list[float]:
        return [
            estimate_text_height_in(
                r.text, r.width_in, r.font_size_pt,
            )
            for r in requests
        ]

    return TextMeasureRequest, _heuristic_measure


def compute_adaptive_specs(
    slides: list[SlideContent],
    *,
    corner_style: str = "square",
) -> list[LayoutSpec]:
    """Compute content-adaptive layout specs for all slides.

    Uses Pillow font metrics with heuristic fallback when Pillow is unavailable.
    When *corner_style* is ``"rounded"``, measurement widths are narrowed and
    chip heights expanded to account for rounded-corner margin insets.
    Returns a list of ``LayoutSpec`` in the same order as *slides*.
    """
    TextMeasureRequest, measure_text_heights = _get_measure_backend()
    from constraint_solver import solve_layout

    # Step 1: Load blueprints
    blueprints = [_effective_blueprint(get_blueprint(s.layout_type), s) for s in slides]

    # Step 2: Collect measurement requests
    # Each entry: (slide_index, zone_role_value, TextMeasureRequest)
    measure_queue: list[tuple[int, str, TextMeasureRequest]] = []
    # Per-item measurement for columnar layouts (cards, stats, comparison)
    # Each entry: (slide_index, TextMeasureRequest)
    item_measure_queue: list[tuple[int, TextMeasureRequest]] = []
    # Per-chip measurement for title slides. Each entry: (slide_index, TextMeasureRequest)
    chip_measure_queue: list[tuple[int, TextMeasureRequest]] = []
    # Track which slides have columnar per-item measurements
    columnar_slides: set[int] = set()

    for i, (slide, bp) in enumerate(zip(slides, blueprints)):
        # Compute full content width (needed for column width calc)
        full_content_w = _zone_width(
            bp,
            next((zone for zone in bp.zones if zone.role == ZoneRole.CONTENT), bp.zones[0]),
            ZoneRole.CONTENT,
            slide.has_icon,
        )
        col_w = _column_width(bp, full_content_w)

        for zd in bp.zones:
            if not _zone_needs_measurement(zd.role):
                continue
            if zd.role == ZoneRole.CHIPS:
                visible_chips = [label.strip() for label in (slide.chip_labels or []) if label.strip()][:3]
                if not visible_chips:
                    continue
                total_w = _zone_width(bp, zd, zd.role, slide.has_icon)
                chip_gap = min(total_w * 0.025, 0.18)
                chip_w = (total_w - chip_gap * (len(visible_chips) - 1)) / len(visible_chips)
                # Estimate chip height for rounded-corner inset calculation
                cx, _ = _rounded_corner_margin_insets(zd.preferred_h, corner_style)
                chip_h_margin = 0.16 + 2 * cx  # base 0.08 per side + corner inset
                for chip_text in visible_chips:
                    chip_measure_queue.append((
                        i,
                        TextMeasureRequest(
                            text=chip_text,
                            width_in=max(round(chip_w - chip_h_margin, 2), 0.5),
                            font_family=slide.font_family,
                            font_size_pt=11.2,
                            bold=False,
                        ),
                    ))
                continue
            # For columnar layouts, measure each bullet at per-column width
            # instead of measuring all text at full content width
            if zd.role == ZoneRole.CONTENT and col_w is not None:
                bullets = slide.bullets or []
                if bullets:
                    columnar_slides.add(i)
                    for bullet_text in bullets:
                        if not bullet_text.strip():
                            continue
                        item_measure_queue.append((
                            i,
                            TextMeasureRequest(
                                text=bullet_text,
                                width_in=col_w,
                                font_family=slide.font_family,
                                font_size_pt=zd.font_pt,
                                bold=zd.bold,
                            ),
                        ))
                continue  # skip normal CONTENT measurement for columnar layouts

            text = _zone_text(slide, zd.role)
            if not text.strip():
                continue  # empty text → use preferred_h
            width = _zone_width(bp, zd, zd.role, slide.has_icon)
            measure_queue.append((
                i,
                zd.role.value,
                TextMeasureRequest(
                    text=text,
                    width_in=width,
                    font_family=slide.font_family,
                    font_size_pt=zd.font_pt,
                    bold=zd.bold,
                ),
            ))

    # Step 3: Batch text measurement
    all_requests: list[TextMeasureRequest] = []
    all_requests.extend(req for _, _, req in measure_queue)
    all_requests.extend(req for _, req in item_measure_queue)
    all_requests.extend(req for _, req in chip_measure_queue)

    if all_requests:
        all_heights = measure_text_heights(all_requests)
    else:
        all_heights = []

    # Split heights back into zone measurements and per-item measurements
    zone_count = len(measure_queue)
    zone_heights = all_heights[:zone_count]
    item_count = len(item_measure_queue)
    item_heights = all_heights[zone_count:zone_count + item_count]
    chip_heights = all_heights[zone_count + item_count:]

    # Step 4: Group measurements by slide index
    slide_measurements: list[dict[str, float]] = [{} for _ in slides]
    for (si, role_val, _), h in zip(measure_queue, zone_heights):
        slide_measurements[si][role_val] = h

    # Group per-item heights by slide → max per-card measured height
    per_item_max_h: dict[int, float] = {}
    item_idx = 0
    for si, _ in item_measure_queue:
        h = item_heights[item_idx]
        item_idx += 1
        if si not in per_item_max_h:
            per_item_max_h[si] = h
        else:
            per_item_max_h[si] = max(per_item_max_h[si], h)

    chip_max_h: dict[int, float] = {}
    chip_idx = 0
    # Estimate rounded-corner vertical inset for chips
    _, chip_cy = _rounded_corner_margin_insets(0.65, corner_style)  # typical chip height
    chip_vert_pad = 0.10 + 2 * chip_cy  # base top/bottom + corner insets
    for si, _ in chip_measure_queue:
        h = chip_heights[chip_idx]
        chip_idx += 1
        chip_total_h = round(h + chip_vert_pad, 4)
        if si not in chip_max_h:
            chip_max_h[si] = chip_total_h
        else:
            chip_max_h[si] = max(chip_max_h[si], chip_total_h)

    # Step 5: Solve constraints for each slide
    specs: list[LayoutSpec] = []
    for i, (slide, bp) in enumerate(zip(slides, blueprints)):
        mh = slide_measurements[i]
        if i in chip_max_h:
            mh = {**mh, ZoneRole.CHIPS.value: chip_max_h[i]}
        item_count = slide.item_count
        if item_count == 0 and slide.bullets:
            item_count = len(slide.bullets)
        card_measured_h = per_item_max_h.get(i)
        if card_measured_h is not None:
            card_measured_h = round(card_measured_h + _columnar_height_reserve(bp), 4)
        spec = solve_layout(
            bp, mh,
            has_icon=slide.has_icon,
            item_count=item_count,
            card_measured_h=card_measured_h,
        )
        specs.append(spec)

    return specs


# ---------------------------------------------------------------------------
# JSON serialization
# ---------------------------------------------------------------------------

def _rect_to_dict(r) -> dict | None:
    """Serialize a RectSpec to dict."""
    if r is None:
        return None
    return {'x': r.x, 'y': r.y, 'w': r.w, 'h': r.h}


def _cards_to_dict(c) -> dict | None:
    if c is None:
        return None
    return {
        'columns': c.columns, 'card_w': c.card_w, 'card_h': c.card_h,
        'start_x': c.start_x, 'start_y': c.start_y,
        'gap_x': c.gap_x, 'gap_y': c.gap_y,
        'pattern': c.pattern,
        'icon_size': c.icon_size,
        'header_band_h': c.header_band_h,
        'header_icon_count': c.header_icon_count,
    }


def _stats_to_dict(s) -> dict | None:
    if s is None:
        return None
    return {
        'start_x': s.start_x, 'start_y': s.start_y,
        'box_w': s.box_w, 'box_h': s.box_h, 'gap_x': s.gap_x,
    }


def _timeline_to_dict(t) -> dict | None:
    if t is None:
        return None
    return {
        'line_x': t.line_x, 'line_y': t.line_y, 'line_h': t.line_h,
        'dot_x': t.dot_x, 'dot_size': t.dot_size,
        'start_y': t.start_y, 'step_y': t.step_y,
        'text_x': t.text_x, 'text_w': t.text_w,
    }


def _comparison_to_dict(c) -> dict | None:
    if c is None:
        return None
    return {
        'left': _rect_to_dict(c.left),
        'right': _rect_to_dict(c.right),
    }


def _quality_to_dict(q) -> dict | None:
    if q is None:
        return None
    return {
        'compressed_zones': list(q.compressed_zones),
        'max_compression_ratio': q.max_compression_ratio,
        'is_overcrowded': q.is_overcrowded,
        'relaxation_pass': q.relaxation_pass,
    }


def layout_spec_to_dict(spec: LayoutSpec) -> dict:
    """Serialize a LayoutSpec to a JSON-safe dict."""
    d = {
        'layout_type': spec.layout_type,
        'title_rect': _rect_to_dict(spec.title_rect),
        'key_message_rect': _rect_to_dict(spec.key_message_rect),
        'accent_rect': _rect_to_dict(spec.accent_rect),
        'icon_rect': _rect_to_dict(spec.icon_rect),
        'content_rect': _rect_to_dict(spec.content_rect),
        'notes_rect': _rect_to_dict(spec.notes_rect),
        'summary_box': _rect_to_dict(spec.summary_box),
        'hero_rect': _rect_to_dict(spec.hero_rect),
        'chips_rect': _rect_to_dict(spec.chips_rect),
        'footer_rect': _rect_to_dict(spec.footer_rect),
        'sidebar_rect': _rect_to_dict(spec.sidebar_rect),
        'max_items': spec.max_items,
        'row_step': spec.row_step,
        'cards': _cards_to_dict(spec.cards),
        'stats': _stats_to_dict(spec.stats),
        'timeline': _timeline_to_dict(spec.timeline),
        'comparison': _comparison_to_dict(spec.comparison),
    }
    # solve_quality is diagnostic metadata — only include when present
    q = _quality_to_dict(spec.solve_quality)
    if q is not None:
        d['solve_quality'] = q
    return d


def layout_spec_from_dict(d: dict) -> LayoutSpec:
    """Deserialize a LayoutSpec from a dict."""
    def _r(v: dict | None) -> 'RectSpec | None':
        return RectSpec(**v) if v else None

    # Deserialize solve_quality if present
    sq = None
    if d.get('solve_quality'):
        sqd = d['solve_quality']
        sq = SolveQuality(
            compressed_zones=tuple(sqd.get('compressed_zones', ())),
            max_compression_ratio=sqd.get('max_compression_ratio', 0.0),
            is_overcrowded=sqd.get('is_overcrowded', False),
            relaxation_pass=sqd.get('relaxation_pass', False),
        )

    cards = None
    if d.get('cards'):
        cards_payload = {
            'pattern': 'standard',
            'icon_size': 0.0,
            'header_band_h': 0.0,
            'header_icon_count': 0,
            **d['cards'],
        }
        cards = CardsSpec(**cards_payload)
    stats = None
    if d.get('stats'):
        stats = StatsSpec(**d['stats'])
    timeline = None
    if d.get('timeline'):
        timeline = TimelineSpec(**d['timeline'])
    comparison = None
    if d.get('comparison'):
        comparison = ComparisonSpec(
            left=RectSpec(**d['comparison']['left']),
            right=RectSpec(**d['comparison']['right']),
        )

    return LayoutSpec(
        layout_type=d['layout_type'],
        title_rect=_r(d.get('title_rect')),
        key_message_rect=_r(d.get('key_message_rect')),
        accent_rect=_r(d.get('accent_rect')),
        icon_rect=_r(d.get('icon_rect')),
        content_rect=_r(d.get('content_rect')),
        notes_rect=_r(d.get('notes_rect')),
        summary_box=_r(d.get('summary_box')),
        hero_rect=_r(d.get('hero_rect')),
        chips_rect=_r(d.get('chips_rect')),
        footer_rect=_r(d.get('footer_rect')),
        sidebar_rect=_r(d.get('sidebar_rect')),
        max_items=d.get('max_items', 0),
        row_step=d.get('row_step'),
        cards=cards,
        stats=stats,
        timeline=timeline,
        comparison=comparison,
        solve_quality=sq,
    )


def serialize_specs(specs: list[LayoutSpec]) -> str:
    """Serialize a list of LayoutSpecs to JSON string."""
    return json.dumps([layout_spec_to_dict(s) for s in specs], indent=2)


def deserialize_specs(json_str: str) -> list[LayoutSpec]:
    """Deserialize a list of LayoutSpecs from JSON string."""
    return [layout_spec_from_dict(d) for d in json.loads(json_str)]


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description='Compute content-adaptive layout specs via COM + constraint solver.',
    )
    p.add_argument('--input', required=True, help='Path to slides JSON input file')
    p.add_argument('--output', required=True, help='Path to write specs JSON output')
    return p.parse_args()


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

    import os
    corner_style = (os.environ.get('PPTX_TEXT_BOX_CORNER_STYLE', 'square') or 'square').strip().lower()

    args = _parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    if not input_path.exists():
        print(f'Input file not found: {input_path}', file=sys.stderr)
        return 1

    slides_data = json.loads(input_path.read_text(encoding='utf-8'))
    slides = [SlideContent.from_dict(d) for d in slides_data]

    # print(f'[hybrid-layout] Computing specs for {len(slides)} slide(s)…', file=sys.stderr)

    specs = compute_adaptive_specs(slides, corner_style=corner_style)
    output_json = serialize_specs(specs)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output_json, encoding='utf-8')
    # Also emit to stdout for IPC consumption
    print(output_json)

    # print(f'[hybrid-layout] Wrote {len(specs)} spec(s) to {output_path}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
