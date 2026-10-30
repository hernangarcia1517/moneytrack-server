import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { generateKeyPair, SignJWT } from 'jose'
import { AppleTokenError, createAppleVerifier } from './auth/apple.js'

const audience = 'test.app'
const rawNonce = 'raw-nonce'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const { publicKey, privateKey } = await generateKeyPair('RS256')
const other = await generateKeyPair('RS256')
const verify = createAppleVerifier({ audience, keys: publicKey })
const now = Math.floor(Date.now() / 1000)

function sign(over: { iss?: string; aud?: string; nonce?: string; exp?: number; key?: CryptoKey } = {}) {
  return new SignJWT({ nonce: over.nonce ?? hash(rawNonce), email: 'a@example.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('apple-user-1')
    .setIssuer(over.iss ?? 'https://appleid.apple.com')
    .setAudience(over.aud ?? audience)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? now + 300)
    .sign(over.key ?? privateKey)
}

describe('Apple identity token check', () => {
  it('accepts a valid token and returns the Apple user id and email', async () => {
    assert.deepEqual(await verify(await sign(), rawNonce), { sub: 'apple-user-1', email: 'a@example.com' })
  })

  const bad: Array<[string, Parameters<typeof sign>[0]]> = [
    ['a nonce that does not match', { nonce: hash('another-nonce') }],
    ['a different audience', { aud: 'other.app' }],
    ['a different issuer', { iss: 'https://evil.example.com' }],
    ['an expired token', { exp: now - 60 }],
    ['a signature from another key', { key: other.privateKey }],
  ]
  for (const [label, over] of bad) {
    it(`rejects ${label}`, async () => {
      await assert.rejects(verify(await sign(over), rawNonce), AppleTokenError)
    })
  }

  it('rejects something that is not a token', async () => {
    await assert.rejects(verify('not-a-jwt', rawNonce), AppleTokenError)
  })
})
