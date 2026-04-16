"""Kiwisolver-based constraint layout solver.

Takes a ``LayoutBlueprint`` + measured text heights and produces a
standard ``LayoutSpec`` with content-adaptive coordinates.

The solver uses the Cassowary algorithm (via kiwisolver) with a
four-level strength hierarchy:

    required  → slide bounds, minimum zone heights, sequential ordering
    strong    → stretch zones fill remaining space
    medium    → preferred positions from blueprint
    weak      → aesthetic balance (equal spacing, visual centering)

Horizontal layout is deterministic (computed from design tokens, not
solved), so only vertical positions (y, h) are constraint variables.

Two-pass solving (inspired by matplotlib's ``_constrained_layout.py``)
----------------------------------------------------------------------
After the first solve pass we check for zone compression — analogous to
matplotlib's ``check_no_collapsed_axes()``.  If a non-stretch zone was
squeezed below its measured/preferred height beyond a threshold, a
second *relaxation* pass is run: non-essential zone preferred heights
are reduced to their minimums to claw back space for the stretch
(content) zone.  This avoids catastrophic content-area collapse when
many zones compete for vertical space.
"""

from __future__ import annotations

import math

import kiwisolver as kiwi

from layout_blueprint import (
    CardsVariant,
    ComparisonVariant,
    DesignTokens,
    LayoutBlueprint,
    StatsVariant,
    TimelineVariant,
    ZoneDef,
    ZoneRole,
)
from layout_specs import (
    SLIDE_HEIGHT_IN,
    SLIDE_WIDTH_IN,
    CardsSpec,
    ComparisonSpec,
    LayoutSpec,
    RectSpec,
    SolveQuality,
    StatsSpec,
    TimelineSpec,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _body_content_width(tokens: DesignTokens) -> float:
    """Usable body width in inches.

    Body content spans the full safe width of the slide. Decorative corner
    icons only constrain the header band; the main body is pushed below the
    icon instead of permanently reserving a right-side gutter.
    """
    return round(SLIDE_WIDTH_IN - 2 * tokens.margin_x, 2)


def _header_content_width(
    tokens: DesignTokens,
    has_icon: bool,
    icon_size: float,
) -> float:
    """Usable header width in inches."""
    w = _body_content_width(tokens)
    if has_icon and icon_size > 0:
        w -= icon_size + tokens.icon_corner_margin_x
    return round(w, 2)


def _header_rect(
    x: float,
    y: float,
    avail_w: float,
    h: float,
    ratio: float,
) -> RectSpec:
    """Centered header rect using *ratio* of available width."""
    w = round(avail_w * ratio, 2)
    hx = round(x + (avail_w - w) / 2, 2)
    return RectSpec(hx, round(y, 4), w, round(h, 4))


def _icon_corner_rect(
    size: float,
    tokens: DesignTokens,
) -> RectSpec:
    """Icon rect pinned to top-right corner."""
    x = round(SLIDE_WIDTH_IN - tokens.icon_corner_margin_x - size, 2)
    return RectSpec(x, tokens.icon_corner_margin_y, size, size)


# ---------------------------------------------------------------------------
# Post-solve quality detection  (cf. matplotlib check_no_collapsed_axes)
# ---------------------------------------------------------------------------

# Compression beyond this fraction triggers a relaxation pass.
_COMPRESSION_THRESHOLD = 0.25


def _check_solve_quality(
    zvs: list,  # list[_ZV]
    measured_heights: dict[str, float],
) -> SolveQuality:
    """Compare solved zone heights against their targets.

    Returns a ``SolveQuality`` summarising how much the solver had to
    compress each zone.  A ``max_compression_ratio`` of 0 means the
    layout fits perfectly; 1.0 means some zone is squashed all the way
    down to ``min_h``.
    """
    compressed: list[str] = []
    worst_ratio = 0.0

    for zv in zvs:
        zd = zv.zd
        if zd.fixed_h is not None:
            continue  # fixed zones aren't "compressed"

        # For stretch zones, only check when a measurement exists.
        # Stretch zones naturally fill remaining space; they're only
        # "compressed" when measured content can't fit.
        if zd.stretch:
            target = measured_heights.get(zd.role.value)
            if target is None or target <= zd.min_h:
                continue
        else:
            target = measured_heights.get(zd.role.value, zd.preferred_h)
            if target <= zd.min_h:
                continue

        solved_h = zv.h.value()
        if solved_h < target - 0.02:
            ratio = min((target - solved_h) / (target - zd.min_h), 1.0)
            compressed.append(zd.role.value)
            worst_ratio = max(worst_ratio, ratio)

    is_overcrowded = worst_ratio > _COMPRESSION_THRESHOLD

    return SolveQuality(
        compressed_zones=tuple(compressed),
        max_compression_ratio=round(worst_ratio, 4),
        is_overcrowded=is_overcrowded,
    )


# ---------------------------------------------------------------------------
# Core kiwi solve (single pass)
# ---------------------------------------------------------------------------

class _ZV:
    """Bundle of kiwi variables for one zone."""
    __slots__ = ('zd', 'y', 'h')

    def __init__(self, zd: ZoneDef) -> None:
        self.zd = zd
        self.y = kiwi.Variable(f'{zd.role.value}.y')
        self.h = kiwi.Variable(f'{zd.role.value}.h')


def _run_solve(
    zones: tuple[ZoneDef, ...],
    tokens: DesignTokens,
    measured_heights: dict[str, float],
) -> list:  # list[_ZV]
    """Build constraints and solve.  Returns the list of ``_ZV`` bundles
    with solved values available via ``.y.value()`` / ``.h.value()``.
    """
    solver = kiwi.Solver()
    zvs: list[_ZV] = [_ZV(z) for z in zones]

    notes_y = tokens.notes_y
    slide_bottom = SLIDE_HEIGHT_IN

    # --- required constraints ---------------------------------------------
    for zv in zvs:
        zd = zv.zd
        solver.addConstraint((zv.y >= 0) | kiwi.strength.required)
        solver.addConstraint((zv.h >= zd.min_h) | kiwi.strength.required)
        solver.addConstraint((zv.y + zv.h <= slide_bottom) | kiwi.strength.required)

        if zd.fixed_h is not None:
            solver.addConstraint((zv.h == zd.fixed_h) | kiwi.strength.required)

        mh = measured_heights.get(zd.role.value)
        if mh is not None and mh > zd.min_h:
            solver.addConstraint((zv.h >= mh) | kiwi.strength.strong)

    # Sequential ordering
    for i in range(1, len(zvs)):
        prev, curr = zvs[i - 1], zvs[i]
        gap = tokens.accent_gap if prev.zd.role == ZoneRole.ACCENT else tokens.gap_y
        solver.addConstraint(
            (curr.y >= prev.y + prev.h + gap) | kiwi.strength.required
        )

    if zvs:
        solver.addConstraint(
            (zvs[0].y >= tokens.margin_top) | kiwi.strength.required
        )

    # Notes pinned
    for zv in zvs:
        if zv.zd.role == ZoneRole.NOTES:
            solver.addConstraint((zv.y == notes_y) | kiwi.strength.required)

    # Content family must end before notes
    for zv in zvs:
        if zv.zd.role in (ZoneRole.CONTENT, ZoneRole.FOOTER, ZoneRole.CHIPS, ZoneRole.SUMMARY_BOX):
            solver.addConstraint(
                (zv.y + zv.h <= notes_y - tokens.gap_y) | kiwi.strength.strong
            )

    # --- strong: stretch zones fill remaining space -----------------------
    for zv in zvs:
        if zv.zd.stretch:
            idx = zvs.index(zv)
            after_zones_h: float = 0.0
            for j in range(idx + 1, len(zvs)):
                if zvs[j].zd.role == ZoneRole.NOTES:
                    break
                fixed = zvs[j].zd.fixed_h
                after_h: float = (
                    fixed if fixed is not None
                    else measured_heights.get(zvs[j].zd.role.value, zvs[j].zd.preferred_h)
                )
                after_zones_h += after_h + tokens.gap_y

            target_bottom = notes_y - tokens.gap_y - after_zones_h
            solver.addConstraint(
                (zv.y + zv.h == target_bottom) | kiwi.strength.strong
            )

    # --- medium: preferred heights ----------------------------------------
    for zv in zvs:
        if zv.zd.stretch:
            continue
        mh = measured_heights.get(zv.zd.role.value)
        target_h = mh if mh is not None else zv.zd.preferred_h
        solver.addConstraint(
            (zv.h == target_h) | kiwi.strength.medium
        )

    # --- weak: visual balance ---------------------------------------------
    if zvs:
        solver.addConstraint(
            (zvs[0].y == tokens.margin_top) | kiwi.strength.weak
        )

    content_zvs = [zv for zv in zvs if zv.zd.role != ZoneRole.NOTES]
    for i in range(1, len(content_zvs)):
        for j in range(i + 1, len(content_zvs)):
            gap_i = content_zvs[i].y - (content_zvs[i - 1].y + content_zvs[i - 1].h)
            gap_j = content_zvs[j].y - (content_zvs[j - 1].y + content_zvs[j - 1].h)
            solver.addConstraint((gap_i == gap_j) | kiwi.strength.weak)

    # --- solve ------------------------------------------------------------
    solver.updateVariables()
    return zvs


# ---------------------------------------------------------------------------
# Solver (public API)
# ---------------------------------------------------------------------------

def solve_layout(
    blueprint: LayoutBlueprint,
    measured_heights: dict[str, float],
    *,
    has_icon: bool = False,
    item_count: int = 0,
    max_items: int | None = None,
    card_measured_h: float | None = None,
) -> LayoutSpec:
    """Solve vertical layout from *blueprint* + *measured_heights*.

    Parameters
    ----------
    blueprint:
        Declarative layout description.
    measured_heights:
        ``{zone_role_value: height_in}`` from COM text measurement.
        Missing entries fall back to the zone's ``preferred_h``.
    has_icon:
        Whether the slide contains an icon.
    item_count:
        Number of items for cards/stats/timeline (used for sub-dividing
        the content zone).
    max_items:
        Override for blueprint-level max_items cap.
    card_measured_h:
        Per-item measured height for columnar layouts (cards/stats/
        comparison).  When set, the CONTENT zone height is derived from
        this value × rows so individual items never overflow.

    Returns
    -------
    LayoutSpec
        Standard layout specification with solved coordinates.
    """
    tokens = blueprint.tokens
    zones = blueprint.zones
    icon_size = blueprint.icon_size if has_icon else 0.0
    cw = _body_content_width(tokens)

    # If per-item measurement provided, derive CONTENT zone height from it.
    if card_measured_h is not None and card_measured_h > 0:
        if blueprint.timeline is not None:
            eff_items = max(item_count, 1)
            step_y = card_measured_h / 0.85
            content_h = step_y * eff_items
            measured_heights = {**measured_heights, ZoneRole.CONTENT.value: content_h}
        else:
            variant = blueprint.cards or blueprint.stats or blueprint.comparison
            if variant is not None:
                cols = getattr(variant, 'columns', 2)
                gap_y = getattr(variant, 'gap_y', 0.28)
                eff_items = max(item_count, 1)
                rows = max(math.ceil(eff_items / cols), 1)
                content_h = card_measured_h * rows + gap_y * (rows - 1)
                measured_heights = {**measured_heights, ZoneRole.CONTENT.value: content_h}

    # ---- Pass 1: solve with original measurements -----------------------
    zvs = _run_solve(zones, tokens, measured_heights)
    quality = _check_solve_quality(zvs, measured_heights)

    # ---- Pass 2 (conditional): relaxation --------------------------------
    # Inspired by matplotlib's double-pass in _constrained_layout.py.
    # If the first pass shows severe compression, reduce non-essential zone
    # preferred heights to their minimums and re-solve.  This claws back
    # vertical space for the stretch (content) zone.
    relaxation_pass = False
    if quality.is_overcrowded:
        relaxed = dict(measured_heights)
        for zv in zvs:
            zd = zv.zd
            if zd.fixed_h is not None or zd.stretch:
                continue
            if zd.role.value in quality.compressed_zones:
                continue  # already compressed — leave alone
            if zd.role in (ZoneRole.KEY_MESSAGE, ZoneRole.CHIPS, ZoneRole.FOOTER):
                # Relax: remove measured override so solver uses min_h
                relaxed.pop(zd.role.value, None)

        zvs = _run_solve(zones, tokens, relaxed)
        quality = _check_solve_quality(zvs, relaxed)
        relaxation_pass = True

    # ---- read solved values ----------------------------------------------
    solved: dict[str, tuple[float, float]] = {}
    for zv in zvs:
        solved[zv.zd.role.value] = (round(zv.y.value(), 4), round(zv.h.value(), 4))

    # Attach quality metadata
    final_quality = SolveQuality(
        compressed_zones=quality.compressed_zones,
        max_compression_ratio=quality.max_compression_ratio,
        is_overcrowded=quality.is_overcrowded,
        relaxation_pass=relaxation_pass,
    )

    return _build_layout_spec(
        blueprint=blueprint,
        solved=solved,
        cw=cw,
        has_icon=has_icon,
        icon_size=icon_size,
        item_count=item_count,
        max_items=max_items,
        card_measured_h=card_measured_h,
        solve_quality=final_quality,
    )


# ---------------------------------------------------------------------------
# LayoutSpec assembly from solved values
# ---------------------------------------------------------------------------

def _build_layout_spec(
    *,
    blueprint: LayoutBlueprint,
    solved: dict[str, tuple[float, float]],
    cw: float,
    has_icon: bool,
    icon_size: float,
    item_count: int,
    max_items: int | None,
    card_measured_h: float | None = None,
    solve_quality: SolveQuality | None = None,
) -> LayoutSpec:
    tokens = blueprint.tokens
    mx = tokens.margin_x

    # Helper to read solved zone
    def _rect(role: ZoneRole, *, w: float | None = None, x: float | None = None) -> RectSpec | None:
        v = solved.get(role.value)
        if v is None:
            return None
        y, h = v
        return RectSpec(
            x=round(x if x is not None else mx, 4),
            y=y,
            w=round(w if w is not None else cw, 4),
            h=h,
        )

    header_cw = _header_content_width(tokens, has_icon, icon_size)

    # Title & key_message get header-width treatment
    title_rect = None
    if (tv := solved.get(ZoneRole.TITLE.value)):
        title_rect = _header_rect(mx, tv[0], header_cw, tv[1], tokens.header_w_ratio)

    key_rect = None
    if (kv := solved.get(ZoneRole.KEY_MESSAGE.value)):
        key_rect = _header_rect(mx, kv[0], header_cw, kv[1], tokens.header_w_ratio)

    accent_rect = _rect(ZoneRole.ACCENT, w=1.5)
    content_rect = _rect(ZoneRole.CONTENT)
    notes_rect = _rect(ZoneRole.NOTES, w=SLIDE_WIDTH_IN - 2 * mx)
    summary_box = _rect(ZoneRole.SUMMARY_BOX)
    chips_rect = _rect(ZoneRole.CHIPS)
    footer_rect = _rect(ZoneRole.FOOTER)

    # Synthesize a fallback content_rect for layouts that lack a CONTENT zone
    # (e.g. title, section) so generated code can safely reference spec.content_rect.
    if content_rect is None:
        last_zone = key_rect or title_rect or accent_rect
        fallback_y = round((last_zone.y + last_zone.h + tokens.gap_y) if last_zone else tokens.margin_top, 4)
        notes_top = notes_rect.y if notes_rect else (SLIDE_HEIGHT_IN - 0.7)
        fallback_h = round(max(notes_top - tokens.gap_y - fallback_y, 0.5), 4)
        content_rect = RectSpec(mx, fallback_y, round(cw, 4), fallback_h)

    # Icon rect
    icon_rect = _icon_corner_rect(icon_size, tokens) if has_icon and icon_size > 0 else None

    # Hero rect (title slide — right side, aligned to title zone)
    hero_rect = None
    if blueprint.has_hero and title_rect:
        hero_w = 3.65
        hero_x = round(SLIDE_WIDTH_IN - mx - hero_w, 2)
        hero_y = title_rect.y - 0.25
        hero_h = 3.65
        hero_rect = RectSpec(hero_x, round(hero_y, 4), hero_w, hero_h)

    if blueprint.layout_type == 'title' and hero_rect is not None:
        narration_w = round(max(hero_rect.x - mx - tokens.gap_x, 3.2), 2)
        if title_rect:
            title_rect = RectSpec(mx, title_rect.y, narration_w, title_rect.h)
        if key_rect:
            key_rect = RectSpec(mx, key_rect.y, narration_w, key_rect.h)
        if content_rect:
            content_rect = RectSpec(mx, content_rect.y, narration_w, content_rect.h)
        if chips_rect:
            chips_rect = RectSpec(mx, chips_rect.y, narration_w, chips_rect.h)
        if footer_rect:
            footer_rect = RectSpec(mx, footer_rect.y, narration_w, footer_rect.h)
    elif icon_rect is not None:
        body_top = round(icon_rect.y + icon_rect.h + max(tokens.gap_y, 0.12), 4)
        if summary_box is not None and summary_box.y < body_top:
            shift = round(body_top - summary_box.y, 4)
            summary_box = RectSpec(summary_box.x, body_top, summary_box.w, summary_box.h)
            if content_rect is not None:
                content_rect = RectSpec(
                    content_rect.x,
                    round(content_rect.y + shift, 4),
                    content_rect.w,
                    max(round(content_rect.h - shift, 4), 0.6),
                )
        elif content_rect is not None and content_rect.y < body_top:
            shift = round(body_top - content_rect.y, 4)
            content_rect = RectSpec(
                content_rect.x,
                body_top,
                content_rect.w,
                max(round(content_rect.h - shift, 4), 0.8),
            )

    # Caption layouts (content_caption, picture_caption) — left narration + right content
    # Title and key_message are narrowed to ~35%, content/hero occupies the right ~65%.
    if blueprint.layout_type in ('content_caption', 'picture_caption'):
        narration_fraction = next(
            (
                zone.width_fraction
                for zone in blueprint.zones
                if zone.role in (ZoneRole.TITLE, ZoneRole.KEY_MESSAGE) and zone.width_fraction < 1.0
            ),
            None,
        )
        narration_w = round((SLIDE_WIDTH_IN - 2 * mx) * narration_fraction, 2) if narration_fraction else 4.30
        right_x = round(narration_w + mx + tokens.gap_x, 2)
        right_w = round(SLIDE_WIDTH_IN - right_x - mx, 2)
        body_top = title_rect.y if title_rect else mx
        body_h = round((notes_rect.y if notes_rect else SLIDE_HEIGHT_IN - 0.7) - tokens.gap_y - body_top, 2)
        if title_rect:
            title_rect = RectSpec(mx, title_rect.y, narration_w, title_rect.h)
        if key_rect:
            key_rect = RectSpec(mx, key_rect.y, narration_w, key_rect.h)
        content_rect = RectSpec(right_x, body_top, right_w, body_h)
        if blueprint.has_hero:
            hero_rect = RectSpec(right_x, body_top, right_w, body_h)

    # Sidebar (agenda, diagram — right column)
    sidebar_rect = None
    if blueprint.has_sidebar and content_rect:
        sidebar_w = round(SLIDE_WIDTH_IN - 2 * mx - cw + (cw * 0.28), 2)
        sidebar_x = round(SLIDE_WIDTH_IN - mx - sidebar_w, 2)
        sidebar_rect = RectSpec(
            sidebar_x, content_rect.y,
            sidebar_w, content_rect.h,
        )
        # Narrow the content rect to make room for sidebar
        main_w = round(SLIDE_WIDTH_IN - 2 * mx - sidebar_w - tokens.gap_x, 2)
        content_rect = RectSpec(mx, content_rect.y, main_w, content_rect.h)

    # Determine effective max_items
    eff_max = max_items if max_items is not None else _default_max_items(blueprint)

    # ----- variant specs --------------------------------------------------

    cards_spec = _build_cards(blueprint.cards, content_rect, item_count, mx, per_card_h=card_measured_h) if blueprint.cards else None
    stats_spec = _build_stats(blueprint.stats, content_rect, cw, mx) if blueprint.stats else None
    timeline_spec = _build_timeline(blueprint.timeline, content_rect, item_count) if blueprint.timeline else None
    comp_spec = _build_comparison(blueprint.comparison, content_rect, mx) if blueprint.comparison else None

    # Row step for agenda
    row_step = None
    if blueprint.layout_type == 'agenda' and content_rect and eff_max > 0:
        row_step = round(content_rect.h / eff_max, 2)

    return LayoutSpec(
        layout_type=blueprint.layout_type,
        title_rect=title_rect,
        key_message_rect=key_rect,
        accent_rect=accent_rect,
        icon_rect=icon_rect,
        content_rect=content_rect,
        notes_rect=notes_rect,
        summary_box=summary_box,
        hero_rect=hero_rect,
        chips_rect=chips_rect,
        footer_rect=footer_rect,
        sidebar_rect=sidebar_rect,
        max_items=eff_max,
        row_step=row_step,
        cards=cards_spec,
        stats=stats_spec,
        timeline=timeline_spec,
        comparison=comp_spec,
        solve_quality=solve_quality,
    )


def _default_max_items(bp: LayoutBlueprint) -> int:
    """Infer max items from layout type."""
    defaults = {
        'title': 0, 'section': 0, 'agenda': 5, 'bullets': 6,
        'cards': 4, 'stats': 3, 'comparison': 6, 'timeline': 5,
        'summary': 3, 'diagram': 5, 'chart': 0, 'closing': 0,
        'photo_fullbleed': 0, 'multi_column': 5,
        'content_caption': 5, 'picture_caption': 0, 'two_content': 6,
        'title_only': 0, 'quote': 0, 'big_number': 3,
        'process': 6, 'pyramid': 5,
    }
    return defaults.get(bp.layout_type, 6)


# ---------------------------------------------------------------------------
# Variant builders
# ---------------------------------------------------------------------------

def _build_cards(
    variant: CardsVariant,
    content: RectSpec | None,
    item_count: int,
    mx: float,
    per_card_h: float | None = None,
) -> CardsSpec | None:
    if content is None:
        return None
    cols = variant.columns
    eff_items = max(item_count, 1)
    rows = max(math.ceil(eff_items / cols), 1)
    # Use floor to prevent cumulative rounding from exceeding content width
    card_w = math.floor(((content.w - (cols - 1) * variant.gap_x) / cols) * 100) / 100
    # Clamp: ensure last card's right edge does not exceed content area
    last_right = content.x + (cols - 1) * (card_w + variant.gap_x) + card_w
    max_right = round(content.x + content.w, 4)
    if last_right > max_right + 0.01:
        card_w = round((content.w - (cols - 1) * variant.gap_x) / cols - 0.01, 2)
    if per_card_h is not None and per_card_h > 0:
        card_h = round(per_card_h, 2)
    else:
        card_h = round((content.h - (rows - 1) * variant.gap_y) / rows, 2)
    return CardsSpec(
        columns=cols,
        card_w=card_w,
        card_h=max(card_h, 0.5),
        start_x=content.x,
        start_y=content.y,
        gap_x=variant.gap_x,
        gap_y=variant.gap_y,
        pattern=variant.pattern,
        icon_size=variant.icon_size,
        header_band_h=variant.header_band_h,
        header_icon_count=variant.header_icon_count,
    )


def _build_stats(
    variant: StatsVariant,
    content: RectSpec | None,
    cw: float,
    mx: float,
) -> StatsSpec | None:
    if content is None:
        return None
    cols = variant.columns
    # Use floor to prevent cumulative rounding from exceeding content width
    box_w = math.floor(((content.w - (cols - 1) * variant.gap_x) / cols) * 100) / 100
    # Clamp: ensure last box's right edge does not exceed content area
    last_right = content.x + (cols - 1) * (box_w + variant.gap_x) + box_w
    max_right = round(content.x + content.w, 4)
    if last_right > max_right + 0.01:
        box_w = round((content.w - (cols - 1) * variant.gap_x) / cols - 0.01, 2)
    return StatsSpec(
        start_x=content.x,
        start_y=content.y,
        box_w=box_w,
        box_h=round(content.h, 2),
        gap_x=variant.gap_x,
    )


def _build_timeline(
    variant: TimelineVariant,
    content: RectSpec | None,
    item_count: int,
) -> TimelineSpec | None:
    if content is None:
        return None
    eff_items = max(item_count, 1)
    step_y = round(content.h / eff_items, 4)
    return TimelineSpec(
        line_x=variant.line_x,
        line_y=content.y,
        line_h=round(content.h, 2),
        dot_x=variant.dot_x,
        dot_size=variant.dot_size,
        start_y=round(content.y - 0.04, 4),
        step_y=step_y,
        text_x=variant.text_x,
        text_w=round(content.w - (variant.text_x - content.x), 2),
    )


def _build_comparison(
    variant: ComparisonVariant,
    content: RectSpec | None,
    mx: float,
) -> ComparisonSpec | None:
    if content is None:
        return None
    # Use floor to prevent cumulative rounding from exceeding content width
    half_w = math.floor(((content.w - variant.gap_x) / 2) * 100) / 100
    right_x = round(content.x + half_w + variant.gap_x, 2)
    # Clamp right half width so it doesn't exceed content area
    right_w = min(half_w, round(content.x + content.w - right_x, 2))
    return ComparisonSpec(
        left=RectSpec(content.x, content.y, half_w, content.h),
        right=RectSpec(right_x, content.y, right_w, content.h),
    )
