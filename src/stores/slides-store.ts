/**
 * Store: Slides + Workspace state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  DesignStyle,
  SlideItem,
  SlideLayout,
  SlideSelectedImage,
  SlideWork,
  ScenarioPayload,
  SlideUpdatePayload,
  FrameworkType,
  DesignBrief,
  TemplateMeta,
} from '../domain/entities/slide-work';

function normalizeImageQueries(imageQuery: string | null | undefined, imageQueries?: string[]): string[] {
  const explicit = (imageQueries ?? []).map((query) => query.trim()).filter(Boolean)
  if (explicit.length > 0) return explicit
  return String(imageQuery ?? '')
    .split(/[\r\n,;]+/)
    .map((query) => query.trim())
    .filter(Boolean)
}

function toSelectedImage(image: {
  id: string;
  imageQuery: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imageAttribution: string | null;
  sourcePageUrl: string | null;
  thumbnailUrl: string | null;
}): SlideSelectedImage {
  return {
    id: image.id,
    imageQuery: image.imageQuery,
    imageUrl: image.imageUrl,
    imagePath: image.imagePath,
    imageAttribution: image.imageAttribution,
    sourcePageUrl: image.sourcePageUrl,
    thumbnailUrl: image.thumbnailUrl,
  }
}

function syncPrimaryImage(slide: SlideItem, selectedImages: SlideSelectedImage[]): SlideItem {
  const primary = selectedImages[0] ?? null
  return {
    ...slide,
    selectedImages,
    imageUrl: primary?.imageUrl ?? null,
    imagePath: primary?.imagePath ?? null,
    imageAttribution: primary?.imageAttribution ?? null,
  }
}

function mapLayout(raw: string): SlideItem['layout'] {
  const valid: readonly SlideLayout[] = [
    'title',
    'agenda',
    'section',
    'bullets',
    'cards',
    'stats',
    'comparison',
    'timeline',
    'diagram',
    'summary',
    'chart',
    'closing',
    'photo_fullbleed',
    'multi_column',
    'content_caption',
    'picture_caption',
    'two_content',
    'title_only',
    'quote',
    'big_number',
    'process',
    'pyramid',
  ];
  return valid.includes(raw as SlideLayout) ? (raw as SlideLayout) : 'bullets';
}

const ACCENT_CYCLE: SlideItem['accent'][] = ['blue', 'green', 'purple', 'teal', 'orange'];

interface SlidesStore {
  work: SlideWork;
  applyScenario(payload: ScenarioPayload): void;
  initializeForBrainstorm(): void;
  applySlideUpdate(update: SlideUpdatePayload): void;
  patchSlide(number: number, patch: Partial<Pick<SlideItem, 'title' | 'keyMessage' | 'bullets' | 'notes' | 'layout'>>): void;
  applyResolvedImages(images: Array<{ id: string; number: number; imageQuery: string | null; imageUrl: string | null; imagePath: string | null; imageAttribution: string | null; sourcePageUrl: string | null; thumbnailUrl: string | null }>): void;
  setSlideImageQuery(number: number, imageQuery: string | null): void;
  removeSlideImage(number: number, imageId: string): void;
  setDesignStyle(style: DesignStyle | null): void;
  setFramework(fw: FrameworkType): void;
  setCustomFrameworkPrompt(prompt: string | null): void;
  setTemplatePath(path: string | null): void;
  setTemplateMeta(meta: TemplateMeta | null): void;
  setStreaming(v: boolean): void;
  setPptxBusy(v: boolean): void;
  setThinking(delta: string): void;
  appendChatContent(delta: string): void;
  setPptxCode(code: string): void;
  setPptxBuildError(error: string | null): void;
  reset(): void;
  moveSlide(from: number, to: number): void;
  deleteSlide(number: number): void;
  moveToAppendix(number: number): void;
}

const initial: SlideWork = {
  phase: 'empty',
  title: '',
  story: null,
  designBrief: null,
  designStyle: null,
  framework: null,
  customFrameworkPrompt: null,
  templatePath: null,
  templateMeta: null,
  slides: [],
  pptxCode: null,
  pptxBuildError: null,
  thinking: null,
  isStreaming: false,
  isPptxBusy: false,
};

export const useSlidesStore = create<SlidesStore>()(persist(
  (set) => ({
  work: initial,

  applyScenario(payload) {
    const slides: SlideItem[] = payload.slides.map((s, i) => ({
      id: nanoid(),
      number: s.number,
      title: s.title,
      keyMessage: s.keyMessage,
      layout: mapLayout(s.layout),
      bullets: s.bullets,
      notes: s.notes,
      icon: s.icon ?? null,
      imageQuery: s.imageQuery ?? null,
      imageQueries: normalizeImageQueries(s.imageQuery ?? null, s.imageQueries),
      imageUrl: null,
      imagePath: null,
      imageAttribution: null,
      selectedImages: [],
      code: null,
      accent: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
    }));
    set((state) => ({
      work: {
        ...state.work,
        phase: 'story',
        title: payload.title,
        slides,
        pptxCode: null,
        pptxBuildError: null,
        designBrief: (payload.designBrief as DesignBrief | undefined) ?? state.work.designBrief,
        framework: (payload.framework as FrameworkType | undefined) ?? state.work.framework,
      },
    }));
  },

  initializeForBrainstorm() {
    set((state) => ({
      work: {
        ...state.work,
        phase: 'planning',
        title: '',
        story: null,
        designBrief: null,
        slides: [],
        pptxCode: null,
        pptxBuildError: null,
        thinking: null,
        isStreaming: false,
        isPptxBusy: false,
      },
    }));
  },

  applySlideUpdate(update) {
    set((state) => ({
      work: {
        ...state.work,
        pptxCode: null,
        pptxBuildError: null,
        slides: state.work.slides.map((s) =>
          s.number === update.number
            ? {
                ...s,
                title: update.title,
                keyMessage: update.keyMessage,
                layout: mapLayout(update.layout),
                bullets: update.bullets,
                notes: update.notes,
                icon: update.icon ?? s.icon,
                imageQuery: update.imageQuery ?? s.imageQuery,
                imageQueries: normalizeImageQueries(update.imageQuery ?? s.imageQuery, update.imageQueries),
              }
            : s,
        ),
      },
    }));
  },

  patchSlide(number, patch) {
    set((state) => ({
      work: {
        ...state.work,
        pptxCode: null,
        pptxBuildError: null,
        slides: state.work.slides.map((s) =>
          s.number === number ? { ...s, ...patch } : s,
        ),
      },
    }));
  },

  applyResolvedImages(images) {
    set((state) => ({
      work: {
        ...state.work,
        pptxCode: null,
        pptxBuildError: null,
        slides: state.work.slides.map((slide) => {
          const resolved = images.filter((item) => item.number === slide.number)
          if (resolved.length === 0) return slide

          const newImages = resolved.map((image) => toSelectedImage(image))
          const existingIds = new Set(slide.selectedImages.map((img) => img.id))
          const merged = [
            ...slide.selectedImages,
            ...newImages.filter((img) => !existingIds.has(img.id)),
          ]
          return syncPrimaryImage(slide, merged)
        }),
      },
    }));
  },

  setSlideImageQuery(number, imageQuery) {
    set((state) => ({
      work: {
        ...state.work,
        pptxCode: null,
        pptxBuildError: null,
        slides: state.work.slides.map((slide) =>
          slide.number === number
            ? {
                ...slide,
                imageQuery,
                imageQueries: normalizeImageQueries(imageQuery),
              }
            : slide,
        ),
      },
    }));
  },

  removeSlideImage(number, imageId) {
    set((state) => ({
      work: {
        ...state.work,
        pptxCode: null,
        pptxBuildError: null,
        slides: state.work.slides.map((slide) => {
          if (slide.number !== number) return slide
          return syncPrimaryImage(slide, slide.selectedImages.filter((image) => image.id !== imageId))
        }),
      },
    }))
  },

  setDesignStyle(style) {
    set((state) => ({
      work: {
        ...state.work,
        designStyle: style,
        designBrief: state.work.designBrief
          ? { ...state.work.designBrief, visualStyle: style ?? state.work.designBrief.visualStyle }
          : state.work.designBrief,
        // Clear template when switching away from Custom Template
        ...(style !== 'Custom Template' ? { templatePath: null, templateMeta: null } : {}),
      },
    }));
  },

  setFramework(fw) {
    set((state) => ({
      work: { ...state.work, framework: fw, phase: state.work.phase === 'empty' ? 'planning' : state.work.phase },
    }));
  },

  setCustomFrameworkPrompt(customFrameworkPrompt) {
    set((state) => ({
      work: { ...state.work, customFrameworkPrompt, phase: state.work.phase === 'empty' ? 'planning' : state.work.phase },
    }));
  },

  setTemplatePath(templatePath) {
    set((state) => ({
      work: { ...state.work, templatePath },
    }));
  },

  setTemplateMeta(templateMeta) {
    set((state) => ({
      work: { ...state.work, templateMeta },
    }));
  },

  setStreaming(v) {
    set((state) => ({ work: { ...state.work, isStreaming: v } }));
  },

  setPptxBusy(v) {
    set((state) => ({ work: { ...state.work, isPptxBusy: v } }));
  },

  setThinking(delta) {
    set((state) => ({
      work: { ...state.work, thinking: (state.work.thinking ?? '') + delta },
    }));
  },

  appendChatContent(_delta) {
    // Chat content is handled by the chat store; this is a no-op
  },

  setPptxCode(code) {
    set((state) => ({ work: { ...state.work, pptxCode: code, pptxBuildError: null, phase: 'ready' } }));
  },

  setPptxBuildError(error) {
    set((state) => ({ work: { ...state.work, pptxBuildError: error } }));
  },

  reset() {
    set({ work: initial });
  },

  moveSlide(from, to) {
    set((state) => {
      const slides = [...state.work.slides];
      const [item] = slides.splice(from - 1, 1);
      slides.splice(to - 1, 0, item);
      const renumbered = slides.map((s, i) => ({ ...s, number: i + 1 }));
      return { work: { ...state.work, slides: renumbered } };
    });
  },

  deleteSlide(number) {
    set((state) => {
      const slides = state.work.slides
        .filter((s) => s.number !== number)
        .map((s, i) => ({ ...s, number: i + 1 }));
      return { work: { ...state.work, slides } };
    });
  },

  moveToAppendix(number) {
    set((state) => {
      const idx = state.work.slides.findIndex((s) => s.number === number);
      if (idx === -1) return state;
      const slides = [...state.work.slides];
      const [item] = slides.splice(idx, 1);
      slides.push({ ...item, accent: 'orange' });
      const renumbered = slides.map((s, i) => ({ ...s, number: i + 1 }));
      return { work: { ...state.work, slides: renumbered } };
    });
  },
}),
  {
    name: 'pptx-slides-work',
    storage: createJSONStorage(() => sessionStorage),
    partialize: (state) => ({
      work: { ...state.work, isStreaming: false, isPptxBusy: false, thinking: null },
    }),
  },
));

/** Tiny alias for easier import */
function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}
