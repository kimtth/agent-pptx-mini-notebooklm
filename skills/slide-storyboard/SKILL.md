---
name: slide-storyboard
description: Analyzes user requests and provided materials to create a presentation slide story (structure plan). Uses the set_scenario tool to output directly to the workspace panel. Also calls suggest_framework to present available business frameworks to the user for selection.
---

# Slide Story Creation Skill

A skill that analyzes user requests and creates a slide story (structure plan) as the pre-stage for PPTX generation.

## Critical: Output Method

**Never write the slide structure directly in chat. Always use the `set_scenario` tool to send it to the workspace panel.**
Include a presentation-wide `designBrief` when relevant.

```
// ✅ Correct: call set_scenario tool
set_scenario({
  title: "Presentation Title",
  slides: [
    { number: 1, title: "Title Slide", bullets: ["Subtitle"], notes: "..." },
    { number: 2, title: "Agenda", bullets: ["Topic 1", "Topic 2"], notes: "..." },
    ...
  ],
  designBrief: {
    objective: "Convince executives to approve the AI initiative",
    audience: "C-suite executives",
    tone: "executive",
    visualStyle: "editorial cards",
    colorMood: "professional, trustworthy",
    density: "airy",
    layoutApproach: "design-led"
  }
})

// ❌ Wrong: write markdown in chat ← Never do this
```

After calling the tool, return only a short message in chat: e.g., "Slide structure and design brief created in workspace. Review and generate PPTX?"

## When To Use This Skill

- User asks "create a presentation", "make slides", "summarize this into a deck"
- Converting complex topics or long documents into a presentation
- When the user wants to confirm the story before generating PPTX

## Step 0: Confirm Framework With the User

**The business framework is defined by the user, not by the assistant.** If the user has already specified a framework, use it directly. If no framework has been specified, present the available options using `suggest_framework` and ask the user which one to use. Do not auto-select a framework on the user's behalf.

Framework selection guide:

| Framework | Best For |
|-----------|----------|
| `mckinsey` | Executive proposals, consulting deliverables, strategic recommendations |
| `scqa` | Problem-solving presentations, situation analysis, incident reports |
| `pyramid` | Complex arguments requiring strong logical structure |
| `mece` | Issue decomposition, audits, multi-workstream analysis |
| `action-title` | Executive communications where every slide must drive action |
| `assertion-evidence` | Technical/academic presentations, research findings |
| `exec-summary-first` | C-suite briefings, board decks, press releases |

## Framework-Specific Story Templates

### McKinsey Structure (`mckinsey`)
```
1. Title (layout: title) — Conclusion in one sentence
2. Executive Summary (layout: agenda) — 3 bullets: situation, insight, recommendation
3. Situation (layout: bullets) — Context that audience already knows
4. Complication (layout: bullets) — What changed or what problem emerged
5. Key Question (layout: section) — The central question this deck answers
6. Recommendation (layout: cards) — The answer, clearly stated
7. Evidence 1 (layout: stats or cards) — Data supporting recommendation
8. Evidence 2 (layout: comparison or timeline) — Further evidence
9. Evidence 3 (layout: bullets or diagram) — Additional support
10. Options Considered (layout: comparison) — Why this option vs. alternatives
11. Implementation Roadmap (layout: timeline) — Next steps with owners
12. Appendix (layout: section) — Label for backup slides
```

### SCQA Structure (`scqa`)
```
1. Title (layout: title)
2. Situation (layout: bullets) — Agreed context
3. Complication (layout: stats) — What disrupted the situation
4. Question (layout: section) — What question does this raise?
5. Answer / Recommendation (layout: cards) — Direct answer to the question
6. Supporting Evidence (layout: stats or comparison)
7. Implementation Plan (layout: timeline)
8. Summary (layout: summary)
```

### Pyramid Structure (`pyramid`)
```
1. Title (layout: title)
2. Main Answer (layout: agenda) — Top of pyramid: the governing thought
3. Argument 1 (layout: cards or bullets) — First key line of reasoning
4. Argument 2 (layout: cards or bullets) — Second key line of reasoning
5. Argument 3 (layout: cards or bullets) — Third key line of reasoning
6. Evidence (layout: stats) — Data underpinning arguments
7. Summary (layout: summary) — Pyramid restated
```

### MECE Structure (`mece`)
```
1. Title (layout: title)
2. Problem Decomposition (layout: diagram) — The MECE issue tree
3. Workstream 1 (layout: bullets or cards) — Sub-issue + findings
4. Workstream 2 (layout: bullets or cards)
5. Workstream 3 (layout: bullets or cards)
6. Synthesis (layout: summary) — Integrated conclusion
```

### Action-Title Structure (`action-title`)
```
Rules: Every slide title must be an action statement or concluded insight.
1. Title (layout: title) — Action-oriented title
2. Summary of Actions (layout: agenda)
3–N. Each content slide (any layout) — title = "We must X" / "X increased by Y%"
N+1. Next Steps (layout: timeline) — Owners + dates
```

### Assertion-Evidence Structure (`assertion-evidence`)
```
Rules: Each slide has an assertion title (1 sentence) + evidence body (visual/data).
1. Title (layout: title)
2. Overview Assertion (layout: bullets)
3–N. Each assertion slide (stats/cards/comparison)
N+1. Conclusion (layout: summary)
```

### Exec-Summary-First Structure (`exec-summary-first`)
```
1. Title (layout: title)
2. Executive Summary (layout: agenda) — Full answer on slide 2
3–N. Supporting detail (any layout) — For readers who want depth
N+1. Appendix section (layout: section)
```

## Storytelling Principles (McKinsey / Pyramid Principle)

### 1. Pyramid Principle
- **Conclusion first**: Each slide title states the conclusion/assertion of that slide (no questions, no vague labels)
- **So What?**: Each `keyMessage` answers "So what?" for the audience
- **MECE**: Topics are Mutually Exclusive, Collectively Exhaustive

### 2. Slide Title Writing Rules
- ✅ Good: "Azure AI cuts development costs by 40%" (clear assertion)
- ❌ Bad: "About Azure AI" (no assertion)
- ✅ Good: "3 implementation patterns enable rapid onboarding"
- ❌ Bad: "Implementation Patterns Overview"

### 3. Content Quality Requirements
- Include concrete data/numbers in bullets (e.g., "Market grew 40% YoY (Gartner 2025)")
- Notes must be 2–3 sentences, never empty or just a dash
- Avoid generic statements — every bullet should be specific and defensible

## set_scenario Output Fields

| Field | Required | Description |
|-------|----------|-------------|
| `number` | ✅ | Slide number |
| `title` | ✅ | Conclusion-first title (McKinsey style) |
| `keyMessage` | ✅ | The single most important sentence (answers "So What?") |
| `layout` | ✅ | Layout hint (see below) — may be reinterpreted by PPTX generator |
| `bullets` | ✅ | Content items with specific data/numbers |
| `notes` | ✅ | Speaker notes, 2–3 sentences (mandatory on every slide) |
| `icon` | — | Icon name from the available set |

## Available Layouts

| layout | Purpose |
|--------|---------|
| `title` | Title slide: large title + subtitle |
| `agenda` | Agenda / summary: numbered item list |
| `section` | Section divider: large text + accent bar |
| `bullets` | Bulleted explanation |
| `cards` | Parallel items (2–4 cards) |
| `stats` | Number highlights: large stats |
| `comparison` | Before/After or option comparison |
| `timeline` | Sequential steps / roadmap |
| `diagram` | Concept diagram / architecture |
| `summary` | Key Takeaways (3 points) |
| `closing` | Thank-you / end slide |
| `photo_fullbleed` | Full-bleed photo with overlaid title |
| `multi_column` | 3–5 equal-width content columns |

## Available Icons

Icons are provided by **Iconify**. Use Iconify icon IDs (e.g., `mdi:brain`, `lucide:rocket`) or legacy aliases (e.g., `brain`, `rocket`). The available icon names are supplied in the workspace context at runtime. Assign one icon per slide as a design hint.

## Language Rules

- Match the user's language when creating slides
- Append original terms for technical jargon (e.g., "Retrieval-Augmented Generation (RAG)")
- Use official names for products/services

## Content Quality Checklist

- [ ] Title slide and summary slide are included
- [ ] Every slide title states a conclusion or assertion (no vague labels)
- [ ] Bullets contain specific numbers/data
- [ ] The deck has a logical arc (intro → body → conclusion)
- [ ] Vocabulary level is appropriate for the target audience
- [ ] Framework was confirmed with the user (or user-specified framework was applied) before `set_scenario`
