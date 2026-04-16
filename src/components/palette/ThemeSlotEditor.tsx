/**
 * ThemeSlotEditor: curated OOXML theme color slots with colored dropdowns
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { usePaletteStore } from '../../stores/palette-store'
import type { ThemeSlots } from '../../domain/entities/palette'

const SLOT_LABELS: { key: keyof ThemeSlots; label: string; description: string }[] = [
  { key: 'dk1', label: 'Primary Text', description: 'Main text' },
  { key: 'dk2', label: 'Secondary Text / Borders', description: 'Muted text and lines' },
  { key: 'accent1', label: 'Brand Color', description: 'Hero accents, key numbers, primary emphasis' },
  { key: 'accent2', label: 'Secondary Brand Color', description: 'Secondary charts, comparison blocks, supporting emphasis' },
  { key: 'accent3', label: 'Chart Color 1', description: '3rd series, stacked bars, timeline dots' },
  { key: 'accent4', label: 'Chart Color 2', description: '4th series, comparison panels, callout stats' },
  { key: 'accent5', label: 'Chart Color 3', description: '5th series, badges, status chips' },
  { key: 'accent6', label: 'Chart Color 4', description: '6th series, alerts, warm highlights' },
  { key: 'hlink', label: 'Link Color', description: 'Links' },
  { key: 'folHlink', label: 'Visited Link Color', description: 'Visited links' },
]

export function ThemeSlotEditor() {
  const { slots, colors, setSlots, clearThemeColors, themeName, setThemeName, commitTokens } = usePaletteStore()
  const [openKey, setOpenKey] = useState<keyof ThemeSlots | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)

  if (!slots) return null

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenKey(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const handleChange = (key: keyof ThemeSlots, hex: string) => {
    const next = { ...slots, [key]: hex.replace('#', '') }
    setSlots(next)
    commitTokens()
    setOpenKey(null)
  }

  const colorOptions = useMemo(
    () =>
      colors.map((color) => ({
        ...color,
        normalizedHex: normalizeHex(color.hex),
      })),
    [colors],
  )

  return (
    <section
      ref={rootRef}
      className="border"
      style={{ borderColor: 'var(--panel-border)', background: 'var(--surface)' }}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 border-b text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--panel-border)', height: 40, minHeight: 40 }}
      >
        <span>Theme Colors</span>
        <button
          type="button"
          onClick={() => clearThemeColors()}
          className="flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-widest transition-opacity"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Clear theme colors"
          title="Clear theme colors"
        >
          <span>Clear</span>
        </button>
      </div>

      <div className="px-4 py-4">
      <p className="mb-4 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
        Pick colors by how they are used in the deck.
      </p>

      {/* Theme name */}
      <input
        type="text"
        value={themeName}
        onChange={(e) => {
          setThemeName(e.target.value)
          commitTokens()
        }}
        placeholder="Theme name"
        className="w-full px-3 py-2 text-xs mb-4 border outline-none"
        style={{
          background: 'var(--input-bg)',
          borderColor: 'var(--panel-border)',
          color: 'var(--text-primary)',
        }}
      />

      <div className="flex flex-col gap-2">
        {SLOT_LABELS.map(({ key, label, description }) => {
          const current = normalizeHex(slots[key])
          const selectedColor = colorOptions.find((color) => color.normalizedHex === current)
          return (
            <div key={key} className="flex flex-col gap-2">
              <div className="min-w-0 flex-[1.2] leading-tight">
                <div className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {label}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  {description}
                </div>
              </div>

              {/* Color swatch (click to open picker) */}
              <div className="flex items-center gap-2 w-full">
                <div
                  className="relative flex-none w-7 h-7 border overflow-hidden"
                  style={{ borderColor: 'var(--panel-border)' }}
                >
                  <input
                    type="color"
                    value={current}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    aria-label={`${label} color picker`}
                  />
                  <div className="w-full h-full" style={{ background: current }} />
                </div>

                {/* Dropdown */}
                <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => setOpenKey((currentOpen) => (currentOpen === key ? null : key))}
                  className="flex h-8 w-full items-center gap-2 border px-2 text-left text-xs outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--panel-border)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={openKey === key}
                  aria-label={label}
                >
                  <ColorSwatch hex={current} />
                  <span className="min-w-0 flex-1 truncate">
                    {selectedColor ? `${selectedColor.name} — ${selectedColor.normalizedHex}` : current.toUpperCase()}
                  </span>
                  <ChevronDown size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                </button>

                {openKey === key && (
                  <div
                    className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto border shadow-lg"
                    style={{
                      background: 'var(--surface)',
                      borderColor: 'var(--panel-border)',
                    }}
                    role="listbox"
                    aria-label={`${label} options`}
                  >
                    {colorOptions.map((color) => {
                      const isSelected = color.normalizedHex === current
                      return (
                        <button
                          key={`${key}-${color.normalizedHex}`}
                          type="button"
                          onClick={() => handleChange(key, color.normalizedHex)}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-hover)]"
                          style={{
                            color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                            background: isSelected ? 'var(--surface-hover)' : 'transparent',
                          }}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <ColorSwatch hex={color.normalizedHex} />
                          <span className="min-w-0 flex-1 truncate">
                            {color.name} — {color.normalizedHex.toUpperCase()}
                          </span>
                          {isSelected && <Check size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                        </button>
                      )
                    })}
                  </div>
                )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      </div>
    </section>
  )
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span
      className="inline-block h-3.5 w-3.5 flex-none border"
      style={{ background: hex, borderColor: 'var(--panel-border)' }}
      aria-hidden="true"
    />
  )
}

function normalizeHex(hex: string): string {
  const withHash = hex.startsWith('#') ? hex : `#${hex}`
  return withHash.toUpperCase()
}
