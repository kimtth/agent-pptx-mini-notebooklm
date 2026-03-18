import { ipcMain, dialog } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { promisify } from 'util'
import { load } from 'cheerio'
import { readWorkspaceDir, resolveBundledPath } from './workspace-utils.ts'
import { ensurePythonModule, pythonSetupHint, resolvePythonExecutable } from './python-runtime.ts'
import type { ImageSearchCandidate, ImageSearchRequest, ImageSearchResult, ResolvedSlideImage } from '../../src/domain/ports/ipc'

const execFileAsync = promisify(execFile)

interface PythonImageSearchResponse {
  query?: string
  candidates?: Array<{
    provider?: 'google' | 'bing' | null
    searchQuery?: string | null
    imageUrl?: string | null
    thumbnailUrl?: string | null
    sourcePageUrl?: string | null
    title?: string | null
    attribution?: string | null
  }>
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image'
}

function hashValue(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function candidateId(...parts: Array<string | null | undefined>): string {
  return hashValue(parts.filter(Boolean).join('|'))
}

function deriveQuery(slide: ImageSearchRequest): string {
  const explicit = slide.imageQuery?.trim()
  if (explicit) return explicit
  return [slide.title, slide.keyMessage, ...slide.bullets.slice(0, 2)]
    .filter(Boolean)
    .join(' ')
    .trim()
}

function deriveQueries(slide: ImageSearchRequest): string[] {
  const explicit = (slide.imageQueries ?? [])
    .map((query) => query.trim())
    .filter(Boolean)

  if (explicit.length > 0) return explicit

  const fromText = String(slide.imageQuery ?? '')
    .split(/[\r\n,;]+/)
    .map((query) => query.trim())
    .filter(Boolean)

  if (fromText.length > 0) return fromText

  const fallback = deriveQuery(slide)
  return fallback ? [fallback] : []
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function extensionFromUrl(url: string, contentType: string | null): string {
  if (contentType) {
    if (contentType.includes('png')) return '.png'
    if (contentType.includes('webp')) return '.webp'
    if (contentType.includes('svg')) return '.svg'
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg'
  }
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return '.png'
  if (pathname.endsWith('.webp')) return '.webp'
  if (pathname.endsWith('.svg')) return '.svg'
  return '.jpg'
}

function extensionFromDataUrl(value: string): string {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(value)
  const type = match?.[1]?.toLowerCase() ?? 'jpeg'
  if (type === 'png') return '.png'
  if (type === 'webp') return '.webp'
  if (type === 'svg+xml') return '.svg'
  return '.jpg'
}

function normalizeAbsoluteUrl(candidate: string | undefined | null, baseUrl: string): string | null {
  if (!candidate) return null
  try {
    return new URL(candidate, baseUrl).toString()
  } catch {
    return null
  }
}

function deriveCandidateTitle(candidate: string | null | undefined): string | null {
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const lastSegment = url.pathname.split('/').filter(Boolean).pop()
    return decodeURIComponent(lastSegment || url.hostname)
  } catch {
    return candidate.slice(0, 80)
  }
}

async function ensureImagesDir(): Promise<string> {
  const workspaceDir = await readWorkspaceDir()
  const imagesDir = path.join(workspaceDir, 'images')
  await fs.mkdir(imagesDir, { recursive: true })
  return imagesDir
}

async function copyLocalFilesForSlide(slide: ImageSearchRequest): Promise<ResolvedSlideImage[]> {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: `Choose images for slide ${slide.number}`,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (canceled || filePaths.length === 0) return []

  const imagesDir = await ensureImagesDir()
  const query = deriveQuery(slide) || null
  const copied: ResolvedSlideImage[] = []

  for (const sourcePath of filePaths) {
    const ext = path.extname(sourcePath) || '.jpg'
    const baseName = `${String(slide.number).padStart(2, '0')}-${slugify(slide.title)}-${hashValue(sourcePath)}${ext.toLowerCase()}`
    const destination = path.join(imagesDir, baseName)
    await fs.copyFile(sourcePath, destination)
    copied.push({
      id: candidateId('local', sourcePath),
      number: slide.number,
      imageQuery: query,
      imageUrl: null,
      imagePath: destination,
      imageAttribution: path.basename(sourcePath),
      sourcePageUrl: null,
      thumbnailUrl: null,
    })
  }

  return copied
}

async function performImageQuery(query: string): Promise<ImageSearchCandidate[]> {
  const python = await resolvePythonExecutable()
  await ensurePythonModule(python, 'icrawler', `Install the Python dependencies first. ${pythonSetupHint()}`)

  const scriptPath = resolveBundledPath('scripts', 'google_image_search.py')
  const queries = deriveQueries({ number: 0, title: '', keyMessage: '', bullets: [], imageQuery: query, imageQueries: [query] })
  const args = [scriptPath]
  for (const item of queries) {
    args.push('--query', item)
  }
  args.push('--max-num', '12')

  const { stdout } = await execFileAsync(
    python,
    args,
    { timeout: 45_000, windowsHide: true, cwd: path.dirname(scriptPath), env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  )

  const data = JSON.parse(stdout) as PythonImageSearchResponse

  return (data.candidates ?? []).map((item, index) => ({
    id: candidateId(item.provider ?? 'google', item.imageUrl ?? item.thumbnailUrl ?? String(index)),
    provider: item.provider === 'bing' ? 'bing' as const : 'google' as const,
    searchQuery: item.searchQuery ?? query,
    title: item.title ?? `${item.provider === 'bing' ? 'Bing' : 'Google'} image ${index + 1}`,
    imageUrl: item.imageUrl ?? null,
    thumbnailUrl: item.thumbnailUrl ?? item.imageUrl ?? null,
    sourcePageUrl: item.sourcePageUrl ?? null,
    attribution: item.attribution ?? item.sourcePageUrl ?? item.imageUrl ?? null,
    inlineImageDataUrl: null,
  })).filter((candidate) => Boolean(candidate.imageUrl || candidate.thumbnailUrl))
}

async function resolveImageFromSourcePage(pageUrl: string): Promise<string | null> {
  const { fetch } = await import('undici')
  const res = await fetch(pageUrl, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'PPTX Slide Agent/1.0 (image lookup)',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) return null
  const html = await res.text()
  const $ = load(html)

  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content'),
    $('link[rel="image_src"]').attr('href'),
    $('img').first().attr('src'),
  ]

  for (const candidate of candidates) {
    const absolute = normalizeAbsoluteUrl(candidate, pageUrl)
    if (absolute && isHttpUrl(absolute)) return absolute
  }
  return null
}

async function downloadImage(url: string, destination: string): Promise<void> {
  const { fetch } = await import('undici')
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'PPTX Slide Agent/1.0 (image download)' },
  })
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(destination, buf)
}

async function writeDataUrlImage(dataUrl: string, destination: string): Promise<void> {
  const base64 = dataUrl.split(',', 2)[1]
  if (!base64) throw new Error('Invalid data URL image')
  await fs.writeFile(destination, Buffer.from(base64, 'base64'))
}

function dedupeCandidates(candidates: ImageSearchCandidate[]): ImageSearchCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.imageUrl ?? candidate.sourcePageUrl ?? candidate.inlineImageDataUrl ?? candidate.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function searchImageCandidatesForSlide(slide: ImageSearchRequest): Promise<ImageSearchResult> {
  const queries = deriveQueries(slide)
  const query = queries.join('\n')
  if (queries.length === 0) {
    return { query: '', candidates: [] }
  }

  if (queries.every((item) => isHttpUrl(item))) {
    return {
      query,
      candidates: queries.map((item) => ({
        id: candidateId('direct', item),
        provider: 'direct' as const,
        searchQuery: item,
        title: deriveCandidateTitle(item),
        imageUrl: item,
        thumbnailUrl: item,
        sourcePageUrl: item,
        attribution: item,
        inlineImageDataUrl: null,
      })),
    }
  }

  return {
    query,
    candidates: dedupeCandidates((await Promise.all(queries.map((item) => performImageQuery(item)))).flat()).slice(0, 32),
  }
}

async function downloadCandidateForSlide(slide: ImageSearchRequest, candidate: ImageSearchCandidate): Promise<ResolvedSlideImage> {
  const query = candidate.searchQuery ?? deriveQuery(slide)
  try {
    const candidateUrls = [
      candidate.imageUrl,
      candidate.sourcePageUrl ? await resolveImageFromSourcePage(candidate.sourcePageUrl) : null,
      candidate.thumbnailUrl,
    ].filter((value): value is string => Boolean(value && isHttpUrl(value)))

    const inlineDataUrl = candidate.inlineImageDataUrl

    if (candidateUrls.length === 0 && !inlineDataUrl) {
      return { id: candidate.id, number: slide.number, imageQuery: query, imageUrl: null, imagePath: null, imageAttribution: null, sourcePageUrl: candidate.sourcePageUrl, thumbnailUrl: candidate.thumbnailUrl }
    }

    const imagesDir = await ensureImagesDir()
    const { fetch } = await import('undici')
    const primaryUrl = candidateUrls[0] ?? null
    const head = primaryUrl ? await fetch(primaryUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) }).catch(() => null) : null
    const ext = primaryUrl
      ? extensionFromUrl(primaryUrl, head?.headers.get('content-type') ?? null)
      : extensionFromDataUrl(inlineDataUrl!)
    const filePath = path.join(imagesDir, `${String(slide.number).padStart(2, '0')}-${slugify(slide.title)}-${hashValue(primaryUrl ?? inlineDataUrl ?? query)}${ext}`)

    if (primaryUrl) {
      let downloaded = false
      for (const url of candidateUrls) {
        try {
          await downloadImage(url, filePath)
          downloaded = true
          break
        } catch {
          // Try the next available candidate URL before giving up.
        }
      }

      if (!downloaded) {
        return { id: candidate.id, number: slide.number, imageQuery: query, imageUrl: null, imagePath: null, imageAttribution: null, sourcePageUrl: candidate.sourcePageUrl, thumbnailUrl: candidate.thumbnailUrl }
      }
    } else {
      await writeDataUrlImage(inlineDataUrl!, filePath)
    }

    return {
      id: candidate.id,
      number: slide.number,
      imageQuery: query,
      imageUrl: primaryUrl,
      imagePath: filePath,
      imageAttribution: candidate.sourcePageUrl ?? candidate.attribution ?? candidate.title ?? primaryUrl,
      sourcePageUrl: candidate.sourcePageUrl,
      thumbnailUrl: candidate.thumbnailUrl,
    }
  } catch {
    return { id: candidate.id, number: slide.number, imageQuery: query, imageUrl: null, imagePath: null, imageAttribution: null, sourcePageUrl: candidate.sourcePageUrl, thumbnailUrl: candidate.thumbnailUrl }
  }
}

async function resolveImageForSlide(slide: ImageSearchRequest): Promise<ResolvedSlideImage> {
  try {
    const search = await searchImageCandidatesForSlide(slide)
    if (search.candidates.length === 0) {
      return { id: candidateId('empty', String(slide.number), search.query), number: slide.number, imageQuery: search.query || null, imageUrl: null, imagePath: null, imageAttribution: null, sourcePageUrl: null, thumbnailUrl: null }
    }
    return downloadCandidateForSlide(slide, search.candidates[0])
  } catch {
    return { id: candidateId('failed', String(slide.number), deriveQuery(slide)), number: slide.number, imageQuery: deriveQuery(slide) || null, imageUrl: null, imagePath: null, imageAttribution: null, sourcePageUrl: null, thumbnailUrl: null }
  }
}

export function registerImageHandlers(): void {
  ipcMain.handle('images:searchForSlide', async (_event, slide: ImageSearchRequest): Promise<ImageSearchResult> => {
    return searchImageCandidatesForSlide(slide)
  })

  ipcMain.handle('images:downloadForSlide', async (_event, slide: ImageSearchRequest, candidate: ImageSearchCandidate): Promise<ResolvedSlideImage> => {
    return downloadCandidateForSlide(slide, candidate)
  })

  ipcMain.handle('images:pickLocalFilesForSlide', async (_event, slide: ImageSearchRequest): Promise<ResolvedSlideImage[]> => {
    return copyLocalFilesForSlide(slide)
  })

  ipcMain.handle('images:resolveForSlides', async (_event, slides: ImageSearchRequest[]): Promise<ResolvedSlideImage[]> => {
    if (!Array.isArray(slides) || slides.length === 0) return []
    const results: ResolvedSlideImage[] = []
    for (const slide of slides) {
      results.push(await resolveImageForSlide(slide))
    }
    return results
  })
}