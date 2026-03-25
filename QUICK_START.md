# QUICK_START

User guide for creating presentation decks with PPTX Slide Agent.

## Overview

PPTX Slide Agent helps you build PowerPoint presentations from:

- a chat prompt
- uploaded files
- web pages and URLs

The app has three main areas:

- left panel: chat with the agent
- center panel: preview generated slides and export results
- right panel: manage slides, source material, and theme options

## Before You Begin

- Use Windows if you want local slide previews.
- Install Microsoft PowerPoint desktop for preview rendering.
- Have valid model settings ready.

You do not need to install a separate AI CLI manually for normal use.

If your team gave you a prebuilt desktop app, open it normally.

If the app was provided as a local project instead of an installed app, ask the project owner for the startup method and required credentials.

## First-Time Setup

When you open the app for the first time:

1. Click the Settings button in the top-right corner.
2. Enter the connection details provided by your team.
3. Save the settings.

In Settings, first choose the provider, then fill only the fields that match that choice:

- `GitHub Copilot` + `GitHub-hosted models`:
	`GITHUB_TOKEN` and `MODEL_NAME`
- `GitHub Copilot` + `Self-serving Azure OpenAI / Foundry`:
	`GITHUB_TOKEN`, `COPILOT_MODEL_SOURCE`, `MODEL_NAME`, and Azure connection details
- `Azure OpenAI`:
	`MODEL_NAME` and Azure connection details
- `OpenAI`:
	`MODEL_NAME` and `OPENAI_API_KEY`
- `Claude`:
	`MODEL_NAME` and `ANTHROPIC_API_KEY`

`REASONING_EFFORT` is optional.

In most setups, the important requirement is valid model access, not any separate CLI installation.

For most users, the recommended option is `GitHub Copilot` with `GitHub-hosted models`.

- If your team uses GitHub-hosted models through Copilot, enter a `GITHUB_TOKEN` that has Copilot access.
- If your team uses Copilot with your own Azure OpenAI or Foundry deployment, set `COPILOT_MODEL_SOURCE` to `azure-openai` and enter the Azure connection details.
- If your team uses Azure OpenAI, OpenAI, or Claude, enter the provider-specific credentials provided by your team.
- If your team uses Azure OpenAI, use the full base URL in `AZURE_OPENAI_ENDPOINT`, including `/openai/v1`.

If you do not know which values to enter, contact the person who set up the app for you.

## Main Workflow

### 1. Choose a workspace

Use the workspace menu in the top bar to:

- start a new project
- choose or change the workspace folder
- save your work as a `.pptapp` project
- open an existing `.pptapp` project

The workspace folder is where the app stores generated content such as previews, selected images, and exported presentation assets.

### 2. Add source material

Open the `Context` tab in the right panel.

You can add:

- files
- URLs

This source material gives the agent the content it needs to build your slide story.

The app supports common text and document sources, including:

- CSV
- DOCX
- MD
- TXT

If you update your files or URLs later, use `Recreate source contents for files and URLs` to reload them.

### 3. Choose how the story should be structured

Open the `Slides` tab in the right panel.

Before generating slides, choose:

- a business framework
- optionally a brand style

The business framework controls how the story is organized. The brand style helps guide the final visual direction.

If you select the `Custom Template` brand style, you can attach a PPTX template and reuse its theme colors and backgrounds.

### 4. Ask the agent to build the first draft

In the chat panel, describe the deck you want.

Example:

```text
Create a consulting-style presentation about cloud cost reduction opportunities in our analytics platform. Use an executive-summary-first structure.
```

Then click `Brainstorm`.

The app will generate a draft slide plan and show the slides in the `Slides` tab.

### 5. Review and adjust the draft slides

In the `Slides` tab, review each slide's:

- title
- key message
- bullets
- layout hint
- icon hint
- image search query

You can also:

- delete slides
- move slides to the appendix
- change the framework
- change the brand style

If you want the agent to revise the slide plan, continue the conversation in chat and ask for the changes you want.

### 6. Add images to slides

Each slide includes a `Slide Image Search` section.

You can enter:

- a single keyword
- multiple keywords, one per line
- direct image URLs
- local image files

Then click `Choose images` and select one or more images for that slide.

### 7. Generate the PowerPoint

When the slide plan is ready, click `Create PPTX` in the chat panel.

The app will:

- use the approved slide plan
- apply your theme and icon settings
- include selected slide images
- generate the PowerPoint output
- refresh the preview when generation succeeds

## Theme And Palette

Open the `Palette` tab in the right panel if you want to control the deck look more directly.

You can:

- add up to four seed colors
- generate a palette
- auto-assign theme slots
- choose the icon collection
- export the theme as `.thmx`

Use this section before generating the PPTX if color control is important for your deck.

## NotebookLM Infographic

The slide panel includes a **NotebookLM Infographic** toggle that lets you generate infographic images from [Google NotebookLM](https://notebooklm.google/) notebooks.

Before using this feature:

1. Sign in to NotebookLM on this computer.
2. Create a notebook at [notebooklm.google.com](https://notebooklm.google.com/) and upload your source documents.
3. If NotebookLM is not connected yet, ask the person who set up the app to help complete the one-time connection.

To generate an infographic:

1. Open the `Slides` tab in the right panel.
2. Toggle **NotebookLM Infographic** on.
3. Select a notebook from the dropdown.
4. Click **Generate Infographic**.

The generated PNG image is saved to the workspace `images/` folder and can be used as a slide background image.

## Preview And Export

The center panel shows the generated preview.

Available actions include:

- `Refresh Preview`
- `.thmx`
- `Export .pptx`

Use `Refresh Preview` if you want to reload preview images that already exist in the workspace.

Use `Export .pptx` when you want to save the finished presentation.

## Save Your Work

Use the workspace menu in the top bar to save your progress as a `.pptapp` project.

Saved projects let you reopen:

- your slide plan
- chat history
- palette settings

## Troubleshooting

### The agent does not respond

Open Settings and check that the connection details are filled in correctly.

This issue is usually caused by missing or invalid model credentials, not by a missing local CLI installation.

### Slide previews do not appear

Check that Microsoft PowerPoint desktop is installed. If preview images still do not appear, try `Refresh Preview`.

### PPTX generation fails

This usually means one of the following:

- the connection settings are incomplete or invalid
- a required local dependency is missing
- the generated presentation hit a layout or runtime error

If this happens repeatedly, contact the person maintaining the app and provide the workspace contents for debugging.

## Recommended First Run

For a simple first run:

1. Open the app.
2. Enter the required settings.
3. Choose a workspace folder.
4. Add one or two files or URLs in `Context`.
5. Choose a framework in `Slides`.
6. Ask the agent to create the deck and click `Brainstorm`.
7. Review the draft slides.
8. Add images if needed.
9. Click `Create PPTX`.
10. Review the preview and export the final `.pptx`.