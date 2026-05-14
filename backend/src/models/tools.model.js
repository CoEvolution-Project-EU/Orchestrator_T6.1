// src/models/tools.model.js
import mongoose, { Schema } from 'mongoose'

const toolSchema = new Schema(
  {
    tool_id: {
      type:     String,
      required: true,
      unique:   true,    // no two tools with same id
      trim:     true,
    },
    tool_type: {
      type:     String,
      required: true,
      enum:     ['assessment', 'assessment_with_defence', 'defence'],
    },
    github_url: {
      type:     String,
      required: true,
      trim:     true,
    },
    uploadedBy: {
      type:  String,
      index: true,
    },
    tags: {
      type:    [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
)

export const Tool = mongoose.model('Tool', toolSchema)