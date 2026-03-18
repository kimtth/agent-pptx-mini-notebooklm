import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Search, X } from 'lucide-react'
import type { ImageSearchCandidate, ImageSearchRequest, ResolvedSlideImage } from '../../domain/ports/ipc'

interface Props {
  slide: ImageSearchRequest
  query: string
  onClose: () => void
  onSelected: (images: ResolvedSlideImage[]) => void
}

function previewSource(candidate: ImageSearchCandidate): string | null {
  return candidate.thumbnailUrl ?? candidate.imageUrl ?? candidate.inlineImageDataUrl
}

export function ImagePickerModal({ slide, query, onClose, onSelected }: Props) {
  const [candidates, setCandidates] = useState<ImageSearchCandidate[]>([])
  const [resolvedQuery, setResolvedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadCandidates() {
      setLoading(true)
      setError(null)
      try {
        const result = await window.electronAPI.images.searchForSlide({
          ...slide,
          imageQuery: query.trim() || null,
        })
        if (cancelled) return
        setResolvedQuery(result.query)
        setCandidates(result.candidates)
        setSelectedIds([])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Image search failed')
        setCandidates([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadCandidates()
    return () => { cancelled = true }
  }, [slide, query])

  async function handleSelect(candidate: ImageSearchCandidate) {
    setSelectedIds((current) => current.includes(candidate.id)
      ? current.filter((id) => id !== candidate.id)
      : [...current, candidate.id])
  }

  async function handleDownloadSelected() {
    const selectedCandidates = candidates.filter((candidate) => selectedIds.includes(candidate.id))
    if (selectedCandidates.length === 0) return

    setDownloading(true)
    setError(null)
    try {
      const queries = (query || slide.imageQuery || slide.title)
        .split(/[\r\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      const selected = await Promise.all(selectedCandidates.map((candidate) => window.electronAPI.images.downloadForSlide({
        ...slide,
        imageQuery: query.trim() || null,
        imageQueries: queries,
      }, candidate)))
      onSelected(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image download failed')
    } finally {
      setDownloading(false)
    }
  }

  async function handleChooseLocalFiles() {
    setDownloading(true)
    setError(null)
    try {
      const selected = await window.electronAPI.images.pickLocalFilesForSlide(slide)
      if (selected.length === 0) return
      onSelected(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local image selection failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col w-[860px] max-h-[90vh] border"
        style={{ background: 'var(--surface)', borderColor: 'var(--panel-border)' }}
      >
        <div
          className="flex items-center justify-between px-5 border-b"
          style={{ borderColor: 'var(--panel-border)', height: 48, minHeight: 48 }}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              Choose slide images
            </div>
            <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              {loading ? 'Searching…' : resolvedQuery || query || slide.title}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleChooseLocalFiles()}
              disabled={downloading}
              className="h-7 px-2 text-[11px] font-semibold border transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--panel-border)', color: 'var(--text-secondary)', background: 'var(--surface)' }}
            >
              Choose local files
            </button>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : error ? (
            <div className="border px-4 py-3 text-sm" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}>
              {error}
            </div>
          ) : candidates.length === 0 ? (
            <div className="border px-4 py-6 text-center" style={{ borderColor: 'var(--panel-border)', color: 'var(--text-muted)' }}>
              <Search size={18} className="mx-auto mb-2" />
              No image candidates were found for this slide. You can still choose local image files.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {candidates.map((candidate) => {
                const src = previewSource(candidate)
                const isSelected = selectedIds.includes(candidate.id)
                return (
                  <button
                    key={candidate.id}
                    onClick={() => void handleSelect(candidate)}
                    disabled={downloading}
                    className="flex flex-col overflow-hidden border text-left transition-colors disabled:opacity-60"
                    style={{ borderColor: isSelected ? 'var(--accent)' : 'var(--panel-border)', background: 'var(--surface)' }}
                  >
                    <div className="aspect-[4/3] border-b flex items-center justify-center overflow-hidden" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface-hover)' }}>
                      {src ? (
                        <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No preview</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="px-1.5 py-0.5 text-[10px] font-semibold border uppercase"
                          style={{ borderColor: 'var(--panel-border)', color: 'var(--accent)', background: 'var(--surface-hover)' }}
                        >
                          {candidate.provider}
                        </span>
                        {candidate.searchQuery ? (
                          <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                            {candidate.searchQuery}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs font-medium line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                        {candidate.title ?? 'Untitled image'}
                      </div>
                      <div className="text-[11px] line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                        {candidate.attribution ?? candidate.sourcePageUrl ?? candidate.imageUrl ?? 'No attribution available'}
                      </div>
                      {candidate.sourcePageUrl ? (
                        <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          <ExternalLink size={11} />
                          Source page available
                        </div>
                      ) : null}
                      <div className="text-[11px] font-semibold" style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {isSelected ? 'Selected' : 'Click to select'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end border-t px-5" style={{ borderColor: 'var(--panel-border)', minHeight: 52 }}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleChooseLocalFiles()}
              disabled={downloading}
              className="flex h-8 items-center gap-2 px-3 text-xs font-semibold border disabled:opacity-40"
              style={{ borderColor: 'var(--panel-border)', color: 'var(--text-secondary)', background: 'var(--surface)' }}
            >
              {downloading && <Loader2 size={13} className="animate-spin" />}
              <span>Choose local files</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadSelected()}
              disabled={downloading || selectedIds.length === 0}
              className="flex h-8 items-center gap-2 px-3 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {downloading && <Loader2 size={13} className="animate-spin" />}
              <span>{downloading ? 'Downloading…' : `Download selected (${selectedIds.length})`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}