// src/controllers/model.controller.js
import { Model } from '../models/models.model.js'
import { File } from '../models/file.model.js'

// ── Register a model ──────────────────────────────────────────
const registerModel = async (req, res) => {
  try {
    const { name, type, versioning } = req.body;

    if (!name || !type || !versioning) {
      return res.status(400).json({
        message: "name, type, versioning are required"
      });
    }

    const model = await Model.create({
      name,
      owner:      req.user.username, // from Keycloak token — never from body
      type,
      versioning
    });

    res.status(201).json({
      message: "Model has been registered",
      model
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
}

// ── Get all models ────────────────────────────────────────────
const getAllModels = async (req, res) => {
  try {
    const models = await Model.find().sort({ createdAt: -1 })
    res.status(200).json({ count: models.length, models })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error })
  }
}

// ── Get model by uuid ─────────────────────────────────────────
const getModelByUUID = async (req, res) => {
  try {
    const model = await Model.findOne({ model_uuid: req.params.uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })
    res.status(200).json({ model })
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
    const {  defences, assessments, risk_assessment_reports, trusted } = req.body
    const { uuid, version } = req.params

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    if (defences)                 v.defences                = defences
    if (assessments)              v.assessments             = assessments
    if (risk_assessment_reports)  v.risk_assessment_reports = risk_assessment_reports
    if (trusted !== undefined)    v.trusted                 = trusted

    await model.save()
    res.status(200).json({ message: 'Security data updated', model })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error })
  }
}


// GET /api/v1/models/:uuid/versions/:version/reports?type=risk
const getReports = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { type } = req.query

    if (!type) return res.status(400).json({ message: 'type is required (risk, assessment, defence)' })

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    // Map type to schema field
    const fieldMap = {
      'risk':       'risk_assessment_reports',
      'assessment': 'assessments',
      'defence':    'defences',
    }

    const field = fieldMap[type]
    if (!field) return res.status(400).json({ message: `Unknown type: ${type}. Use risk, assessment or defence` })

    const fileIds = v[field]   // array of MongoDB file IDs

    if (!fileIds || fileIds.length === 0) {
      return res.status(200).json({ count: 0, files: [] })
    }

    // Fetch the actual file documents from files collection
    const files = await File.find({ _id: { $in: fileIds } })

    res.status(200).json({ count: files.length, files })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

export {
  registerModel,
  getAllModels,
  getModelByUUID,
  addVersion,
  updateRequirementsUrl,
  updateSecurityData,
  getReports
}