import { iconExistsInCollection } from './icon-dict-lookup'
import { findClosestCatalogIcon } from './icon-catalog'

export const ICONIFY_API_HOSTS = [
  'https://api.iconify.design',
  'https://api.simplesvg.com',
  'https://api.unisvg.com',
] as const

export const ICONIFY_COLLECTIONS = [
  {
    id: 'all',
    label: 'All supported sets',
    description: 'Mix examples from every supported Iconify collection.',
    examples: [
      'mdi:trending-up',
      'lucide:brain',
      'tabler:building-skyscraper',
      'fa6-solid:rocket',
      'ph:chart-line-up-bold',
      'fluent:people-team-24-regular',
    ],
  },
  {
    id: 'mdi',
    label: 'Material Design Icons',
    description: 'Broad general-purpose icons with consistent coverage.',
    examples: ['mdi:trending-up', 'mdi:brain', 'mdi:domain', 'mdi:rocket-outline'],
  },
  {
    id: 'lucide',
    label: 'Lucide',
    description: 'Clean stroke icons suited to modern product slides.',
    examples: ['lucide:brain', 'lucide:line-chart', 'lucide:building-2', 'lucide:rocket'],
  },
  {
    id: 'tabler',
    label: 'Tabler',
    description: 'Detailed outline icons with strong business and UI coverage.',
    examples: ['tabler:building-skyscraper', 'tabler:chart-line', 'tabler:bulb', 'tabler:target-arrow'],
  },
  {
    id: 'ph',
    label: 'Phosphor',
    description: 'Expressive icons available in multiple weights.',
    examples: ['ph:chart-line-up-bold', 'ph:brain-bold', 'ph:buildings-bold', 'ph:rocket-launch-bold'],
  },
  {
    id: 'fa6-solid',
    label: 'Font Awesome 6 Solid',
    description: 'Dense filled icons that read well at small sizes.',
    examples: ['fa6-solid:rocket', 'fa6-solid:chart-line', 'fa6-solid:building', 'fa6-solid:lightbulb'],
  },
  {
    id: 'fluent',
    label: 'Fluent UI System',
    description: 'Microsoft-style icons that fit Office-adjacent presentations.',
    examples: ['fluent:people-team-24-regular', 'fluent:brain-circuit-24-regular', 'fluent:building-24-regular', 'fluent:arrow-trending-24-regular'],
  },
] as const

export type IconifyCollectionId = (typeof ICONIFY_COLLECTIONS)[number]['id']

export const DEFAULT_ICONIFY_COLLECTION: IconifyCollectionId = 'all'

export const ICONIFY_EXAMPLES = ICONIFY_COLLECTIONS[0].examples

export const ICONIFY_PROMPT_HINTS = [
  ...ICONIFY_EXAMPLES,
] as const

export function getIconifyCollectionOptions() {
  return ICONIFY_COLLECTIONS
}

export function getIconifyCollectionById(collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION) {
  return ICONIFY_COLLECTIONS.find((collection) => collection.id === collectionId) ?? ICONIFY_COLLECTIONS[0]
}

export function getIconifyExamples(collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION): string[] {
  return [...getIconifyCollectionById(collectionId).examples]
}

export function getDefaultIconifyPrefix(collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION): string {
  return collectionId === 'all' ? 'mdi' : collectionId
}

export function normalizeIconName(
  value: string | null | undefined,
  collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION,
): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const lowered = raw.toLowerCase()
  if (lowered.includes(':')) return lowered
  return `${getDefaultIconifyPrefix(collectionId)}:${lowered}`
}

/**
 * Ensure the icon ID carries the correct collection prefix and that the
 * stem actually exists in the target collection (verified against the
 * offline dictionary generated from @iconify/json).
 *
 * Strategy:
 * 1. If the stem exists in the full dictionary for the target collection
 *    → accept as-is (with correct prefix).
 * 2. Otherwise look up the closest match from the curated catalog —
 *    a small, deterministic set of verified icon names.
 * 3. If nothing matches, return null (icon omitted rather than hallucinated).
 *
 * When `collectionId` is `'all'`, no enforcement is applied.
 */
export function enforceIconCollection(
  value: string | null | undefined,
  collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION,
): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const lowered = raw.toLowerCase()

  if (collectionId === 'all') {
    return normalizeIconName(lowered, collectionId)
  }

  // Extract the stem (strip any prefix)
  let stem: string
  if (lowered.includes(':')) {
    const [, ...rest] = lowered.split(':')
    stem = rest.join(':')
  } else {
    stem = lowered
  }

  // 1. Exact match in full dictionary → use it
  if (iconExistsInCollection(stem, collectionId)) {
    return `${collectionId}:${stem}`
  }

  // 2. Deterministic fallback: find closest from curated catalog
  const catalogMatch = findClosestCatalogIcon(stem, collectionId)
  if (catalogMatch) {
    return `${collectionId}:${catalogMatch}`
  }

  // 3. No match → omit the icon entirely (no guessing)
  return null
}

export function getAvailableIconChoices(collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION): string[] {
  return [...new Set([...getIconifyExamples(collectionId)])]
}

export function buildIconifySvgUrl(
  iconName: string,
  colorHex?: string,
  hostIndex?: number,
  collectionId: IconifyCollectionId = DEFAULT_ICONIFY_COLLECTION,
): string {
  const normalized = normalizeIconName(iconName, collectionId)
  if (!normalized) throw new Error('Icon name is required')
  const [prefix, ...nameParts] = normalized.split(':')
  if (!prefix || nameParts.length === 0) throw new Error(`Invalid Iconify icon name: ${iconName}`)

  const name = nameParts.join(':')
  const query = new URLSearchParams()
  query.set('box', '1')
  if (colorHex) {
    query.set('color', colorHex.startsWith('#') ? colorHex : `#${colorHex}`)
  }

  const host = ICONIFY_API_HOSTS[Math.min(hostIndex ?? 0, ICONIFY_API_HOSTS.length - 1)]
  return `${host}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg?${query.toString()}`
}
