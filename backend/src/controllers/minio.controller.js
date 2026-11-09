// src/controllers/minio.controller.js
// Handles file operations for all MinIO pools

import { getPool } from '../config/minio.js'
import { File } from '../models/file.model.js'
import { Model } from '../models/models.model.js' 
import { Aimbom } from '../models/aimbom.model.js'
import { publishEvent } from '../config/kafka.js'
import mongoose from 'mongoose'
import path from 'path'
import fs from 'fs'

// ── STRAE signing settings ────────────────────────────────────
const SIGNER_ROLE    = 'report-signer'
const SIGN_TOPIC     = 'strae_sign_requests'
const PENDING_SUFFIX = '-pending'

// Final buckets that ONLY STRAE may write to (must match initMinIO RP list)
const SIGNED_REPORTS = [
  'user-assessments',
  'user-defences',
  'user-euaiact',
  'aimodelinfo-reports',
  'datasets-reports',
  'gadgets-reports',
  'risk-reports',
  'assessment-reports',
  'defence-reports',
  'euaiact-reports',
]

const toPending      = (bucket) => `${bucket}${PENDING_SUFFIX}`
const fromPending    = (bucket) => bucket.slice(0, -PENDING_SUFFIX.length)
const isSignedReport = (bucket) => SIGNED_REPORTS.includes(bucket)

// ── Auto-update model versioning for engine report buckets ─
const reportBuckets = {
  'model-requirements':  'requirements',
  'risk-reports':        'risk_assessment_reports',
  'assessment-reports':  'assessments',
  'defence-reports':     'defences',
  'gadgets-reports':     'gadgets_reports',
  'aimodelinfo-reports': 'aimodelinfo_reports',
  'euaiact-reports':     'euaiact_reports',
  'datasets-reports':    'datasets_reports',
  'ai-mbom':             'ai_mbom',
  'user-assessments':    'user_assessments',
  'user-defences':       'user_defences',
  'user-euaiact':        'user_euaiact',        
  'trusted-models':      'trusted_model',
}

// ── Bucket → Kafka topic ──────────────────────────────────────
const topicMap = {
  'model-requirements': 'ragre_models',
  'user-assessments':   'assessment_reports',
  'user-defences':      'defence_reports',
  'user-euaiact':       'euaiact_reports',
}

// ── Topic → where the receiving engine must upload its result ─
const resultBuckets = {
  'ragre_models':       'risk-reports-pending',
  'assessment_reports': 'assessment-reports-pending',
  'defence_reports':    'defence-reports-pending',
  'euaiact_reports':    'euaiact-reports-pending',
}

// ── Add every pending bucket to both tables ───────────────────
// e.g. risk-reports-pending → risk_assessment_reports_pending + strae_sign_requests
for (const bucket of SIGNED_REPORTS) {
  if (!reportBuckets[bucket]) {
    throw new Error(`[signing] No versioning field defined for signed bucket "${bucket}"`)
  }
  reportBuckets[toPending(bucket)] = `${reportBuckets[bucket]}_pending`
  topicMap[toPending(bucket)]      = SIGN_TOPIC
}

const getSafeName = async (filename, bucket, model_uuid, version) => {
  const ext  = path.extname(filename)
  const base = path.basename(filename, ext)

  // 1. Find the model
  const model = await Model.findOne({ model_uuid })
  if (!model) return filename

  // 2. Find the version
  const v = model.versioning.find(v => v.version === version)
  if (!v) return filename

  // 3. Get the correct array field for this bucket
  const field = reportBuckets[bucket]
  if (!field) return filename

  // 4. Get all file IDs already stored in this version's array
  const fileIds = v[field]
  if (!fileIds || fileIds.length === 0) return filename

  // 5. Fetch those files from MongoDB
  const existingFiles = await File.find({ _id: { $in: fileIds } })

  // 6. Check if any have the same base name
  const matches = existingFiles.filter(f =>
    f.filename === filename
  )
  if (matches.length === 0) return filename

  // 7. Generate next suffix
  const pad = String(matches.length).padStart(2, '0')
  return `${base}_${pad}${ext}`
}

    
const uploadFile = async (req, res) => {
  try {
    const { pool, bucket, model_uuid, version, tags , original_file_id } = req.body
    const files = req.files

    if (!files || files.length === 0)
      return res.status(400).json({ message: 'At least one file is required' })
    if (!pool || !bucket )
      return res.status(400).json({ message: 'pool, bucket are required' })

    // check data bucket FIRST
    const dataBuckets = ['trusted-data','siemens-data', 'avl-data', 'avi-data']
    const isDataFile = dataBuckets.includes(bucket)

    if (!isDataFile && (!model_uuid || !version)) {
      return res.status(400).json({
        message: `model_uuid and version are required for bucket "${bucket}"`
      })
    }

    // ── Signing guard ─────────────────────────────────────────
    // Final report buckets accept ONLY STRAE's signed copy of a pending original
    const isSigner = req.user?.roles?.includes(SIGNER_ROLE) || false
    let originalFileId

    if (isSignedReport(bucket)) {

      // 1. Only STRAE may write here
      if (!isSigner) {
        return res.status(403).json({
          message: `Unsigned reports must be uploaded to "${toPending(bucket)}". Only STRAE can write to "${bucket}".`
        })
      }

      // 2. A signed copy must say which original it signs
      if (!original_file_id || !mongoose.isValidObjectId(original_file_id)) {
        return res.status(400).json({ message: 'A valid original_file_id is required for signed uploads' })
      }

      // 3. One signed copy ↔ one original
      if (files.length !== 1) {
        return res.status(400).json({ message: 'Signed uploads must contain exactly one file' })
      }

      // 4. The original must be a pending report of THIS model version
      const model        = await Model.findOne({ model_uuid })
      const v            = model?.versioning.find(v => v.version === version)
      const pendingField = reportBuckets[toPending(bucket)]

      if (!v || !v[pendingField]?.includes(original_file_id)) {
        return res.status(400).json({
          message: `File ${original_file_id} is not a pending "${toPending(bucket)}" report of model ${model_uuid} version ${version}`
        })
      }

      // 5. An original can be signed only once
      if (await File.exists({ originalFileId: original_file_id })) {
        return res.status(409).json({ message: `File ${original_file_id} has already been signed` })
      }

      originalFileId = original_file_id
    }
    // ─────────────────────────────────────────────────────────

    // ── AIMBOM guard: only STRAE, and only for a pending AIMBOM ──
    let pendingAimbom = null

    if (bucket === 'ai-mbom') {
      // 1. Only STRAE may upload AIMBOMs
      if (!isSigner) {
        return res.status(403).json({ message: 'Only STRAE can upload AI-MBOMs' })
      }

      // 2. One AIMBOM file per request
      if (files.length !== 1) {
        return res.status(400).json({ message: 'Upload exactly one AI-MBOM file' })
      }

      // 3. There must be a pending AIMBOM for this model version
      pendingAimbom = await Aimbom.findOne({ model_uuid, version, status: 'pending' })
      if (!pendingAimbom) {
        return res.status(409).json({
          message: `No pending AI-MBOM request for model ${model_uuid} version ${version}`
        })
      }
    }

    const client = getPool(pool)
    if (!client) return res.status(400).json({ message: `Unknown pool: ${pool}` })

    const exists = await client.bucketExists(bucket)
    if (!exists) return res.status(404).json({
      message: `Bucket "${bucket}" does not exist in pool "${pool}"`
    })

    // Upload all files and collect MongoDB documents
    const uploadedDocs = []

    for (const file of files) {
      
      const objectKey = await getSafeName(file.originalname, bucket, model_uuid, version)
      const fileStream = fs.createReadStream(file.path)

      await client.putObject(
        bucket,
        objectKey,
        fileStream,
        file.size,
        { 'Content-Type': file.mimetype }
      )
      fs.unlink(file.path, (err) => {
        if (err) console.error(`Failed to delete temp file ${file.path}:`, err.message)
      })

      const doc = await File.create({
        pool,
        bucket,
        objectKey,
        filename:    file.originalname,
        size:        file.size,
        contentType: file.mimetype,
        uploadedBy:  req.user?.username || 'backend',
        tags:        tags ? tags.split(',').map(t => t.trim()) : [],
        originalFileId,                       // only set for STRAE's signed copy
      })

      uploadedDocs.push({
        ...doc.toObject(),
        download_url: `https://aegis.coevolution-project.eu/api/v1/files/download/${doc._id}`
      })
    }


    const fieldToUpdate = reportBuckets[bucket]
    if (fieldToUpdate) {
      const model = await Model.findOne({ model_uuid })
      if (model) {
        const v = model.versioning.find(v => v.version === version)
        if (v) {
          for (const doc of uploadedDocs) {
            v[fieldToUpdate].push(doc._id.toString())
          }
          await model.save()
        }
      }
    }
    
    if (bucket === 'trusted-models') {
      const model = await Model.findOne({ model_uuid })
      if (model) {
        const v = model.versioning.find(v => v.version === version)
        if (v) {
          v.trusted = true    // ← auto-set trusted
          await model.save()
        }
      }
    }

    // ── AIMBOM lifecycle: pending → completed, previous completed → deprecated ──
    if (pendingAimbom) {
      // 1. The new AIMBOM is now the valid one
      pendingAimbom.status         = 'completed'
      pendingAimbom.aimbom_file_id = uploadedDocs[0]._id.toString()
      pendingAimbom.completedAt    = new Date()
      await pendingAimbom.save()

      // 2. Every OTHER completed AIMBOM of this version is now deprecated
      await Aimbom.updateMany(
        {
          model_uuid,
          version,
          status:    'completed',
          aimbom_id: { $ne: pendingAimbom.aimbom_id },   // $ne = "not equal" → skip the new one
        },
        { $set: { status: 'deprecated' } }
      )
    }


    // ── Kafka topic map ───────────────────────────────────────

    const topic = topicMap[bucket]

    if (topic) {
      try {

        const modelDoc = await Model.findOne({ model_uuid }) 

        await publishEvent(topic, {
          event:       topic,
          model_name:  modelDoc?.name || null, 
          model_uuid,
          version,
          uploadedBy:  req.user?.username || 'backend',
          uploadedAt:  new Date().toISOString(),
          pool,                               // ← move pool to top level
          // tell STRAE where the signed copy must go
          ...(topic === SIGN_TOPIC
            ? { target_pool: 'RP', target_bucket: fromPending(bucket) }     // STRAE
            : resultBuckets[topic]
              ? { target_pool: 'RP', target_bucket: resultBuckets[topic] }  // engine
              : {}),
          tags:        tags ? tags.split(',').map(t => t.trim()) : [],  // ← move tags to top level
          total_files: uploadedDocs.length,
          files:       uploadedDocs.map(doc => ({   // ← only keep needed fields
            _id:          doc._id,
            bucket:       doc.bucket,
            filename:     doc.filename,
            download_url: doc.download_url,
          })),
        })
        console.log(`[Kafka] Event published: ${topic} — ${uploadedDocs.length} file(s)`)
      } catch (kafkaError) {
        console.log('Kafka publish failed:', kafkaError.message)
      }
    }

    res.status(201).json({
      message:     `${uploadedDocs.length} file(s) uploaded successfully`,
      total_files: uploadedDocs.length,
      files:       uploadedDocs,
    })
  } catch (error) {
    res.status(500).json({ message: 'Upload failed', error: error.message })
  } 
}




// ── Download a file ───────────────────────────────────────────
// GET /api/v1/files/download/:id
const downloadFile = async (req, res) => {
  try {
    const doc = await File.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'File not found' })

    const client = getPool(doc.pool)    // ← fix: was minioPools[doc.pool]
    const stream = await client.getObject(doc.bucket, doc.objectKey)

    res.setHeader('Content-Type', doc.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`)
    stream.pipe(res)
  } catch (error) {
    res.status(500).json({ message: 'Download failed', error: error.message })
  }
}

// ── Get presigned URL (temporary download link) ───────────────
// GET /api/v1/files/url/:id
const getPresignedUrl = async (req, res) => {
  try {
    const doc = await File.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'File not found' })

    const client = getPool(doc.pool)    // ← fix: was minioPools[doc.pool]
    const url = await client.presignedGetObject(doc.bucket, doc.objectKey, 3600)

    res.status(200).json({ url, expiresIn: '1 hour' })
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate URL', error: error.message })
  }
}

// ── Search files ──────────────────────────────────────────────
// GET /api/v1/files/search?modelName=gpt-4&pool=AP&uploadedBy=partner1
const searchFiles = async (req, res) => {
  try {
    const { model_uuid, version, report_type } = req.query
    const query = {}

    // Search by objectKey pattern if model_uuid or version provided
    if (model_uuid && version) {
      query.objectKey = { $regex: `^${model_uuid}-${version}-` }
    } else if (model_uuid) {
      query.objectKey = { $regex: `^${model_uuid}-` }
    }

    const reportTypeMap = {
      'risk':         { pool: 'RP',  bucket: 'risk-reports' },
      'assessment':   { pool: 'RP',  bucket: 'assessment-reports' },
      'defence':      { pool: 'RP',  bucket: 'defence-reports' },
      'gadgets':      { pool: 'RP',  bucket: 'gadgets-reports' },
      'aimodelinfo':  { pool: 'RP',  bucket: 'aimodelinfo-reports' },
      'euaiact':      { pool: 'RP',  bucket: 'euaiact-reports' },
      'datasets':     { pool: 'RP',  bucket: 'datasets-reports' },
      'requirements': { pool: 'TRP', bucket: 'model-requirements' },
      'aimbom':       { pool: 'SAP', bucket: 'ai-mbom' },
      'data':         { pool: 'TRP', bucket: 'trusted-data' },
    }

    if (report_type) {
      const mapped = reportTypeMap[report_type]
      if (mapped) {
        query.pool   = mapped.pool
        query.bucket = mapped.bucket
      }
    }

    const files = await File.find(query).sort({ createdAt: -1 })
    res.status(200).json({ count: files.length, files })
  } catch (error) {
    res.status(500).json({ message: 'Search failed', error: error.message })
  }
}

// ── List all files in a pool/bucket ──────────────────────────
// GET /api/v1/files?pool=AP&bucket=assessments
const listFiles = async (req, res) => {
  try {
    const { pool, bucket } = req.query
    const query = {}
    if (pool)   query.pool   = pool
    if (bucket) query.bucket = bucket

    const files = await File.find(query).sort({ uploadedAt: -1 })
    res.status(200).json({ count: files.length, files })
  } catch (error) {
    res.status(500).json({ message: 'List failed', error: error.message })
  }
}

// ── Delete a file ─────────────────────────────────────────────
// DELETE /api/v1/files/:id
const deleteFile = async (req, res) => {
  try {
    const doc = await File.findById(req.params.id)
    if (!doc) return res.status(404).json({ message: 'File not found' })

    const client = getPool(doc.pool)    // ← fix: was minioPools[doc.pool]
    await client.removeObject(doc.bucket, doc.objectKey)

    await File.findByIdAndDelete(req.params.id)
    res.status(200).json({ message: 'File deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'Delete failed', error: error.message })
  }
}

export {
  uploadFile,
  downloadFile,
  getPresignedUrl,
  searchFiles,
  listFiles,
  deleteFile,
}