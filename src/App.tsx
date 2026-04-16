import { useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { ThreePanelLayout } from './components/layout/ThreePanelLayout.tsx'
import { ChatPanel } from './components/chat/ChatPanel.tsx'
import { CenterArea } from './components/preview/CenterArea.tsx'
import { WorkspacePanel } from './components/workspace/WorkspacePanel.tsx'
import { WorkspaceAreaButton } from './components/workspace/WorkspaceAreaButton.tsx'
import { SettingsModal } from './components/settings/SettingsModal.tsx'
import { useChatStore } from './stores/chat-store.ts'
import { useSlidesStore } from './stores/slides-store.ts'
import { usePaletteStore } from './stores/palette-store.ts'
import { useProjectStore } from './stores/project-store.ts'
import { useDataSourcesStore } from './stores/data-sources-store.ts'
import { createAssistantMessage, createUserMessage, historyToIpc } from './application/chat-use-case.ts'
import { applyThemeBackground, applyThemeColorTreatment, applyThemeFontFamily, applyThemeSlideIcons, applyThemeTextBoxCornerStyle, applyThemeTextBoxStyle } from './application/palette-use-case.ts'
import type { WorkspaceContext } from './application/chat-use-case.ts'
import { getAvailableIconChoices } from './domain/icons/iconify.ts'
import { getWorkflowConfig } from './domain/workflows/workflow-config.ts'
import type { FrameworkType } from './domain/entities/slide-work'

const MAX_AUTO_RETRIES = 3

interface QaReport {
  contrastFixes: number
  missingIcons: Array<{ icon: string; reason: string }>
  rejectedIcons: Array<{ icon: string; reason: string }>
  iconStats: { requested: number; missing: number; missingRatio: number; rejectedByCollection?: number; rejectedRatio?: number }
  missingImages: string[]
  layoutIssues: Array<{ slide: number; type: string; severity: string; message: string }>
}

function summarizeMissingIcons(missingIcons: QaReport['missingIcons']): string {
  const counts = new Map<string, number>()
  for (const entry of missingIcons) {
    counts.set(entry.icon, (counts.get(entry.icon) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([icon, count]) => (count > 1 ? `${icon} x${count}` : icon))
    .join(', ')
}

function formatQaSummary(qa: QaReport): string {
  const parts: string[] = []
  if (qa.contrastFixes > 0) parts.push(`Contrast: ${qa.contrastFixes} fix(es) applied automatically.`)
  if (qa.rejectedIcons.length > 0) {
    const requested = qa.iconStats?.requested ?? qa.rejectedIcons.length
    const rejected = qa.iconStats?.rejectedByCollection ?? qa.rejectedIcons.length
    const rejectedRatio = qa.iconStats?.rejectedRatio ?? (requested > 0 ? rejected / requested : 0)
    const percent = Math.round(rejectedRatio * 100)
    parts.push(`Icons rejected by selected collection (${rejected}/${requested}, ${percent}%): ${summarizeMissingIcons(qa.rejectedIcons)}.`)
  }
  if (qa.missingIcons.length > 0) {
    const requested = qa.iconStats?.requested ?? qa.missingIcons.length
    const missing = qa.iconStats?.missing ?? qa.missingIcons.length
    const missingRatio = qa.iconStats?.missingRatio ?? (requested > 0 ? missing / requested : 0)
    const severity = missingRatio >= 0.7 ? 'blocking' : 'warning'
    const percent = Math.round(missingRatio * 100)
    parts.push(`Missing icons (${severity}, ${missing}/${requested}, ${percent}% missing): ${summarizeMissingIcons(qa.missingIcons)}.`)
  }
  if (qa.missingImages.length > 0) parts.push(`Missing images: ${qa.missingImages.join('; ')}.`)
  const errors = qa.layoutIssues.filter((i) => i.severity === 'error')
  const warnings = qa.layoutIssues.filter((i) => i.severity === 'warning')
  if (errors.length > 0) parts.push(`Layout errors (${errors.length}): ${errors.map((i) => `Slide ${i.slide} — ${i.message}`).join('; ')}.`)
  if (warnings.length > 0) parts.push(`Layout warnings (${warnings.length}): ${warnings.map((i) => `Slide ${i.slide} — ${i.message}`).join('; ')}.`)
  return parts.length > 0 ? parts.join('\n') : 'No QA issues found.'
}

export default function App() {
  const messages = useChatStore((s) => s.messages)
  const work = useSlidesStore((s) => s.work)
  const workspaceDir = useProjectStore((s) => s.workspaceDir)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const autoRetryCount = useRef(0)
  const postStagingActive = useRef(false)

  const triggerPostStaging = (qa: QaReport) => {
    const summary = formatQaSummary(qa)
    const workflow = getWorkflowConfig('poststaging')

    useChatStore.getState().addMessage(
      createAssistantMessage(`🔍 Running post-staging QA…\n\n${summary}`),
    )

    const prompt = `${workflow.triggerPrompt}\n\n## QA Report\n\n${summary}`
    const userMsg = createUserMessage(prompt)
    useChatStore.getState().addMessage(userMsg)
    postStagingActive.current = true
    useSlidesStore.getState().setStreaming(true)
    useSlidesStore.getState().setPptxBusy(true)

    const { work } = useSlidesStore.getState()
    const { tokens, selectedFont, selectedColorTreatment, selectedTextBoxStyle, selectedTextBoxCornerStyle, selectedIconCollection, selectedSlideIcons, styleTone } = usePaletteStore.getState()
    const { files: dataSources, urls: urlSources } = useDataSourcesStore.getState()
    const availableIcons = getAvailableIconChoices(selectedIconCollection)

    const workspaceContext: WorkspaceContext = {
      title: work.title,
      slides: work.slides,
      designBrief: work.designBrief,
      designStyle: work.designStyle,
      customBackgroundColor: work.customBackgroundColor,
      framework: work.framework,
      customFrameworkPrompt: work.customFrameworkPrompt,
      templateMeta: work.templateMeta,
      theme: applyThemeSlideIcons(
        applyThemeTextBoxCornerStyle(
          applyThemeTextBoxStyle(
            applyThemeColorTreatment(
              applyThemeFontFamily(
                applyThemeBackground(tokens, work.designStyle, styleTone, work.customBackgroundColor),
                selectedFont,
                work.designStyle,
              ),
              selectedColorTreatment,
            ),
            selectedTextBoxStyle,
          ),
          selectedTextBoxCornerStyle,
        ),
        selectedSlideIcons,
      ),
      workflow,
      dataSources,
      urlSources,
      iconProvider: 'iconify',
      iconCollection: selectedIconCollection,
      availableIcons,
    }

    window.electronAPI.chat.send(prompt, historyToIpc([...useChatStore.getState().messages]), workspaceContext)
  }

  useEffect(() => {
    const api = window.electronAPI

    const unsubs = [
      api.chat.onStream((delta) => {
        if (delta.content) useChatStore.getState().appendContent(delta.content)
        if (delta.thinking) useChatStore.getState().appendThinking(delta.thinking)
      }),
      api.chat.onScenario((payload) => {
        useSlidesStore.getState().applyScenario(payload)
      }),
      api.chat.onSlideUpdate((slide) => {
        useSlidesStore.getState().applySlideUpdate(slide)
      }),
      api.chat.onFrameworkSuggested((payload) => {
        useSlidesStore.getState().setFramework(payload.primary as FrameworkType)
      }),
      api.chat.onDone(() => {
        // Flush buffered deltas
        useChatStore.getState().flushAssistantMessage()

        requestAnimationFrame(() => {
          // Post-staging QA just finished — do NOT re-trigger renderPreview
          // or we enter an infinite generate→QA→generate loop.
          if (postStagingActive.current) {
            postStagingActive.current = false
            useSlidesStore.getState().setStreaming(false)
            useSlidesStore.getState().setPptxBusy(false)
            return
          }

          const currentWork = useSlidesStore.getState().work
          const isPptxMode = currentWork.isPptxBusy

          if (isPptxMode && currentWork.slides.length > 0) {
            // Deterministic renderer: use designStyle + layout data, no code extraction needed
            const { tokens, selectedFont, selectedColorTreatment, selectedTextBoxStyle, selectedTextBoxCornerStyle, selectedIconCollection, selectedSlideIcons, styleTone } = usePaletteStore.getState()
            const paletteTokens = applyThemeSlideIcons(
              applyThemeTextBoxCornerStyle(
                applyThemeTextBoxStyle(
                  applyThemeColorTreatment(
                    applyThemeFontFamily(
                      applyThemeBackground(tokens, currentWork.designStyle, styleTone, currentWork.customBackgroundColor),
                      selectedFont,
                      currentWork.designStyle,
                    ),
                    selectedColorTreatment,
                  ),
                  selectedTextBoxStyle,
                ),
                selectedTextBoxCornerStyle,
              ),
              selectedSlideIcons,
            )
            const pptxTitle = currentWork.title || 'presentation'
            useChatStore.getState().addMessage(
              createAssistantMessage('✅ Generating the deck…'),
            )
            window.electronAPI.pptx.renderPreview(
              currentWork.designStyle,
              paletteTokens,
              pptxTitle,
              selectedIconCollection,
              currentWork.slides,
              currentWork.templateMeta,
              currentWork.customBackgroundColor,
            )
              .then((result) => {
                if (result.success) {
                  autoRetryCount.current = 0

                  // Notify CenterArea about preview images so they display immediately
                  window.dispatchEvent(new CustomEvent('pptx-preview-ready', { detail: { imagePaths: result.imagePaths ?? [] } }))

                  const qa = result.qa as QaReport | undefined
                  if (qa) {
                    triggerPostStaging(qa)
                  } else {
                    const warningNote = result.warning ? `\n\n⚠️ ${result.warning}` : ''
                    useChatStore.getState().addMessage(
                      createAssistantMessage(`✅ Deck generated!${warningNote}`),
                    )
                    useSlidesStore.getState().setStreaming(false)
                    useSlidesStore.getState().setPptxBusy(false)
                  }
                } else {
                  const errMsg = result.error ?? result.warning ?? 'Unknown error'
                  useChatStore.getState().addMessage(
                    createAssistantMessage(`⚠️ Deck generation failed: ${errMsg}`),
                  )
                  useSlidesStore.getState().setStreaming(false)
                  useSlidesStore.getState().setPptxBusy(false)
                }
              })
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err)
                useChatStore.getState().addMessage(
                  createAssistantMessage(`⚠️ Deck generation failed: ${msg}`),
                )
                useSlidesStore.getState().setStreaming(false)
                useSlidesStore.getState().setPptxBusy(false)
              })
          } else {
            useSlidesStore.getState().setStreaming(false)
            useSlidesStore.getState().setPptxBusy(false)
          }
        })
      }),
      api.chat.onError((msg) => {
        useChatStore.getState().appendContent(`\n\n⚠️ ${msg}`)
        useChatStore.getState().flushAssistantMessage()
        useSlidesStore.getState().setStreaming(false)
        useSlidesStore.getState().setPptxBusy(false)
      }),
    ]

    return () => unsubs.forEach((u) => u())
  }, [])

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: 'var(--panel-bg)' }}>
      {/* Top bar */}
      <div
        className="flex-none flex items-center justify-between px-4 border-b"
        style={{
          height: 40,
          minHeight: 40,
          background: 'var(--surface)',
          borderColor: 'var(--panel-border)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          PPTX Slide Agent
          {workspaceDir && (
            <span
              className="font-normal truncate max-w-70w"
              style={{ opacity: 0.45 }}
              title={workspaceDir}
            >
              {workspaceDir.replace(/\\/g, '/')}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WorkspaceAreaButton />
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center justify-center w-7 h-7 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Settings"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* Three-panel workspace */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ThreePanelLayout
          left={<ChatPanel />}
          center={<CenterArea />}
          right={<WorkspacePanel />}
        />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
