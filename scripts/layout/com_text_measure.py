"""PowerPoint COM AutoFit text measurement.

Uses the PowerPoint text engine (via COM automation) to measure the
actual rendered height of text blocks.  This is the "layout oracle"
— it replaces heuristic estimation with WYSIWYG measurements.

The module opens PowerPoint once via COM, creates temporary text shapes
with ``TextFrame.AutoSize = ppAutoSizeShapeToFitText``, and reads back
the resulting shape height.  All measurements are batched inside a
single COM session to minimise startup overhead.

Windows-only — requires ``pywin32`` and Microsoft PowerPoint installed.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

if sys.platform != 'win32':
    raise ImportError('com_text_measure requires Windows with PowerPoint installed.')

from layout_specs import SLIDE_WIDTH_IN, SLIDE_HEIGHT_IN  # noqa: E402


# ---------------------------------------------------------------------------
# Data types
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
# COM constants
# ---------------------------------------------------------------------------

# ppAutoSizeShapeToFitText  — shape grows to fit text
_PP_AUTO_SIZE_SHAPE_TO_FIT = 1
# ppAutoSizeNone
_PP_AUTO_SIZE_NONE = 0

# EMU per inch
_EMU_PER_IN = 914400


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def measure_text_heights(
    requests: list[TextMeasureRequest],
) -> list[float]:
    """Measure actual rendered text heights via PowerPoint COM.

    Opens a single temporary presentation, creates one textbox per
    request, enables AutoFit (shape-grows-to-fit), and reads back the
    resulting shape height in inches.

    Returns a list of heights (inches) in the same order as *requests*.
    """
    if not requests:
        return []

    import pythoncom  # type: ignore
    import win32com.client  # type: ignore

    pythoncom.CoInitialize()
    powerpoint = None
    presentation = None

    try:
        powerpoint = win32com.client.DispatchEx('PowerPoint.Application')
        powerpoint.Visible = 1  # required for AutoFit to compute correctly

        presentation = powerpoint.Presentations.Add(WithWindow=False)

        # Set widescreen slide size (13.333" × 7.5")
        presentation.PageSetup.SlideWidth = SLIDE_WIDTH_IN * 72   # points
        presentation.PageSetup.SlideHeight = SLIDE_HEIGHT_IN * 72

        heights: list[float] = []

        for req in requests:
            slide = presentation.Slides.Add(
                presentation.Slides.Count + 1,
                12,  # ppLayoutBlank
            )

            # Create textbox at the specified width, minimal initial height
            left_pt = 72.0   # 1 inch from left (arbitrary — doesn't affect height)
            top_pt = 72.0
            width_pt = req.width_in * 72.0
            height_pt = 36.0  # small starting height — AutoFit will grow it

            shape = slide.Shapes.AddTextbox(
                1,  # msoTextOrientationHorizontal
                left_pt,
                top_pt,
                width_pt,
                height_pt,
            )

            tf = shape.TextFrame
            tf.WordWrap = True
            tf.AutoSize = _PP_AUTO_SIZE_SHAPE_TO_FIT

            # Set text content
            tf.TextRange.Text = req.text if req.text.strip() else ' '

            # Set font properties
            font = tf.TextRange.Font
            font.Name = req.font_family
            font.Size = req.font_size_pt
            font.Bold = req.bold

            # Force layout recalculation
            _ = shape.Height

            # Read the resulting height (in points → inches)
            measured_h_pt = shape.Height
            measured_h_in = measured_h_pt / 72.0

            heights.append(round(measured_h_in, 4))

        return heights

    finally:
        if presentation is not None:
            try:
                presentation.Close()
            except Exception:
                pass
        if powerpoint is not None:
            try:
                powerpoint.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()


def measure_slide_text_zones(
    zones: list[tuple[str, TextMeasureRequest]],
) -> dict[str, float]:
    """Convenience wrapper: measure named zones and return a dict.

    ``zones`` is a list of ``(zone_name, request)`` pairs.
    Returns ``{zone_name: measured_height_in}``.
    """
    if not zones:
        return {}
    names = [name for name, _ in zones]
    requests = [req for _, req in zones]
    heights = measure_text_heights(requests)
    return dict(zip(names, heights))
