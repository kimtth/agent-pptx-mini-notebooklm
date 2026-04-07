/**
 * Domain Entities: Slide Work
 * Portable between main and renderer via IPC serialization.
 */

export interface SlideStory {
  intro: string;
  storyContent: string;
}

export type DesignStyle = import('../design-styles').DesignStyle;

export interface DesignBrief {
  objective: string;
  audience: string;
  tone: string;
  visualStyle: string;
  colorMood: string;
  density: string;
  layoutApproach: string;
  directions: string[];
}

export type SlideLayout =
  | 'title'
  | 'agenda'
  | 'section'
  | 'bullets'
  | 'cards'
  | 'stats'
  | 'comparison'
  | 'timeline'
  | 'diagram'
  | 'summary'
  | 'chart'
  | 'closing'
  | 'photo_fullbleed'
  | 'multi_column'
  | 'content_caption'
  | 'picture_caption'
  | 'two_content'
  | 'title_only'
  | 'quote'
  | 'big_number'
  | 'process'
  | 'pyramid';

export type FrameworkType =
  | 'mckinsey'
  | 'scqa'
  | 'pyramid'
  | 'mece'
  | 'action-title'
  | 'assertion-evidence'
  | 'exec-summary-first'
  | 'custom-prompt';

export interface SlideSelectedImage {
  id: string;
  imageQuery: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imageAttribution: string | null;
  sourcePageUrl: string | null;
  thumbnailUrl: string | null;
}

export interface SlideItem {
  id: string;
  number: number;
  title: string;
  keyMessage: string;
  layout: SlideLayout;
  bullets: string[];
  notes: string;
  icon: string | null;
  imageQuery: string | null;
  imageQueries: string[];
  imageUrl: string | null;
  imagePath: string | null;
  imageAttribution: string | null;
  selectedImages: SlideSelectedImage[];
  code: string | null;
  accent: 'blue' | 'green' | 'purple' | 'teal' | 'orange';
}

export interface TemplateMeta {
  themeColors: {
    dk1: string; lt1: string; dk2: string; lt2: string;
    accent1: string; accent2: string; accent3: string;
    accent4: string; accent5: string; accent6: string;
    hlink: string; folHlink: string;
  };
  backgroundImages: string[];
  blankLayoutIndex: number;
  fonts: { major: string; minor: string };
  originalDimensions: { widthIn: number; heightIn: number };
}

export type SlidePhase = 'empty' | 'planning' | 'story' | 'generating' | 'ready';

export interface SlideWork {
  phase: SlidePhase;
  title: string;
  story: SlideStory | null;
  designBrief: DesignBrief | null;
  designStyle: DesignStyle | null;
  framework: FrameworkType | null;
  customFrameworkPrompt: string | null;
  templatePath: string | null;
  templateMeta: TemplateMeta | null;
  slides: SlideItem[];
  pptxCode: string | null;
  pptxBuildError: string | null;
  thinking: string | null;
  includeImagesInLayout: boolean;
  isStreaming: boolean;
  isPptxBusy: boolean;
}

/** Scenario payload emitted by set_scenario tool */
export interface ScenarioPayload {
  title: string;
  slides: Array<{
    number: number;
    title: string;
    keyMessage: string;
    layout: string;
    bullets: string[];
    notes: string;
    icon?: string;
    imageQuery?: string;
    imageQueries?: string[];
  }>;
  designBrief?: DesignBrief;
  framework?: FrameworkType;
}

/** Slide update payload emitted by update_slide tool */
export interface SlideUpdatePayload {
  number: number;
  title: string;
  keyMessage: string;
  layout: string;
  bullets: string[];
  notes: string;
  icon?: string;
  imageQuery?: string;
  imageQueries?: string[];
}
