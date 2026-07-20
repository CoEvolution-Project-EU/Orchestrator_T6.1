import pilotBucketMap from '../config/pilot.js' 


const pilotBuckets = Object.values(pilotBucketMap)

export const restrictPilotBucket = (req, res, next) => {
  const userId = req.user?.sub
  const requestedBucket = req.body.bucket

  const isUserPilot = Boolean(pilotBucketMap[userId])
  const isBucketPilotOwned = pilotBuckets.includes(requestedBucket)

  // Rule 1: if this user IS a pilot, they may ONLY ever touch their own bucket
  if (isUserPilot) {
    if (pilotBucketMap[userId] !== requestedBucket) {
      return res.status(403).json({
        message: `You are only allowed to upload to bucket "${pilotBucketMap[userId]}"`,
      })
    }
    return next()
  }

  // Rule 2: if this user is NOT a pilot, but the bucket belongs to one -> blocked
  if (isBucketPilotOwned) {
    return res.status(403).json({
      message: `You are not authorized to upload to bucket "${requestedBucket}"`,
    })
  }

  // Not a pilot, not touching a pilot bucket -> normal access, no restriction
  return next()
}