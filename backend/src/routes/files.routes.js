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

const router = Router()

// multer stores file in memory (buffer) — we pass it to MinIO directly
const upload = multer({ storage: multer.memoryStorage() })

router.post('/upload',         upload.single('file'), uploadFile)
router.get('/search',          searchFiles)
router.get('/',                listFiles)
router.get('/url/:id',         getPresignedUrl)
router.get('/download/:id',    downloadFile)
router.delete('/:id',          deleteFile)

export default router