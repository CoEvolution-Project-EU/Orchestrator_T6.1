// src/controllers/model.controller.js
import { Model } from '../models/models.model.js'
import { File } from '../models/file.model.js'
import { publishEvent } from '../config/kafka.js'

// ── Register a model ──────────────────────────────────────────
const registerModel = async (req, res) => {
  try {
    const { name, type, versioning ,model_paradigm, architecture_family, framework, input_modality } = req.body;

    if (!name || !type || !versioning) {
      return res.status(400).json({
        message: "name, type, versioning are required"
      });
    }

    const model = await Model.create({
      name,
      owner:      req.user.username, // from Keycloak token — never from body
      type,
      model_paradigm,
      architecture_family,
      framework,
      input_modality,
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

// ── Get all models - user models ────────────────────────────────────────────
const getAllModels = async (req, res) => {
  try {
    const { owner } = req.query
    const query = {}

    if (owner) query.owner = owner    // ← filter by owner if provided

    const models = await Model.find(query).sort({ createdAt: -1 })
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


const getReports = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { type } = req.query

    if (!type) return res.status(400).json({ message: 'type is required (risk, assessment, defence, gadgets, aimodelinfo, euaiact, datasets, aimbom, user-assessment, user-defence)' })

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    const fieldMap = {
      'requirements':    'requirements', 
      'risk':            'risk_assessment_reports',
      'assessment':      'assessments',
      'defence':         'defences',
      'gadgets':         'gadgets_reports',
      'aimodelinfo':     'aimodelinfo_reports',
      'euaiact':         'euaiact_reports',
      'datasets':        'datasets_reports',
      'aimbom':          'ai_mbom',
      'user-assessment': 'user_assessments',
      'user-defence':    'user_defences',
    }

    const field = fieldMap[type]
    if (!field) return res.status(400).json({ message: `Unknown type: ${type}.` })

    const fileIds = v[field]

    if (!fileIds || fileIds.length === 0) {
      return res.status(200).json({
        model_name: model.name,    // ← add
        model_uuid: uuid,          // ← add
        version,                   // ← add
        type,
        count: 0,
        files: []
      })
    }

    const files = await File.find({ _id: { $in: fileIds } })

    const enriched = files.map(f => ({
      ...f.toObject(),
      download_url: `https://aegis.coevolution-project.eu/api/v1/files/download/${f._id}`
    }))

    res.status(200).json({
      model_name: model.name,    // ← add
      model_uuid: uuid,          // ← add
      version,                   // ← add
      type,
      count:      enriched.length,
      files:      enriched,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// GET /api/v1/models/reports?type=aimbom&owner=coevolution_user
// GET /api/v1/models/reports?type=risk&uuid=550e8400-...&version=v1.0
const getReportsAll = async (req, res) => {
  try {
    const { type, uuid, version, owner } = req.query

    if (!type) return res.status(400).json({ message: 'type is required' })

    const fieldMap = {
      'requirements':    'requirements',
      'trusted-model':   'trusted_model',
      'risk':            'risk_assessment_reports',
      'assessment':      'assessments',
      'defence':         'defences',
      'gadgets':         'gadgets_reports',
      'aimodelinfo':     'aimodelinfo_reports',
      'euaiact':         'euaiact_reports',
      'datasets':        'datasets_reports',
      'aimbom':          'ai_mbom',
      'user-assessment': 'user_assessments',
      'user-defence':    'user_defences',
    }

    const field = fieldMap[type]
    if (!field) return res.status(400).json({ message: `Unknown type: ${type}` })

    // Build model query
    const modelQuery = {}
    if (uuid)  modelQuery.model_uuid = uuid
    if (owner) modelQuery.owner      = owner

    const models = await Model.find(modelQuery).sort({ createdAt: -1 })

    const result = []

    for (const model of models) {
      for (const v of model.versioning) {

        // Filter by version if provided
        if (version && v.version !== version) continue

        const fileIds = v[field]
        if (!fileIds || fileIds.length === 0) continue

        const files = await File.find({ _id: { $in: fileIds } })

        const enriched = files.map(f => ({
          ...f.toObject(),
          download_url: `https://aegis.coevolution-project.eu/api/v1/files/download/${f._id}`
        }))

        result.push({
          model_name: model.name,
          model_uuid: model.model_uuid,
          owner:      model.owner,
          version:    v.version,
          type,
          count:      enriched.length,
          files:      enriched,
        })
      }
    }

    res.status(200).json({
      total:   result.length,
      reports: result,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// POST /api/v1/models/:uuid/versions/:version/aimbom
const generateAIMBOM = async (req, res) => {
  try {
    const { uuid, version } = req.params

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    // Helper — get latest file from a versioning array
    const getLatest = async (fileIds) => {
      if (!fileIds || fileIds.length === 0) return null
      const files = await File.find({ _id: { $in: fileIds } }).sort({ createdAt: -1 })
      return files[0] || null
    }

    // Get latest file for each report type from model versioning arrays
    const latestRisk        = await getLatest(v.risk_assessment_reports)
    const latestAssessment  = await getLatest(v.assessments)
    const latestDefence     = await getLatest(v.defences)
    const latestGadgets     = await getLatest(v.gadgets_reports)
    const latestAiModelInfo = await getLatest(v.aimodelinfo_reports)
    const latestEuAiAct     = await getLatest(v.euaiact_reports)
    const latestDatasets    = await getLatest(v.datasets_reports)

    // Check at least one report exists
    if (!latestRisk && !latestAssessment && !latestDefence &&
        !latestGadgets && !latestAiModelInfo && !latestEuAiAct && !latestDatasets) {
      return res.status(404).json({
        message: 'No reports found for this model version.'
      })
    }

    // Build file info helper
    const buildFileInfo = (doc) => {
      if (!doc) return null
      return {
        _id:          doc._id,
        bucket:       doc.bucket,
        filename:     doc.filename,
        download_url: `https://aegis.coevolution-project.eu/api/v1/files/download/${doc._id}`,
        createdAt:    doc.createdAt,
      }
    }

    const reports = {
      risk_report:        buildFileInfo(latestRisk),
      assessment_report:  buildFileInfo(latestAssessment),
      defence_report:     buildFileInfo(latestDefence),
      gadgets_report:     buildFileInfo(latestGadgets),
      aimodelinfo_report: buildFileInfo(latestAiModelInfo),
      euaiact_report:     buildFileInfo(latestEuAiAct),
      datasets_report:    buildFileInfo(latestDatasets),
    }

    // Publish to Kafka topic: strae
    await publishEvent('strae', {
      event:       'aimbom-requested',
      model_name:  model.name,
      model_uuid:  uuid,
      version,
      requestedBy: req.user?.username || 'backend',
      requestedAt: new Date().toISOString(),
      reports,
    })

    console.log(`[Kafka] AI-MBOM requested for model ${model.name} version ${version}`)

    res.status(200).json({
      message:    'AI-MBOM generation requested',
      model_uuid: uuid,
      version,
      reports,
    })
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
  getReports,
  getReportsAll,
  generateAIMBOM
}