// src/config/minio.js
import { Client } from 'minio'

function makeClient(host, port, accessKey, secretKey) {
  return new Client({
    endPoint:  host,
    port:      parseInt(port),
    useSSL:    false,
    accessKey,
    secretKey,
  })
}

export function getPool(poolName) {
  const map = {
    SAP:   () => makeClient(
      process.env.MINIO_SAP_HOST   || '147.102.19.168',
      process.env.MINIO_SAP_PORT   || '30005',
      process.env.MINIO_SAP_USER,
      process.env.MINIO_SAP_PASS
    ),
    RP:    () => makeClient(
      process.env.MINIO_RP_HOST    || '147.102.19.168',
      process.env.MINIO_RP_PORT    || '30006',
      process.env.MINIO_RP_USER,
      process.env.MINIO_RP_PASS
    ),
    TRP:   () => makeClient(
      process.env.MINIO_TRP_HOST   || '147.102.19.168',
      process.env.MINIO_TRP_PORT   || '30007',
      process.env.MINIO_TRP_USER,
      process.env.MINIO_TRP_PASS
    ),
    AP:    () => makeClient(
      process.env.MINIO_AP_HOST    || '147.102.19.168',
      process.env.MINIO_AP_PORT    || '30008',
      process.env.MINIO_AP_USER,
      process.env.MINIO_AP_PASS
    ),
    STRDP: () => makeClient(
      process.env.MINIO_STRDP_HOST || '147.102.19.168',
      process.env.MINIO_STRDP_PORT || '30009',
      process.env.MINIO_STRDP_USER,
      process.env.MINIO_STRDP_PASS
    ),
  }
  return map[poolName]?.()
}

//create bucket if it doesnt exist for each pool
export async function initMinIO() {
  const buckets = {
    SAP:   ['ai-mbom'],
    RP:    ['risk-reports','assessment-reports','defence-reports','user-assessment-reports','user-defence-reports'],
    TRP:   ['trusted-data', 'trusted-models'],
    AP:    ['assessment-libraries','assessment-tools'],
    STRDP: ['defence-libraries','design-train-defence-tools','deployment-test-defence-tools'],
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