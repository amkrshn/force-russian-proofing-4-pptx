import type { ProofingJob } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

function responseError(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>
    if (typeof body.detail === 'string') return body.detail
    if (typeof body.message === 'string') return body.message
  }
  return `HTTP ${status}`
}

export function createJob(
  file: File,
  onUploadProgress?: (percent: number) => void,
): Promise<ProofingJob> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/jobs`)
    xhr.responseType = 'json'

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
}

export async function getJob(jobId: string): Promise<ProofingJob> {
  const response = await fetch(`${API_BASE}/api/jobs/${jobId}`, { cache: 'no-store' })
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

export function downloadUrl(jobId: string): string {
  return `${API_BASE}/api/jobs/${jobId}/download`
}
