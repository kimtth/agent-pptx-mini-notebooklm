/**
 * SlideNavigator: numbered slide list with per-slide actions
 */

import { useEffect, useState, useCallback } from 'react'
import { useSlidesStore } from '../../stores/slides-store'
import { usePaletteStore } from '../../stores/palette-store'
import { useDataSourcesStore } from '../../stores/data-sources-store'
import { useNotebookLMStore } from '../../stores/notebooklm-store'
import { DESIGN_STYLE_OPTIONS, getDesignStyleMeta } from '../../domain/design-styles'
import { FRAMEWORK_OPTIONS, getFrameworkMeta } from '../../domain/frameworks'
import type { SlideItem } from '../../domain/entities/slide-work'
import type { NotebookLMAuthStatus } from '../../domain/ports/ipc'
import { ImagePickerModal } from './ImagePickerModal.tsx'
import { toLocalImageUrl } from '../../application/local-image-url.ts'

const LAYOUT_BADGE: Record<string, string> = {
  title: 'TTL', agenda: 'AGN', section: 'SEC', bullets: 'BUL',
  cards: 'CRD', stats: 'STA', comparison: 'CMP', timeline: 'TML',
  diagram: 'DGM', summary: 'SUM', chart: 'CHT',
}

export function SlideNavigator() {
  const { work, deleteSlide, moveToAppendix, setDesignStyle, setFramework, setTemplatePath, setTemplateMeta } = useSlidesStore()
  const slides = work.slides
  const selectedFramework = getFrameworkMeta(work.framework)
  const selectedStyle = getDesignStyleMeta(work.designStyle)
  const isCustomTemplate = work.designStyle === 'Custom Template'
  const [templateLoading, setTemplateLoading] = useState(false)

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface)' }}>
      {/* Section header */}
      <div
        className="flex-none flex flex-col gap-2 px-4 py-3 border-b"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between text-xs font-semibold">
          <span>{slides.length} slide{slides.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1">
            {selectedStyle && (
              <span
                className="px-2 py-0.5 text-[10px] font-semibold border"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', borderColor: 'var(--panel-border)' }}
              >
                {selectedStyle.label}
              </span>
            )}
            {work.framework && (
              <span
                className="px-2 py-0.5 text-[10px] font-semibold border"
                style={{ background: 'var(--surface-hover)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
              >
                {selectedFramework?.label ?? work.framework}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Business Framework
          </label>
          <select
            value={work.framework ?? ''}
            onChange={(e) => {
              const next = e.target.value
              if (next) setFramework(next as Parameters<typeof setFramework>[0])
            }}
            className="h-8 border px-2 text-xs outline-none"
            style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="" disabled>Select a framework</option>
            {FRAMEWORK_OPTIONS.map((framework) => (
              <option key={framework.value} value={framework.value}>
                {framework.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
            {selectedFramework?.description ?? 'Choose a structure for the story so slide recommendations follow a consistent business logic.'}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Brand Style
          </label>
          <select
            value={work.designStyle ?? ''}
            onChange={(e) => {
              const next = e.target.value
              setDesignStyle(next ? next as Parameters<typeof setDesignStyle>[0] : null)
              // Sync style tone to palette store so BG/TEXT tokens flip correctly
              const meta = next ? getDesignStyleMeta(next as Parameters<typeof setDesignStyle>[0]) : null
              const { setStyleTone, commitTokens } = usePaletteStore.getState()
              setStyleTone(meta?.tone ?? null)
              commitTokens()
            }}
            className="h-8 border px-2 text-xs outline-none"
            style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="">Select a brand style</option>
            {DESIGN_STYLE_OPTIONS.map((style) => (
              <option key={style.value} value={style.value}>
                {style.tone === 'dark' ? '🌙 ' : style.tone === 'light' ? '☀️ ' : ''}{style.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
            {selectedStyle
              ? `${selectedStyle.mood}. Best for ${selectedStyle.bestFor}.`
              : 'Choose one of the available brand styles to guide layout, typography, and visual treatment before generating slides.'}
          </p>
          {isCustomTemplate && (
            <div className="flex flex-col gap-1.5 mt-1 p-2 border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface-hover)' }}>
              {work.templatePath ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {work.templatePath.split(/[\\/]/).pop()}
                    </span>
                    <button
                      onClick={async () => {
                        await window.electronAPI.pptx.removeTemplate()
                        setTemplatePath(null)
                        setTemplateMeta(null)
                      }}
                      className="flex-none text-[10px] px-2 py-0.5 border transition-colors hover:bg-[var(--surface)]"
                      style={{ borderColor: 'var(--panel-border)', color: 'var(--text-secondary)' }}
                    >
                      Remove
                    </button>
                  </div>
                  <p className="text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
                    {work.templateMeta
                      ? 'Theme colors and backgrounds have been extracted. The palette is locked to this template\u2019s color scheme.'
                      : 'Template attached. Extracting metadata\u2026'}
                  </p>
                </>
              ) : (
                <>
                  <button
                    disabled={templateLoading}
                    onClick={async () => {
                      setTemplateLoading(true)
                      try {
                        const result = await window.electronAPI.pptx.importTemplate()
                        if (result.success && result.templatePath) {
                          setTemplatePath(result.templatePath)
                          if (result.meta) {
                            setTemplateMeta(result.meta)
                            // Auto-populate palette from template's theme colors
                            const { setSlots, setColors, setThemeName, commitTokens } = usePaletteStore.getState()
                            setSlots(result.meta.themeColors)
                            const slotEntries = Object.entries(result.meta.themeColors)
                            setColors(slotEntries.map(([name, hex]) => ({ name, hex })))
                            setThemeName('Custom Template')
                            commitTokens()
                          }
                        }
                      } finally {
                        setTemplateLoading(false)
                      }
                    }}
                    className="h-8 px-3 text-xs font-semibold transition-colors"
                    style={{ background: 'var(--accent)', color: '#fff', opacity: templateLoading ? 0.6 : 1 }}
                  >
                    {templateLoading ? 'Importing\u2026' : 'Attach PPTX Template'}
                  </button>
                  <p className="text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
                    The attached PPTX will be used as a design template. All placeholders will be ignored — only the blank layout, theme colors, and background images will be used.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* NotebookLM Infographic */}
      <NotebookLMSection />

      {/* Slide list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {slides.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center p-6 text-center" style={{ color: 'var(--text-muted)' }}>
            <div>
              <p className="text-sm">No slides yet.</p>
              <p className="mt-1 text-xs">Select a framework or brand style, then ask the agent to create a presentation.</p>
            </div>
          </div>
        ) : (
          slides.map((slide) => (
            <SlideListItem
              key={slide.id}
              slide={slide}
              onMoveToAppendix={() => moveToAppendix(slide.number)}
              onDelete={() => deleteSlide(slide.number)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function SlideListItem({
  slide,
  onMoveToAppendix,
  onDelete,
}: {
  slide: SlideItem
  onMoveToAppendix: () => void
  onDelete: () => void
}) {
  const { setSlideImageQuery, applyResolvedImages, removeSlideImage } = useSlidesStore()
  const [imageQuery, setImageQuery] = useState(slide.imageQuery ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setImageQuery(slide.imageQuery ?? '')
  }, [slide.imageQuery])

  function openPicker(nextQuery: string) {
    const trimmed = nextQuery.trim()
    if (trimmed !== (slide.imageQuery ?? '')) {
      setSlideImageQuery(slide.number, trimmed || null)
    }
    setPickerOpen(true)
  }

  return (
    <>
      <div
        className="px-3 py-3 border-b group hover:bg-[var(--surface-hover)] transition-colors last:border-b-0"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex-none w-7 h-7 flex items-center justify-center text-xs font-bold border"
            style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', borderColor: 'var(--panel-border)' }}
          >
            {slide.number}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 border flex-none"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', borderColor: 'var(--panel-border)' }}
              >
                {LAYOUT_BADGE[slide.layout] ?? slide.layout.slice(0, 3).toUpperCase()}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {slide.title}
              </span>
            </div>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {slide.keyMessage}
            </p>
            {slide.bullets.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="text-[11px] leading-snug pl-2 border-l-2" style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)' }}>
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex-none flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ActionBtn label="Move to appendix" onClick={onMoveToAppendix}>📎</ActionBtn>
            <ActionBtn label="Delete slide" onClick={onDelete}>🗑</ActionBtn>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Slide Image Search
          </label>
          <div className="flex flex-col gap-2">
            <textarea
              value={imageQuery}
              onChange={(e) => setImageQuery(e.target.value)}
              onBlur={() => {
                const trimmed = imageQuery.trim()
                if (trimmed !== (slide.imageQuery ?? '')) {
                  setSlideImageQuery(slide.number, trimmed || null)
                }
              }}
              placeholder="Enter one keyword, one keyword per line, or paste direct image URLs"
              rows={3}
              className="w-full border px-2 py-2 text-xs outline-none resize-none"
              style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={() => openPicker(imageQuery)}
              className="h-8 px-3 text-xs font-semibold transition-colors"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Choose images
            </button>
          </div>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
            {slide.selectedImages.length > 0
              ? `${slide.selectedImages.length} image${slide.selectedImages.length === 1 ? '' : 's'} selected. Files are stored under workspace/images.`
              : 'Search for images, paste direct image URLs, or choose local image files, then select one or more images for this slide.'}
          </p>
          {slide.selectedImages.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {slide.selectedImages.map((image) => {
                const src = image.imagePath
                  ? toLocalImageUrl(image.imagePath)
                  : image.thumbnailUrl ?? image.imageUrl ?? null
                const isUrlOnly = !image.imagePath && Boolean(image.imageUrl || image.thumbnailUrl)
                return (
                  <div key={image.id} className="relative h-16 w-16 overflow-hidden border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface-hover)' }}>
                    {src ? <img src={src} alt="" className="h-full w-full object-contain" draggable={false} /> : null}
                    {isUrlOnly && (
                      <span
                        title="Image not downloaded locally — will be fetched at save time"
                        className="absolute bottom-0 left-0 flex h-4 w-4 items-center justify-center text-[9px]"
                        style={{ background: 'rgba(234, 179, 8, 0.9)', color: '#1e1e1e' }}
                      >
                        !
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSlideImage(slide.number, image.id)}
                      className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center text-[10px]"
                      style={{ background: 'rgba(15, 23, 42, 0.78)', color: '#fff' }}
                      aria-label="Remove selected image"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
      {pickerOpen ? (
        <ImagePickerModal
          slide={{
            number: slide.number,
            title: slide.title,
            keyMessage: slide.keyMessage,
            bullets: slide.bullets,
            imageQuery: imageQuery.trim() || null,
            imageQueries: imageQuery.split(/[\r\n,;]+/).map((item) => item.trim()).filter(Boolean),
          }}
          query={imageQuery}
          onClose={() => setPickerOpen(false)}
          onSelected={(images) => applyResolvedImages(images)}
        />
      ) : null}
    </>
  )
}

function NotebookLMSection() {
  const { work } = useSlidesStore()
  const { files, urls } = useDataSourcesStore()
  const { enabled, infographicPaths, setEnabled, setInfographicPaths } = useNotebookLMStore()
  const [authStatus, setAuthStatus] = useState<NotebookLMAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [authMessage, setAuthMessage] = useState<string | null>(null)

  const authOk = authStatus?.authenticated ?? null
  const hasContent = files.length > 0 || urls.length > 0 || work.slides.length > 0

  const checkAuth = useCallback(async () => {
    try {
      const status = await window.electronAPI.notebooklm.authStatus()
      setAuthStatus(status)
      if (status.authenticated) setAuthMessage(null)
    } catch (error) {
      setAuthStatus({
        authenticated: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        suggestion: 'Retry connection after completing NotebookLM library login.',
      } as NotebookLMAuthStatus)
    }
  }, [])

  useEffect(() => {
    if (enabled) {
      checkAuth()
      window.electronAPI.notebooklm.getInfographics().then(setInfographicPaths).catch(() => {})
    }
    // Only re-run when enabled changes, not on every authOk update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  async function handleToggle() {
    const next = !enabled
    setEnabled(next)
    if (!next) {
      await window.electronAPI.notebooklm.clearInfographics().catch(() => {})
      setInfographicPaths([])
      setStatusMessage(null)
    }
  }

  /** End-to-end: create notebook → upload sources → generate infographic  */
  async function handleGenerateEndToEnd() {
    setBusy(true)
    setStatusMessage(null)
    try {
      // 1. Find or create the fixed 'pptx-slide-agent' notebook
      setStatusMessage('Preparing notebook…')
      const created = await window.electronAPI.notebooklm.createNotebook('pptx-slide-agent')
      if (!created.success || !created.notebookId) {
        setStatusMessage(`Failed to create notebook: ${created.error ?? 'unknown error'}`)
        return
      }
      const notebookId = created.notebookId

      // 2. Upload workspace contents
      setStatusMessage('Uploading sources…')

      const fileSources = files
        .filter((f) => f.path)
        .map((f) => ({ path: f.path }))

      const textSources: Array<{ title: string; content: string }> = []

      // Add slide content as a text source
      if (work.slides.length > 0) {
        const slideText = work.slides.map((s) =>
          `## Slide ${s.number}: ${s.title}\n${s.keyMessage}\n${s.bullets.map((b) => `- ${b}`).join('\n')}`,
        ).join('\n\n')
        textSources.push({ title: `${work.title || 'Presentation'} — Slide Content`, content: slideText })
      }

      // Add scraped URL text content
      const urlTexts = urls
        .filter((u) => u.status === 'ok' && u.result?.text)
        .map((u) => ({ title: u.result?.title ?? u.url, content: u.result!.text }))
      textSources.push(...urlTexts)

      // Add file text content that can't be uploaded as files (txt/md inline)
      const inlineTextFiles = files
        .filter((f) => (f.type === 'txt' || f.type === 'md') && f.text)
        .map((f) => ({ title: f.name, content: f.text! }))
      textSources.push(...inlineTextFiles)

      if (fileSources.length > 0 || textSources.length > 0) {
        const upload = await window.electronAPI.notebooklm.uploadSources(notebookId, {
          files: fileSources,
          texts: textSources,
        })
        if (upload.errorCount > 0 && upload.uploadedCount === 0) {
          setStatusMessage(`Upload failed: ${upload.errors.map((e) => e.error).join(', ')}`)
          return
        }
        setStatusMessage(`Uploaded ${upload.uploadedCount} source${upload.uploadedCount !== 1 ? 's' : ''}. Generating infographic…`)
      } else {
        setStatusMessage('No sources to upload. Generating infographic from empty notebook…')
      }

      // 3. Generate infographic
      const res = await window.electronAPI.notebooklm.generateInfographic(notebookId)
      if (res.success && res.path) {
        setInfographicPaths((prev) => prev.includes(res.path!) ? prev : [...prev, res.path!])
        setStatusMessage(`Infographic saved — ${res.path.split(/[\\/]/).pop()}`)
      } else {
        setStatusMessage(`Infographic generation failed: ${res.error ?? 'unknown error'}`)
      }
    } catch (e) {
      setStatusMessage(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleSetupAuth() {
    setAuthBusy(true)
    setAuthMessage(null)
    if (typeof window.electronAPI?.notebooklm?.setupAuth !== 'function') {
      setAuthMessage('Please restart the app to enable this button. Or run: python -m notebooklm login in a terminal.')
      setAuthBusy(false)
      return
    }
    try {
      const setup = await window.electronAPI.notebooklm.setupAuth()
      setAuthMessage(setup.message ?? (setup.success ? 'NotebookLM login opened.' : setup.error ?? 'NotebookLM setup failed.'))
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'NotebookLM setup failed.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleClearInfographics() {
    await window.electronAPI.notebooklm.clearInfographics().catch(() => {})
    setInfographicPaths([])
    setStatusMessage(null)
  }

  return (
    <div
      className="flex-none border-b px-4 py-3"
      style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
    >
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          NotebookLM Infographic
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
          style={{ background: enabled ? 'var(--accent)' : 'var(--surface-hover)' }}
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? 'translateX(17px)' : 'translateX(3px)' }}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-2 flex flex-col gap-2">
          {authOk === null && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Checking authentication…</p>
          )}
          {authOk === false && (
            <>
              <p className="text-[11px] leading-4" style={{ color: 'var(--danger, #ef4444)' }}>
                NotebookLM is not connected yet.
              </p>
              {authStatus?.error && (
                <p className="text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
                  {authStatus.errorType ? `${authStatus.errorType}: ` : ''}{authStatus.error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleSetupAuth}
                  className="h-8 px-3 text-xs font-semibold transition-colors"
                  style={{ background: 'var(--accent)', color: '#fff', opacity: authBusy ? 0.6 : 1 }}
                >
                  {authBusy ? 'Opening Login…' : 'Open NotebookLM Login'}
                </button>
                <button
                  type="button"
                  onClick={checkAuth}
                  className="h-8 px-3 text-xs font-semibold border transition-colors"
                  style={{ borderColor: 'var(--panel-border)', color: 'var(--text-primary)' }}
                >
                  Retry
                </button>
              </div>
              <p className="text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
                {authMessage ?? authStatus?.suggestion ?? 'Sign in via the login flow, then retry.'}
              </p>
            </>
          )}
          {authOk && (
            <>
              <button
                disabled={busy || !hasContent}
                onClick={handleGenerateEndToEnd}
                className="h-8 px-3 text-xs font-semibold transition-colors"
                style={{ background: 'var(--accent)', color: '#fff', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? (statusMessage ?? 'Working…') : 'Generate Infographic'}
              </button>
              {!hasContent && (
                <p className="text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
                  Add files or URLs in the Context tab, or create slides first.
                </p>
              )}
              {!busy && statusMessage && (
                <p
                  className="text-[11px] leading-4"
                  style={{ color: statusMessage.startsWith('Error') || statusMessage.startsWith('Failed') || statusMessage.includes('failed')
                    ? 'var(--danger, #ef4444)'
                    : 'var(--text-secondary)' }}
                >
                  {statusMessage}
                </p>
              )}
              {infographicPaths.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {infographicPaths.length} infographic{infographicPaths.length !== 1 ? 's' : ''} will be appended to the PPTX.
                  </p>
                  <button
                    type="button"
                    onClick={handleClearInfographics}
                    className="text-[10px] px-2 py-0.5 border transition-colors hover:bg-[var(--surface)]"
                    style={{ borderColor: 'var(--panel-border)', color: 'var(--text-secondary)' }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </>
          )}
          <p className="text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
            Creates a notebook from workspace contents, generates an infographic, and appends it to the PPTX output.
          </p>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center border text-xs hover:bg-[var(--surface-hover)] transition-colors"
      style={{ borderColor: 'var(--panel-border)' }}
    >
      {children}
    </button>
  )
}
