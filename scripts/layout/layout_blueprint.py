"""Declarative layout blueprints for slide generation.

Instead of hardcoded coordinates, each layout type is defined as a
*blueprint* — a list of named zones, their structural relationships,
and design tokens (margins, gaps, ratios).  The constraint solver
(constraint_solver.py) reads a blueprint and computes concrete
coordinates for every zone at runtime based on actual text
measurements from the PowerPoint COM engine.

This replaces the 200+ lines of per-layout-type coordinate math formerly in
layout_specs.py with ~10 lines of declarative structure per layout.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


# ---------------------------------------------------------------------------
# Design tokens — the small set of constants from which all geometry derives
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DesignTokens:
    """Parameterised spacing / sizing constants for a slide."""
    margin_x: float = 0.5          # horizontal margin (left & right)
    margin_top: float = 0.5        # space above first zone
    notes_y: float = 6.18          # fixed Y for the notes zone
    notes_h: float = 0.7           # notes zone height
    gap_y: float = 0.08            # vertical gap between stacked zones
    gap_x: float = 0.25            # horizontal gap between columns
    accent_h: float = 0.04         # accent rule thickness
    accent_gap: float = 0.18       # extra gap below accent rule
    header_w_ratio: float = 0.95   # title/key-message width as fraction of available width
    icon_corner_margin_x: float = 0.5
    icon_corner_margin_y: float = 0.45


DEFAULT_TOKENS = DesignTokens()


# ---------------------------------------------------------------------------
# Zone definitions — what exists on a slide, not where it is
# ---------------------------------------------------------------------------

class ZoneRole(Enum):
    """Semantic role of a layout zone."""
    TITLE = 'title'
    KEY_MESSAGE = 'key_message'
    ACCENT = 'accent'
    CONTENT = 'content'
    SUMMARY_BOX = 'summary_box'
    ICON = 'icon'
    HERO = 'hero'
    SIDEBAR = 'sidebar'
    CHIPS = 'chips'
    FOOTER = 'footer'
    NOTES = 'notes'


@dataclass(frozen=True)
class ZoneDef:
    """Declarative specification for a single layout zone.

    ``min_h`` and ``preferred_h`` are in inches and drive the constraint
    solver.  ``font_pt`` / ``bold`` control the COM AutoFit measurement
    request so the solver receives an accurate minimum height.

    ``stretch`` marks a zone that should absorb remaining vertical space
    (typically the content zone).
    """
    role: ZoneRole
    min_h: float = 0.3             # absolute minimum (inches)
    preferred_h: float = 0.5       # preferred height (used as a weak target)
    font_pt: float = 18.0          # font size for COM measurement
    bold: bool = False
    stretch: bool = False          # zone expands to fill remaining space
    fixed_h: float | None = None   # if set, solver treats height as constant
    width_fraction: float = 1.0    # fraction of available content width


# ---------------------------------------------------------------------------
# Variant descriptors — layout-specific structural metadata
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CardsVariant:
    columns: int = 2
    gap_x: float = 0.32
    gap_y: float = 0.28


@dataclass(frozen=True)
class StatsVariant:
    columns: int = 3
    gap_x: float = 0.35


@dataclass(frozen=True)
class TimelineVariant:
    line_x: float = 1.1
    dot_x: float = 0.98
    dot_size: float = 0.24
    text_x: float = 1.45


@dataclass(frozen=True)
class ComparisonVariant:
    gap_x: float = 0.25


# ---------------------------------------------------------------------------
# LayoutBlueprint — the top-level declaration for a layout type
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LayoutBlueprint:
    """Declarative description of a slide layout.

    ``zones`` are listed in top-to-bottom visual order.  The constraint
    solver walks them sequentially and stacks them vertically, respecting
    measured text heights and the stretch flag.
    """
    layout_type: str
    zones: tuple[ZoneDef, ...]
    icon_size: float = 0.0                   # 0 → no icon zone
    tokens: DesignTokens = field(default_factory=lambda: DEFAULT_TOKENS)

    # Variant-specific structural metadata (mutually exclusive)
    cards: CardsVariant | None = None
    stats: StatsVariant | None = None
    timeline: TimelineVariant | None = None
    comparison: ComparisonVariant | None = None

    # Structural flags
    has_hero: bool = False                    # title-slide hero image zone
    has_sidebar: bool = False                 # agenda/diagram sidebar


# ---------------------------------------------------------------------------
# Blueprint catalogue — one per layout type
# ---------------------------------------------------------------------------

_ZONE_TITLE = ZoneDef(ZoneRole.TITLE, min_h=0.40, preferred_h=0.50, font_pt=30, bold=True)
_ZONE_KEY   = ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.30, preferred_h=0.55, font_pt=18)
_ZONE_ACCENT = ZoneDef(ZoneRole.ACCENT, fixed_h=0.04, min_h=0.04, preferred_h=0.04)
_ZONE_NOTES = ZoneDef(ZoneRole.NOTES, fixed_h=0.70, min_h=0.70, preferred_h=0.70)

# Content zones — the stretch flag means "fill remaining vertical space"
_ZONE_CONTENT = ZoneDef(ZoneRole.CONTENT, min_h=1.5, preferred_h=3.8, stretch=True)
_ZONE_SUMMARY = ZoneDef(ZoneRole.SUMMARY_BOX, min_h=0.6, preferred_h=0.95)


def _standard_header() -> tuple[ZoneDef, ...]:
    """Title → key message → accent → … shared by most layouts."""
    return (_ZONE_TITLE, _ZONE_KEY, _ZONE_ACCENT)


# -- title slide (vertically centred, hero on right) -----------------------
_TITLE_BLUEPRINT = LayoutBlueprint(
    layout_type='title',
    zones=(
        ZoneDef(ZoneRole.ACCENT, fixed_h=0.06, min_h=0.06, preferred_h=0.06),
        ZoneDef(ZoneRole.TITLE, min_h=0.50, preferred_h=0.60, font_pt=30, bold=True),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.30, preferred_h=0.46, font_pt=18),
        ZoneDef(ZoneRole.CHIPS, min_h=0.30, preferred_h=0.46),
        ZoneDef(ZoneRole.FOOTER, min_h=0.40, preferred_h=0.70),
        _ZONE_NOTES,
    ),
    icon_size=2.35,
    has_hero=True,
    tokens=DesignTokens(margin_top=1.08),
)

# -- section ----------------------------------------------------------------
_SECTION_BLUEPRINT = LayoutBlueprint(
    layout_type='section',
    zones=(
        ZoneDef(ZoneRole.ACCENT, fixed_h=0.05, min_h=0.05, preferred_h=0.05),
        ZoneDef(ZoneRole.TITLE, min_h=0.40, preferred_h=0.48, font_pt=36, bold=True),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.40, preferred_h=0.68, font_pt=24),
        _ZONE_NOTES,
    ),
    icon_size=1.6,
    tokens=DesignTokens(margin_x=0.9, margin_top=1.68),
)

# -- agenda -----------------------------------------------------------------
_AGENDA_BLUEPRINT = LayoutBlueprint(
    layout_type='agenda',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    has_sidebar=True,
)

# -- bullets (default) ------------------------------------------------------
_BULLETS_BLUEPRINT = LayoutBlueprint(
    layout_type='bullets',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=2.1,
)

# -- cards ------------------------------------------------------------------
_CARDS_BLUEPRINT = LayoutBlueprint(
    layout_type='cards',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=2.1,
    cards=CardsVariant(columns=2, gap_x=0.32, gap_y=0.28),
)

# -- stats ------------------------------------------------------------------
_STATS_BLUEPRINT = LayoutBlueprint(
    layout_type='stats',
    zones=(
        *_standard_header(),
        _ZONE_CONTENT,
        ZoneDef(ZoneRole.FOOTER, min_h=0.50, preferred_h=0.72),
        _ZONE_NOTES,
    ),
    icon_size=2.1,
    stats=StatsVariant(columns=3, gap_x=0.35),
)

# -- comparison -------------------------------------------------------------
_COMPARISON_BLUEPRINT = LayoutBlueprint(
    layout_type='comparison',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=2.1,
    comparison=ComparisonVariant(gap_x=0.25),
)

# -- timeline ---------------------------------------------------------------
_TIMELINE_BLUEPRINT = LayoutBlueprint(
    layout_type='timeline',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=2.1,
    timeline=TimelineVariant(line_x=1.1, dot_x=0.98, dot_size=0.24, text_x=1.45),
)

# -- summary ----------------------------------------------------------------
_SUMMARY_BLUEPRINT = LayoutBlueprint(
    layout_type='summary',
    zones=(*_standard_header(), _ZONE_SUMMARY, _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=2.1,
)

# -- diagram ----------------------------------------------------------------
_DIAGRAM_BLUEPRINT = LayoutBlueprint(
    layout_type='diagram',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=1.8,
    has_sidebar=True,
)

# -- chart ------------------------------------------------------------------
_CHART_BLUEPRINT = LayoutBlueprint(
    layout_type='chart',
    zones=(
        *_standard_header(),
        ZoneDef(ZoneRole.CONTENT, min_h=2.5, preferred_h=4.2, stretch=True),
        ZoneDef(ZoneRole.FOOTER, min_h=0.15, preferred_h=0.22, fixed_h=0.22),
        _ZONE_NOTES,
    ),
    icon_size=1.6,
)

# -- closing (thank-you / end slide) ----------------------------------------
_CLOSING_BLUEPRINT = LayoutBlueprint(
    layout_type='closing',
    zones=(
        ZoneDef(ZoneRole.ACCENT, fixed_h=0.05, min_h=0.05, preferred_h=0.05),
        ZoneDef(ZoneRole.TITLE, min_h=0.50, preferred_h=0.60, font_pt=36, bold=True),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.30, preferred_h=0.50, font_pt=18),
        ZoneDef(ZoneRole.FOOTER, min_h=0.40, preferred_h=0.60),
        _ZONE_NOTES,
    ),
    icon_size=1.6,
    tokens=DesignTokens(margin_x=0.9, margin_top=2.0),
)

# -- photo_fullbleed (full-bleed photo with overlaid title) -----------------
_PHOTO_FULLBLEED_BLUEPRINT = LayoutBlueprint(
    layout_type='photo_fullbleed',
    zones=(
        ZoneDef(ZoneRole.TITLE, min_h=0.60, preferred_h=1.0, font_pt=36, bold=True),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.30, preferred_h=0.50, font_pt=18),
        _ZONE_NOTES,
    ),
    has_hero=True,
    tokens=DesignTokens(margin_x=0.7, margin_top=4.0),
)

# -- multi_column (3–5 equal-width content columns) -------------------------
_MULTI_COLUMN_BLUEPRINT = LayoutBlueprint(
    layout_type='multi_column',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=1.6,
    cards=CardsVariant(columns=3, gap_x=0.30, gap_y=0.25),
)


# -- content_caption (left narration + right content area) ------------------
# Inspired by PowerPoint's "Content with Caption" layout:
# title + text body on the left ~35%, large content area on the right ~65%.
_CONTENT_CAPTION_BLUEPRINT = LayoutBlueprint(
    layout_type='content_caption',
    zones=(
        ZoneDef(ZoneRole.TITLE, min_h=0.50, preferred_h=0.80, font_pt=28, bold=True,
                width_fraction=0.35),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.60, preferred_h=2.80, font_pt=16,
                width_fraction=0.35),
        ZoneDef(ZoneRole.CONTENT, min_h=2.0, preferred_h=4.2, stretch=True),
        _ZONE_NOTES,
    ),
    has_sidebar=False,
    tokens=DesignTokens(margin_top=0.50, header_w_ratio=1.0),
)

# -- picture_caption (left narration + right picture) -----------------------
# Like content_caption but has_hero=True so the right zone renders a picture.
_PICTURE_CAPTION_BLUEPRINT = LayoutBlueprint(
    layout_type='picture_caption',
    zones=(
        ZoneDef(ZoneRole.TITLE, min_h=0.50, preferred_h=0.80, font_pt=28, bold=True,
                width_fraction=0.35),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.60, preferred_h=2.80, font_pt=16,
                width_fraction=0.35),
        _ZONE_NOTES,
    ),
    has_hero=True,
    tokens=DesignTokens(margin_top=0.50, header_w_ratio=1.0),
)

# -- two_content (two equal content columns, no sub-headers) ----------------
# From PowerPoint's "Two Content" layout: title + two side-by-side content
# areas of equal width without comparison sub-headers.
_TWO_CONTENT_BLUEPRINT = LayoutBlueprint(
    layout_type='two_content',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=1.6,
    comparison=ComparisonVariant(gap_x=0.25),
)

# -- title_only (title bar + open canvas) -----------------------------------
# PowerPoint's "Title Only" layout: a title band at the top, rest is open
# canvas for freeform shapes, annotations, or custom diagram placement.
_TITLE_ONLY_BLUEPRINT = LayoutBlueprint(
    layout_type='title_only',
    zones=(
        _ZONE_TITLE,
        ZoneDef(ZoneRole.CONTENT, min_h=3.0, preferred_h=4.8, stretch=True),
        _ZONE_NOTES,
    ),
    tokens=DesignTokens(margin_top=0.40),
)

# -- quote (centered quotation + attribution) --------------------------------
# A testimonial or quote slide with large centred text and a smaller
# attribution line underneath.
_QUOTE_BLUEPRINT = LayoutBlueprint(
    layout_type='quote',
    zones=(
        ZoneDef(ZoneRole.ACCENT, fixed_h=0.05, min_h=0.05, preferred_h=0.05),
        ZoneDef(ZoneRole.CONTENT, min_h=1.5, preferred_h=2.4, font_pt=28,
                stretch=True),
        ZoneDef(ZoneRole.FOOTER, min_h=0.30, preferred_h=0.50, font_pt=16),
        _ZONE_NOTES,
    ),
    tokens=DesignTokens(margin_x=1.8, margin_top=1.6, header_w_ratio=1.0),
)

# -- big_number (single dominant KPI / metric) ------------------------------
# Spotlight a single large number with a descriptive subtitle and optional
# context bullets underneath.
_BIG_NUMBER_BLUEPRINT = LayoutBlueprint(
    layout_type='big_number',
    zones=(
        ZoneDef(ZoneRole.ACCENT, fixed_h=0.05, min_h=0.05, preferred_h=0.05),
        ZoneDef(ZoneRole.TITLE, min_h=1.0, preferred_h=1.8, font_pt=72, bold=True),
        ZoneDef(ZoneRole.KEY_MESSAGE, min_h=0.40, preferred_h=0.60, font_pt=22),
        ZoneDef(ZoneRole.CONTENT, min_h=0.8, preferred_h=1.6, stretch=True),
        _ZONE_NOTES,
    ),
    tokens=DesignTokens(margin_x=1.5, margin_top=1.2, header_w_ratio=1.0),
)

# -- process (horizontal step flow) ----------------------------------------
# Horizontal process / workflow steps (3–6 steps shown as equal-width cards
# in a single row).
_PROCESS_BLUEPRINT = LayoutBlueprint(
    layout_type='process',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=1.6,
    cards=CardsVariant(columns=4, gap_x=0.30, gap_y=0.25),
)

# -- pyramid (funnel / pyramid visualisation) --------------------------------
# A pyramid diagram — typically 3–5 tiers stacked vertically from wide
# (bottom) to narrow (top). Uses the timeline variant to lay out tiers
# along a vertical spine.
_PYRAMID_BLUEPRINT = LayoutBlueprint(
    layout_type='pyramid',
    zones=(*_standard_header(), _ZONE_CONTENT, _ZONE_NOTES),
    icon_size=1.6,
    timeline=TimelineVariant(line_x=6.67, dot_x=6.55, dot_size=0.0,
                             text_x=0.5),
)


# -- registry ---------------------------------------------------------------

_BLUEPRINTS: dict[str, LayoutBlueprint] = {
    'title': _TITLE_BLUEPRINT,
    'section': _SECTION_BLUEPRINT,
    'agenda': _AGENDA_BLUEPRINT,
    'bullets': _BULLETS_BLUEPRINT,
    'cards': _CARDS_BLUEPRINT,
    'stats': _STATS_BLUEPRINT,
    'comparison': _COMPARISON_BLUEPRINT,
    'timeline': _TIMELINE_BLUEPRINT,
    'summary': _SUMMARY_BLUEPRINT,
    'diagram': _DIAGRAM_BLUEPRINT,
    'chart': _CHART_BLUEPRINT,
    'closing': _CLOSING_BLUEPRINT,
    'photo_fullbleed': _PHOTO_FULLBLEED_BLUEPRINT,
    'multi_column': _MULTI_COLUMN_BLUEPRINT,
    'content_caption': _CONTENT_CAPTION_BLUEPRINT,
    'picture_caption': _PICTURE_CAPTION_BLUEPRINT,
    'two_content': _TWO_CONTENT_BLUEPRINT,
    'title_only': _TITLE_ONLY_BLUEPRINT,
    'quote': _QUOTE_BLUEPRINT,
    'big_number': _BIG_NUMBER_BLUEPRINT,
    'process': _PROCESS_BLUEPRINT,
    'pyramid': _PYRAMID_BLUEPRINT,
}


def get_blueprint(layout_type: str) -> LayoutBlueprint:
    """Return the declarative blueprint for a layout type.

    Falls back to ``bullets`` for unknown types.
    """
    return _BLUEPRINTS.get(layout_type.lower().strip(), _BULLETS_BLUEPRINT)


def list_layout_types() -> list[str]:
    """Return all registered layout type names."""
    return list(_BLUEPRINTS.keys())
