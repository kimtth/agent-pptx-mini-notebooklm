/**
 * PalettePanel: Seed pickers → Generate → Canvas preview → Slot editor → Export
 */

import { useState, useEffect } from 'react'
import { Icon } from '@iconify/react'
import { Loader2, Sparkles, Download, X } from 'lucide-react'
import { usePaletteStore } from '../../stores/palette-store.ts'
import { PaletteCanvas } from './PaletteCanvas.tsx'
import { ThemeSlotEditor } from './ThemeSlotEditor.tsx'
import { getIconifyCollectionById, getIconifyCollectionOptions, getIconifyExamples } from '../../domain/icons/iconify.ts'

export function PalettePanel() {
  const {
    seeds,
    setSeeds,
    colors,
    setColors,
    slots,
    setSlots,
    tokens,
    setGenerating,
    isGenerating,
    commitTokens,
    selectedIconCollection,
    setSelectedIconCollection,
  } = usePaletteStore()
  const [error, setError] = useState<string | null>(null)
  const iconCollectionOptions = getIconifyCollectionOptions()
  const selectedCollection = getIconifyCollectionById(selectedIconCollection)
  const iconExamples = getIconifyExamples(selectedIconCollection)

  const generate = async () => {
    setError(null)
    if (seeds.length === 0) {
      setError('Add at least one seed color before generating a palette')
      return
    }
    setGenerating(true)
    try {
      const generated = await window.electronAPI.theme.generatePalette(seeds)
      if (generated.length === 0) throw new Error('No colors returned')
      setColors(generated)
      const autoSlots = await window.electronAPI.theme.autoAssign(generated, seeds)
      setSlots(autoSlots)
      commitTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const exportThmx = async () => {
    if (!tokens) return
    await window.electronAPI.theme.exportThmx(tokens)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto gap-3 p-3" style={{ background: 'var(--surface)' }}>

      {/* ── Seed colors ── */}
      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div
          className="flex items-center px-4 border-b text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
        >
          Seed Colors
        </div>
        <div className="px-4 py-4">
        <div className="flex flex-wrap gap-3 mb-4">
          {seeds.map((seed, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div
                className="relative w-10 h-10 overflow-hidden border-2 cursor-pointer"
                style={{ borderColor: 'var(--panel-border)' }}
              >
                <button
                  type="button"
                  onClick={() => setSeeds(seeds.filter((_, index) => index !== i))}
                  className="absolute right-0 top-0 z-10 flex h-4 w-4 items-center justify-center"
                  style={{ background: 'rgba(15, 23, 42, 0.78)', color: '#fff' }}
                  aria-label={`Remove seed color ${i + 1}`}
                  title="Remove seed color"
                >
                  <X size={10} />
                </button>
                <input
                  type="color"
                  value={seed}
                  onChange={(e) => {
                    const next = [...seeds]
                    next[i] = e.target.value
                    setSeeds(next)
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  aria-label={`Seed color ${i + 1}`}
                />
                <div className="w-full h-full" style={{ background: seed }} />
              </div>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {seed.toUpperCase()}
              </span>
            </div>
          ))}
          {seeds.length < 4 && (
            <button
              onClick={() => setSeeds([...seeds, '#888888'])}
              className="w-10 h-10 border-2 border-dashed flex items-center justify-center text-xl transition-colors"
              style={{ borderColor: 'var(--panel-border)', color: 'var(--text-secondary)' }}
              aria-label="Add seed color"
            >
              +
            </button>
          )}
        </div>

        <button
          onClick={generate}
          disabled={isGenerating}
          className="w-full h-10 flex items-center justify-center gap-2 text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {isGenerating
            ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
            : <><Sparkles size={14} /> Generate Palette</>}
        </button>

        {error && <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{error}</p>}
        </div>
      </section>

      {/* ── Palette canvas ── */}
      {colors.length > 0 && (
        <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
          <div
            className="flex items-center px-4 border-b text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
          >
            Palette ({colors.length} colors)
          </div>
          <div className="px-4 py-4">
            <div className="overflow-x-auto border" style={{ borderColor: 'var(--panel-border)' }}>
              <PaletteCanvas colors={colors} />
            </div>
          </div>
        </section>
      )}

      {/* ── Theme slot editor ── */}
      {slots && <ThemeSlotEditor />}

      {/* ── Iconify ── */}
      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div
          className="flex items-center px-4 border-b text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
        >
          Iconify Icons
        </div>
        <div className="px-4 py-4 flex flex-col gap-3">
          <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
            Slides now use Iconify IDs instead of a local PNG directory. Pick an icon set to constrain the examples and the IDs suggested to the slide generator.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Icon set
            </span>
            <select
              value={selectedIconCollection}
              onChange={(e) => setSelectedIconCollection(e.target.value as typeof selectedIconCollection)}
              className="h-9 border px-3 text-sm outline-none"
              style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
            >
              {iconCollectionOptions.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
            {selectedCollection.description}
          </p>
          <div
            className="grid gap-2 overflow-y-auto max-h-48 border p-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
              borderColor: 'var(--panel-border)',
            }}
          >
            {iconExamples.map((icon) => (
              <div
                key={icon}
                className="flex flex-col items-center gap-1.5 p-2 border cursor-default"
                style={{ borderColor: 'transparent', background: 'var(--surface-hover)' }}
                title={icon}
              >
                <Icon icon={icon} width={24} height={24} style={{ color: 'var(--text-secondary)' }} />
                <span className="text-[9px] truncate w-full text-center leading-tight" style={{ color: 'var(--text-muted)' }}>
                  {icon}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Export ── */}
      {tokens && (
        <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
          <div className="px-4 py-4">
          <button
            onClick={exportThmx}
            className="w-full flex items-center justify-center gap-2 border text-sm font-medium transition-colors"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent', height: 36 }}
          >
            <Download size={14} />
            Export .thmx
          </button>
          </div>
        </section>
      )}
    </div>
  )
}
