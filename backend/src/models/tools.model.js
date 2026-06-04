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
    name: {
      type:     String,
      required: true,    // ← required — tool must have a name
      trim:     true,
    },
    description: {
      type: String,      // ← optional — free text
      trim: true,
    },
    defence_flows: { // array of strings
      type:    [String],   
      default: [],
    },
    attacks_vulnerabilities: { // array of strings
      type:    [String],   
      default: [],
    },
    tool_type: {
      type:     String,
      required: true,
      enum:     ['assessment', 'assessment_with_defence', 'defence', 'data_generator', 'gadgets'], // add gadgets
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