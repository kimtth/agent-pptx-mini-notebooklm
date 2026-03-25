"""Cross-platform font-metrics text measurement.

Uses Pillow (PIL) to measure text heights via actual TrueType font metrics
and glyph-level word wrapping.  Drop-in replacement for the PowerPoint COM
measurement in ``com_text_measure.py``.

Works on Windows, macOS, and Linux — no display server or PowerPoint required.
Only needs Pillow with the FreeType backend (standard in pip-installed Pillow).
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


# ---------------------------------------------------------------------------
# Shared data type (also imported by com_text_measure.py & hybrid_layout.py)
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


# ---------------------------------------------------------------------------
# Font resolution
# ---------------------------------------------------------------------------

@lru_cache(maxsize=64)
def _resolve_font_path(family: str, bold: bool) -> str | None:
    """Find the system font file path for a given family and weight."""
    family_lower = family.lower().replace(' ', '')

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


@lru_cache(maxsize=64)
def _load_font(family: str, size_pt: float, bold: bool):
    """Load a Pillow font for the given family, size, and weight."""
    from PIL import ImageFont

    size = int(round(size_pt))

    # Try Pillow's built-in font-name resolution (works well on Windows)
    names: list[str] = []
    if bold:
        names.extend([f'{family} Bold', f'{family}-Bold'])
    names.append(family)

    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except (OSError, IOError):
            continue

    # Try explicit path resolution (cross-platform)
    font_path = _resolve_font_path(family, bold)
    if font_path:
        try:
            return ImageFont.truetype(font_path, size=size)
        except (OSError, IOError):
            pass

    # Non-bold fallback when bold file isn't found
    if bold:
        font_path = _resolve_font_path(family, False)
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

    Drop-in replacement for ``com_text_measure.measure_text_heights``.
    Returns a list of heights (inches) in the same order as *requests*.
    """
    if not requests:
        return []

    from PIL import Image, ImageDraw

    dummy = Image.new('RGB', (1, 1))
    draw = ImageDraw.Draw(dummy)

    heights: list[float] = []
    for req in requests:
        font = _load_font(req.font_family, req.font_size_pt, req.bold)
        max_width_px = req.width_in * _DPI
        text = req.text if req.text.strip() else ' '

        wrapped = _wrap_text(text, font, max_width_px)
        spacing = int(round(req.font_size_pt * _PIL_LINE_SPACING_RATIO))
        bbox = draw.multiline_textbbox(
            (0, 0), wrapped, font=font, spacing=spacing,
        )
        height_px = bbox[3] - bbox[1]
        height_in = height_px / _DPI + _PPT_TEXTBOX_PADDING_IN

        heights.append(round(height_in, 4))

    return heights
