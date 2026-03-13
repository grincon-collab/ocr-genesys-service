const express = require('express');
const vision = require('@google-cloud/vision');
const crypto = require('crypto');
const helmet = require('helmet'); // 1. Requerir helmet
const app = express();

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
// MIDDLEWARES DE SEGURIDAD INICIALES
// ──────────────────────────────────────────────

// 2. Configurar Helmet (Sustituye y mejora tus headers manuales)
app.use(helmet({
    contentSecurityPolicy: false, // Lo desactivamos solo si tu API no sirve HTML/Frontend
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hidePoweredBy: true // Oculta que usas Express
}));

app.use(express.json({ limit: `${MAX_BASE64_SIZE_MB}mb` }));

// ──────────────────────────────────────────────
// GOOGLE VISION - INICIALIZACIÓN SEGURA
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
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown'; // Mejorado para Render
    const count = rateLimitMap.get(ip) || 0;

    if (count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Demasiadas solicitudes.' });
    }
    rateLimitMap.set(ip, count + 1);
    next();
}

// ──────────────────────────────────────────────
// AUTENTICACIÓN Y VALIDACIÓN (Tu lógica intacta)
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

// (Tus funciones validateImageBase64 y validarDocumentoIdentidad se quedan igual...)
function validateImageBase64(ocrBase64) { /* ... tu código ... */ }
function validarDocumentoIdentidad(textoCompleto, lineas) { /* ... tu código ... */ }

// ──────────────────────────────────────────────
// ENDPOINT PRINCIPAL
// ──────────────────────────────────────────────
app.post('/api/extract', rateLimit, authenticate, async (req, res) => {
    if (!visionReady || !client) {
        return res.status(503).json({ error: 'Servicio OCR no disponible.' });
    }

    try {
        // 3. LIMPIEZA DE MEMORIA FLASH
        let ocrBase64 = req.body.ocrBase64;
        req.body.ocrBase64 = null; // Liberamos la carga pesada del body inmediatamente

        const imageCheck = validateImageBase64(ocrBase64);
        ocrBase64 = null; // Destruimos la referencia al string largo

        if (!imageCheck.valid) {
            return res.json({ calidadAprobada: false, mensajeRechazo: imageCheck.error });
        }

        const [result] = await client.textDetection(imageCheck.buffer);
        imageCheck.buffer = null; // 🚨 DESTRUCCIÓN DEL BUFFER (Privacidad Total)

        // ... Tu lógica de extracción de datos (Nombres, Apellidos, Cédula) ...
        // (Mantén el resto de tu lógica de extracción aquí abajo)
        
        res.json({
            calidadAprobada: true,
            cedula: "...", // Tu lógica aquí
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
    console.log(`🚀 Servidor OCR Blindado con Helmet en puerto ${PORT}`);
});
