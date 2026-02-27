import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as crypto from 'crypto';

/**
 * Secure Verification Endpoint
 */
const allowCors = (fn: (req: VercelRequest, res: VercelResponse) => Promise<any>) => async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body; // Actually the hash from client
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password required' });
        }

        const targetHash = (process.env.PASSWORD_HASH || '').trim().replace(/^["']|["']$/g, '');

        console.log('[Auth] Received Hash:', password);
        console.log('[Auth] Target Hash:', targetHash ? `${targetHash.substring(0, 8)}...` : 'MISSING');

        if (password && targetHash && password === targetHash) {
            console.log('[Auth] Verification Success');
            return res.status(200).json({ success: true, hash: password });
        } else {
            console.log('[Auth] Verification Failed (Mismatch)');
            return res.status(401).json({
                success: false,
                message: 'Invalid password',
                debug: {
                    receivedPrefix: password?.substring(0, 4),
                    targetPrefix: targetHash?.substring(0, 4) || 'MISSING'
                }
            });
        }
    } catch (error: any) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}

export default allowCors(handler);
