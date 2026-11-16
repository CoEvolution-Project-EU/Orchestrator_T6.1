// src/utils/fileCleanup.js
// Deletes files from MinIO AND their File documents in MongoDB.
// Safe to call again: already-deleted files are simply skipped.

import { getPool } from '../config/minio.js'
import { File } from '../models/file.model.js'

export const removeFiles = async (fileIds) => {
  // 1. Normalise: strings only, no duplicates
  const ids = [...new Set(fileIds.map(String))]
  if (ids.length === 0) return { deleted: 0, failed: [] }

  // 2. Find the metadata of every file (pool, bucket, objectKey)
  const docs = await File.find({ _id: { $in: ids } })

  // 3. Delete each one: MinIO first, then its File document
  const failed = []
  for (const doc of docs) {
    try {
      await getPool(doc.pool).removeObject(doc.bucket, doc.objectKey)
      await File.deleteOne({ _id: doc._id })
    } catch (error) {
      failed.push({ _id: doc._id.toString(), error: error.message })
    }
  }

  return { deleted: docs.length - failed.length, failed }
}