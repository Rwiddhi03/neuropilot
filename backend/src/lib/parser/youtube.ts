import path from 'path'
import fs from 'fs'
import { embedTextFromFile } from '../ai/embed'
import { YoutubeTranscript } from 'youtube-transcript'

const uploads = path.join(process.cwd(), 'storage')
if (!fs.existsSync(uploads)) fs.mkdirSync(uploads, { recursive: true })

export async function handleYouTubeIngest(req: any) {
  const raw = await getTranscript(req)
  const file = path.join(uploads, `yt-${Date.now()}.txt`)
  fs.writeFileSync(file, raw)

  await embedTextFromFile(file, 'neuropilot')
  return { stored: file }
}

async function getTranscript(url: string) {
  const transcript = await YoutubeTranscript.fetchTranscript(url)
  return transcript.map(t => t.text).join(' ')
}