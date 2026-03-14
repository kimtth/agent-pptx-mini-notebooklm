/**
 * CenterArea: locally rendered PPTX preview + export toolbar
 */

import { useEffect, useRef, useState } from 'react'
import { Download, Palette, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useSlidesStore } from '../../stores/slides-store'
import { usePaletteStore } from '../../stores/palette-store'
import { useChatStore } from '../../stores/chat-store'
import { useDataSourcesStore } from '../../stores/data-sources-store'
import { useProjectStore } from '../../stores/project-store'
import { PptxPreviewCard } from './PptxPreviewCard.tsx'
import { createAssistantMessage, createUserMessage, historyToIpc } from '../../application/chat-use-case'
import { getAvailableIconChoices } from '../../domain/icons/iconify'
import { getWorkflowConfig } from '../../domain/workflows/workflow-config'

export function CenterArea() {
  const { work, setPptxBuildError, setStreaming } = useSlidesStore()
  const { tokens, selectedIconCollection } = usePaletteStore()
  const { addMessage, messages } = useChatStore()
  const { files: dataSources, urls: urlSources } = useDataSourcesStore()
  const { workspaceDir } = useProjectStore()
  const [selected, setSelected] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewWarning, setPreviewWarning] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewCacheToken, setPreviewCacheToken] = useState(0)

  const slides = work.slides
  const prevPptxCodeRef = useRef<string | null>(null)
  const tokensRef = useRef(tokens)

  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  /** Send the build error to the coding agent for automatic regeneration */
  const triggerErrorFeedback = (error: string) => {
    setPptxBuildError(error)
    const availableIcons = getAvailableIconChoices(selectedIconCollection)
    const workflow = getWorkflowConfig('create-pptx')
    const errorMessage = 'The generated python-pptx code failed to execute. Apply a MINIMAL fix — only change the specific lines causing the error. Do NOT regenerate the entire file from scratch.'
    const errorUserMessage = createUserMessage(errorMessage)
    addMessage(errorUserMessage)
    setStreaming(true)
    window.electronAPI.chat.send(errorMessage, historyToIpc([...messages, errorUserMessage]), {
      title: work.title,
      slides: work.slides,
      designBrief: work.designBrief,
      designStyle: work.designStyle,
      framework: work.framework,
      pptxBuildError: error,
      theme: tokens,
      workflow,
      dataSources,
      urlSources,
      iconProvider: 'iconify',
      iconCollection: selectedIconCollection,
      availableIcons,
    })
  }

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(previewImages.length - 1, 0)))
  }, [previewImages.length])

  useEffect(() => {
    prevPptxCodeRef.current = null
    setPreviewImages([])
    setPreviewCacheToken((current) => current + 1)
    setPreviewWarning(null)
    setSelected(0)
  }, [workspaceDir])

  useEffect(() => {
    let cancelled = false
    prevPptxCodeRef.current = work.pptxCode

    const run = async () => {
      if (!work.pptxCode) {
        setPreviewImages([])
        setPreviewWarning(null)
        setRendering(false)
        return
      }

      setRendering(true)
      setPreviewWarning(null)
      const result = await window.electronAPI.pptx.renderPreview(
        work.pptxCode,
        tokensRef.current,
        work.title || 'presentation',
        selectedIconCollection,
      )
      if (cancelled) return

      if (result.success) {
        setPreviewImages(result.imagePaths ?? [])
        setPreviewCacheToken((current) => current + 1)
        if (result.warning) setPreviewWarning(result.warning)
      } else {
        setPreviewImages([])
        setPreviewCacheToken((current) => current + 1)
        // Pass execution errors to the coding agent for auto-regeneration
        const errorText = result.error ?? 'Failed to render slide preview'
        triggerErrorFeedback(errorText)
      }
      setRendering(false)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [work.pptxCode, work.title, workspaceDir, selectedIconCollection])

  const refreshPreview = async () => {
    if (!work.pptxCode) return
    setRendering(true)
    setPreviewWarning(null)

    const result = await window.electronAPI.pptx.renderPreview(work.pptxCode, tokens, work.title || 'presentation', selectedIconCollection)
    if (result.success) {
      setPreviewImages(result.imagePaths ?? [])
      setPreviewCacheToken((current) => current + 1)
      if (result.warning) setPreviewWarning(result.warning)
    } else {
      setPreviewImages([])
      setPreviewCacheToken((current) => current + 1)
      const errorText = result.error ?? 'Failed to render slide preview'
      triggerErrorFeedback(errorText)
    }
    setRendering(false)
  }

  const exportPptx = async () => {
    if (!work.pptxCode) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await window.electronAPI.pptx.generate(work.pptxCode, tokens, work.title || 'presentation', selectedIconCollection)

      if (result.success) {
        addMessage(createAssistantMessage(`PPTX generation complete.${result.path ? ` Saved to ${result.path}.` : ''}`))
      } else if (result.error !== 'Cancelled') {
        setExportError(result.error ?? 'Failed to export PPTX')
        addMessage(createAssistantMessage(`PPTX generation failed: ${result.error ?? 'Unknown error'}`))
      }
    } finally {
      setExporting(false)
    }
  }

  const exportThmx = async () => {
    if (!tokens) return
    await window.electronAPI.theme.exportThmx(tokens)
  }

  return (
    <div className="flex flex-col h-full gap-3 p-3" style={{ background: 'var(--panel-bg)' }}>
      {/* Toolbar */}
      <div
        className="flex-none flex items-center justify-between px-4 border"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', height: 40, minHeight: 40 }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Preview
          {previewImages.length > 0 && (
            <span className="ml-2 text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
              {selected + 1} / {previewImages.length}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {work.pptxCode && (
            <button
              onClick={() => void refreshPreview()}
              disabled={rendering}
              className="flex h-8 items-center gap-1.5 border px-3 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
            >
              <RefreshCw size={12} className={rendering ? 'animate-spin' : ''} />
              {rendering ? 'Rendering…' : 'Refresh Preview'}
            </button>
          )}
          {tokens && (
            <button
              onClick={exportThmx}
              className="flex h-8 items-center gap-1.5 border px-3 text-xs font-medium transition-colors"
              style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
            >
              <Palette size={12} />
              .thmx
            </button>
          )}
          {work.pptxCode && (
            <button
              onClick={exportPptx}
              disabled={exporting}
              className="flex h-8 items-center gap-1.5 px-3 text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Download size={12} />
              {exporting ? 'Saving…' : 'Export .pptx'}
            </button>
          )}
        </div>
      </div>

      {exportError && (
        <div
          className="flex-none border px-4 py-2 text-xs"
          style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}
        >
          {exportError}
        </div>
      )}

      {previewWarning && (
        <div
          className="flex-none border px-4 py-2 text-xs"
          style={{ borderColor: '#fed7aa', background: '#fff7ed', color: '#c2410c' }}
        >
          {previewWarning}
        </div>
      )}

      {/* Main slide view */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden border p-6"
        style={{ background: 'var(--surface)', borderColor: 'var(--panel-border)' }}
      >
        {rendering ? (
          <div className="text-center" style={{ color: 'var(--text-muted)' }}>
            <div className="text-5xl mb-4 opacity-30">🖼️</div>
            <p className="text-sm">Rendering slide previews…</p>
            <p className="text-xs mt-1">The app is generating the deck and exporting slide images locally.</p>
          </div>
        ) : previewImages.length === 0 ? (
          <div className="text-center" style={{ color: 'var(--text-muted)' }}>
            <div className="text-5xl mb-4 opacity-30">🖥️</div>
            <p className="text-sm">Rendered slide previews will appear here.</p>
            <p className="text-xs mt-1">Create PPTX code first, then the app will render slide images locally.</p>
            <p className="text-xs mt-1">Windows preview rendering requires Microsoft PowerPoint to be installed.</p>
          </div>
        ) : (
          <>
            <button
              onClick={() => setSelected((i) => Math.max(0, i - 1))}
              disabled={selected === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center border disabled:opacity-20 transition-opacity"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
              aria-label="Previous slide"
            >
              <ChevronLeft size={18} />
            </button>

            <PptxPreviewCard
              title={slides[selected]?.title ?? `Slide ${selected + 1}`}
              imagePath={previewImages[selected]}
              cacheKey={`${previewCacheToken}:${previewImages[selected]}`}
              scale={0.55}
              selected
            />

            <button
              onClick={() => setSelected((i) => Math.min(previewImages.length - 1, i + 1))}
              disabled={selected === previewImages.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center border disabled:opacity-20 transition-opacity"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
              aria-label="Next slide"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      {previewImages.length > 1 && (
        <div
          className="flex-none flex gap-3 overflow-x-auto border px-4 py-3"
          style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
        >
          {previewImages.map((imagePath, i) => (
            <button
              key={imagePath}
              onClick={() => setSelected(i)}
              className="flex-none focus:outline-none"
              aria-label={`Slide ${i + 1}: ${slides[i]?.title ?? `Slide ${i + 1}`}`}
            >
              <PptxPreviewCard
                title={slides[i]?.title ?? `Slide ${i + 1}`}
                imagePath={imagePath}
                cacheKey={`${previewCacheToken}:${imagePath}`}
                scale={0.12}
                selected={i === selected}
                onClick={() => setSelected(i)}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
