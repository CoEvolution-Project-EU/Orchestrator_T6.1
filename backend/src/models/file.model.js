// src/models/file.model.js
// Stores metadata about every file uploaded to MinIO
// The actual file lives in MinIO — this stores info ABOUT the file

import mongoose, { Schema } from 'mongoose'

const fileSchema = new Schema(
  {
    // ── Required — every file must have these ─────────────────
    pool: {
      type:     String,
      required: true,
      enum:     ['SAP', 'RP', 'TRP', 'AP', 'STRDP'],
    },
    bucket: {
      type:     String,
      required: true,
    },
    model_uuid: {
      type:     String,
      required: true,   // which model this file belongs to
      index:    true,
    },
    version: {
      type:     String,
      required: true,   // which version of the model
      index:    true,
    },
    objectKey: {
      type:     String,
      required: true,   // the address of the file inside MinIO — cannot find file without it
    },

    // ── Optional — good to have but not blocking ──────────────
    filename: {
      type: String,     // original filename the user uploaded
    },
    size: {
      type: Number,     // file size in bytes
    },
    contentType: {
      type: String,     // e.g. application/pdf, text/plain
    },
    uploadedBy: {
      type:  String,    // Keycloak username
      index: true,
    },
    tags: {
      type:    [String],
      default: [],
      index:   true,
    },
  },
  {
    timestamps: true,   // adds createdAt and updatedAt automatically
  }
)

// ── Indexes for fast queries ──────────────────────────────────
fileSchema.index({ pool: 1, bucket: 1 })                  // search by pool + bucket
fileSchema.index({ model_uuid: 1, version: 1 })           // search by model + version
fileSchema.index({ model_uuid: 1, createdAt: -1 })        // all files for a model, newest first

export const File = mongoose.model('File', fileSchema)