/**
 * SettingsModal: LLM provider configuration
 * Supports GitHub Copilot, Azure OpenAI, OpenAI, and Claude providers.
 */

import { useState, useEffect, useMemo } from 'react'
import { X, Save, Loader2, Eye, EyeOff } from 'lucide-react'

interface Props {
  onClose: () => void
}

type SettingsField = {
  key: string
  label: string
  placeholder?: string
  secret?: boolean
  hint?: string
  options?: Array<{ value: string; label: string }>
  /** Show this field only when LLM_PROVIDER matches one of these values (empty = always). */
  providers?: string[]
  /** When true, the field is optional and shows an "Optional" badge. */
  optional?: boolean
}

const PROVIDER_OPTIONS = [
  { value: 'copilot', label: 'GitHub Copilot' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure-openai', label: 'Azure OpenAI' },
  { value: 'claude', label: 'Claude (Anthropic)' },
]

const FIELDS: SettingsField[] = [
  {
    key: 'LLM_PROVIDER',
    label: 'LLM Provider',
    hint: 'Select the AI provider. Each provider requires its own credentials below.',
    options: PROVIDER_OPTIONS,
  },
  // --- Copilot ---
  {
    key: 'COPILOT_MODEL_SOURCE',
    label: 'Copilot Model Source',
    hint: 'Use GitHub-hosted models by default. Switch to Azure only when you want to use your own Azure OpenAI or Foundry deployment through the Copilot provider.',
    options: [
      { value: 'github-hosted', label: 'GitHub-hosted models' },
      { value: 'azure-openai', label: 'Self-serving Azure OpenAI / Foundry' },
    ],
    providers: ['copilot'],
  },
  {
    key: 'GITHUB_TOKEN',
    label: 'GitHub Token',
    placeholder: 'ghp_...',
    secret: true,
    hint: 'GitHub PAT with Copilot entitlement. Required when using the GitHub Copilot provider.',
    providers: ['copilot'],
  },
  // --- OpenAI ---
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI API Key',
    placeholder: 'sk-...',
    secret: true,
    hint: 'API key from platform.openai.com.',
    providers: ['openai'],
  },
  // --- Azure OpenAI ---
  {
    key: 'AZURE_OPENAI_ENDPOINT',
    label: 'Azure OpenAI Endpoint',
    placeholder: 'https://your-resource.openai.azure.com/openai/v1',
    hint: 'Use the full v1 base URL, including /openai/v1.',
    providers: ['azure-openai'],
  },
  {
    key: 'AZURE_OPENAI_API_KEY',
    label: 'Azure OpenAI API Key',
    placeholder: 'Leave empty to use DefaultAzureCredential (az login)',
    secret: true,
    hint: 'API key for Azure OpenAI. Optional if using Azure CLI or managed identity.',
    providers: ['azure-openai'],
    optional: true,
  },
  {
    key: 'AZURE_TENANT_ID',
    label: 'Azure Tenant ID',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    hint: 'Required when you have multiple tenants.',
    providers: ['azure-openai'],
    optional: true,
  },
  // --- Claude ---
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key',
    placeholder: 'sk-ant-...',
    secret: true,
    hint: 'API key from console.anthropic.com.',
    providers: ['claude'],
  },
  // --- Shared ---
  {
    key: 'MODEL_NAME',
    label: 'Model Name',
    placeholder: 'gpt-5.4-mini',
    hint: 'Model identifier or Azure deployment name. Provider-specific.',
  },
  {
    key: 'REASONING_EFFORT',
    label: 'Reasoning Effort',
    hint: 'Controls the model reasoning budget. Low for speed, medium for balance, high for harder tasks.',
    options: [
      { value: '', label: 'Default (unset)' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    optional: true,
  },
  {
    key: 'PPTX_CHUNK_SIZE',
    label: 'Slides per Chunk (Experimental)',
    placeholder: '0',
    hint: 'Number of slides per parallel generation chunk. Set to 0 to disable chunking. Default: 0 (disabled).',
    optional: true,
  },
]

export function SettingsModal({ onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProvider = values.LLM_PROVIDER || 'copilot'
  const copilotModelSource = values.COPILOT_MODEL_SOURCE || 'github-hosted'

  const visibleFields = useMemo(() => {
    return FIELDS.filter((field) => {
      if (field.key.startsWith('AZURE_OPENAI_') || field.key === 'AZURE_TENANT_ID') {
        return selectedProvider === 'azure-openai'
          || (selectedProvider === 'copilot' && copilotModelSource === 'azure-openai')
      }

      if (!field.providers || field.providers.length === 0) return true
      return field.providers.includes(selectedProvider)
    })
  }, [copilotModelSource, selectedProvider])

  function getFieldValue(key: string): string {
    if (values[key] != null) return values[key]
    if (key === 'LLM_PROVIDER') return 'copilot'
    if (key === 'COPILOT_MODEL_SOURCE') return 'github-hosted'
    return ''
  }

  function validate(valuesToSave: Record<string, string>): string | null {
    const provider = valuesToSave.LLM_PROVIDER || 'copilot'
    const modelSource = valuesToSave.COPILOT_MODEL_SOURCE || 'github-hosted'

    if (!valuesToSave.MODEL_NAME?.trim()) {
      return 'Model Name is required.'
    }

    if (provider === 'copilot') {
      if (!valuesToSave.GITHUB_TOKEN?.trim()) {
        return 'GitHub Token is required for the GitHub Copilot provider.'
      }
      if (modelSource === 'azure-openai' && !valuesToSave.AZURE_OPENAI_ENDPOINT?.trim()) {
        return 'Azure OpenAI Endpoint is required when Copilot is configured for self-serving Azure OpenAI / Foundry.'
      }
    }

    if (provider === 'openai' && !valuesToSave.OPENAI_API_KEY?.trim()) {
      return 'OpenAI API Key is required for the OpenAI provider.'
    }

    if (provider === 'azure-openai' && !valuesToSave.AZURE_OPENAI_ENDPOINT?.trim()) {
      return 'Azure OpenAI Endpoint is required for the Azure OpenAI provider.'
    }

    if (provider === 'claude' && !valuesToSave.ANTHROPIC_API_KEY?.trim()) {
      return 'Anthropic API Key is required for the Claude provider.'
    }

    return null
  }

  useEffect(() => {
    if (!window.electronAPI?.settings) {
      setLoading(false)
      return
    }
    window.electronAPI.settings.get()
      .then((v) => {
        setValues({
          LLM_PROVIDER: 'copilot',
          COPILOT_MODEL_SOURCE: 'github-hosted',
          ...v,
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!window.electronAPI?.settings) return
    const nextError = validate(values)
    if (nextError) {
      setError(nextError)
      return
    }

    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await window.electronAPI.settings.save(values)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }
  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Panel */}
      <div
        className="flex flex-col w-[520px] max-h-[90vh] border"
        style={{ background: 'var(--surface)', borderColor: 'var(--panel-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 border-b"
          style={{ borderColor: 'var(--panel-border)', height: 48, minHeight: 48 }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Settings
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Values are saved to the app's user-data folder and applied to the running process immediately.
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                For slide images, the app supports direct image URLs in `imageQuery` and web image search through the local Python environment. Enter one or more keywords and select one or more images per slide.
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                The preview panel renders local slide images from the generated PPTX on Windows. This requires Microsoft PowerPoint to be installed.
              </p>
              {selectedProvider === 'copilot' ? (
                <div className="border px-3 py-2" style={{ borderColor: 'var(--panel-border)', background: 'var(--surface-hover)' }}>
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    GitHub Copilot mode
                  </p>
                  <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
                    GitHub Token is required. Azure OpenAI settings are only used when Copilot Model Source is set to self-serving Azure OpenAI / Foundry.
                  </p>
                </div>
              ) : null}
              {error ? (
                <div className="border px-3 py-2 text-[11px]" style={{ borderColor: 'rgba(220, 38, 38, 0.35)', background: 'rgba(220, 38, 38, 0.08)', color: '#b91c1c' }}>
                  {error}
                </div>
              ) : null}

              {visibleFields.map(({ key, label, placeholder, secret, hint, options, optional }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {label}
                    <span
                      className="text-[10px] font-medium px-1.5 py-px rounded-sm"
                      style={optional
                        ? { color: 'var(--text-muted)', background: 'var(--surface-hover)' }
                        : { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}
                    >
                      {optional ? 'Optional' : 'Required'}
                    </span>
                  </label>
                  <div
                    className="flex items-center gap-2 border px-3"
                    style={{ height: 36, background: 'var(--input-bg)', borderColor: 'var(--panel-border)' }}
                  >
                    {options ? (
                      <select
                        value={getFieldValue(key)}
                        onChange={(e) => {
                          const nextValue = e.target.value
                          setValues((v) => ({ ...v, [key]: nextValue }))
                          setError(null)
                        }}
                        className="flex-1 bg-transparent text-xs outline-none"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={secret && !showSecret ? 'password' : 'text'}
                        value={getFieldValue(key)}
                        onChange={(e) => {
                          const nextValue = e.target.value
                          setValues((v) => ({ ...v, [key]: nextValue }))
                          setError(null)
                        }}
                        placeholder={placeholder}
                        className="flex-1 bg-transparent text-xs outline-none"
                        style={{ color: 'var(--text-primary)' }}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    )}
                    {secret && (
                      <button
                        onClick={() => setShowSecret((s) => !s)}
                        className="flex-none"
                        style={{ color: 'var(--text-muted)' }}
                        tabIndex={-1}
                        aria-label={showSecret ? 'Hide' : 'Show'}
                      >
                        {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    )}
                  </div>
                  {hint && (
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{hint}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-5 border-t"
          style={{ borderColor: 'var(--panel-border)', height: 52, minHeight: 52 }}
        >
          <button
            onClick={onClose}
            className="px-4 text-xs font-medium border transition-colors"
            style={{ height: 32, borderColor: 'var(--panel-border)', color: 'var(--text-secondary)', background: 'transparent' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ height: 32, background: saved ? '#16a34a' : 'var(--accent)', color: '#fff' }}
          >
            {saving
              ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
              : saved
              ? 'Saved ✓'
              : <><Save size={13} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  )
}
