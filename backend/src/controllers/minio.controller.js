// src/controllers/minio.controller.js
// Handles file operations for all MinIO pools

import { getPool } from '../config/minio.js'
import { File } from '../models/file.model.js'
import { Model } from '../models/models.model.js' 
import { publishEvent } from '../config/kafka.js'


const uploadFile = async (req, res) => {
  try {
    const { pool, bucket, model_uuid, version, tags } = req.body
    const files = req.files

    if (!files || files.length === 0)
      return res.status(400).json({ message: 'At least one file is required' })
    if (!pool || !bucket )
      return res.status(400).json({ message: 'pool, bucket ' })

    // check data bucket FIRST
    const dataBuckets = ['trusted-data']
    const isDataFile = dataBuckets.includes(bucket)

    if (!isDataFile && (!model_uuid || !version)) {
      return res.status(400).json({
        message: `model_uuid and version are required for bucket "${bucket}"`
      })
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
      
      const objectKey = file.originalname

      await client.putObject(
        bucket,
        objectKey,
        file.buffer,
        file.size,
        { 'Content-Type': file.mimetype }
      )

      const doc = await File.create({
        pool,
        bucket,
        objectKey,
        filename:    file.originalname,
        size:        file.size,
        contentType: file.mimetype,
        uploadedBy:  req.user?.username || 'backend',
        tags:        tags ? tags.split(',').map(t => t.trim()) : [],
      })

      uploadedDocs.push({
        ...doc.toObject(),
        download_url: `https://aegis.coevolution-project.eu/api/v1/files/download/${doc._id}`
      })
    }



    // ── Auto-update model versioning for engine report buckets ─
    const reportBuckets = {
      'model-requirements':      'requirements', 
      'risk-reports':       'risk_assessment_reports',
      'assessment-reports': 'assessments',
      'defence-reports':    'defences',
      'gadgets-reports':     'gadgets_reports',       
      'aimodelinfo-reports': 'aimodelinfo_reports',  
      'euaiact-reports':     'euaiact_reports',       
      'datasets-reports':    'datasets_reports',
      'ai-mbom':             'ai_mbom', 
      'user-assessments':    'user_assessments',    
      'user-defences':       'user_defences',       
      'trusted-models': 'trusted_model',
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

    // ── Kafka topic map ───────────────────────────────────────
    const topicMap = {
      'model-requirements':   'ragre_models',
      'user-assessments': 'assessment_reports',
      'user-defences':    'defence_reports'
      }

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