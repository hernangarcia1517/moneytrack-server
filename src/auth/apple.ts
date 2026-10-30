import { createHash } from 'node:crypto'
import { createRemoteJWKSet, errors, jwtVerify, type CryptoKey, type JWTVerifyGetKey } from 'jose'

export type AppleIdentity = { sub: string; email?: string }
export type VerifyApple = (identityToken: string, rawNonce: string) => Promise<AppleIdentity>

export class AppleTokenError extends Error {}

export function createAppleVerifier(opts: { audience: string; keys: JWTVerifyGetKey | CryptoKey }): VerifyApple {
  return async (identityToken, rawNonce) => {
    let payload
    try {
      ;({ payload } = await jwtVerify(identityToken, opts.keys, {
        issuer: 'https://appleid.apple.com',
        audience: opts.audience,
        algorithms: ['RS256'],
      }))
    } catch (e) {
      const appleKeysUnreachable = e instanceof errors.JWKSTimeout
      if (e instanceof errors.JOSEError && !appleKeysUnreachable) throw new AppleTokenError(e.message)
      throw e
    }
    if (payload.nonce !== createHash('sha256').update(rawNonce).digest('hex')) throw new AppleTokenError('nonce mismatch')
    if (!payload.sub) throw new AppleTokenError('missing sub')
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined }
  }
}

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))

export const verifyApple: VerifyApple = async (identityToken, rawNonce) => {
  const audience = process.env.APPLE_BUNDLE_ID
  if (!audience) throw new Error('APPLE_BUNDLE_ID is not set')
  return createAppleVerifier({ audience, keys: appleKeys })(identityToken, rawNonce)
}
