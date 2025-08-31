import * as dotenv from 'dotenv'
import cors from 'cors';
import path from 'path'
import server from '../utils/server/server'
import { registerRoutes } from './router'
import { loggerMiddleware } from './middleware'

dotenv.config()

const app = server()

app.use(loggerMiddleware)
app.use(cors({
  origin: process.env.VITE_FRONTEND_URL,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(app.serverStatic("/storage", path.join(process.cwd(), "storage")))

registerRoutes(app)

app.listen(process.env.PORT, () => {
  console.log(`[neuropilot] running on ${process.env.VITE_BACKEND_URL}`)
})