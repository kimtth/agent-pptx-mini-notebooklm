"""Layout specifications for python-pptx slide generation.

Ported from src/domain/layout/slide-layout-spec.ts.
Provides LayoutSpec / RectSpec dataclasses and the flow_layout_spec() cascade
helper used by the constraint solver and hybrid layout engine.

Production code must use PRECOMPUTED_LAYOUT_SPECS from the hybrid layout
engine (hybrid_layout.py → constraint_solver.py).

Runtime usage:

    spec = PRECOMPUTED_LAYOUT_SPECS[slide_index]
    title = spec.title_rect          # RectSpec(x, y, w, h)
    cards = spec.cards               # CardsSpec(columns, card_w, pattern, ...)
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import math

SLIDE_WIDTH_IN = 13.333
SLIDE_HEIGHT_IN = 7.5
CONTENT_LEFT_IN = 0.5
CONTENT_RIGHT_IN = 0.5
CONTENT_WIDTH_IN = SLIDE_WIDTH_IN - CONTENT_LEFT_IN - CONTENT_RIGHT_IN
SAFE_MARGIN_IN = 0.3
HEADER_WIDTH_RATIO = 0.95
ICON_CORNER_MARGIN_X = 0.5
ICON_CORNER_MARGIN_Y = 0.45


@dataclass(frozen=True)
class RectSpec:
    x: float
    y: float
    w: float
    h: float

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h


@dataclass(frozen=True)
class CardsSpec:
    columns: int
    card_w: float
    card_h: float
    start_x: float
    start_y: float
    gap_x: float
    gap_y: float
    pattern: str = 'standard'
    icon_size: float = 0.0
    header_band_h: float = 0.0
    header_icon_count: int = 0

    def card_rect(self, index: int) -> RectSpec:
        col = index % self.columns
        row = index // self.columns
        return RectSpec(
            x=self.start_x + col * (self.card_w + self.gap_x),
            y=self.start_y + row * (self.card_h + self.gap_y),
            w=self.card_w,
            h=self.card_h,
        )


@dataclass(frozen=True)
class StatsSpec:
    start_x: float
    start_y: float
    box_w: float
    box_h: float
    gap_x: float

    def box_rect(self, index: int) -> RectSpec:
        return RectSpec(
            x=self.start_x + index * (self.box_w + self.gap_x),
            y=self.start_y,
            w=self.box_w,
            h=self.box_h,
        )


@dataclass(frozen=True)
class TimelineSpec:
    line_x: float
    line_y: float
    line_h: float
    dot_x: float
    dot_size: float
    start_y: float
    step_y: float
    text_x: float
    text_w: float

    def node_rect(self, index: int) -> RectSpec:
        return RectSpec(
            x=self.text_x,
            y=self.start_y + index * self.step_y,
            w=self.text_w,
            h=self.step_y * 0.85,
        )


@dataclass(frozen=True)
class ComparisonSpec:
    left: RectSpec
    right: RectSpec


@dataclass(frozen=True)
class SolveQuality:
    """Post-solve quality metrics from the constraint solver.

    Inspired by matplotlib's ``check_no_collapsed_axes`` pattern: after the
    solver runs, detect zones that were forcibly compressed below their
    measured / preferred heights and surface that information so callers
    can adapt (reduce font sizes, trim items, or warn the user).
    """
    compressed_zones: tuple[str, ...] = ()
    """Zone role values that were compressed below their target height."""

    max_compression_ratio: float = 0.0
    """Worst-case compression ratio across all zones.

    0.0 = no compression at all.
    1.0 = some zone was squeezed all the way down to its ``min_h``.
    """

    is_overcrowded: bool = False
    """True when any zone was forcibly compressed."""

    relaxation_pass: bool = False
    """True when the solver ran a second relaxation pass to recover space."""


@dataclass(frozen=True)
class LayoutSpec:
    layout_type: str
    title_rect: RectSpec | None = None
    key_message_rect: RectSpec | None = None
    accent_rect: RectSpec | None = None
    icon_rect: RectSpec | None = None
    content_rect: RectSpec | None = None
    notes_rect: RectSpec | None = None
    summary_box: RectSpec | None = None
    hero_rect: RectSpec | None = None
    chips_rect: RectSpec | None = None
    footer_rect: RectSpec | None = None
    sidebar_rect: RectSpec | None = None
    max_items: int = 0
    row_step: float | None = None
    cards: CardsSpec | None = None
    stats: StatsSpec | None = None
    timeline: TimelineSpec | None = None
    comparison: ComparisonSpec | None = None
    solve_quality: SolveQuality | None = None


def _is_wide_char(cp: int) -> bool:
    """Return True for CJK, Kana, Hangul, and fullwidth characters."""
    return (
        (0x2E80 <= cp <= 0x9FFF) or   # CJK radicals, Kangxi, Kana, CJK unified
        (0xAC00 <= cp <= 0xD7AF) or   # Hangul syllables
        (0xF900 <= cp <= 0xFAFF) or   # CJK compatibility ideographs
        (0xFE30 <= cp <= 0xFE4F) or   # CJK compatibility forms
        (0xFF01 <= cp <= 0xFF60) or   # Fullwidth ASCII variants
        (0x20000 <= cp <= 0x2FA1F)    # CJK extensions B-F
    )


def estimate_text_height_in(
    text: str,
    width_in: float,
    font_size_pt: float,
    *,
    line_height: float = 1.22,
    min_lines: int = 1,
) -> float:
    """Estimate text height in inches for wrapped text.

    Uses per-character visual width to handle mixed Latin/CJK text accurately.
    CJK characters are treated as full-width (1 em), Latin as ~0.52 em.

    Notes:
    - ``em`` is a typography-relative unit based on the current font size.
      In this estimator, ``1 em`` is treated as the font size itself.
    - ``width_in`` and the return value are in inches. ``1 inch = 2.54 cm``.
    """
    paragraphs = [part.strip() for part in text.splitlines() if part.strip()]
    if not paragraphs:
        lines = min_lines
    else:
        em_size = font_size_pt / 72.0  # 1 em = current font size; 1 em ≈ font_size_pt × 0.03528 cm
        em_per_line = max(width_in / em_size, 3.0)
        lines = 0
        for paragraph in paragraphs:
            if not paragraph:
                lines += 1
                continue
            # Weighted visual width: CJK ≈ 1 em, Latin ≈ 0.52 em.
            # Here, 1 em means roughly one full font-size unit of horizontal space.
            visual_w = sum(
                1.0 if _is_wide_char(ord(ch)) else 0.52
                for ch in paragraph
            )
            lines += max(math.ceil(visual_w / em_per_line), 1)
        lines = max(lines, min_lines)

    base_height = lines * (font_size_pt / 72.0) * line_height
    # Add a safety cushion for paragraph spacing and large display text.
    cushion = 0.06 + (0.02 * max(lines - 1, 0))
    if font_size_pt >= 24:
        cushion += 0.08
    return base_height + cushion


def _cascade_subzone(rect: RectSpec | None, content_y: float, content_bottom: float) -> RectSpec | None:
    """Reposition a sub-zone (hero, sidebar) so its top aligns with the content zone.

    The original height from the constraint solver is preserved as a minimum so
    that large hero / sidebar zones are not clipped by a small content_bottom.
    """
    if rect is None:
        return None
    h = max(content_bottom - content_y, rect.h, 0.8)
    # Don't extend past slide bottom (leave 0.3" margin)
    max_h = SLIDE_HEIGHT_IN - 0.3 - content_y
    return replace(rect, y=content_y, h=max(min(h, max_h), 0.8))


def _rounded_corner_margin_insets(
    shape_h_in: float,
    corner_style: str = "square",
) -> tuple[float, float]:
    """Return (extra_x, extra_y) margin insets for rounded-rectangle shapes.

    This mirrors the renderer's ``_rounded_panel_text_inset`` formula so the
    layout engine reserves the same usable-text reduction that the renderer
    applies at draw time.  For square corners the insets are zero.
    """
    if corner_style != "rounded":
        return 0.0, 0.0
    extra_x = min(max(shape_h_in * 0.10, 0.03), 0.08)
    extra_y = min(max(shape_h_in * 0.05, 0.02), 0.05)
    return extra_x, extra_y


def _compute_chip_height(
    chips: RectSpec | None,
    *,
    chip_texts: list[str] | None = None,
    chip_font_pt: float = 11.0,
    chip_count: int | None = None,
    corner_style: str = "square",
) -> float:
    """Return the rendered chip band height, expanding for wrapped chip text."""
    if chips is None:
        return 0.0

    new_h = chips.h
    if chip_texts:
        count = chip_count or len(chip_texts)
        gap = chips.w * 0.02
        chip_w = (chips.w - gap * max(count - 1, 0)) / max(count, 1)
        cx, cy = _rounded_corner_margin_insets(chips.h, corner_style)
        # left+right base margin (0.08+0.08) plus rounded-corner insets
        usable_w = chip_w - 0.16 - 2 * cx
        max_needed = 0.0
        for text in chip_texts:
            needed = estimate_text_height_in(
                text, max(usable_w, 0.3), chip_font_pt, line_height=1.12,
            )
            if needed > max_needed:
                max_needed = needed
        # top+bottom base margin (0.04+0.04) plus rounded insets + cushion
        vert_margin = 0.10 + 2 * cy
        new_h = max(chips.h, max_needed + vert_margin)

    return new_h


def _cascade_chips(
    chips: RectSpec | None,
    content_rect: RectSpec | None,
    content_bottom: float,
    *,
    chip_texts: list[str] | None = None,
    chip_font_pt: float = 11.0,
    chip_count: int | None = None,
    fallback_y: float | None = None,
    corner_style: str = "square",
) -> RectSpec | None:
    """Place chips rect below content or at a fraction of content bottom.

    When *chip_texts* is provided the chip height is expanded so the tallest
    chip can display its text without clipping.
    """
    if chips is None:
        return None
    if content_rect is not None:
        target_y = content_rect.y + content_rect.h + 0.12
    elif fallback_y is not None:
        target_y = fallback_y
    else:
        target_y = content_bottom - 1.2

    new_h = _compute_chip_height(
        chips,
        chip_texts=chip_texts,
        chip_font_pt=chip_font_pt,
        chip_count=chip_count,
        corner_style=corner_style,
    )

    max_y = max(content_bottom - new_h, 0.0)
    return replace(chips, y=min(target_y, max_y), h=new_h)


def _cascade_footer(
    footer: RectSpec | None,
    content_rect: RectSpec | None,
    chips: RectSpec | None,
    content_bottom: float,
) -> RectSpec | None:
    """Place footer below chips (if present) or below content."""
    if footer is None:
        return None
    if chips is not None:
        target_y = chips.y + chips.h + 0.12
    elif content_rect is not None:
        target_y = content_rect.y + content_rect.h + 0.12
    else:
        target_y = content_bottom - 0.8
    y = min(target_y, content_bottom - 0.1)
    # Shrink height so footer never extends past content_bottom
    h = min(footer.h, max(content_bottom - y, 0.3))
    return replace(footer, y=y, h=h)


def _header_rect(x: float, y: float, w: float, h: float, ratio: float = HEADER_WIDTH_RATIO) -> RectSpec:
    """Return a centered header rect that uses 80-90% of the parent width."""
    header_w = round(w * ratio, 2)
    header_x = round(x + (w - header_w) / 2, 2)
    return RectSpec(header_x, y, header_w, h)


def _icon_corner_rect(size: float, *, corner: str = 'right', top: float = ICON_CORNER_MARGIN_Y) -> RectSpec:
    """Return an icon rect pinned to a slide corner."""
    if corner == 'left':
        x = ICON_CORNER_MARGIN_X
    else:
        x = round(SLIDE_WIDTH_IN - ICON_CORNER_MARGIN_X - size, 2)
    return RectSpec(x, top, size, size)


def flow_layout_spec(
    spec: LayoutSpec,
    *,
    title_text: str,
    key_message_text: str = '',
    title_font_pt: float = 30,
    key_font_pt: float = 18,
    chip_texts: list[str] | None = None,
    chip_font_pt: float = 11.0,
    corner_style: str = "square",
) -> LayoutSpec:
    """Return a layout spec adjusted in display order for title -> key message -> content.

    The base template still defines widths and general regions, but vertical placement
    is recomputed from text demand so lower content starts below the actual title block.

    When *chip_texts* is provided, chip height is expanded to fit the tallest
    chip text and the footer is cascaded below the taller chips.
    """
    if spec.title_rect is None:
        return spec

    title_height = max(
        spec.title_rect.h,
        estimate_text_height_in(title_text, spec.title_rect.w, title_font_pt),
    )
    title_rect = replace(spec.title_rect, h=title_height)

    next_y = title_rect.y + title_rect.h + 0.08

    key_rect = spec.key_message_rect
    if key_rect is not None:
        key_height = max(
            key_rect.h,
            estimate_text_height_in(key_message_text, key_rect.w, key_font_pt),
        ) if key_message_text.strip() else key_rect.h
        key_rect = replace(key_rect, y=next_y, h=key_height)
        next_y = key_rect.y + key_rect.h + 0.08

    accent_rect = spec.accent_rect
    if accent_rect is not None:
        if accent_rect.y < spec.title_rect.y:
            # Accent is a header decoration above the title — keep solver position
            pass
        else:
            accent_rect = replace(accent_rect, y=next_y)
            next_y = accent_rect.y + accent_rect.h + 0.18

    content_bottom = spec.notes_rect.y - 0.22 if spec.notes_rect is not None else 6.0

    footer_gap = 0.12 if spec.footer_rect is not None else 0.0
    footer_reserved = (spec.footer_rect.h + footer_gap) if spec.footer_rect is not None else 0.0
    chip_height = _compute_chip_height(
        spec.chips_rect,
        chip_texts=chip_texts,
        chip_font_pt=chip_font_pt,
        corner_style=corner_style,
    )
    chips_reserved = (chip_height + 0.12) if spec.chips_rect is not None else 0.0
    chips_bottom = content_bottom - footer_reserved
    flow_bottom = max(chips_bottom - chips_reserved, next_y)

    content_rect = spec.content_rect
    if content_rect is not None:
        content_rect = replace(
            content_rect,
            y=next_y,
            h=max(flow_bottom - next_y, 0.8),
        )

    summary_box = spec.summary_box
    if summary_box is not None:
        summary_box = replace(summary_box, y=next_y)
        summary_bottom = summary_box.y + summary_box.h
        if content_rect is not None:
            content_rect = replace(
                content_rect,
                y=summary_bottom + 0.22,
                h=max(flow_bottom - (summary_bottom + 0.22), 0.6),
            )

    cards = spec.cards
    if cards is not None:
        avail_h = max(flow_bottom - next_y, 0.8)
        rows = max(math.ceil(spec.max_items / cards.columns), 1) if spec.max_items > 0 else max(math.ceil(1 / cards.columns), 1)
        card_h = round((avail_h - (rows - 1) * cards.gap_y) / rows, 2)
        cards = replace(cards, start_y=next_y, card_h=max(card_h, 0.5))

    stats = spec.stats
    if stats is not None:
        avail_h = max(flow_bottom - (next_y + 0.08), 0.8)
        stats = replace(stats, start_y=next_y + 0.08, box_h=round(avail_h, 2))

    comparison = spec.comparison
    if comparison is not None:
        left = replace(comparison.left, y=next_y, h=max(content_bottom - next_y, 1.0))
        right = replace(comparison.right, y=next_y, h=max(content_bottom - next_y, 1.0))
        comparison = ComparisonSpec(left=left, right=right)

    timeline = spec.timeline
    if timeline is not None:
        line_h = max(content_bottom - next_y, 1.2)
        eff_items = max(spec.max_items, 1)
        step_y = round(line_h / eff_items, 4)
        timeline = replace(
            timeline,
            line_y=next_y,
            line_h=line_h,
            start_y=next_y - 0.04,
            step_y=step_y,
        )

    cascaded_chips = _cascade_chips(
        spec.chips_rect, content_rect, chips_bottom,
        chip_texts=chip_texts, chip_font_pt=chip_font_pt,
        fallback_y=next_y, corner_style=corner_style,
    )

    return replace(
        spec,
        title_rect=title_rect,
        key_message_rect=key_rect,
        accent_rect=accent_rect,
        content_rect=content_rect,
        summary_box=summary_box,
        hero_rect=_cascade_subzone(spec.hero_rect, next_y, content_bottom),
        chips_rect=cascaded_chips,
        footer_rect=_cascade_footer(spec.footer_rect, content_rect, cascaded_chips, content_bottom),
        sidebar_rect=_cascade_subzone(spec.sidebar_rect, next_y, content_bottom),
        cards=cards,
        stats=stats,
        comparison=comparison,
        timeline=timeline,
    )
