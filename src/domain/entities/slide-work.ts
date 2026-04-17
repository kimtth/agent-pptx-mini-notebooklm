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
  | 'table'
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

export type SlideChartType = 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'area';

export interface SlideAnalysisMeta {
  chartType?: SlideChartType;
  caption?: string;
  source?: string;
  unit?: string;
  aggregation?: string;
  confidence?: string;
  analysisSummary?: string;
}

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
  analysisMeta?: SlideAnalysisMeta;
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


export type SlidePhase = 'empty' | 'planning' | 'story' | 'generating' | 'ready';

export interface SlideWork {
  phase: SlidePhase;
  activeWorkflowId: 'prestaging' | 'create-pptx' | 'poststaging' | null;
  title: string;
  story: SlideStory | null;
  designBrief: DesignBrief | null;
  designStyle: DesignStyle | null;
  customBackgroundColor: string | null;
  framework: FrameworkType | null;
  customFrameworkPrompt: string | null;

  slides: SlideItem[];
  thinking: string | null;
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
    analysisMeta?: SlideAnalysisMeta;
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
  analysisMeta?: SlideAnalysisMeta;
  icon?: string;
  imageQuery?: string;
  imageQueries?: string[];
}
