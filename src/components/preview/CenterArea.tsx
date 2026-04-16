/**
 * CenterArea: locally rendered PPTX preview + export toolbar
 */

import { useEffect, useState } from 'react'
import { Download, ChevronLeft, ChevronRight, FolderOpen, MonitorPlay, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react'
import { useSlidesStore } from '../../stores/slides-store'
import { useChatStore } from '../../stores/chat-store'
import { useProjectStore } from '../../stores/project-store'
import { PptxPreviewCard } from './PptxPreviewCard.tsx'
import { createAssistantMessage } from '../../application/chat-use-case'

const DEFAULT_PREVIEW_SCALE = 0.55
const MIN_PREVIEW_SCALE = 0.35
const MAX_PREVIEW_SCALE = 0.9
const PREVIEW_SCALE_STEP = 0.05

export function CenterArea() {
  const { work } = useSlidesStore()
  const { addMessage } = useChatStore()
  const { workspaceDir } = useProjectStore()
  const [selected, setSelected] = useState(0)
  const [previewScale, setPreviewScale] = useState(DEFAULT_PREVIEW_SCALE)
  const [exporting, setExporting] = useState(false)
  const [openingPptx, setOpeningPptx] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewWarning, setPreviewWarning] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [rerendering, setRerendering] = useState(false)
  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewCacheToken, setPreviewCacheToken] = useState(0)

  const slides = work.slides

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(previewImages.length - 1, 0)))
  }, [previewImages.length])

  useEffect(() => {
    let cancelled = false
    setPreviewImages([])
    setPreviewCacheToken((current) => current + 1)
    setPreviewWarning(null)
    setSelected(0)

    const loadCached = async () => {
      if (!workspaceDir) return
      try {
        const result = await window.electronAPI.pptx.readExistingPreviews()
        if (cancelled) return
        if (result.success && result.imagePaths.length > 0) {
          setPreviewImages(result.imagePaths)
          setPreviewCacheToken((current) => current + 1)
        }
      } catch { /* ignore */ }
    }

    const handlePreviewReady = (e: Event) => {
      const paths = (e as CustomEvent<{ imagePaths?: string[] }>).detail?.imagePaths
      if (Array.isArray(paths)) {
        // Use the image paths carried in the event directly, including [] for explicit clears.
        if (!cancelled) {
          setPreviewImages(paths)
          setPreviewCacheToken((current) => current + 1)
          setPreviewWarning(null)
        }
      } else {
        // Fallback for chunked path or manual refresh where paths aren't in the event.
        void loadCached()
      }
    }
    window.addEventListener('pptx-preview-ready', handlePreviewReady)

    void loadCached()

    return () => {
      cancelled = true
      window.removeEventListener('pptx-preview-ready', handlePreviewReady)
    }
  }, [workspaceDir])

  const loadPreview = async () => {
    if (!workspaceDir) return
    setRendering(true)
    setPreviewWarning(null)

    const result = await window.electronAPI.pptx.readExistingPreviews()
    if (result.success) {
      setPreviewImages(result.imagePaths ?? [])
      setPreviewCacheToken((current) => current + 1)
      if ((result.imagePaths ?? []).length === 0) {
        setPreviewWarning('No preview images found. Click Rerender to generate them from the PPTX.')
      }
    } else {
      setPreviewImages([])
      setPreviewCacheToken((current) => current + 1)
      setPreviewWarning('No preview images found. Click Rerender to generate them from the PPTX.')
    }
    setRendering(false)
  }

  const rerenderPreview = async () => {
    if (!workspaceDir) return
    setRerendering(true)
    setPreviewWarning(null)

    try {
      const result = await window.electronAPI.pptx.rerenderPreview()
      if (result.success) {
        setPreviewImages(result.imagePaths ?? [])
        setPreviewCacheToken((current) => current + 1)
      } else {
        setPreviewImages([])
        setPreviewCacheToken((current) => current + 1)
        setPreviewWarning(result.error ?? 'Preview rendering failed. PowerPoint desktop may be required.')
      }
    } catch (err) {
      setPreviewWarning(err instanceof Error ? err.message : 'Preview rendering failed.')
    } finally {
      setRerendering(false)
    }
  }

  const exportPptx = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const result = await window.electronAPI.pptx.generate(
        work.title || 'presentation',
      )

      if (result.success) {
        addMessage(createAssistantMessage(`PPTX exported.${result.path ? ` Saved to ${result.path}.` : ''}`))
      } else if (result.error !== 'Cancelled') {
        setExportError(result.error ?? 'Failed to export PPTX')
        addMessage(createAssistantMessage(`PPTX export failed: ${result.error ?? 'Unknown error'}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export PPTX'
      setExportError(message)
      addMessage(createAssistantMessage(`PPTX export failed: ${message}`))
    } finally {
      setExporting(false)
    }
  }

  const openPreviewPptx = async () => {
    setOpeningPptx(true)
    setExportError(null)
    try {
      const result = await window.electronAPI.pptx.openPreviewPptx()
      if (!result.success) {
        setExportError(result.error ?? 'Failed to open the preview PPTX in PowerPoint.')
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to open the preview PPTX in PowerPoint.')
    } finally {
      setOpeningPptx(false)
    }
  }

  const zoomOutDisabled = previewScale <= MIN_PREVIEW_SCALE
  const zoomInDisabled = previewScale >= MAX_PREVIEW_SCALE
  const previewZoomPercent = Math.round((previewScale / DEFAULT_PREVIEW_SCALE) * 100)

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
          {previewImages.length > 0 && (
            <div
              className="flex h-8 items-center gap-1 border px-1"
              style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
            >
              <button
                onClick={() => setPreviewScale((current) => Math.max(MIN_PREVIEW_SCALE, Number((current - PREVIEW_SCALE_STEP).toFixed(2))))}
                disabled={zoomOutDisabled}
                className="flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-40"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="min-w-11 text-center text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {previewZoomPercent}%
              </span>
              <button
                onClick={() => setPreviewScale((current) => Math.min(MAX_PREVIEW_SCALE, Number((current + PREVIEW_SCALE_STEP).toFixed(2))))}
                disabled={zoomInDisabled}
                className="flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-40"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
            </div>
          )}
          {previewImages.length > 0 && (
            <>
              <button
                onClick={() => void loadPreview()}
                disabled={rendering || rerendering}
                className="flex h-8 items-center gap-1.5 border px-3 text-xs font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
                title="Load existing preview images from the workspace"
              >
                <FolderOpen size={12} />
                {rendering ? 'Loading…' : 'Load Preview'}
              </button>
              <button
                onClick={() => void rerenderPreview()}
                disabled={rendering || rerendering || openingPptx}
                className="flex h-8 items-center gap-1.5 border px-3 text-xs font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
                title="Re-render preview images from the PPTX using PowerPoint"
              >
                <MonitorPlay size={12} />
                {rerendering ? 'Rendering…' : 'Rerender'}
              </button>
              <button
                onClick={() => void openPreviewPptx()}
                disabled={rendering || rerendering || openingPptx}
                className="flex h-8 items-center gap-1.5 border px-3 text-xs font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
                title="Open the preview PPTX in PowerPoint"
              >
                <ExternalLink size={12} />
                {openingPptx ? 'Opening…' : 'Open in PowerPoint'}
              </button>
            </>
          )}
          {previewImages.length > 0 && (
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
        {rendering || rerendering ? (
          <div className="text-center" style={{ color: 'var(--text-muted)' }}>
            <div className="text-5xl mb-4 opacity-30">🖼️</div>
            <p className="text-sm">{rerendering ? 'Rendering slide previews via PowerPoint…' : 'Loading slide previews…'}</p>
          </div>
        ) : previewImages.length === 0 ? (
          <div className="text-center" style={{ color: 'var(--text-muted)' }}>
            <div className="text-5xl mb-4 opacity-30">🖥️</div>
            <p className="text-sm">Rendered slide previews will appear here.</p>
            <p className="text-xs mt-1">Preview images load automatically after generation.</p>
            <p className="text-xs mt-1">Use <strong>Load Preview</strong> to read cached images, or <strong>Rerender</strong> to create fresh images via PowerPoint.</p>
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
              scale={previewScale}
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
