import { handleAsk } from '../../lib/ai/ask'
import { parseMultipart, handleUpload } from '../../lib/parser/upload'
import { mkChat, getChat, addMsg, listChats, getMsgs } from '../../services/chat'
import { emitToAll } from '../../utils/chat/ws'

type UpFile = { path: string; filename: string; mimeType: string }

const chatSockets = new Map<string, Set<any>>()

export function chatRoutes(app: any) {
  app.ws('/ws/chat', (ws: any, req: any) => {
    const url = new URL(req.url, 'http://localhost')
    const chatId = url.searchParams.get('chatId')
    if (!chatId) {
      console.log('[chat] ws close 1008 no chatId')
      return ws.close(1008, 'chatId required')
    }

    let set = chatSockets.get(chatId)
    if (!set) { set = new Set(); chatSockets.set(chatId, set) }
    set.add(ws)
    console.log('[chat] ws open', { chatId, size: set.size })

    ws.on('close', (code: number, reason: string) => {
      set!.delete(ws)
      if (set!.size === 0) chatSockets.delete(chatId)
      console.log('[chat] ws close', { chatId, size: set?.size ?? 0, code, reason: String(reason || '') })
    })

    ws.send(JSON.stringify({ type: 'ready', chatId }))
  })

  app.post('/chat', async (req: any, res: any, next: any) => {
    const t0 = Date.now()
    try {
      const ct = String(req.headers['content-type'] || '')
      const isMp = ct.includes('multipart/form-data')
      console.log('[chat] req', { ct, isMp })

      let q = ''
      let chatId: string | undefined
      let files: UpFile[] = []

      if (isMp) {
        const tMp = Date.now()
        const { q: mq, chatId: mcid, files: mf } = await parseMultipart(req)
        q = mq; chatId = mcid; files = mf || []
        console.log('[chat] multipart parsed', { qLen: q?.length || 0, chatId, files: files.length, tookMs: Date.now() - tMp })
        if (!q) return res.status(400).send({ error: 'q required for file uploads' })
      } else {
        q = req.body?.q || ''
        chatId = req.body?.chatId
        console.log('[chat] json body', { qLen: q?.length || 0, chatId })
        if (!q) return res.status(400).send({ error: 'q required' })
      }

      let chat = chatId ? await getChat(chatId) : undefined
      if (!chat) chat = await mkChat(q)
      const id = chat.id
      const ns = `chat:${id}`
      console.log('[chat] chat resolved', { id, ns })

      res.status(202).send({ ok: true, chatId: id, stream: `/ws/chat?chatId=${id}` })

      ;(async () => {
        try {
          if (isMp) {
            console.log('[chat] emit phase upload_start')
            emitToAll(chatSockets.get(id), { type: 'phase', value: 'upload_start' })
            const tUp = Date.now()
            for (const f of files) {
              console.log('[chat] uploading', { filename: f.filename, mime: f.mimeType, path: f.path })
              emitToAll(chatSockets.get(id), { type: 'file', filename: f.filename, mime: f.mimeType })
              await handleUpload({ filePath: f.path, filename: f.filename, contentType: f.mimeType, namespace: ns })
            }
            console.log('[chat] upload done', { files: files.length, tookMs: Date.now() - tUp })
            console.log('[chat] emit phase upload_done')
            emitToAll(chatSockets.get(id), { type: 'phase', value: 'upload_done' })
          }

          const tUser = Date.now()
          await addMsg(id, { role: 'user', content: q, at: Date.now() })
          console.log('[chat] msg added user', { tookMs: Date.now() - tUser, qLen: q?.length || 0 })

          console.log('[chat] emit phase generating')
          emitToAll(chatSockets.get(id), { type: 'phase', value: 'generating' })

          const tAsk = Date.now()
          let answer: string = ''
          try {
            answer = await (handleAsk as any)({ q, namespace: ns })
          } catch {
            answer = await (handleAsk as any)(q, ns)
          }
          console.log('[chat] handleAsk done', { tookMs: Date.now() - tAsk, ansLen: answer?.length || 0 })

          const tAsst = Date.now()
          await addMsg(id, { role: 'assistant', content: answer, at: Date.now() })
          console.log('[chat] msg added assistant', { tookMs: Date.now() - tAsst })

          console.log('[chat] emit answer')
          emitToAll(chatSockets.get(id), { type: 'answer', answer })
          console.log('[chat] emit done')
          emitToAll(chatSockets.get(id), { type: 'done' })
          console.log('[chat] ok', { totalMs: Date.now() - t0, chatId: id })
        } catch (err: any) {
          const msg = err?.message || 'failed'
          const stack = err?.stack || String(err)
          console.log('[chat] err inner', { chatId: id, msg, stack })
          emitToAll(chatSockets.get(id), { type: 'error', error: msg })
        }
      })().catch((e: any) => {
        console.log('[chat] err runner', e?.message || e)
      })
    } catch (e: any) {
      console.log('[chat] err outer', e?.message || e)
      next(e)
    }
  })

  app.get('/chats', async (_: any, res: any) => {
    const t = Date.now()
    const chats = await listChats()
    console.log('[chat] list chats', { n: chats?.length ?? 0, tookMs: Date.now() - t })
    res.send({ ok: true, chats })
  })

  app.get('/chats/:id', async (req: any, res: any) => {
    const t = Date.now()
    const id = req.params.id
    const chat = await getChat(id)
    if (!chat) {
      console.log('[chat] get chat 404', { id })
      return res.status(404).send({ error: 'not found' })
    }
    const messages = await getMsgs(id)
    console.log('[chat] get chat', { id, msgs: messages?.length ?? 0, tookMs: Date.now() - t })
    res.send({ ok: true, chat, messages })
  })
}