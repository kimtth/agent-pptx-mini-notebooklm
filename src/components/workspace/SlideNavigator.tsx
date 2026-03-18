/**
 * SlideNavigator: numbered slide list with per-slide actions
 */

import { useEffect, useState } from 'react'
import { useSlidesStore } from '../../stores/slides-store'
import { usePaletteStore } from '../../stores/palette-store'
import { DESIGN_STYLE_OPTIONS, getDesignStyleMeta } from '../../domain/design-styles'
import { FRAMEWORK_OPTIONS, getFrameworkMeta } from '../../domain/frameworks'
import type { SlideItem } from '../../domain/entities/slide-work'
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
            }}
            className="h-8 border px-2 text-xs outline-none"
            style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="">Select a brand style</option>
            {DESIGN_STYLE_OPTIONS.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
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
