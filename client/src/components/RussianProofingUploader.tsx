import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createProofingApi } from '../api'
import type { ProofingJob } from '../types'
import './RussianProofingUploader.css'

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024

export interface RussianProofingUploaderProps {
  apiBase?: string
  credentials?: RequestCredentials
  maxFileSizeBytes?: number
  onReady?: (job: ProofingJob) => void
  onError?: (message: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

function isSupported(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.pptx') || name.endsWith('.pptm')
}

export function RussianProofingUploader({
  apiBase,
  credentials = 'same-origin',
  maxFileSizeBytes,
  onReady,
  onError,
}: RussianProofingUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const api = useMemo(() => createProofingApi(apiBase, { credentials }), [apiBase, credentials])
  const [serverMaxFileSize, setServerMaxFileSize] = useState<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<ProofingJob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const effectiveMaxFileSize = maxFileSizeBytes ?? serverMaxFileSize ?? DEFAULT_MAX_FILE_SIZE

  useEffect(() => {
    let cancelled = false
    api.getConfig()
      .then((config) => {
        if (!cancelled && Number.isFinite(config.max_upload_bytes)) {
          setServerMaxFileSize(config.max_upload_bytes)
        }
      })
      .catch(() => {
        // Keep the local default if config is unavailable.
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const reportError = useCallback((message: string) => {
    setError(message)
    onError?.(message)
  }, [onError])

  const progress = job
    ? Math.min(100, Math.round(15 + job.progress * 0.85))
    : busy
      ? Math.round(uploadProgress * 0.15)
      : 0
  const isReady = job?.state === 'ready'

  const statusText = useMemo(() => {
    if (error) return 'Обработка остановлена'
    if (!job && busy) return 'Загрузка файла на сервер'
    if (!job) return file ? 'Файл готов к отправке' : 'Выберите презентацию'
    if (job.state === 'queued') return 'Файл загружен, задача поставлена в очередь'
    if (job.state === 'processing') return 'Обработка презентации на сервере'
    if (job.state === 'ready') return 'Исправленный файл готов'
    if (job.state === 'error') return 'Ошибка обработки'
    return 'Подготовка'
  }, [error, file, job, busy])

  const acceptFile = useCallback((candidate: File | null) => {
    setError('')
    setJob(null)
    setUploadProgress(0)

    if (!candidate) {
      setFile(null)
      return
    }
    if (!isSupported(candidate)) {
      setFile(null)
      reportError('Поддерживаются только файлы .pptx и .pptm.')
      return
    }
    if (candidate.size > effectiveMaxFileSize) {
      setFile(null)
      reportError(`Размер файла превышает лимит ${formatBytes(effectiveMaxFileSize)}.`)
      return
    }
    setFile(candidate)
  }, [effectiveMaxFileSize, reportError])

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0] ?? null)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    acceptFile(event.dataTransfer.files?.[0] ?? null)
  }

  const start = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await api.createJob(file, setUploadProgress)
      setJob(created)
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Не удалось отправить файл.')
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!job || !['queued', 'processing'].includes(job.state)) return

    let cancelled = false
    const timer = window.setInterval(async () => {
      try {
        const updated = await api.getJob(job.id)
        if (cancelled) return
        setJob(updated)
        if (updated.state === 'ready' || updated.state === 'error') {
          setBusy(false)
          window.clearInterval(timer)
        }
      } catch (err) {
        if (cancelled) return
        reportError(err instanceof Error ? err.message : 'Не удалось получить состояние задачи.')
        setBusy(false)
        window.clearInterval(timer)
      }
    }, 650)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, job?.id, job?.state, reportError])

  useEffect(() => {
    if (job?.state === 'ready') onReady?.(job)
  }, [job?.id, job?.state, onReady])

  const download = async () => {
    if (!job || job.state !== 'ready' || downloading) return
    setDownloading(true)
    setError('')
    try {
      const blob = await api.downloadJob(job.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = job.output_name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Не удалось скачать исправленный файл.')
    } finally {
      setDownloading(false)
    }
  }

  const reset = () => {
    setFile(null)
    setJob(null)
    setError('')
    setBusy(false)
    setDownloading(false)
    setUploadProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="frp-tool-card" aria-labelledby="frp-tool-title">
      <div className="frp-eyebrow">PowerPoint OOXML proofing utility</div>
      <h1 className="frp-title" id="frp-tool-title">Force RussianProofing4PPTX</h1>
      <p className="frp-lead">
        Загружает презентацию на сервер, устанавливает для текстовых run-параметров язык
        <strong> ru-RU</strong>, очищает старый кэш ошибок проверки и помечает текст для повторной проверки PowerPoint.
      </p>

      <div
        className={`frp-drop-zone ${dragActive ? 'frp-drag-active' : ''} ${file ? 'frp-has-file' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
      >
        <input ref={inputRef} type="file" accept=".pptx,.pptm" hidden onChange={onInput} />
        <div className="frp-file-icon" aria-hidden="true">P</div>
        {file ? (
          <div className="frp-file-meta">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
        ) : (
          <div className="frp-file-meta">
            <strong>Перетащите PPTX сюда</strong>
            <span>или нажмите для выбора файла · максимум {formatBytes(effectiveMaxFileSize)}</span>
          </div>
        )}
      </div>

      {(job || busy) && (
        <div className="frp-progress-panel" aria-live="polite">
          <div className="frp-progress-head">
            <div>
              <span className="frp-status-label">{statusText}</span>
              <span className="frp-current-part">{job?.current_part || 'Загрузка презентации'}</span>
            </div>
            <strong>{progress}%</strong>
          </div>
          <div className="frp-progress-track">
            <div className="frp-progress-fill" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      )}

      {error && <div className="frp-message frp-error-message">{error}</div>}
      {job?.state === 'error' && !error && (
        <div className="frp-message frp-error-message">{job.error || 'Ошибка обработки.'}</div>
      )}

      {isReady && job && (
        <div className="frp-result-panel">
          <div>
            <div className="frp-result-title">Готово</div>
            <div className="frp-result-file">{job.output_name}</div>
          </div>
          <div className="frp-stats-grid">
            <div><span>XML изменено</span><strong>{job.stats.xml_parts_changed ?? 0}</strong></div>
            <div><span>Язык изменён</span><strong>{job.stats.lang_changed ?? 0}</strong></div>
            <div><span>Кэш ошибок очищен</span><strong>{job.stats.err_removed ?? 0}</strong></div>
            <div><span>rPr добавлено</span><strong>{job.stats.missing_rpr_inserted ?? 0}</strong></div>
          </div>
          <p className="frp-result-note">
            После открытия исправленного файла PowerPoint повторно проверит текст по русскому словарю. После проверки сохраните презентацию один раз.
          </p>
        </div>
      )}

      <div className="frp-actions">
        {!isReady ? (
          <button className="frp-primary" type="button" disabled={!file || busy} onClick={start}>
            {busy ? 'Обработка…' : 'Исправить презентацию'}
          </button>
        ) : (
          <button className="frp-primary" type="button" disabled={downloading} onClick={download}>
            {downloading ? 'Скачивание…' : 'Скачать исправленный файл'}
          </button>
        )}
        {(file || job) && (
          <button className="frp-secondary" type="button" disabled={busy || downloading} onClick={reset}>
            Новый файл
          </button>
        )}
      </div>
    </section>
  )
}
