import fs from 'fs';
import path from 'path';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Dynamic Firebase Configuration Endpoint for SBA Web Approval
 */
const allowCors = (fn: (req: VercelRequest, res: VercelResponse) => Promise<any>) => async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

function parseFirebaseComments(envPath: string): Record<number, string> {
    const commentMap: Record<number, string> = {};

    if (!fs.existsSync(envPath)) {
        return commentMap;
    }

    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    let lastComment = '';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith('#')) {
            lastComment = line.slice(1).trim();
            continue;
        }

        const match = line.match(/FIREBASE_(\d+)_PROJECT_ID=(.+)/);
        if (match) {
            const idx = Number(match[1]);
            if (lastComment) {
                commentMap[idx] = lastComment;
                lastComment = '';
            }
            continue;
        }

        lastComment = '';
    }

    return commentMap;
}

async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const configs: { [key: number]: any } = {};
        const envPath = path.join(process.cwd(), '.env');
        const commentMap = parseFirebaseComments(envPath);
        let index = 1;

        // Dynamic discovery of FIREBASE_N_* env vars
        while (process.env[`FIREBASE_${index}_API_KEY`]) {
            configs[index] = {
                apiKey: process.env[`FIREBASE_${index}_API_KEY`],
                authDomain: process.env[`FIREBASE_${index}_AUTH_DOMAIN`],
                projectId: process.env[`FIREBASE_${index}_PROJECT_ID`],
                storageBucket: process.env[`FIREBASE_${index}_STORAGE_BUCKET`],
                messagingSenderId: process.env[`FIREBASE_${index}_MESSAGING_SENDER_ID`],
                appId: process.env[`FIREBASE_${index}_APP_ID`],
                measurementId: process.env[`FIREBASE_${index}_MEASUREMENT_ID`],
                label: process.env[`FIREBASE_${index}_LABEL`] || `Database ${index}`,
                comment: commentMap[index] || process.env[`FIREBASE_${index}_LABEL`] || ''
            };
            index++;
        }

        let schoolDatabaseMapping: { [key: string]: number } = {};
        try {
            schoolDatabaseMapping = JSON.parse(process.env.SCHOOL_DATABASE_MAPPING || '{}');
        } catch (e) {
            console.warn('Failed to parse SCHOOL_DATABASE_MAPPING');
        }

        return res.status(200).json({
            success: true,
            configs,
            schoolDatabaseMapping,
            activationHash: process.env.PASSWORD_HASH
        });
    } catch (error: any) {
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}

export default allowCors(handler);
