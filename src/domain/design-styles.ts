export const DESIGN_STYLE_OPTIONS = [
  { value: 'Glassmorphism', label: 'Glassmorphism', mood: 'Premium · Tech', bestFor: 'SaaS, AI products' },
  { value: 'Neo-Brutalism', label: 'Neo-Brutalism', mood: 'Bold · Startup', bestFor: 'Pitch decks, marketing' },
  { value: 'Bento Grid', label: 'Bento Grid', mood: 'Modular · Structured', bestFor: 'Feature overviews' },
  { value: 'Dark Academia', label: 'Dark Academia', mood: 'Scholarly · Refined', bestFor: 'Education, research' },
  { value: 'Gradient Mesh', label: 'Gradient Mesh', mood: 'Artistic · Vibrant', bestFor: 'Brand launches' },
  { value: 'Claymorphism', label: 'Claymorphism', mood: 'Friendly · 3D', bestFor: 'Apps, education' },
  { value: 'Swiss International', label: 'Swiss International', mood: 'Functional · Corporate', bestFor: 'Consulting, finance IR' },
  { value: 'Aurora Neon Glow', label: 'Aurora Neon Glow', mood: 'Futuristic · AI', bestFor: 'AI, cybersecurity' },
  { value: 'Retro Y2K', label: 'Retro Y2K', mood: 'Nostalgic · Pop', bestFor: 'Events, marketing' },
  { value: 'Nordic Minimalism', label: 'Nordic Minimalism', mood: 'Calm · Natural', bestFor: 'Wellness, non-profit' },
  { value: 'Typographic Bold', label: 'Typographic Bold', mood: 'Editorial · Impact', bestFor: 'Brand statements' },
  { value: 'Duotone Color Split', label: 'Duotone Color Split', mood: 'Dramatic · Contrast', bestFor: 'Strategy, compare' },
  { value: 'Monochrome Minimal', label: 'Monochrome Minimal', mood: 'Restrained · Luxury', bestFor: 'Luxury brands' },
  { value: 'Cyberpunk Outline', label: 'Cyberpunk Outline', mood: 'HUD · Sci-Fi', bestFor: 'Gaming, infra' },
  { value: 'Editorial Magazine', label: 'Editorial Magazine', mood: 'Magazine · Story', bestFor: 'Annual reviews' },
  { value: 'Pastel Soft UI', label: 'Pastel Soft UI', mood: 'Soft · App-like', bestFor: 'Healthcare, beauty' },
  { value: 'Dark Neon Miami', label: 'Dark Neon Miami', mood: 'Synthwave · 80s', bestFor: 'Entertainment, music' },
  { value: 'Hand-crafted Organic', label: 'Hand-crafted Organic', mood: 'Natural · Eco', bestFor: 'Eco brands, food' },
  { value: 'Isometric 3D Flat', label: 'Isometric 3D Flat', mood: 'Technical · Structured', bestFor: 'IT architecture' },
  { value: 'Vaporwave', label: 'Vaporwave', mood: 'Dreamy · Subculture', bestFor: 'Creative agencies' },
  { value: 'Art Deco Luxe', label: 'Art Deco Luxe', mood: 'Gold · Geometric', bestFor: 'Luxury, gala events' },
  { value: 'Brutalist Newspaper', label: 'Brutalist Newspaper', mood: 'Editorial · Raw', bestFor: 'Media, research' },
  { value: 'Stained Glass Mosaic', label: 'Stained Glass Mosaic', mood: 'Colorful · Artistic', bestFor: 'Culture, museums' },
  { value: 'Liquid Blob Morphing', label: 'Liquid Blob Morphing', mood: 'Fluid · Organic Tech', bestFor: 'Biotech, innovation' },
  { value: 'Memphis Pop Pattern', label: 'Memphis Pop Pattern', mood: '80s · Geometric', bestFor: 'Fashion, lifestyle' },
  { value: 'Dark Forest Nature', label: 'Dark Forest Nature', mood: 'Mysterious · Atmospheric', bestFor: 'Eco premium, adventure' },
  { value: 'Architectural Blueprint', label: 'Architectural Blueprint', mood: 'Technical · Precise', bestFor: 'Architecture, planning' },
  { value: 'Maximalist Collage', label: 'Maximalist Collage', mood: 'Energetic · Layered', bestFor: 'Advertising, fashion' },
  { value: 'SciFi Holographic Data', label: 'SciFi Holographic Data', mood: 'Hologram · HUD', bestFor: 'AI, quantum, defense' },
  { value: 'Risograph Print', label: 'Risograph Print', mood: 'CMYK · Indie', bestFor: 'Publishing, art, music' },
  { value: 'Custom Template', label: 'Custom Template', mood: 'Your Brand', bestFor: 'Corporate templates' },
] as const

export type DesignStyle = (typeof DESIGN_STYLE_OPTIONS)[number]['value']

export function getDesignStyleMeta(value: DesignStyle | null) {
  return DESIGN_STYLE_OPTIONS.find((item) => item.value === value) ?? null
}