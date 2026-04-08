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
import type { ThemeColorTreatment, ThemeTextBoxStyle } from '../../domain/entities/palette.ts'

const COLOR_TREATMENT_OPTIONS: Array<{
  value: ThemeColorTreatment;
  label: string;
  description: string;
  preview: string;
}> = [
  {
    value: 'mixed',
    label: 'Mixed',
    description: 'Adaptive by context.',
    preview: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 45%, white) 50%, var(--accent) 100%)',
  },
  {
    value: 'solid',
    label: 'Solid',
    description: 'Use single-color fills for cards and text panels.',
    preview: 'var(--accent)',
  },
  {
    value: 'gradient',
    label: 'Gradient',
    description: 'Prefer layered fills and tonal transitions for large panels.',
    preview: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 45%, white) 100%)',
  },
]

const TEXT_BOX_STYLE_OPTIONS: Array<{
  value: ThemeTextBoxStyle;
  label: string;
  description: string;
  preview: string;
}> = [
  {
    value: 'mixed',
    label: 'Mixed',
    description: 'Adaptive by context.',
    preview: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05)), radial-gradient(circle at 82% 30%, color-mix(in srgb, var(--accent) 50%, white) 0, color-mix(in srgb, var(--accent) 50%, white) 12%, transparent 13%)',
  },
  {
    value: 'plain',
    label: 'Plain Text Box',
    description: 'Use text-only panels without decorative icons.',
    preview: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05))',
  },
  {
    value: 'with-icons',
    label: 'Text Box with Icons',
    description: 'Prefer text panels paired with a supporting icon when the layout allows it.',
    preview: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05)), radial-gradient(circle at 78% 34%, color-mix(in srgb, var(--accent) 72%, white) 0, color-mix(in srgb, var(--accent) 72%, white) 16%, transparent 17%)',
  },
]

const MIXED_TEXT_BOX_STYLE_OPTION = TEXT_BOX_STYLE_OPTIONS.find((option) => option.value === 'mixed')
const PRIMARY_TEXT_BOX_STYLE_OPTIONS = TEXT_BOX_STYLE_OPTIONS.filter((option) => option.value !== 'mixed')
const MIXED_COLOR_TREATMENT_OPTION = COLOR_TREATMENT_OPTIONS.find((option) => option.value === 'mixed')
const PRIMARY_COLOR_TREATMENT_OPTIONS = COLOR_TREATMENT_OPTIONS.filter((option) => option.value !== 'mixed')

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
    selectedFont,
    setSelectedFont,
    selectedColorTreatment,
    setSelectedColorTreatment,
    selectedTextBoxStyle,
    setSelectedTextBoxStyle,
    selectedIconCollection,
    setSelectedIconCollection,
  } = usePaletteStore()
  const [error, setError] = useState<string | null>(null)
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const iconCollectionOptions = getIconifyCollectionOptions()
  const selectedCollection = getIconifyCollectionById(selectedIconCollection)
  const iconExamples = getIconifyExamples(selectedIconCollection)

  useEffect(() => {
    window.electronAPI.theme.listFonts().then((fonts: string[]) => setSystemFonts(fonts))
  }, [])

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

      {/* ── Font family ── */}
      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div className="flex items-center px-4 border-b text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
        >
          Font
        </div>
        <div className="px-4 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Font family
            </span>
            <select
              value={selectedFont}
              onChange={(e) => { setSelectedFont(e.target.value); commitTokens(); }}
              className="h-9 border px-3 text-sm outline-none"
              style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)', color: 'var(--text-primary)', fontFamily: selectedFont }}
            >
              {systemFonts.length > 0 ? (
                systemFonts.map((font) => (
                  <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                ))
              ) : (
                <>
                  <option value="Calibri">Calibri</option>
                  <option value="Arial">Arial</option>
                  <option value="Noto Sans">Noto Sans</option>
                </>
              )}
            </select>
          </label>
          <p className="text-xs mt-2 leading-5" style={{ color: 'var(--text-muted)' }}>
            Base font used for slide text. CJK text auto-falls back to Noto Sans variants.
          </p>
        </div>
      </section>

      <section className="border" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}>
        <div className="flex items-center px-4 border-b text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
        >
          Palette Styling
        </div>
        <div className="px-4 py-4 flex flex-col gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Text Box Type
          </span>
          <div className="grid gap-3 md:grid-cols-2">
            {PRIMARY_TEXT_BOX_STYLE_OPTIONS.map((option) => {
              const active = option.value === selectedTextBoxStyle
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { setSelectedTextBoxStyle(option.value); commitTokens(); }}
                  className="border px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor: active ? 'var(--accent)' : 'var(--panel-border)',
                    background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div className="mb-2 flex h-9 items-center justify-between border px-2.5" style={{ borderColor: 'rgba(255,255,255,0.18)', background: option.preview }}>
                    <div className="h-2 w-12 rounded-full" style={{ background: 'rgba(255,255,255,0.85)' }} />
                    {option.value === 'with-icons' && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border text-[9px] font-semibold" style={{ borderColor: 'rgba(255,255,255,0.28)', color: '#fff', background: 'rgba(15, 23, 42, 0.24)' }}>
                        Ic
                      </div>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold leading-4">{option.label}</div>
                  <p className="mt-1 text-xs leading-4" style={{ color: 'var(--text-muted)' }}>
                    {option.description}
                  </p>
                </button>
              )
            })}
          </div>
          {MIXED_TEXT_BOX_STYLE_OPTION && (
            <button
              type="button"
              onClick={() => { setSelectedTextBoxStyle(MIXED_TEXT_BOX_STYLE_OPTION.value); commitTokens(); }}
              className="border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: MIXED_TEXT_BOX_STYLE_OPTION.value === selectedTextBoxStyle ? 'var(--accent)' : 'var(--panel-border)',
                background: MIXED_TEXT_BOX_STYLE_OPTION.value === selectedTextBoxStyle
                  ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
                  : 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="h-7 w-16 shrink-0 border" style={{ borderColor: 'rgba(255,255,255,0.18)', background: MIXED_TEXT_BOX_STYLE_OPTION.preview }} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-4">{MIXED_TEXT_BOX_STYLE_OPTION.label}</div>
                  <p className="mt-0.5 text-xs leading-4" style={{ color: 'var(--text-muted)' }}>
                    {MIXED_TEXT_BOX_STYLE_OPTION.description}
                  </p>
                </div>
              </div>
            </button>
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Text Box Fill Style
          </span>
          <div className="grid gap-3 md:grid-cols-2">
            {PRIMARY_COLOR_TREATMENT_OPTIONS.map((option) => {
              const active = option.value === selectedColorTreatment
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { setSelectedColorTreatment(option.value); commitTokens(); }}
                  className="border px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor: active ? 'var(--accent)' : 'var(--panel-border)',
                    background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div className="mb-2 h-9 border" style={{ borderColor: 'rgba(255,255,255,0.18)', background: option.preview }} />
                  <div className="text-[13px] font-semibold leading-4">{option.label}</div>
                  <p className="mt-1 text-xs leading-4" style={{ color: 'var(--text-muted)' }}>
                    {option.description}
                  </p>
                </button>
              )
            })}
          </div>
          {MIXED_COLOR_TREATMENT_OPTION && (
            <button
              type="button"
              onClick={() => { setSelectedColorTreatment(MIXED_COLOR_TREATMENT_OPTION.value); commitTokens(); }}
              className="border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: MIXED_COLOR_TREATMENT_OPTION.value === selectedColorTreatment ? 'var(--accent)' : 'var(--panel-border)',
                background: MIXED_COLOR_TREATMENT_OPTION.value === selectedColorTreatment
                  ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
                  : 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="h-7 w-16 shrink-0 border" style={{ borderColor: 'rgba(255,255,255,0.18)', background: MIXED_COLOR_TREATMENT_OPTION.preview }} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-4">{MIXED_COLOR_TREATMENT_OPTION.label}</div>
                  <p className="mt-0.5 text-xs leading-4" style={{ color: 'var(--text-muted)' }}>
                    {MIXED_COLOR_TREATMENT_OPTION.description}
                  </p>
                </div>
              </div>
            </button>
          )}
        </div>
      </section>

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
            Slides use live Iconify IDs from the selected collection. Pick an icon set to constrain the examples and the IDs suggested to the slide generator.
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
