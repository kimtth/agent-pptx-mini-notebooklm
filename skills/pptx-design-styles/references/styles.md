# 30 Modern PPTX Design Styles — Reference Guide

> **Font policy:** Fonts are resolved at runtime — `PPTX_FONT_FAMILY` (user-selected, defaults to Calibri) for Latin text, `resolve_font()` for CJK/non-Latin scripts (auto-selects the correct Noto Sans variant). Use `PPTX_FONT_FAMILY` or `resolve_font()` instead of hardcoding font names in generated code.

## ⚠️ Theme Priority & Contrast Rules

> **These rules override every individual style spec below.**

1. **`PPTX_THEME` is the sole colour source.** Every style below uses theme token names (`DARK`, `ACCENT1`, etc.) — resolve them via `PPTX_THEME` at runtime. Map each style colour role to the corresponding theme slot:
   | Style role | Theme slot (preferred → fallback) |
   |---|---|
   | Background | `BG` → `DARK` (dark styles) / `LIGHT` (light styles) |
   | Title text | `TEXT` → `LIGHT` (dark bg) / `DARK` (light bg) |
   | Body text | `TEXT` → `LIGHT2` (dark bg) / `DARK2` (light bg) |
   | Accent / highlight | `ACCENT1` → `PRIMARY` |
   | Secondary accent | `ACCENT2` |
   | Muted / caption | `ACCENT4` → `LIGHT2` |
   | Panel / card fill | `DARK2` (dark styles) / `LIGHT2` (light styles) |
   | Border / ornament | `ACCENT1` → `ACCENT3` |

2. **Contrast is mandatory.** Always call `ensure_contrast(fg_hex, bg_hex)` for every text colour assignment. This applies to:
   - Text on slide background
   - Text on panel / card fills
   - Text on image overlays
   - Text on any coloured shape

3. **Never produce dark text on a dark background** or light text on a light background. If a style's default palette creates this conflict with the active theme, invert the text colour or use `ensure_contrast()` to fix it.

4. **Style = mood + structure + technique. Theme = actual colours.** Follow each style's layout rules, signature elements, and design techniques faithfully — but always draw colours from the theme.

---

Each style is documented with:
- **Background** — slide background using theme tokens (`DARK`, `BG`, etc.)
- **Color Mapping** — role → theme token table (always resolved via `PPTX_THEME` at runtime)
- **Layout** — slide composition approach (always follow)
- **Signature Elements** — must-have design details for authenticity (always follow)
- **Avoid** — common mistakes that break the style (always follow)

---

## Theme Token Legend

All colors in this guide reference `PPTX_THEME` tokens — **never hardcoded hex values**. The actual colors are resolved from the active workspace palette at runtime.

| Token | Semantic Role |
|-------|---------------|
| `DARK` | Primary dark tone (backgrounds for dark styles, text for light styles) |
| `DARK2` | Secondary dark (slightly lighter than DARK) |
| `LIGHT` / `WHITE` / `BG` | Light tone (backgrounds for light styles, text for dark styles) |
| `LIGHT2` / `BORDER` | Secondary light (off-white, dividers, subtle borders) |
| `TEXT` | Primary text color (alias for DARK) |
| `ACCENT1` | Primary accent — use for the style's dominant accent |
| `ACCENT2` | Secondary accent — use for supporting color |
| `ACCENT3`–`ACCENT6` | Additional accents — distribute across visual elements |

**Rule**: The style defines *mood, structure, and visual technique*. The theme defines *actual colors*. Map each style's color role to the closest-matching theme token.

---

## 01. Glassmorphism

**Mood**: Premium, tech, futuristic  
**Best For**: SaaS, app launches, AI product decks

### Background
- Deep dark gradient using `DARK` as the base
- Multi-stop gradient: `DARK` → `DARK2` → accent-tinted variant
- Or deep single-tone: `DARK`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Glass card fill | `WHITE` | 15–20% opacity |
| Glass card border | `WHITE` | 25% opacity |
| Title text | `WHITE` | — |
| Body text | `LIGHT2` | — |
| Accent | `ACCENT1` or `ACCENT3` | glow blobs, highlights |

### Layout
- **Card-based**: use frosted-glass rectangles as content containers
- Rounded corners (radius 12–20px equivalent)
- Layer cards slightly offset and rotated ±5° for depth
- Add large blurred circles/ellipses behind cards for glow effect

### Signature Elements
- Translucent card (fill 15–20%, white border 25%)
- Blurred glow blobs in background
- All containers use the same glass treatment

### Avoid
- White backgrounds (kills the effect)
- Fully opaque cards
- Bright saturated solid colors

---

## 02. Neo-Brutalism

**Mood**: Bold, raw, provocative, startup energy  
**Best For**: Startup pitches, marketing campaigns, creative agencies

### Background
- High-saturation solid using `ACCENT1` as the dominant fill
- Or pure `WHITE` for inverted version

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `ACCENT1` | high-saturation primary fill |
| Card fill | `WHITE` or `DARK` | — |
| Border & shadow | `DARK` | pure black, hard offset |
| Accent | `ACCENT2` or `ACCENT6` | — |
| Text | `DARK` | — |

### Layout
- **Thick black borders** on all elements (2–4pt solid black)
- **Hard offset shadow** bottom-right of every card (5–8pt, no blur)
- Slight intentional misalignment — tilted shapes allowed

### Signature Elements
- Hard drop shadow (no blur, pure black offset)
- Thick border on every element
- One oversized number or word breaking the layout

### Avoid
- Soft shadows or gradients
- Rounded corners
- Pastel or muted colors

---

## 03. Bento Grid

**Mood**: Modular, informational, Apple-inspired  
**Best For**: Feature comparisons, product overviews, data summaries

### Background
- Near-white using `BG` as the base

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | off-white base |
| Cell 1 (dark) | `DARK` | anchor cell with light text |
| Cell 2 (accent 1) | `ACCENT1` | — |
| Cell 3 (accent 2) | `ACCENT2` | — |
| Cell 4 (accent 3) | `ACCENT3` | — |
| Cell 5 (warm) | `ACCENT4` | — |

### Layout
- CSS Grid-style layout: cells of different sizes spanning columns/rows
- Gap between cells: 8–12pt equivalent
- **Asymmetric merging**: one cell spans 2 columns, one spans 2 rows
- Each cell has one focused piece of info

### Signature Elements
- Asymmetric multi-size grid
- One dark anchor cell with white text
- Color-coded cells for visual hierarchy

### Avoid
- Equal-sized cells (boring)
- Too many colors (max 5)
- Dense text inside cells

---

## 04. Dark Academia

**Mood**: Scholarly, vintage, refined, literary  
**Best For**: Education, historical research, book presentations, university talks

### Background
- Deep warm dark using `DARK` as the base
- Or darker variant of `DARK` for maximum drama

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Title text | `ACCENT1` | gold tone from theme |
| Body text | `LIGHT2` | warm parchment feel |
| Border / ornament | `ACCENT2` | — |
| Accent | `ACCENT3` | muted supporting tone |

### Layout
- Centered title with wide letter-spacing (6–10pt)
- Body text in serif, generous leading (1.6–1.8)
- Decorative horizontal rule line (thin, gold tint)

### Signature Elements
- Italic serif title in gold
- Monospace footnote or date in muted gold

### Avoid
- Modern sans-serif fonts
- Bright or saturated colors
- Clean minimal layouts — add texture and decoration

---

## 05. Gradient Mesh

**Mood**: Artistic, vibrant, sensory, brand-forward  
**Best For**: Brand launches, creative portfolios, music/film promotions

### Background
- Multi-point radial gradient blend (4–6 colors overlapping)
- Blend of `ACCENT1` + `ACCENT2` + `ACCENT3` + `ACCENT4` bleeding into each other

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Mesh node 1 | `ACCENT1` | radial gradient source |
| Mesh node 2 | `ACCENT2` | radial gradient source |
| Mesh node 3 | `ACCENT3` | radial gradient source |
| Mesh node 4 | `ACCENT4` | radial gradient source |
| Text | `WHITE` | — |

### Layout
- Full-bleed gradient as background
- Minimal text overlay — let the gradient breathe
- Large centered title, small subtitle below
- Optional: frosted glass card for body text

### Signature Elements
- Multi-radial gradient that feels painterly, not linear
- White text with drop shadow
- Large typographic element dominating

### Avoid
- Linear two-color gradients (too plain)
- Dark or muted text
- Overcrowded layouts

---

## 06. Claymorphism

**Mood**: Friendly, soft 3D, tactile, playful  
**Best For**: Product launches, education, children's content, app UI decks

### Background
- Warm pastel gradient using `LIGHT2` as the base (warm tone from theme)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `LIGHT2` | warm pastel gradient |
| Clay element 1 | `ACCENT1` | — |
| Clay element 2 | `ACCENT2` | — |
| Clay element 3 | `ACCENT3` | — |
| Shadow | color-matched | element color @ 50% opacity, offset 8–12pt down |

### Layout
- **3D rounded shapes** as primary containers (radius 20–32pt equivalent)
- Each element casts a **colored drop shadow** (same hue, shifted down, no X offset)
- Inner highlight on top edge (white, 30% opacity)
- Playful asymmetric arrangement of clay bubbles

### Signature Elements
- Colored soft shadow (not grey) matching element color
- Very high border radius
- Inner highlight stripe at top of each element

### Avoid
- Sharp corners
- Grey/neutral shadows
- Flat design elements mixed in

---

## 07. Swiss International Style

**Mood**: Functional, authoritative, timeless, corporate  
**Best For**: Consulting, finance, government, institutional presentations

### Background
- Pure `BG` base
- Or subtle off-white variant of `BG`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | — |
| Primary text | `TEXT` | near-black |
| Accent bar | `ACCENT1` | signal color, vertical bar |
| Secondary text | `DARK2` | — |
| Divider line | `BORDER` | — |

### Layout
- Strict **5-column or 12-column grid** — every element snaps to columns
- **Vertical red rule** on left edge (4–8pt wide stripe)
- Single horizontal divider rule at mid-slide
- Circle accent element (red outline) in lower-right zone

### Signature Elements
- Left-edge vertical red bar
- Horizontal rule dividing title from content
- Grid-aligned text blocks with generous margins

### Avoid
- Decorative or illustrative elements
- Rounded corners
- More than 2 fonts

---

## 08. Aurora Neon Glow

**Mood**: Futuristic, AI, electric, otherworldly  
**Best For**: AI products, cybersecurity, deep tech, innovation summits

### Background
- Near-black deep space using `DARK` as the base

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | deep space base |
| Glow 1 | `ACCENT1` | blurred neon blob |
| Glow 2 | `ACCENT3` | blurred neon blob |
| Glow 3 | `ACCENT5` | blurred neon blob |
| Title gradient | `ACCENT1` → `ACCENT5` → `ACCENT3` | multi-stop gradient text |
| Body text | `LIGHT2` | — |

### Layout
- Large blurred glow blobs (filter blur 30–50pt) in background corners
- Centered or left-aligned title with gradient text effect
- Body on semi-transparent dark panel
- Optional scan-line texture overlay (5% opacity)

### Signature Elements
- Blurred neon glow circles (not sharp shapes)
- Gradient text (green → cyan → violet)
- Dark panel for body text legibility

### Avoid
- White or light backgrounds
- Solid non-glowing colors
- Dense body text without panels

---

## 09. Retro Y2K

**Mood**: Nostalgic, pop, chaotic fun, millennium energy  
**Best For**: Events, lifestyle marketing, fashion, creative campaigns

### Background
- Dark base using `DARK`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Rainbow stripe | `ACCENT1` → `ACCENT2` → `ACCENT3` → `ACCENT4` → `ACCENT5` → `ACCENT6` | full spectrum gradient |
| Title text | `WHITE` | — |
| Title glow | `ACCENT1` + `ACCENT3` | dual color shadow |
| Star accent | `ACCENT4` | — |

### Layout
- **Rainbow stripe bars** top and bottom (6–8pt height)
- Star/sparkle icons in corners (✦ ★)
- Title centered with double text shadow
- Optional: spinning star animation placeholder

### Signature Elements
- Rainbow gradient stripe bars
- Double-color text shadow (cyan + magenta)
- Star/sparkle motifs

### Avoid
- Minimalist layouts
- Muted or desaturated colors
- Serif fonts

---

## 10. Nordic Minimalism

**Mood**: Calm, natural, considered, Scandinavian  
**Best For**: Wellness, lifestyle, non-profit, sustainable brands

### Background
- Warm light base using `BG`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | warm cream |
| Organic shape | `BORDER` | warm grey from theme |
| Primary text | `TEXT` | — |
| Secondary text | `DARK2` | — |
| Accent dot | `TEXT` | — |

### Layout
- **Generous whitespace** — at least 40% of slide is empty
- One organic blob shape as background texture (low opacity, grey-beige)
- Minimal dot accent (3 dots in different brown tones) top-left corner
- Thin horizontal rule near bottom, then caption text

### Signature Elements
- Organic blob background shape
- 3-dot color accent
- Wide letter-spacing caption in monospace

### Avoid
- Bright or saturated colors
- Dense text or busy layouts
- Sans-serif display fonts (use serif or editorial)

---

## 11. Typographic Bold

**Mood**: Editorial, impactful, design-driven, authoritative  
**Best For**: Brand statements, manifestos, headline announcements

### Background
- Light base using `BG`
- Or `DARK` for inverted version

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` (or `DARK` for inverted) | — |
| Primary type | `TEXT` | near-black |
| Accent word | `ACCENT1` | single highlight color |
| Footnote | `BORDER` | light grey |

### Layout
- **Type fills the slide** — no illustrations or photos
- 2–3 lines maximum, massive scale
- One word or phrase in accent color
- Tiny footnote/label bottom-right in monospace

### Signature Elements
- Oversized type (80pt+) as the main visual
- Single accent color word breaking the monochrome
- Almost no margins — type bleeds toward edges

### Avoid
- Images or icons (type IS the design)
- More than 3 lines of large text
- Mixing multiple font families

---

## 12. Duotone / Color Split

**Mood**: Dramatic, comparative, energetic, bold  
**Best For**: Strategy decks, before/after, compare/contrast slides

### Background
- Left half: `ACCENT1` (vivid accent)
- Right half: `DARK` (deep dark)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Left panel | `ACCENT1` | — |
| Right panel | `DARK` | — |
| Divider | `WHITE` | 2–4pt vertical line |
| Left text | `WHITE` | — |
| Right text | `ACCENT1` | mirrors left panel color |

### Layout
- Strict **50/50 vertical split** with white divider line (2–4pt)
- Each panel shows one concept, one word, or one data point
- Text in left panel = white; text in right panel = left panel color
- Optional: diagonal split instead of vertical

### Signature Elements
- Exact 50/50 split
- White divider line
- Cross-panel color echo (right text = left panel color)

### Avoid
- Three or more color panels
- Similar hues (needs strong contrast)
- Busy content — one idea per panel

---

## 13. Monochrome Minimal

**Mood**: Restrained, luxury, precise, gallery-like  
**Best For**: Luxury brands, portfolio, art direction, high-end consulting

### Background
- Near-white using `BG`
- Or `DARK` for dark variant

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | — |
| Heavy type | `TEXT` | near-black |
| Thin rule/border | `BORDER` | — |
| Medium element | `DARK2` | — |
| Footnote | `LIGHT2` | — |

### Layout
- Single thin circle outline centered (decorative, not functional)
- Width-varying bars (120pt, 80pt, 40pt) as visual hierarchy stand-in
- All elements centered or left-aligned — never right
- Extreme negative space

### Signature Elements
- Thin circle outline as focal point
- Descending-width bars (weight hierarchy without font changes)
- Monospace caption with wide spacing

### Avoid
- Any color (pure monochrome only)
- Decorative illustration or pattern
- Crowded layouts

---

## 14. Cyberpunk Outline

**Mood**: HUD interface, sci-fi, dark tech, surveillance  
**Best For**: Gaming, AI infrastructure, security, data engineering decks

### Background
- Near-black using `DARK`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Grid lines | `ACCENT1` | 6% opacity |
| Outline text | `ACCENT1` | stroke 1.5pt, transparent fill |
| Glow | `ACCENT1` | 50% blur glow |
| Corner marks | `ACCENT1` | 60% opacity |
| Subtext | `ACCENT1` | 50% opacity |

### Layout
- Subtle dot-grid or line-grid background (6% opacity)
- **Corner bracket markers** (L-shaped, 20pt, neon) in all 4 corners
- Title centered with outline stroke effect
- Bottom subtext label

### Signature Elements
- Outline (stroke-only) text for title
- Four corner bracket markers
- Grid overlay background

### Avoid
- White backgrounds
- Filled (non-outline) title text
- Bright, warm colors

---

## 15. Editorial Magazine

**Mood**: Journalistic, narrative, sophisticated  
**Best For**: Annual reports, brand stories, long-form content decks

### Background
- `BG` base with dark block accent

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background (main) | `BG` | — |
| Dark block | `DARK` | — |
| Title | `TEXT` | — |
| Rule line | `ACCENT1` | thin horizontal rule |
| Caption | `BORDER` | — |

### Layout
- **Asymmetric two-zone layout**: left 55% white with text, right 45% dark block
- Large italic serif title upper-left
- Thin red horizontal rule (2pt) below title, 60pt wide
- Vertical label text rotated 90° in dark zone
- Column-style body text bottom-left

### Signature Elements
- Asymmetric white/dark split
- Short red rule line under title
- Rotated vertical label text in dark zone

### Avoid
- Symmetric or centered layouts
- Sans-serif display fonts
- Full-bleed colored backgrounds

---

## 16. Pastel Soft UI

**Mood**: Gentle, modern app, healthcare-friendly  
**Best For**: Healthcare, beauty, education startups, consumer apps

### Background
- Soft tricolor gradient: blend of `ACCENT1` + `ACCENT3` + `ACCENT5` (lightened/pastel variants)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `ACCENT1` + `ACCENT3` + `ACCENT5` | soft pastel gradient |
| Card fill | `WHITE` | 70% opacity |
| Card border | `WHITE` | 90% opacity |
| Dot accent 1 | `ACCENT1` | — |
| Dot accent 2 | `ACCENT3` | — |

### Layout
- Floating frosted-white cards on gradient background
- Large circle card (pill shape) as central element
- Small decorative blobs in opposite corners
- Cards have soft colored box-shadows (color-matched to blobs)

### Signature Elements
- Frosted white card (70% opacity, white border)
- Pastel tricolor gradient background
- Soft color-matched shadows

### Avoid
- Dark backgrounds
- Saturated or primary colors
- Hard drop shadows

---

## 17. Dark Neon Miami

**Mood**: Synthwave, 80s nostalgia, hedonistic neon  
**Best For**: Entertainment, music festivals, events, nightlife brands

### Background
- Deep dark using `DARK`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Sunset semicircle | `ACCENT6` → `ACCENT1` | gradient shape |
| Title gradient | `ACCENT6` → `ACCENT1` → `ACCENT3` | multi-stop gradient text |
| Grid lines | `ACCENT1` | 15–40% opacity |

### Layout
- **Horizon semicircle** (sunset) in lower-center third
- Perspective grid lines converging toward horizon (4–6 lines)
- Title positioned top-center
- Palm tree or geometric accent in lower corners (optional)

### Signature Elements
- Sunset semicircle gradient shape
- Converging perspective grid
- Gradient text (orange → pink → purple)

### Avoid
- Cool color palettes (blue/green dominant)
- Daylight or bright backgrounds
- Sans-serif body text

---

## 18. Hand-crafted Organic

**Mood**: Artisanal, natural, human, sustainable  
**Best For**: Eco brands, food/beverage, craft studios, wellness

### Background
- Warm light base using `BG` (craft paper feel)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | warm craft paper |
| Dashed circle | `BORDER` | — |
| Solid circle | `ACCENT2` | — |
| Title text | `TEXT` | — |
| Leaf/flora accents | `ACCENT3` | emoji or illustration |

### Layout
- **Nested circles**: outer dashed + inner solid, slightly off-center or rotated
- Botanical emoji or line-art leaf accents in corners
- Dashed horizontal rule spanning slide
- Italic serif title centered within circles

### Signature Elements
- Dashed outer circle (imperfect, rotated 5–10°)
- Nested solid inner circle
- Botanical/leaf accent elements

### Avoid
- Clean geometric shapes
- Bright or synthetic colors
- Sans-serif fonts

---

## 19. Isometric 3D Flat

**Mood**: Technical clarity, structured, architectural  
**Best For**: IT architecture, data flow, system diagrams, infrastructure

### Background
- Dark base using `DARK`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Top face | `ACCENT1` | — |
| Left face | `ACCENT2` | darker shade |
| Right face | `ACCENT1` blended with `ACCENT2` | medium shade |
| Highlight face | `ACCENT3` | lighter accent |

### Layout
- Isometric (30° angle) 3D block shapes — two or three stacked cubes
- Blocks assembled left-center, title upper-right
- Thin connecting lines or arrows between blocks (for diagrams)
- All shapes share the same 3-face color system (top lighter, sides darker)

### Signature Elements
- Strict isometric angle (30°/60°)
- 3-face shading system (top, left, right faces)
- Dark navy background contrast

### Avoid
- Perspective 3D (use isometric only)
- Rounded shapes
- Light or white backgrounds

---

## 20. Vaporwave

**Mood**: Dreamy, nostalgic internet aesthetics, surreal  
**Best For**: Creative agencies, music/art portfolios, subculture brands

### Background
- Dark gradient using `DARK` as the base

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | gradient |
| Sun gradient | `ACCENT6` → `ACCENT1` → `ACCENT3` | multi-stop gradient shape |
| Grid lines | `ACCENT1` | 40% opacity |
| Ghost title | `WHITE` | 8% opacity |

### Layout
- **Perspective grid** in lower 60% (horizontal + vertical lines converging)
- Semicircle sun top-center, sliced by 2 horizontal bars (background color)
- Ghost watermark text near sun area
- Gradient text at bottom

### Signature Elements
- Sliced sunset semicircle (sun with stripes)
- Perspective grid floor
- Ghost/watermark title text

### Avoid
- Clean or corporate layouts
- Muted or warm earth tones
- Readable "normal" typography style

---

## 21. Art Deco Luxe

**Mood**: 1920s grandeur, gilded, prestigious  
**Best For**: Luxury brands, gala events, premium annual reports, high-end hospitality

### Background
- Deep dark using `DARK`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Border / ornament | `ACCENT1` | gold from theme |
| Title text | `ACCENT1` | gold from theme |
| Subtitle | `ACCENT2` | muted supporting tone |
| Diamond accent | `ACCENT1` | — |

### Layout
- **Double inset gold border** frame (outer full, inner slightly inset)
- **Fan / quarter-circle ornaments** in left and right mid-edge
- Thin horizontal gold rule at vertical center
- Diamond (rotated square) at rule-center intersection
- Title centered, uppercase, wide-spaced

### Signature Elements
- Double inset border frame (two concentric rectangles)
- Fan ornaments on sides
- Diamond divider at center rule
- ALL CAPS wide letter-spaced serif

### Avoid
- Modern sans-serif fonts
- Colorful or pastel tones
- Asymmetric layouts

---

## 22. Brutalist Newspaper

**Mood**: Editorial authority, raw journalism, confrontational  
**Best For**: Media companies, research institutes, content industry decks

### Background
- Light base using `BG` (aged paper feel)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | — |
| Masthead bar | `DARK` | full-width block |
| Masthead text | `BG` | reversed out |
| Body text | `TEXT` | — |
| Column divider | `DARK` | — |

### Layout
- **Dark masthead bar** full-width at top (newspaper nameplate)
- Double rule lines below masthead (3pt + 1pt)
- **Two-column layout** with vertical divider rule
- Left: headline + body text; Right: photo placeholder + caption

### Signature Elements
- Newspaper masthead bar
- Double rule below masthead
- Two-column layout with divider
- Italic serif headline

### Avoid
- Modern sans-serif fonts
- Colorful elements
- Clean white space (embrace density)

---

## 23. Stained Glass Mosaic

**Mood**: Vibrant, artistic, cathedral richness  
**Best For**: Cultural institutions, museums, arts organizations, creative festivals

### Background
- Near-black grid frame using `DARK` (grout color)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background (grout) | `DARK` | — |
| Cell 1 | `ACCENT1` | — |
| Cell 2 | `ACCENT2` | — |
| Cell 3 | `ACCENT3` | — |
| Cell 4 | `ACCENT4` | — |
| Cell 5 | `ACCENT5` | — |
| Overlay | `DARK` | 30% opacity |

### Layout
- **6×4 (or similar) mosaic grid** covering full slide — 2pt dark gap between cells
- Cells vary in color following a stained-glass color rhythm
- Semi-transparent dark overlay to darken and unify
- Slide title rendered as overlay text at bottom (light, wide-spaced)

### Signature Elements
- Dark "grout" gaps between all cells
- No two adjacent cells the same color
- Translucent overlay for text legibility

### Avoid
- Pastel or muted cell colors
- Large empty cells
- Sans-serif overlay text

---

## 24. Liquid Blob Morphing

**Mood**: Organic, fluid, living, bio-digital  
**Best For**: Biotech, environmental tech, innovation labs, wellness brands

### Background
- Deep dark gradient using `DARK` as the base

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | gradient |
| Blob 1 | `ACCENT1` | 35% opacity |
| Blob 2 | `ACCENT3` | 30% opacity |
| Blob 3 | `ACCENT5` | 25% opacity |
| Title | `WHITE` | — |
| Glow | `ACCENT1` | radial glow |

### Layout
- 3 large blurred blob shapes positioned asymmetrically (corners + center)
- Blobs overlap with `multiply` or `screen` blend mode effect
- Title centered with teal text glow
- Optional: animated morphing border-radius effect

### Signature Elements
- Three overlapping blurred blobs (low opacity)
- Ocean-depth dark background
- Glowing white text with colored halo

### Avoid
- Sharp geometric shapes
- Bright or warm backgrounds
- Dense text content

---

## 25. Memphis Pop Pattern

**Mood**: Energetic, retro-contemporary, anti-minimalist  
**Best For**: Fashion brands, lifestyle products, retail, youth marketing

### Background
- Warm light base using `BG`

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | warm off-white |
| Triangle accent | `ACCENT1` | — |
| Circle outline | `ACCENT3` | — |
| Zigzag bar | `ACCENT1` | — |
| Dot accent | `ACCENT4` | — |
| Star/triangle 2 | `ACCENT2` | — |

### Layout
- **Scattered geometric shapes** (triangles, circles, dots, zigzags) across slide
- No central focal point — distribute shapes with intentional asymmetry
- Title placed over a slightly cleared zone in center
- One zigzag bar cuts horizontally across the middle third

### Signature Elements
- Triangles, circles, dots, and zigzag bar all present
- Warm off-white background (not pure white or dark)
- Shapes feel random but are intentionally balanced

### Avoid
- Minimalist compositions
- Monochromatic palettes
- Modern/clean fonts

---

## 26. Dark Forest Nature

**Mood**: Mysterious, atmospheric, primal, eco-premium  
**Best For**: Environmental brands, adventure/outdoor, sustainable luxury, conservation

### Background
- Radial dark gradient using `DARK` (center lighter, edges darker)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | radial gradient |
| Tree silhouettes | `DARK2` | layered variants at 3+ depths |
| Moon | `LIGHT2` | soft radial glow |
| Stars | `LIGHT2` | — |
| Mist | `ACCENT4` | 4% opacity |
| Title text | `LIGHT2` | italic serif |

### Layout
- **Tree silhouettes** rising from bottom — triangular/fir shapes, 3+ overlapping depths
- **Moon** top-right with soft radial glow
- Star dots scattered sparingly in upper half
- Mist gradient rising from bottom over trees
- Italic serif title near bottom (above mist)

### Signature Elements
- Layered tree silhouettes (3+ depths)
- Glowing moon top-right
- Fog/mist gradient overlay
- Italic serif text in sage-white

### Avoid
- Bright greens (use near-black forest tones)
- Hard edges on tree shapes
- Sans-serif fonts

---

## 27. Architectural Blueprint

**Mood**: Precise, technical, professional, structured  
**Best For**: Architecture, urban planning, engineering, spatial design firms

### Background
- Dark base using `DARK` (blueprint tone)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Fine grid | `ACCENT1` | 12% opacity |
| Major grid | `ACCENT1` | 22% opacity |
| Shape lines | `ACCENT1` | 60% opacity |
| Dimension text | `ACCENT1` | 60% opacity |
| Title | `ACCENT1` | 80% opacity |

### Layout
- **Fine grid** (20pt) + **major grid** (60pt) layered
- One or two geometric shapes with dimensions and annotation marks
- Arrow dimension lines between key points
- Circular stamp element (right side, mid-height)
- Title as full-width label at bottom

### Signature Elements
- Dual grid (fine + major)
- Dimension lines with annotation text
- Circular blueprint stamp

### Avoid
- Color or decorative elements
- Non-monospace fonts
- Photographic elements

---

## 28. Maximalist Collage

**Mood**: Chaotic energy, irreverent, advertising-bold  
**Best For**: Advertising agencies, fashion brands, music promotions, editorial

### Background
- Light base using `BG` with diagonal pattern overlay

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | — |
| Block 1 | `ACCENT1` | — |
| Block 2 | `DARK` | — |
| Block 3 | `ACCENT2` | — |
| Text on colored blocks | `WHITE` | — |

### Layout
- **Overlapping color blocks** (3 blocks, each slightly rotated ±2–5°)
- Each block contains one focused element (text, word, or icon)
- Diagonal stripe pattern on background (3% opacity)
- Ghost number lower-right
- Circle outline accent element (outline only, one of the bold colors)

### Signature Elements
- 3+ overlapping rotated blocks
- Giant ghost number as texture
- Circle outline accent
- Vertical text in one block

### Avoid
- Symmetric or centered compositions
- Clean uncluttered layouts
- Muted backgrounds

---

## 29. SciFi Holographic Data

**Mood**: Military HUD, quantum computing, absolute precision  
**Best For**: Defense tech, AI research, quantum, advanced data engineering

### Background
- Deep dark using `DARK` (deep space base)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `DARK` | — |
| Ring outlines | `ACCENT1` | 25–60% opacity (vary by ring) |
| Scan line | `ACCENT1` | 50% opacity |
| Bar elements | `ACCENT1` | gradient: transparent → solid → transparent |
| Text | `ACCENT1` | 70% opacity |
| Center dot | `ACCENT1` | — |

### Layout
- **3 concentric rings** (full circles, varying opacity increasing inward)
- Middle ring rotated 30° from outer ring
- **Horizontal scan line** animating top to bottom (or static at mid position)
- Horizontal bars (gradient center-glow) top and bottom
- Center dot at ring intersection
- Text labels at top-left and bottom-right

### Signature Elements
- 3 concentric circles (not uniform — one rotated)
- Scan line (animated or static)
- All elements strictly monochromatic cyan

### Avoid
- Multiple hue accents
- Warm or saturated colors
- Any decorative illustration

---

## 30. Risograph Print

**Mood**: Indie, artisanal printing, CMYK overlap, analog warmth  
**Best For**: Independent publishers, music labels, art zines, boutique studios

### Background
- Light base using `BG` (aged paper feel)

### Color Mapping

| Role | Token | Technique |
|------|-------|-----------|
| Background | `BG` | aged paper |
| Circle 1 | `ACCENT1` | — |
| Circle 2 | `ACCENT3` | — |
| Circle 3 | `ACCENT2` | — |
| Overlap zones | multiply blend | auto from circle overlaps |
| Ghost title | `ACCENT1` | 25% opacity, shifted 3px |

### Layout
- **Three overlapping circles** (CMYK primary colors) in center third
- Each circle uses `multiply` blend mode — overlaps create secondary colors naturally
- **Offset ghost text** under main title (5–6pt shift, low opacity, accent color)
- Main title centered above circles
- Monospace caption at bottom

### Signature Elements
- Three overlapping multiply-blend circles
- Offset ghost title (registration mark error simulation)
- Warm paper background

### Avoid
- Digital-looking crisp shapes
- Dark backgrounds
- Screen-blend mode (must be multiply for authentic CMYK overlap)

---
