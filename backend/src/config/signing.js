// src/config/signing.js
// Single source of truth for the STRAE signing flow

export const SIGNER_ROLE    = 'report-signer'
export const SIGN_TOPIC     = 'strae_sign_requests'
export const PENDING_SUFFIX = '-pending'

// Final buckets that ONLY STRAE may write to (all in RP)
export const SIGNED_REPORTS = [
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

export const toPending      = (bucket) => `${bucket}${PENDING_SUFFIX}`
export const fromPending    = (bucket) => bucket.slice(0, -PENDING_SUFFIX.length)
export const isSignedReport = (bucket) => SIGNED_REPORTS.includes(bucket)