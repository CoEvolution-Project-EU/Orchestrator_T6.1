// src/models/aimbom.model.js
// The AIMBOM lifecycle record: which reports it was built from, and its status

import mongoose, { Schema } from 'mongoose'
import { v4 as uuidv4 } from 'uuid'

const aimbomSchema = new Schema(
  {
    aimbom_id: { type: String, default: uuidv4, unique: true },

    // Which model version this AIMBOM belongs to (child → parent reference)
    model_uuid: { type: String, required: true },
    version:    { type: String, required: true },

    event: {
      type: String,
      enum: ['aimbom-requested', 'updated-aimbom-requested'],
      required: true,
    },

    // The FULL set of the 7 report IDs this AIMBOM is built from
    sources: {
      risk_report:        { type: String, required: true },
      assessment_report:  { type: String, required: true },
      defence_report:     { type: String, required: true },
      gadgets_report:     { type: String, required: true },
      aimodelinfo_report: { type: String, required: true },
      euaiact_report:     { type: String, required: true },
      datasets_report:    { type: String, required: true },
    },

    requestedBy: { type: String },

    // pending → completed → deprecated | decommissioned ;  pending → cancelled
    status: {
      type: String,
      enum: ['pending', 'completed', 'deprecated', 'cancelled', 'decommissioned'],
      default: 'pending',
    },

    // The AIMBOM file STRAE uploaded (File in SAP/ai-mbom)
    aimbom_file_id: { type: String, default: null },
    completedAt:    { type: Date,   default: null },

    // Decommissioning (SRME — future)
    decommissionedAt:   { type: Date,   default: null },
    decommissionReason: { type: String, default: null },
  },
  { timestamps: true }
)

aimbomSchema.index({ model_uuid: 1, version: 1, status: 1 })

// At most ONE pending AIMBOM per model version (enforced by the database)
aimbomSchema.index(
  { model_uuid: 1, version: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
)

export const Aimbom = mongoose.model('Aimbom', aimbomSchema)