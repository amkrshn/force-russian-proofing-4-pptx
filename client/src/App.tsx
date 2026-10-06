import { RussianProofingUploader } from './components/RussianProofingUploader'

export default function App() {
  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <RussianProofingUploader />
      <footer>Server-side OOXML processing · no Microsoft Office installation required</footer>
    </main>
  )
}
