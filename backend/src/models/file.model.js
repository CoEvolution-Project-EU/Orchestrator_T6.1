// src/models/file.model.js
// Stores metadata about every file uploaded to MinIO
// The actual file lives in MinIO — this stores info ABOUT the file

import mongoose, { Schema } from 'mongoose'

const fileSchema = new Schema(
  {
    pool:        { type: String, required: true, enum: ['SAP', 'RP', 'TRP', 'AP', 'STRDP'] },
    bucket:      { type: String, required: true },
    objectKey:   { type: String, required: true },
    filename:    { type: String },
    size:        { type: Number },
    contentType: { type: String },
    uploadedBy:  { type: String, index: true },
    tags:        { type: [String], default: [] },
  },
  { timestamps: true }
)

fileSchema.index({ pool: 1, bucket: 1 })

export const File = mongoose.model('File', fileSchema)