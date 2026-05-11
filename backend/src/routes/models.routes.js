// src/routes/models.routes.js
import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/keycloak.middleware.js'
import {
  registerModel,
  getAllModels,
  getModelByUUID,
  addVersion,
  updateRequirementsUrl,
  updateSecurityData,
  getReports
} from '../controllers/model.controller.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// Public
router.get('/',      getAllModels)
router.get('/:uuid', getModelByUUID)
router.get('/:uuid/versions/:version/reports', getReports)


// Protected — require Keycloak token
router.post('/register',                                      requireAuth, registerModel)
router.post('/:uuid/versions',                                requireAuth, addVersion)
router.patch('/:uuid/versions/:version/requirements-url',     requireAuth, updateRequirementsUrl)
router.patch('/:uuid/versions/:version/security',             requireAuth, updateSecurityData)

export default router