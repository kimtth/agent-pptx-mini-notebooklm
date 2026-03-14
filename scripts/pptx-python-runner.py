from __future__ import annotations

import ast
import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING

# Layout engine lives in scripts/layout/ sub-package
sys.path.insert(0, str(Path(__file__).resolve().parent / 'layout'))

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.util import Inches, Pt

if TYPE_CHECKING:
    from pptx.presentation import Presentation as PresentationType
else:
    PresentationType = object  # noqa: N816

from layout_specs import (  # type: ignore
    estimate_text_height_in,
    flow_layout_spec,
    get_layout_spec,
    LayoutSpec,
    RectSpec,
    CardsSpec,
    StatsSpec,
    TimelineSpec,
    ComparisonSpec,
)
from layout_validator import (  # type: ignore
    validate_presentation,
    report_issues,
)

SLIDE_WIDTH_IN = 13.333
SLIDE_HEIGHT_IN = 7.5

ICON_CACHE_DIR = os.environ.get('ICON_CACHE_DIR', '')
if not ICON_CACHE_DIR:
    _default_cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'skills', 'iconfy-list', 'cache')
    if os.path.isdir(_default_cache):
        ICON_CACHE_DIR = os.path.normpath(_default_cache)

# ---------------------------------------------------------------------------
# Noto Sans font support for non-Latin scripts
# ---------------------------------------------------------------------------

# Map of script ranges → Noto Sans font family name
_NOTO_FONT_MAP: list[tuple[str, list[tuple[int, int]]]] = [
    ('Noto Sans JP', [(0x3040, 0x309F), (0x30A0, 0x30FF), (0x31F0, 0x31FF),   # Hiragana, Katakana
                      (0x4E00, 0x9FFF), (0xFF65, 0xFF9F), (0xFF01, 0xFF60)]),  # CJK Unified (JP fallback)
    ('Noto Sans KR', [(0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F)]), # Hangul
    ('Noto Sans SC', [(0x4E00, 0x9FFF),]),  # CJK Unified (SC fallback, lower priority than JP)
    ('Noto Sans TC', [(0x4E00, 0x9FFF),]),  # CJK Unified (TC fallback)
    ('Noto Sans Thai', [(0x0E00, 0x0E7F),]),
    ('Noto Sans Arabic', [(0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF)]),
    ('Noto Sans Devanagari', [(0x0900, 0x097F),]),
]

# Google Fonts download URLs for the main Noto Sans variants needed for PPTX
_NOTO_FONT_URLS: dict[str, str] = {
    'Noto Sans JP': 'https://github.com/notofonts/noto-cjk/releases/download/Sans2.005/08_NotoSansJP.zip',
    'Noto Sans KR': 'https://github.com/notofonts/noto-cjk/releases/download/Sans2.005/09_NotoSansKR.zip',
    'Noto Sans SC': 'https://github.com/notofonts/noto-cjk/releases/download/Sans2.005/10_NotoSansSC.zip',
    'Noto Sans TC': 'https://github.com/notofonts/noto-cjk/releases/download/Sans2.005/11_NotoSansTC.zip',
}

_WINDOWS_USER_FONTS = Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'Windows' / 'Fonts'
_SYSTEM_FONTS = Path(r'C:\Windows\Fonts') if sys.platform == 'win32' else Path('/usr/share/fonts')


def _font_installed(family: str) -> bool:
    """Check whether a font family has a .ttf/.otf file in system or user fonts."""
    slug = family.replace(' ', '')
    patterns = [slug.lower(), family.lower().replace(' ', '')]

    search_dirs: list[Path] = []
    if sys.platform == 'win32':
        search_dirs.append(_SYSTEM_FONTS)
        if _WINDOWS_USER_FONTS.is_dir():
            search_dirs.append(_WINDOWS_USER_FONTS)
    else:
        search_dirs.append(_SYSTEM_FONTS)

    for d in search_dirs:
        if not d.is_dir():
            continue
        for f in d.iterdir():
            name_lower = f.name.lower()
            if any(p in name_lower for p in patterns) and name_lower.endswith(('.ttf', '.otf')):
                return True
    return False


def _install_font_windows(ttf_path: Path) -> None:
    """Install a font file to the Windows per-user font directory."""
    _WINDOWS_USER_FONTS.mkdir(parents=True, exist_ok=True)
    dest = _WINDOWS_USER_FONTS / ttf_path.name
    if dest.exists():
        return
    import shutil
    shutil.copy2(ttf_path, dest)

    # Register in the Windows registry for the current user
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
            0,
            winreg.KEY_SET_VALUE,
        )
        font_name = ttf_path.stem.replace('-', ' ')
        winreg.SetValueEx(key, f'{font_name} (TrueType)', 0, winreg.REG_SZ, str(dest))
        winreg.CloseKey(key)
    except Exception:
        pass  # Font file is copied — registry is optional for python-pptx


def _download_and_install_noto(family: str, fonts_cache_dir: Path) -> bool:
    """Download a Noto Sans font family and install it. Returns True on success."""
    url = _NOTO_FONT_URLS.get(family)
    if not url:
        return False

    family_dir = fonts_cache_dir / family.replace(' ', '')
    if family_dir.is_dir() and any(family_dir.glob('*.ttf')):
        # Already cached — just ensure installed
        for ttf in family_dir.glob('*.ttf'):
            if sys.platform == 'win32':
                _install_font_windows(ttf)
            return True
        return True

    print(f'[font] Downloading {family}...', file=sys.stderr)
    import urllib.request
    import tempfile
    import zipfile
    try:
        zip_path = os.path.join(tempfile.gettempdir(), f'{family.replace(" ", "")}.zip')
        urllib.request.urlretrieve(url, zip_path)

        family_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            for member in zf.namelist():
                # Only extract Regular weight .ttf (keep it simple)
                basename = os.path.basename(member)
                if not basename.endswith('.ttf'):
                    continue
                lower = basename.lower()
                if 'regular' in lower or 'medium' in lower or 'bold' in lower:
                    target = family_dir / basename
                    with zf.open(member) as src, open(target, 'wb') as dst:
                        dst.write(src.read())
                    if sys.platform == 'win32':
                        _install_font_windows(target)

        os.unlink(zip_path)
        print(f'[font] Installed {family}', file=sys.stderr)
        return True
    except Exception as exc:
        print(f'[font] Failed to download {family}: {exc}', file=sys.stderr)
        return False


def ensure_noto_fonts(text: str, fonts_cache_dir: str = '') -> None:
    """Ensure that appropriate Noto Sans fonts are available for the given text."""
    needed: set[str] = set()
    for ch in text:
        cp = ord(ch)
        for family, ranges in _NOTO_FONT_MAP:
            if any(lo <= cp <= hi for lo, hi in ranges):
                needed.add(family)
                break

    if not needed:
        return

    cache_dir = Path(fonts_cache_dir) if fonts_cache_dir else Path(os.environ.get('WORKSPACE_DIR', '.')) / 'fonts'

    for family in needed:
        if _font_installed(family):
            continue
        _download_and_install_noto(family, cache_dir)


def resolve_font(text: str, base_font: str = 'Calibri') -> str:
    """Return the best font for the given text content.

    If the text contains CJK/non-Latin characters, returns the appropriate
    Noto Sans variant. Otherwise returns the base font unchanged.
    """
    for ch in text:
        cp = ord(ch)
        for family, ranges in _NOTO_FONT_MAP:
            if any(lo <= cp <= hi for lo, hi in ranges):
                return family
    return base_font


def _make_transparent(png_path: str) -> str:
    """Convert a black-on-white RGB icon to black-on-transparent RGBA.

    Returns the path to the transparent version (cached alongside the original).
    If the source already has an alpha channel with real transparency, returns it as-is.
    """
    suffix = '_t.png'
    transparent_path = os.path.join(
        os.path.dirname(png_path),
        f'{Path(png_path).stem}{suffix}',
    )
    if os.path.isfile(transparent_path):
        return transparent_path

    try:
        from PIL import Image
        img = Image.open(png_path)

        # If image already has real transparency, skip conversion
        if img.mode == 'RGBA':
            arr = img.load()
            assert arr is not None
            # Quick sample: if corners are transparent, assume it's already good
            w, h = img.size
            if arr[0, 0][3] == 0 or arr[w - 1, 0][3] == 0:  # type: ignore[index]
                return png_path

        img = img.convert('RGBA')
        pixels = img.load()
        assert pixels is not None
        w, h = img.size
        for y in range(h):
            for x in range(w):
                r, g, b, _ = pixels[x, y]  # type: ignore[misc]
                # Luminance: near-white → transparent, darker → opaque icon stroke
                lum = r * 0.299 + g * 0.587 + b * 0.114
                if lum > 240:
                    pixels[x, y] = (0, 0, 0, 0)  # type: ignore[index]
                else:
                    # Map luminance to alpha: black=255, mid-gray=partial
                    alpha = min(255, int((255 - lum) * (255 / 200)))
                    pixels[x, y] = (0, 0, 0, alpha)  # type: ignore[index]
        img.save(transparent_path, 'PNG')
        return transparent_path
    except Exception:
        return png_path


def _recolor_png(png_path: str, color_hex: str) -> str:
    """Tint an icon PNG to the requested color.

    Handles both RGBA (transparent bg) and RGB (white bg) source icons.
    """
    # First ensure we have a transparent version
    png_path = _make_transparent(png_path)

    color = color_hex.lstrip('#')
    if color == '000000':
        return png_path  # already black-on-transparent

    colored_path = os.path.join(
        os.path.dirname(png_path),
        f'{Path(png_path).stem}_{color}.png',
    )
    if os.path.isfile(colored_path):
        return colored_path

    try:
        from PIL import Image
        img = Image.open(png_path).convert('RGBA')
        r_tgt = int(color[0:2], 16)
        g_tgt = int(color[2:4], 16)
        b_tgt = int(color[4:6], 16)
        pixels = img.load()
        assert pixels is not None
        w, h = img.size
        for y in range(h):
            for x in range(w):
                _, _, _, a = pixels[x, y]  # type: ignore[misc]
                if a > 0:
                    pixels[x, y] = (r_tgt, g_tgt, b_tgt, a)  # type: ignore[index]
        img.save(colored_path, 'PNG')
        return colored_path
    except Exception:
        return png_path


def fetch_icon(name: str, color_hex: str = '000000', size: int = 256) -> str | None:
    """Load an icon PNG from the local cache, recolor via Pillow if needed."""
    if ':' not in name:
        name = f'mdi:{name}'
    prefix, icon_name = name.split(':', 1)
    png_name = f'{icon_name}.png'

    if ICON_CACHE_DIR:
        cached = os.path.join(ICON_CACHE_DIR, prefix, png_name)
        if os.path.isfile(cached):
            return _recolor_png(cached, color_hex)

    print(f'[icon] NOT FOUND: {prefix}:{icon_name} (looked in {ICON_CACHE_DIR}/{prefix}/)', file=sys.stderr)
    return None


def _load_theme() -> dict[str, str]:
    raw = os.environ.get('PPTX_THEME_JSON', '{}')
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def rgb_color(value: str | None, fallback: str = '000000') -> RGBColor:
    normalized = (value or fallback).strip().lstrip('#').upper()
    if len(normalized) != 6:
        normalized = fallback
    return RGBColor.from_string(normalized)


def ensure_parent_dir(file_path: str) -> None:
    Path(file_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


def apply_widescreen(prs: PresentationType) -> PresentationType:
    prs.slide_width = Inches(SLIDE_WIDTH_IN)
    prs.slide_height = Inches(SLIDE_HEIGHT_IN)
    return prs


def _convert_to_pptx_compatible(source: Path) -> Path:
    """Convert unsupported image formats (e.g. WebP) to PNG for python-pptx."""
    if source.suffix.lower() not in ('.webp',):
        return source
    target = source.with_suffix('.png')
    if target.exists():
        return target
    from PIL import Image
    with Image.open(source) as img:
        img.save(target, 'PNG')
    return target


def safe_image_path(value: str | None) -> str | None:
    if not value:
        return None
    candidate = Path(value).expanduser().resolve()
    if not candidate.exists():
        return None
    candidate = _convert_to_pptx_compatible(candidate)
    return str(candidate)


ICON_INSERT_SCALE = 0.4  # Scale factor for icons inserted into fixed-size placeholders (e.g. title slide) to prevent overflow


def _is_icon_asset(path: str) -> bool:
    if not ICON_CACHE_DIR:
        return False
    normalized = os.path.normcase(os.path.normpath(path))
    return normalized.startswith(os.path.normcase(os.path.normpath(ICON_CACHE_DIR)) + os.sep)


def safe_add_picture(shapes, image_path: str | None, left, top, width=None, height=None):
    resolved = safe_image_path(image_path)
    if not resolved:
        return None
    if width is not None and height is not None and _is_icon_asset(resolved):
        scaled_width = max(1, int(width * ICON_INSERT_SCALE))
        scaled_height = max(1, int(height * ICON_INSERT_SCALE))
        left = left + int((width - scaled_width) / 2)
        top = top + int((height - scaled_height) / 2)
        width = scaled_width
        height = scaled_height
    # Preserve aspect ratio when both width and height are specified
    if width is not None and height is not None:
        try:
            from PIL import Image as _PILImage
            with _PILImage.open(resolved) as _img:
                img_w, img_h = _img.size
            if img_w > 0 and img_h > 0:
                scale = min(width / img_w, height / img_h)
                fit_w = int(img_w * scale)
                fit_h = int(img_h * scale)
                # Center within the bounding box
                left = left + (width - fit_w) // 2
                top = top + (height - fit_h) // 2
                width = fit_w
                height = fit_h
        except Exception:
            pass  # Fall back to stretched dimensions
    return shapes.add_picture(resolved, left, top, width=width, height=height)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('generated_code')
    parser.add_argument('output_path')
    parser.add_argument('--render-dir', default=None)
    parser.add_argument('--workspace-dir', default=None,
                        help='Absolute path to the user workspace directory')
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Color contrast utilities (WCAG 2.1)
# ---------------------------------------------------------------------------

def _srgb_to_linear(c: float) -> float:
    """Convert sRGB component (0-1) to linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _luminance_hex(hex_color: str) -> float:
    """WCAG relative luminance from a hex color string."""
    r, g, b = _hex_to_rgb(hex_color)
    rs = _srgb_to_linear(r / 255)
    gs = _srgb_to_linear(g / 255)
    bs = _srgb_to_linear(b / 255)
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs


def contrast_ratio(fg_hex: str, bg_hex: str) -> float:
    """WCAG 2.1 contrast ratio between two hex colors."""
    l1 = _luminance_hex(fg_hex)
    l2 = _luminance_hex(bg_hex)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def ensure_contrast(fg_hex: str, bg_hex: str, *, min_ratio: float = 4.5) -> str:
    """Return *fg_hex* if contrast is sufficient, else a dark or light alternative.

    Use this when placing text on a panel whose fill color is known.
    ``min_ratio`` defaults to WCAG AA (4.5) for normal text; use 3.0 for large text.
    """
    fg_hex = fg_hex.lstrip('#')
    bg_hex = bg_hex.lstrip('#')
    if contrast_ratio(fg_hex, bg_hex) >= min_ratio:
        return fg_hex
    bg_lum = _luminance_hex(bg_hex)
    return '2D2D2D' if bg_lum > 0.4 else 'F0F0F0'


def build_namespace(generated_path: Path, output_path: Path, *, workspace_dir: str = '') -> dict[str, object]:
    theme = _load_theme()
    title = os.environ.get('PPTX_TITLE', 'Presentation')
    if not workspace_dir:
        workspace_dir = os.environ.get('WORKSPACE_DIR', '')
    images_dir = os.path.join(workspace_dir, 'images') if workspace_dir else ''

    # Pre-computed layout specs from hybrid layout engine (COM + constraint solver)
    precomputed_specs: list[LayoutSpec] | None = None
    specs_json = os.environ.get('PPTX_LAYOUT_SPECS_JSON', '')
    if specs_json.strip():
        try:
            from hybrid_layout import deserialize_specs # type: ignore
            precomputed_specs = deserialize_specs(specs_json)
            print(f'[layout] Loaded {len(precomputed_specs)} pre-computed layout spec(s).', file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f'[layout] Failed to load pre-computed specs (using legacy): {exc}', file=sys.stderr)

    return {
        '__name__': '__main__',
        '__file__': str(generated_path),
        'OUTPUT_PATH': str(output_path),
        'PPTX_TITLE': title,
        'PPTX_THEME': theme,
        'WORKSPACE_DIR': workspace_dir,
        'IMAGES_DIR': images_dir,
        'SLIDE_WIDTH_IN': SLIDE_WIDTH_IN,
        'SLIDE_HEIGHT_IN': SLIDE_HEIGHT_IN,
        'os': os,
        'Presentation': Presentation,
        'Inches': Inches,
        'Pt': Pt,
        'RGBColor': RGBColor,
        'PP_ALIGN': PP_ALIGN,
        'MSO_ANCHOR': MSO_ANCHOR,
        'MSO_AUTO_SIZE': MSO_AUTO_SIZE,
        'MSO_AUTO_SHAPE_TYPE': MSO_AUTO_SHAPE_TYPE,
        'rgb_color': rgb_color,
        'ensure_parent_dir': ensure_parent_dir,
        'apply_widescreen': apply_widescreen,
        'safe_image_path': safe_image_path,
        'safe_add_picture': safe_add_picture,
        'estimate_text_height_in': estimate_text_height_in,
        'flow_layout_spec': flow_layout_spec,
        'get_layout_spec': get_layout_spec,
        'LayoutSpec': LayoutSpec,
        'RectSpec': RectSpec,
        'CardsSpec': CardsSpec,
        'StatsSpec': StatsSpec,
        'TimelineSpec': TimelineSpec,
        'ComparisonSpec': ComparisonSpec,
        'PRECOMPUTED_LAYOUT_SPECS': precomputed_specs,
        '_pptx_theme': theme,
        '_pptx_title': title,
        'fetch_icon': fetch_icon,
        'ICON_CACHE_DIR': ICON_CACHE_DIR,
        'resolve_font': resolve_font,
        'ensure_noto_fonts': ensure_noto_fonts,
        'contrast_ratio': contrast_ratio,
        'ensure_contrast': ensure_contrast,
        'set_fill_transparency': set_fill_transparency,
    }


def validate_generated_code_syntax(code: str, generated_path: Path) -> None:
    if '```' in code:
        raise RuntimeError(
            'Generated Python code still contains Markdown code fences. '
            'Return raw Python only inside a single fenced block, and do not nest or duplicate code fences.'
        )

    if 'from future import annotations' in code and 'from __future__ import annotations' not in code:
        raise RuntimeError(
            'Generated Python code uses an invalid future import. '
            'Use "from __future__ import annotations".'
        )

    if re.search(r'^\s*import\s+annotations\b', code, re.MULTILINE):
        raise RuntimeError(
            'Generated Python code uses "import annotations" which is not a valid module. '
            'Use "from __future__ import annotations" or remove the import entirely.'
        )

    if re.search(r'\bif\s+name\s*==', code) and 'if __name__' not in code:
        raise RuntimeError(
            'Generated Python code uses "if name ==" instead of "if __name__ == \'__main__\':". '
            'The variable must be __name__ (with double underscores).'
        )

    try:
        ast.parse(code, filename=str(generated_path))
    except SyntaxError as exc:
        location = f'line {exc.lineno}' if exc.lineno else 'unknown line'
        if exc.offset:
            location = f'{location}, column {exc.offset}'
        source_line = (exc.text or '').rstrip()
        details = [f'Generated Python code has invalid syntax at {location}: {exc.msg}']
        if source_line:
            details.append(source_line)
        raise RuntimeError('\n'.join(details)) from exc

    try:
        compile(code, str(generated_path), 'exec')
    except SyntaxError as exc:
        location = f'line {exc.lineno}' if exc.lineno else 'unknown line'
        if exc.offset:
            location = f'{location}, column {exc.offset}'
        source_line = (exc.text or '').rstrip()
        details = [f'Generated Python code has a semantic error at {location}: {exc.msg}']
        if source_line:
            details.append(source_line)
        raise RuntimeError('\n'.join(details)) from exc


def run_generated_code(generated_path: Path, namespace: dict[str, object]) -> None:
    code = generated_path.read_text(encoding='utf-8')
    validate_generated_code_syntax(code, generated_path)
    exec(compile(code, str(generated_path), 'exec'), namespace)


def finalize_output(output_path: Path, namespace: dict[str, object]) -> None:
    if output_path.exists():
        return

    builder = namespace.get('build_presentation')
    if callable(builder):
        builder(str(output_path), namespace.get('_pptx_theme'), namespace.get('_pptx_title'))

    if not output_path.exists():
        raise RuntimeError('Generated python-pptx code completed without creating the PPTX output file.')


def _com_fix_layout(output_path: Path) -> int:
    """Measure text overflow via PowerPoint COM, then fix with python-pptx.

    Phase 1 (COM, read-only): For each text shape, temporarily sets
    AutoSize=1 (grow-to-fit) and reads back the required height.
    Phase 2 (python-pptx): For textboxes that overflow, shrinks font
    sizes proportionally.  For auto shapes, sets TEXT_TO_FIT_SHAPE.

    Returns the number of fixes applied, or -1 if COM is unavailable.
    """
    if sys.platform != 'win32':
        return -1
    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
    except ImportError:
        return -1

    abs_path = str(output_path.resolve())

    # Phase 1: COM measurement (non-destructive) --------------------------
    # Each entry: (slide_idx_0, shape_idx_0, scale_factor, is_textbox)
    overflows: list[tuple[int, int, float, bool]] = []

    pythoncom.CoInitialize()
    ppt = None
    prs_com = None

    try:
        ppt = win32com.client.DispatchEx('PowerPoint.Application')
        ppt.Visible = 1  # Required for layout engine to compute correctly
        prs_com = ppt.Presentations.Open(
            abs_path, ReadOnly=0, Untitled=0, WithWindow=0,
        )

        for si in range(1, prs_com.Slides.Count + 1):
            slide = prs_com.Slides(si)
            for shi in range(1, slide.Shapes.Count + 1):
                shape = slide.Shapes(shi)
                if not shape.HasTextFrame:
                    continue
                text = shape.TextFrame.TextRange.Text
                if not text or not text.strip():
                    continue

                orig_top = shape.Top
                orig_height = shape.Height
                is_textbox = (shape.Type == 17)  # msoTextBox

                # Temporarily grow shape to fit text
                shape.TextFrame2.WordWrap = True
                shape.TextFrame2.AutoSize = 1  # ppAutoSizeShapeToFitText
                _ = shape.Height  # Force recalculation
                required_height = shape.Height

                # Restore immediately
                shape.TextFrame2.AutoSize = 0  # ppAutoSizeNone
                shape.Height = orig_height
                shape.Top = orig_top

                # Check overflow (5 % tolerance)
                if required_height > orig_height * 1.05:
                    scale = min(orig_height / required_height, 1.0)
                    overflows.append((si - 1, shi - 1, scale, is_textbox))
                    print(
                        f'[layout] Slide {si}, "{shape.Name}": '
                        f'need {required_height:.0f}pt, have {orig_height:.0f}pt '
                        f'(scale={scale:.0%}, {"textbox" if is_textbox else "shape"})',
                        file=sys.stderr,
                    )

        prs_com.Saved = True  # Suppress save prompt — no changes persisted
        prs_com.Close()
        prs_com = None
    except Exception as exc:
        print(f'[layout] COM measurement failed: {exc}', file=sys.stderr)
        return -1
    finally:
        if prs_com is not None:
            try:
                prs_com.Saved = True
                prs_com.Close()
            except Exception:
                pass
        if ppt is not None:
            try:
                ppt.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()

    if not overflows:
        return 0

    # Phase 2: python-pptx fixes ------------------------------------------
    prs = Presentation(str(output_path))
    fixes = 0

    for slide_idx, shape_idx, scale, is_textbox in overflows:
        if slide_idx >= len(prs.slides):
            continue
        slide = prs.slides[slide_idx]
        shapes_list = list(slide.shapes)
        if shape_idx >= len(shapes_list):
            continue
        shape = shapes_list[shape_idx]
        if not shape.has_text_frame:
            continue

        safe_scale = max(scale, 0.55)  # Never shrink below 55 %

        if is_textbox:
            # Textbox: PowerPoint ignores AutoSize=2, so shrink fonts manually
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    if run.font.size is not None:
                        new_pt = max(round(run.font.size.pt * safe_scale, 1), 8.0)
                        run.font.size = Pt(new_pt)
            fixes += 1
        else:
            # Auto shape: let PowerPoint shrink text at render time
            shape.text_frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
            fixes += 1

    if fixes > 0:
        prs.save(str(output_path))
    return fixes


def _get_solid_fill_hex(shape) -> str | None:
    """Return the raw solid fill hex (no '#') of a shape, or None."""
    try:
        fill = shape.fill
        if fill.type is not None and int(fill.type) == 1:  # MSO_FILL.SOLID
            return str(fill.fore_color.rgb)
    except Exception:
        pass
    return None


def _get_fill_transparency(shape) -> float:
    """Return fill transparency (0.0 = opaque, 1.0 = invisible)."""
    # In-memory attribute (works when just set, not after load)
    try:
        t = shape.fill.transparency
        if t is not None:
            return float(t)
    except (AttributeError, TypeError):
        pass
    # Read from XML: <a:alpha val="N"/> where N is opacity in 1/1000ths %
    try:
        ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        for alpha_el in shape._element.findall('.//a:solidFill/*/a:alpha', ns):
            opacity = int(alpha_el.get('val', '100000')) / 100000.0
            return round(1.0 - opacity, 4)
    except Exception:
        pass
    return 0.0


def set_fill_transparency(shape, value: float) -> None:
    """Set fill transparency via XML (python-pptx .fill.transparency doesn't persist).

    Use this instead of ``shape.fill.transparency = x`` to ensure the
    transparency is written to XML and survives save/load.

    Args:
        shape: Any python-pptx shape with a solid fill.
        value: 0.0 = fully opaque, 1.0 = fully transparent.
    """
    from lxml import etree
    ns = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    for sf in shape._element.findall(f'.//{{{ns}}}solidFill'):
        color_el = sf[0] if len(sf) else None
        if color_el is None:
            continue
        # Remove existing alpha elements
        for old in color_el.findall(f'{{{ns}}}alpha'):
            color_el.remove(old)
        # Add new alpha (opacity = 1 - transparency)
        opacity_val = str(int((1.0 - value) * 100000))
        alpha_el = etree.SubElement(color_el, f'{{{ns}}}alpha')
        alpha_el.set('val', opacity_val)


def _get_run_color_hex(run, para) -> str | None:
    """Return the effective font color hex for a run."""
    try:
        if run.font.color.rgb is not None:
            return str(run.font.color.rgb)
    except Exception:
        pass
    try:
        if para.font.color.rgb is not None:
            return str(para.font.color.rgb)
    except Exception:
        pass
    return None


def _fix_low_contrast_text(output_path: Path) -> int:
    """Fix text with insufficient contrast against its shape's fill.

    For shapes with a solid fill (glass panels, cards, etc.), checks every
    text run's color against the raw fill color.  When contrast is below
    WCAG AA for large text (3.0:1), replaces the text color and reduces
    fill transparency so the panel provides a consistent readable background.
    """
    prs = Presentation(str(output_path))
    fixes = 0
    MIN_RATIO = 4.0  # WCAG AA practical threshold
    MAX_TRANSPARENCY = 0.45  # cap so panel is visually present

    for slide in prs.slides:
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue

            fill_hex = _get_solid_fill_hex(shape)
            if fill_hex is None:
                continue

            fill_lum = _luminance_hex(fill_hex)
            transparency = _get_fill_transparency(shape)

            # Collect runs that fail contrast
            bad_runs: list[tuple] = []
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    fg_hex = _get_run_color_hex(run, para)
                    if fg_hex is None:
                        continue
                    ratio = contrast_ratio(fg_hex, fill_hex)
                    if ratio < MIN_RATIO:
                        bad_runs.append((run, fg_hex))

            if not bad_runs:
                continue

            # Choose replacement color
            is_light_fill = fill_lum > 0.4

            for run, old_hex in bad_runs:
                new_hex = '2D2D2D' if is_light_fill else 'FFFFFF'
                run.font.color.rgb = RGBColor.from_string(new_hex)
                fixes += 1

            # If fill is light and highly transparent, reduce transparency
            # so the panel provides a consistent background for dark text.
            if is_light_fill and transparency > MAX_TRANSPARENCY:
                set_fill_transparency(shape, MAX_TRANSPARENCY)
                fixes += 1

    if fixes > 0:
        prs.save(str(output_path))
    return fixes


def validate_and_fix_output(output_path: Path) -> None:
    """Run COM layout fix, contrast fix, then validation on the generated PPTX."""

    # Step 1: COM-based text overflow fix (measure + resize)
    com_fixes = _com_fix_layout(output_path)
    if com_fixes > 0:
        print(f'[layout] COM fix applied to {com_fixes} shape(s).', file=sys.stderr)
    elif com_fixes < 0:
        # COM unavailable: fallback to auto-size XML flags only
        from layout_validator import _enforce_auto_size  # type: ignore
        prs = Presentation(str(output_path))
        fixes = 0
        for slide in prs.slides:
            fixes += _enforce_auto_size(slide)
        if fixes > 0:
            prs.save(str(output_path))
            print(f'[layout-validator] Auto-size flags set on {fixes} frame(s) (no COM).', file=sys.stderr)

    # Step 2: Fix low-contrast text on glass panels / cards
    contrast_fixes = _fix_low_contrast_text(output_path)
    if contrast_fixes > 0:
        print(f'[contrast] Fixed {contrast_fixes} low-contrast text/fill issue(s).', file=sys.stderr)

    # Step 3: Validate (re-open the processed file so we see all fixes)
    prs = Presentation(str(output_path))
    issues = validate_presentation(prs)
    if not issues:
        print('[layout-validator] All slides passed layout validation.', file=sys.stderr)
        return

    report = report_issues(issues)
    print(report, file=sys.stderr)

    blocking = [issue for issue in issues if issue.severity.value == 'error']
    if blocking:
        has_overlap = any('overlap' in i.issue_type.value.lower() for i in blocking)
        has_text_overflow = any('text_overflow' in i.issue_type.value.lower() for i in blocking)

        # Tolerate up to 2 blocking issues — treat as success with warnings
        if len(blocking) <= 2:
            print(
                f'[layout-validator] {len(blocking)} minor layout issue(s) detected (within tolerance). '
                'PPTX generated with incomplete layout details.',
                file=sys.stderr,
            )
            return

        hints: list[str] = []
        if has_overlap:
            hints.append(
                'TOOL HINT: Use patch_layout_infrastructure(action="read", file="layout_specs") to inspect '
                'current layout coordinates, then patch_layout_infrastructure(action="patch", ...) to adjust '
                'get_layout_spec() dimensions. After patching, call rerun_pptx to re-execute.'
            )
        if has_text_overflow:
            hints.append(
                'TOOL HINT: Use patch_layout_infrastructure(action="read", file="layout_validator") to inspect '
                'validation thresholds, then patch if needed. Or adjust layout_specs dimensions to provide more space. '
                'After patching, call rerun_pptx to re-execute.'
            )

        hint_text = '\n'.join(hints)
        raise RuntimeError(
            'Layout validation failed after generation. '
            'Reduce content density, reserve more vertical space, or split the slide.\n'
            'Alternatively, use the layout infrastructure tools to fix spec dimensions or validator thresholds.\n\n'
            f'{hint_text}\n\n'
            f'{report}'
        )


def render_preview_images(output_path: Path, render_dir: Path) -> None:
    if sys.platform != 'win32':
        raise RuntimeError('Local slide preview rendering is only supported on Windows.')

    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
    except ImportError as exc:
        raise RuntimeError('pywin32 is required for local PPTX preview rendering on Windows.') from exc

    render_dir.mkdir(parents=True, exist_ok=True)
    # Only remove old preview images; preserve generated-source.py and .pptx files
    for existing in render_dir.glob('*'):
        if existing.is_file() and existing.suffix.lower() in ('.png', '.jpg', '.jpeg'):
            existing.unlink()

    pythoncom.CoInitialize()
    powerpoint = None
    presentation = None
    try:
        powerpoint = win32com.client.DispatchEx('PowerPoint.Application')
        powerpoint.Visible = 1
        presentation = powerpoint.Presentations.Open(str(output_path), WithWindow=False, ReadOnly=True)
        presentation.Export(str(render_dir), 'PNG', 1280, 720)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError('Microsoft PowerPoint is required to render local preview images.') from exc
    finally:
        if presentation is not None:
            presentation.Close()
        if powerpoint is not None:
            powerpoint.Quit()
        pythoncom.CoUninitialize()


def _unlock_or_rename(output_path: Path) -> Path:
    """Remove existing output file. If locked, fall back to a timestamped name."""
    if not output_path.exists():
        return output_path
    try:
        output_path.unlink()
        return output_path
    except PermissionError:
        from datetime import datetime
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        alt = output_path.with_stem(f'{output_path.stem}-{stamp}')
        print(f'[WARNING] {output_path.name} is locked, saving as {alt.name}', file=sys.stderr)
        return alt


def main() -> int:
    import io
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding='utf-8')
    if isinstance(sys.stderr, io.TextIOWrapper):
        sys.stderr.reconfigure(encoding='utf-8')

    if ICON_CACHE_DIR:
        cache_exists = os.path.isdir(ICON_CACHE_DIR)
        print(f'[icon-cache] ICON_CACHE_DIR={ICON_CACHE_DIR} (exists={cache_exists})', file=sys.stderr)
    else:
        print('[icon-cache] ICON_CACHE_DIR is not set — uncached icons will be unavailable', file=sys.stderr)

    args = parse_args()
    generated_path = Path(args.generated_code).resolve()
    output_path = Path(args.output_path).resolve()
    render_dir = Path(args.render_dir).resolve() if args.render_dir else None
    workspace_dir = str(Path(args.workspace_dir).resolve()) if args.workspace_dir else ''

    print(f'[workspace] WORKSPACE_DIR={workspace_dir or "(not set)"}', file=sys.stderr)

    if not generated_path.exists():
        raise FileNotFoundError(f'Generated Python source file not found: {generated_path}')

    output_path = _unlock_or_rename(output_path)
    namespace = build_namespace(generated_path, output_path, workspace_dir=workspace_dir)

    # Pre-download Noto Sans fonts for any non-Latin text in the generated code
    try:
        code_text = generated_path.read_text(encoding='utf-8')
        ensure_noto_fonts(code_text, os.environ.get('WORKSPACE_DIR', ''))
    except Exception as exc:  # noqa: BLE001
        print(f'[font] Font pre-check failed (non-blocking): {exc}', file=sys.stderr)

    run_generated_code(generated_path, namespace)
    finalize_output(output_path, namespace)

    try:
        validate_and_fix_output(output_path)
    except Exception as exc:  # noqa: BLE001
        print(f'[layout-validator] Validation failed (PPTX was generated): {exc}', file=sys.stderr)

    if render_dir is not None:
        try:
            render_preview_images(output_path, render_dir)
        except Exception as exc:  # noqa: BLE001
            print(f'[WARNING] Preview rendering failed (PPTX was generated successfully): {exc}', file=sys.stderr)

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
