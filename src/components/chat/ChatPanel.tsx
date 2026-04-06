import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, X, ChevronDown, ChevronRight, FileCode2, Lightbulb, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../../stores/chat-store'
import { useSlidesStore } from '../../stores/slides-store'
import { usePaletteStore } from '../../stores/palette-store'
import { useDataSourcesStore } from '../../stores/data-sources-store'
import { createUserMessage, historyToIpc, stripPythonCodeForDisplay } from '../../application/chat-use-case'
import { applyThemeColorTreatment, applyThemeFontFamily } from '../../application/palette-use-case'
import type { WorkspaceContext } from '../../application/chat-use-case'
import { getAvailableIconChoices } from '../../domain/icons/iconify'
import { getWorkflowConfig, type WorkflowId } from '../../domain/workflows/workflow-config'

/** Completed assistant messages: full markdown, auto-collapse if >10 lines */
function AssistantMarkdownMessage({ content }: { content: string }) {
  const stripped = stripPythonCodeForDisplay(content)
  const codeHidden = !stripped && content.trim().length > 0
  const displayContent = codeHidden ? '' : stripped
  const lineCount = displayContent.split(/\r?\n/).length
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
          {codeHidden ? (
            <p className="flex items-center gap-2 text-xs italic" style={{ color: 'var(--text-muted)' }}>
              <FileCode2 size={14} />
              <span>Python code generated — building PPTX…</span>
            </p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
          )}
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

/** Isolated component for streaming — subscribes to pending state independently */
function StreamingBubble({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const pendingContent = useChatStore((s) => s.pendingContent)
  const pendingThinking = useChatStore((s) => s.pendingThinking)
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

  if (!pendingContent && !pendingThinking) {
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
      {pendingContent && (() => {
        const stripped = stripPythonCodeForDisplay(pendingContent, true)
        if (!stripped && pendingContent.trim().length > 0) {
          return (
            <div
              className="flex items-center gap-2 px-4 py-3 text-xs italic border"
              style={{ color: 'var(--text-muted)', background: 'var(--surface)', borderColor: 'var(--panel-border)' }}
            >
              <FileCode2 size={14} />
              <span>Generating Python code…</span>
            </div>
          )
        }
        return stripped ? <StreamingTextMessage content={stripped} /> : null
      })()}
    </div>
  )
}

export function ChatPanel() {
  const [input, setInput] = useState('')
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
  const setStreaming = useSlidesStore((s) => s.setStreaming)
  const setPptxBusy = useSlidesStore((s) => s.setPptxBusy)
  const { tokens, selectedFont, selectedColorTreatment, selectedIconCollection } = usePaletteStore()
  const { files: dataSources, urls: urlSources } = useDataSourcesStore()
  const busy = streaming || pptxBusy

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
    const workflow = options?.workflowId ? getWorkflowConfig(options.workflowId) : null
    const effectiveTheme = applyThemeColorTreatment(
      applyThemeFontFamily(tokens, selectedFont),
      selectedColorTreatment,
    )

    const workspaceContext: WorkspaceContext = {
      title: work.title,
      slides: work.slides,
      designBrief: work.designBrief,
      designStyle: work.designStyle,
      framework: work.framework,
      templateMeta: work.templateMeta,
      pptxBuildError: work.pptxBuildError,
      theme: effectiveTheme,
      workflow,
      dataSources,
      urlSources,
      iconProvider: 'iconify',
      iconCollection: selectedIconCollection,
      availableIcons,
      includeImagesInLayout: work.includeImagesInLayout,
    }

    window.electronAPI.chat.send(msg, historyToIpc([...messages, userMessage]), workspaceContext)
  }

  const send = async () => {
    await sendMessage(input)
  }

  const brainstorm = async () => {
    if (busy) return
    const workflow = getWorkflowConfig('prestaging')
    let prompt = input.trim()
    if (!prompt) {
      const fw = useSlidesStore.getState().work.framework
      prompt = fw
        ? `Start the prestaging workflow now. The user has already chosen the "${fw}" business framework — apply it directly and do NOT ask the user to choose again. Understand the content and generate the preliminary slide scenario in the slide panel. Do not generate PPTX code in this step.`
        : workflow.triggerPrompt
    }
    await sendMessage(prompt, { workflowId: workflow.id })
  }

  const createPptx = async () => {
    if (busy || !hasSlides) return

    const workflow = getWorkflowConfig('create-pptx')
    const prompt = input.trim() || workflow.triggerPrompt

    setPptxBusy(true)
    await sendMessage(prompt, { clearInput: false, workflowId: workflow.id })
  }

  const cancel = () => {
    if (!busy) return
    window.electronAPI.chat.cancel()
  }

  const clearChatHistory = () => {
    if (busy || messages.length === 0) return
    clearMessages()
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
                <AssistantMarkdownMessage content={msg.content} />
              </div>
            )}
          </div>
        ))}

        {/* Streaming — isolated component to avoid parent re-renders */}
        <StreamingBubble scrollRef={messagesEndRef} />

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
