# React / third-party service integration

The recommended integration is to use the React component directly in a third-party service UI and proxy the backend API through that service's origin.

## Preferred architecture

```text
Third-party React UI
   |
   | /tools/pptx-proofing/api/*
   v
Third-party service reverse proxy / gateway
   |
   v
Force RussianProofing4PPTX service
```

This model has several advantages:

- the browser remains on the authenticated third-party service origin;
- no separate login is required;
- CORS can be disabled for the proofing service;
- authorization, audit, WAF and request policies can remain centralized in the host service;
- PPTX files do not need to be exposed through a separate public endpoint.

## React component

The component is exported from:

```text
client/src/components/index.ts
```

Example:

```tsx
import { RussianProofingUploader } from './components/RussianProofingUploader'

export function PresentationToolsPage() {
  return (
    <RussianProofingUploader
      apiBase="/tools/pptx-proofing"
      credentials="same-origin"
      onReady={(job) => {
        console.info('Proofing completed', job.id)
      }}
    />
  )
}
```

The component CSS is prefixed with `frp-` and is imported by the component itself to reduce collisions with the host application's design system.

## Component props

```ts
interface RussianProofingUploaderProps {
  apiBase?: string
  credentials?: RequestCredentials
  maxFileSizeBytes?: number
  onReady?: (job: ProofingJob) => void
  onError?: (message: string) => void
}
```

### `apiBase`

Base path or URL before `/api`.

Examples:

```text
""                              -> /api/jobs
"/tools/pptx-proofing"          -> /tools/pptx-proofing/api/jobs
"https://proofing.internal"     -> https://proofing.internal/api/jobs
```

The same-origin proxy variant is preferred.

### `credentials`

Defaults to `same-origin`. Use `include` only if a deliberately configured cross-origin authentication flow requires cookies.

### `maxFileSizeBytes`

Optional UI override. If omitted, the component reads `/api/config` from the server and falls back to 100 MB only if the config endpoint cannot be reached.

## Reverse proxy mapping

The host service proxy should map:

```text
/tools/pptx-proofing/api/health
/tools/pptx-proofing/api/config
/tools/pptx-proofing/api/jobs
/tools/pptx-proofing/api/jobs/<id>
/tools/pptx-proofing/api/jobs/<id>/download
```

to the service paths:

```text
/api/health
/api/config
/api/jobs
/api/jobs/<id>
/api/jobs/<id>/download
```

The upload route must allow the configured body size and a processing/download timeout of at least several minutes for unusually large presentations.

## Authentication boundary

The proofing service currently trusts the upstream authenticated environment. If the surrounding third-party service performs authentication, do not expose the backend container directly to user networks. Allow access only from the host service gateway/reverse proxy network.

If later per-user audit is required, the gateway can inject a signed internal user identifier header. The proofing service should not trust arbitrary identity headers from the public/user-facing network.

## Download behavior

The React module downloads the result using `fetch` and a browser Blob rather than a plain hyperlink. This allows authenticated same-origin or configured credentialed requests and keeps the corrected file name supplied by the job metadata.

After a successful file response the server removes the temporary job directory. If the user does not download the result, TTL cleanup removes it later.
