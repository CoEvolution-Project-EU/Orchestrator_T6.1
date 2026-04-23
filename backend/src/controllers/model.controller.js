// src/controllers/model.controller.js
import { Model } from '../models/models.model.js';
import { getPool } from '../config/minio.js'
import { File } from '../models/file.model.js' 
import { producer } from '../config/kafka.js'

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

// ── Upload requirements file ──────────────────────────────────
// POST /api/v1/models/:uuid/versions/:version/requirements
// Stores file in MinIO TRP pool / trusted-data bucket
// Object key format: uuid-version-filename.ext
const uploadRequirements = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { pool, bucket } = req.body
    const file = req.file

    if (!file)   return res.status(400).json({ message: 'File is required' })
    if (!pool)   return res.status(400).json({ message: 'pool is required' })
    if (!bucket) return res.status(400).json({ message: 'bucket is required' })

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v) return res.status(404).json({ message: 'Version not found' })

    const objectKey   = `${uuid}-${version}-${file.originalname}`
    const minioClient = getPool(pool)
    if (!minioClient) return res.status(400).json({ message: `Unknown pool: ${pool}` })

    // Make sure bucket exists
    const exists = await minioClient.bucketExists(bucket)
    if (!exists) return res.status(404).json({ 
      message: `Bucket "${bucket}" does not exist in pool "${pool}"` 
    })
    // Upload to whichever pool/bucket the user passed
    await minioClient.putObject(
      bucket,
      objectKey,
      file.buffer,
      file.size,
      { 'Content-Type': file.mimetype || 'application/octet-stream' }
    )

        // Save to files collection in MongoDB ← add this block
    await File.create({
      pool,
      bucket,
      objectKey,
      filename:    file.originalname,
      size:        file.size,
      contentType: file.mimetype || 'application/octet-stream',
      modelName:   model.name,           // link to the model name
      uploadedBy:  req.user?.username || 'backend',
      tags:        [`model:${uuid}`, `version:${version}`],  // tag with model and version
    })

    // Update model versioning with file info
    v.requirements_file = file.originalname
    // When uploading — encode pool and bucket in the URL
    v.requirements_url = `https://aegis.coevolution-project.eu/api/v1/models/${uuid}/versions/${version}/requirements/download?pool=${pool}&bucket=${bucket}`   
    await model.save()

    res.status(200).json({
      message:           'Requirements file uploaded',
      requirements_file: v.requirements_file,
      requirements_url:  v.requirements_url,
      object_key:        objectKey,
      pool,
      bucket,
    })

        // Notify partner via Kafka
    await producer.send({
      topic: 'requirements-uploaded',
      messages: [{
        value: JSON.stringify({
          event:            'requirements-uploaded',
          modelName:        model.name,
          modelUuid:        uuid,
          owner:            model.owner,
          version:          version,
          requirements_file: file.originalname,
          requirements_url:  v.requirements_url,
          pool:             pool,
          bucket:           bucket,
          uploadedAt:       new Date().toISOString(),
        })
      }]
    })

    console.log(`[Kafka] Event published: requirements-uploaded for model ${model.name}`)
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

// ── Download requirements file ────────────────────────────────
// GET /api/v1/models/:uuid/versions/:version/requirements/download
const downloadRequirements = async (req, res) => {
  try {
    const { uuid, version } = req.params
    const { pool, bucket }  = req.query   // ← from URL query params

    if (!pool)  return res.status(400).json({ message: 'pool is required' })
    if (!bucket) return res.status(400).json({ message: 'bucket is required' })

    const model = await Model.findOne({ model_uuid: uuid })
    if (!model) return res.status(404).json({ message: 'Model not found' })

    const v = model.versioning.find(v => v.version === version)
    if (!v)                   return res.status(404).json({ message: 'Version not found' })
    if (!v.requirements_file) return res.status(404).json({ message: 'No requirements file' })

    const objectKey   = `${uuid}-${version}-${v.requirements_file}`
    const minioClient = getPool(pool)
    if (!minioClient) return res.status(400).json({ message: `Unknown pool: ${pool}` })

    const stream = await minioClient.getObject(bucket, objectKey)

    res.setHeader('Content-Disposition', `attachment; filename="${v.requirements_file}"`)
    res.setHeader('Content-Type', 'application/octet-stream')
    stream.pipe(res)
  } catch (error) {
    res.status(500).json({ message: 'Download failed', error: error.message })
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

    if (attacks)                  v.attacks                 = attacks
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

export {
  registerModel,
  getAllModels,
  getModelByUUID,
  addVersion,
  uploadRequirements,
  downloadRequirements,
  updateRequirementsUrl,
  updateSecurityData,
}