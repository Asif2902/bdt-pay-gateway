/**
 * Merchant email+password authentication using Turso + jose JWTs.
 * Admin auth uses the same JWT signing but a separate ADMIN_PASSWORD check.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import bcrypt from 'bcryptjs';
import { getDb, newId } from './db';

const BCRYPT_ROUNDS = 12;
const MERCHANT_JWT_EXPIRY = '8h';
const ADMIN_JWT_EXPIRY = '8h';

function getMerchantSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(s);
}

function getAdminSecret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) throw new Error('ADMIN_JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(s);
}

// ---- Merchant auth ----

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface MerchantTokenPayload extends JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export async function signMerchantToken(userId: string, email: string, role: string): Promise<string> {
  return new SignJWT({ userId, email, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(MERCHANT_JWT_EXPIRY)
    .setSubject(userId)
    .sign(getMerchantSecret());
}

export async function verifyMerchantToken(token: string): Promise<MerchantTokenPayload> {
  const { payload } = await jwtVerify(token, getMerchantSecret());
  return payload as MerchantTokenPayload;
}

// ---- Admin auth ----

export async function verifyAdminPassword(plain: string): Promise<boolean> {
  const stored = process.env.ADMIN_PASSWORD;
  if (!stored) throw new Error('ADMIN_PASSWORD is not configured');
  // Support both plain and bcrypt-hashed passwords
  if (stored.startsWith('$2')) return bcrypt.compare(plain, stored);
  return plain === stored;
}

export interface AdminTokenPayload extends JWTPayload {
  role: 'admin';
  jti: string;
}

export async function signAdminToken(): Promise<{ token: string; jti: string }> {
  const jti = newId();
  const token = await new SignJWT({ role: 'admin', jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ADMIN_JWT_EXPIRY)
    .setJti(jti)
    .sign(getAdminSecret());
  return { token, jti };
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload> {
  const { payload } = await jwtVerify(token, getAdminSecret());
  return payload as AdminTokenPayload;
}

// ---- DB helpers ----

export async function registerUser(email: string, password: string, fullName?: string): Promise<{ id: string; email: string; role: string }> {
  const db = getDb();
  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] });
  if (existing.rows.length > 0) throw new Error('Email already registered');
  const id = newId();
  const hash = await hashPassword(password);
  await db.execute({
    sql: 'INSERT INTO users (id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    args: [id, email.toLowerCase(), fullName ?? null, hash, 'merchant'],
  });
  return { id, email: email.toLowerCase(), role: 'merchant' };
}

export async function loginUser(email: string, password: string): Promise<{ id: string; email: string; role: string; is_active: number }> {
  const db = getDb();
  const res = await db.execute({
    sql: 'SELECT id, email, password_hash, role, is_active FROM users WHERE email = ?',
    args: [email.toLowerCase()],
  });
  const row = res.rows[0];
  if (!row) throw new Error('Invalid email or password');
  const ok = await verifyPassword(String(password), String(row.password_hash));
  if (!ok) throw new Error('Invalid email or password');
  return { id: String(row.id), email: String(row.email), role: String(row.role), is_active: Number(row.is_active) };
}

export async function getUserById(id: string): Promise<{ id: string; email: string; role: string; is_active: number } | null> {
  const db = getDb();
  const res = await db.execute({ sql: 'SELECT id, email, role, is_active FROM users WHERE id = ?', args: [id] });
  const row = res.rows[0];
  if (!row) return null;
  return { id: String(row.id), email: String(row.email), role: String(row.role), is_active: Number(row.is_active) };
}
