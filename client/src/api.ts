import type { ProofingJob } from './types'

export interface ProofingServiceConfig {
  max_upload_bytes: number
  supported_extensions: string[]
  max_concurrent_jobs: number
}

export interface ProofingApiOptions {
  credentials?: RequestCredentials
}

const ENV_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

function normalizeBase(apiBase?: string): string {
  return (apiBase ?? ENV_API_BASE).replace(/\/$/, '')
}

function responseError(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>
    if (typeof body.detail === 'string') return body.detail
    if (typeof body.message === 'string') return body.message
  }
  return `HTTP ${status}`
}

export function createProofingApi(apiBase?: string, options: ProofingApiOptions = {}) {
  const base = normalizeBase(apiBase)
  const credentials = options.credentials ?? 'same-origin'

  const createJob = (
    file: File,
    onUploadProgress?: (percent: number) => void,
  ): Promise<ProofingJob> => new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/api/jobs`)
    xhr.responseType = 'json'
    xhr.withCredentials = credentials === 'include'

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onUploadProgress) return
      onUploadProgress(Math.round((event.loaded / event.total) * 100))
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ProofingJob)
      } else {
        reject(new Error(responseError(xhr.status, xhr.response)))
      }
    }

    xhr.onerror = () => reject(new Error('Network error while uploading the presentation.'))
    xhr.onabort = () => reject(new Error('Upload was cancelled.'))
    xhr.send(form)
  })

  const getJob = async (jobId: string): Promise<ProofingJob> => {
    const response = await fetch(`${base}/api/jobs/${jobId}`, {
      cache: 'no-store',
      credentials,
    })
    if (!response.ok) {
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        // no-op
      }
      throw new Error(responseError(response.status, payload))
    }
    return response.json()
  }

  const getConfig = async (): Promise<ProofingServiceConfig> => {
    const response = await fetch(`${base}/api/config`, {
      cache: 'no-store',
      credentials,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  const downloadJob = async (jobId: string): Promise<Blob> => {
    const response = await fetch(`${base}/api/jobs/${jobId}/download`, {
      cache: 'no-store',
      credentials,
    })
    if (!response.ok) {
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        // no-op
      }
      throw new Error(responseError(response.status, payload))
    }
    return response.blob()
  }

  return { createJob, getJob, getConfig, downloadJob }
}
