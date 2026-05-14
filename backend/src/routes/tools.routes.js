// src/routes/tools.routes.js
import { Router } from 'express'
import { requireAuth } from '../middleware/keycloak.middleware.js'
import {
  registerTool,
  getAllTools,
  getToolById,
  deleteTool,
} from '../controllers/tools.controller.js'

const router = Router()

// Public — anyone can see tools
router.get('/',           getAllTools)
router.get('/:tool_id',   getToolById)

// Protected — only logged in users
router.post('/register',  requireAuth, registerTool)
router.delete('/:tool_id', requireAuth, deleteTool)

export default router