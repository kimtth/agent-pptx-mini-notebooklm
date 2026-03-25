import { readFileSync, existsSync } from 'fs'
import { resolveBundledPath } from '../project/workspace-utils.ts'

export type SystemPromptMode = 'pptx' | 'story'

type PromptSection = {
  title: string
  items: string[]
}

type PromptProfile = {
  sections: PromptSection[]
}

type SystemPromptConfig = {
  pptx: PromptProfile
  story: PromptProfile
}

type PromptRuntimeValues = {
  workflowDirective?: string
  storyFrameworkInstruction?: string
  workspaceDir?: string
  imagesDir?: string
}

let cachedConfig: SystemPromptConfig | null = null

function resolveSystemPromptConfigPath(): string {
  const candidate = resolveBundledPath('workflows', 'system-prompts.json')
  if (existsSync(candidate)) return candidate
  return resolveBundledPath('workflows', 'system-prompts.json')
}

function loadSystemPromptConfig(): SystemPromptConfig {
  if (cachedConfig) return cachedConfig
  const raw = readFileSync(resolveSystemPromptConfigPath(), 'utf-8')
  cachedConfig = JSON.parse(raw) as SystemPromptConfig
  return cachedConfig
}

function interpolateTemplate(value: string, runtime: PromptRuntimeValues): string {
  return value
    .replaceAll('{{workspaceDir}}', runtime.workspaceDir ?? '')
    .replaceAll('{{imagesDir}}', runtime.imagesDir ?? '')
}

function formatPromptSections(sections: PromptSection[], runtime: PromptRuntimeValues): string {
  return sections
    .filter((section) => section.items.some((item) => interpolateTemplate(item, runtime).trim()))
    .map((section) => {
      const items = section.items
        .map((item) => interpolateTemplate(item, runtime).trim())
        .filter(Boolean)
        .map((item) => `- ${item}`)
        .join('\n')
      return `## ${section.title}\n${items}`
    })
    .join('\n\n')
}

export function buildManagedSystemPrompt(mode: SystemPromptMode, runtime: PromptRuntimeValues): string {
  const config = loadSystemPromptConfig()
  const runtimeSections: PromptSection[] = []

  if (runtime.workflowDirective?.trim()) {
    runtimeSections.push({
      title: 'WORKFLOW DIRECTIVE',
      items: [runtime.workflowDirective.trim()],
    })
  }

  if (mode === 'story' && runtime.storyFrameworkInstruction?.trim()) {
    runtimeSections.push({
      title: 'FRAMEWORK RULE',
      items: [runtime.storyFrameworkInstruction.trim()],
    })
  }

  return formatPromptSections([...runtimeSections, ...config[mode].sections], runtime)
}
