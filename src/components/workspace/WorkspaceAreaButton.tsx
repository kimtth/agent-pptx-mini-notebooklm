/**
 * WorkspaceAreaButton: top-bar workspace selector + project save/load
 * Renders left of the gear Settings button.
 */

import { useEffect, useState } from 'react'
import { FolderOpen, Save, FolderInput, FilePlus2, ChevronDown } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useSlidesStore } from '../../stores/slides-store'
import { useChatStore } from '../../stores/chat-store'
import { usePaletteStore } from '../../stores/palette-store'
import { useDataSourcesStore } from '../../stores/data-sources-store'
import { DEFAULT_ICONIFY_COLLECTION } from '../../domain/icons/iconify'

export function WorkspaceAreaButton() {
  const { workspaceDir, currentProjectPath, isDirty, initWorkspaceDir, changeWorkspaceDir, saveProject, loadProject } =
    useProjectStore()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // Init workspace dir on mount
  useEffect(() => {
    initWorkspaceDir()
  }, [initWorkspaceDir])

  // Mark dirty whenever slides/chat/palette change
  const slidesWork = useSlidesStore((s) => s.work)
  const messages = useChatStore((s) => s.messages)
  const paletteTokens = usePaletteStore((s) => s.tokens)
  const selectedIconCollection = usePaletteStore((s) => s.selectedIconCollection)
  useEffect(() => {
    if (currentProjectPath) {
      useProjectStore.getState().setDirty(true)
    }
  }, [slidesWork, messages, paletteTokens, selectedIconCollection, currentProjectPath])

  const folderName = workspaceDir
    ? workspaceDir.split(/[/\\]/).filter(Boolean).at(-1) ?? workspaceDir
    : '…'

  const projectName = currentProjectPath
    ? currentProjectPath.split(/[/\\]/).at(-1)?.replace(/\.pptapp$/, '') ?? 'project'
    : null

  function flash(msg: string) {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 2000)
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const result = await saveProject()
      if (result.success) flash('Saved')
    } finally {
      setSaving(false)
      setMenuOpen(false)
    }
  }

  async function handleLoad() {
    if (loading) return
    setLoading(true)
    try {
      const ok = await loadProject()
      if (ok) flash('Loaded')
    } finally {
      setLoading(false)
      setMenuOpen(false)
    }
  }

  async function handleChangeDir() {
    const dir = await changeWorkspaceDir()
    if (dir) flash('Workspace changed')
    setMenuOpen(false)
  }

  async function handleNew() {
    useSlidesStore.getState().reset()
    useChatStore.getState().clear()
    await window.electronAPI.pptx.clearWorkspaceArtifacts().catch(() => undefined)
    usePaletteStore.setState({
      seeds: [],
      colors: [],
      slots: null,
      tokens: null,
      themeName: '',
      selectedIconCollection: DEFAULT_ICONIFY_COLLECTION,
    })
    useDataSourcesStore.setState({ files: [], urls: [] })
    useProjectStore.setState({ currentProjectPath: null, isDirty: false })
    setMenuOpen(false)
  }

  return (
    <div
      className="relative flex items-center gap-1"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Feedback flash */}
      {feedback && (
        <span className="text-xs px-2 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--surface-hover)' }}>
          {feedback}
        </span>
      )}

      {/* Workspace folder badge + menu trigger */}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2 transition-colors hover:bg-[var(--surface-hover)] rounded"
        style={{ color: 'var(--text-secondary)', maxWidth: 220 }}
        title={workspaceDir || 'Set workspace folder'}
      >
        <FolderOpen size={13} style={{ flexShrink: 0 }} />
        <span className="text-xs truncate" style={{ maxWidth: 140 }}>
          {projectName ? (
            <>
              <span style={{ color: 'var(--text-muted)' }}>{folderName}/</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                {isDirty ? `${projectName}*` : projectName}
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{folderName}</span>
          )}
        </span>
        <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {/* Quick action buttons */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: isDirty ? 'var(--accent)' : 'var(--text-muted)' }}
        title="Save project (.pptapp)"
      >
        <Save size={14} />
      </button>

      <button
        onClick={handleLoad}
        disabled={loading}
        className="flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: 'var(--text-muted)' }}
        title="Open project (.pptapp)"
      >
        <FolderInput size={14} />
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div
            className="absolute top-full mt-1 right-0 z-50 w-52 border py-1 shadow-lg"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--panel-border)',
            }}
          >
            <MenuItem icon={<FilePlus2 size={13} />} label="New project" onClick={() => { void handleNew() }} />
            <MenuItem icon={<Save size={13} />} label="Save project…" onClick={handleSave} />
            <MenuItem icon={<FolderInput size={13} />} label="Open project…" onClick={handleLoad} />
            <div className="my-1 border-t" style={{ borderColor: 'var(--panel-border)' }} />
            <MenuItem icon={<FolderOpen size={13} />} label="Change workspace folder…" onClick={handleChangeDir} />
            {workspaceDir && (
              <div className="px-3 py-1">
                <span className="block text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {workspaceDir}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
      style={{ color: 'var(--text-secondary)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      {label}
    </button>
  )
}
