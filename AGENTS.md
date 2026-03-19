# AGENTS.md — Project Instructions

## Project Overview

Electron desktop app (React + TypeScript + Tailwind CSS v4) for AI-powered PowerPoint slide generation.

### Preserve Generated Python Code for Debugging

**Rule:** Never delete generated Python files (e.g., `generated-source.py` in the workspace/previews directory). These files are essential for debugging python-pptx code generation issues. On both success and failure paths, keep the generated `.py` source files intact.

