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
import { createAssistantMessage, createUserMessage, historyToIpc, extractPptxCodeBlock } from './application/chat-use-case.ts'
import { applyThemeColorTreatment, applyThemeFontFamily } from './application/palette-use-case.ts'
import type { WorkspaceContext } from './application/chat-use-case.ts'
import { getAvailableIconChoices } from './domain/icons/iconify.ts'
import { getWorkflowConfig } from './domain/workflows/workflow-config.ts'
import type { FrameworkType } from './domain/entities/slide-work'

const MAX_AUTO_RETRIES = 3

interface QaReport {
  contrastFixes: number
  missingIcons: Array<{ icon: string; reason: string }>
  missingImages: string[]
  layoutIssues: Array<{ slide: number; type: string; severity: string; message: string }>
}

function hasBlockingQaFindings(qa: QaReport): boolean {
  if (qa.missingIcons.length > 0) return true
  if (qa.missingImages.length > 0) return true
  if (qa.layoutIssues.some((i) => i.severity === 'error')) return true
  return false
}

function formatQaSummary(qa: QaReport): string {
  const parts: string[] = []
  if (qa.contrastFixes > 0) parts.push(`Contrast: ${qa.contrastFixes} fix(es) applied automatically.`)
  if (qa.missingIcons.length > 0) parts.push(`Missing icons: ${qa.missingIcons.map((i) => i.icon).join(', ')}.`)
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
  const chunkedPptxReady = useRef(false)

  const retryWithBuildError = (errMsg: string) => {
    if (autoRetryCount.current >= MAX_AUTO_RETRIES) {
      useChatStore.getState().addMessage(
        createAssistantMessage(`🛑 Gave up after ${MAX_AUTO_RETRIES} automatic retries. Please review the error and try again manually.`),
      )
      useSlidesStore.getState().setStreaming(false)
      useSlidesStore.getState().setPptxBusy(false)
      return
    }
    autoRetryCount.current += 1
    const attempt = autoRetryCount.current

    useChatStore.getState().addMessage(
      createAssistantMessage(`🔄 Auto-retry ${attempt}/${MAX_AUTO_RETRIES} — sending the error back to the agent…`),
    )

    const retryPrompt = `The PPTX generation failed with the following error. Please fix the code and try again:\n\n${errMsg}`
    const userMsg = createUserMessage(retryPrompt)
    useChatStore.getState().addMessage(userMsg)
    useSlidesStore.getState().setStreaming(true)
    useSlidesStore.getState().setPptxBusy(true)

    const { work } = useSlidesStore.getState()
    const { tokens, selectedFont, selectedColorTreatment, selectedIconCollection } = usePaletteStore.getState()
    const { files: dataSources, urls: urlSources } = useDataSourcesStore.getState()
    const availableIcons = getAvailableIconChoices(selectedIconCollection)
    const workflow = getWorkflowConfig('create-pptx')

    const workspaceContext: WorkspaceContext = {
      title: work.title,
      slides: work.slides,
      designBrief: work.designBrief,
      designStyle: work.designStyle,
      framework: work.framework,
      customFrameworkPrompt: work.customFrameworkPrompt,
      templateMeta: work.templateMeta,
      pptxBuildError: errMsg,
      theme: applyThemeColorTreatment(
        applyThemeFontFamily(tokens, selectedFont),
        selectedColorTreatment,
      ),
      workflow,
      dataSources,
      urlSources,
      iconProvider: 'iconify',
      iconCollection: selectedIconCollection,
      availableIcons,
      includeImagesInLayout: work.includeImagesInLayout,
    }

    window.electronAPI.chat.send(retryPrompt, historyToIpc([...useChatStore.getState().messages]), workspaceContext)
  }

  const triggerPostStaging = (qa: QaReport) => {
    const summary = formatQaSummary(qa)
    const workflow = getWorkflowConfig('poststaging')

    useChatStore.getState().addMessage(
      createAssistantMessage(`🔍 Running post-staging QA…\n\n${summary}`),
    )

    const prompt = `${workflow.triggerPrompt}\n\n## QA Report\n\n${summary}`
    const userMsg = createUserMessage(prompt)
    useChatStore.getState().addMessage(userMsg)
    useSlidesStore.getState().setStreaming(true)
    useSlidesStore.getState().setPptxBusy(true)

    const { work } = useSlidesStore.getState()
    const { tokens, selectedFont, selectedColorTreatment, selectedIconCollection } = usePaletteStore.getState()
    const { files: dataSources, urls: urlSources } = useDataSourcesStore.getState()
    const availableIcons = getAvailableIconChoices(selectedIconCollection)

    const workspaceContext: WorkspaceContext = {
      title: work.title,
      slides: work.slides,
      designBrief: work.designBrief,
      designStyle: work.designStyle,
      framework: work.framework,
      customFrameworkPrompt: work.customFrameworkPrompt,
      templateMeta: work.templateMeta,
      pptxBuildError: null,
      theme: applyThemeColorTreatment(
        applyThemeFontFamily(tokens, selectedFont),
        selectedColorTreatment,
      ),
      workflow,
      dataSources,
      urlSources,
      iconProvider: 'iconify',
      iconCollection: selectedIconCollection,
      availableIcons,
      includeImagesInLayout: work.includeImagesInLayout,
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
      api.chat.onChunkProgress(() => {
        // Progress updates are shown via chat:stream; no extra action needed.
      }),
      api.chat.onChunkedPptxReady(({ code }) => {
        // Chunked execution produced the merged PPTX and attempted preview rendering.
        // Set the flag so onDone skips re-execution via pptx:renderPreview.
        chunkedPptxReady.current = true
        useSlidesStore.getState().setPptxCode(code)
        useSlidesStore.getState().setPptxBuildError(null)
        autoRetryCount.current = 0
        // Chunked path: images were rendered server-side; let CenterArea re-read from disk.
        window.dispatchEvent(new CustomEvent('pptx-preview-ready', { detail: { imagePaths: [] } }))
        useChatStore.getState().addMessage(
          createAssistantMessage('✅ Deck generated! Preview images are ready.'),
        )
        useSlidesStore.getState().setStreaming(false)
        useSlidesStore.getState().setPptxBusy(false)
      }),
      api.chat.onDone(() => {
        // Flush buffered deltas first, then capture the complete content
        useChatStore.getState().flushAssistantMessage()
        const lastMessage = useChatStore.getState().messages.at(-1)
        const pendingContent = lastMessage?.role === 'assistant' ? lastMessage.content : ''

        requestAnimationFrame(() => {
          // Chunked generation already produced the merged PPTX and previews.
          // The onChunkedPptxReady handler took care of everything — skip
          // re-execution which would overwrite the merged result.
          if (chunkedPptxReady.current) {
            chunkedPptxReady.current = false
            return
          }

          const hasCodeBlock = /```(?:python|py)?\s*[\s\S]*?```/i.test(pendingContent)
          const code = extractPptxCodeBlock(pendingContent)

          if (code) {
            useSlidesStore.getState().setPptxCode(code)
            useSlidesStore.getState().setPptxBuildError(null)

            // Auto-execute the generated code to produce PPTX + preview PNGs in workspace
            const { tokens, selectedFont, selectedColorTreatment, selectedIconCollection } = usePaletteStore.getState()
            const paletteTokens = applyThemeColorTreatment(
              applyThemeFontFamily(tokens, selectedFont),
              selectedColorTreatment,
            )
            const currentWork = useSlidesStore.getState().work
            const pptxTitle = currentWork.title || 'presentation'
            useChatStore.getState().addMessage(
              createAssistantMessage('✅ PowerPoint code is ready. Generating the deck and preview images…'),
            )
            window.electronAPI.pptx.renderPreview(code, paletteTokens, pptxTitle, selectedIconCollection, currentWork.slides, currentWork.templateMeta)
              .then((result) => {
                if (result.success) {
                  autoRetryCount.current = 0
                  // Pass the exact image paths from the renderPreview result so
                  // CenterArea can update immediately without a second disk read.
                  window.dispatchEvent(new CustomEvent('pptx-preview-ready', {
                    detail: { imagePaths: result.imagePaths ?? [] },
                  }))

                  // Check QA report — trigger post-staging if blocking findings exist
                  const qa = result.qa as QaReport | undefined
                  if (qa && hasBlockingQaFindings(qa)) {
                    const summary = formatQaSummary(qa)
                    useChatStore.getState().addMessage(
                      createAssistantMessage(`✅ Deck generated, but post-staging QA found issues:\n\n${summary}`),
                    )
                    triggerPostStaging(qa)
                  } else {
                    const warningNote = result.warning ? `\n\n⚠️ ${result.warning}` : ''
                    const qaSuffix = qa && qa.contrastFixes > 0
                      ? `\n\nℹ️ Post-staging QA: ${qa.contrastFixes} contrast fix(es) applied automatically.`
                      : ''
                    useChatStore.getState().addMessage(
                      createAssistantMessage(`✅ Deck generated! Preview images are ready.${warningNote}${qaSuffix}`),
                    )
                    useSlidesStore.getState().setStreaming(false)
                    useSlidesStore.getState().setPptxBusy(false)
                  }
                } else {
                  const errMsg = result.error ?? result.warning ?? 'Unknown error'
                  useSlidesStore.getState().setPptxBuildError(errMsg)
                  useChatStore.getState().addMessage(
                    createAssistantMessage(`⚠️ Deck generation failed: ${errMsg}`),
                  )
                  retryWithBuildError(errMsg)
                }
              })
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err)
                useSlidesStore.getState().setPptxBuildError(msg)
                useChatStore.getState().addMessage(
                  createAssistantMessage(`⚠️ Deck generation failed: ${msg}`),
                )
                retryWithBuildError(msg)
              })
          } else {
            useSlidesStore.getState().setStreaming(false)
            useSlidesStore.getState().setPptxBusy(false)
            const message = hasCodeBlock
              ? 'The model returned code, but it did not match a supported python-pptx script.'
              : null
            useSlidesStore.getState().setPptxBuildError(message)
            if (message) {
              useChatStore.getState().addMessage(createAssistantMessage(message))
            }
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
