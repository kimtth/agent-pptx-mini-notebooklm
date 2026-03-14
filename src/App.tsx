import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { ThreePanelLayout } from './components/layout/ThreePanelLayout.tsx'
import { ChatPanel } from './components/chat/ChatPanel.tsx'
import { CenterArea } from './components/preview/CenterArea.tsx'
import { WorkspacePanel } from './components/workspace/WorkspacePanel.tsx'
import { WorkspaceAreaButton } from './components/workspace/WorkspaceAreaButton.tsx'
import { SettingsModal } from './components/settings/SettingsModal.tsx'
import { useChatStore } from './stores/chat-store.ts'
import { useSlidesStore } from './stores/slides-store.ts'
import { useProjectStore } from './stores/project-store.ts'
import { createAssistantMessage, extractPptxCodeBlock } from './application/chat-use-case.ts'
import type { FrameworkType } from './domain/entities/slide-work'

export default function App() {
  const messages = useChatStore((s) => s.messages)
  const work = useSlidesStore((s) => s.work)
  const workspaceDir = useProjectStore((s) => s.workspaceDir)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
        // Flush buffered deltas first, then capture the complete content
        useChatStore.getState().flushAssistantMessage()
        const lastMessage = useChatStore.getState().messages.at(-1)
        const pendingContent = lastMessage?.role === 'assistant' ? lastMessage.content : ''
        useSlidesStore.getState().setStreaming(false)

        requestAnimationFrame(() => {
          const hasCodeBlock = /```(?:python|py)?\s*[\s\S]*?```/i.test(pendingContent)
          const code = extractPptxCodeBlock(pendingContent)

          if (code) {
            useSlidesStore.getState().setPptxCode(code)
            useSlidesStore.getState().setPptxBuildError(null)
          } else {
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
