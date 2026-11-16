// src/controllers/model.controller.js
import mongoose from 'mongoose'
import { Model } from '../models/models.model.js'
import { File } from '../models/file.model.js'
import { Aimbom } from '../models/aimbom.model.js'
import { publishEvent } from '../config/kafka.js'
import { removeFiles } from '../utils/fileCleanup.js'


const DECOMMISSION_ROLE = 'aimbom-revoker'   // Keycloak realm role held only by SRME
const ADMIN_ROLE = 'administrator'   // Keycloak realm role: may delete any model

// ── Report type → versioning array (shared by getReports + getReportsAll) ─
const REPORT_FIELDS = {
  'requirements':            'requirements',
  'trusted-model':           'trusted_model',
  'risk':                    'risk_assessment_reports',
  'assessment':              'assessments',
  'defence':                 'defences',
  'gadgets':                 'gadgets_reports',
  'aimodelinfo':             'aimodelinfo_reports',
  'euaiact':                 'euaiact_reports',
  'datasets':                'datasets_reports',
  'aimbom':                  'ai_mbom',
  'vulnerability':           'vulnerability_reports',
  'user-assessment':         'user_assessments',
  'user-defence':            'user_defences',
  'user-euaiact':            'user_euaiact',                     // NEW

  // pending: unsigned originals (history)
  'risk-pending':            'risk_assessment_reports_pending',
  'assessment-pending':      'assessments_pending',
  'defence-pending':         'defences_pending',
  'gadgets-pending':         'gadgets_reports_pending',
  'aimodelinfo-pending':     'aimodelinfo_reports_pending',
  'euaiact-pending':         'euaiact_reports_pending',
  'datasets-pending':        'datasets_reports_pending',
  'user-assessment-pending': 'user_assessments_pending',
  'user-defence-pending':    'user_defences_pending',
  'user-euaiact-pending':    'user_euaiact_pending',
}

// ── Latest-report set: response key → final (signed) versioning array ─
const LATEST_REPORTS = {
  risk_report:        'risk_assessment_reports',
  assessment_report:  'assessments',
  defence_report:     'defences',
  gadgets_report:     'gadgets_reports',
  aimodelinfo_report: 'aimodelinfo_reports',
  euaiact_report:     'euaiact_reports',
  datasets_report:    'datasets_reports',
  aimbom_report:      'ai_mbom',
}

// ── AIMBOM update rules ───────────────────────────────────────
// Reports allowed to change for a new AIMBOM version (anything else → new model version)
const UPDATE_TYPES  = ['assessment_report', 'risk_report', 'gadgets_report']
// Reports that can START a new AIMBOM version
const TRIGGER_TYPES = ['assessment_report', 'gadgets_report']

// Latest file (by createdAt) from a versioning array, or null
const getLatest = async (fileIds) => {
  if (!fileIds || fileIds.length === 0) return null
  const files = await File.find({ _id: { $in: fileIds } }).sort({ createdAt: -1 }).limit(1)
  return files[0] || null
}

// Only the fields a caller needs
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

// Load the 7 source files + the AIMBOM file of an AIMBOM record (ONE query)
// Returns the same keys as sources, plus aimbom_report
const loadAimbomFiles = async (aimbom) => {
  const ids   = [...Object.values(aimbom.sources), aimbom.aimbom_file_id].filter(Boolean)
  const files = await File.find({ _id: { $in: ids } })
  const byId  = new Map(files.map(f => [f._id.toString(), f]))

  const reports = {}
  for (const [key, id] of Object.entries(aimbom.sources)) {
    reports[key] = buildFileInfo(byId.get(id.toString()))
  }
  reports.aimbom_report = buildFileInfo(byId.get(aimbom.aimbom_file_id?.toString()))
  return reports
}

// Create a pending AIMBOM record.
// Returns null if this model version already has a pending one.
const createPendingAimbom = async (data) => {
  try {
    return await Aimbom.create(data)
  } catch (error) {
    if (error.code === 11000) return null   // duplicate key → the partial unique index said "already pending"
    throw error                             // any other error → let the controller's catch handle it
  }
}

// Owner of the model, or a hub admin
const canDelete = (req, model) =>
  req.user?.username === model.owner || req.user?.roles?.includes(ADMIN_ROLE)

// Every file ID stored in ANY array of this version (final, pending, user, AIMBOM, trusted model...)
const collectVersionFileIds = (v) => {
  const fields = [...new Set(Object.values(REPORT_FIELDS))]
  return fields.flatMap(field => v[field] || [])
}

// Delete everything of one version. Does NOT remove the version entry itself.
const deleteVersionData = async (uuid, v) => {
  // 1. Files: MinIO + File documents
  const { deleted, failed } = await removeFiles(collectVersionFileIds(v))
  if (failed.length > 0) return { ok: false, deleted, failed }   // stop: keep the index for a retry

  // 2. AIMBOM lifecycle records of this version
  const { deletedCount } = await Aimbom.deleteMany({ model_uuid: uuid, version: v.version })

  return { ok: true, files_deleted: deleted, aimboms_deleted: deletedCount }
}

// ── Register a model ──────────────────────────────────────────
const registerModel = async (req, res) => {
  try {
    const { name, type, versioning ,model_paradigm, architecture_family, framework, input_modality } = req.body;

    if (!name || !type || !versioning) {
      return res.status(400).json({
        message: "name, type, versioning are required"
      });
    }

    const hardcodedUUIDs = {
      'automotive_model_P2': 'd1054483-3d4a-43c0-a181-d7ecff862b2d',
    }

    const model = await Model.create({
      name,
      owner:      req.user.username, // from Keycloak token — never from body
      type,
      model_paradigm,
      architecture_family,
      framework,
      input_modality,
      versioning,
      // use hardcoded UUID if name matches, otherwise auto-generate
      ...(hardcodedUUIDs[name] && { model_uuid: hardcodedUUIDs[name] }),
    })

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

// // ── Update security data (orchestrator) ──────────────────────
// const updateSecurityData = async (req, res) => {
//   try {
//     const {  defences, assessments, risk_assessment_reports, trusted } = req.body
//     const { uuid, version } = req.params

//     const model = await Model.findOne({ model_uuid: uuid })
//     if (!model) return res.status(404).json({ message: 'Model not found' })

//     const v = model.versioning.find(v => v.version === version)
//     if (!v) return res.status(404).json({ message: 'Version not found' })

//     if (defences)                 v.defences                = defences
//     if (assessments)              v.assessments             = assessments
//     if (risk_assessment_reports)  v.risk_assessment_reports = risk_assessment_reports
//     if (trusted !== undefined)    v.trusted                 = trusted

//     await model.save()
//     res.status(200).json({ message: 'Security data updated', model })
//   } catch (error) {
//     res.status(500).json({ message: 'Server error', error })
//   }
// }


const getReports = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { type } = req.query

    if (!type) return res.status(400).json({
      message: `type is required (${Object.keys(REPORT_FIELDS).join(', ')})`
    })
    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    
    const field = REPORT_FIELDS[type]

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

    const field = REPORT_FIELDS[type]


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


    // Get latest file for each report type from model versioning arrays
    const latestRisk        = await getLatest(v.risk_assessment_reports)
    const latestAssessment  = await getLatest(v.assessments)
    const latestDefence     = await getLatest(v.defences)
    const latestGadgets     = await getLatest(v.gadgets_reports)
    const latestAiModelInfo = await getLatest(v.aimodelinfo_reports)
    const latestEuAiAct     = await getLatest(v.euaiact_reports)
    const latestDatasets    = await getLatest(v.datasets_reports)
    const latestAimbom    = await getLatest(v.ai_mbom)  // when we call again STRAE

    const reports = {
      risk_report:        buildFileInfo(latestRisk),
      assessment_report:  buildFileInfo(latestAssessment),
      defence_report:     buildFileInfo(latestDefence),
      gadgets_report:     buildFileInfo(latestGadgets),
      aimodelinfo_report: buildFileInfo(latestAiModelInfo),
      euaiact_report:     buildFileInfo(latestEuAiAct),
      datasets_report:    buildFileInfo(latestDatasets),
      aimbom_report:      buildFileInfo(latestAimbom)
    }
    
    // ── STEP 1: all 7 reports are required ───────────────────
    const required = {
      risk_report:        latestRisk,
      assessment_report:  latestAssessment,
      defence_report:     latestDefence,
      gadgets_report:     latestGadgets,
      aimodelinfo_report: latestAiModelInfo,
      euaiact_report:     latestEuAiAct,
      datasets_report:    latestDatasets,
    }

    // keep only the names whose value is null → the missing ones
    const missing = Object.keys(required).filter(key => !required[key])


    // Check at least one report exists
    if (missing.length > 0) {
        return res.status(404).json({
        message: 'Cannot generate AI-MBOM: required reports are missing',
        missing,  // e.g. ["defence_report", "gadgets_report"]
      })
    }

    // The 7 report IDs this AIMBOM will be built from
    const sources = {}
    for (const [key, doc] of Object.entries(required)) {
      sources[key] = doc._id.toString()
    }


    // ── First time → full generation ─────────────────────────
    if (!latestAimbom) {
      const aimbom = await createPendingAimbom({
        model_uuid:  uuid,
        version,
        event:       'aimbom-requested',
        sources,
        requestedBy: req.user?.username || 'backend',
      })
      if (!aimbom) {
        return res.status(409).json({ message: 'An AI-MBOM generation is already in progress for this model version' })
      }

      try {
        await publishEvent('strae', {
          event:       'aimbom-requested',
          model_name:  model.name,
          model_uuid:  uuid,
          version,
          requestedBy: req.user?.username || 'backend',
          requestedAt: new Date().toISOString(),
          reports,
        })
      } catch (kafkaError) {
        aimbom.status = 'cancelled'      // STRAE never got the request → don't block future ones
        await aimbom.save()
        throw kafkaError
      }

      console.log(`[Kafka] AI-MBOM requested for model ${model.name} version ${version}`)

      return res.status(200).json({
        message:    'AI-MBOM generation requested',
        aimbom_id:  aimbom.aimbom_id,
        model_uuid: uuid,
        version,
        reports,
      })
    }

    // ── STEP 2: reports newer than the current AIMBOM ────────
    const lastAimbomTime = latestAimbom.createdAt
    const changedReports = {}
    
    for (const [key, file] of Object.entries(reports)) {
      if (key === 'aimbom_report') continue            // never compare the AIMBOM with itself
      if (file && file.createdAt > lastAimbomTime) {   // strictly newer
        changedReports[key] = file
      }
    }
    // ── STEP 3: nothing new → publish nothing ────────────────
    if (Object.keys(changedReports).length === 0) {
      return res.status(200).json({
        message:       'AI-MBOM is already up to date — no newer reports',
        up_to_date:    true,
        model_uuid:    uuid,
        version,
        aimbom_report: reports.aimbom_report,
      })
    }
    
    // ── STEP 3b: only assessment, risk and gadgets may change for a new AIMBOM version ─
    // Any other report changing means the MODEL changed → it needs a new model version
    const changedTypes = Object.keys(changedReports)
    const otherChanges = changedTypes.filter(type => !UPDATE_TYPES.includes(type))

    if (otherChanges.length > 0) {
      return res.status(409).json({
        message: 'These reports changed after the current AI-MBOM, which means the model changed. Register a new model version and generate its AI-MBOM there.',
        changed: otherChanges,          // e.g. ["defence_report", "datasets_report"]
      })
    }

    // ── STEP 3c: something must START the update: a new assessment or a new gadgets report ─
    const triggers = changedTypes.filter(type => TRIGGER_TYPES.includes(type))

    if (triggers.length === 0) {
      return res.status(409).json({
        message: 'A new AI-MBOM version requires a new assessment or gadgets report.',
        changed: changedTypes,
      })
    }

    // ── STEP 3d: a new assessment needs its updated risk report (gadgets does not) ─
    if (changedReports.assessment_report && !changedReports.risk_report) {
      return res.status(409).json({
        message: 'New assessment found, but the updated risk report is not available yet. Wait for RAGRE (and STRAE signing), then try again.',
        changed: changedTypes,
      })
    }

    // ── STEP 4: STRAE needs the existing AIMBOM (same message as before) ─
    const aimbom = await createPendingAimbom({
      model_uuid:  uuid,
      version,
      event:       'updated-aimbom-requested',
      sources,                                   // still the FULL set of 7
      requestedBy: req.user?.username || 'backend',
    })
    if (!aimbom) {
      return res.status(409).json({ message: 'An AI-MBOM generation is already in progress for this model version' })
    }

    changedReports.aimbom_report = reports.aimbom_report

    try {
      await publishEvent('strae', {
        event:       'updated-aimbom-requested',
        model_name:  model.name,
        model_uuid:  uuid,
        version,
        requestedBy: req.user?.username || 'backend',
        requestedAt: new Date().toISOString(),
        changedReports,
      })
    } catch (kafkaError) {
      aimbom.status = 'cancelled'
      await aimbom.save()
      throw kafkaError
    }

    console.log(`[Kafka] update AI-MBOM requested for model ${model.name} version ${version}`)

    res.status(200).json({
      message:    'update AI-MBOM generation requested',
      aimbom_id:  aimbom.aimbom_id,
      model_uuid: uuid,
      version,
      changedReports,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// POST /api/v1/models/:uuid/versions/:version/aimbom/cancel
// Releases a stuck pending AIMBOM (e.g. STRAE failed) so a new one can be requested
const cancelAIMBOM = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { reason } = req.body || {}

    // Find the pending AIMBOM AND cancel it in one atomic operation
    const aimbom = await Aimbom.findOneAndUpdate(
      { model_uuid: uuid, version, status: 'pending' },     // only if it is still pending
      {
        $set: {
          status:       'cancelled',
          cancelledAt:  new Date(),
          cancelledBy:  req.user?.username || 'backend',
          cancelReason: reason || null,
        },
      },
      { returnDocument: 'after' }                           // return the updated document
    )

    if (!aimbom) {
      return res.status(404).json({
        message: `No pending AI-MBOM for model ${uuid} version ${version}`
      })
    }

    res.status(200).json({
      message: 'Pending AI-MBOM cancelled — a new generation can now be requested',
      aimbom,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}


// GET /api/v1/models/:uuid/versions/:version/aimbom
// The valid (completed) AIMBOM + the exact reports it was generated from
const getAIMBOM = async (req, res) => {
  try {
    const { uuid, version } = req.params

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    // 1. The valid AIMBOM of this version
    const aimbom = await Aimbom.findOne({ model_uuid: uuid, version, status: 'completed' })
      .sort({ completedAt: -1 })
      .lean()

    if (!aimbom) {
      return res.status(404).json({ message: `No valid AI-MBOM for model ${uuid} version ${version}` })
    }

    // 2. Load the 7 sources + the AIMBOM file in ONE query
    const ids   = [...Object.values(aimbom.sources), aimbom.aimbom_file_id].filter(Boolean)
    const files = await File.find({ _id: { $in: ids } })
    const byId  = new Map(files.map(f => [f._id.toString(), f]))

    // 3. Same response keys as before
    const reports = {}
    for (const [key, id] of Object.entries(aimbom.sources)) {
      reports[key] = buildFileInfo(byId.get(id.toString()))
    }
    reports.aimbom_report = buildFileInfo(byId.get(aimbom.aimbom_file_id?.toString()))

    const missing = Object.keys(reports)
      .filter(key => key !== 'aimbom_report' && !reports[key])

    res.status(200).json({
      model_name: model.name,
      model_uuid: uuid,
      version,
      trusted:    v.trusted,
      reports,
      missing,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// GET /api/v1/models/aimboms/file/:file_id
// The AIMBOM record behind an AIMBOM file: lifecycle, status, sources
const getAIMBOMByFileId = async (req, res) => {
  try {
    const { file_id } = req.params

    if (!mongoose.isValidObjectId(file_id)) {
      return res.status(400).json({ message: 'file_id is not a valid file ID' })
    }

    const aimbom = await Aimbom.findOne({ aimbom_file_id: file_id })
      .select('-_id -__v')
      .lean()

    if (!aimbom) return res.status(404).json({ message: 'No AI-MBOM record for this file' })

    const files = await loadAimbomFiles(aimbom)
    const { aimbom_report, ...sources } = files

    res.status(200).json({
      ...aimbom,
      sources,
      aimbom_file: aimbom_report,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}


// POST /api/v1/models/:uuid/versions/:version/aimbom/decommission
// SRME marks the valid AIMBOM of a model version as no longer valid
const decommissionAIMBOM = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { reason } = req.body || {}

    // 1. Only SRME may decommission
    if (!req.user?.roles?.includes(DECOMMISSION_ROLE)) {
      return res.status(403).json({ message: 'Only SRME can decommission an AI-MBOM' })
    }

    // 2. Find the valid (completed) AIMBOM AND decommission it — one atomic operation
    const aimbom = await Aimbom.findOneAndUpdate(
      { model_uuid: uuid, version, status: 'completed' },
      {
        $set: {
          status:             'decommissioned',
          decommissionedAt:   new Date(),
          decommissionedBy:   req.user?.username || 'backend',
          decommissionReason: reason || null,
        },
      },
      { returnDocument: 'after' }
    )

    // 3. Nothing valid found
    if (!aimbom) {
      // Already decommissioned? → answer OK, so an SRME retry is harmless
      const already = await Aimbom.findOne({ model_uuid: uuid, version, status: 'decommissioned' })
        .sort({ decommissionedAt: -1 })
      if (already) {
        return res.status(200).json({ message: 'AI-MBOM already decommissioned', aimbom: already })
      }
      return res.status(404).json({ message: `No valid AI-MBOM for model ${uuid} version ${version}` })
    }

    res.status(200).json({
      message: 'AI-MBOM decommissioned — a reassessment is required',
      aimbom,
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// DELETE /api/v1/models/:uuid/versions/:version?force=true
// Deletes a version and EVERYTHING that belongs to it
const deleteVersion = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const force = req.query.force === 'true'

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    // 1. Only the owner or a hub admin
    if (!canDelete(req, model)) {
      return res.status(403).json({ message: 'Only the model owner or an admin can delete this version' })
    }

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    // 2. A trusted version needs an explicit force=true
    if (v.trusted && !force) {
      return res.status(409).json({
        message: 'This version is trusted. Its evidence and AI-MBOM will be lost. Repeat with ?force=true to confirm.',
      })
    }

    // 3. Files + AIMBOM records
    const result = await deleteVersionData(uuid, v)
    if (!result.ok) {
      return res.status(500).json({
        message: 'Some files could not be deleted. The version was kept, so repeat the request to retry.',
        files_deleted: result.deleted,
        failed:        result.failed,
      })
    }

    // 4. LAST: remove the version entry itself (atomic)
    await Model.updateOne({ model_uuid: uuid }, { $pull: { versioning: { version } } })

    res.status(200).json({
      message:         `Version ${version} of model ${uuid} deleted`,
      files_deleted:   result.files_deleted,
      aimboms_deleted: result.aimboms_deleted,
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
  // updateSecurityData,
  getReports,
  getReportsAll,
  generateAIMBOM,
  getAIMBOM,
  cancelAIMBOM,
  decommissionAIMBOM,
  deleteVersion,
  getAIMBOMByFileId
}




// 0
// "6a5f54f244211ea5d45be601"
// 1
// "6a5f54f244211ea5d45be60b"
// 2
// "6a5f54f344211ea5d45be615"

// 3
// 6a33b724740b63cfaca18f21