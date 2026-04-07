import type { FrameworkType } from './entities/slide-work'

export const FRAMEWORK_OPTIONS: Array<{ value: FrameworkType; label: string; description: string }> = [
  {
    value: 'mckinsey',
    label: 'McKinsey',
    description: 'Executive recommendation deck with conclusion-first slides and crisp supporting evidence.',
  },
  {
    value: 'scqa',
    label: 'SCQA',
    description: 'Situation, complication, question, answer. Useful for narrative problem-solving presentations.',
  },
  {
    value: 'pyramid',
    label: 'Pyramid',
    description: 'Top-down argument structure that starts with the answer and supports it with grouped reasons.',
  },
  {
    value: 'mece',
    label: 'MECE',
    description: 'Breaks the problem into mutually exclusive, collectively exhaustive buckets.',
  },
  {
    value: 'action-title',
    label: 'Action Title',
    description: 'Every slide title states the takeaway or decision directly.',
  },
  {
    value: 'assertion-evidence',
    label: 'Assertion-Evidence',
    description: 'Pairs a clear claim with direct evidence, visuals, or data support.',
  },
  {
    value: 'exec-summary-first',
    label: 'Executive Summary First',
    description: 'Puts the headline conclusion and recommendation upfront for decision makers.',
  },
  {
    value: 'custom-prompt',
    label: 'Custom Prompt',
    description: 'Use your own framework instructions for how the story should be structured and written.',
  },
]

export function getFrameworkMeta(value: FrameworkType | null) {
  return FRAMEWORK_OPTIONS.find((item) => item.value === value) ?? null
}