"""Parameterized design style configuration for the deterministic slide renderer.

Each ``StyleConfig`` instance captures every visual decision that the old
LLM-generated renderer code used to hardcode.  Named presets map from the
design-style catalogue (``src/domain/design-styles.ts``) to tested
configurations so that different styles produce *visually distinct* PPTX
output — something the old prompt-based approach failed to achieve.

Usage
-----
>>> from style_config import resolve_style_config
>>> cfg = resolve_style_config("Swiss International", "solid", "plain")
>>> cfg.title_accent_bar
True
"""

from __future__ import annotations

from dataclasses import dataclass, replace


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

    # ── Text-box style ──────────────────────────────────────────────
    text_box_style: str = "plain"
    """``plain`` | ``with-icons`` | ``mixed``."""

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

    # ── Signature decorative elements ──────────────────────────────
    rainbow_stripe_bars: bool = False
    """Full-spectrum rainbow bars at top and bottom of the slide."""
    sparkle_stars: bool = False
    """Small star/sparkle motifs in corners (✦ ★)."""
    scan_lines: bool = False
    """Thin horizontal scan-line overlay across the slide."""


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
        text_box_style="mixed",
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
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
        text_box_style="with-icons",
        content_density="compact",
    ),
    "bento grid": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=False,
        text_box_style="with-icons",
        bullet_marker="\u2022",  # •
    ),
    "dark academia": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=False,
        title_accent_rule=True,
        bullet_marker="\u2014",  # —
        dark_mode=True,
        content_density="spacious",
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
    ),
    "claymorphism": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.95,
        panel_border=True,
        panel_border_weight_pt=0.6,
        panel_shadow="accent",
        text_box_style="with-icons",
        bullet_marker="\u2022",  # •
        content_density="spacious",
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
        text_box_style="plain",
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
        text_box_style="with-icons",
        dark_mode=True,
        rainbow_stripe_bars=True,
        sparkle_stars=True,
    ),
    "nordic minimalism": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.90,
        panel_border=False,
        bullet_marker="\u2022",  # •
        content_density="spacious",
        text_box_style="plain",
    ),
    "typographic bold": StyleConfig(
        panel_fill="transparent",
        panel_border=False,
        title_font_scale=1.25,
        title_accent_bar=True,
        title_accent_rule=True,
        bullet_marker="\u2014",  # —
        text_box_style="plain",
    ),
    "duotone color split": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=1.0,
        panel_border=False,
        color_treatment="gradient",
        gradient_angle=0,
        bullet_marker="\u25CF",  # ●
        dark_mode=True,
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
        text_box_style="plain",
        content_density="spacious",
    ),
    "cyberpunk outline": StyleConfig(
        panel_fill="transparent",
        panel_border=True,
        panel_border_weight_pt=1.5,
        background_grid="fine",
        corner_brackets=True,
        title_accent_bar=True,
        bullet_marker="\u25B8",  # ▸
        text_box_style="with-icons",
        dark_mode=True,
    ),
    "editorial magazine": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=False,
        title_accent_rule=True,
        title_font_scale=1.1,
        bullet_marker="\u2014",  # —
        text_box_style="plain",
        content_density="spacious",
    ),
    "pastel soft ui": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=0.5,
        panel_shadow="accent",
        bullet_marker="\u2022",  # •
        text_box_style="with-icons",
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
    ),
    "hand-crafted organic": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.85,
        panel_border=False,
        decorative_blob=True,
        bullet_marker="\u2023",  # ‣
        text_box_style="plain",
        content_density="spacious",
    ),
    "isometric 3d flat": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=1.0,
        panel_shadow="hard",
        text_box_style="with-icons",
        bullet_marker="\u25CF",  # ●
        dark_mode=True,
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
    ),
    "brutalist newspaper": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.95,
        panel_border=True,
        panel_border_weight_pt=2.5,
        title_accent_rule=True,
        title_font_scale=1.2,
        bullet_marker="\u25A0",  # ■
        text_box_style="plain",
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
    ),
    "memphis pop pattern": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.90,
        panel_border=True,
        panel_border_weight_pt=2.0,
        title_font_scale=1.1,
        decorative_circle=True,
        text_box_style="with-icons",
        bullet_marker="\u25CF",  # ●
    ),
    "dark forest nature": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.82,
        panel_border=False,
        bullet_marker="\u2023",  # ‣
        dark_mode=True,
        content_density="spacious",
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
        text_box_style="plain",
        dark_mode=True,
    ),
    "maximalist collage": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.92,
        panel_border=True,
        panel_border_weight_pt=2.0,
        title_font_scale=1.15,
        text_box_style="with-icons",
        bullet_marker="\u25CF",  # ●
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
        text_box_style="with-icons",
        dark_mode=True,
    ),
    "risograph print": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.85,
        panel_border=False,
        title_accent_rule=True,
        bullet_marker="\u25A0",  # ■
        text_box_style="plain",
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
        text_box_style="plain",
    ),
    "diagonal block narrative": StyleConfig(
        panel_fill="solid",
        panel_fill_opacity=0.92,
        panel_border=False,
        color_treatment="gradient",
        gradient_angle=35,
        bullet_marker="\u25B8",  # ▸
        dark_mode=True,
    ),
    "kpi dashboard strip": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.90,
        panel_border=True,
        panel_border_weight_pt=0.5,
        panel_stripe=True,
        bullet_marker="\u2022",  # •
        text_box_style="plain",
    ),
    "geometric proposal grid": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=True,
        background_grid="fine",
        bullet_marker="\u25B8",  # ▸
        text_box_style="with-icons",
    ),
    "accent monochrome focus": StyleConfig(
        panel_fill="frosted",
        panel_fill_opacity=0.80,
        panel_border=False,
        frame_outline="single",
        title_accent_bar=True,
        title_centered=True,
        bullet_marker="\u2014",  # —
        text_box_style="plain",
        content_density="spacious",
    ),
    "process timeline ribbon": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.88,
        panel_border=True,
        panel_border_weight_pt=0.8,
        panel_stripe=True,
        bullet_marker="\u25B8",  # ▸
        text_box_style="with-icons",
    ),
    "organic editorial canvas": StyleConfig(
        panel_fill="tinted",
        panel_fill_opacity=0.82,
        panel_border=False,
        title_accent_rule=True,
        bullet_marker="\u2023",  # ‣
        text_box_style="plain",
        content_density="spacious",
    ),
    # ── Custom ──
    "custom template": StyleConfig(),
}


def resolve_style_config(
    design_style: str,
    color_treatment: str = "",
    text_box_style: str = "",
) -> StyleConfig:
    """Resolve a style name + overrides into a concrete ``StyleConfig``.

    Parameters
    ----------
    design_style
        The design-style name from the UI (case-insensitive).
    color_treatment
        UI override: ``solid``, ``gradient``, or ``mixed``.
        Wins over the preset's default.
    text_box_style
        UI override: ``plain``, ``with-icons``, or ``mixed``.
        Wins over the preset's default.
    """
    key = design_style.strip().lower() if design_style else ""
    base = STYLE_PRESETS.get(key, StyleConfig())

    # Only apply UI overrides when the user has NOT selected a named design
    # style.  Named presets already specify their own color_treatment and
    # text_box_style; overriding them with the UI's generic default ("mixed")
    # would flatten every preset to the same look.
    has_named_preset = key in STYLE_PRESETS and key not in ("", "blank white", "blank dark", "custom template")

    overrides: dict[str, object] = {}
    if not has_named_preset:
        if color_treatment and color_treatment in ("solid", "gradient", "mixed"):
            overrides["color_treatment"] = color_treatment
        if text_box_style and text_box_style in ("plain", "with-icons", "mixed"):
            overrides["text_box_style"] = text_box_style

    return replace(base, **overrides) if overrides else base
