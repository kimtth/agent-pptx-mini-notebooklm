export type WorkflowId = 'prestaging' | 'create-pptx' | 'poststaging'

export type WorkflowMode = 'story' | 'pptx'

export interface WorkflowConfig {
  id: WorkflowId
  label: string
  triggerLabel: string
  mode: WorkflowMode
  instructionFile: string
  summary: string
  goal: string
  steps: string[]
  agentDirective: string
  triggerPrompt: string
}

export const WORKFLOW_CONFIGS: Record<WorkflowId, WorkflowConfig> = {
  prestaging: {
    id: 'prestaging',
    label: 'Prestaging Workflow',
    triggerLabel: 'Brainstorm',
    mode: 'story',
    instructionFile: 'prestaging.md',
    summary: 'Understand source content, select a business framework, and stage the draft slide story in the workspace.',
    goal: 'Create preliminary slide definitions in the slide panel.',
    steps: [
      'Understand the available content, business objective, audience, and constraints.',
      'Confirm the desired business framework with the user, or present options if not yet specified.',
      'Generate or refine the preliminary slide scenario in the slide panel.',
      'Leave room for the user to tweak slides and attach images before PPTX creation.',
      'Do not trigger PPTX rendering in this workflow.',
    ],
    agentDirective: 'Use this workflow for content understanding and slide planning only. Produce or update the slide scenario in the workspace panel and stop before PPTX generation.',
    triggerPrompt: 'Start the prestaging workflow now. Understand the content. If the user has already selected a business framework (shown in Current Workspace), apply it directly — do NOT ask again. If no framework is set, present the options and ask the user to choose. Then generate the preliminary slide scenario in the slide panel. Do not trigger PPTX rendering in this step.',
  },
  'create-pptx': {
    id: 'create-pptx',
    label: 'Create PPTX Workflow',
    triggerLabel: 'Create PPTX',
    mode: 'pptx',
    instructionFile: 'create-pptx.md',
    summary: 'Render the final PPTX from approved slide inputs, theme, icons, and attached images via the deterministic renderer.',
    goal: 'Review design consistency, render the presentation, and let the app update the preview images.',
    steps: [
      'Use the approved slide panel content as the source of truth.',
      'Apply the selected icon set, theme, palette, and any images attached to each slide.',
      'Ensure contrast safety and readability.',
      'Trigger the deterministic renderer. The layout validator will catch overlap and overflow issues automatically.',
      'If validation fails, use patch_layout_infrastructure to fix the layout specs and rerun_pptx to re-render.',
    ],
    agentDirective: 'Use this workflow for final PPTX creation only. Trigger the deterministic renderer via the rerun_pptx tool. If layout validation fails, repair the layout specs using patch_layout_infrastructure and rerun.',
    triggerPrompt: 'Run the create PPTX workflow now. Use the approved slides, theme, icons, colors, and attached images. Trigger the deterministic renderer. If layout validation fails, repair the layout specs and rerun the render.',
  },
  poststaging: {
    id: 'poststaging',
    label: 'Post-Staging QA Workflow',
    triggerLabel: 'Post-Stage QA',
    mode: 'pptx',
    instructionFile: 'poststaging.md',
    summary: 'Automated QA pass after PPTX generation — checks contrast, missing icons/images, overlap, and text overflow.',
    goal: 'Review the structured QA report from the PPTX pipeline and either confirm the deck is ready or drive a targeted repair.',
    steps: [
      'Receive the structured QA report injected by the app after deck generation.',
      'Classify each finding as blocking, actionable, or informational.',
      'Present a concise per-slide QA summary to the user.',
      'If blocking issues exist (missing images, icon loss at 40%+ missing ratio, ERROR-level overlap/overflow), repair the layout infrastructure and rerun the render.',
      'If only actionable contrast issues remain, patch the relevant layout specs or slide assets and rerun.',
      'If all findings are clear, confirm the deck is ready.',
    ],
    agentDirective: 'Use this workflow for post-generation QA only. Inspect the QA report, summarize findings, and either confirm success or use patch_layout_infrastructure + rerun_pptx tools to fix issues. Do not regenerate the entire deck — target only the affected slides.',
    triggerPrompt: 'Run the post-staging QA workflow now. Review the QA report below for contrast violations, missing icons/images, layout overlaps, and text overflows. Treat missing icons as blocking only when the reported missing ratio is 40% or higher; otherwise keep the QA pass going and treat them as warnings. Summarize findings per slide, then either confirm the deck is ready or use the repair tools to fix remaining issues.',
  },
}

export function getWorkflowConfig(id: WorkflowId): WorkflowConfig {
  return WORKFLOW_CONFIGS[id]
}

export function formatWorkflowForPrompt(workflow: WorkflowConfig): string {
  return [
    `Workflow: ${workflow.label}`,
    `Summary: ${workflow.summary}`,
    `Goal: ${workflow.goal}`,
    'Required steps:',
    ...workflow.steps.map((step, index) => `${index + 1}. ${step}`),
    `Agent directive: ${workflow.agentDirective}`,
  ].join('\n')
}
