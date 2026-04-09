// src/middleware/keycloak.middleware.js
// Verifies Keycloak JWT token and extracts username
// The UI sends the token in the Authorization header:
// Authorization: Bearer <token>

import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'

// Keycloak JWKS endpoint — provides public keys to verify JWT signatures
const client = jwksClient({
    jwksUri: 'https://aegis.coevolution-project.eu/realms/coevolution/protocol/openid-connect/certs',
    cache: true,
  rateLimit: true,
})

// Get the signing key from Keycloak
function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err)
    const signingKey = key.getPublicKey()
    callback(null, signingKey)
  })
}

// Middleware — attach this to any route that needs authentication
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]

  jwt.verify(
    token,
    getKey,
    {
      issuer:   'https://aegis.coevolution-project.eu/realms/coevolution',
      audience: 'account',
    },
    (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid or expired token', error: err.message })
      }

      // Attach user info to request — available in all controllers as req.user
      req.user = {
        username:  decoded.preferred_username,  // e.g. "coevolution_user"
        email:     decoded.email,
        sub:       decoded.sub,                 // Keycloak user ID
        roles:     decoded.realm_access?.roles || [],
      }

      next()
    }
  )
}

// Optional middleware — does not block if no token, just sets req.user if token exists
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null
    return next()
  }

  const token = authHeader.split(' ')[1]

  jwt.verify(token, getKey, {
    issuer:   'http://147.102.19.168:30012/realms/coevolution',
    audience: 'coevolution',
  }, (err, decoded) => {
    if (err) {
      req.user = null
    } else {
      req.user = {
        username: decoded.preferred_username,
        email:    decoded.email,
        sub:      decoded.sub,
        roles:    decoded.realm_access?.roles || [],
      }
    }
    next()
  })
}