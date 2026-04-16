#!/usr/bin/env node
/**
 * Generate a compact icon-name dictionary from @iconify/json.
 *
 * Output: src/domain/icons/iconify-dict.json
 * Structure: { "<prefix>": ["icon-name-1", "icon-name-2", ...] }
 *
 * Only the collections supported by ICONIFY_COLLECTIONS are included.
 * Both canonical icons and aliases are merged into one sorted array per
 * collection so a simple Set lookup can verify whether an icon ID exists.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const SUPPORTED_COLLECTIONS = ['mdi', 'lucide', 'tabler', 'ph', 'fa6-solid', 'fluent']

const dict = {}

for (const prefix of SUPPORTED_COLLECTIONS) {
  const jsonPath = path.join(ROOT, 'node_modules', '@iconify', 'json', 'json', `${prefix}.json`)
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

  const names = new Set(Object.keys(data.icons))
  if (data.aliases) {
    for (const alias of Object.keys(data.aliases)) {
      names.add(alias)
    }
  }

  dict[prefix] = [...names].sort()
  console.log(`${prefix}: ${dict[prefix].length} entries`)
}

const outPath = path.join(ROOT, 'src', 'domain', 'icons', 'iconify-dict.json')
fs.writeFileSync(outPath, JSON.stringify(dict), 'utf-8')

const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0)
console.log(`\nWrote ${outPath} (${sizeKB} KB)`)
