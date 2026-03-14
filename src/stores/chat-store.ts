/**
 * Store: Chat messages
 *
 * Streaming deltas are buffered internally and flushed to React
 * at most every 150 ms so the UI stays responsive.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatMessage } from '../application/chat-use-case'

interface ChatStore {
  messages: ChatMessage[]
  pendingContent: string
  pendingThinking: string

  addMessage(msg: ChatMessage): void
  removeMessage(id: string): void
  appendContent(delta: string): void
  appendThinking(delta: string): void
  flushAssistantMessage(): void
  clear(): void
}

/* ---- internal delta buffer (not part of React state) ---- */
let _contentBuf = ''
let _thinkingBuf = ''
let _flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_INTERVAL = 150

function scheduleDeltaFlush() {
  if (_flushTimer) return
  _flushTimer = setTimeout(() => {
    _flushTimer = null
    const c = _contentBuf
    const t = _thinkingBuf
    _contentBuf = ''
    _thinkingBuf = ''
    if (!c && !t) return
    useChatStore.setState((s) => ({
      pendingContent: s.pendingContent + c,
      pendingThinking: s.pendingThinking + t,
    }))
  }, FLUSH_INTERVAL)
}

function flushDeltasNow() {
  if (_flushTimer) {
    clearTimeout(_flushTimer)
    _flushTimer = null
  }
  const c = _contentBuf
  const t = _thinkingBuf
  _contentBuf = ''
  _thinkingBuf = ''
  if (!c && !t) return
  useChatStore.setState((s) => ({
    pendingContent: s.pendingContent + c,
    pendingThinking: s.pendingThinking + t,
  }))
}

export const useChatStore = create<ChatStore>()(persist(
  (set, get) => ({
  messages: [],
  pendingContent: '',
  pendingThinking: '',

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  removeMessage: (id) =>
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),

  appendContent: (delta) => {
    _contentBuf += delta
    scheduleDeltaFlush()
  },

  appendThinking: (delta) => {
    _thinkingBuf += delta
    scheduleDeltaFlush()
  },

  flushAssistantMessage() {
    flushDeltasNow()
    const { pendingContent, pendingThinking } = get()
    if (!pendingContent && !pendingThinking) return
    const msg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: 'assistant',
      content: pendingContent,
      thinking: pendingThinking || undefined,
      timestamp: Date.now(),
    }
    set((s) => ({
      messages: [...s.messages, msg],
      pendingContent: '',
      pendingThinking: '',
    }))
  },

  clear: () => {
    _contentBuf = ''
    _thinkingBuf = ''
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
    set({ messages: [], pendingContent: '', pendingThinking: '' })
  },
}),
  {
    name: 'pptx-chat-messages',
    storage: createJSONStorage(() => sessionStorage),
    partialize: (state) => ({ messages: state.messages }),
  },
))
