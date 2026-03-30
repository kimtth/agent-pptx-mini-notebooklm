/**
 * Slide Chunker: splits slides into groups for parallel PPTX generation.
 * Each chunk can be sent to an independent LLM session and Python execution.
 */

import type { SlideItem } from '../../../src/domain/entities/slide-work';

export interface SlideGroup {
  chunkIndex: number;
  slideIndices: number[];       // Original 0-based indices into the full slide array
  slides: SlideItem[];
}

/**
 * Split slides into groups of `groupSize`.
 * Returns a single group (no chunking) when total ≤ groupSize or groupSize is 0.
 */
export function chunkSlides(slides: SlideItem[], groupSize: number): SlideGroup[] {
  if (groupSize <= 0 || slides.length <= groupSize) {
    return [{ chunkIndex: 0, slideIndices: slides.map((_, i) => i), slides }];
  }

  const groups: SlideGroup[] = [];
  for (let start = 0; start < slides.length; start += groupSize) {
    const end = Math.min(start + groupSize, slides.length);
    const slideIndices = Array.from({ length: end - start }, (_, i) => start + i);
    groups.push({
      chunkIndex: groups.length,
      slideIndices,
      slides: slideIndices.map((i) => slides[i]),
    });
  }

  return groups;
}

/**
 * Slice a full layout-specs JSON array to only the specified group's slides,
 * re-indexed from 0. Returns a JSON string.
 */
export function sliceLayoutSpecs(allSpecsJson: string, group: SlideGroup): string {
  const allSpecs: unknown[] = JSON.parse(allSpecsJson);
  const sliced = group.slideIndices.map((i) => allSpecs[i]);
  return JSON.stringify(sliced);
}

/**
 * Slice a full slide-assets JSON array to only the specified group's slides,
 * re-indexed from 0. Returns a JSON string.
 */
export function sliceSlideAssets(allAssetsJson: string, group: SlideGroup): string {
  const allAssets: unknown[] = JSON.parse(allAssetsJson);
  const sliced = group.slideIndices.map((i) => allAssets[i]);
  return JSON.stringify(sliced);
}

/**
 * Slice layout-input JSON array to only this group's slides.
 * Returns a JSON string for writing to a per-chunk layout-input file.
 */
export function sliceLayoutInput(allInputJson: string, group: SlideGroup): string {
  const allInput: unknown[] = JSON.parse(allInputJson);
  const sliced = group.slideIndices.map((i) => allInput[i]);
  return JSON.stringify(sliced, null, 2);
}
