#!/usr/bin/env node
/**
 * generate-icon-catalog.mjs
 *
 * Produces a curated subset of ~150-200 presentation-relevant icons per
 * collection, grouped by semantic category.  This catalog is injected into
 * the LLM system prompt so the model picks only from verified, existing
 * icon IDs — eliminating hallucination entirely.
 *
 * Usage:  node scripts/generate-icon-catalog.mjs
 * Output: src/domain/icons/icon-catalog.json
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DICT_PATH = resolve(__dirname, '../src/domain/icons/iconify-dict.json')
const OUT_PATH = resolve(__dirname, '../src/domain/icons/icon-catalog.json')

const dict = JSON.parse(readFileSync(DICT_PATH, 'utf-8'))

// ── Semantic categories with seed keywords ──────────────────────────
// Each category maps to an array of keyword prefixes used to match icon
// stems.  A stem matches if it starts with "<keyword>-" or equals the
// keyword exactly.
const CATEGORIES = {
  'data & charts': [
    'database', 'data-area', 'data-bar', 'data-line', 'data-pie',
    'data-scatter', 'data-trending', 'data-funnel', 'data-histogram',
    'data-sunburst', 'data-treemap', 'data-usage', 'data-waterfall',
    'chart', 'analytics', 'graph',
  ],
  'tables & grids': [
    'table', 'grid', 'column', 'row', 'list',
  ],
  'people & org': [
    'person', 'people', 'team', 'group', 'organization', 'hat-graduation',
    'guest', 'contact', 'badge', 'handshake',
  ],
  'building & place': [
    'building', 'office', 'city', 'home', 'globe', 'map', 'location',
    'earth',
  ],
  'technology': [
    'code', 'server', 'cloud', 'network', 'laptop', 'desktop', 'device',
    'computer', 'cpu', 'memory', 'hard-drive', 'terminal',
    'plug-connected', 'plug-disconnected', 'bot', 'bot-sparkle',
    'brain-circuit', 'brain', 'circuit-board',
    'wifi', 'bluetooth', 'usb', 'ethernet',
  ],
  'communication': [
    'chat', 'mail', 'call', 'phone', 'comment', 'megaphone', 'speaker',
    'notification', 'send', 'share',
  ],
  'security': [
    'shield', 'lock', 'key', 'fingerprint', 'password', 'guard',
    'incognito',
  ],
  'documents & files': [
    'document', 'folder', 'file', 'notebook', 'book', 'page', 'note',
    'clipboard', 'archive', 'attach',
  ],
  'navigation & flow': [
    'arrow-trending', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
    'arrow-swap', 'arrow-flow', 'arrow-sort', 'arrow-circle', 'arrow-sync',
    'flow', 'branch', 'link', 'route', 'swap',
    'navigation', 'compass',
  ],
  'status & feedback': [
    'check', 'checkmark', 'alert', 'warning', 'error', 'info',
    'question', 'question-circle', 'lightbulb', 'light-bulb', 'bulb',
    'thumb', 'star', 'heart', 'flag', 'circle-check', 'circle',
  ],
  'time & schedule': [
    'calendar', 'clock', 'timer', 'history', 'timeline',
  ],
  'finance': [
    'money', 'payment', 'wallet', 'currency', 'receipt', 'calculator',
    'cart', 'shopping',
  ],
  'media & creative': [
    'image', 'camera', 'video', 'design', 'paint', 'pen', 'edit',
    'crop', 'color', 'palette', 'sparkle',
  ],
  'actions': [
    'add', 'delete', 'save', 'search', 'filter', 'settings', 'config',
    'wrench', 'hammer', 'cog',
    'play', 'pause', 'stop', 'refresh', 'sync', 'download', 'upload',
    'copy', 'cut', 'paste', 'undo', 'redo',
    'eye', 'eye-off', 'zoom',
  ],
  'science & experiment': [
    'beaker', 'lab', 'flask', 'test-tube', 'microscope',
    'dna', 'molecule',
  ],
  'transport & misc': [
    'rocket', 'airplane', 'vehicle', 'truck',
    'puzzle', 'trophy', 'gift', 'leaf', 'weather',
    'fire', 'bolt', 'lightning', 'zap', 'energy',
    'layer', 'stack', 'apps', 'app-generic',
    'target', 'bullseye', 'counter',
    'cube', 'box', 'layout', 'board', 'dashboard',
    'task-list', 'checkbox', 'checklist', 'tasks',
  ],
}

// ── Per-collection normalisation ────────────────────────────────────
// Different collections use different suffix conventions.
// We pick one canonical variant per concept.

function preferredSuffix(collectionId) {
  switch (collectionId) {
    case 'fluent': return '-24-regular'
    case 'ph':     return '-bold'
    default:       return ''  // mdi, lucide, tabler, fa6-solid use bare stems
  }
}

function matchesKeyword(iconName, keyword) {
  // "database" matches "database", "database-arrow-right-24-regular", etc.
  return iconName === keyword || iconName.startsWith(keyword + '-')
}

function buildCatalog(collectionId, allNames) {
  const suffix = preferredSuffix(collectionId)
  // Pre-filter to preferred variant if suffix is set
  const pool = suffix
    ? allNames.filter(n => n.endsWith(suffix))
    : allNames

  const catalog = {}
  const used = new Set()

  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    const picks = []
    for (const kw of keywords) {
      const matches = pool.filter(n => {
        if (used.has(n)) return false
        // Strip the suffix for matching
        const stem = suffix ? n.slice(0, -suffix.length) : n
        return matchesKeyword(stem, kw)
      })
      // Sort: shorter (simpler) names first
      matches.sort((a, b) => a.length - b.length)
      // Take up to 2 per keyword to keep catalog tight
      for (const m of matches.slice(0, 2)) {
        if (!used.has(m)) {
          picks.push(m)
          used.add(m)
        }
      }
    }
    if (picks.length > 0) {
      catalog[category] = picks
    }
  }

  return catalog
}

// ── Main ────────────────────────────────────────────────────────────

const result = {}
let totalIcons = 0

for (const collectionId of Object.keys(dict)) {
  const catalog = buildCatalog(collectionId, dict[collectionId])
  result[collectionId] = catalog
  const count = Object.values(catalog).reduce((s, arr) => s + arr.length, 0)
  totalIcons += count
  console.log(`${collectionId}: ${count} icons across ${Object.keys(catalog).length} categories`)
}

writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), 'utf-8')
console.log(`\nWrote ${OUT_PATH}`)
console.log(`Total: ${totalIcons} icons across ${Object.keys(result).length} collections`)
