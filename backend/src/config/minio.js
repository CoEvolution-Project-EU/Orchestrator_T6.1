// src/config/minio.js
import { Client } from 'minio'

function makeClient(port, accessKey, secretKey) {
  return new Client({
    endPoint:  process.env.MINIO_HOST || '147.102.19.168',
    port,
    useSSL:    false,
    accessKey,
    secretKey,
  })
}

// Use a function that reads env vars at call time, not at import time
export function getPool(poolName) {
  const map = {
    SAP:   () => makeClient(30005, process.env.MINIO_SAP_USER,   process.env.MINIO_SAP_PASS),
    RP:    () => makeClient(30006, process.env.MINIO_RP_USER,    process.env.MINIO_RP_PASS),
    TRP:   () => makeClient(30007, process.env.MINIO_TRP_USER,   process.env.MINIO_TRP_PASS),
    AP:    () => makeClient(30008, process.env.MINIO_AP_USER,    process.env.MINIO_AP_PASS),
    STRDP: () => makeClient(30009, process.env.MINIO_STRDP_USER, process.env.MINIO_STRDP_PASS),
  }
  return map[poolName]?.()
}

export async function initMinIO() {
  const buckets = {
    SAP:   [],
    RP:    [],
    TRP:   ['trusted-data', 'trusted-models'],
    AP:    [],
    STRDP: [],
  }

  for (const [pool, bucketList] of Object.entries(buckets)) {
    const client = getPool(pool)
    for (const bucket of bucketList) {
      const exists = await client.bucketExists(bucket)
      if (!exists) {
        await client.makeBucket(bucket)
        console.log(`[MinIO][${pool}] bucket created: ${bucket}`)
      }
    }
  }
  console.log('MinIO pools initialized')
}