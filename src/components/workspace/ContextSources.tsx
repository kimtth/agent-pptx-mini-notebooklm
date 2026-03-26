/**
 * ContextSources: file picker + URL scraper
 */

import { useState } from 'react'
import { FolderOpen, Link, X, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import type { DataFile } from '../../domain/ports/ipc'
import { useDataSourcesStore } from '../../stores/data-sources-store'

export function ContextSources() {
  const { files, urls, setFiles, setUrls } = useDataSourcesStore()
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const hasSources = files.length > 0 || urls.length > 0
  const hasPendingUrls = urls.some((entry) => entry.status === 'loading')
  const canRecreateContents = hasSources && !hasPendingUrls && !refreshing

  const openFiles = async () => {
    setLoading(true)
    try {
      const loaded = await window.electronAPI.fs.openDirectory()
      const current = useDataSourcesStore.getState().files
      setFiles([...current, ...loaded.filter((f) => !current.some((e) => e.path === f.path))])
    } finally {
      setLoading(false)
    }
  }

  const removeFile = (path: string) => {
    setFiles(useDataSourcesStore.getState().files.filter((f) => f.path !== path))
  }

  const addUrl = async () => {
    const url = urlInput.trim()
    if (!url) return
    // Basic URL validation
    try { new URL(url) } catch { return }
    setUrlInput('')
    setUrls([...useDataSourcesStore.getState().urls, { url, status: 'loading' }])
    try {
      const result = await window.electronAPI.scrape.scrapeUrl(url)
      setUrls(useDataSourcesStore.getState().urls.map(
        (u) => u.url === url ? { ...u, status: result.error ? 'error' : 'ok', result } : u,
      ))
    } catch {
      setUrls(useDataSourcesStore.getState().urls.map(
        (u) => u.url === url ? { ...u, status: 'error' } : u,
      ))
    }
  }

  const removeUrl = (url: string) => {
    setUrls(useDataSourcesStore.getState().urls.filter((u) => u.url !== url))
  }

  async function refreshFiles() {
    const currentFiles = useDataSourcesStore.getState().files
    if (currentFiles.length === 0) return

    const refreshedFiles = await Promise.allSettled(
      currentFiles.map((file) => window.electronAPI.fs.readFile(file.path)),
    )

    setFiles(refreshedFiles.map((result, index) => (
      result.status === 'fulfilled' ? result.value : currentFiles[index]
    )))
  }

  async function refreshUrls() {
    const currentUrls = useDataSourcesStore.getState().urls
    if (currentUrls.length === 0) return

    setUrls(currentUrls.map((entry) => ({ ...entry, status: 'loading' as const })))

    const refreshedUrls = await Promise.allSettled(
      currentUrls.map((entry) => window.electronAPI.scrape.scrapeUrl(entry.url)),
    )

    setUrls(currentUrls.map((entry, index) => {
      const result = refreshedUrls[index]
      if (result.status === 'fulfilled') {
        return {
          url: entry.url,
          status: result.value.error ? 'error' as const : 'ok' as const,
          result: result.value,
        }
      }

      return {
        ...entry,
        status: 'error' as const,
      }
    }))
  }

  const recreateSlideContents = async () => {
    if (!canRecreateContents) return

    setRefreshing(true)
    try {
      await Promise.all([refreshFiles(), refreshUrls()])
    } finally {
      setRefreshing(false)
    }
  }

  const typeIcon = (t: DataFile['type']) => t === 'csv' ? '📊' : t === 'docx' ? '📄' : '📝'

  return (
    <div className="flex flex-col h-full overflow-y-auto gap-3 p-3" style={{ background: 'var(--surface)' }}>

      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div className="px-4 py-3">
          <button
            onClick={recreateSlideContents}
            disabled={!canRecreateContents}
            className="flex w-full items-center justify-center gap-2 h-9 px-3 text-xs font-semibold border transition-colors disabled:opacity-40"
            style={{
              background: canRecreateContents ? 'var(--surface-hover)' : 'var(--surface)',
              color: 'var(--text-primary)',
              borderColor: 'var(--panel-border)',
            }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
            Recreate source contents for files and URLs
          </button>
        </div>
      </section>

      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div
          className="flex items-center justify-between px-4 border-b"
          style={{ borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Files
          </span>
          <button
            onClick={openFiles}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 text-xs font-medium border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent', height: 28 }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
            Add files
          </button>
        </div>

        {files.length === 0 ? (
          <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            No files loaded. Add CSV, DOCX, MD, PDF, or TXT files.
          </p>
        ) : (
          files.map((f, index) => (
            <div
              key={f.path}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderTop: index === 0 ? 'none' : '1px solid var(--panel-border)' }}
            >
              <span className="flex-none text-sm">{typeIcon(f.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{f.summary.slice(0, 80)}</div>
              </div>
              <button
                onClick={() => removeFile(f.path)}
                aria-label="Remove"
                className="flex-none w-8 h-8 flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </section>

      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div
          className="flex items-center px-4 border-b"
          style={{ borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            URLs
          </span>
        </div>

        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="flex flex-col gap-2">
            <div
              className="flex items-center gap-2 h-9 border px-3"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--panel-border)' }}
            >
              <Link size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                placeholder="https://..."
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
            <button
              onClick={addUrl}
              disabled={!urlInput.trim()}
              className="h-9 px-3 text-xs font-semibold border disabled:opacity-40 transition-colors"
              style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}
            >
              Add URL
            </button>
          </div>
        </div>

        {urls.map((u, index) => (
          <div
            key={u.url}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: index === 0 ? 'none' : '1px solid var(--panel-border)' }}
          >
            <span className="flex-none">
              {u.status === 'loading'
                ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                : u.status === 'ok'
                ? <CheckCircle size={12} style={{ color: '#22c55e' }} />
                : <AlertCircle size={12} style={{ color: '#ef4444' }} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{u.result?.title || u.url}</div>
              {u.result?.error && <div className="text-xs" style={{ color: '#ef4444' }}>{u.result.error}</div>}
            </div>
            <button
              onClick={() => removeUrl(u.url)}
              aria-label="Remove"
              className="flex-none w-8 h-8 flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
