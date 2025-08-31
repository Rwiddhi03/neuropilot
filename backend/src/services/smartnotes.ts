import fs from "fs"
import path from "path"
import { PDFDocument } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import llm from "../utils/llm/llm"

type SmartNotesOptions = {
  topic?: string
  notes?: string
  filePath?: string
}

function sanitizeText(s: string) {
  if (!s) return ""
  return s
    .replace(/\u2192/g, "->")
    .replace(/\u00b2/g, "^2")
    .replace(/\u00b3/g, "^3")
    .replace(/[^\x00-\x7F]/g, "")
}

function wrap(s:string, max=90){
  return s.split("\n").map(line=>{
    const out:string[]=[]; let cur=""
    for (const w of line.split(/\s+/)){
      if((cur + " " + w).trim().length>max){ out.push(cur); cur=w }
      else cur = (cur ? cur+" " : "") + w
    }
    if(cur) out.push(cur)
    return out.join("\n")
  }).join("\n")
}

async function readInput(opts: SmartNotesOptions) {
  if (opts.notes) return opts.notes
  if (opts.filePath) return await fs.promises.readFile(opts.filePath, "utf8")
  if (opts.topic) return `Generate detailed Cornell notes on: ${opts.topic}`
  throw new Error("No input")
}

async function generateNotes(text: string) {
  const prompt = `
ROLE
You are a note generator producing Cornell-style notes.

OBJECTIVE
Generate maximum detailed study notes from the input.

OUTPUT
Return ONLY a valid JSON object, no markdown, no prose.

SCHEMA
{
  "title": string,
  "notes": string,
  "summary": string,
  "questions": string[],
  "answers": string[]
}

RULES
- Do not wrap with code fences.
- Do not add commentary.
- Use plain text only.
- If a field has no content, return "" or [].
- For each question, the corresponding answer must be in the same index in answers.
`
  const r = await llm.invoke([{ role: "user", content: prompt + "\n\nINPUT:\n" + text }])
  const raw = typeof r === "string" ? r : String((r as any)?.content ?? "")
  return JSON.parse(raw)
}

async function fillTemplate(data: any) {
  const dir = path.join(process.cwd(), "assets", "smartnotes")
  const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith(".pdf"))
  if (!files.length) throw new Error("No PDF templates")

  const chosen = files[Math.floor(Math.random() * files.length)]
  const pdfBytes = await fs.promises.readFile(path.join(dir, chosen))
  const pdfDoc = await PDFDocument.load(pdfBytes)
  pdfDoc.registerFontkit(fontkit)
  const form = pdfDoc.getForm()
  const fontPath = path.join(process.cwd(), "assets", "fonts", "Lexend.ttf")
  const fontBytes = await fs.promises.readFile(fontPath)
  const font = await pdfDoc.embedFont(fontBytes, { subset: true })

  try { form.updateFieldAppearances(font) } catch { }
  try { form.getTextField("topic").setText(sanitizeText(data.title || "")) } catch { }
  try { form.getTextField("notes").setText(wrap(sanitizeText(data.notes || ""))) } catch { }
  try { form.getTextField("summary").setText(wrap(sanitizeText(data.summary || ""))) } catch { }

  try {
    const qna = (data.questions || []).map((q: string, i: number) => {
      const a = (data.answers && data.answers[i]) ? `\nAnswer: ${data.answers[i]}` : ""
      return `• ${q}${a}`
    }).join("\n\n")
    form.getTextField("questions").setText(sanitizeText(qna))
  } catch { }

  const outDir = path.join(process.cwd(), "storage", "smartnotes")
  await fs.promises.mkdir(outDir, { recursive: true })
  const safeTitle = sanitizeText(data.title || "notes").replace(/[^a-z0-9]/gi, "_").slice(0, 50)
  const outPath = path.join(outDir, `${safeTitle}.pdf`)

  const outBytes = await pdfDoc.save()
  await fs.promises.writeFile(outPath, outBytes)
  return outPath
}

export async function handleSmartNotes(opts: SmartNotesOptions) {
  const input = await readInput(opts)
  const data = await generateNotes(input)
  const file = await fillTemplate(data)
  return { ok: true, file }
}