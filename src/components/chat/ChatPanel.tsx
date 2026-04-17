import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, X, ChevronDown, ChevronRight, FileCode2, Lightbulb, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../../stores/chat-store'
import { useSlidesStore } from '../../stores/slides-store'
import { usePaletteStore } from '../../stores/palette-store'
import { useDataSourcesStore } from '../../stores/data-sources-store'
import { createUserMessage, historyToIpc } from '../../application/chat-use-case'
import type { ChatToolEvent } from '../../domain/ports/ipc'
import { applyThemeBackground, applyThemeColorTreatment, applyThemeFontFamily, applyThemeSlideIcons, applyThemeTextBoxCornerStyle, applyThemeTextBoxStyle } from '../../application/palette-use-case'
import type { WorkspaceContext } from '../../application/chat-use-case'
import { getAvailableIconChoices } from '../../domain/icons/iconify'
import { getWorkflowConfig, type WorkflowId } from '../../domain/workflows/workflow-config'

/**
 * Safety net: the deterministic renderer handles all PPTX generation now,
 * so the LLM should never produce Python code blocks. If it does anyway
 * (e.g. prompt leakage or model drift), hide the raw code from the user
 * and show a short placeholder instead. This avoids confusing users who
 * might think they need to run or edit the Python themselves.
 */
function stripPythonCodeForDisplay(content: string): string {
  return content.replace(/```python[\s\S]*?```/g, '`[python code generated]`')
}

/** Completed assistant messages: full markdown, auto-collapse if >10 lines */
function AssistantMarkdownMessage({ content }: { content: string }) {
  const stripped = stripPythonCodeForDisplay(content)
  const lineCount = stripped.split(/\r?\n/).length
  const isLong = lineCount > 10
  const [expanded, setExpanded] = useState(!isLong)

  return (
    <div
      className="text-sm prose prose-sm max-w-none"
      style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)' }}
    >
      {isLong && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{lineCount} lines</span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 border px-2 py-1 text-[11px] font-semibold transition-colors"
            style={{ borderColor: 'var(--panel-border)', color: 'var(--text-primary)', background: 'var(--surface-hover)' }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{expanded ? 'Collapse' : 'Expand'}</span>
          </button>
        </div>
      )}
      {expanded && (
        <div className="px-4 py-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripped}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

/** Streaming content: plain text — no markdown parsing to keep UI responsive */
function StreamingTextMessage({ content }: { content: string }) {
  return (
    <pre
      className="px-4 py-3 text-sm whitespace-pre-wrap break-words leading-relaxed"
      style={{
        background: 'var(--surface)',
        color: 'var(--text-primary)',
        border: '1px solid var(--panel-border)',
        fontFamily: 'inherit',
      }}
    >
      {content}
    </pre>
  )
}

function ToolLogList({ logs, compact = false }: { logs: ChatToolEvent[]; compact?: boolean }) {
  if (logs.length === 0) return null

  const statusColor = (status: ChatToolEvent['status']) => {
    if (status === 'success') return 'var(--accent)'
    if (status === 'error') return '#dc2626'
    return 'var(--text-muted)'
  }

  return (
    <div className="flex flex-col gap-2">
      {logs.map((log) => (
        <div
          key={log.id}
          className="border px-3 py-2"
          style={{
            borderColor: 'var(--panel-border)',
            background: compact ? 'var(--surface-hover)' : 'rgba(15, 23, 42, 0.03)',
          }}
        >
          <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em]">
            <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{log.toolName}</span>
            <span className="font-semibold" style={{ color: statusColor(log.status) }}>
              {log.status === 'running' ? 'Running' : log.status === 'success' ? 'Done' : 'Failed'}
              {typeof log.durationMs === 'number' ? ` · ${Math.max(1, Math.round(log.durationMs / 100) / 10)}s` : ''}
            </span>
          </div>
          {log.argsPreview && (
            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              args: {log.argsPreview}
            </pre>
          )}
          {log.resultPreview && (
            <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              result: {log.resultPreview}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

/** Isolated component for streaming — subscribes to pending state independently */
function StreamingBubble({
  scrollRef,
  showToolCallingMessages,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  showToolCallingMessages: boolean
}) {
  const pendingContent = useChatStore((s) => s.pendingContent)
  const pendingThinking = useChatStore((s) => s.pendingThinking)
  const pendingToolLogs = useChatStore((s) => s.pendingToolLogs)
  const streaming = useSlidesStore((s) => s.work.isStreaming)

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!pendingContent && !pendingThinking) return
    if (scrollTimerRef.current) return
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 300)
  }, [pendingContent, pendingThinking, scrollRef])

  if (!streaming) return null

  if (!pendingContent && !pendingThinking && pendingToolLogs.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-widest px-1" style={{ color: 'var(--text-muted)' }}>
          Agent
        </span>
        <div className="px-4 py-3 border" style={{ background: 'var(--surface)', borderColor: 'var(--panel-border)' }}>
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-widest px-1" style={{ color: 'var(--text-muted)' }}>
        Agent
      </span>
      {pendingThinking && (
        <div
          className="text-xs px-4 py-3 border italic overflow-hidden"
          style={{ color: 'var(--text-secondary)', background: 'var(--surface-hover)', borderColor: 'var(--panel-border)', maxHeight: '12.5em', lineHeight: '1.5' }}
        >
          {pendingThinking.slice(-600)}
        </div>
      )}
      {showToolCallingMessages && pendingToolLogs.length > 0 && (
        <ToolLogList logs={pendingToolLogs} compact />
      )}
      {pendingContent && (
        <StreamingTextMessage content={stripPythonCodeForDisplay(pendingContent)} />
      )}
    </div>
  )
}

export function ChatPanel() {
  const [input, setInput] = useState('')
  const [showToolCallingMessages, setShowToolCallingMessages] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busyStartRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)

  const messages = useChatStore((s) => s.messages)
  const addMessage = useChatStore((s) => s.addMessage)
  const clearMessages = useChatStore((s) => s.clear)
  const removeMessage = useChatStore((s) => s.removeMessage)
  const streaming = useSlidesStore((s) => s.work.isStreaming)
  const pptxBusy = useSlidesStore((s) => s.work.isPptxBusy)
  const hasSlides = useSlidesStore((s) => s.work.slides.length > 0)
  const initializeForBrainstorm = useSlidesStore((s) => s.initializeForBrainstorm)
  const setActiveWorkflow = useSlidesStore((s) => s.setActiveWorkflow)
  const setStreaming = useSlidesStore((s) => s.setStreaming)
  const setPptxBusy = useSlidesStore((s) => s.setPptxBusy)
  const { tokens, selectedFont, selectedColorTreatment, selectedTextBoxStyle, selectedTextBoxCornerStyle, selectedIconCollection, styleTone } = usePaletteStore()
  const { files: dataSources, urls: urlSources } = useDataSourcesStore()
  const busy = streaming || pptxBusy

  useEffect(() => {
    if (!window.electronAPI?.settings) return

    const applySetting = (settings: Record<string, string>) => {
      setShowToolCallingMessages((settings.SHOW_TOOL_CALLING_MESSAGES ?? '0') === '1')
    }

    void window.electronAPI.settings.get().then(applySetting).catch(() => undefined)
    const unsubscribe = window.electronAPI.settings.onChanged(applySetting)
    return unsubscribe
  }, [])

  // Track elapsed time: tick every 30s while busy, snapshot on completion
  useEffect(() => {
    if (busy) {
      busyStartRef.current = Date.now()
      setElapsed(0)
      const id = setInterval(() => {
        setElapsed(Math.round((Date.now() - busyStartRef.current!) / 1000))
      }, 30_000)
      return () => clearInterval(id)
    } else if (busyStartRef.current !== null) {
      setElapsed(Math.round((Date.now() - busyStartRef.current) / 1000))
      busyStartRef.current = null
    }
  }, [busy])

  // Scroll for new completed messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (rawMessage: string, options?: { clearInput?: boolean; workflowId?: WorkflowId | null }) => {
    const msg = rawMessage.trim()
    if (!msg || streaming || pptxBusy) return
    if (options?.clearInput !== false) {
      setInput('')
    }
    setStreaming(true)

    const userMessage = createUserMessage(msg)
    addMessage(userMessage)

    const work = useSlidesStore.getState().work
    const availableIcons = getAvailableIconChoices(selectedIconCollection)
    const workflowId = options?.workflowId ?? null
    const workflow = workflowId ? getWorkflowConfig(workflowId) : null
    const effectiveTheme = applyThemeSlideIcons(
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
      usePaletteStore.getState().selectedSlideIcons,
    )

    const workspaceContext: WorkspaceContext = {
      title: work.title,
      slides: work.slides,
      designBrief: work.designBrief,
      designStyle: work.designStyle,
      customBackgroundColor: work.customBackgroundColor,
      framework: work.framework,
      customFrameworkPrompt: work.customFrameworkPrompt,
      theme: effectiveTheme,
      workflow,
      dataSources,
      urlSources,
      iconProvider: 'iconify',
      iconCollection: selectedIconCollection,
      availableIcons,
    }

    window.electronAPI.chat.send(msg, historyToIpc([...messages, userMessage]), workspaceContext)
  }

  const send = async () => {
    await sendMessage(input)
  }

  const brainstorm = async () => {
    if (busy) return
    const workflow = getWorkflowConfig('prestaging')
    setActiveWorkflow(workflow.id)
    initializeForBrainstorm()
    let prompt = input.trim()
    if (!prompt) {
      const fw = useSlidesStore.getState().work.framework
      const customFrameworkPrompt = useSlidesStore.getState().work.customFrameworkPrompt?.trim()
      prompt = fw
        ? fw === 'custom-prompt' && customFrameworkPrompt
          ? `Start the prestaging workflow now. The user has already chosen a custom business framework. Apply this custom framework prompt directly: "${customFrameworkPrompt}". Do NOT ask the user to choose a framework again. Understand the content and generate the preliminary slide scenario in the slide panel. Do not trigger PPTX rendering in this step.`
          : `Start the prestaging workflow now. The user has already chosen the "${fw}" business framework — apply it directly and do NOT ask the user to choose again. Understand the content and generate the preliminary slide scenario in the slide panel. Do not trigger PPTX rendering in this step.`
        : workflow.triggerPrompt
    }
    await sendMessage(prompt, { workflowId: workflow.id })
  }

  const createPptx = async () => {
    if (busy || !hasSlides) return

    const workflow = getWorkflowConfig('create-pptx')
    const prompt = input.trim() || workflow.triggerPrompt

    setActiveWorkflow(workflow.id)
    setPptxBusy(true)
    await sendMessage(prompt, { clearInput: false, workflowId: workflow.id })
  }

  const cancel = () => {
    if (!busy) return
    window.electronAPI.chat.cancel()
  }

  const clearChatHistory = async () => {
    if (busy) return
    if (messages.length > 0) {
      clearMessages()
    }
    await window.electronAPI.pptx.clearWorkspaceArtifacts().catch(() => undefined)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" style={{ background: 'var(--panel-bg)' }}>
      {/* Header */}
      <div
        className="flex-none flex items-center justify-between gap-3 px-4 border text-sm font-semibold"
        style={{ color: 'var(--text-primary)', borderColor: 'var(--panel-border)', background: 'var(--surface)', height: 40, minHeight: 40 }}
      >
        <span>Chat</span>
        <button
          type="button"
          onClick={clearChatHistory}
          disabled={busy || messages.length === 0}
          className="flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-widest transition-opacity disabled:opacity-40"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Clear chat history"
          title="Clear chat history"
        >
          <Trash2 size={12} />
          <span>Clear</span>
        </button>
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto border px-4 py-4 space-y-4"
        style={{ background: 'var(--surface)', borderColor: 'var(--panel-border)' }}
      >
        {messages.length === 0 && (
          <div className="text-center mt-16" style={{ color: 'var(--text-muted)' }}>
            <p className="text-sm mb-1">👋 Ready to build slides.</p>
            <p className="text-xs">Describe your presentation to start.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col gap-1.5 group">
            <div className="flex items-center justify-between gap-2 px-1">
              <span
                className="text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: msg.role === 'user' ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                {msg.role === 'user' ? 'You' : 'Agent'}
              </span>
              <button
                type="button"
                onClick={() => removeMessage(msg.id)}
                className="flex h-5 w-5 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Remove message"
                title="Remove message"
              >
                <X size={12} />
              </button>
            </div>
            {msg.role === 'user' ? (
              <div
                className="px-4 py-3 text-sm"
                style={{
                  background: '#eef2ff',
                  color: 'var(--text-primary)',
                  border: '1px solid rgba(99,102,241,0.25)',
                }}
              >
                {msg.content}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {msg.thinking && (
                  <details
                    className="text-xs px-4 py-3 border"
                    style={{ color: 'var(--text-secondary)', background: 'var(--surface-hover)', borderColor: 'var(--panel-border)' }}
                  >
                    <summary className="cursor-pointer">Thinking…</summary>
                    <pre className="mt-2 whitespace-pre-wrap leading-relaxed">{msg.thinking}</pre>
                  </details>
                )}
                {showToolCallingMessages && msg.toolLogs && msg.toolLogs.length > 0 && (
                  <ToolLogList logs={msg.toolLogs} />
                )}
                <AssistantMarkdownMessage content={msg.content} />
              </div>
            )}
          </div>
        ))}

        {/* Streaming — isolated component to avoid parent re-renders */}
        <StreamingBubble scrollRef={messagesEndRef} showToolCallingMessages={showToolCallingMessages} />

        <div ref={messagesEndRef} />
      </div>

      {/* Input composer */}
      <div
        className="flex-none border"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message the agent…"
          rows={3}
          disabled={busy}
          className="w-full resize-none border-b bg-transparent text-sm outline-none"
          style={{
            display: 'block',
            color: 'var(--text-primary)',
            padding: '12px 14px',
            maxHeight: 200,
            lineHeight: '1.6',
            borderColor: 'var(--panel-border)',
            background: 'var(--input-bg)',
          }}
        />
        {elapsed !== null && (
          <div className="px-3 pt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {busy ? `⏱ ${elapsed}s elapsed…` : `⏱ Completed in ${elapsed}s`}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p className="min-w-0 text-xs" style={{ color: 'var(--text-muted)' }}>Enter ↵ send · Shift+Enter new line</p>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            <button
              onClick={brainstorm}
              disabled={busy}
              className="flex shrink-0 items-center justify-center gap-2 text-xs font-semibold disabled:opacity-40 transition-colors"
              style={{
                background: 'var(--surface-hover)',
                color: 'var(--text-primary)',
                border: '1px solid var(--panel-border)',
                height: 32,
                paddingLeft: 16,
                paddingRight: 16,
              }}
              aria-label="Brainstorm"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />}
              <span>Brainstorm</span>
            </button>
            <button
              onClick={createPptx}
              disabled={busy || !hasSlides}
              className="flex shrink-0 items-center justify-center gap-2 text-xs font-semibold disabled:opacity-40 transition-colors"
              style={{
                background: 'var(--surface-hover)',
                color: 'var(--text-primary)',
                border: '1px solid var(--panel-border)',
                height: 32,
                paddingLeft: 16,
                paddingRight: 16,
              }}
              aria-label="Create PPTX"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />}
              <span>Create PPTX</span>
            </button>
            {busy && (
              <button
                onClick={cancel}
                className="flex shrink-0 items-center justify-center text-xs font-semibold transition-colors"
                style={{
                  background: 'var(--surface-hover)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--panel-border)',
                  height: 32,
                  width: 32,
                }}
                aria-label="Cancel"
              >
                <X size={14} />
              </button>
            )}
            <button
              onClick={send}
              disabled={!input.trim() || busy}
              className="flex shrink-0 items-center justify-center gap-2 text-xs font-semibold disabled:opacity-40 transition-colors"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                height: 32,
                minWidth: 90,
                paddingLeft: 16,
                paddingRight: 16,
              }}
              aria-label="Send"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span>{busy ? 'Sending' : 'Send'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
