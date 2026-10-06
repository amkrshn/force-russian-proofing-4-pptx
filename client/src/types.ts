export type JobState = 'queued' | 'processing' | 'ready' | 'error'

export interface JobStats {
  entries?: number
  xml_parts?: number
  xml_parts_changed?: number
  tags?: number
  lang_changed?: number
  altlang_changed?: number
  dirty_changed?: number
  err_removed?: number
  noproof_removed?: number
  missing_rpr_inserted?: number
}

export interface ProofingJob {
  id: string
  original_name: string
  output_name: string
  state: JobState
  progress: number
  current_part: string
  stats: JobStats
  error?: string | null
  download_ready: boolean
}
