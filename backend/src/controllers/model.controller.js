import  { Model } from '../models/models.model.js';
import { getPool } from '../config/minio.js'

// Register a model 

const registerModel = async (req, res) => {
    try {
        const { name, type, versioning} = req.body;

        if ( !name || !type || ! versioning) {
            return res.status(400).json({
                message: "name, type, versioning are required"
            });
        }
        
        const model = await Model.create({ 
            name,
            owner: req.user.username,  // from Keycloak token — never from body
            type,
            versioning
        });
        res.status(201).json({
            message: "Model has been registered",
            model
        });
        }
     catch (error) {
        res.status(500).json({
            message: "Server error", error
        });
    }
}
// ── Get all models ────────────────────────────────────────────
// GET /api/v1/models
const getAllModels = async (req, res) => {
    try {
      const models = await Model.find().sort({ createdAt: -1 })
      res.status(200).json({ count: models.length, models })
    } catch (error) {
      res.status(500).json({ message: 'Server error', error })
    }
  }
   
  // ── Get model by uuid ─────────────────────────────────────────
  // GET /api/v1/models/:uuid
  const getModelByUUID = async (req, res) => {
    try {
      const model = await Model.findOne({ model_uuid: req.params.uuid })
      if (!model) return res.status(404).json({ message: 'Model not found' })
      res.status(200).json({ model })
    } catch (error) {
      res.status(500).json({ message: 'Server error', error })
    }
  }

// POST /api/v1/models/:uuid/versions/:version/requirements
// Body: multipart/form-data with field "file"
const uploadRequirements = async (req, res) => {
    try {
      const { uuid, version } = req.params
      const file = req.file   // from multer
  
      if (!file) return res.status(400).json({ message: 'File is required' })
  
      const model = await Model.findOne({ model_uuid: uuid })
      if (!model) return res.status(404).json({ message: 'Model not found' })
  
      const v = model.versioning.find(v => v.version === version)
      if (!v) return res.status(404).json({ message: 'Version not found' })
  
      // Upload to MinIO TRP pool, trusted-data bucket
      const objectKey = `${uuid}-${version}-${file.originalname}`
      const minioClient = getPool('TRP')
      await minioClient.putObject(
        'trusted-data',
        objectKey,
        file.buffer,
        file.size,
        { 'Content-Type': 'text/plain' }
      )
  
      // Save filename and URL to MongoDB
      v.requirements_file = file.originalname
      v.requirements_url = `https://aegis.coevolution-project.eu/api/v1/files/download/${doc._id}`
      await model.save()
  
      res.status(200).json({
        message: 'Requirements file uploaded',
        requirements_file: v.requirements_file,
        requirements_url:  v.requirements_url,
      })
    } catch (error) {
      res.status(500).json({ message: 'Server error', error: error.message })
    }
  }


// ── Update requirements URL (orchestrator) ────────────────────
const updateRequirementsUrl = async (req, res) => {
    try {
      const { url } = req.body
      const { uuid, version } = req.params
   
      const model = await Model.findOne({ model_uuid: uuid })
      if (!model) return res.status(404).json({ message: 'Model not found' })
   
      const v = model.versioning.find(v => v.version === version)
      if (!v) return res.status(404).json({ message: 'Version not found' })
   
      v.requirements_url = url
      await model.save()
      res.status(200).json({ message: 'Requirements URL updated', model })
    } catch (error) {
      res.status(500).json({ message: 'Server error', error })
    }
  }
// ── Update security data (orchestrator) ──────────────────────
const updateSecurityData = async (req, res) => {
    try {
      const { attacks, defences, assessments, risk_assessment_reports, trusted } = req.body
      const { uuid, version } = req.params
   
      const model = await Model.findOne({ model_uuid: uuid })
      if (!model) return res.status(404).json({ message: 'Model not found' })
   
      const v = model.versioning.find(v => v.version === version)
      if (!v) return res.status(404).json({ message: 'Version not found' })
   
      if (attacks)                  v.attacks = attacks
      if (defences)                 v.defences = defences
      if (assessments)              v.assessments = assessments
      if (risk_assessment_reports)  v.risk_assessment_reports = risk_assessment_reports
      if (trusted !== undefined)    v.trusted = trusted
   
      await model.save()
      res.status(200).json({ message: 'Security data updated', model })
    } catch (error) {
      res.status(500).json({ message: 'Server error', error })
    }
  }
// ── Add a new version ─────────────────────────────────────────
const addVersion = async (req, res) => {
    try {
      const { version, description, trusted } = req.body
   
      const model = await Model.findOne({ model_uuid: req.params.uuid })
      if (!model) return res.status(404).json({ message: 'Model not found' })
   
      model.versioning.push({ version, description, trusted: trusted || false })
      await model.save()
      res.status(201).json({ message: 'Version added', model })
    } catch (error) {
      res.status(500).json({ message: 'Server error', error })
    }
  }
export {
    registerModel,
    getAllModels,
    getModelByUUID,
    uploadRequirements,
    updateRequirementsUrl,
    updateSecurityData,
    addVersion

};