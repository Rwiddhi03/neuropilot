import { chatRoutes } from './routes/chat'
import { quizRoutes } from './routes/quiz'
import { flashcardRoutes } from './routes/flashcards'
import { smartnotesRoutes  } from './routes/notes'
import { podcastRoutes } from './routes/podcast'
export function registerRoutes(app: any) {
  chatRoutes(app)
  quizRoutes(app)
  podcastRoutes(app)
  flashcardRoutes(app)
  smartnotesRoutes(app)
}