const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
require('dotenv').config();

const DATA_FILE = path.join(process.cwd(), 'conversation_data.json');
const ASSESSMENTS_FILE = path.join(process.cwd(), 'assessments_data.json');

// Ensure data files exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(ASSESSMENTS_FILE)) {
    fs.writeFileSync(ASSESSMENTS_FILE, JSON.stringify([], null, 2));
}

// Helper to read file
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath);
    } catch (error) {
        return null;
    }
}

// Helper to handle async body parsing
async function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

module.exports = async (req, res) => {
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Serve HTML pages
    if (pathname === '/' || pathname === '/index.html') {
        const data = readFile(path.join(process.cwd(), 'index.html'));
        if (data) {
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(data);
        }
    } else if (pathname === '/dashboard' || pathname === '/dashboard.html') {
        const data = readFile(path.join(process.cwd(), 'dashboard.html'));
        if (data) {
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(data);
        }
    } else if (pathname === '/conversation_realtime' || pathname === '/conversation_realtime.html') {
        const data = readFile(path.join(process.cwd(), 'conversation_realtime.html'));
        if (data) {
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(data);
        }
    } else if (pathname === '/tics_assessment' || pathname === '/tics_assessment.html') {
        const data = readFile(path.join(process.cwd(), 'tics_assessment.html'));
        if (data) {
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(data);
        }
    } else if (pathname === '/audio_test' || pathname === '/audio_test.html') {
        const data = readFile(path.join(process.cwd(), 'audio_test.html'));
        if (data) {
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(data);
        }
    }
    // Serve image file
    else if (pathname === '/image.jpeg' || pathname === '/image.jpg') {
        const data = readFile(path.join(process.cwd(), 'image.jpeg'));
        if (data) {
            res.setHeader('Content-Type', 'image/jpeg');
            return res.status(200).send(data);
        }
    }
    // API endpoints
    else if (pathname === '/api-key' && req.method === 'GET') {
        const apiKey = process.env.OPENAI_API_KEY || '';
        return res.status(200).json({ apiKey });
    } else if (pathname === '/assembly-api-key' && req.method === 'GET') {
        const apiKey = process.env.ASSEMBLY_API_KEY || '';
        return res.status(200).json({ apiKey });
    } else if (pathname === '/token' && req.method === 'GET') {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
        }

        // Generate ephemeral key from OpenAI
        const https = require('https');
        const postData = JSON.stringify({
            model: 'gpt-4o-realtime-preview-2024-12-17'
        });

        const options = {
            hostname: 'api.openai.com',
            path: '/v1/realtime/sessions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req2 = https.request(options, (res2) => {
            let data = '';
            res2.on('data', (chunk) => {
                data += chunk;
            });
            res2.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    res.status(200).json(jsonData);
                } catch (e) {
                    res.status(500).json({ error: 'Invalid response from OpenAI' });
                }
            });
        });

        req2.on('error', (error) => {
            res.status(500).json({ error: error.message });
        });

        req2.write(postData);
        req2.end();
        return;
    }
    // API: Save/Get conversations
    else if (pathname === '/api/conversations' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            data.push(body);
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
            return res.status(200).json({ success: true, message: 'Record saved' });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    } else if (pathname === '/api/conversations' && req.method === 'GET') {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            return res.status(200).json(data);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    } else if (pathname.startsWith('/api/conversations/') && req.method === 'DELETE') {
        const index = parseInt(pathname.split('/').pop());
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (index >= 0 && index < data.length) {
                data.splice(index, 1);
                fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                return res.status(200).json({ success: true, message: 'Record deleted' });
            } else {
                return res.status(400).json({ error: 'Invalid index' });
            }
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    // API: Save/Get assessments
    else if (pathname === '/api/assessments' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const data = JSON.parse(fs.readFileSync(ASSESSMENTS_FILE, 'utf8'));
            data.push(body);
            fs.writeFileSync(ASSESSMENTS_FILE, JSON.stringify(data, null, 2));
            return res.status(200).json({ success: true, message: 'Assessment record saved' });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    } else if (pathname === '/api/assessments' && req.method === 'GET') {
        try {
            const data = JSON.parse(fs.readFileSync(ASSESSMENTS_FILE, 'utf8'));
            return res.status(200).json(data);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    } else if (pathname.startsWith('/api/assessments/') && req.method === 'DELETE') {
        const index = parseInt(pathname.split('/').pop());
        try {
            const data = JSON.parse(fs.readFileSync(ASSESSMENTS_FILE, 'utf8'));
            if (index >= 0 && index < data.length) {
                data.splice(index, 1);
                fs.writeFileSync(ASSESSMENTS_FILE, JSON.stringify(data, null, 2));
                return res.status(200).json({ success: true, message: 'Assessment deleted' });
            } else {
                return res.status(400).json({ error: 'Invalid index' });
            }
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    
    // 404 for everything else
    return res.status(404).send('Not found');
};

