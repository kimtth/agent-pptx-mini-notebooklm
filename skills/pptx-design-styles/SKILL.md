---
name: pptx-design-styles
description: >
  Use this skill whenever creating PPTX slides, presentations, or decks with any of these 30 modern design styles:
  Glassmorphism, Neo-Brutalism, Bento Grid, Dark Academia, Gradient Mesh, Claymorphism,
  Swiss International, Aurora Neon Glow, Retro Y2K, Nordic Minimalism, Typographic Bold,
  Duotone Color Split, Monochrome Minimal, Cyberpunk Outline, Editorial Magazine,
  Pastel Soft UI, Dark Neon Miami, Hand-crafted Organic, Isometric 3D Flat, Vaporwave,
  Art Deco Luxe, Brutalist Newspaper, Stained Glass Mosaic, Liquid Blob Morphing,
  Memphis Pop Pattern, Dark Forest Nature, Architectural Blueprint, Maximalist Collage,
  SciFi Holographic Data, Risograph Print.
  Also activate for requests using words like "sleek", "modern", "trendy", "designed",
  "stylish", or "visually striking" presentations.
---

# PPTX Modern Design Styles Skill

## How to Use

1. Identify the style the user wants, or recommend a style based on the content/audience
2. Read the detailed spec for that style in `references/styles.md`
3. Apply alongside the core pptx skill to build the slide deck

> **Always** read `references/styles.md` before starting.  
> If the user hasn't chosen a style, use the recommendation matrix below.

### Theme vs. Style Color Conflict

When a design style specifies colors (backgrounds, accents, text) that conflict with the active workspace theme (`PPTX_THEME`), **the theme always wins**. Map the style's color roles to the closest matching theme slot instead of using the style's literal hex values. The style dictates *mood, structure, and visual technique* — the theme dictates *actual colors*.

---

## Style Recommendation Matrix

| Presentation Goal | Recommended Styles |
|-------------------|--------------------|
| Tech / AI / Startup | Glassmorphism, Aurora Neon, Cyberpunk Outline, SciFi Holographic |
| Corporate / Consulting / Finance | Swiss International, Monochrome Minimal, Editorial Magazine, Architectural Blueprint |
| Education / Research / History | Dark Academia, Nordic Minimalism, Brutalist Newspaper |
| Brand / Marketing | Gradient Mesh, Typographic Bold, Duotone Split, Risograph Print |
| Product / App / UX | Bento Grid, Claymorphism, Pastel Soft UI, Liquid Blob |
| Entertainment / Gaming | Retro Y2K, Dark Neon Miami, Vaporwave, Memphis Pop |
| Eco / Wellness / Culture | Hand-crafted Organic, Nordic Minimalism, Dark Forest Nature |
| IT Infrastructure / Architecture | Isometric 3D Flat, Cyberpunk Outline, Architectural Blueprint |
| Portfolio / Art / Creative | Monochrome Minimal, Editorial Magazine, Risograph Print, Maximalist Collage |
| Pitch Deck / Strategy | Neo-Brutalism, Duotone Split, Bento Grid, Art Deco Luxe, Editorial Split Hero, Diagonal Block Narrative |
| Luxury / Events / Gala | Art Deco Luxe, Monochrome Minimal, Dark Academia |
| Science / Biotech / Innovation | Liquid Blob, SciFi Holographic, Aurora Neon |
| Business Reports / Dashboards | KPI Dashboard Strip, Swiss International, Geometric Proposal Grid |
| Roadmaps / Process Plans | Process Timeline Ribbon, Bento Grid |
| Executive Summary / Keynotes | Accent Monochrome Focus, Editorial Split Hero |
| Creative / Brand Storytelling | Organic Editorial Canvas, Editorial Magazine, Maximalist Collage |

---

## Full Style List

| # | Style Name | Mood | Best For |
|---|------------|------|----------|
| 01 | Glassmorphism | Premium · Tech | SaaS, AI products |
| 02 | Neo-Brutalism | Bold · Startup | Pitch decks, marketing |
| 03 | Bento Grid | Modular · Structured | Feature overviews |
| 04 | Dark Academia | Scholarly · Refined | Education, research |
| 05 | Gradient Mesh | Artistic · Vibrant | Brand launches |
| 06 | Claymorphism | Friendly · 3D | Apps, education |
| 07 | Swiss International | Functional · Corporate | Consulting, finance IR |
| 08 | Aurora Neon Glow | Futuristic · AI | AI, cybersecurity |
| 09 | Retro Y2K | Nostalgic · Pop | Events, marketing |
| 10 | Nordic Minimalism | Calm · Natural | Wellness, non-profit |
| 11 | Typographic Bold | Editorial · Impact | Brand statements |
| 12 | Duotone Color Split | Dramatic · Contrast | Strategy, compare |
| 13 | Monochrome Minimal | Restrained · Luxury | Luxury brands |
| 14 | Cyberpunk Outline | HUD · Sci-Fi | Gaming, infra |
| 15 | Editorial Magazine | Magazine · Story | Annual reviews |
| 16 | Pastel Soft UI | Soft · App-like | Healthcare, beauty |
| 17 | Dark Neon Miami | Synthwave · 80s | Entertainment, music |
| 18 | Hand-crafted Organic | Natural · Eco | Eco brands, food |
| 19 | Isometric 3D Flat | Technical · Structured | IT architecture |
| 20 | Vaporwave | Dreamy · Subculture | Creative agencies |
| 21 | Art Deco Luxe | Gold · Geometric | Luxury, gala events |
| 22 | Brutalist Newspaper | Editorial · Raw | Media, research |
| 23 | Stained Glass Mosaic | Colorful · Artistic | Culture, museums |
| 24 | Liquid Blob Morphing | Fluid · Organic Tech | Biotech, innovation |
| 25 | Memphis Pop Pattern | 80s · Geometric | Fashion, lifestyle |
| 26 | Dark Forest Nature | Mysterious · Atmospheric | Eco premium, adventure |
| 27 | Architectural Blueprint | Technical · Precise | Architecture, planning |
| 28 | Maximalist Collage | Energetic · Layered | Advertising, fashion |
| 29 | SciFi Holographic Data | Hologram · HUD | AI, quantum, defense |
| 30 | Risograph Print | CMYK · Indie | Publishing, art, music |

### Template Motif Styles

| # | Motif Name | Mood | Best For |
|---|------------|------|----------|
| M1 | Editorial Split Hero | Hero · Bold | Pitch decks, proposals, keynotes |
| M2 | Diagonal Block Narrative | Directional · Energetic | Launch slides, campaigns |
| M3 | KPI Dashboard Strip | Data · Compact | Reports, review decks |
| M4 | Geometric Proposal Grid | Structured · Modular | Project proposals, plans |
| M5 | Accent Monochrome Focus | Neutral · Emphasis | Executive summary, quotes |
| M6 | Process Timeline Ribbon | Sequential · Connected | Roadmaps, phase plans |
| M7 | Organic Editorial Canvas | Soft · Story | Creative briefs, lifestyle |

---

## Core Production Principles

- **Always use together with the pptx skill** for actual file generation
- **Theme colors always win.** When `PPTX_THEME` is active, map every style color role to the nearest theme slot (`BG`, `TEXT`, `DARK`, `LIGHT`, `ACCENT1`–`ACCENT6`, etc.). Never use literal hex values from style specs when a theme is active — the style defines *mood, structure, and technique*; the theme defines *actual colors*.
- **Readability is mandatory.** Always call `ensure_contrast(fg_hex, bg_hex)` when placing text on any colored surface (slide background, panel, card, image overlay). Never produce dark text on a dark background or light text on a light background.
- Every slide must contain **at least one visual element** (shape, icon, color block)
- **Never use text-only slides** — express design through color, form, and space
- Repeat each style's **signature element** consistently across all slides
- Match **font pairing** exactly as specified — typography drives 50% of the style impression
- `references/styles.md` uses **theme token names** (`DARK`, `ACCENT1`, etc.) — not hardcoded HEX. Always resolve them via `PPTX_THEME` at runtime.

## Reusable Card Pattern Mapping

Use these micro-patterns across multiple styles when the content calls for cards. They are reusable layout treatments, not separate brand styles.

| Pattern | Best Use | Core Move | Works Especially Well With |
|---|---|---|---|
| Icon Card | 2-4 strategic pillars, features, benefits | One prominent icon integrated into each card body | Bento Grid, Neo-Brutalism, Claymorphism, Pastel Soft UI, Isometric 3D Flat |
| Header Icon Card | 3-6 compact categories, process steps, capability clusters | Slim top band with small icons and short heading | Swiss International, Editorial Magazine, Architectural Blueprint, Glassmorphism, Monochrome Minimal |

Rules:

- Prefer `Icon Card` when each card needs a strong single concept marker.
- Prefer `Header Icon Card` when the card title and small symbolic cues should read before the body copy.
- Do not treat these as separate styles in the selector. They are implementation patterns inside the chosen design style.

## Reusable Template Motif Mapping

In addition to the card-level patterns above, you can reuse broader presentation-template motifs that recur across external template libraries such as Canva, Slidesgo, and Visme. These are also implementation patterns, not selector entries.

| Motif | Best Use | Core Move |
|---|---|---|
| Editorial Split Hero | Pitch decks, proposals, keynote openers | Narrow anchor column plus large hero stage for one dominant message |
| Diagonal Block Narrative | Launch slides, campaign slides, strategic statements | Strong diagonal geometry creates directional energy and framing |
| KPI Dashboard Strip | Reports, review decks, business updates | Compact summary ribbon above a modular metric or chart zone |
| Geometric Proposal Grid | Project proposals, business plans, workstreams | Even tiles and disciplined gutters split scope into readable modules |
| Accent Monochrome Focus | Executive summary, quote, single-point slides | Mostly neutral base with one saturated emphasis block |
| Process Timeline Ribbon | Roadmaps, onboarding, phase plans | Connected markers on a ribbon or rail with explanation grouped below |
| Organic Editorial Canvas | Creative briefs, brand storytelling, lifestyle decks | Soft neutral field with one image window and one organic accent mass |

Rules:

- Use these motifs to vary composition when multiple slides would otherwise feel structurally identical.
- Combine a motif with a named design style only when the motif reinforces the style's tone rather than fighting it.
- Prefer motifs for slide-level composition and card patterns for component-level treatment.
- Do not present these motifs as new Brand Style selector options unless the product model itself is extended.

For detailed color, font, and layout specs per style → **[references/styles.md](references/styles.md)**
