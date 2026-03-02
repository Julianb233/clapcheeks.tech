import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { router as authRouter } from './routes/auth.js'
import { router as analyticsRouter } from './routes/analytics.js'
import { router as agentRouter } from './routes/agent.js'
import { router as stripeRouter } from './routes/stripe.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cors({ origin: process.env.WEB_URL || 'http://localhost:3000' }))
app.use(express.json())

// Routes
app.use('/auth', authRouter)
app.use('/analytics', analyticsRouter)
app.use('/agent', agentRouter)
app.use('/stripe', stripeRouter)

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', version: '0.1.0' }))

app.listen(PORT, () => console.log(`Outward API running on port ${PORT}`))
