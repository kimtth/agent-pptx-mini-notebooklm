"""Parameterized design style configuration for the deterministic slide renderer.

Each ``StyleConfig`` instance captures the visual decisions consumed by the
renderer. Named presets map from the design-style catalogue
(``src/domain/design-styles.ts``) to tested configurations so different styles
produce *visually distinct* PPTX output while sharing a common render pipeline.

Usage
-----
>>> from style_config import resolve_style_config
>>> cfg = resolve_style_config("Swiss International", "solid")
>>> cfg.title_accent_bar
True
"""

from __future__ import annotations

from dataclasses import dataclass, replace


def _hex_luminance(hex_color: str) -> float:
    value = (hex_color or "000000").strip().lstrip("#")[:6].ljust(6, "0")
    r = int(value[0:2], 16) / 255.0
    g = int(value[2:4], 16) / 255.0
    b = int(value[4:6], 16) / 255.0
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


# ── Composition & validation layers ────────────────────────────────────

@dataclass(frozen=True)
class StyleLayoutPolicy:
    """Composition and geometry intent consumed by the renderer.

    These values express the style's spatial intent — how content should be
    arranged and spaced.  They influence grid subdivision, gap multipliers,
    and hero sizing during rendering.
    """

    composition_mode: str = "balanced"
    """Primary spatial pattern.

    ``balanced`` — uniform weight distribution (default).
    ``asymmetric`` — intentional size variation between elements.
    ``split`` — strict two-panel division.
    ``editorial`` — generous margins with typographic hierarchy.
    ``centered`` — focal point at slide center.
    """

    hero_emphasis: float = 1.0
    """Multiplier for hero/image prominence (>1 = larger hero zone)."""

    card_pattern: str = "standard"
    """Card/grid subdivision mode.

    ``standard`` — uniform cells with equal gaps (default).
    ``staggered`` — offset or variable cell sizes.
    ``bento`` — asymmetric grid (some cells span rows/cols).
    ``mosaic`` — irregular fill (full coverage, varied sizes).
    """

    alignment_bias: str = "left"
    """Primary content alignment: ``left`` | ``center`` | ``mixed``."""

    overlap_mode: str = "none"
    """Intentional overlap tolerance.

    ``none`` — strict separation (default).
    ``subtle`` — minor decorative overlaps OK.
    ``aggressive`` — significant overlapping shapes expected.
    """

    whitespace_bias: str = "normal"
    """Whitespace treatment beyond ``content_density``.

    ``tight`` — minimal margins, maximize content area.
    ``normal`` — standard spacing (default).
    ``generous`` — wide margins, ≥40 % whitespace.
    ``editorial`` — generous margins with asymmetric distribution.
    """


@dataclass(frozen=True)
class StyleGuardrails:
    """Avoid and validation rules consumed by the layout validator.

    These flags trigger additional validation checks specific to the
    style's design language.  Violations produce warnings (not errors)
    to guide rendering toward the intended aesthetic.
    """

    forbid_uniform_grid: bool = False
    """Warn if all cards/cells are exactly equal-sized (want variation)."""

    forbid_centered_titles: bool = False
    """Warn if title is centered when style prefers left/edge alignment."""

    forbid_heavy_borders: bool = False
    """Warn if any border exceeds 2 pt (style prefers thin/no borders)."""

    require_overlay_on_image_text: bool = False
    """Warn if text is placed on image area without a legibility overlay."""

    max_decorative_elements: int = 10
    """Warn if more than *N* ``design_`` shapes are placed."""

    min_text_contrast: float = 4.5
    """Minimum WCAG contrast ratio between text and background."""


@dataclass(frozen=True)
class StyleConfig:
    """Complete set of visual parameters for the slide renderer."""

    # ── Title / Header ──────────────────────────────────────────────
    title_accent_bar: bool = False
    """Thin vertical bar to the left of the title."""
    title_accent_rule: bool = False
    """Thin horizontal rule above the title."""
    title_centered: bool = False
    """Center-align title text on title/section/closing slides."""
    title_font_scale: float = 1.0
    """Multiplied against the base title font size."""

    # ── Key-message band ────────────────────────────────────────────
    key_message_band: bool = False
    """Semi-transparent background band behind the key-message text."""
    key_message_band_opacity: float = 0.10
    """Opacity for the key-message band (0 = fully transparent)."""

    # ── Panel / textbox fills ───────────────────────────────────────
    panel_fill: str = "transparent"
    """Panel fill mode: ``transparent`` | ``tinted`` | ``solid`` | ``frosted``."""
    panel_fill_opacity: float = 0.85
    """Opacity applied when ``panel_fill`` is not ``transparent``."""
    panel_border: bool = True
    """Draw a thin border around panels/cards."""
    panel_border_weight_pt: float = 1.0
    """Border line width in points."""
    panel_stripe: bool = False
    """Thin vertical color stripe on the left edge of each panel."""
    panel_shadow: str = "none"
    """Panel shadow mode: ``none`` | ``hard`` | ``accent``."""

    # ── Decorative shapes ───────────────────────────────────────────
    decorative_circle: bool = False
    """Small hollow circle near the bottom-right corner."""
    decorative_blob: bool = False
    """Organic background blob (reserved for future use)."""
    background_grid: str = "none"
    """Background grid mode: ``none`` | ``fine`` | ``perspective``."""
    frame_outline: str = "none"
    """Slide frame mode: ``none`` | ``single`` | ``double``."""
    corner_brackets: bool = False
    """Add angular corner bracket marks around the primary content zone."""
    accent_rings: bool = False
    """Add concentric outline rings as a signature object."""

    # ── Color treatment ─────────────────────────────────────────────
    color_treatment: str = "solid"
    """``solid`` | ``gradient`` | ``mixed``."""
    gradient_angle: int = 35
    """Angle (degrees) for gradient fills."""

    text_box_corner_style: str = "square"
    """``square`` | ``rounded``."""

    # ── Bullet markers ──────────────────────────────────────────────
    bullet_marker: str = "\u2022"
    """Default bullet character.  Common: ``•`` ``—`` ``✔`` ``▸`` ``‣``."""
    bullet_marker_bold: bool = True
    """Render the bullet marker in bold."""

    # ── Spacing ─────────────────────────────────────────────────────
    content_density: str = "normal"
    """``compact`` | ``normal`` | ``spacious``."""

    # ── Dark mode ───────────────────────────────────────────────────
    dark_mode: bool = False
    """Hint for fill colors: swap BG↔TEXT roles when True."""

    # ── Style background fallback ──────────────────────────────────
    bg_colors: tuple[str, ...] = ()
    """Fallback background gradient stops (6-char HEX without ``#``).

    Single value → solid fill.  Multiple values → linear gradient.
    Empty tuple → use theme BG.  First element is used for contrast
    calculations when more than one stop is provided.
    """

    # ── Signature decorative elements ──────────────────────────────
    rainbow_stripe_bars: bool = False
    """Full-spectrum rainbow bars at top and bottom of the slide."""
    sparkle_stars: bool = False
    """Small star/sparkle motifs in corners (✦ ★)."""
    scan_lines: bool = False
    """Thin horizontal scan-line overlay across the slide."""

    # ── Composition & validation layers ────────────────────────────────
    layout_policy: StyleLayoutPolicy = StyleLayoutPolicy()
    """Composition / geometry hints consumed by the renderer."""
    guardrails: StyleGuardrails = StyleGuardrails()
    """Avoid / validation rules consumed by the layout validator."""


# ── Preset catalogue ────────────────────────────────────────────────
# Keys MUST be lower-cased versions of ``DesignStyle`` values
# from ``src/domain/design-styles.ts``.

STYLE_PRESETS: dict[str, StyleConfig] = {
    # ── Foundation ──
    "blank white": StyleConfig(),
    "blank dark": StyleConfig(dark_mode=True),

    # ── Named Styles ──
    "glassmorphism": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.78,
        panel_border=True,
        panel_border_weight_pt=0.8,
        key_message_band=True,
        key_message_band_opacity=0.12,
        decorative_blob=True,
        color_treatment="gradient",
        gradient_angle=135,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("1A1A4E", "6B21A8", "1E3A5F"),
        layout_policy=StyleLayoutPolicy(
            composition_mode="asymmetric",
            card_pattern="staggered",
            overlap_mode="subtle",
        ),
        guardrails=StyleGuardrails(forbid_heavy_borders=True),
    ),
    "neo-brutalism": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=1.0,
        panel_border=True,
        panel_border_weight_pt=3.0,
        panel_shadow="hard",
        panel_stripe=False,
        title_font_scale=1.15,
        bullet_marker="\u25CF",  # ●
        content_density="compact",
        bg_colors=("F5F500",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="asymmetric",
            overlap_mode="aggressive",
        ),
    ),
    "bento grid": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=False,
        bullet_marker="\u2022",  # •
        bg_colors=("F8F8F2",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="asymmetric",
            card_pattern="bento",
        ),
        guardrails=StyleGuardrails(forbid_uniform_grid=True),
    ),
    "dark academia": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=False,
        title_accent_rule=True,
        bullet_marker="\u2014",  # —
        dark_mode=True,
        content_density="spacious",
        bg_colors=("1A1208",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
            whitespace_bias="editorial",
        ),
        guardrails=StyleGuardrails(max_decorative_elements=5),
    ),
    "gradient mesh": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.75,
        panel_border=False,
        color_treatment="gradient",
        gradient_angle=45,
        decorative_blob=True,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("FF6EC7", "7B61FF", "00D4FF"),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
            hero_emphasis=1.1,
        ),
        guardrails=StyleGuardrails(forbid_heavy_borders=True),
    ),
    "claymorphism": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.95,
        panel_border=True,
        panel_border_weight_pt=0.6,
        panel_shadow="accent",
        bullet_marker="\u2022",  # •
        content_density="spacious",
        bg_colors=("FFECD2", "FCB69F"),
        layout_policy=StyleLayoutPolicy(card_pattern="staggered"),
    ),
    "swiss international": StyleConfig(
        title_accent_bar=True,
        title_accent_rule=True,
        panel_fill="transparent",
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=True,
        decorative_circle=True,
        bullet_marker="\u2014",  # —
        bg_colors=("FFFFFF",),
        guardrails=StyleGuardrails(
            forbid_centered_titles=True,
            forbid_heavy_borders=True,
            max_decorative_elements=4,
        ),
    ),
    "aurora neon glow": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.70,
        panel_border=True,
        panel_border_weight_pt=0.6,
        key_message_band=True,
        key_message_band_opacity=0.15,
        decorative_blob=True,
        accent_rings=True,
        color_treatment="gradient",
        gradient_angle=60,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("050510",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
        ),
    ),
    "retro y2k": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.90,
        panel_border=True,
        panel_border_weight_pt=2.5,
        panel_shadow="accent",
        accent_rings=True,
        title_font_scale=1.1,
        bullet_marker="\u2605",  # ★
        dark_mode=True,
        rainbow_stripe_bars=True,
        sparkle_stars=True,
        bg_colors=("000080",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
        ),
    ),
    "nordic minimalism": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.90,
        panel_border=False,
        bullet_marker="\u2022",  # •
        content_density="spacious",
        bg_colors=("F4F1EC",),
        layout_policy=StyleLayoutPolicy(whitespace_bias="generous"),
        guardrails=StyleGuardrails(
            forbid_heavy_borders=True,
            max_decorative_elements=5,
        ),
    ),
    "typographic bold": StyleConfig(
        panel_fill="transparent",
        panel_border=False,
        title_font_scale=1.25,
        title_accent_bar=True,
        title_accent_rule=True,
        bullet_marker="\u2014",  # —
        bg_colors=("F0EDE8",),
        layout_policy=StyleLayoutPolicy(hero_emphasis=0.8),
        guardrails=StyleGuardrails(max_decorative_elements=3),
    ),
    "duotone color split": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=1.0,
        panel_border=False,
        color_treatment="gradient",
        gradient_angle=0,
        bullet_marker="\u25CF",  # ●
        dark_mode=True,
        bg_colors=("FF4500", "1A1A2E"),
        layout_policy=StyleLayoutPolicy(composition_mode="split"),
    ),
    "monochrome minimal": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=0.5,
        frame_outline="single",
        accent_rings=True,
        title_accent_rule=True,
        bullet_marker="\u2014",  # —
        content_density="spacious",
        bg_colors=("FAFAFA",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
            whitespace_bias="generous",
        ),
        guardrails=StyleGuardrails(
            forbid_heavy_borders=True,
            max_decorative_elements=4,
        ),
    ),
    "cyberpunk outline": StyleConfig(
        panel_fill="transparent",
        panel_border=True,
        panel_border_weight_pt=1.5,
        background_grid="fine",
        corner_brackets=True,
        title_accent_bar=True,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("0D0D0D",),
        guardrails=StyleGuardrails(forbid_centered_titles=True),
    ),
    "editorial magazine": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=False,
        title_accent_rule=True,
        title_font_scale=1.1,
        bullet_marker="\u2014",  # —
        content_density="spacious",
        bg_colors=("FFFFFF",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="editorial",
            whitespace_bias="editorial",
        ),
        guardrails=StyleGuardrails(forbid_centered_titles=True),
    ),
    "pastel soft ui": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=0.5,
        panel_shadow="accent",
        bullet_marker="\u2022",  # •
        bg_colors=("FCE4F3", "E8F4FF", "F0FCE4"),
        layout_policy=StyleLayoutPolicy(card_pattern="staggered"),
        guardrails=StyleGuardrails(forbid_heavy_borders=True),
    ),
    "dark neon miami": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.72,
        panel_border=True,
        panel_border_weight_pt=1.2,
        decorative_blob=True,
        background_grid="perspective",
        color_treatment="gradient",
        gradient_angle=90,
        key_message_band=True,
        key_message_band_opacity=0.18,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("0A0014",),
    ),
    "hand-crafted organic": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.85,
        panel_border=False,
        decorative_blob=True,
        bullet_marker="\u2023",  # ‣
        content_density="spacious",
        bg_colors=("FDF6EE",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="editorial",
            whitespace_bias="editorial",
        ),
    ),
    "isometric 3d flat": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=1.0,
        panel_shadow="hard",
        bullet_marker="\u25CF",  # ●
        dark_mode=True,
        bg_colors=("1E1E2E",),
    ),
    "vaporwave": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.75,
        panel_border=True,
        panel_border_weight_pt=1.0,
        background_grid="perspective",
        accent_rings=True,
        color_treatment="gradient",
        gradient_angle=180,
        bullet_marker="\u2605",  # ★
        dark_mode=True,
        scan_lines=True,
        bg_colors=("1A0533", "2D0057", "570038"),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
        ),
    ),
    "art deco luxe": StyleConfig(
        panel_fill="transparent",
        panel_border=True,
        panel_border_weight_pt=2.0,
        frame_outline="double",
        title_accent_rule=True,
        title_font_scale=1.1,
        bullet_marker="\u25C6",  # ◆
        dark_mode=True,
        content_density="spacious",
        bg_colors=("0E0A05",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
            whitespace_bias="generous",
        ),
    ),
    "brutalist newspaper": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.95,
        panel_border=True,
        panel_border_weight_pt=2.5,
        title_accent_rule=True,
        title_font_scale=1.2,
        bullet_marker="\u25A0",  # ■
        bg_colors=("F2EFE8",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="editorial",
            whitespace_bias="tight",
        ),
        guardrails=StyleGuardrails(forbid_centered_titles=True),
    ),
    "stained glass mosaic": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=1.5,
        color_treatment="gradient",
        gradient_angle=120,
        bullet_marker="\u25C6",  # ◆
        dark_mode=True,
        bg_colors=("0A0A12",),
        layout_policy=StyleLayoutPolicy(
            card_pattern="mosaic",
            whitespace_bias="tight",
        ),
        guardrails=StyleGuardrails(require_overlay_on_image_text=True),
    ),
    "liquid blob morphing": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.78,
        panel_border=False,
        decorative_blob=True,
        color_treatment="gradient",
        gradient_angle=60,
        bullet_marker="\u2022",  # •
        dark_mode=True,
        bg_colors=("0F2027", "203A43", "2C5364"),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            overlap_mode="subtle",
        ),
    ),
    "memphis pop pattern": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.90,
        panel_border=True,
        panel_border_weight_pt=2.0,
        title_font_scale=1.1,
        decorative_circle=True,
        bullet_marker="\u25CF",  # ●
        bg_colors=("FFF5E0",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="asymmetric",
            overlap_mode="aggressive",
            alignment_bias="mixed",
        ),
        guardrails=StyleGuardrails(
            forbid_uniform_grid=True,
            max_decorative_elements=15,
        ),
    ),
    "dark forest nature": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.82,
        panel_border=False,
        bullet_marker="\u2023",  # ‣
        dark_mode=True,
        content_density="spacious",
        bg_colors=("0D2B14", "060E08"),
        layout_policy=StyleLayoutPolicy(
            composition_mode="editorial",
            whitespace_bias="editorial",
        ),
        guardrails=StyleGuardrails(require_overlay_on_image_text=True),
    ),
    "architectural blueprint": StyleConfig(
        panel_fill="transparent",
        panel_border=True,
        panel_border_weight_pt=1.0,
        background_grid="fine",
        frame_outline="single",
        corner_brackets=True,
        title_accent_bar=True,
        title_accent_rule=True,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("0D2240",),
    ),
    "maximalist collage": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=2.0,
        title_font_scale=1.15,
        bullet_marker="\u25CF",  # ●
        bg_colors=("E8DDD0",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="asymmetric",
            overlap_mode="aggressive",
            alignment_bias="mixed",
        ),
        guardrails=StyleGuardrails(
            forbid_uniform_grid=True,
            max_decorative_elements=15,
        ),
    ),
    "scifi holographic data": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.68,
        panel_border=True,
        panel_border_weight_pt=0.8,
        key_message_band=True,
        key_message_band_opacity=0.12,
        accent_rings=True,
        background_grid="fine",
        color_treatment="gradient",
        gradient_angle=45,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        bg_colors=("03050D",),
        layout_policy=StyleLayoutPolicy(
            composition_mode="centered",
            alignment_bias="center",
        ),
    ),
    "risograph print": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.85,
        panel_border=False,
        title_accent_rule=True,
        bullet_marker="\u25A0",  # ■
        bg_colors=("F7F2E8",),
        layout_policy=StyleLayoutPolicy(
            overlap_mode="subtle",
            alignment_bias="center",
        ),
    ),
    # ── Template Motifs ──
    "editorial split hero": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.85,
        panel_border=True,
        panel_border_weight_pt=0.8,
        title_accent_rule=True,
        title_font_scale=1.15,
        bullet_marker="\u2014",  # —
        layout_policy=StyleLayoutPolicy(
            composition_mode="split",
            hero_emphasis=1.2,
        ),
    ),
    "diagonal block narrative": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.92,
        panel_border=False,
        color_treatment="gradient",
        gradient_angle=35,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
        layout_policy=StyleLayoutPolicy(composition_mode="asymmetric"),
        guardrails=StyleGuardrails(forbid_uniform_grid=True),
    ),
    "kpi dashboard strip": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.90,
        panel_border=True,
        panel_border_weight_pt=0.5,
        panel_stripe=True,
        bullet_marker="\u2022",  # •
        layout_policy=StyleLayoutPolicy(whitespace_bias="tight"),
    ),
    "geometric proposal grid": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=True,
        background_grid="fine",
        bullet_marker="\u25B8",  # ▸
        layout_policy=StyleLayoutPolicy(card_pattern="bento"),
    ),
    "accent monochrome focus": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.80,
        panel_border=False,
        frame_outline="single",
        title_accent_bar=True,
        title_centered=True,
        bullet_marker="\u2014",  # —
        content_density="spacious",
        layout_policy=StyleLayoutPolicy(whitespace_bias="generous"),
    ),
    "process timeline ribbon": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=True,
        bullet_marker="\u25B8",  # ▸
    ),
    "organic editorial canvas": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.82,
        panel_border=False,
        title_accent_rule=True,
        bullet_marker="\u2023",  # ‣
        content_density="spacious",
        layout_policy=StyleLayoutPolicy(
            composition_mode="editorial",
            whitespace_bias="editorial",
            overlap_mode="subtle",
        ),
    ),
    # ── Custom ──
    "custom template": StyleConfig(),
}


def resolve_style_config(
    design_style: str,
    color_treatment: str = "",
    text_box_corner_style: str = "",
    custom_background_color: str = "",
) -> StyleConfig:
    """Resolve a style name + overrides into a concrete ``StyleConfig``.

    Parameters
    ----------
    design_style
        The design-style name from the UI (case-insensitive).
    color_treatment
        UI override: ``solid``, ``gradient``, or ``mixed``.
        Wins over the preset's default.
    text_box_corner_style
        UI override: ``square`` or ``rounded``.
        Wins over the preset's default.
    """
    key = design_style.strip().lower() if design_style else ""
    base = STYLE_PRESETS.get(key, StyleConfig())

    # Palette settings always win over preset defaults.  The palette is the
    # single source of truth for user-facing controls; named presets only
    # provide fallback values for settings the user has not explicitly set.
    overrides: dict[str, object] = {}
    if color_treatment and color_treatment in ("solid", "gradient", "mixed"):
        overrides["color_treatment"] = color_treatment

    if text_box_corner_style and text_box_corner_style in ("square", "rounded"):
        overrides["text_box_corner_style"] = text_box_corner_style

    if key == "blank custom color":
        cleaned = custom_background_color.strip().lstrip("#").upper()
        if len(cleaned) == 6 and all(ch in "0123456789ABCDEF" for ch in cleaned):
            overrides["bg_colors"] = (cleaned,)
            overrides["dark_mode"] = _hex_luminance(cleaned) < 0.45

    return replace(base, **overrides) if overrides else base
