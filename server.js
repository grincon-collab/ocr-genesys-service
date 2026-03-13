const express = require('express');
const vision = require('@google-cloud/vision');
const crypto = require('crypto');
const helmet = require('helmet'); 
const app = express();

// 1. ELIMINAR FIRMA DE EXPRESS (Doble capa de seguridad)
app.disable('x-powered-by');

// ──────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.OCR_API_KEY || 'ITX-OCR-SECRET-2026';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const MAX_BASE64_SIZE_MB = 10;
const MIN_IMAGE_SIZE_KB = 40;
const MIN_CONFIDENCE = 0.80;

// ──────────────────────────────────────────────
// MIDDLEWARES DE SEGURIDAD (Blindaje A+)
// ──────────────────────────────────────────────

// 2. Configuración de Helmet optimizada para pasar los reportes
app.use(helmet({
    // SOLUCIÓN: HSTS (Strict-Transport-Security)
    hsts: {
        maxAge: 31536000, // 1 año
        includeSubDomains: true,
        preload: true
    },
    // SOLUCIÓN: Permissions-Policy
    permissionsPolicy: {
        features: {
            camera: ["'none'"],
            microphone: ["'none'"],
            geolocation: ["'none'"],
            payment: ["'none'"]
        }
    },
    // Otras políticas de aislamiento
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "upgrade-insecure-requests": []
        }
    }
}));

app.use(express.json({ limit: `${MAX_BASE64_SIZE_MB}mb` }));

// ──────────────────────────────────────────────
// GOOGLE VISION - INICIALIZACIÓN
// ──────────────────────────────────────────────
let client = null;
let visionReady = false;

try {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (!rawCreds) {
        throw new Error('Variable GOOGLE_CREDENTIALS no está definida');
    }
    const credentials = JSON.parse(rawCreds);
    client = new vision.ImageAnnotatorClient({ credentials });
    visionReady = true;
    console.log(`✅ Google Cloud Vision conectado: ${credentials.project_id}`);
} catch (error) {
    console.error(`❌ Google Vision NO inicializado: ${error.message}`);
}

// ──────────────────────────────────────────────
// RATE LIMITING
// ──────────────────────────────────────────────
const rateLimitMap = new Map();
setInterval(() => { rateLimitMap.clear(); }, RATE_LIMIT_WINDOW_MS);

function rateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const count = rateLimitMap.get(ip) || 0;

    if (count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Demasiadas solicitudes.' });
    }
    rateLimitMap.set(ip, count + 1);
    next();
}

// ──────────────────────────────────────────────
// AUTENTICACIÓN
// ──────────────────────────────────────────────
function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'Se requiere API Key' });

    try {
        const keyBuffer = Buffer.from(apiKey);
        const secretBuffer = Buffer.from(API_KEY);
        if (keyBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(keyBuffer, secretBuffer)) {
            return res.status(401).json({ error: 'API key inválida' });
        }
    } catch {
        return res.status(401).json({ error: 'API key inválida' });
    }
    next();
}

// ──────────────────────────────────────────────
// FUNCIONES DE APOYO (Tu lógica de validación aquí)
// ──────────────────────────────────────────────
function validateImageBase64(ocrBase64) {
    if (!ocrBase64 || typeof ocrBase64 !== 'string') return { valid: false, error: 'Falta ocrBase64' };
    const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    if (imageBuffer.length / 1024 < MIN_IMAGE_SIZE_KB) return { valid: false, error: 'Imagen muy pequeña', isQuality: true };
    return { valid: true, buffer: imageBuffer };
}

// ──────────────────────────────────────────────
// ENDPOINT PRINCIPAL
// ──────────────────────────────────────────────
app.post('/api/extract', rateLimit, authenticate, async (req, res) => {
    if (!visionReady || !client) {
        return res.status(503).json({ error: 'Servicio OCR no disponible.' });
    }

    try {
        let ocrBase64 = req.body.ocrBase64;
        req.body.ocrBase64 = null; 

        const imageCheck = validateImageBase64(ocrBase64);
        ocrBase64 = null; 

        if (!imageCheck.valid) {
            return res.json({ calidadAprobada: false, mensajeRechazo: imageCheck.error });
        }

        const [result] = await client.textDetection(imageCheck.buffer);
        imageCheck.buffer = null; 

        // --- TU LÓGICA DE EXTRACCIÓN (Nombres, Apellidos, Cédula) ---
        // (Agrega aquí tu lógica de procesamiento de 'result')
        
        res.json({
            calidadAprobada: true,
            cedula: "Extraída correctamente",
            nombres: "...", 
            apellidos: "..."
        });

    } catch (error) {
        console.error(`[OCR] Error: ${error.message}`);
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: visionReady ? 'ok' : 'degraded' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🛡️ Servidor OCR blindado (HSTS + Permissions) en puerto ${PORT}`);
});
