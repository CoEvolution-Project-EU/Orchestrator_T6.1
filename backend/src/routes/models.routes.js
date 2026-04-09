import { Router } from "express";
import multer from 'multer';
import { requireAuth } from '../middleware/keycloak.middleware.js'

import {   
    registerModel,
    getAllModels,
    getModelByUUID,
    addVersion,
    uploadRequirements,
    updateRequirementsUrl
} from "../controllers/model.controller.js";


const router = Router();

const upload = multer({ storage: multer.memoryStorage() })  // ← create multer instance

// Protected routes — require Keycloak token
router.post('/register',    requireAuth, registerModel)
router.post('/:uuid/versions',                            requireAuth, addVersion)
router.post('/:uuid/versions/:version/requirements',      requireAuth, upload.single('file'), uploadRequirements)
 
// Public routes — no token needed to read
router.get('/',             getAllModels)
router.get('/:uuid',        getModelByUUID)
 
// Orchestrator routes — protected
router.patch('/:uuid/versions/:version/requirements-url', requireAuth, updateRequirementsUrl)


export default router;