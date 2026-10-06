import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createJob, downloadUrl, getJob } from '../api'
import type { ProofingJob } from '../types'

const MAX_FILE_SIZE = 100 * 1024 * 1024

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

export function RussianProofingUploader() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<ProofingJob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

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
      setError('Поддерживаются только файлы .pptx и .pptm.')
      return
    }
    if (candidate.size > MAX_FILE_SIZE) {
      setFile(null)
      setError('Размер файла превышает 100 МБ.')
      return
    }
    setFile(candidate)
  }, [])

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
      const created = await createJob(file, setUploadProgress)
      setJob(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить файл.')
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!job || !['queued', 'processing'].includes(job.state)) return

    let cancelled = false
    const timer = window.setInterval(async () => {
      try {
        const updated = await getJob(job.id)
        if (cancelled) return
        setJob(updated)
        if (updated.state === 'ready' || updated.state === 'error') {
          setBusy(false)
          window.clearInterval(timer)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось получить состояние задачи.')
        setBusy(false)
        window.clearInterval(timer)
      }
    }, 500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [job?.id, job?.state])

  const reset = () => {
    setFile(null)
    setJob(null)
    setError('')
    setBusy(false)
    setUploadProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="tool-card" aria-labelledby="tool-title">
      <div className="eyebrow">PowerPoint OOXML proofing utility</div>
      <h1 id="tool-title">Force RussianProofing4PPTX</h1>
      <p className="lead">
        Загружает презентацию на сервер, устанавливает для текстовых run-параметров язык
        <strong> ru-RU</strong>, очищает старый кэш ошибок проверки и помечает текст для повторной проверки PowerPoint.
      </p>

      <div
        className={`drop-zone ${dragActive ? 'drag-active' : ''} ${file ? 'has-file' : ''}`}
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
        <div className="file-icon" aria-hidden="true">P</div>
        {file ? (
          <div className="file-meta">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
        ) : (
          <div className="file-meta">
            <strong>Перетащите PPTX сюда</strong>
            <span>или нажмите для выбора файла · максимум 100 МБ</span>
          </div>
        )}
      </div>

      {(job || busy) && (
        <div className="progress-panel" aria-live="polite">
          <div className="progress-head">
            <div>
              <span className="status-label">{statusText}</span>
              <span className="current-part">{job?.current_part || 'Загрузка презентации'}</span>
            </div>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      )}

      {error && <div className="message error-message">{error}</div>}
      {job?.state === 'error' && (
        <div className="message error-message">{job.error || 'Ошибка обработки.'}</div>
      )}

      {isReady && job && (
        <div className="result-panel">
          <div>
            <div className="result-title">Готово</div>
            <div className="result-file">{job.output_name}</div>
          </div>
          <div className="stats-grid">
            <div><span>XML изменено</span><strong>{job.stats.xml_parts_changed ?? 0}</strong></div>
            <div><span>Язык изменён</span><strong>{job.stats.lang_changed ?? 0}</strong></div>
            <div><span>Кэш ошибок очищен</span><strong>{job.stats.err_removed ?? 0}</strong></div>
            <div><span>rPr добавлено</span><strong>{job.stats.missing_rpr_inserted ?? 0}</strong></div>
          </div>
          <p className="result-note">
            После открытия исправленного файла PowerPoint повторно проверит текст по русскому словарю. После проверки сохраните презентацию один раз.
          </p>
        </div>
      )}

      <div className="actions">
        {!isReady ? (
          <button className="primary" type="button" disabled={!file || busy} onClick={start}>
            {busy ? 'Обработка…' : 'Исправить презентацию'}
          </button>
        ) : (
          <a className="primary button-link" href={downloadUrl(job!.id)} download={job!.output_name}>
            Скачать исправленный файл
          </a>
        )}
        {(file || job) && (
          <button className="secondary" type="button" disabled={busy} onClick={reset}>
            Новый файл
          </button>
        )}
      </div>
    </section>
  )
}
