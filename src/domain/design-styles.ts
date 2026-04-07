export const DESIGN_STYLE_OPTIONS = [
  // ── Foundation ──
  { value: 'Blank White', label: 'Blank (White)', mood: 'Clean · Minimal', bestFor: 'General purpose', tone: 'light', category: 'Foundation' },
  { value: 'Blank Dark', label: 'Blank (Dark)', mood: 'Clean · Minimal', bestFor: 'General purpose', tone: 'dark', category: 'Foundation' },
  // ── Named Styles ──
  { value: 'Glassmorphism', label: 'Glassmorphism', mood: 'Premium · Tech', bestFor: 'SaaS, AI products', tone: 'dark', category: 'Named Style' },
  { value: 'Neo-Brutalism', label: 'Neo-Brutalism', mood: 'Bold · Startup', bestFor: 'Pitch decks, marketing', tone: 'light', category: 'Named Style' },
  { value: 'Bento Grid', label: 'Bento Grid', mood: 'Modular · Structured', bestFor: 'Feature overviews', tone: 'light', category: 'Named Style' },
  { value: 'Dark Academia', label: 'Dark Academia', mood: 'Scholarly · Refined', bestFor: 'Education, research', tone: 'dark', category: 'Named Style' },
  { value: 'Gradient Mesh', label: 'Gradient Mesh', mood: 'Artistic · Vibrant', bestFor: 'Brand launches', tone: 'dark', category: 'Named Style' },
  { value: 'Claymorphism', label: 'Claymorphism', mood: 'Friendly · 3D', bestFor: 'Apps, education', tone: 'light', category: 'Named Style' },
  { value: 'Swiss International', label: 'Swiss International', mood: 'Functional · Corporate', bestFor: 'Consulting, finance IR', tone: 'light', category: 'Named Style' },
  { value: 'Aurora Neon Glow', label: 'Aurora Neon Glow', mood: 'Futuristic · AI', bestFor: 'AI, cybersecurity', tone: 'dark', category: 'Named Style' },
  { value: 'Retro Y2K', label: 'Retro Y2K', mood: 'Nostalgic · Pop', bestFor: 'Events, marketing', tone: 'dark', category: 'Named Style' },
  { value: 'Nordic Minimalism', label: 'Nordic Minimalism', mood: 'Calm · Natural', bestFor: 'Wellness, non-profit', tone: 'light', category: 'Named Style' },
  { value: 'Typographic Bold', label: 'Typographic Bold', mood: 'Editorial · Impact', bestFor: 'Brand statements', tone: 'light', category: 'Named Style' },
  { value: 'Duotone Color Split', label: 'Duotone Color Split', mood: 'Dramatic · Contrast', bestFor: 'Strategy, compare', tone: 'dark', category: 'Named Style' },
  { value: 'Monochrome Minimal', label: 'Monochrome Minimal', mood: 'Restrained · Luxury', bestFor: 'Luxury brands', tone: 'light', category: 'Named Style' },
  { value: 'Cyberpunk Outline', label: 'Cyberpunk Outline', mood: 'HUD · Sci-Fi', bestFor: 'Gaming, infra', tone: 'dark', category: 'Named Style' },
  { value: 'Editorial Magazine', label: 'Editorial Magazine', mood: 'Magazine · Story', bestFor: 'Annual reviews', tone: 'light', category: 'Named Style' },
  { value: 'Pastel Soft UI', label: 'Pastel Soft UI', mood: 'Soft · App-like', bestFor: 'Healthcare, beauty', tone: 'light', category: 'Named Style' },
  { value: 'Dark Neon Miami', label: 'Dark Neon Miami', mood: 'Synthwave · 80s', bestFor: 'Entertainment, music', tone: 'dark', category: 'Named Style' },
  { value: 'Hand-crafted Organic', label: 'Hand-crafted Organic', mood: 'Natural · Eco', bestFor: 'Eco brands, food', tone: 'light', category: 'Named Style' },
  { value: 'Isometric 3D Flat', label: 'Isometric 3D Flat', mood: 'Technical · Structured', bestFor: 'IT architecture', tone: 'dark', category: 'Named Style' },
  { value: 'Vaporwave', label: 'Vaporwave', mood: 'Dreamy · Subculture', bestFor: 'Creative agencies', tone: 'dark', category: 'Named Style' },
  { value: 'Art Deco Luxe', label: 'Art Deco Luxe', mood: 'Gold · Geometric', bestFor: 'Luxury, gala events', tone: 'dark', category: 'Named Style' },
  { value: 'Brutalist Newspaper', label: 'Brutalist Newspaper', mood: 'Editorial · Raw', bestFor: 'Media, research', tone: 'light', category: 'Named Style' },
  { value: 'Stained Glass Mosaic', label: 'Stained Glass Mosaic', mood: 'Colorful · Artistic', bestFor: 'Culture, museums', tone: 'dark', category: 'Named Style' },
  { value: 'Liquid Blob Morphing', label: 'Liquid Blob Morphing', mood: 'Fluid · Organic Tech', bestFor: 'Biotech, innovation', tone: 'dark', category: 'Named Style' },
  { value: 'Memphis Pop Pattern', label: 'Memphis Pop Pattern', mood: '80s · Geometric', bestFor: 'Fashion, lifestyle', tone: 'light', category: 'Named Style' },
  { value: 'Dark Forest Nature', label: 'Dark Forest Nature', mood: 'Mysterious · Atmospheric', bestFor: 'Eco premium, adventure', tone: 'dark', category: 'Named Style' },
  { value: 'Architectural Blueprint', label: 'Architectural Blueprint', mood: 'Technical · Precise', bestFor: 'Architecture, planning', tone: 'dark', category: 'Named Style' },
  { value: 'Maximalist Collage', label: 'Maximalist Collage', mood: 'Energetic · Layered', bestFor: 'Advertising, fashion', tone: 'light', category: 'Named Style' },
  { value: 'SciFi Holographic Data', label: 'SciFi Holographic Data', mood: 'Hologram · HUD', bestFor: 'AI, quantum, defense', tone: 'dark', category: 'Named Style' },
  { value: 'Risograph Print', label: 'Risograph Print', mood: 'CMYK · Indie', bestFor: 'Publishing, art, music', tone: 'light', category: 'Named Style' },
  // ── Template Motifs ──
  { value: 'Editorial Split Hero', label: 'Editorial Split Hero', mood: 'Hero · Bold', bestFor: 'Pitch decks, proposals, keynotes', tone: 'light', category: 'Template Motif' },
  { value: 'Diagonal Block Narrative', label: 'Diagonal Block Narrative', mood: 'Directional · Energetic', bestFor: 'Launch slides, campaigns', tone: 'dark', category: 'Template Motif' },
  { value: 'KPI Dashboard Strip', label: 'KPI Dashboard Strip', mood: 'Data · Compact', bestFor: 'Reports, review decks', tone: 'light', category: 'Template Motif' },
  { value: 'Geometric Proposal Grid', label: 'Geometric Proposal Grid', mood: 'Structured · Modular', bestFor: 'Project proposals, plans', tone: 'light', category: 'Template Motif' },
  { value: 'Accent Monochrome Focus', label: 'Accent Monochrome Focus', mood: 'Neutral · Emphasis', bestFor: 'Executive summary, quotes', tone: 'light', category: 'Template Motif' },
  { value: 'Process Timeline Ribbon', label: 'Process Timeline Ribbon', mood: 'Sequential · Connected', bestFor: 'Roadmaps, phase plans', tone: 'light', category: 'Template Motif' },
  { value: 'Organic Editorial Canvas', label: 'Organic Editorial Canvas', mood: 'Soft · Story', bestFor: 'Creative briefs, lifestyle', tone: 'light', category: 'Template Motif' },
  // ── Custom ──
  { value: 'Custom Template', label: 'Custom Template', mood: 'Your Brand', bestFor: 'Corporate templates', tone: null, category: 'Custom' },
] as const

export type DesignStyle = (typeof DESIGN_STYLE_OPTIONS)[number]['value']

export function getDesignStyleMeta(value: DesignStyle | null) {
  return DESIGN_STYLE_OPTIONS.find((item) => item.value === value) ?? null
}