"""Cross-platform font-metrics text measurement.

Uses Pillow (PIL) to measure text heights via actual TrueType font metrics
and glyph-level word wrapping.

Works on Windows, macOS, and Linux — no display server or PowerPoint required.
Only needs Pillow with the FreeType backend (standard in pip-installed Pillow).
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import re


# ---------------------------------------------------------------------------
# Shared data type for the layout engine and validator.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TextMeasureRequest:
    """A single text-measurement request."""
    text: str
    width_in: float
    font_family: str = 'Calibri'
    font_size_pt: float = 18.0
    bold: bool = False


# ---------------------------------------------------------------------------
# CJK detection (same logic as layout_specs._is_wide_char)
# ---------------------------------------------------------------------------

def _is_wide_char(cp: int) -> bool:
    """Return True for CJK, Kana, Hangul, and fullwidth characters."""
    return (
        (0x2E80 <= cp <= 0x9FFF)
        or (0xAC00 <= cp <= 0xD7AF)
        or (0xF900 <= cp <= 0xFAFF)
        or (0xFE30 <= cp <= 0xFE4F)
        or (0xFF01 <= cp <= 0xFF60)
        or (0x20000 <= cp <= 0x2FA1F)
    )


def _contains_wide_text(text: str) -> bool:
    return any(_is_wide_char(ord(ch)) for ch in text)


# ---------------------------------------------------------------------------
# Font resolution
# ---------------------------------------------------------------------------

@lru_cache(maxsize=64)
def _resolve_font_path(family: str, bold: bool) -> str | None:
    """Find the system font file path for a given family and weight."""
    family_lower = re.sub(r'[\s_\-]+', '', family.lower())

    def _normalise_font_stem(value: str) -> str:
        return re.sub(r'[\s_\-]+', '', value.lower())

    if sys.platform == 'win32':
        fonts_dir = Path(r'C:\Windows\Fonts')
        bold_suffix = 'b' if bold else ''
        candidates = [
            f'{family_lower}{bold_suffix}.ttf',
            f'{family_lower}{bold_suffix}.ttc',
        ]
        if bold:
            candidates.append(f'{family_lower}-bold.ttf')
        else:
            candidates.extend([
                f'{family_lower}-regular.ttf',
                f'{family_lower}.ttf',
                f'{family_lower}.ttc',
            ])
        for name in candidates:
            p = fonts_dir / name
            if p.exists():
                return str(p)

        # Variable fonts and many CJK families don't follow the simple
        # ``family[-bold].ttf`` naming convention (e.g. ``NotoSansJP-VF.ttf``).
        # Search the installed font list by normalised stem so we resolve the
        # real file rather than falling back to a family-name alias.
        matching: list[Path] = []
        for pattern in ('*.ttf', '*.ttc', '*.otf'):
            for p in fonts_dir.glob(pattern):
                stem = _normalise_font_stem(p.stem)
                if family_lower in stem or stem in family_lower:
                    matching.append(p)
        if matching:
            if bold:
                weighted = [
                    p for p in matching
                    if any(token in _normalise_font_stem(p.stem) for token in ('bold', 'black', 'heavy', 'semibold'))
                ]
                if weighted:
                    return str(weighted[0])
            regular = [
                p for p in matching
                if not any(token in _normalise_font_stem(p.stem) for token in ('bold', 'black', 'heavy'))
            ]
            if regular:
                return str(regular[0])
            return str(matching[0])

    elif sys.platform == 'darwin':
        font_dirs = [
            Path('/Library/Fonts'),
            Path('/System/Library/Fonts'),
            Path('/System/Library/Fonts/Supplemental'),
            Path.home() / 'Library' / 'Fonts',
        ]
        for d in font_dirs:
            if not d.exists():
                continue
            for p in d.iterdir():
                if p.suffix.lower() not in ('.ttf', '.otf', '.ttc'):
                    continue
                stem = p.stem.lower().replace(' ', '').replace('-', '')
                if family_lower not in stem:
                    continue
                if bold and 'bold' in stem:
                    return str(p)
                if not bold and 'bold' not in stem:
                    return str(p)

    else:
        # Linux: use fc-match
        try:
            style = 'Bold' if bold else 'Regular'
            result = subprocess.run(
                ['fc-match', '--format=%{file}', f'{family}:style={style}'],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                path = result.stdout.strip()
                if Path(path).exists():
                    return path
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    return None


def _platform_cjk_fallback_families() -> list[str]:
    if sys.platform == 'win32':
        return [
            'Yu Gothic UI',
            'Yu Gothic',
            'Meiryo',
            'Malgun Gothic',
            'Microsoft JhengHei UI',
            'Microsoft JhengHei',
            'Microsoft YaHei UI',
            'Microsoft YaHei',
            'Noto Sans JP',
            'Noto Sans CJK JP',
        ]
    if sys.platform == 'darwin':
        return ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Apple SD Gothic Neo', 'PingFang SC']
    return ['Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans CJK KR', 'Noto Sans CJK SC']


@lru_cache(maxsize=128)
def _resolve_measurement_family(family: str, bold: bool, contains_wide_text: bool) -> str:
    if not contains_wide_text:
        return family

    family_path = _resolve_font_path(family, bold) or _resolve_font_path(family, False)
    if family_path:
        stem = Path(family_path).stem.lower()
        if any(token in stem for token in ('gothic', 'meiryo', 'malgun', 'yahei', 'jhenghei', 'hiragino', 'pingfang', 'noto')):
            return family

    for candidate in _platform_cjk_fallback_families():
        if _resolve_font_path(candidate, bold) or _resolve_font_path(candidate, False):
            return candidate

    return family


@lru_cache(maxsize=128)
def _load_font(family: str, size_pt: float, bold: bool, contains_wide_text: bool = False):
    """Load a Pillow font for the given family, size, and weight."""
    from PIL import ImageFont

    size = int(round(size_pt))
    resolved_family = _resolve_measurement_family(family, bold, contains_wide_text)

    # Prefer the concrete font file when we can resolve it. Family-name aliases
    # on Windows can load a different face that underestimates CJK wrapping.
    font_path = _resolve_font_path(resolved_family, bold)
    if font_path:
        try:
            return ImageFont.truetype(font_path, size=size)
        except (OSError, IOError):
            pass

    # Try Pillow's built-in font-name resolution (works well on Windows)
    names: list[str] = []
    if bold:
        names.extend([f'{resolved_family} Bold', f'{resolved_family}-Bold'])
    names.append(resolved_family)

    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except (OSError, IOError):
            continue

    # Non-bold fallback when bold file isn't found
    if bold:
        font_path = _resolve_font_path(resolved_family, False)
        if font_path:
            try:
                return ImageFont.truetype(font_path, size=size)
            except (OSError, IOError):
                pass

    # Last resort: Pillow's default bitmap font
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        # Older Pillow versions don't accept a size parameter
        return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Text wrapping
# ---------------------------------------------------------------------------

def _wrap_text(text: str, font, max_width_px: float) -> str:
    """Wrap text to fit within *max_width_px*, handling Latin and CJK.

    - Latin text: breaks at word boundaries (spaces).
    - CJK text: breaks at any character boundary.
    - Mixed text: uses the appropriate strategy per character.
    """
    if not text or not text.strip():
        return ' '

    max_width_px = max(max_width_px, 10.0)
    result_lines: list[str] = []

    for paragraph in text.split('\n'):
        if not paragraph.strip():
            result_lines.append('')
            continue

        current_line = ''
        current_width = 0.0
        word_buf = ''
        word_width = 0.0

        for ch in paragraph:
            cp = ord(ch)

            if _is_wide_char(cp):
                # Flush any pending Latin word first
                if word_buf:
                    tw = current_width + word_width
                    if tw > max_width_px and current_line:
                        result_lines.append(current_line.rstrip())
                        current_line = word_buf
                        current_width = word_width
                    else:
                        current_line += word_buf
                        current_width = tw
                    word_buf = ''
                    word_width = 0.0

                # CJK: character-level breaking
                ch_w = font.getlength(ch)
                if current_width + ch_w > max_width_px and current_line:
                    result_lines.append(current_line.rstrip())
                    current_line = ch
                    current_width = ch_w
                else:
                    current_line += ch
                    current_width += ch_w

            elif ch == ' ':
                # Space: flush word buffer to current line
                if word_buf:
                    tw = current_width + word_width
                    if tw > max_width_px and current_line:
                        result_lines.append(current_line.rstrip())
                        current_line = word_buf
                        current_width = word_width
                    else:
                        current_line += word_buf
                        current_width = tw
                    word_buf = ''
                    word_width = 0.0

                sp_w = font.getlength(' ')
                current_line += ' '
                current_width += sp_w

            else:
                # Latin character: accumulate into word buffer
                word_buf += ch
                word_width = font.getlength(word_buf)

        # Flush remaining word
        if word_buf:
            tw = current_width + word_width
            if tw > max_width_px and current_line:
                result_lines.append(current_line.rstrip())
                current_line = word_buf
            else:
                current_line += word_buf

        if current_line:
            result_lines.append(current_line.rstrip())

    return '\n'.join(result_lines) if result_lines else ' '


# ---------------------------------------------------------------------------
# Measurement constants
# ---------------------------------------------------------------------------

# Render at 72 DPI so 1 pixel == 1 typographic point.
_DPI = 72

# PowerPoint textboxes have internal top + bottom padding not visible in
# text metrics.  Empirically calibrated against COM measurements.
_PPT_TEXTBOX_PADDING_IN = 0.10

# Extra inter-line spacing as a fraction of font_size_pt (pixels at 72 DPI).
# PowerPoint "single" line spacing ≈ 120% of font size; Pillow's natural
# line height (ascender + descender + leading) is typically 115–120%.
# This small bump aligns the two.
_PIL_LINE_SPACING_RATIO = 0.08


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def measure_text_heights(
    requests: list[TextMeasureRequest],
) -> list[float]:
    """Measure text heights using Pillow font metrics.

    Returns a list of heights (inches) in the same order as *requests*.
    """
    if not requests:
        return []

    from PIL import Image, ImageDraw

    dummy = Image.new('RGB', (1, 1))
    draw = ImageDraw.Draw(dummy)

    heights: list[float] = []
    for req in requests:
        text = req.text if req.text.strip() else ' '
        contains_wide_text = _contains_wide_text(text)
        font = _load_font(req.font_family, req.font_size_pt, req.bold, contains_wide_text)
        width_scale = 0.92 if contains_wide_text else 1.0
        max_width_px = req.width_in * _DPI * width_scale
        text = req.text if req.text.strip() else ' '

        wrapped = _wrap_text(text, font, max_width_px)
        spacing_ratio = _PIL_LINE_SPACING_RATIO + (0.08 if contains_wide_text else 0.0)
        spacing = int(round(req.font_size_pt * spacing_ratio))
        bbox = draw.multiline_textbbox(
            (0, 0), wrapped, font=font, spacing=spacing,
        )
        height_px = bbox[3] - bbox[1]
        padding_in = _PPT_TEXTBOX_PADDING_IN + (0.10 if contains_wide_text else 0.0)
        height_in = height_px / _DPI + padding_in

        heights.append(round(height_in, 4))

    return heights
