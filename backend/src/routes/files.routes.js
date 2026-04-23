// src/routes/files.routes.js
import { Router } from 'express'
import multer from 'multer'
import {
  uploadFile,
  downloadFile,
  getPresignedUrl,
  searchFiles,
  listFiles,
  deleteFile,
} from '../controllers/minio.controller.js'
import { requireAuth } from '../middleware/keycloak.middleware.js'  

const router = Router()

// multer stores file in memory (buffer) — we pass it to MinIO directly
const upload = multer({ storage: multer.memoryStorage() })

// Protected — require Keycloak token
router.post('/upload',      requireAuth, upload.single('file'), uploadFile)
router.get('/url/:id',      requireAuth, getPresignedUrl)
router.delete('/:id',       requireAuth, deleteFile)

// Public — anyone can search and download
router.get('/search',       searchFiles)
router.get('/',             listFiles)
router.get('/download/:id', downloadFile)

export default router