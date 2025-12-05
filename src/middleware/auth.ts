import type { Context, Next } from "hono";
import type { Env } from "../types";

interface JWTHeader {
	alg: string;
	kid: string;
	typ: string;
}

interface JWTPayload {
	aud: string[];
	email: string;
	exp: number;
	iat: number;
	iss: string;
	sub: string;
	type: string;
	identity_nonce: string;
	custom?: Record<string, unknown>;
}

interface CloudflareAccessCerts {
	keys: Array<{
		kid: string;
		kty: string;
		alg: string;
		use: string;
		e: string;
		n: string;
	}>;
	public_cert: { kid: string; cert: string };
	public_certs: Array<{ kid: string; cert: string }>;
}

// Cache for public keys (in-memory, per isolate)
let certsCache: { certs: CloudflareAccessCerts; expiry: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function base64UrlDecode(str: string): Uint8Array {
	// Add padding if needed
	const padding = "=".repeat((4 - (str.length % 4)) % 4);
	const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + padding;
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function decodeJWT(token: string): { header: JWTHeader; payload: JWTPayload; signature: string } {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid JWT format");
	}

	const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as JWTHeader;
	const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as JWTPayload;

	return { header, payload, signature: parts[2] };
}

async function fetchPublicKeys(teamName: string): Promise<CloudflareAccessCerts> {
	// Check cache first
	if (certsCache && Date.now() < certsCache.expiry) {
		return certsCache.certs;
	}

	const response = await fetch(`https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`);
	if (!response.ok) {
		throw new Error(`Failed to fetch Cloudflare Access certs: ${response.status}`);
	}

	const certs = (await response.json()) as CloudflareAccessCerts;

	// Cache the result
	certsCache = { certs, expiry: Date.now() + CACHE_TTL_MS };

	return certs;
}

async function importPublicKey(jwk: { e: string; n: string }): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"jwk",
		{
			kty: "RSA",
			alg: "RS256",
			use: "sig",
			e: jwk.e,
			n: jwk.n,
		},
		{
			name: "RSASSA-PKCS1-v1_5",
			hash: "SHA-256",
		},
		false,
		["verify"]
	);
}

async function verifyJWT(
	token: string,
	teamName: string,
	expectedAud: string
): Promise<JWTPayload> {
	const { header, payload, signature } = decodeJWT(token);

	// Verify algorithm
	if (header.alg !== "RS256") {
		throw new Error(`Unsupported algorithm: ${header.alg}`);
	}

	// Verify expiration
	const now = Math.floor(Date.now() / 1000);
	if (payload.exp < now) {
		throw new Error("Token has expired");
	}

	// Verify audience
	if (!payload.aud.includes(expectedAud)) {
		throw new Error("Invalid audience");
	}

	// Verify issuer
	const expectedIssuer = `https://${teamName}.cloudflareaccess.com`;
	if (payload.iss !== expectedIssuer) {
		throw new Error("Invalid issuer");
	}

	// Fetch public keys and find the right one
	const certs = await fetchPublicKeys(teamName);
	const key = certs.keys.find((k) => k.kid === header.kid);
	if (!key) {
		throw new Error("Public key not found for kid: " + header.kid);
	}

	// Import the public key
	const publicKey = await importPublicKey(key);

	// Verify signature
	const signedContent = token.split(".").slice(0, 2).join(".");
	const signatureBytes = base64UrlDecode(signature);
	const contentBytes = new TextEncoder().encode(signedContent);

	const isValid = await crypto.subtle.verify(
		{ name: "RSASSA-PKCS1-v1_5" },
		publicKey,
		signatureBytes,
		contentBytes
	);

	if (!isValid) {
		throw new Error("Invalid signature");
	}

	return payload;
}

export interface User {
	email: string;
	sub: string;
}

export function cloudflareAccess() {
	return async (c: Context<{ Bindings: Env }>, next: Next) => {
		const teamName = c.env.CF_ACCESS_TEAM_NAME;
		const aud = c.env.CF_ACCESS_AUD;

		// Skip auth if not configured (allows open source usage without CF Access)
		if (!teamName || !aud || teamName.startsWith("YOUR_") || aud.startsWith("YOUR_")) {
			await next();
			return;
		}

		// Get the JWT from header
		const jwt = c.req.header("CF-Access-JWT-Assertion");
		if (!jwt) {
			return c.json({ error: "Unauthorized - missing access token" }, 401);
		}

		try {
			const payload = await verifyJWT(jwt, teamName, aud);

			// Store user info in context
			c.set("user", {
				email: payload.email,
				sub: payload.sub,
			} as User);

			await next();
		} catch (error) {
			console.error("JWT verification failed:", error);
			return c.json({ error: "Unauthorized - invalid access token" }, 401);
		}
	};
}
