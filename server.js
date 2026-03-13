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

// ──────────────────────────────────────────────
// MIDDLEWARES DE SEGURIDAD (Blindaje A+)
// ──────────────────────────────────────────────
app.use(helmet({
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    permissionsPolicy: {
        features: {
            camera: ["'none'"],
            microphone: ["'none'"],
            geolocation: ["'none'"],
            payment: ["'none'"]
        }
    },
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
// SEGURIDAD: RATE LIMITING & AUTH
// ──────────────────────────────────────────────
const rateLimitMap = new Map();
setInterval(() => { rateLimitMap.clear(); }, RATE_LIMIT_WINDOW_MS);

function rateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const count = rateLimitMap.get(ip) || 0;
    if (count >= RATE_LIMIT_MAX) return res.status(429).json({ error: 'Demasiadas solicitudes.' });
    rateLimitMap.set(ip, count + 1);
    next();
}

function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'Se requiere API Key' });
    try {
        const keyBuffer = Buffer.from(apiKey);
        const secretBuffer = Buffer.from(API_KEY);
        if (keyBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(keyBuffer, secretBuffer)) {
            return res.status(401).json({ error: 'API key inválida' });
        }
    } catch { return res.status(401).json({ error: 'API key inválida' }); }
    next();
}

// ──────────────────────────────────────────────
// FUNCIONES DE APOYO
// ──────────────────────────────────────────────
function validateImageBase64(ocrBase64) {
    if (!ocrBase64 || typeof ocrBase64 !== 'string') return { valid: false, error: 'Falta ocrBase64' };
    const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    if (imageBuffer.length / 1024 < MIN_IMAGE_SIZE_KB) return { valid: false, error: 'Imagen muy pequeña o de baja calidad' };
    return { valid: true, buffer: imageBuffer };
}

// ──────────────────────────────────────────────
// ENDPOINT PRINCIPAL (CON EXTRACCIÓN REAL)
// ──────────────────────────────────────────────
app.post('/api/extract', rateLimit, authenticate, async (req, res) => {
    if (!visionReady || !client) return res.status(503).json({ error: 'Servicio OCR no disponible.' });

    try {
        let ocrBase64 = req.body.ocrBase64;
        req.body.ocrBase64 = null; 

        const imageCheck = validateImageBase64(ocrBase64);
        ocrBase64 = null; 

        if (!imageCheck.valid) {
            return res.json({ calidadAprobada: false, mensajeRechazo: imageCheck.error });
        }

        // 1. Llamada a Google Vision
        const [result] = await client.textDetection(imageCheck.buffer);
        const fullText = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        imageCheck.buffer = null; 

        if (!fullText) {
            return res.json({ calidadAprobada: false, mensajeRechazo: "No se detectó texto en el documento. Asegúrese de que haya buena luz." });
        }

// 2. Lógica de Extracción (ITX Logic v4 - Método de Anclas)
        // Limpiamos dejando solo letras, números, la Ñ y los saltos de línea
        const textoLimpio = fullText.toUpperCase().replace(/[^A-Z0-9 Ñ\n]/gi, "");
        
        let nombres = "";
        let apellidos = "";

        // A. Extraer Cédula
        const cedulaMatch = textoLimpio.match(/(?:NUMERO|CEDULA|DENTIDAD|NÚMERO|NUIP|Nº)\s*([\d. ]{7,15})/i);
        const cedula = cedulaMatch ? cedulaMatch[1].replace(/\D/g, '') : "";

        // B. Extraer Apellidos: Todo lo que esté estrictamente ENTRE "APELLIDOS" y "NOMBRES"
        const apellidosMatch = textoLimpio.match(/APELLIDOS\s+([\s\S]+?)\s+NOMBRES/i);
        if (apellidosMatch) {
            apellidos = apellidosMatch[1].replace(/\n/g, " ").trim();
        }

        // C. Extraer Nombres: Todo lo que esté ENTRE "NOMBRES" y la siguiente etiqueta de la cédula
        // (Suele ser NACIMIENTO, ESTATURA, SEXO, RH, FIRMA, etc.)
        const nombresMatch = textoLimpio.match(/NOMBRES\s+([\s\S]+?)\s+(?:NACIMIENTO|ESTATURA|GS|SEXO|RH|FECHA|LUGAR|FIRMA|DOCUMENTO|NACIDO)/i);
        if (nombresMatch) {
            nombres = nombresMatch[1].replace(/\n/g, " ").trim();
        } else {
            // Plan B: Si la foto está cortada y no se ven las fechas de abajo, toma las siguientes 2 líneas
            const nombresFallback = textoLimpio.match(/NOMBRES\s+([A-Z Ñ]+(?:\n[A-Z Ñ]+)?)/i);
            if (nombresFallback) {
                nombres = nombresFallback[1].replace(/\n/g, " ").trim();
            }
        }

        // D. Limpieza final preventiva
        const limpiar = (txt) => txt.replace(/(APELLIDOS|NOMBRES|REPUBLICA|COLOMBIA|CEDULA|FIRMA|CIUDADANIA)/g, "").trim();
        nombres = limpiar(nombres);
        apellidos = limpiar(apellidos);

        // 3. Respuesta Exitosa
// 3. Respuesta Final con Debugging Activado
        res.json({
            calidadAprobada: true,
            cedula: cedula || "No detectada",
            nombres: nombres || "No detectado",
            apellidos: apellidos || "No detectado",
            infoAdicional: {
                tipoDocumento: textoLimpio.includes("COLOMBIA") ? "Cédula Colombiana" : "Desconocido",
                nombreCompleto: `${nombres} ${apellidos}`.trim(),
                // 🕵️‍♂️ EL DETECTIVE: Esto nos mostrará EXACTAMENTE qué leyó Google y en qué orden
                textoCrudo: fullText.toUpperCase().replace(/\n/g, " | ") 
            }
        });

    } catch (error) {
        console.error(`[OCR] Error: ${error.message}`);
        res.status(500).json({ error: 'Error interno procesando la imagen.' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: visionReady ? 'ok' : 'degraded', service: 'ITX-OCR' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🛡️ Servidor OCR blindado en puerto ${PORT}`);
});




