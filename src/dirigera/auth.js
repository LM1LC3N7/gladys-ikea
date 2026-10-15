// -----------------------------------------------------------------------------
// DIRIGERA pairing: an OAuth authorization code flow with PKCE (RFC 7636),
// approved by pressing the action button under the hub (pure).
//
// 1. GET  /v1/oauth/authorize?audience=homesmart.local&response_type=code
//         &code_challenge=<S256 of the verifier>&code_challenge_method=S256
//    -> { code }
// 2. the user presses the button on the hub;
// 3. POST /v1/oauth/token  code, name, grant_type=authorization_code,
//         code_verifier -> { access_token } (refused until the button is pressed)
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

/** 128 characters of the RFC 7636 alphabet. */
export const createVerifier = (random = randomBytes) => random(96).toString('base64url');

export const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/** The client name sent with the token request (the hub keeps one per token). */
export const CLIENT_NAME = 'Gladys Assistant';
