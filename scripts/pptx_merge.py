#!/usr/bin/env python3
"""
pptx_merge.py — Merge multiple partial PPTX files into a single presentation.

Usage:
    python pptx_merge.py --partials partial-0.pptx,partial-1.pptx,partial-2.pptx --output merged.pptx

Works at the raw OPC (ZIP/XML) level for reliable, repair-free merging.
The first partial is used as the base package. Slides from subsequent partials
are injected with renumbered part names and remapped relationships.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

from lxml import etree

# ---- OOXML namespace & relationship-type constants --------------------

_NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
_NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
_NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
_NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

_RT_SLIDE = _NS_R + '/slide'
_RT_NOTES_MASTER = _NS_R + '/notesMaster'
_RT_SLIDE_LAYOUT = _NS_R + '/slideLayout'
_RT_SLIDE_MASTER = _NS_R + '/slideMaster'
_RT_THEME = _NS_R + '/theme'

_CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
_CT_NOTES_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'
_CT_NOTES_MASTER = 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'
_CT_THEME = 'application/vnd.openxmlformats-officedocument.theme+xml'
_CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'

_EXT_CONTENT_TYPE: dict[str, str] = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'bmp': 'image/bmp', 'tiff': 'image/tiff',
    'tif': 'image/tiff', 'svg': 'image/svg+xml', 'emf': 'image/x-emf',
    'wmf': 'image/x-wmf', 'wdp': 'image/vnd.ms-photo',
}

# Relationship types whose targets should NOT be remapped (shared from base)
_KEEP_REL_TYPES = {_RT_SLIDE_LAYOUT, _RT_SLIDE_MASTER, _RT_THEME}


# ---- ZIP helpers ------------------------------------------------------

def _read_zip(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(str(path), 'r') as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def _write_zip(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(str(path), 'w', zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files):
            zf.writestr(name, files[name])


# ---- XML helpers ------------------------------------------------------

def _max_num(files: dict[str, bytes], pattern: str) -> int:
    """Find the largest integer captured by *pattern* across ZIP entry names."""
    mx = 0
    for name in files:
        m = re.match(pattern, name)
        if m:
            mx = max(mx, int(m.group(1)))
    return mx


def _max_rid(rels_tree: etree._Element) -> int:
    mx = 0
    for rel in rels_tree.findall(f'{{{_NS_REL}}}Relationship'):
        m = re.match(r'rId(\d+)', rel.get('Id', ''))
        if m:
            mx = max(mx, int(m.group(1)))
    return mx


def _ensure_override(ct: etree._Element, part_name: str, content_type: str) -> None:
    for ov in ct.findall(f'{{{_NS_CT}}}Override'):
        if ov.get('PartName') == part_name:
            return
    etree.SubElement(ct, f'{{{_NS_CT}}}Override',
                     PartName=part_name, ContentType=content_type)


def _ensure_ext(ct: etree._Element, ext: str, content_type: str) -> None:
    for d in ct.findall(f'{{{_NS_CT}}}Default'):
        if d.get('Extension', '').lower() == ext.lower():
            return
    etree.SubElement(ct, f'{{{_NS_CT}}}Default',
                     Extension=ext, ContentType=content_type)


def _xml_bytes(tree: etree._Element) -> bytes:
    return etree.tostring(tree, xml_declaration=True, encoding='UTF-8', standalone=True)


# ---- Notes-master bootstrap ------------------------------------------

def _ensure_notes_master(
    base: dict[str, bytes],
    partial: dict[str, bytes],
    ct: etree._Element,
    pres_rels: etree._Element,
    next_rid: int,
) -> int:
    """Copy notesMaster infrastructure from *partial* if *base* lacks it."""
    nm_path = 'ppt/notesMasters/notesMaster1.xml'
    if nm_path in base or nm_path not in partial:
        return next_rid

    base[nm_path] = partial[nm_path]
    nm_rels = 'ppt/notesMasters/_rels/notesMaster1.xml.rels'
    if nm_rels in partial:
        base[nm_rels] = partial[nm_rels]
        # Also copy the notes-master's theme if referenced and missing
        for rel in etree.fromstring(partial[nm_rels]).findall(f'{{{_NS_REL}}}Relationship'):
            tgt = rel.get('Target', '')
            if '../theme/' in tgt:
                theme_file = 'ppt/' + tgt.replace('../', '')
                if theme_file not in base and theme_file in partial:
                    base[theme_file] = partial[theme_file]
                    _ensure_override(ct, '/' + theme_file, _CT_THEME)

    _ensure_override(ct, '/' + nm_path, _CT_NOTES_MASTER)
    rid = f'rId{next_rid}'
    next_rid += 1
    etree.SubElement(pres_rels, f'{{{_NS_REL}}}Relationship',
                     Id=rid, Type=_RT_NOTES_MASTER,
                     Target='notesMasters/notesMaster1.xml')
    return next_rid


# ---- Chart-rels helper ------------------------------------------------

def _copy_chart_rels(
    base: dict[str, bytes],
    partial: dict[str, bytes],
    old_rels_path: str,
    new_rels_path: str,
    pidx: int,
    slide_num: int,
) -> None:
    """Copy chart .rels, remapping any embedding targets."""
    tree = etree.fromstring(partial[old_rels_path])
    for rel in tree.findall(f'{{{_NS_REL}}}Relationship'):
        tgt = rel.get('Target', '')
        if '../embeddings/' in tgt:
            old_embed = 'ppt/embeddings/' + tgt.split('../embeddings/')[-1]
            bn, ext = os.path.splitext(os.path.basename(old_embed))
            new_name = f'{bn}_p{pidx}_s{slide_num}{ext}'
            new_embed = f'ppt/embeddings/{new_name}'
            if old_embed in partial:
                base[new_embed] = partial[old_embed]
            rel.set('Target', f'../embeddings/{new_name}')
    base[new_rels_path] = _xml_bytes(tree)


# ---- Core merge -------------------------------------------------------

def merge_presentations(
    partial_paths: list[Path],
    output_path: Path,
    *,
    expected_slides: int = 0,
) -> dict:
    """Merge partial PPTX files at the OPC (ZIP/XML) level.

    Returns a completion-report dict identical to the old API.
    """
    if not partial_paths:
        return {'status': 'error', 'error': 'No partial files specified',
                'slideCount': 0, 'partialCount': 0}

    for p in partial_paths:
        if not p.exists():
            raise FileNotFoundError(f'Partial PPTX not found: {p}')

    # Single partial → just copy
    if len(partial_paths) == 1:
        shutil.copy2(str(partial_paths[0]), str(output_path))
        return _build_report(output_path, 1, expected_slides)

    # ---- Load base (first partial) ------------------------------------
    base = _read_zip(partial_paths[0])
    ct = etree.fromstring(base['[Content_Types].xml'])
    pres = etree.fromstring(base['ppt/presentation.xml'])
    prels = etree.fromstring(base['ppt/_rels/presentation.xml.rels'])

    # Running counters — start just above what the base already contains
    next_slide = _max_num(base, r'ppt/slides/slide(\d+)\.xml$') + 1
    next_notes = _max_num(base, r'ppt/notesSlides/notesSlide(\d+)\.xml$') + 1
    next_media = _max_num(base, r'ppt/media/\w+?(\d+)\.\w+$') + 1
    next_chart = _max_num(base, r'ppt/charts/chart(\d+)\.xml$') + 1
    next_rid = _max_rid(prels) + 1

    # sldId values must be unique uint32 ≥ 256
    next_sld_id = 256
    sld_id_lst = pres.find(f'{{{_NS_P}}}sldIdLst')
    if sld_id_lst is not None:
        for el in sld_id_lst.findall(f'{{{_NS_P}}}sldId'):
            next_sld_id = max(next_sld_id, int(el.get('id', '255')) + 1)
    else:
        sld_id_lst = etree.SubElement(pres, f'{{{_NS_P}}}sldIdLst')

    warnings: list[str] = []

    # ---- Inject slides from each subsequent partial -------------------
    for pidx, ppath in enumerate(partial_paths[1:], start=1):
        partial = _read_zip(ppath)

        # Bootstrap notes-master into base if partial has notes but base doesn't
        next_rid = _ensure_notes_master(base, partial, ct, prels, next_rid)

        slide_names = sorted(
            (n for n in partial if re.match(r'ppt/slides/slide\d+\.xml$', n)),
            key=lambda n: int(re.search(r'(\d+)', n.rsplit('/', 1)[-1]).group(1)),
        )

        for old_slide_name in slide_names:
            old_num = int(re.search(r'(\d+)', old_slide_name.rsplit('/', 1)[-1]).group(1))
            new_num = next_slide
            next_slide += 1

            new_slide_path = f'ppt/slides/slide{new_num}.xml'
            old_rels_path = f'ppt/slides/_rels/slide{old_num}.xml.rels'
            new_rels_path = f'ppt/slides/_rels/slide{new_num}.xml.rels'

            # ---- A. Remap slide relationships -------------------------
            if old_rels_path in partial:
                rtree = etree.fromstring(partial[old_rels_path])

                for rel in rtree.findall(f'{{{_NS_REL}}}Relationship'):
                    rtype = rel.get('Type', '')
                    tgt = rel.get('Target', '')

                    if rtype in _KEEP_REL_TYPES or rel.get('TargetMode') == 'External':
                        continue

                    # -- media (images, audio, video) --
                    if tgt.startswith('../media/'):
                        old_media = 'ppt/media/' + tgt[len('../media/'):]
                        ext = os.path.splitext(old_media)[1]
                        new_media = f'ppt/media/image{next_media}{ext}'
                        next_media += 1
                        if old_media in partial:
                            base[new_media] = partial[old_media]
                            enl = ext.lstrip('.').lower()
                            if enl in _EXT_CONTENT_TYPE:
                                _ensure_ext(ct, enl, _EXT_CONTENT_TYPE[enl])
                        rel.set('Target', f'../media/{os.path.basename(new_media)}')

                    # -- notes slides --
                    elif tgt.startswith('../notesSlides/'):
                        old_notes_file = tgt[len('../notesSlides/'):]
                        old_notes = 'ppt/notesSlides/' + old_notes_file
                        old_notes_rels = 'ppt/notesSlides/_rels/' + old_notes_file + '.rels'

                        new_notes = f'ppt/notesSlides/notesSlide{next_notes}.xml'
                        new_notes_rels = f'ppt/notesSlides/_rels/notesSlide{next_notes}.xml.rels'
                        next_notes += 1

                        if old_notes in partial:
                            base[new_notes] = partial[old_notes]
                            _ensure_override(ct, '/' + new_notes, _CT_NOTES_SLIDE)

                        if old_notes_rels in partial:
                            nrt = etree.fromstring(partial[old_notes_rels])
                            for nr in nrt.findall(f'{{{_NS_REL}}}Relationship'):
                                ntgt = nr.get('Target', '')
                                # Update the back-reference to the new slide number
                                if ntgt.startswith('../slides/'):
                                    nr.set('Target', f'../slides/slide{new_num}.xml')
                                # Remap any media in notes
                                elif ntgt.startswith('../media/'):
                                    om = 'ppt/media/' + ntgt[len('../media/'):]
                                    ext = os.path.splitext(om)[1]
                                    nm_path = f'ppt/media/image{next_media}{ext}'
                                    next_media += 1
                                    if om in partial:
                                        base[nm_path] = partial[om]
                                        enl = ext.lstrip('.').lower()
                                        if enl in _EXT_CONTENT_TYPE:
                                            _ensure_ext(ct, enl, _EXT_CONTENT_TYPE[enl])
                                    nr.set('Target', f'../media/{os.path.basename(nm_path)}')
                            base[new_notes_rels] = _xml_bytes(nrt)

                        rel.set('Target', f'../notesSlides/{os.path.basename(new_notes)}')

                    # -- charts --
                    elif tgt.startswith('../charts/'):
                        old_chart_file = tgt[len('../charts/'):]
                        old_chart = 'ppt/charts/' + old_chart_file
                        old_chart_rels = 'ppt/charts/_rels/' + old_chart_file + '.rels'

                        new_chart = f'ppt/charts/chart{next_chart}.xml'
                        new_chart_rels = f'ppt/charts/_rels/chart{next_chart}.xml.rels'
                        next_chart += 1

                        if old_chart in partial:
                            base[new_chart] = partial[old_chart]
                            _ensure_override(ct, '/' + new_chart, _CT_CHART)

                        if old_chart_rels in partial:
                            _copy_chart_rels(base, partial, old_chart_rels,
                                             new_chart_rels, pidx, new_num)

                        rel.set('Target', f'../charts/{os.path.basename(new_chart)}')

                    # -- embeddings --
                    elif tgt.startswith('../embeddings/'):
                        old_embed = 'ppt/embeddings/' + tgt[len('../embeddings/'):]
                        bn, ext = os.path.splitext(os.path.basename(old_embed))
                        new_name = f'{bn}_p{pidx}_s{new_num}{ext}'
                        new_embed = f'ppt/embeddings/{new_name}'
                        if old_embed in partial:
                            base[new_embed] = partial[old_embed]
                        rel.set('Target', f'../embeddings/{new_name}')

                    # -- generic fallback for any other relative part --
                    elif tgt.startswith('../'):
                        opart = 'ppt/' + tgt[len('../'):]
                        segments = tgt[len('../'):].split('/')
                        subdir = segments[0] if len(segments) > 1 else 'misc'
                        bn, ext = os.path.splitext(os.path.basename(opart))
                        new_basename = f'{bn}_p{pidx}_s{new_num}{ext}'
                        new_part = f'ppt/{subdir}/{new_basename}'
                        if opart in partial:
                            base[new_part] = partial[opart]
                        rel.set('Target', f'../{subdir}/{new_basename}')
                        warnings.append(f'Copied unknown part: {opart} → {new_part}')

                base[new_rels_path] = _xml_bytes(rtree)

            # ---- B. Copy slide XML ------------------------------------
            base[new_slide_path] = partial[old_slide_name]

            # ---- C. Register in [Content_Types].xml -------------------
            _ensure_override(ct, '/' + new_slide_path, _CT_SLIDE)

            # ---- D. Presentation-level relationship -------------------
            pres_rid = f'rId{next_rid}'
            next_rid += 1
            etree.SubElement(prels, f'{{{_NS_REL}}}Relationship',
                             Id=pres_rid, Type=_RT_SLIDE,
                             Target=f'slides/slide{new_num}.xml')

            # ---- E. sldId in presentation.xml -------------------------
            sld_el = etree.SubElement(sld_id_lst, f'{{{_NS_P}}}sldId')
            sld_el.set('id', str(next_sld_id))
            sld_el.set(f'{{{_NS_R}}}id', pres_rid)
            next_sld_id += 1

    # ---- Serialize modified XML back to the package -------------------
    base['[Content_Types].xml'] = _xml_bytes(ct)
    base['ppt/presentation.xml'] = _xml_bytes(pres)
    base['ppt/_rels/presentation.xml.rels'] = _xml_bytes(prels)

    _write_zip(output_path, base)
    return _build_report(output_path, len(partial_paths), expected_slides, warnings)


# ---- Report builder ---------------------------------------------------

def _build_report(
    output_path: Path,
    partial_count: int,
    expected_slides: int,
    warnings: list[str] | None = None,
) -> dict:
    from pptx import Presentation
    actual_count = len(Presentation(str(output_path)).slides)
    file_size = output_path.stat().st_size

    print(f'[merge] Merged {actual_count} slides from {partial_count} partials → {output_path}',
          file=sys.stderr)

    report: dict = {
        'status': 'success',
        'outputPath': str(output_path),
        'fileExists': True,
        'slideCount': actual_count,
        'fileSizeBytes': file_size,
        'partialCount': partial_count,
        'warnings': warnings or [],
    }

    if expected_slides > 0 and actual_count != expected_slides:
        report['status'] = 'error'
        report['error'] = (
            f'Slide count mismatch: expected {expected_slides} but got {actual_count}. '
            f'Some chunk partials may be missing or empty.'
        )

    if actual_count == 0:
        report['status'] = 'error'
        report['error'] = 'Merged PPTX contains 0 slides'

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description='Merge partial PPTX files into one.')
    parser.add_argument('--partials', required=True,
                        help='Comma-separated list of partial PPTX file paths')
    parser.add_argument('--output', required=True,
                        help='Output path for the merged PPTX')
    parser.add_argument('--expected-slides', type=int, default=0,
                        help='Expected total slide count for verification (0 = skip check)')
    args = parser.parse_args()

    partial_paths = [Path(p.strip()) for p in args.partials.split(',') if p.strip()]
    output_path = Path(args.output)

    if len(partial_paths) == 0:
        report = {'status': 'error', 'error': 'No partial files specified',
                  'slideCount': 0, 'partialCount': 0}
        print(json.dumps(report))
        return 1

    try:
        report = merge_presentations(partial_paths, output_path,
                                     expected_slides=args.expected_slides)
        print(json.dumps(report))
        return 0 if report['status'] in ('success', 'warning') else 1
    except Exception as exc:
        report = {'status': 'error', 'error': str(exc),
                  'slideCount': 0, 'partialCount': len(partial_paths)}
        print(json.dumps(report))
        print(f'[merge] Error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
