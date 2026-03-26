export const DESIGN_STYLE_OPTIONS = [
  { value: 'Glassmorphism', label: 'Glassmorphism', mood: 'Premium · Tech', bestFor: 'SaaS, AI products', tone: 'dark' },
  { value: 'Neo-Brutalism', label: 'Neo-Brutalism', mood: 'Bold · Startup', bestFor: 'Pitch decks, marketing', tone: 'light' },
  { value: 'Bento Grid', label: 'Bento Grid', mood: 'Modular · Structured', bestFor: 'Feature overviews', tone: 'light' },
  { value: 'Dark Academia', label: 'Dark Academia', mood: 'Scholarly · Refined', bestFor: 'Education, research', tone: 'dark' },
  { value: 'Gradient Mesh', label: 'Gradient Mesh', mood: 'Artistic · Vibrant', bestFor: 'Brand launches', tone: 'dark' },
  { value: 'Claymorphism', label: 'Claymorphism', mood: 'Friendly · 3D', bestFor: 'Apps, education', tone: 'light' },
  { value: 'Swiss International', label: 'Swiss International', mood: 'Functional · Corporate', bestFor: 'Consulting, finance IR', tone: 'light' },
  { value: 'Aurora Neon Glow', label: 'Aurora Neon Glow', mood: 'Futuristic · AI', bestFor: 'AI, cybersecurity', tone: 'dark' },
  { value: 'Retro Y2K', label: 'Retro Y2K', mood: 'Nostalgic · Pop', bestFor: 'Events, marketing', tone: 'dark' },
  { value: 'Nordic Minimalism', label: 'Nordic Minimalism', mood: 'Calm · Natural', bestFor: 'Wellness, non-profit', tone: 'light' },
  { value: 'Typographic Bold', label: 'Typographic Bold', mood: 'Editorial · Impact', bestFor: 'Brand statements', tone: 'light' },
  { value: 'Duotone Color Split', label: 'Duotone Color Split', mood: 'Dramatic · Contrast', bestFor: 'Strategy, compare', tone: 'dark' },
  { value: 'Monochrome Minimal', label: 'Monochrome Minimal', mood: 'Restrained · Luxury', bestFor: 'Luxury brands', tone: 'light' },
  { value: 'Cyberpunk Outline', label: 'Cyberpunk Outline', mood: 'HUD · Sci-Fi', bestFor: 'Gaming, infra', tone: 'dark' },
  { value: 'Editorial Magazine', label: 'Editorial Magazine', mood: 'Magazine · Story', bestFor: 'Annual reviews', tone: 'light' },
  { value: 'Pastel Soft UI', label: 'Pastel Soft UI', mood: 'Soft · App-like', bestFor: 'Healthcare, beauty', tone: 'light' },
  { value: 'Dark Neon Miami', label: 'Dark Neon Miami', mood: 'Synthwave · 80s', bestFor: 'Entertainment, music', tone: 'dark' },
  { value: 'Hand-crafted Organic', label: 'Hand-crafted Organic', mood: 'Natural · Eco', bestFor: 'Eco brands, food', tone: 'light' },
  { value: 'Isometric 3D Flat', label: 'Isometric 3D Flat', mood: 'Technical · Structured', bestFor: 'IT architecture', tone: 'dark' },
  { value: 'Vaporwave', label: 'Vaporwave', mood: 'Dreamy · Subculture', bestFor: 'Creative agencies', tone: 'dark' },
  { value: 'Art Deco Luxe', label: 'Art Deco Luxe', mood: 'Gold · Geometric', bestFor: 'Luxury, gala events', tone: 'dark' },
  { value: 'Brutalist Newspaper', label: 'Brutalist Newspaper', mood: 'Editorial · Raw', bestFor: 'Media, research', tone: 'light' },
  { value: 'Stained Glass Mosaic', label: 'Stained Glass Mosaic', mood: 'Colorful · Artistic', bestFor: 'Culture, museums', tone: 'dark' },
  { value: 'Liquid Blob Morphing', label: 'Liquid Blob Morphing', mood: 'Fluid · Organic Tech', bestFor: 'Biotech, innovation', tone: 'dark' },
  { value: 'Memphis Pop Pattern', label: 'Memphis Pop Pattern', mood: '80s · Geometric', bestFor: 'Fashion, lifestyle', tone: 'light' },
  { value: 'Dark Forest Nature', label: 'Dark Forest Nature', mood: 'Mysterious · Atmospheric', bestFor: 'Eco premium, adventure', tone: 'dark' },
  { value: 'Architectural Blueprint', label: 'Architectural Blueprint', mood: 'Technical · Precise', bestFor: 'Architecture, planning', tone: 'dark' },
  { value: 'Maximalist Collage', label: 'Maximalist Collage', mood: 'Energetic · Layered', bestFor: 'Advertising, fashion', tone: 'light' },
  { value: 'SciFi Holographic Data', label: 'SciFi Holographic Data', mood: 'Hologram · HUD', bestFor: 'AI, quantum, defense', tone: 'dark' },
  { value: 'Risograph Print', label: 'Risograph Print', mood: 'CMYK · Indie', bestFor: 'Publishing, art, music', tone: 'light' },
  { value: 'Custom Template', label: 'Custom Template', mood: 'Your Brand', bestFor: 'Corporate templates', tone: null },
] as const

export type DesignStyle = (typeof DESIGN_STYLE_OPTIONS)[number]['value']

export function getDesignStyleMeta(value: DesignStyle | null) {
  return DESIGN_STYLE_OPTIONS.find((item) => item.value === value) ?? null
}