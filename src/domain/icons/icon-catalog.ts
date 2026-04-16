/**
 * icon-catalog.ts
 *
 * Provides access to the curated icon catalog — a small, categorised subset
 * of each collection's icons that is injected into the LLM system prompt.
 * Because the LLM only sees (and is instructed to only pick from) this
 * catalog, icon-name hallucination is eliminated at the source.
 */
import catalog from './icon-catalog.json' with { type: 'json' }
import type { IconifyCollectionId } from './iconify'

type Catalog = Record<string, Record<string, string[]>>
const data: Catalog = catalog as Catalog

/**
 * Return the flat set of all curated icon stems for a collection.
 */
export function getCatalogIconSet(collectionId: IconifyCollectionId): Set<string> {
  const categories = data[collectionId]
  if (!categories) return new Set()
  const all = new Set<string>()
  for (const names of Object.values(categories)) {
    for (const n of names) all.add(n)
  }
  return all
}

/**
 * Check if an icon stem is in the curated catalog for a collection.
 */
export function isInCatalog(stem: string, collectionId: IconifyCollectionId): boolean {
  return getCatalogIconSet(collectionId).has(stem)
}

/**
 * Format the catalog as a prompt string for the LLM.
 * Grouped by category so the LLM can pick semantically appropriate icons.
 */
export function formatCatalogForPrompt(collectionId: IconifyCollectionId): string {
  const categories = data[collectionId]
  if (!categories) return ''
  const lines: string[] = []
  for (const [category, icons] of Object.entries(categories)) {
    lines.push(`${category}: ${icons.map((n) => `${collectionId}:${n}`).join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Find the closest catalog icon to a given stem using simple substring matching.
 * Used as a deterministic fallback when the LLM emits an icon not in the catalog.
 */
export function findClosestCatalogIcon(
  stem: string,
  collectionId: IconifyCollectionId,
): string | null {
  const categories = data[collectionId]
  if (!categories) return null

  // Strip common suffixes to get a base keyword
  const base = stem
    .replace(/-(outline|filled|regular|bold|solid|thin|light|duotone)$/g, '')
    .replace(/-\d{1,2}(-(?:regular|filled|bold|light|thin))?$/g, '')

  const parts = base.split('-')

  // Build candidate keywords: full base, consecutive-pair windows, individual parts
  const candidates: string[] = [base]
  if (parts.length > 2) {
    for (let i = 0; i < parts.length - 1; i++) {
      candidates.push(parts.slice(i, i + 2).join('-'))
    }
  }
  for (const p of parts) {
    if (p.length >= 3) candidates.push(p) // skip short noise words
  }

  for (const kw of candidates) {
    for (const icons of Object.values(categories)) {
      const match = icons.find((n) => n.startsWith(kw + '-') || n === kw)
      if (match) return match
    }
  }

  return null
}
